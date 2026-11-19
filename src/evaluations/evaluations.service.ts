import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { PortalAuthUser } from '../auth/auth.types';
import {
  COMMITMENT_CATALOG,
  CommitmentOption,
  getCommitmentOption,
} from './evaluation-catalog';
import { calculateOtifMetrics, OtifMetrics, PerformanceLine } from './evaluation-metrics';

type SqlExecutor = Pick<EntityManager, 'query'>;

interface PeriodRange {
  type: 'mensual' | 'trimestral' | 'primer_semestre' | 'segundo_semestre';
  start: string;
  end: string;
}

export interface SupplierRow {
  id: string;
  name: string;
  email: string | null;
}

interface PerformanceRow {
  expected_delivery_date: string;
  first_receipt_date: string | null;
  ordered_quantity: string;
  first_receipt_quantity: string;
  first_items_match: boolean | null;
}

interface SupplierOrderLineRow {
  order_id: string;
  order_date: string;
  expected_delivery_date: string | null;
  line_id: string;
  line_number: string | number;
  item_id: string | null;
  ordered_quantity: string;
  delivered_quantity: string;
}

interface EvaluationRow {
  id: string;
  supplier_id: string;
  supplier_name: string;
  period_type: PeriodRange['type'];
  period_start: string;
  period_end: string;
  evaluation_date: string | null;
  reported_by: string | null;
  buyer_name: string | null;
  buyer_role: string | null;
  supplier_contact_name: string | null;
  supplier_contact_role: string | null;
  supplier_email: string | null;
  supplier_extension: string | null;
  score: string | null;
  comments: string | null;
  status: string;
  created_at: string;
  supplier_response_status: string | null;
  supplier_response_text: string | null;
  supplier_response_signer_name: string | null;
  supplier_response_at: string | null;
  supplier_response_signature_file_path: string | null;
}

interface EvaluationSignerInput {
  name: string;
  role: string;
  company: string;
  signatureData: string | null;
}

interface PreparedSigner extends EvaluationSignerInput {
  filePath: string | null;
}

const CATEGORY_DB_VALUE: Record<CommitmentOption['category'], string> = {
  Operativos: 'operativo',
  Administrativos: 'administrativo',
  Estratégicos: 'estrategico',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, label: string, required = false): string {
  if (typeof value !== 'string') {
    if (required) throw new BadRequestException(`${label} es obligatorio.`);
    return '';
  }
  const result = value.trim();
  if (required && !result) throw new BadRequestException(`${label} es obligatorio.`);
  return result;
}

function decimalValue(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || result > 100) {
    throw new BadRequestException(`${label} debe ser un porcentaje de 0 a 100.`);
  }
  return result;
}

function validDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${label} debe tener formato AAAA-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${label} no es una fecha válida.`);
  }
  return value;
}

function uuidValue(value: unknown, label: string): string {
  const result = stringValue(value, label, true);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result)) {
    throw new BadRequestException(`${label} no tiene un identificador válido.`);
  }
  return result;
}

function parsePeriod(value: unknown, startValue: unknown, endValue: unknown): PeriodRange {
  const start = validDate(startValue, 'La fecha inicial');
  const end = validDate(endValue, 'La fecha final');
  if (start > end) throw new BadRequestException('La fecha inicial debe preceder a la final.');
  if (
    value !== 'mensual' &&
    value !== 'trimestral' &&
    value !== 'primer_semestre' &&
    value !== 'segundo_semestre'
  ) {
    throw new BadRequestException('El tipo de periodo no es válido.');
  }

  const first = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth();
  const expectedStart = (monthIndex: number) =>
    `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
  const expectedEnd = (monthIndex: number) => {
    const date = new Date(Date.UTC(year, monthIndex + 1, 0));
    return date.toISOString().slice(0, 10);
  };
  let valid = false;

  if (value === 'mensual') {
    valid = start === expectedStart(month) && end === expectedEnd(month);
  } else if (value === 'trimestral') {
    const quarterStart = Math.floor(month / 3) * 3;
    valid =
      month === quarterStart &&
      start === expectedStart(quarterStart) &&
      end === expectedEnd(quarterStart + 2);
  } else if (value === 'primer_semestre') {
    valid = month === 0 && start === expectedStart(0) && end === expectedEnd(5);
  } else {
    valid = month === 6 && start === expectedStart(6) && end === expectedEnd(11);
  }

  if (!valid || first.getUTCFullYear() !== last.getUTCFullYear()) {
    throw new BadRequestException('Las fechas no corresponden al periodo seleccionado.');
  }
  return { type: value, start, end };
}

