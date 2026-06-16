import { AssetType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import {
  normalizeAssetTypeInput,
  normalizeBrandInput,
  normalizeModelInput,
} from './specDatasetService';

type LookupUserConfirmedSpecsInput = {
  brand?: string;
  model?: string;
  assetType: string;
};

export type UserConfirmedSpecsMatch = {
  specs: Record<string, string>;
  sourceAssetId: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  confidence: number;
  requiresReview: boolean;
  warnings: string[];
};

const NON_RENDERABLE_SPEC_KEYS = new Set([
  'specverificationstatus',
  'specverificationupdatedat',
  'specverificationreviewedby',
  'specverificationreviewedat',
  'specverificationaction',
  'specverificationcorrections',
  'specverificationconfirmedoncreate',
  'aidetectedspecs',
  'aispecfieldconfidence',
  'aispecconfidence',
  'aispecsource',
  'aispeclookupmode',
  'aispecsourceurls',
  'aispecruleversion',
  'aispecvariant',
  'aispecevidencestatus',
  'aispecevidencereason',
  'aispecdetectedat',
  'trackworkinghours',
  'telemetryenabled',
  'workinghours',
  'workinghourssource',
  'operationalstate',
  'operationalstateupdatedat',
  'telemetrystatus',
  'telemetryconfidence',
  'telemetryreason',
  'lasttelemetryat',
  'brand',
  'model',
  'version',
]);

function normalizeToken(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function toBoolean(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return value === true || ['true', '1', 'yes', 'on'].includes(normalized);
}

function mapNormalizedAssetTypeToEnum(assetType: string): AssetType | null {
  const normalized = normalizeAssetTypeInput(assetType);
  const map: Record<string, AssetType> = {
    laptop: 'LAPTOP',
    desktop: 'DESKTOP',
    monitor: 'MONITOR',
    server: 'SERVER',
    tablet: 'TABLET',
    peripheral: 'PERIPHERAL',
    projector: 'PROJECTOR',
    smartboard: 'SMARTBOARD',
    camera: 'CAMERA',
    microphone: 'MICROPHONE',
    speaker: 'SPEAKER',
    router: 'ROUTER',
    switch: 'SWITCH',
    access_point: 'ACCESS_POINT',
    firewall: 'FIREWALL',
    printer: 'PRINTER',
    scanner: 'SCANNER',
    desk: 'DESK',
    chair: 'CHAIR',
    filing_cabinet: 'FILING_CABINET',
    whiteboard: 'WHITEBOARD',
    microscope: 'MICROSCOPE',
    centrifuge: 'CENTRIFUGE',
    oscilloscope: 'OSCILLOSCOPE',
    '3d_printer': 'THREE_D_PRINTER',
    vehicle: 'VEHICLE',
    generator: 'GENERATOR',
    hvac: 'HVAC',
    maintenance_tool: 'MAINTENANCE_TOOL',
  };
  return map[normalized] || null;
}

function extractRenderableSpecs(specs: Record<string, unknown>): Record<string, string> {
  const renderable: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(specs || {})) {
    const normalizedKey = normalizeToken(key);
    if (!normalizedKey || NON_RENDERABLE_SPEC_KEYS.has(normalizedKey)) continue;
    if (rawValue === null || rawValue === undefined) continue;
    if (typeof rawValue === 'object') continue;
    const value = String(rawValue).trim();
    if (!value) continue;
    renderable[key] = value;
  }
  return renderable;
}

function isStrongExactMatch(inputBrandNorm: string, inputModelNorm: string, specs: Record<string, unknown>): boolean {
  const candidateBrand = String(specs.brand || specs.Brand || '').trim();
  const candidateModel = String(specs.version || specs.Version || specs.model || specs.Model || '').trim();
  if (!candidateBrand || !candidateModel) return false;
  const candidateBrandNorm = normalizeBrandInput(candidateBrand, candidateModel);
  const candidateModelNorm = normalizeModelInput(candidateModel);
  return Boolean(
    inputBrandNorm
    && inputModelNorm
    && candidateBrandNorm
    && candidateModelNorm
    && inputBrandNorm === candidateBrandNorm
    && inputModelNorm === candidateModelNorm,
  );
}

function isUserConfirmedSpecs(specs: Record<string, unknown>): boolean {
  const status = String(specs.specVerificationStatus || '').trim().toLowerCase();
  const action = String(specs.specVerificationAction || '').trim().toLowerCase();
  return (
    toBoolean(specs.specVerificationConfirmedOnCreate)
    || action === 'confirmed_on_create'
    || ((status === 'verified' || status === 'corrected') && String(specs.specVerificationReviewedBy || '').trim().length > 0)
  );
}

function parseReviewConfidence(specs: Record<string, unknown>): { confidence: number; requiresReview: boolean } {
  const status = String(specs.specVerificationStatus || '').trim().toLowerCase();
  const confirmedOnCreate = toBoolean(specs.specVerificationConfirmedOnCreate);
  const reviewedBy = String(specs.specVerificationReviewedBy || '').trim();
  if (confirmedOnCreate && reviewedBy) return { confidence: 0.88, requiresReview: false };
  if ((status === 'verified' || status === 'corrected') && reviewedBy) return { confidence: 0.82, requiresReview: false };
  return { confidence: 0.75, requiresReview: true };
}

async function lookupUserConfirmedSpecs(input: LookupUserConfirmedSpecsInput): Promise<UserConfirmedSpecsMatch | null> {
  const normalizedType = normalizeAssetTypeInput(input.assetType);
  const inputBrandNorm = normalizeBrandInput(input.brand, input.model);
  const inputModelNorm = normalizeModelInput(input.model);
  const typeEnum = mapNormalizedAssetTypeToEnum(normalizedType);
  if (!typeEnum || !inputBrandNorm || !inputModelNorm) return null;

  const candidates = await prisma.asset.findMany({
    where: { type: typeEnum },
    orderBy: [{ updatedAt: 'desc' }],
    take: 250,
    select: {
      customId: true,
      specifications: true,
      updatedAt: true,
    },
  });

  for (const candidate of candidates) {
    const specs = (candidate.specifications && typeof candidate.specifications === 'object')
      ? (candidate.specifications as Record<string, unknown>)
      : {};
    if (!isUserConfirmedSpecs(specs)) continue;
    if (!isStrongExactMatch(inputBrandNorm, inputModelNorm, specs)) continue;

    const renderable = extractRenderableSpecs(specs);
    if (!Object.keys(renderable).length) continue;
    const reviewedBy = String(specs.specVerificationReviewedBy || '').trim() || null;
    const reviewedAt = String(specs.specVerificationReviewedAt || '').trim() || null;
    const confidence = parseReviewConfidence(specs);

    return {
      specs: renderable,
      sourceAssetId: candidate.customId,
      reviewedBy,
      reviewedAt,
      confidence: confidence.confidence,
      requiresReview: confidence.requiresReview,
      warnings: reviewedBy
        ? []
        : ['Reused from previously confirmed specs, but reviewer metadata is missing.'],
    };
  }

  return null;
}

export {
  lookupUserConfirmedSpecs,
};
