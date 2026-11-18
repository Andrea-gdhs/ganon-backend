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

function numericValue(value: number | string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
