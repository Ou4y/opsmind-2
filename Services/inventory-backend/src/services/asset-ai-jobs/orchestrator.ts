import crypto from 'crypto';
import type { InventoryAiJob } from '@prisma/client';
import {
  INVENTORY_AI_JOB_DEFAULT_MAX_ATTEMPTS,
  INVENTORY_AI_JOB_RETRY_DELAYS_MS,
} from './constants';
import {
  claimJobRunning,
  enqueueInventoryAiJob,
  getAssetPipelineSummary,
  getJobById,
  markJobCompleted,
  markJobFailed,
  markJobRetryScheduled,
} from './jobRepository';
import { InventoryAiJobQueue } from './queue';
import type {
  EnqueueInventoryAiJobInput,
  InventoryAiJobMessage,
  InventoryAiJobPayload,
  InventoryAiJobType,
  InventoryAiPipelineSummary,
} from './types';

function hashKey(parts: Array<string | number | undefined | null>): string {
  const raw = parts.map((part) => String(part ?? '')).join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function serializePayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  return payload as Record<string, unknown>;
}

function toQueueMessage(row: InventoryAiJob): InventoryAiJobMessage {
  return {
    jobId: row.id,
    jobType: row.jobType as InventoryAiJobType,
    assetId: row.assetId,
    idempotencyKey: row.idempotencyKey,
    parentJobId: row.parentJobId,
    attempt: row.attempts,
    maxAttempts: row.maxAttempts,
    payload: serializePayload(row.payload),
    enqueuedAt: row.createdAt.toISOString(),
  };
}

async function enqueueJob(input: EnqueueInventoryAiJobInput) {
  const { row, inserted } = await enqueueInventoryAiJob({
    ...input,
    maxAttempts: input.maxAttempts || INVENTORY_AI_JOB_DEFAULT_MAX_ATTEMPTS,
  });
  const message = toQueueMessage(row);
  if (inserted) {
    await InventoryAiJobQueue.publishJob(input.jobType, message);
  }
  return { row, inserted };
}

async function enqueueInitialAssetCreatedJobs(params: {
  assetId: string;
  trigger?: string;
  requestId?: string;
  specConfirmationReviewed?: boolean;
  specConfirmationReviewedBy?: string;
}) {
  const payload: InventoryAiJobPayload = {
    trigger: params.trigger || 'asset_created',
    requestId: params.requestId,
    specConfirmationReviewed: Boolean(params.specConfirmationReviewed),
    specConfirmationReviewedBy: params.specConfirmationReviewedBy || '',
  };

  const idempotencyKey = hashKey([
    'inventory.ai.asset_created',
    params.assetId,
    payload.trigger,
    payload.requestId || '',
  ]);

  return enqueueJob({
    jobType: 'inventory.ai.asset_created',
    assetId: params.assetId,
    payload,
    idempotencyKey,
  });
}

async function enqueueChainedJob(params: {
  parentJobId: string;
  jobType: InventoryAiJobType;
  assetId: string;
  payload?: InventoryAiJobPayload;
  dedupeKeySuffix?: string;
}) {
  const payload = params.payload || {};
  const idempotencyKey = hashKey([
    params.jobType,
    params.assetId,
    params.parentJobId,
    params.dedupeKeySuffix || '',
  ]);

  return enqueueJob({
    jobType: params.jobType,
    assetId: params.assetId,
    payload,
    idempotencyKey,
    parentJobId: params.parentJobId,
  });
}

function nextRetryLevel(attempts: number): number | null {
  if (attempts <= 0) return 1;
  const level = attempts;
  if (level > INVENTORY_AI_JOB_RETRY_DELAYS_MS.length) return null;
  return level;
}

function nextRetryDate(retryLevel: number): Date {
  const delay = INVENTORY_AI_JOB_RETRY_DELAYS_MS[Math.max(0, retryLevel - 1)] || 30_000;
  return new Date(Date.now() + delay);
}

async function completeJob(jobId: string) {
  await markJobCompleted(jobId);
}

async function failOrRetryJob(jobId: string, error: unknown) {
  const job = await getJobById(jobId);
  if (!job) return { state: 'missing' as const };

  const retryLevel = nextRetryLevel(job.attempts);
  if (retryLevel !== null && job.attempts < job.maxAttempts) {
    const nextSchedule = nextRetryDate(retryLevel);
    await markJobRetryScheduled(jobId, nextSchedule, error);
    const refreshed = await getJobById(jobId);
    if (refreshed) {
      await InventoryAiJobQueue.publishRetry(refreshed.jobType as InventoryAiJobType, retryLevel, toQueueMessage(refreshed));
    }
    return { state: 'retry_scheduled' as const, retryLevel, nextSchedule };
  }

  await markJobFailed(jobId, error);
  const failedRow = await getJobById(jobId);
  if (failedRow) {
    await InventoryAiJobQueue.publishDlq(failedRow.jobType as InventoryAiJobType, toQueueMessage(failedRow));
  }
  return { state: 'failed' as const };
}

async function claimJob(jobId: string) {
  return claimJobRunning(jobId);
}

async function readAssetPipelineSummary(assetId: string): Promise<InventoryAiPipelineSummary> {
  return getAssetPipelineSummary(assetId);
}

export {
  enqueueJob,
  enqueueInitialAssetCreatedJobs,
  enqueueChainedJob,
  claimJob,
  completeJob,
  failOrRetryJob,
  readAssetPipelineSummary,
};
