import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import type {
  EnqueueInventoryAiJobInput,
  InventoryAiPipelineSummary,
  InventoryAiJobStatus,
} from './types';
import { INVENTORY_AI_JOB_DEFAULT_MAX_ATTEMPTS } from './constants';

const ACTIVE_JOB_STATUSES: InventoryAiJobStatus[] = ['queued', 'retry_scheduled', 'running'];

function toStatus(value: unknown): InventoryAiJobStatus {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'running') return 'running';
  if (normalized === 'retry_scheduled') return 'retry_scheduled';
  if (normalized === 'completed') return 'completed';
  if (normalized === 'failed') return 'failed';
  if (normalized === 'cancelled') return 'cancelled';
  return 'queued';
}

function parseErrorMessage(error: unknown): string {
  if (!error) return 'unknown_error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function getJobById(jobId: string) {
  return prisma.inventoryAiJob.findUnique({ where: { id: jobId } });
}

async function getJobByIdempotencyKey(idempotencyKey: string) {
  return prisma.inventoryAiJob.findUnique({ where: { idempotencyKey } });
}

async function enqueueInventoryAiJob(input: EnqueueInventoryAiJobInput) {
  const data: Prisma.InventoryAiJobCreateInput = {
    jobType: input.jobType,
    status: 'queued',
    payload: (input.payload || {}) as Prisma.InputJsonValue,
    idempotencyKey: input.idempotencyKey,
    attempts: 0,
    maxAttempts: Math.max(1, Number(input.maxAttempts || INVENTORY_AI_JOB_DEFAULT_MAX_ATTEMPTS)),
    scheduledAt: input.scheduledAt || new Date(),
    asset: {
      connect: { customId: input.assetId },
    },
    parentJob: input.parentJobId ? { connect: { id: input.parentJobId } } : undefined,
  };

  try {
    const row = await prisma.inventoryAiJob.create({ data });
    return { row, inserted: true };
  } catch (error: any) {
    if (String(error?.code || '') === 'P2002') {
      const existing = await getJobByIdempotencyKey(input.idempotencyKey);
      if (existing) return { row: existing, inserted: false };
    }
    throw error;
  }
}

async function claimJobRunning(jobId: string) {
  const updated = await prisma.inventoryAiJob.updateMany({
    where: {
      id: jobId,
      status: { in: ['queued', 'retry_scheduled'] },
      scheduledAt: { lte: new Date() },
    },
    data: {
      status: 'running',
      attempts: { increment: 1 },
      startedAt: new Date(),
      lastError: null,
    },
  });

  if (updated.count === 0) return null;
  return getJobById(jobId);
}

async function markJobCompleted(jobId: string) {
  return prisma.inventoryAiJob.update({
    where: { id: jobId },
    data: {
      status: 'completed',
      completedAt: new Date(),
      failedAt: null,
      lastError: null,
    },
  });
}

async function markJobRetryScheduled(jobId: string, nextSchedule: Date, error: unknown) {
  return prisma.inventoryAiJob.update({
    where: { id: jobId },
    data: {
      status: 'retry_scheduled',
      scheduledAt: nextSchedule,
      lastError: parseErrorMessage(error),
    },
  });
}

async function markJobFailed(jobId: string, error: unknown) {
  return prisma.inventoryAiJob.update({
    where: { id: jobId },
    data: {
      status: 'failed',
      failedAt: new Date(),
      lastError: parseErrorMessage(error),
    },
  });
}

async function getQueuedJobsReady(limit = 100) {
  return prisma.inventoryAiJob.findMany({
    where: {
      status: { in: ['queued', 'retry_scheduled'] },
      scheduledAt: { lte: new Date() },
    },
    orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
    take: Math.max(1, Math.min(limit, 1000)),
  });
}

async function getAssetJobs(assetId: string, limit = 30) {
  return prisma.inventoryAiJob.findMany({
    where: { assetId },
    orderBy: [{ createdAt: 'desc' }],
    take: Math.max(1, Math.min(limit, 200)),
  });
}

async function getAssetPipelineSummary(assetId: string): Promise<InventoryAiPipelineSummary> {
  const rows = await getAssetJobs(assetId, 50);
  const latestByType: InventoryAiPipelineSummary['latestByType'] = {};
  const activeJobs = rows
    .filter((row) => ACTIVE_JOB_STATUSES.includes(toStatus(row.status)))
    .map((row) => ({
      id: row.id,
      jobType: row.jobType,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      scheduledAt: row.scheduledAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      lastError: row.lastError || null,
    }));

  for (const row of rows) {
    if (latestByType[row.jobType]) continue;
    latestByType[row.jobType] = {
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      updatedAt: row.updatedAt.toISOString(),
      lastError: row.lastError || null,
    };
  }

  let pipelineStatus: InventoryAiPipelineSummary['pipelineStatus'] = 'unknown';
  if (activeJobs.length > 0) {
    pipelineStatus = 'processing';
  } else if (rows.some((row) => toStatus(row.status) === 'failed')) {
    pipelineStatus = 'failed';
  } else if (rows.some((row) => toStatus(row.status) === 'completed')) {
    pipelineStatus = 'completed';
  }

  return {
    assetId,
    hasActiveJobs: activeJobs.length > 0,
    pipelineStatus,
    latestByType,
    activeJobs,
  };
}

export {
  enqueueInventoryAiJob,
  claimJobRunning,
  markJobCompleted,
  markJobFailed,
  markJobRetryScheduled,
  getJobById,
  getJobByIdempotencyKey,
  getQueuedJobsReady,
  getAssetJobs,
  getAssetPipelineSummary,
};