function validateSignature(dataUrl: string, number: number): void {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) {
    throw new BadRequestException(`La firma ${number} debe ser una imagen PNG en base64.`);
  }
  const data = Buffer.from(match[1], 'base64');
  if (!data.length || data.length > 1024 * 1024) {
    throw new BadRequestException(`La firma ${number} excede el tamaño permitido de 1 MB.`);
  }
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (
    data.length < 24 ||
    !data.subarray(0, 8).equals(pngSignature) ||
    data.toString('ascii', 12, 16) !== 'IHDR' ||
    data.readUInt32BE(16) > 4000 ||
    data.readUInt32BE(20) > 2000
  ) {
    throw new BadRequestException(`La firma ${number} no es un PNG válido o supera el tamaño permitido.`);
  }
}

function parseSigners(value: unknown): EvaluationSignerInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 5) {
    throw new BadRequestException('Se permiten hasta cinco firmantes por evaluación.');
  }
  const roles = new Set<string>();
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new BadRequestException(`La firma ${index + 1} no es válida.`);
    }
    const name = stringValue(entry.name, `El nombre del firmante ${index + 1}`, true);
    const role = stringValue(entry.role, `El cargo del firmante ${index + 1}`, true);
    const company = stringValue(entry.company, `La empresa del firmante ${index + 1}`, true);
    if (roles.has(role.toLowerCase())) {
      throw new BadRequestException('No se puede repetir el cargo de un firmante.');
    }
    roles.add(role.toLowerCase());
    const signatureData =
      entry.signatureData === undefined || entry.signatureData === null
        ? null
        : stringValue(entry.signatureData, `La firma ${index + 1}`, true);
    if (signatureData) validateSignature(signatureData, index + 1);
    return { name, role, company, signatureData };
  });
}

function parseCommitments(value: unknown): CommitmentOption[] {
  if (!Array.isArray(value) || value.length > 29) {
    throw new BadRequestException('La lista de compromisos no es válida.');
  }
  const titles = new Set<string>();
  return value.map((title, index) => {
    const option = typeof title === 'string' ? getCommitmentOption(title) : undefined;
    if (!option) {
      throw new BadRequestException(`El compromiso ${index + 1} no pertenece al catálogo.`);
    }
    if (titles.has(title)) throw new BadRequestException('No se pueden repetir compromisos.');
    titles.add(title);
    return option;
  });
}

function metricsFromCriteria(
  rows: Array<{ category: string; criterion_name: string; score: string | null; comments: string | null }>,
): Record<string, unknown> {
  const snapshot = rows.find(
    (row) => row.category === 'resumen' && row.criterion_name === 'snapshot',
  );
  if (!snapshot?.comments) {
    throw new InternalServerErrorException('La evaluación no contiene un snapshot de métricas.');
  }
  try {
    const parsed: unknown = JSON.parse(snapshot.comments);
    if (!isRecord(parsed)) {
      throw new InternalServerErrorException('El snapshot guardado no tiene el formato esperado.');
    }
    return parsed;
  } catch {
    throw new InternalServerErrorException('No se pudo leer el snapshot guardado de la evaluación.');
  }
}

@Injectable()
export class EvaluationsService {
  private readonly filesRoot: string;

  constructor(
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.filesRoot = resolve(
      process.cwd(),
      config.get<string>('EVALUATION_FILES_DIR', 'storage/evaluations'),
    );
  }

  getCommitmentCatalog(): readonly CommitmentOption[] {
    return COMMITMENT_CATALOG;
  }

  async getActiveSuppliers(): Promise<SupplierRow[]> {
    return (await this.dataSource.query(
      `SELECT id, name, email FROM suppliers WHERE active = TRUE ORDER BY name`,
    )) as SupplierRow[];
  }

