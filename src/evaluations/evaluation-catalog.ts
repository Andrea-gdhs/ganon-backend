export interface CommitmentOption {
  category: 'Operativos' | 'Administrativos' | 'Estratégicos';
  title: string;
}

export const COMMITMENT_CATALOG: readonly CommitmentOption[] = [
  { category: 'Operativos', title: 'Entrega a tiempo (On Time)' },
  { category: 'Operativos', title: 'Entrega completa (In Full)' },
  { category: 'Operativos', title: 'Mejora en calidad del producto' },
  { category: 'Operativos', title: 'Reducción de incidencias operativas' },
  { category: 'Operativos', title: 'Mejora en empaque y embalaje' },
  { category: 'Operativos', title: 'Cumplimiento de especificaciones técnicas' },
  { category: 'Operativos', title: 'Mejora en documentación de entrega' },
  { category: 'Operativos', title: 'Optimización del proceso logístico' },
  { category: 'Operativos', title: 'Reducción de reincidencias' },
  { category: 'Operativos', title: 'Mejora en preparación / armado de pedidos' },
  { category: 'Administrativos', title: 'Corrección de errores de facturación' },
  { category: 'Administrativos', title: 'Revisión de procesos administrativos' },
  { category: 'Administrativos', title: 'Confirmación oportuna de órdenes de compra' },
  { category: 'Administrativos', title: 'Mejora en tiempos de respuesta ante incidencias' },
  { category: 'Administrativos', title: 'Cumplimiento de acuerdos comerciales' },
  { category: 'Administrativos', title: 'Actualización de datos fiscales / bancarios' },
  {
    category: 'Administrativos',
    title: 'Gestión adecuada de documentos (OC, facturas, etiquetas, guías)',
  },
  {
    category: 'Administrativos',
    title: 'Implementación de controles administrativos internos',
  },
  { category: 'Administrativos', title: 'Puntualidad en entrega de documentación' },
  { category: 'Estratégicos', title: 'Disponibilidad de inventario (stock, abasto)' },
  { category: 'Estratégicos', title: 'Actualización de precios / listas de precios' },
  { category: 'Estratégicos', title: 'Desarrollo de productos o surtido' },
  { category: 'Estratégicos', title: 'Cumplimiento de certificaciones / validaciones' },
  { category: 'Estratégicos', title: 'Rediseño / mejora de producto' },
  { category: 'Estratégicos', title: 'Alineación estratégica de catálogo' },
  { category: 'Estratégicos', title: 'Plan de mejora integral' },
  { category: 'Estratégicos', title: 'Capacitación interna del proveedor' },
  { category: 'Estratégicos', title: 'Compromiso para soportar crecimiento de demanda' },
  { category: 'Estratégicos', title: 'Mejora en controles internos del proveedor' },
];

export function getCommitmentOption(title: string): CommitmentOption | undefined {
  return COMMITMENT_CATALOG.find((item) => item.title === title);
}
