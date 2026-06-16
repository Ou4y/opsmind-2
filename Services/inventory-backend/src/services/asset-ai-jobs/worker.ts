import { type Channel, type ConsumeMessage } from 'amqplib';
import { INVENTORY_AI_JOB_CONSUMER_PREFETCH, INVENTORY_AI_JOB_RECOVERY_INTERVAL_MS, isInventoryAiJobType } from './constants';
import { InventoryAiJobHandlers } from './handlers';
import { claimJob, completeJob, failOrRetryJob } from './orchestrator';
import { getQueuedJobsReady } from './jobRepository';
import { InventoryAiJobQueue } from './queue';
import { INVENTORY_AI_JOB_TYPES, type InventoryAiJobMessage, type InventoryAiJobType } from './types';

let recoveryTimer: NodeJS.Timeout | null = null;

function normalizePayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  return payload as Record<string, unknown>;
}

function toMessageFromClaimedRow(row: {
  id: string;
  jobType: string;
  assetId: string;
  idempotencyKey: string;
  parentJobId: string | null;
  attempts: number;
  maxAttempts: number;
  payload: unknown;
  createdAt: Date;
}): InventoryAiJobMessage {
  return {
    jobId: row.id,
    jobType: row.jobType as InventoryAiJobType,
    assetId: row.assetId,
    idempotencyKey: row.idempotencyKey,
    parentJobId: row.parentJobId,
    attempt: row.attempts,
    maxAttempts: row.maxAttempts,
    payload: normalizePayload(row.payload),
    enqueuedAt: row.createdAt.toISOString(),
  };
}

async function processJobMessage(message: InventoryAiJobMessage, raw: ConsumeMessage, channel: Channel) {
  const jobType = message.jobType;
  if (!isInventoryAiJobType(jobType)) {
    console.warn(`[InventoryAIJobs] unknown job type in queue: ${String(jobType)}`);
    channel.ack(raw);
    return;
  }

  const claimed = await claimJob(message.jobId);
  if (!claimed) {
    channel.ack(raw);
    return;
  }

  try {
    const runMessage = toMessageFromClaimedRow(claimed);
    const handler = InventoryAiJobHandlers[runMessage.jobType];
    await handler(runMessage);
    await completeJob(runMessage.jobId);
  } catch (error: any) {
    const outcome = await failOrRetryJob(claimed.id, error);
    if (outcome.state === 'retry_scheduled') {
      console.warn(
        `[InventoryAIJobs] retry scheduled for ${claimed.jobType} asset=${claimed.assetId} attempt=${claimed.attempts}/${claimed.maxAttempts}`,
      );
    } else if (outcome.state === 'failed') {
      console.error(
        `[InventoryAIJobs] job failed permanently ${claimed.jobType} asset=${claimed.assetId} attempts=${claimed.attempts}/${claimed.maxAttempts}`,
      );
    }
  } finally {
    channel.ack(raw);
  }
}

async function recoverQueuedInventoryAiJobs() {
  const ready = await getQueuedJobsReady(200);
  if (!ready.length) return;
  for (const row of ready) {
    if (!isInventoryAiJobType(row.jobType)) continue;
    const message = toMessageFromClaimedRow({
      id: row.id,
      jobType: row.jobType,
      assetId: row.assetId,
      idempotencyKey: row.idempotencyKey,
      parentJobId: row.parentJobId,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      payload: row.payload,
      createdAt: row.createdAt,
    });
    await InventoryAiJobQueue.publishJob(row.jobType as InventoryAiJobType, message);
  }
}

async function startInventoryAiJobWorker() {
  await InventoryAiJobQueue.connect();

  await Promise.all(
    INVENTORY_AI_JOB_TYPES.map((jobType) =>
      InventoryAiJobQueue.consume(jobType, INVENTORY_AI_JOB_CONSUMER_PREFETCH, processJobMessage),
    ),
  );

  await recoverQueuedInventoryAiJobs();
  recoveryTimer = setInterval(() => {
    recoverQueuedInventoryAiJobs().catch((error) => {
      console.error(`[InventoryAIJobs] recovery loop failed: ${error?.message || error}`);
    });
  }, INVENTORY_AI_JOB_RECOVERY_INTERVAL_MS);
}

async function stopInventoryAiJobWorker() {
  if (recoveryTimer) {
    clearInterval(recoveryTimer);
    recoveryTimer = null;
  }
  await InventoryAiJobQueue.close();
}

export { startInventoryAiJobWorker, stopInventoryAiJobWorker };
