import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { createRemoteJWKSet, errors, jwtVerify, JWTPayload } from 'jose';
import { DataSource } from 'typeorm';
import { EvaluationRole, PortalAuthUser } from './auth.types';

interface PortalUserRow {
  id: string;
  supplier_id: string | null;
  role: string;
}

function claimRoles(value: unknown): string[] {
  if (!value || typeof value !== 'object' || !('roles' in value)) return [];
  const roles = (value as { roles?: unknown }).roles;
  return Array.isArray(roles)
    ? roles.filter((role): role is string => typeof role === 'string')
    : [];
}

function claimText(payload: JWTPayload, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

@Injectable()
export class KeycloakAuthGuard implements CanActivate {
  private jwksIssuer = '';
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authorization = request.headers.authorization;
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

    if (!token) throw new UnauthorizedException('Se requiere un token Bearer.');

    const issuer = this.issuer();
    const clientId = this.config.get<string>('KEYCLOAK_CLIENT_ID', 'ganon-angular');
    let payload: JWTPayload;

    try {
      const { payload: verifiedPayload } = await jwtVerify(token, this.keySet(issuer), {
        issuer,
        algorithms: ['RS256'],
        clockTolerance: 5,
      });
      payload = verifiedPayload;
    } catch (error) {
      if (error instanceof errors.JOSEError) {
        throw new UnauthorizedException('El token de acceso no es válido.');
      }
      throw new ServiceUnavailableException('No se pudo validar el token con Keycloak.');
    }

    if (claimText(payload, 'azp') !== clientId) {
      throw new UnauthorizedException('El token no pertenece al cliente del portal.');
    }

    const roles = new Set([
      ...claimRoles(payload['realm_access']),
      ...claimRoles(
        (payload['resource_access'] as Record<string, unknown> | undefined)?.[clientId],
      ),
    ].map((role) => role.toLowerCase()));
    const role = this.resolveRole(roles);

    if (!role) {
      throw new ForbiddenException('El perfil no tiene acceso al módulo de evaluación.');
    }

    const subject = payload.sub;
    if (typeof subject !== 'string' || !subject) {
      throw new UnauthorizedException('El token no contiene un identificador de usuario.');
    }

    const user = await this.mapUser(subject, role);
    request.user = {
      ...user,
      subject,
      name:
        claimText(payload, 'name') ||
        claimText(payload, 'preferred_username') ||
        subject,
      email: claimText(payload, 'email'),
      role,
    };

    return true;
  }

  private issuer(): string {
    const configuredIssuer = this.config.get<string>('KEYCLOAK_ISSUER');
    if (configuredIssuer) return configuredIssuer.replace(/\/+$/, '');

    const baseUrl = this.config.get<string>('KEYCLOAK_URL', 'http://localhost:8080')
      .replace(/\/+$/, '');
    const realm = this.config.get<string>('KEYCLOAK_REALM', 'ganon');
    return `${baseUrl}/realms/${realm}`;
  }

  private keySet(issuer: string): ReturnType<typeof createRemoteJWKSet> {
    if (!this.jwks || this.jwksIssuer !== issuer) {
      this.jwksIssuer = issuer;
      this.jwks = createRemoteJWKSet(
        new URL(`${issuer}/protocol/openid-connect/certs`),
      );
    }
    return this.jwks;
  }

  private resolveRole(roles: Set<string>): EvaluationRole | null {
    if (['portal-admin', 'admin', 'administrador'].some((role) => roles.has(role))) {
      return 'admin';
    }
    if (
      ['comprador', 'buyer', 'auxiliar', 'auxiliary', 'auxiliar de compras', 'auxiliar_compras']
        .some((role) => roles.has(role))
    ) return 'buyer';
    if (['cedis', 'recepcion-cedis'].some((role) => roles.has(role))) return 'cedis';
    if (['proveedor', 'provider'].some((role) => roles.has(role))) return 'provider';
    return null;
  }

  private async mapUser(
    subject: string,
    role: EvaluationRole,
  ): Promise<Pick<PortalAuthUser, 'id' | 'supplierId'>> {
    if (role !== 'provider') return { id: subject, supplierId: null };

    const rows = (await this.dataSource.query(
      `SELECT id, supplier_id, role
       FROM portal_users
       WHERE keycloak_user_id = $1 AND active = TRUE`,
      [subject],
    )) as PortalUserRow[];
    const user = rows[0];

    if (
      !user ||
      !user.supplier_id ||
      !['proveedor', 'provider'].includes(user.role.toLowerCase())
    ) {
      throw new ForbiddenException(
        'El usuario proveedor no está vinculado a un proveedor activo del portal.',
      );
    }

    return { id: user.id, supplierId: user.supplier_id };
  }
}
