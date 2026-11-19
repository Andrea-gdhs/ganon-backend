import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { KeycloakAdminService } from './keycloak-admin.service';

interface CreateSupplierInput {
  name: string;
  email: string | null;
  phone: string | null;
  netsuiteVendorId: string | null;
  temporaryPassword: string;
}

interface UpdateSupplierInput {
  name: string;
  email: string | null;
  phone: string | null;
  netsuiteVendorId: string | null;
}

interface SupplierRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  netsuite_vendor_id: string | null;
  active: boolean;
}

function isSupplierId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new BadRequestException(`${label} debe ser texto.`);
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw new BadRequestException(`${label} no puede exceder ${maxLength} caracteres.`);
  }
  return text || null;
}

function parseCreateSupplier(value: unknown): CreateSupplierInput {
  if (!isRecord(value)) {
    throw new BadRequestException('Los datos del proveedor no son válidos.');
  }
  const name = optionalText(value.name, 'El nombre del proveedor', 200);
  if (!name) throw new BadRequestException('El nombre del proveedor es obligatorio.');

  const email = optionalText(value.email, 'El correo del proveedor', 254)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException('Ingresa un correo válido para la cuenta del proveedor.');
  }

  const temporaryPassword = value.temporaryPassword;
  if (typeof temporaryPassword !== 'string' || temporaryPassword.length < 8) {
    throw new BadRequestException('La contraseña temporal debe tener al menos 8 caracteres.');
  }
  if (temporaryPassword.length > 128) {
    throw new BadRequestException('La contraseña temporal no puede exceder 128 caracteres.');
  }

  return {
    name,
    email,
    phone: optionalText(value.phone, 'El teléfono', 100),
    netsuiteVendorId: optionalText(value.netsuiteVendorId, 'El ID de NetSuite', 100),
    temporaryPassword,
  };
}

function parseUpdateSupplier(value: unknown): UpdateSupplierInput {
  if (!isRecord(value)) {
    throw new BadRequestException('Los datos del proveedor no son válidos.');
  }
  const name = optionalText(value.name, 'El nombre del proveedor', 200);
  if (!name) throw new BadRequestException('El nombre del proveedor es obligatorio.');

  const email = optionalText(value.email, 'El correo del proveedor', 254)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException('Ingresa un correo válido para la cuenta del proveedor.');
  }

  return {
    name,
    email,
    phone: optionalText(value.phone, 'El teléfono', 100),
    netsuiteVendorId: optionalText(value.netsuiteVendorId, 'El ID de NetSuite', 100),
  };
}

