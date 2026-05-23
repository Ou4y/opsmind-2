import AssetService from '../../models/Assets';
import { persistSpecSnapshot, persistTelemetrySample } from '../asset-ai-canonical';
import { INVENTORY_AI_BACKEND_BASE_URL } from './constants';
import { enqueueChainedJob } from './orchestrator';
import type { InventoryAiJobMessage, InventoryAiJobPayload, InventoryAiJobType } from './types';

function toBoolean(value: unknown): boolean {
  return value === true || String(value || '').trim().toLowerCase() === 'true';
}

function parsePayload(payload: unknown): InventoryAiJobPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  return payload as InventoryAiJobPayload;
}

async function callInternalBackend(path: string, body: Record<string, unknown> = {}) {
  const token = String(process.env.INTERNAL_API_TOKEN || '').trim();
  const response = await fetch(`${INVENTORY_AI_BACKEND_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-internal-token': token } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`internal backend call failed ${path} status=${response.status} body=${text.slice(0, 400)}`);
  }

  return response.json().catch(() => ({}));
}

async function handleAssetCreatedJob(message: InventoryAiJobMessage) {
  const asset = await AssetService.getAssetByCustomId(message.assetId);
  if (!asset) return { outcome: 'asset_not_found' as const };

  const specs = ((asset.specifications as Record<string, unknown>) || {});
  const payload = parsePayload(message.payload);
  const confirmedOnCreate = Boolean(payload.specConfirmationReviewed);
  const reviewer = confirmedOnCreate
    ? String(payload.specConfirmationReviewedBy || specs.specVerificationReviewedBy || 'asset_creator').trim()
    : null;
  const reviewedAtRaw = confirmedOnCreate ? String(specs.specVerificationReviewedAt || '').trim() : '';
  const reviewedAt = reviewedAtRaw ? new Date(reviewedAtRaw) : null;
  const safeReviewedAt = reviewedAt && !Number.isNaN(reviewedAt.getTime()) ? reviewedAt : null;

  try {
    await persistSpecSnapshot({
      assetId: message.assetId,
      specifications: specs,
      context: 'asset_create_background_seed',
      reviewer,
      reviewedAt: safeReviewedAt,
    });
  } catch (error: any) {
    console.warn(`[InventoryAIJobs] canonical spec snapshot seed failed for ${message.assetId}: ${error?.message || error}`);
  }

  try {
    const telemetryEnabled = (
      toBoolean(specs.trackWorkingHours)
      || toBoolean(specs.telemetryEnabled)
    );

    if (telemetryEnabled) {
      const observedAtRaw = String(specs.operationalStateUpdatedAt || new Date().toISOString());
      const observedAt = new Date(observedAtRaw);
      const timestamp = Number.isNaN(observedAt.getTime()) ? new Date() : observedAt;
      await persistTelemetrySample({
        assetId: message.assetId,
        observedAt: timestamp,
        telemetrySource: 'manual_toggle',
        rawSignals: {
          telemetryEnabled: true,
          liveSignalReceived: false,
        },
        derivedStatus: 'insufficient_data',
        confidence: 0.25,
        reason: 'Telemetry monitoring enabled, but no live signal has been received yet.',
        activeHours: null,
        idleHours: null,
        offlineHours: null,
        utilization: null,
        consumptionScore: null,
        qualityImpactScore: null,
      });
    }
  } catch (error: any) {
    console.warn(`[InventoryAIJobs] canonical telemetry seed failed for ${message.assetId}: ${error?.message || error}`);
  }

  await enqueueChainedJob({
    parentJobId: message.jobId,
    jobType: 'inventory.ai.spec_refresh',
    assetId: message.assetId,
    payload: {
      trigger: 'asset_created',
      requestId: String(payload.requestId || ''),
      specConfirmationReviewed: Boolean(payload.specConfirmationReviewed),
      specConfirmationReviewedBy: String(payload.specConfirmationReviewedBy || ''),
    },
  });

  await enqueueChainedJob({
    parentJobId: message.jobId,
    jobType: 'inventory.ai.lifespan_prediction',
    assetId: message.assetId,
    payload: {
      trigger: 'asset_created',
      requestId: String(payload.requestId || ''),
    },
  });

  return { outcome: 'queued_followups' as const };
}

async function handleSpecRefreshJob(message: InventoryAiJobMessage) {
  const payload = parsePayload(message.payload);
  await callInternalBackend(`/internal/inventory-ai/assets/${encodeURIComponent(message.assetId)}/spec-refresh`, {
    trigger: String(payload.trigger || 'asset_created'),
    specConfirmationReviewed: Boolean(payload.specConfirmationReviewed),
    specConfirmationReviewedBy: String(payload.specConfirmationReviewedBy || ''),
    requestId: String(payload.requestId || ''),
  });

  await enqueueChainedJob({
    parentJobId: message.jobId,
    jobType: 'inventory.ai.lifespan_prediction',
    assetId: message.assetId,
    payload: {
      trigger: 'spec_refresh',
      requestId: String(payload.requestId || ''),
    },
    dedupeKeySuffix: 'after_spec_refresh',
  });

  return { outcome: 'spec_refreshed' as const };
}

async function handleLifespanJob(message: InventoryAiJobMessage) {
  const payload = parsePayload(message.payload);
  await callInternalBackend(`/internal/inventory-ai/assets/${encodeURIComponent(message.assetId)}/lifespan-refresh`, {
    trigger: String(payload.trigger || 'background_job'),
    requestId: String(payload.requestId || ''),
  });

  await enqueueChainedJob({
    parentJobId: message.jobId,
    jobType: 'inventory.ai.eol_assessment',
    assetId: message.assetId,
    payload: {
      trigger: 'lifespan_prediction',
      requestId: String(payload.requestId || ''),
    },
  });

  return { outcome: 'lifespan_refreshed' as const };
}

async function handleEolAssessmentJob(message: InventoryAiJobMessage) {
  const payload = parsePayload(message.payload);
  const assessment = await callInternalBackend(`/internal/inventory-ai/assets/${encodeURIComponent(message.assetId)}/eol-refresh`, {
    trigger: String(payload.trigger || 'background_job'),
    requestId: String(payload.requestId || ''),
  });

  if (assessment && toBoolean(assessment.procurementRecommended)) {
    await enqueueChainedJob({
      parentJobId: message.jobId,
      jobType: 'inventory.ai.procurement_refresh',
      assetId: message.assetId,
      payload: {
        trigger: 'eol_assessment',
        requestId: String(payload.requestId || ''),
      },
    });
  }

  return { outcome: 'eol_refreshed' as const };
}

async function handleProcurementRefreshJob(message: InventoryAiJobMessage) {
  const payload = parsePayload(message.payload);
  await callInternalBackend(`/internal/inventory-ai/assets/${encodeURIComponent(message.assetId)}/procurement-refresh`, {
    trigger: String(payload.trigger || 'background_job'),
    requestId: String(payload.requestId || ''),
  });
  return { outcome: 'procurement_refreshed' as const };
}

async function handleTelemetryRollupJob(_message: InventoryAiJobMessage) {
  // Phase 5 foundation only: telemetry rollup queue contract is active, integration is deferred.
  return { outcome: 'telemetry_rollup_deferred' as const };
}

const InventoryAiJobHandlers: Record<InventoryAiJobType, (message: InventoryAiJobMessage) => Promise<{ outcome: string }>> = {
  'inventory.ai.asset_created': handleAssetCreatedJob,
  'inventory.ai.spec_refresh': handleSpecRefreshJob,
  'inventory.ai.lifespan_prediction': handleLifespanJob,
  'inventory.ai.eol_assessment': handleEolAssessmentJob,
  'inventory.ai.procurement_refresh': handleProcurementRefreshJob,
  'inventory.ai.telemetry_rollup': handleTelemetryRollupJob,
};

export { InventoryAiJobHandlers };
