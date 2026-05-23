import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { sha256 } from './hash';

export type PersistTelemetrySampleInput = {
  assetId: string;
  observedAt: Date;
  telemetrySource: string;
  rawSignals: Record<string, any>;
  derivedStatus: string;
  confidence?: number | null;
  reason?: string | null;
  activeHours?: number | null;
  idleHours?: number | null;
  offlineHours?: number | null;
  utilization?: Record<string, any> | null;
  consumptionScore?: number | null;
  qualityImpactScore?: number | null;
};

function clampConfidence(rawValue: unknown): number | null {
  const confidence = Number(rawValue);
  if (!Number.isFinite(confidence)) return null;
  return Math.min(1, Math.max(0, confidence));
}

function toNullableJson(
  value: Record<string, any> | null | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === null || typeof value === 'undefined') return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}

export async function getLatestTelemetrySample(assetId: string) {
  return prisma.assetTelemetrySample.findFirst({
    where: { assetId },
    orderBy: [{ observedAt: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function persistTelemetrySample(input: PersistTelemetrySampleInput) {
  const observedAt = input.observedAt instanceof Date ? input.observedAt : new Date(input.observedAt);
  const sampleHash = sha256({
    assetId: input.assetId,
    observedAt: observedAt.toISOString(),
    telemetrySource: input.telemetrySource,
    derivedStatus: input.derivedStatus,
    rawSignals: input.rawSignals || {},
  });

  const existing = await prisma.assetTelemetrySample.findFirst({
    where: { assetId: input.assetId, sampleHash },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) {
    return { sampleId: existing.id, inserted: false };
  }

  const row = await prisma.assetTelemetrySample.create({
    data: {
      assetId: input.assetId,
      observedAt,
      telemetrySource: input.telemetrySource || 'inventory-backend-telemetry-endpoint',
      rawSignals: input.rawSignals || {},
      derivedStatus: String(input.derivedStatus || 'unknown'),
      confidence: clampConfidence(input.confidence),
      reason: input.reason ? String(input.reason) : null,
      activeHours: Number.isFinite(Number(input.activeHours)) ? Number(input.activeHours) : null,
      idleHours: Number.isFinite(Number(input.idleHours)) ? Number(input.idleHours) : null,
      offlineHours: Number.isFinite(Number(input.offlineHours)) ? Number(input.offlineHours) : null,
      utilization: toNullableJson(input.utilization),
      consumptionScore: Number.isFinite(Number(input.consumptionScore)) ? Number(input.consumptionScore) : null,
      qualityImpactScore: Number.isFinite(Number(input.qualityImpactScore)) ? Number(input.qualityImpactScore) : null,
      sampleHash,
    },
  });

  return { sampleId: row.id, inserted: true };
}
