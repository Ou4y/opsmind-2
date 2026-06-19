import { prisma } from '../../lib/prisma';

export type PersistEolAssessmentInput = {
  assetId: string;
  status: string;
  predictedEolDate?: string | null;
  monthsRemaining?: number | null;
  confidence: number;
  reason: string;
  evidenceLevel: string;
  predictionSource: string;
  telemetryStatus: string;
  specEvidenceStatus: string;
  suitableForProcurementPlanning: boolean;
  procurementRecommended: boolean;
  procurementWindowMonths?: number | null;
  generatedAt: string;
};

function clampConfidence(rawValue: unknown): number {
  const confidence = Number(rawValue);
  if (!Number.isFinite(confidence)) return 0;
  return Math.min(1, Math.max(0, confidence));
}

function parseOptionalDate(rawValue: string | null | undefined): Date | null {
  if (!rawValue) return null;
  const parsed = new Date(String(rawValue));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function getLatestEolAssessment(assetId: string) {
  return prisma.assetEolAssessment.findFirst({
    where: { assetId },
    orderBy: [{ generatedAt: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function persistEolAssessment(input: PersistEolAssessmentInput) {
  const generatedAt = parseOptionalDate(input.generatedAt) || new Date();
  const assessment = await prisma.assetEolAssessment.create({
    data: {
      assetId: input.assetId,
      status: String(input.status || 'unknown'),
      predictedEolDate: parseOptionalDate(input.predictedEolDate || null),
      monthsRemaining: Number.isFinite(Number(input.monthsRemaining)) ? Number(input.monthsRemaining) : null,
      confidence: clampConfidence(input.confidence),
      reason: String(input.reason || ''),
      evidenceLevel: String(input.evidenceLevel || 'low'),
      predictionSource: String(input.predictionSource || 'insufficient_data'),
      telemetryStatus: String(input.telemetryStatus || 'unknown'),
      specEvidenceStatus: String(input.specEvidenceStatus || 'insufficient_source_evidence'),
      suitableForProcurementPlanning: Boolean(input.suitableForProcurementPlanning),
      procurementRecommended: Boolean(input.procurementRecommended),
      procurementWindowMonths: Number.isFinite(Number(input.procurementWindowMonths))
        ? Number(input.procurementWindowMonths)
        : null,
      generatedAt,
    },
  });

  if (assessment.procurementRecommended) {
    const existingOpen = await prisma.assetProcurementCandidate.findFirst({
      where: {
        assetId: input.assetId,
        candidateStatus: 'open',
        predictedEolDate: assessment.predictedEolDate,
        procurementWindowMonths: assessment.procurementWindowMonths,
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    if (!existingOpen) {
      await prisma.assetProcurementCandidate.create({
        data: {
          assetId: input.assetId,
          eolAssessmentId: assessment.id,
          candidateStatus: 'open',
          predictedEolDate: assessment.predictedEolDate,
          confidence: assessment.confidence,
          reason: assessment.reason,
          procurementWindowMonths: assessment.procurementWindowMonths,
          recommendedAt: generatedAt,
        },
      });
    }
  }

  return assessment;
}