  async getSupplierOrderHistory(supplierId: string): Promise<Record<string, unknown>[]> {
    await this.requireSupplier(supplierId);
    const rows = (await this.dataSource.query(
      `SELECT po.id::text AS order_id,
              po.order_date::date::text AS order_date,
              po.expected_delivery_date::date::text AS expected_delivery_date,
              pol.id::text AS line_id, pol.line_number, pol.item_id::text AS item_id,
              pol.quantity_ordered::text AS ordered_quantity,
              COALESCE(
                SUM(rl.quantity_delivered) FILTER (
                  WHERE r.receipt_type = 'final' AND r.status IN ('released', 'completed')
                ), 0
              )::text AS delivered_quantity
       FROM purchase_orders po
       JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
       LEFT JOIN receipts r ON r.purchase_order_id = po.id
       LEFT JOIN receipt_lines rl
         ON rl.receipt_id = r.id AND rl.purchase_order_line_id = pol.id
       WHERE po.supplier_id = $1
       GROUP BY po.id, pol.id
       ORDER BY po.expected_delivery_date DESC, po.order_date DESC, pol.line_number, pol.id`,
      [supplierId],
    )) as SupplierOrderLineRow[];
    const orders = new Map<string, {
      id: string;
      orderDate: string;
      expectedDeliveryDate: string | null;
      lines: Array<Record<string, unknown>>;
    }>();
    for (const row of rows) {
      let order = orders.get(row.order_id);
      if (!order) {
        order = {
          id: row.order_id,
          orderDate: row.order_date,
          expectedDeliveryDate: row.expected_delivery_date,
          lines: [],
        };
        orders.set(row.order_id, order);
      }
      const orderedQuantity = Number(row.ordered_quantity);
      const deliveredQuantity = Number(row.delivered_quantity);
      order.lines.push({
        id: row.line_id,
        lineNumber: row.line_number,
        itemId: row.item_id,
        orderedQuantity,
        deliveredQuantity,
        pendingQuantity: Math.max(0, orderedQuantity - deliveredQuantity),
      });
    }
    return [...orders.values()];
  }

    
async getPortalOrders(supplierId?: string): Promise<Record<string, unknown>[]> {
  if (supplierId) {
    await this.requireSupplier(supplierId);
  }

  const rows = (await this.dataSource.query(
    `
    SELECT
      po.id::text AS order_id,
      po.po_number,
      po.supplier_id::text AS supplier_id,
      s.name AS supplier_name,
      po.order_date::date::text AS order_date,
      po.expected_delivery_date::date::text AS expected_delivery_date,
      po.status,
      po.total_amount::text AS total_amount,
      po.currency,
      pol.id::text AS line_id,
      pol.line_number,
      pol.item_id::text AS item_id,
      COALESCE(pol.item_name, pol.item_id::text, '') AS item_name,
      COALESCE(pol.description, '') AS description,
      pol.quantity_ordered::text AS quantity_ordered,
      COALESCE(pol.quantity_received, 0)::text AS quantity_received,
      pol.unit,
      pol.unit_price::text AS unit_price,
      pol.amount::text AS line_amount
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
    WHERE ($1::uuid IS NULL OR po.supplier_id = $1::uuid)
    ORDER BY
      po.expected_delivery_date DESC,
      po.order_date DESC,
      po.po_number,
      pol.line_number,
      pol.id
    `,
    [supplierId || null],
  )) as Array<{
    order_id: string;
    po_number: string;
    supplier_id: string;
    supplier_name: string;
    order_date: string;
    expected_delivery_date: string | null;
    status: string;
    total_amount: string;
    currency: string;
    line_id: string;
    line_number: string | number;
    item_id: string | null;
    item_name: string;
    description: string;
    quantity_ordered: string;
    quantity_received: string;
    unit: string | null;
    unit_price: string | null;
    line_amount: string | null;
  }>;

  const orders = new Map<string, Record<string, unknown>>();

  for (const row of rows) {
    let order = orders.get(row.order_id);

    if (!order) {
      order = {
        id: row.order_id,
        oc: row.po_number,
        providerId: row.supplier_id,
        providerName: row.supplier_name,
        date: row.expected_delivery_date || row.order_date,
        orderDate: row.order_date,
        expectedDeliveryDate: row.expected_delivery_date,
        amount: Number(row.total_amount),
        status: row.status,
        currency: row.currency,
        lines: [],
      };

      orders.set(row.order_id, order);
    }

    const orderedQty = Number(row.quantity_ordered);
    const receivedQty = Number(row.quantity_received);
    const pendingQty = Math.max(0, orderedQty - receivedQty);

    (order.lines as Array<Record<string, unknown>>).push({
      lineId: row.line_id,
      lineNumber: row.line_number,
      itemId: row.item_id,
      sku: row.item_name,
      description: row.description,
      orderedQty,
      receivedQty,
      pendingQty,
      fullyReceived: pendingQty === 0,
      unit: row.unit,
      unitPrice: row.unit_price === null ? null : Number(row.unit_price),
      amount: row.line_amount === null ? null : Number(row.line_amount),
    });
  }

  for (const order of orders.values()) {
    const lines = order.lines as Array<Record<string, unknown>>;

    const totalOrdered = lines.reduce(
      (sum, line) => sum + Number(line.orderedQty || 0),
      0,
    );

    const totalReceived = lines.reduce(
      (sum, line) => sum + Number(line.receivedQty || 0),
      0,
    );

    const totalPending = lines.reduce(
      (sum, line) => sum + Number(line.pendingQty || 0),
      0,
    );

    order.totalOrderedQty = totalOrdered;
    order.totalReceivedQty = totalReceived;
    order.totalPendingQty = totalPending;
    order.fullyReceived = totalPending === 0;
    order.deliveryStatus =
      totalPending === 0
        ? 'delivered'
        : totalReceived > 0
          ? 'partially_received'
          : 'pending';
  }

  return [...orders.values()];
}


