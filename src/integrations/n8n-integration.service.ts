
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

type RecordData = Record<string, unknown>;

interface PurchaseOrderLineInput {
  lineId: string;
  lineNumber: number | null;
  itemId: string | null;
  sku: string | null;
  description: string | null;
  quantity: string;
  quantityReceived: string;
  unitPrice: string;
  amount: string;
  units: string | null;
}

interface PurchaseOrderInput {
  netsuiteId: string;
  orderNumber: string;
  vendorId: string;
  supplierId: string;
  orderDate: string | null;
  deliveryDate: string | null;
  status: string;
  total: string;
  currency: string;
  lines: PurchaseOrderLineInput[];
}

function isRecord(value: unknown): value is RecordData {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function requiredText(
  value: unknown,
  label: string,
  maxLength = 500,
): string {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !String(value).trim()
  ) {
    throw new BadRequestException(`${label} es obligatorio.`);
  }

  const result = String(value).trim();

  if (result.length > maxLength) {
    throw new BadRequestException(
      `${label} excede la longitud permitida.`,
    );
  }

  return result;
}

function optionalText(
  value: unknown,
  label: string,
  maxLength = 2000,
): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new BadRequestException(`${label} debe ser texto.`);
  }

  const result = String(value).trim();

  if (result.length > maxLength) {
    throw new BadRequestException(
      `${label} excede la longitud permitida.`,
    );
  }

  return result || null;
}

function decimalValue(
  value: unknown,
  label: string,
  defaultValue = '0',
): string {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const result = String(value).trim();

  if (!result || !Number.isFinite(Number(result))) {
    throw new BadRequestException(
      `${label} debe ser una cantidad numérica válida.`,
    );
  }

  return result;
}

function optionalInteger(
  value: unknown,
  label: string,
): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const result = Number(value);

  if (!Number.isInteger(result)) {
    throw new BadRequestException(`${label} debe ser un número entero.`);
  }

  return result;
}

function optionalDate(
  value: unknown,
  label: string,
): string | null {
  const result = optionalText(value, label, 50);

  if (!result) return null;

  // Conserva fechas ISO o formatos de fecha devueltos por NetSuite.
  return /^\d{4}-\d{2}-\d{2}T/.test(result)
    ? result.substring(0, 10)
    : result;
}

function parsePurchaseOrder(value: unknown): PurchaseOrderInput {
  if (!isRecord(value)) {
    throw new BadRequestException(
      'Los datos de la orden de compra no son válidos.',
    );
  }

  const supplierId = requiredText(
    value.supplierId,
    'El ID interno del proveedor',
    36,
  );

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      supplierId,
    )
  ) {
    throw new BadRequestException(
      'El ID del proveedor debe ser un UUID válido.',
    );
  }

  if (!Array.isArray(value.lines)) {
    throw new BadRequestException(
      'La orden debe incluir un arreglo de partidas.',
    );
  }

  const lines = value.lines.map((item, index) => {
    if (!isRecord(item)) {
      throw new BadRequestException(
        `La partida ${index + 1} no tiene un formato válido.`,
      );
    }

    const quantity = decimalValue(
      item.quantity,
      `Cantidad de la partida ${index + 1}`,
    );

    const quantityReceived = decimalValue(
      item.quantityReceived ?? 0,
      `Cantidad recibida de la partida ${index + 1}`,
    );

    if (Number(quantity) < 0 || Number(quantityReceived) < 0) {
      throw new BadRequestException(
        `Las cantidades de la partida ${index + 1} no pueden ser negativas.`,
      );
    }

    return {
      lineId: requiredText(
        item.lineId,
        `ID de NetSuite de la partida ${index + 1}`,
        200,
      ),
      lineNumber: optionalInteger(
        item.lineNumber,
        `Número de partida ${index + 1}`,
      ),
      itemId: optionalText(item.itemId, 'ID del artículo', 200),
      sku: optionalText(item.sku, 'Código del artículo', 500),
      description: optionalText(
        item.description,
        'Descripción del artículo',
      ),
      quantity,
      quantityReceived,
      unitPrice: decimalValue(
        item.unitPrice,
        'Precio unitario',
      ),
      amount: decimalValue(item.amount, 'Importe'),
      units: optionalText(item.units, 'Unidad', 100),
    };
  });

  return {
    netsuiteId: requiredText(
      value.netsuiteId,
      'ID interno de NetSuite',
      200,
    ),
    orderNumber: requiredText(
      value.orderNumber,
      'Número de orden de compra',
      200,
    ),
    vendorId: requiredText(
      value.vendorId,
      'ID del proveedor en NetSuite',
      100,
    ),
    supplierId,
    orderDate: optionalDate(value.orderDate, 'Fecha de la orden'),
    deliveryDate: optionalDate(
      value.deliveryDate,
      'Fecha prevista de entrega',
    ),
    status: optionalText(value.status, 'Estado', 100) ?? 'pending',
    total: decimalValue(value.total, 'Total de la orden'),
    currency: optionalText(value.currency, 'Moneda', 20) ?? 'MXN',
    lines,
  };
}

