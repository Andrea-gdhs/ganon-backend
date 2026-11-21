import { DataSource } from 'typeorm';
import { N8nIntegrationService } from './n8n-integration.service';

describe('N8nIntegrationService purchase-order input', () => {
  const service = new N8nIntegrationService(
    new DataSource({ type: 'postgres', database: 'ganon-test' }),
  );
  const order = {
    netsuiteId: 'ns-order-1',
    orderNumber: 'OC-1001',
    vendorId: 'ns-vendor-1',
    supplierId: '2f6d2e66-d02f-4f2d-9bd6-cba4adfb2240',
    lines: [],
  };

  it('rejects orders without lines instead of saving an incomplete order', async () => {
    await expect(service.syncPurchaseOrder(order)).rejects.toThrow(
      'La orden debe incluir al menos una partida de NetSuite.',
    );
  });

  it('rejects repeated NetSuite line IDs instead of overwriting one line', async () => {
    await expect(
      service.syncPurchaseOrder({
        ...order,
        lines: [
          { lineId: 'same-line', quantity: 1 },
          { lineId: 'same-line', quantity: 2 },
        ],
      }),
    ).rejects.toThrow('El ID de NetSuite de la partida 2 está repetido.');
  });
});
