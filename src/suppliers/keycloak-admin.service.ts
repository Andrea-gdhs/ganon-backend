import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface KeycloakAdminSettings {
  baseUrl: string;
  realm: string;
  adminRealm: string;
  clientId: string;
  clientSecret: string;
}

interface KeycloakRole {
  id: string;
  name: string;
}

interface KeycloakUserRepresentation {
  id: string;
  [key: string]: unknown;
}

interface CreatedProviderUser {
  id: string;
  username: string;
}

@Injectable()
export class KeycloakAdminService {
  constructor(private readonly config: ConfigService) {}

  async createProviderUser(
    username: string,
    email: string | null,
    supplierName: string,
    temporaryPassword: string,
  ): Promise<CreatedProviderUser> {
    const settings = this.settings();
    const token = await this.accessToken(settings);
    const role = await this.findProviderRole(settings, token);
    const usersUrl = `${settings.baseUrl}/admin/realms/${encodeURIComponent(settings.realm)}/users`;
    const createResponse = await this.adminRequest(usersUrl, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        ...(email ? { email } : {}),
        firstName: supplierName,
        enabled: true,
        emailVerified: false,
        requiredActions: ['UPDATE_PASSWORD'],
        credentials: [{ type: 'password', value: temporaryPassword, temporary: true }],
      }),
    });

    if (createResponse.status === 409) {
      throw new ConflictException('Ya existe una cuenta de Keycloak con ese nombre de usuario o correo.');
    }
    if (!createResponse.ok) {
      throw new ServiceUnavailableException(
        `Keycloak no pudo crear la cuenta del proveedor (HTTP ${createResponse.status}).`,
      );
    }

    const userId = await this.createdUserId(createResponse, usersUrl, token, username);
    try {
      const mappingResponse = await this.adminRequest(
        `${usersUrl}/${encodeURIComponent(userId)}/role-mappings/realm`,
        token,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([role]),
        },
      );
      if (!mappingResponse.ok) {
        throw new ServiceUnavailableException(
          `Keycloak creó la cuenta, pero no pudo asignar el rol de proveedor (HTTP ${mappingResponse.status}).`,
        );
      }
    } catch (error) {
      try {
        await this.deleteUser(usersUrl, userId, token);
      } catch {
        throw new InternalServerErrorException(
          'Keycloak creó la cuenta, pero falló la asignación del rol y no se pudo eliminar la cuenta incompleta. Revisa Keycloak antes de volver a intentarlo.',
        );
      }
      throw error;
    }

    return { id: userId, username };
  }

  async deleteProviderUser(userId: string): Promise<void> {
    const settings = this.settings();
    const token = await this.accessToken(settings);
    const usersUrl = `${settings.baseUrl}/admin/realms/${encodeURIComponent(settings.realm)}/users`;
    await this.deleteUser(usersUrl, userId, token);
  }

  async updateProviderUser(
    userId: string,
    email: string | null,
    supplierName: string,
    usernameOverride?: string,
  ): Promise<string> {
    const settings = this.settings();
    const token = await this.accessToken(settings);
    const usersUrl = `${settings.baseUrl}/admin/realms/${encodeURIComponent(settings.realm)}/users`;
    const current = await this.getUser(usersUrl, userId, token);
    const currentEmail = typeof current.email === 'string' ? current.email : '';
    const currentUsername = typeof current.username === 'string' ? current.username : '';
    const emailChanged = currentEmail.toLowerCase() !== (email ?? '').toLowerCase();
    const username = usernameOverride ?? currentUsername;
    if (!username) {
      throw new ServiceUnavailableException(
        'La cuenta de Keycloak no tiene un nombre de usuario válido para actualizar.',
      );
    }
    const updated = {
      ...current,
      username,
      email,
      firstName: supplierName,
      ...(emailChanged ? { emailVerified: false } : {}),
    };
    const response = await this.adminRequest(
      `${usersUrl}/${encodeURIComponent(userId)}`,
      token,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      },
    );
    if (response.status === 409) {
      throw new ConflictException('Ese correo ya está asignado a otra cuenta de Keycloak.');
    }
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Keycloak no pudo actualizar la cuenta del proveedor (HTTP ${response.status}).`,
      );
    }
    return currentUsername;
  }

  async setProviderUserEnabled(userId: string, enabled: boolean): Promise<void> {
    const settings = this.settings();
    const token = await this.accessToken(settings);
    const usersUrl = `${settings.baseUrl}/admin/realms/${encodeURIComponent(settings.realm)}/users`;
    const current = await this.getUser(usersUrl, userId, token);
    const response = await this.adminRequest(
      `${usersUrl}/${encodeURIComponent(userId)}`,
      token,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...current, enabled }),
      },
    );
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Keycloak no pudo ${enabled ? 'reactivar' : 'desactivar'} la cuenta del proveedor (HTTP ${response.status}).`,
      );
    }
  }

  private settings(): KeycloakAdminSettings {
    const clientId = this.config.get<string>('KEYCLOAK_ADMIN_CLIENT_ID');
    const clientSecret = this.config.get<string>('KEYCLOAK_ADMIN_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new ServiceUnavailableException(
        'Configura KEYCLOAK_ADMIN_CLIENT_ID y KEYCLOAK_ADMIN_CLIENT_SECRET para registrar proveedores.',
      );
    }

    const baseUrl = this.config.get<string>('KEYCLOAK_URL', 'http://localhost:8080')
      .replace(/\/+$/, '');
    const realm = this.config.get<string>('KEYCLOAK_REALM', 'ganon');
    return {
      baseUrl,
      realm,
      adminRealm: this.config.get<string>('KEYCLOAK_ADMIN_REALM', realm),
      clientId,
      clientSecret,
    };
  }

  private async accessToken(settings: KeycloakAdminSettings): Promise<string> {
    const tokenUrl =
      `${settings.baseUrl}/realms/${encodeURIComponent(settings.adminRealm)}` +
      '/protocol/openid-connect/token';
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
    });
    const response = await this.adminRequest(tokenUrl, undefined, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `No se pudo autenticar el servicio administrativo con Keycloak (HTTP ${response.status}).`,
      );
    }

    let payload: { access_token?: unknown };
    try {
      payload = (await response.json()) as { access_token?: unknown };
    } catch {
      throw new ServiceUnavailableException(
        'Keycloak devolvió una respuesta de autenticación no válida.',
      );
    }
    if (typeof payload.access_token !== 'string' || !payload.access_token) {
      throw new ServiceUnavailableException(
        'Keycloak no devolvió el token del servicio administrativo.',
      );
    }
    return payload.access_token;
  }

  private async findProviderRole(
    settings: KeycloakAdminSettings,
    token: string,
  ): Promise<KeycloakRole> {
    const configuredRole = this.config.get<string>('KEYCLOAK_PROVIDER_ROLE', 'proveedor');
    const roleNames = [...new Set([configuredRole, 'proveedor', 'provider'])];
    const realmUrl =
      `${settings.baseUrl}/admin/realms/${encodeURIComponent(settings.realm)}/roles`;

    for (const roleName of roleNames) {
      const response = await this.adminRequest(
        `${realmUrl}/${encodeURIComponent(roleName)}`,
        token,
      );
      if (response.status === 404) continue;
      if (!response.ok) {
        throw new ServiceUnavailableException(
          `No se pudo consultar el rol de proveedor en Keycloak (HTTP ${response.status}).`,
        );
      }
      const role = (await response.json()) as Partial<KeycloakRole>;
      if (typeof role.id !== 'string' || typeof role.name !== 'string') {
        throw new ServiceUnavailableException(
          'Keycloak devolvió un rol de proveedor con formato no válido.',
        );
      }
      return { id: role.id, name: role.name };
    }

    throw new ServiceUnavailableException(
      'No existe el rol proveedor/provider en Keycloak. Configura KEYCLOAK_PROVIDER_ROLE con el nombre del rol existente.',
    );
  }

  private async createdUserId(
    response: Response,
    usersUrl: string,
    token: string,
    username: string,
  ): Promise<string> {
    const location = response.headers.get('location');
    const idFromLocation = location?.match(/\/users\/([^/]+)\/?$/)?.[1];
    if (idFromLocation) return decodeURIComponent(idFromLocation);

    const lookup = await this.adminRequest(
      `${usersUrl}?username=${encodeURIComponent(username)}&exact=true`,
      token,
    );
    if (!lookup.ok) {
      throw new ServiceUnavailableException(
        `Keycloak creó la cuenta, pero no fue posible recuperar su ID (HTTP ${lookup.status}).`,
      );
    }
    const users = (await lookup.json()) as KeycloakUserRepresentation[];
    const user = users.find((item) => typeof item.id === 'string');
    if (!user?.id) {
      throw new ServiceUnavailableException(
        'Keycloak creó la cuenta, pero no devolvió su identificador.',
      );
    }
    return user.id;
  }

  private async deleteUser(usersUrl: string, userId: string, token: string): Promise<void> {
    const response = await this.adminRequest(
      `${usersUrl}/${encodeURIComponent(userId)}`,
      token,
      { method: 'DELETE' },
    );
    if (!response.ok && response.status !== 404) {
      throw new ServiceUnavailableException(
        `Keycloak no pudo eliminar una cuenta incompleta (HTTP ${response.status}).`,
      );
    }
  }

  private async getUser(
    usersUrl: string,
    userId: string,
    token: string,
  ): Promise<KeycloakUserRepresentation> {
    const response = await this.adminRequest(
      `${usersUrl}/${encodeURIComponent(userId)}`,
      token,
    );
    if (response.status === 404) {
      throw new NotFoundException('No se encontró la cuenta de Keycloak asociada al proveedor.');
    }
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `No se pudo consultar la cuenta del proveedor en Keycloak (HTTP ${response.status}).`,
      );
    }
    const user = (await response.json()) as Partial<KeycloakUserRepresentation>;
    if (typeof user.id !== 'string') {
      throw new ServiceUnavailableException(
        'Keycloak devolvió una cuenta de proveedor con formato no válido.',
      );
    }
    return user as KeycloakUserRepresentation;
  }

  private async adminRequest(
    url: string,
    token?: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    try {
      return await fetch(url, { ...init, headers });
    } catch {
      throw new ServiceUnavailableException(
        'No se pudo conectar con la API administrativa de Keycloak.',
      );
    }
  }
}