  async previewMetrics(
    supplierId: string,
    periodType: unknown,
    periodStart: unknown,
    periodEnd: unknown,
  ): Promise<Record<string, unknown>> {
    await this.requireSupplier(supplierId);
    const period = parsePeriod(periodType, periodStart, periodEnd);
    return this.buildSnapshot(this.dataSource, supplierId, period, null);
  }

  async createEvaluation(user: PortalAuthUser, value: unknown): Promise<Record<string, unknown>> {
    if (!isRecord(value)) throw new BadRequestException('El cuerpo de la evaluación no es válido.');
    const supplierId = stringValue(value.supplierId, 'El proveedor', true);
    const supplier = await this.requireSupplier(supplierId);
    const period = parsePeriod(value.periodType, value.periodStart, value.periodEnd);
    const sellOut = decimalValue(value.sellOutPercentage, 'Sell Out');
    const commitments = parseCommitments(value.commitments);
    const signers = parseSigners(value.signers);
    const comments = stringValue(value.comments, 'Los comentarios');
    const supplierContactName = stringValue(value.supplierContactName, 'El contacto del proveedor');
    const supplierContactRole = stringValue(value.supplierContactRole, 'El cargo del contacto');
    const supplierEmail = stringValue(value.supplierEmail, 'El correo del proveedor') || supplier.email || '';
    const supplierExtension = stringValue(value.supplierExtension, 'La extensión del proveedor');
    const evaluationId = randomUUID();
    const snapshot = await this.buildSnapshot(this.dataSource, supplierId, period, sellOut);
    const preparedSigners = await this.writeSignatures(evaluationId, signers);
    const snapshotJson = JSON.stringify(snapshot);

    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `INSERT INTO evaluations
            (id, supplier_id, period_type, period_start, period_end, evaluation_date,
             reported_by, buyer_name, buyer_role, supplier_contact_name,
             supplier_contact_role, supplier_email, supplier_extension, score,
             comments, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7, $8, $9, $10, $11, $12,
                   NULL, $13, 'draft', NOW(), NOW())`,
          [
            evaluationId,
            supplierId,
            period.type,
            period.start,
            period.end,
            user.name,
            user.name,
            user.role === 'buyer' ? 'Comprador' : 'Administrador',
            supplierContactName || null,
            supplierContactRole || null,
            supplierEmail || null,
            supplierExtension || null,
            comments || null,
          ],
        );
        await this.saveCriteria(manager, evaluationId, snapshot, snapshotJson);

