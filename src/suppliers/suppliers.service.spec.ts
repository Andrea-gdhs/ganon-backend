import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
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
      email: 'correo-invalido',
      temporaryPassword: 'temporal-123',
    })).rejects.toThrow('Ingresa un correo válido');

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
});