@Injectable()
export class N8nIntegrationService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findActiveSuppliersForN8n(): Promise<RecordData[]> {
    return (await this.dataSource.query(`
      SELECT
        id,
        netsuite_vendor_id,
        supplier_code,
        name,
        active
      FROM suppliers
      WHERE active = TRUE
        AND netsuite_vendor_id IS NOT NULL
        AND BTRIM(netsuite_vendor_id) <> ''
      ORDER BY name ASC
    `)) as RecordData[];
  }

  async syncPurchaseOrder(value: unknown): Promise<RecordData> {
    const input = parsePurchaseOrder(value);

    return this.dataSource.transaction(async (manager) => {
      await this.validateSupplier(manager, input);

      const orderRows = (await manager.query(
        `
        INSERT INTO purchase_orders (
          netsuite_internal_id,
          po_number,
          supplier_id,
          order_date,
          expected_delivery_date,
          status,
          total_amount,
          currency
        )
        VALUES (
          $1, $2, $3, $4::date, $5::date, $6, $7::numeric, $8
        )
        ON CONFLICT (netsuite_internal_id)
        DO UPDATE SET
          po_number = EXCLUDED.po_number,
          order_date = EXCLUDED.order_date,
          expected_delivery_date = EXCLUDED.expected_delivery_date,
          status = EXCLUDED.status,
          total_amount = EXCLUDED.total_amount,
          currency = EXCLUDED.currency,
          updated_at = NOW()
        WHERE purchase_orders.supplier_id = EXCLUDED.supplier_id
        RETURNING id, supplier_id
        `,
        [
          input.netsuiteId,
          input.orderNumber,
          input.supplierId,
          input.orderDate,
          input.deliveryDate,
          input.status,
          input.total,
          input.currency,
        ],
      )) as Array<{ id: string; supplier_id: string }>;

      const order = orderRows[0];

      if (!order) {
        throw new ConflictException(
          'La orden de NetSuite ya existe vinculada a otro proveedor.',
        );
      }

      for (const line of input.lines) {
        await manager.query(
          `
          INSERT INTO purchase_order_lines (
            purchase_order_id,
            netsuite_line_id,
            line_number,
            item_id,
            item_name,
            description,
            quantity_ordered,
            quantity_received,
            unit,
            unit_price,
            amount
          )
          VALUES (
            $1, $2, $3, $4, $5, $6,
            $7::numeric, $8::numeric, $9, $10::numeric, $11::numeric
          )
          ON CONFLICT (
            purchase_order_id,
            netsuite_line_id
          )
          DO UPDATE SET
            line_number = EXCLUDED.line_number,
            item_id = EXCLUDED.item_id,
            item_name = EXCLUDED.item_name,
            description = EXCLUDED.description,
            quantity_ordered = EXCLUDED.quantity_ordered,
            quantity_received = EXCLUDED.quantity_received,
            unit = EXCLUDED.unit,
            unit_price = EXCLUDED.unit_price,
            amount = EXCLUDED.amount,
            updated_at = NOW()
          `,
          [
            order.id,
            line.lineId,
            line.lineNumber,
            line.itemId,
            line.sku,
            line.description,
            line.quantity,
            line.quantityReceived,
            line.units,
            line.unitPrice,
            line.amount,
          ],
        );
      }

      return {
        received: true,
        purchaseOrderId: order.id,
        netsuiteId: input.netsuiteId,
        orderNumber: input.orderNumber,
        linesProcessed: input.lines.length,
      };
    });
  }

  private async validateSupplier(
    manager: EntityManager,
    input: PurchaseOrderInput,
  ): Promise<void> {
    const rows = (await manager.query(
      `
      SELECT id, netsuite_vendor_id
      FROM suppliers
      WHERE id = $1
        AND active = TRUE
      LIMIT 1
      `,
      [input.supplierId],
    )) as Array<{
      id: string;
      netsuite_vendor_id: string | null;
    }>;

    const supplier = rows[0];

    if (!supplier) {
      throw new NotFoundException(
        'El proveedor no existe o se encuentra inactivo.',
      );
    }

    if (supplier.netsuite_vendor_id !== input.vendorId) {
      throw new ConflictException(
        'El ID de NetSuite no corresponde al proveedor registrado.',
      );
    }
  }
}