        for (const commitment of commitments) {
          const inserted = (await manager.query(
            `INSERT INTO supplier_commitments
              (supplier_id, category, title, status, submitted_at, created_at, updated_at)
             VALUES ($1, $2, $3, 'submitted', NOW(), NOW(), NOW())
             RETURNING id`,
            [supplierId, CATEGORY_DB_VALUE[commitment.category], commitment.title],
          )) as Array<{ id: string }>;
          await manager.query(
            `INSERT INTO evaluation_commitments (evaluation_id, commitment_id)
             VALUES ($1, $2)`,
            [evaluationId, inserted[0].id],
          );
        }

        for (const [index, signer] of preparedSigners.entries()) {
          await manager.query(
            `INSERT INTO evaluation_signatures
              (evaluation_id, signer_name, signer_role, signature_file_path, signature_order)
             VALUES ($1, $2, $3, $4, $5)`,
            [evaluationId, signer.name, `${signer.role} · ${signer.company}`, signer.filePath, index + 1],
          );
        }
      });
    } catch (error) {
      await rm(join(this.filesRoot, evaluationId), { recursive: true, force: true });
      throw error;
    }

    return this.getEvaluation(evaluationId, user);
  }

  async listEvaluations(user: PortalAuthUser): Promise<Record<string, unknown>[]> {
    const params: unknown[] = [];
    let condition = '';
    if (user.role === 'provider') {
      if (!user.supplierId) throw new ForbiddenException('El usuario no tiene proveedor asignado.');
      params.push(user.supplierId);
      condition = `WHERE e.supplier_id = $1
        AND (e.status = 'published' OR (
          e.status = 'draft' AND EXISTS (
            SELECT 1 FROM evaluation_commitments ec WHERE ec.evaluation_id = e.id
          )
        ))`;
    }
    const rows = (await this.dataSource.query(
      `SELECT e.id, e.supplier_id, s.name AS supplier_name, e.period_type,
              e.period_start, e.period_end, e.evaluation_date, e.reported_by,
              e.score, e.status, e.created_at, e.supplier_response_status,
              e.supplier_response_text, e.supplier_response_signer_name,
              e.supplier_response_at,
              EXISTS (SELECT 1 FROM evaluation_commitments ec WHERE ec.evaluation_id = e.id)
                AS has_commitments
       FROM evaluations e
       JOIN suppliers s ON s.id = e.supplier_id
       ${condition}
       ORDER BY e.period_start DESC, e.created_at DESC`,
      params,
    )) as Array<Record<string, unknown>>;
    return rows;
  }

  async getEvaluation(id: string, user: PortalAuthUser): Promise<Record<string, unknown>> {
    uuidValue(id, 'La evaluación');
    const rows = (await this.dataSource.query(
      `SELECT e.*, s.name AS supplier_name
       FROM evaluations e
       JOIN suppliers s ON s.id = e.supplier_id
       WHERE e.id = $1`,
      [id],
    )) as EvaluationRow[];
    const evaluation = rows[0];
    const hasCommitments = evaluation
      ? Boolean(
          (await this.dataSource.query(
            `SELECT 1 FROM evaluation_commitments WHERE evaluation_id = $1 LIMIT 1`,
            [id],
          ))[0],
        )
      : false;
    if (
      !evaluation ||
      (user.role === 'provider' &&
        (evaluation.supplier_id !== user.supplierId ||
          (evaluation.status !== 'published' && !(evaluation.status === 'draft' && hasCommitments))))
    ) {
      throw new NotFoundException('No se encontró la evaluación solicitada.');
    }

    const criteria = (await this.dataSource.query(
      `SELECT category, criterion_name, score, comments
       FROM evaluation_criteria WHERE evaluation_id = $1
       ORDER BY created_at, id`,
      [id],
    )) as Array<{ category: string; criterion_name: string; score: string | null; comments: string | null }>;
    const commitmentRows = (await this.dataSource.query(
      `SELECT sc.id, sc.category, sc.title, sc.description, sc.status, sc.due_date
       FROM evaluation_commitments ec
       JOIN supplier_commitments sc ON sc.id = ec.commitment_id
       WHERE ec.evaluation_id = $1
       ORDER BY sc.category, sc.title`,
      [id],
    )) as Array<Record<string, unknown>>;
    const signatureRows = (await this.dataSource.query(
      `SELECT signer_name, signer_role, signature_file_path, signature_order
       FROM evaluation_signatures
       WHERE evaluation_id = $1
       ORDER BY signature_order, created_at`,
      [id],
    )) as Array<{
      signer_name: string;
      signer_role: string | null;
      signature_file_path: string | null;
      signature_order: number | null;
    }>;
    const signers = await Promise.all(
      signatureRows.map(async (signer) => ({
        name: signer.signer_name,
        role: signer.signer_role,
        signatureData: signer.signature_file_path
          ? await this.readSignature(signer.signature_file_path)
          : null,
        order: signer.signature_order,
      })),
    );

    return {
      ...evaluation,
      criteria,
      metrics: metricsFromCriteria(criteria),
      commitments: commitmentRows,
      signers,
      supplier_response_signature_data: evaluation.supplier_response_signature_file_path
        ? await this.readSignature(evaluation.supplier_response_signature_file_path)
        : null,
    };
  }

  async respondToCommitments(
    id: string,
    user: PortalAuthUser,
    value: unknown,
  ): Promise<Record<string, unknown>> {
    uuidValue(id, 'La evaluación');
    if (!isRecord(value)) {
      throw new BadRequestException('La respuesta a los compromisos no es válida.');
    }
    const decision = value.decision;
    if (decision !== 'accepted' && decision !== 'review_requested') {
      throw new BadRequestException('Selecciona aceptar los compromisos o solicitar una revisión.');
    }
    const responseText = stringValue(value.responseText, 'La respuesta del proveedor', true);
    if (responseText.length > 2000) {
      throw new BadRequestException('La respuesta del proveedor no puede exceder 2,000 caracteres.');
    }
    const signatureData =
      value.signatureData === undefined || value.signatureData === null
        ? ''
        : stringValue(value.signatureData, 'La firma del proveedor');
    if (decision === 'accepted' && !signatureData) {
      throw new BadRequestException('La firma digital es obligatoria para aceptar los compromisos.');
    }
    if (decision === 'review_requested' && signatureData) {
      throw new BadRequestException('La firma solo se requiere para aceptar los compromisos.');
    }
    if (signatureData) validateSignature(signatureData, 1);

    const evaluations = (await this.dataSource.query(
      `SELECT supplier_id, supplier_response_status
       FROM evaluations WHERE id = $1`,
      [id],
    )) as Array<{ supplier_id: string; supplier_response_status: string | null }>;
    const evaluation = evaluations[0];
    if (!evaluation || evaluation.supplier_id !== user.supplierId) {
      throw new NotFoundException('No se encontró la evaluación solicitada.');
    }
    if (evaluation.supplier_response_status) {
      throw new ConflictException('El proveedor ya respondió a estos compromisos.');
    }
    const linkedCommitments = (await this.dataSource.query(
      `SELECT 1 FROM evaluation_commitments WHERE evaluation_id = $1 LIMIT 1`,
      [id],
    )) as Array<Record<string, unknown>>;
    if (!linkedCommitments.length) {
      throw new BadRequestException('La evaluación no tiene compromisos asignados para responder.');
    }

    const signatureFilePath = signatureData
      ? `${id}/supplier-response-${randomUUID()}.png`
      : null;
    const signatureFile = signatureFilePath ? resolve(this.filesRoot, signatureFilePath) : null;
    if (signatureFilePath && signatureFile && !signatureFile.startsWith(`${resolve(this.filesRoot, id)}\\`) &&
        !signatureFile.startsWith(`${resolve(this.filesRoot, id)}/`)) {
      throw new BadRequestException('La ruta de la firma no es válida.');
    }
    if (signatureFile) {
      await mkdir(join(this.filesRoot, id), { recursive: true });
      await writeFile(signatureFile, Buffer.from(signatureData.split(',')[1], 'base64'), {
        flag: 'wx',
      });
    }

    try {
      const updated = (await this.dataSource.query(
        `UPDATE evaluations
         SET supplier_response_status = $3,
             supplier_response_text = $4,
             supplier_response_signer_name = $5,
             supplier_response_signature_file_path = $6,
             supplier_response_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND supplier_id = $2 AND supplier_response_status IS NULL
         RETURNING id`,
        [id, user.supplierId, decision, responseText, user.name, signatureFilePath],
      )) as Array<{ id: string }>;
      if (!updated.length) {
        throw new ConflictException('El proveedor ya respondió a estos compromisos.');
      }
    } catch (error) {
      if (signatureFile) await rm(signatureFile, { force: true });
      throw error;
    }
    return this.getEvaluation(id, user);
  }

  private async requireSupplier(id: string): Promise<SupplierRow> {
    const supplierId = stringValue(id, 'El proveedor', true);
    const rows = (await this.dataSource.query(
      `SELECT id, name, email FROM suppliers WHERE id = $1 AND active = TRUE`,
      [supplierId],
    )) as SupplierRow[];
    if (!rows[0]) throw new NotFoundException('No se encontró el proveedor activo.');
    return rows[0];
  }

  private async buildSnapshot(
    executor: SqlExecutor,
    supplierId: string,
    period: PeriodRange,
    sellOutPercentage: number | null,
  ): Promise<Record<string, unknown>> {
    const today = new Date().toISOString().slice(0, 10);
    const orderRows = (await executor.query(
      `SELECT COUNT(*)::int AS count
       FROM purchase_orders
       WHERE supplier_id = $1
         AND order_date >= $2::date
         AND order_date <= LEAST($3::date, CURRENT_DATE)`,
      [supplierId, period.start, period.end],
    )) as Array<{ count: number }>;
    const rows = (await executor.query(
      `SELECT po.expected_delivery_date::date::text AS expected_delivery_date,
              first_receipt.received_date::text AS first_receipt_date,
              pol.quantity_ordered::text AS ordered_quantity,
              COALESCE(first_receipt.received_quantity, 0)::text AS first_receipt_quantity,
              first_receipt.items_match AS first_items_match
       FROM purchase_orders po
       JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
       LEFT JOIN LATERAL (
         SELECT r.received_at::date AS received_date,
                SUM(rl.quantity_delivered) AS received_quantity,
                CASE
                  WHEN pol.item_id IS NULL OR BOOL_OR(rl.received_item_id IS NULL) THEN NULL
                  WHEN BOOL_AND(BTRIM(rl.received_item_id) = BTRIM(pol.item_id)) THEN TRUE
                  ELSE FALSE
                END AS items_match
         FROM receipts r
         JOIN receipt_lines rl ON rl.receipt_id = r.id
         WHERE r.purchase_order_id = po.id
           AND r.receipt_type = 'final'
           AND r.status IN ('released', 'completed')
           AND r.received_at IS NOT NULL
           AND rl.purchase_order_line_id = pol.id
           AND rl.quantity_delivered > 0
         GROUP BY r.id, r.received_at, r.created_at
         ORDER BY r.received_at, r.created_at, r.id
         LIMIT 1
       ) first_receipt ON TRUE
       WHERE po.supplier_id = $1
         AND po.expected_delivery_date >= $2::date
         AND po.expected_delivery_date <= LEAST($3::date, CURRENT_DATE)
       ORDER BY po.expected_delivery_date, po.id, pol.line_number, pol.id`,
      [supplierId, period.start, period.end],
    )) as PerformanceRow[];
    const metrics: OtifMetrics = calculateOtifMetrics(
      rows.map((row): PerformanceLine => ({
        expectedDeliveryDate: row.expected_delivery_date,
        firstReceiptDate: row.first_receipt_date,
        orderedQuantity: row.ordered_quantity,
        firstReceiptQuantity: row.first_receipt_quantity,
        firstItemsMatch: row.first_items_match,
      })),
    );
    const criticalityLevel =
      sellOutPercentage === null
        ? null
        : sellOutPercentage >= 85
          ? 'Confiable'
          : sellOutPercentage >= 75
            ? 'Con Riesgo'
            : 'No Confiable';

    return {
      asOf: today,
      orderCount: orderRows[0]?.count ?? 0,
      otif: metrics,
      sellOutPercentage,
      criticalityLevel,
      dataPending: {
        itemVerification: metrics.itemVerificationPending > 0,
        quality: true,
        billing: true,
        returns: true,
        incidents: true,
      },
      finalScore: null,
      classification: null,
      recommendation: null,
      evaluationStatus: 'draft',
    };
  }

  private async saveCriteria(
    manager: EntityManager,
    evaluationId: string,
    snapshot: Record<string, unknown>,
    snapshotJson: string,
  ): Promise<void> {
    const metrics = snapshot.otif as OtifMetrics;
    const sellOut = snapshot.sellOutPercentage;
    const rows: Array<[string, string, number | null, string | null]> = [
      ['operativo', 'Órdenes emitidas', Number(snapshot.orderCount), null],
      ['operativo', 'Líneas evaluadas', metrics.totalLines, null],
      ['operativo', 'Entregas a tiempo', metrics.onTimeLines, null],
      ['operativo', 'Entregas retrasadas', metrics.delayedLines, null],
      ['operativo', 'On Time (%)', metrics.onTimeRate === null ? null : metrics.onTimeRate * 100, null],
      ['operativo', 'Líneas In Full', metrics.initialFullLines, null],
      ['operativo', 'In Full (%)', metrics.inFullRate === null ? null : metrics.inFullRate * 100, null],
      ['operativo', 'OTIF (%)', metrics.otif === null ? null : metrics.otif * 100, null],
      ['operativo', 'Validación de artículo pendiente', null, String(metrics.itemVerificationPending)],
      ['calidad', 'Calidad de producto', null, 'Pendiente de integrar una fuente de calidad.'],
      ['incidencias', 'Facturación', null, 'Pendiente de integrar una fuente de facturación.'],
      ['incidencias', 'Devoluciones', null, 'Pendiente de integrar una fuente de devoluciones.'],
      ['comercial', 'Sell Out (%)', typeof sellOut === 'number' ? sellOut : null, null],
      [
        'comercial',
        'Criticidad',
        null,
        typeof snapshot.criticalityLevel === 'string'
          ? snapshot.criticalityLevel
          : 'Pendiente de captura de Sell Out.',
      ],
      ['resumen', 'Resultado final', null, 'Pendiente de integrar fuentes de incidencias.'],
      ['resumen', 'snapshot', null, snapshotJson],
    ];
    for (const [category, criterionName, score, comments] of rows) {
      await manager.query(
        `INSERT INTO evaluation_criteria (evaluation_id, category, criterion_name, score, comments)
         VALUES ($1, $2, $3, $4, $5)`,
        [evaluationId, category, criterionName, score, comments],
      );
    }
  }

  private async writeSignatures(
    evaluationId: string,
    signers: EvaluationSignerInput[],
  ): Promise<PreparedSigner[]> {
    const directory = join(this.filesRoot, evaluationId);
    const prepared: PreparedSigner[] = signers.map((signer, index) => ({
      ...signer,
      filePath: signer.signatureData ? `${evaluationId}/${index + 1}.png` : null,
    }));
    try {
      for (const signer of prepared) {
        if (!signer.signatureData || !signer.filePath) continue;
        const file = resolve(this.filesRoot, signer.filePath);
        if (!file.startsWith(`${directory}\\`) && !file.startsWith(`${directory}/`)) {
          throw new BadRequestException('La ruta de la firma no es válida.');
        }
        await mkdir(directory, { recursive: true });
        await writeFile(file, Buffer.from(signer.signatureData.split(',')[1], 'base64'), {
          flag: 'wx',
        });
      }
      return prepared;
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  private async readSignature(filePath: string): Promise<string | null> {
    const file = resolve(this.filesRoot, filePath);
    const root = `${this.filesRoot}\\`;
    if (!file.startsWith(root) && !file.startsWith(`${this.filesRoot}/`)) {
      throw new BadRequestException('La ruta almacenada de la firma no es válida.');
    }
    try {
      const data = await readFile(file);
      return `data:image/png;base64,${data.toString('base64')}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new InternalServerErrorException('No se encontró un archivo de firma registrado.');
      }
      throw error;
    }
  }

}
