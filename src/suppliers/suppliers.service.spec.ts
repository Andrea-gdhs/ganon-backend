import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { KeycloakAdminService } from './keycloak-admin.service';
import { SuppliersService } from './suppliers.service';

describe('SuppliersService', () => {
  let service: SuppliersService;
  const dataSource = {
    query: jest.fn(),
    transaction: jest.fn(),
  };
  const keycloakAdmin = {
    createProviderUser: jest.fn(),
    deleteProviderUser: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuppliersService,
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: KeycloakAdminService, useValue: keycloakAdmin },
      ],
    }).compile();

    service = module.get<SuppliersService>(SuppliersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('rejects invalid provider email before creating a Keycloak account', async () => {
    await expect(service.create({
      name: 'Proveedor de prueba',
      username: 'flexico',
      email: 'correo-invalido',
      temporaryPassword: 'temporal-123',
    })).rejects.toThrow('Ingresa un correo válido');

    expect(keycloakAdmin.createProviderUser).not.toHaveBeenCalled();
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('rejects an invalid username before creating a Keycloak account', async () => {
    await expect(service.create({
      name: 'Proveedor de prueba',
      username: 'Flexico!',
      email: null,
      temporaryPassword: 'temporal-123',
    })).rejects.toThrow('El usuario debe tener entre 3 y 50 caracteres');

    expect(keycloakAdmin.createProviderUser).not.toHaveBeenCalled();
    expect(dataSource.query).not.toHaveBeenCalled();
  });
  it('allows the NetSuite vendor ID to be cleared for later assignment', async () => {
    const updated = {
      id: 'f628b198-e7b2-46c1-b075-275e777ecf12',
      netsuite_vendor_id: null,
    };
    dataSource.query.mockResolvedValue([updated]);

    await expect(
      service.updateNetSuiteVendorId(updated.id, { netsuiteVendorId: null }),
    ).resolves.toEqual(updated);
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE suppliers'),
      [updated.id, null],
    );
  });

  it('permanently deletes an inactive supplier and its linked Keycloak user', async () => {
    const id = 'f628b198-e7b2-46c1-b075-275e777ecf12';
    const manager = { query: jest.fn() };
    manager.query
      .mockResolvedValueOnce([{ id, active: false }])
      .mockResolvedValueOnce([{
        has_orders: false,
        has_evaluations: false,
        has_commitments: false,
      }])
      .mockResolvedValueOnce([{ keycloak_user_id: 'keycloak-user-id' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id }]);
    dataSource.transaction.mockImplementation(async (operation) =>
      operation(manager as unknown as EntityManager),
    );

    await expect(service.delete(id)).resolves.toBeUndefined();
    expect(keycloakAdmin.deleteProviderUser).toHaveBeenCalledWith('keycloak-user-id');
  });

  it('does not permanently delete an active supplier', async () => {
    const id = 'f628b198-e7b2-46c1-b075-275e777ecf12';
    const manager = { query: jest.fn().mockResolvedValue([{ id, active: true }]) };
    dataSource.transaction.mockImplementation(async (operation) =>
      operation(manager as unknown as EntityManager),
    );

    await expect(service.delete(id)).rejects.toThrow(
      'Desactiva el proveedor antes de eliminarlo permanentemente.',
    );
    expect(keycloakAdmin.deleteProviderUser).not.toHaveBeenCalled();
  });

  it('preserves suppliers with linked history', async () => {
    const id = 'f628b198-e7b2-46c1-b075-275e777ecf12';
    const constraintError = Object.assign(new Error('foreign key violation'), {
      driverError: { code: '23503' },
    });
    const manager = { query: jest.fn() };
    manager.query
      .mockResolvedValueOnce([{ id, active: false }])
      .mockResolvedValueOnce([{
        has_orders: false,
        has_evaluations: false,
        has_commitments: false,
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(constraintError);
    dataSource.transaction.mockImplementation(async (operation) =>
      operation(manager as unknown as EntityManager),
    );

    await expect(service.delete(id)).rejects.toThrow(
      'No se puede eliminar permanentemente este proveedor porque tiene órdenes, evaluaciones u otro historial asociado.',
    );
    expect(keycloakAdmin.deleteProviderUser).not.toHaveBeenCalled();
  });
});