@Injectable()
export class SuppliersService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly keycloakAdmin: KeycloakAdminService,
  ) {}

  async findAll(): Promise<Record<string, unknown>[]> {
    return (await this.dataSource.query(`
      SELECT id, netsuite_vendor_id, name, email, phone, active
      FROM suppliers
      ORDER BY name ASC
    `)) as Record<string, unknown>[];
  }

  async create(value: unknown): Promise<Record<string, unknown>> {
    const input = parseCreateSupplier(value);
    const duplicates = (await this.dataSource.query(
      `SELECT id FROM suppliers
       WHERE LOWER(BTRIM(name)) = LOWER(BTRIM($1))
          OR ($2::varchar IS NOT NULL AND netsuite_vendor_id = $2)
       LIMIT 1`,
      [input.name, input.netsuiteVendorId],
    )) as Array<{ id: string }>;
    if (duplicates.length) {
      throw new ConflictException(
        'Ya existe un proveedor con ese nombre o ID de NetSuite.',
      );
    }

    const keycloakUser = await this.keycloakAdmin.createProviderUser(
      input.email,
      input.name,
      input.temporaryPassword,
    );
    const keycloakUserId = keycloakUser.id;

    try {
      const supplier = await this.dataSource.transaction(async (manager) => {
        const rows = (await manager.query(
          `INSERT INTO suppliers
             (netsuite_vendor_id, name, email, phone, active)
           VALUES ($1, $2, $3, $4, TRUE)
           RETURNING id, netsuite_vendor_id, name, email, phone, active`,
          [
            input.netsuiteVendorId,
            input.name,
            input.email,
            input.phone,
          ],
        )) as Array<Record<string, unknown>>;
        const createdSupplier = rows[0];
        if (!createdSupplier || typeof createdSupplier.id !== 'string') {
          throw new InternalServerErrorException('No se pudo guardar el proveedor en PostgreSQL.');
        }

        await this.linkKeycloakUser(manager, keycloakUserId, createdSupplier.id);
        return createdSupplier;
      });

      return {
        ...supplier,
        keycloak_user_id: keycloakUserId,
        keycloak_username: keycloakUser.username,
      };
    } catch (error) {
      try {
        await this.keycloakAdmin.deleteProviderUser(keycloakUserId);
      } catch {
        throw new InternalServerErrorException(
          'No se pudo guardar el proveedor en PostgreSQL y tampoco se pudo eliminar la cuenta temporal de Keycloak. Revisa ambos sistemas antes de volver a intentarlo.',
        );
      }
      throw error;
    }
  }

  async updateNetSuiteVendorId(id: string, value: unknown): Promise<Record<string, unknown>> {
    if (!isSupplierId(id)) {
      throw new BadRequestException('El ID interno del proveedor no es válido.');
    }
    if (!isRecord(value) || !Object.hasOwn(value, 'netsuiteVendorId')) {
      throw new BadRequestException('Indica el ID de NetSuite; puede ser nulo si aún no se conoce.');
    }

    const netsuiteVendorId = optionalText(value.netsuiteVendorId, 'El ID de NetSuite', 100);
    if (netsuiteVendorId) {
      const duplicate = (await this.dataSource.query(
        `SELECT id FROM suppliers WHERE netsuite_vendor_id = $1 AND id <> $2 LIMIT 1`,
        [netsuiteVendorId, id],
      )) as Array<{ id: string }>;
      if (duplicate.length) {
        throw new ConflictException('Ese ID de NetSuite ya está asignado a otro proveedor.');
      }
    }

    const rows = (await this.dataSource.query(
      `UPDATE suppliers
       SET netsuite_vendor_id = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, netsuite_vendor_id, name, email, phone, active`,
      [id, netsuiteVendorId],
    )) as Array<Record<string, unknown>>;
    if (!rows[0]) throw new NotFoundException('No se encontró el proveedor.');
    return rows[0];
  }

  async update(id: string, value: unknown): Promise<Record<string, unknown>> {
    if (!isSupplierId(id)) {
      throw new BadRequestException('El ID interno del proveedor no es válido.');
    }
    const input = parseUpdateSupplier(value);
    const existingRows = (await this.dataSource.query(
      `SELECT id, name, email, phone, netsuite_vendor_id, active
       FROM suppliers WHERE id = $1`,
      [id],
    )) as SupplierRow[];
    const existing = existingRows[0];
    if (!existing) throw new NotFoundException('No se encontró el proveedor.');

    const duplicates = (await this.dataSource.query(
      `SELECT id FROM suppliers
       WHERE id <> $1 AND (
         LOWER(BTRIM(name)) = LOWER(BTRIM($2))
         OR LOWER(BTRIM(email)) = LOWER(BTRIM($3))
         OR ($4::varchar IS NOT NULL AND netsuite_vendor_id = $4)
       )
       LIMIT 1`,
      [id, input.name, input.email, input.netsuiteVendorId],
    )) as Array<{ id: string }>;
    if (duplicates.length) {
      throw new ConflictException(
        'Ya existe otro proveedor con ese nombre, correo o ID de NetSuite.',
      );
    }

    const linkedUsers = (await this.dataSource.query(
      `SELECT keycloak_user_id FROM portal_users
       WHERE supplier_id = $1 AND role IN ('provider', 'proveedor')
       ORDER BY created_at LIMIT 1`,
      [id],
    )) as Array<{ keycloak_user_id: string }>;
    const keycloakUserId = linkedUsers[0]?.keycloak_user_id;
    const keycloakNeedsUpdate = Boolean(
      keycloakUserId &&
      ((existing.email ?? '').toLowerCase() !== (input.email ?? '').toLowerCase() ||
        existing.name !== input.name),
    );
    let originalKeycloakUsername: string | undefined;

    if (keycloakUserId && keycloakNeedsUpdate) {
      originalKeycloakUsername = await this.keycloakAdmin.updateProviderUser(
        keycloakUserId,
        input.email,
        input.name,
      );
    }

    try {
      const rows = (await this.dataSource.query(
        `UPDATE suppliers
         SET name = $2, email = $3, phone = $4,
             netsuite_vendor_id = $5, updated_at = NOW()
         WHERE id = $1
         RETURNING id, netsuite_vendor_id, name, email, phone, active`,
        [
          id,
          input.name,
          input.email,
          input.phone,
          input.netsuiteVendorId,
        ],
      )) as Array<Record<string, unknown>>;
      if (!rows[0]) throw new NotFoundException('No se encontró el proveedor.');
      return rows[0];
    } catch (error) {
      if (keycloakUserId && keycloakNeedsUpdate) {
        try {
          await this.keycloakAdmin.updateProviderUser(
            keycloakUserId,
            existing.email,
            existing.name,
            originalKeycloakUsername,
          );
        } catch {
          throw new InternalServerErrorException(
            'No se pudo actualizar PostgreSQL ni restaurar los datos anteriores en Keycloak. Revisa ambos sistemas.',
          );
        }
      }
      throw error;
    }
  }

  async setActive(id: string, active: boolean): Promise<Record<string, unknown>> {
    if (!isSupplierId(id)) {
      throw new BadRequestException('El ID interno del proveedor no es válido.');
    }
    const existingRows = (await this.dataSource.query(
      `SELECT id, active FROM suppliers WHERE id = $1`,
      [id],
    )) as Array<{ id: string; active: boolean }>;
    const existing = existingRows[0];
    if (!existing) throw new NotFoundException('No se encontró el proveedor.');
    if (existing.active === active) return this.getById(id);

    const linkedUsers = (await this.dataSource.query(
      `SELECT keycloak_user_id FROM portal_users
       WHERE supplier_id = $1 AND role IN ('provider', 'proveedor')`,
      [id],
    )) as Array<{ keycloak_user_id: string }>;
    const keycloakUserId = linkedUsers[0]?.keycloak_user_id;
    if (keycloakUserId) {
      await this.keycloakAdmin.setProviderUserEnabled(keycloakUserId, active);
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const rows = (await manager.query(
          `UPDATE suppliers
           SET active = $2, updated_at = NOW()
           WHERE id = $1
           RETURNING id, netsuite_vendor_id, name, email, phone, active`,
          [id, active],
        )) as Array<Record<string, unknown>>;
        if (!rows[0]) throw new NotFoundException('No se encontró el proveedor.');
        await manager.query(
          `UPDATE portal_users
           SET active = $2, updated_at = NOW()
           WHERE supplier_id = $1 AND role IN ('provider', 'proveedor')`,
          [id, active],
        );
        return rows[0];
      });
    } catch (error) {
      if (keycloakUserId) {
        try {
          await this.keycloakAdmin.setProviderUserEnabled(keycloakUserId, existing.active);
        } catch {
          throw new InternalServerErrorException(
            'No se pudo cambiar el estado en PostgreSQL ni restaurarlo en Keycloak. Revisa ambos sistemas.',
          );
        }
      }
      throw error;
    }
  }

  private async getById(id: string): Promise<Record<string, unknown>> {
    const rows = (await this.dataSource.query(
      `SELECT id, netsuite_vendor_id, name, email, phone, active
       FROM suppliers WHERE id = $1`,
      [id],
    )) as Array<Record<string, unknown>>;
    if (!rows[0]) throw new NotFoundException('No se encontró el proveedor.');
    return rows[0];
  }

  private async linkKeycloakUser(
    manager: EntityManager,
    keycloakUserId: string,
    supplierId: string,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO portal_users (id, keycloak_user_id, supplier_id, role, active)
       VALUES (gen_random_uuid(), $1, $2, 'provider', TRUE)`,
      [keycloakUserId, supplierId],
    );
  }
}
