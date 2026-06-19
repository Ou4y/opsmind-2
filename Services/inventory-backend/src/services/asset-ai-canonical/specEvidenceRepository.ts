import { prisma } from '../../lib/prisma';
import { sha256 } from './hash';

type SpecEvidenceStatus = 'trusted' | 'insufficient_source_evidence' | 'llm_or_heuristic_only';
type VerificationStatus = 'pending' | 'verified' | 'corrected' | 'rejected' | 'needs_review';

export type PersistSpecSnapshotInput = {
  assetId: string;
  specifications: Record<string, any>;
  context: string;
  reviewer?: string | null;
  reviewedAt?: Date | null;
};

function normalizeVerificationStatus(rawStatus: unknown): VerificationStatus {
  const normalized = String(rawStatus || '').trim().toLowerCase();
  if (normalized === 'verified') return 'verified';
  if (normalized === 'corrected') return 'corrected';
  if (normalized === 'rejected') return 'rejected';
  if (normalized === 'needs_review') return 'needs_review';
  return 'pending';
}

function normalizeEvidenceStatus(rawStatus: unknown): SpecEvidenceStatus {
  const normalized = String(rawStatus || '').trim().toLowerCase();
  if (normalized === 'trusted') return 'trusted';
  if (normalized === 'llm_or_heuristic_only') return 'llm_or_heuristic_only';
  return 'insufficient_source_evidence';
}

function selectNormalizedSpecs(specs: Record<string, any>): Record<string, any> {
  const corrected = specs.specVerificationCorrections;
  const aiDetected = specs.aiDetectedSpecs;
  if (corrected && typeof corrected === 'object' && Object.keys(corrected).length > 0) return corrected;
  if (aiDetected && typeof aiDetected === 'object' && Object.keys(aiDetected).length > 0) return aiDetected;
  return specs;
}

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const values = raw
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return Array.from(new Set(values));
}

function sourceDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function parseConfidence(raw: unknown): number | null {
  const confidence = Number(raw);
  if (!Number.isFinite(confidence)) return null;
  return Math.min(1, Math.max(0, confidence));
}

export async function getLatestSpecSnapshot(assetId: string) {
  return prisma.assetSpecSnapshot.findFirst({
    where: { assetId },
    orderBy: [{ createdAt: 'desc' }],
    include: {
      evidenceRows: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });
}

export async function persistSpecSnapshot(input: PersistSpecSnapshotInput) {
  const specs = input.specifications || {};
  const normalizedSpecs = selectNormalizedSpecs(specs);
  const sourceUrls = asStringArray(specs.aiSpecSourceUrls);
  const sourceUrlsHash = sha256(sourceUrls.sort());
  const snapshotHash = sha256({
    normalizedSpecs,
    lookupMode: specs.aiSpecLookupMode || 'unknown',
    verificationStatus: normalizeVerificationStatus(specs.specVerificationStatus),
    evidenceStatus: normalizeEvidenceStatus(specs.aiSpecEvidenceStatus),
    sourceUrlsHash,
    context: input.context,
  });

  const existing = await prisma.assetSpecSnapshot.findFirst({
    where: {
      assetId: input.assetId,
      snapshotHash,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    if (input.reviewer || input.reviewedAt) {
      await prisma.assetSpecSnapshot.update({
        where: { id: existing.id },
        data: {
          reviewedBy: input.reviewer ?? existing.reviewedBy,
          reviewedAt: input.reviewedAt ?? existing.reviewedAt,
          verificationStatus: normalizeVerificationStatus(specs.specVerificationStatus),
          evidenceStatus: normalizeEvidenceStatus(specs.aiSpecEvidenceStatus),
          evidenceReason: specs.aiSpecEvidenceReason ? String(specs.aiSpecEvidenceReason) : existing.evidenceReason,
        },
      });
    }
    return { snapshotId: existing.id, inserted: false, evidenceRowsInserted: 0 };
  }

  const snapshot = await prisma.assetSpecSnapshot.create({
    data: {
      assetId: input.assetId,
      normalizedSpecs,
      lookupMode: String(specs.aiSpecLookupMode || 'unknown'),
      verificationStatus: normalizeVerificationStatus(specs.specVerificationStatus),
      confidence: parseConfidence(specs.aiSpecConfidence),
      evidenceStatus: normalizeEvidenceStatus(specs.aiSpecEvidenceStatus),
      evidenceReason: specs.aiSpecEvidenceReason ? String(specs.aiSpecEvidenceReason) : null,
      provider: specs.aiSpecSource ? String(specs.aiSpecSource) : 'inventory-ai-spec-inference',
      ruleVersion: specs.aiSpecRuleVersion ? String(specs.aiSpecRuleVersion) : null,
      variant: specs.aiSpecVariant ? String(specs.aiSpecVariant) : null,
      snapshotHash,
      reviewedBy: input.reviewer ?? null,
      reviewedAt: input.reviewedAt ?? null,
    },
  });

  const fieldConfidence = (specs.aiSpecFieldConfidence && typeof specs.aiSpecFieldConfidence === 'object')
    ? specs.aiSpecFieldConfidence
    : {};
  const evidenceRows = sourceUrls.map((url) => ({
    snapshotId: snapshot.id,
    assetId: input.assetId,
    provider: specs.aiSpecSource ? String(specs.aiSpecSource) : 'inventory-ai-spec-inference',
    sourceUrl: url,
    sourceDomain: sourceDomain(url),
    fetchedAt: specs.aiSpecDetectedAt ? new Date(String(specs.aiSpecDetectedAt)) : null,
    contentHash: sha256({ url, normalizedSpecs }),
    extractedFields: fieldConfidence,
    sourceConfidence: parseConfidence(specs.aiSpecConfidence),
    isTrusted: normalizeEvidenceStatus(specs.aiSpecEvidenceStatus) === 'trusted',
  }));

  if (evidenceRows.length > 0) {
    await prisma.assetSpecEvidence.createMany({
      data: evidenceRows,
      skipDuplicates: false,
    });
  }

  return {
    snapshotId: snapshot.id,
    inserted: true,
    evidenceRowsInserted: evidenceRows.length,
  };
}

