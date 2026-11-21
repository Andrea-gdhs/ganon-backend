export interface PerformanceLine {
  expectedDeliveryDate: string;
  firstReceiptDate: string | null;
  orderedQuantity: number | string;
  firstReceiptQuantity: number | string;
  firstItemsMatch: boolean | null;
}

export interface OtifMetrics {
  totalLines: number;
  onTimeLines: number;
  delayedLines: number;
  initialFullLines: number;
  onTimeRate: number | null;
  inFullRate: number | null;
  otif: number | null;
  itemVerificationPending: number;
}

export interface ManualEvaluationInputs {
  openQualityCases: number | null;
  closedQualityCases: number | null;
  billingIncidents: number | null;
  returnIncidents: number | null;
  criticalityLevel: string | null;
}

export interface ManualEvaluationResults {
  totalQualityCases: number | null;
  qualityPenalty: number | null;
  billingPenalty: number | null;
  returnPenalty: number | null;
  totalIncidents: number | null;
  incidentPercentage: number | null;
  finalScore: number | null;
  classification: string | null;
  recommendation: string | null;
}

function numericValue(value: number | string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function calculateManualEvaluation(
  otif: number | null,
  inputs: ManualEvaluationInputs,
): ManualEvaluationResults {
  const totalQualityCases =
    inputs.openQualityCases === null || inputs.closedQualityCases === null
      ? null
      : inputs.openQualityCases + inputs.closedQualityCases;
  const qualityPenalty = totalQualityCases === null ? null : totalQualityCases * 5;
  const billingPenalty =
    inputs.billingIncidents === null ? null : inputs.billingIncidents * 2;
  const returnPenalty =
    inputs.returnIncidents === null ? null : inputs.returnIncidents * 10;
  const totalIncidents =
    inputs.billingIncidents === null || inputs.returnIncidents === null
      ? null
      : inputs.billingIncidents + inputs.returnIncidents;
  const incidentPercentage =
    qualityPenalty === null || billingPenalty === null || returnPenalty === null
      ? null
      : 100 - qualityPenalty - billingPenalty - returnPenalty;
  const rawScore =
    otif === null || incidentPercentage === null
      ? null
      : otif * 0.6 + (incidentPercentage / 100) * 0.4;
  const finalScore =
    rawScore === null ? null : Math.round(rawScore * 10) / 10 * 100;
  const classification =
    finalScore === null
      ? null
      : finalScore >= 85
        ? 'Confiable'
        : finalScore >= 75
          ? 'Con Riesgo'
          : 'No Confiable';
  const recommendation =
    finalScore === null
      ? null
      : finalScore >= 85
        ? 'No aplica'
        : finalScore >= 75
          ? 'Solicitar plan de mejora'
          : 'Suspensión temporal + revisión';

  return {
    totalQualityCases,
    qualityPenalty,
    billingPenalty,
    returnPenalty,
    totalIncidents,
    incidentPercentage,
    finalScore,
    classification,
    recommendation,
  };
}

export function calculateOtifMetrics(lines: PerformanceLine[]): OtifMetrics {
  let onTimeLines = 0;
  let initialFullLines = 0;
  let itemVerificationPending = 0;

  for (const line of lines) {
    const orderedQuantity = numericValue(line.orderedQuantity);
    const firstReceiptQuantity = numericValue(line.firstReceiptQuantity);
    const receivedOnTime =
      line.firstReceiptDate !== null &&
      line.firstReceiptDate <= line.expectedDeliveryDate;

    if (receivedOnTime) onTimeLines++;

    if (firstReceiptQuantity >= orderedQuantity && orderedQuantity > 0) {
      if (line.firstItemsMatch === true) initialFullLines++;
      if (line.firstItemsMatch === null) itemVerificationPending++;
    }
  }

  const totalLines = lines.length;
  const onTimeRate = totalLines > 0 ? onTimeLines / totalLines : null;
  const inFullRate =
    totalLines > 0 && itemVerificationPending === 0
      ? initialFullLines / totalLines
      : null;
  const otif =
    onTimeRate !== null && inFullRate !== null
      ? (onTimeRate + inFullRate) / 2
      : null;

  return {
    totalLines,
    onTimeLines,
    delayedLines: totalLines - onTimeLines,
    initialFullLines,
    onTimeRate,
    inFullRate,
    otif,
    itemVerificationPending,
  };
}
