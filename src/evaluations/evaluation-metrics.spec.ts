import {
  calculateManualEvaluation,
  calculateOtifMetrics,
  ManualEvaluationInputs,
  PerformanceLine,
} from './evaluation-metrics';

describe('calculateOtifMetrics', () => {
  it('averages line-based On Time and In Full rates', () => {
    const lines: PerformanceLine[] = [
      {
        expectedDeliveryDate: '2026-03-10',
        firstReceiptDate: '2026-03-09',
        orderedQuantity: 10,
        firstReceiptQuantity: 10,
        firstItemsMatch: true,
      },
      {
        expectedDeliveryDate: '2026-03-12',
        firstReceiptDate: '2026-03-14',
        orderedQuantity: 5,
        firstReceiptQuantity: 5,
        firstItemsMatch: true,
      },
    ];

    expect(calculateOtifMetrics(lines)).toMatchObject({
      totalLines: 2,
      onTimeLines: 1,
      delayedLines: 1,
      initialFullLines: 2,
      onTimeRate: 0.5,
      inFullRate: 1,
      otif: 0.75,
    });

  });

  it('does not publish In Full or OTIF when received item identity is unknown', () => {
    const metrics = calculateOtifMetrics([
      {
        expectedDeliveryDate: '2026-03-10',
        firstReceiptDate: '2026-03-10',
        orderedQuantity: 4,
        firstReceiptQuantity: 4,
        firstItemsMatch: null,
      },
    ]);

    expect(metrics.inFullRate).toBeNull();
    expect(metrics.otif).toBeNull();
    expect(metrics.itemVerificationPending).toBe(1);
  });

  it('does not count a fully received but mismatched item as In Full', () => {
    const metrics = calculateOtifMetrics([
      {
        expectedDeliveryDate: '2026-03-10',
        firstReceiptDate: '2026-03-10',
        orderedQuantity: 4,
        firstReceiptQuantity: 4,
        firstItemsMatch: false,
      },
    ]);

    expect(metrics.inFullRate).toBe(0);
    expect(metrics.otif).toBe(0.5);
  });

  it('returns null rates when the period contains no eligible lines', () => {
    expect(calculateOtifMetrics([])).toMatchObject({
      totalLines: 0,
      onTimeRate: null,
      inFullRate: null,
      otif: null,
    });
  });
});

describe('calculateManualEvaluation', () => {
  it('matches the example workbook penalty and rounded total', () => {
    const inputs: ManualEvaluationInputs = {
      openQualityCases: 0,
      closedQualityCases: 0,
      billingIncidents: 3,
      returnIncidents: 3,
      criticalityLevel: 'Alto',
    };

    expect(calculateManualEvaluation(0.94, inputs)).toMatchObject({
      totalQualityCases: 0,
      qualityPenalty: 0,
      billingPenalty: 6,
      returnPenalty: 30,
      totalIncidents: 6,
      incidentPercentage: 64,
      finalScore: 80,
      classification: 'Con Riesgo',
      recommendation: 'Solicitar plan de mejora',
    });
  });

  it('keeps the final score pending until all manual sources and OTIF are available', () => {
    expect(
      calculateManualEvaluation(0.94, {
        openQualityCases: 0,
        closedQualityCases: null,
        billingIncidents: 0,
        returnIncidents: 0,
        criticalityLevel: null,
      }).finalScore,
    ).toBeNull();
    expect(
      calculateManualEvaluation(null, {
        openQualityCases: 0,
        closedQualityCases: 0,
        billingIncidents: 0,
        returnIncidents: 0,
        criticalityLevel: null,
      }).finalScore,
    ).toBeNull();
  });
});
