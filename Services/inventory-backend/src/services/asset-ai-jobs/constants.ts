import { INVENTORY_AI_JOB_TYPES, type InventoryAiJobType } from './types';

export const INVENTORY_AI_JOBS_EXCHANGE =
  process.env.INVENTORY_AI_JOBS_EXCHANGE
  || process.env.EVENTS_EXCHANGE_NAME
  || 'opsmind.events';

export const INVENTORY_AI_JOB_RETRY_DELAYS_MS = [
  Number(process.env.INVENTORY_AI_JOB_RETRY_1_MS || 30_000),
  Number(process.env.INVENTORY_AI_JOB_RETRY_2_MS || 5 * 60_000),
  Number(process.env.INVENTORY_AI_JOB_RETRY_3_MS || 30 * 60_000),
].map((value) => Math.max(1_000, Number.isFinite(value) ? value : 30_000));

export const INVENTORY_AI_JOB_DEFAULT_MAX_ATTEMPTS = Math.max(
  INVENTORY_AI_JOB_RETRY_DELAYS_MS.length + 1,
  Number(process.env.INVENTORY_AI_JOB_MAX_ATTEMPTS || 4),
);

export const INVENTORY_AI_JOB_CONSUMER_PREFETCH = Math.max(
  1,
  Number(process.env.INVENTORY_AI_JOB_CONSUMER_PREFETCH || 4),
);

export const INVENTORY_AI_JOB_RECOVERY_INTERVAL_MS = Math.max(
  5_000,
  Number(process.env.INVENTORY_AI_JOB_RECOVERY_INTERVAL_MS || 30_000),
);

export const INVENTORY_AI_BACKEND_BASE_URL =
  process.env.INVENTORY_BACKEND_INTERNAL_URL
  || process.env.INVENTORY_BACKEND_URL
  || 'http://inventory-backend:5000';

export function getInventoryAiJobQueueName(jobType: InventoryAiJobType): string {
  return `${jobType}.q`;
}

export function getInventoryAiJobRetryQueueName(jobType: InventoryAiJobType, retryLevel: number): string {
  return `${jobType}.retry.${retryLevel}.q`;
}

export function getInventoryAiJobDlqName(jobType: InventoryAiJobType): string {
  return `${jobType}.dlq.q`;
}

export function getInventoryAiJobRetryRoutingKey(jobType: InventoryAiJobType, retryLevel: number): string {
  return `${jobType}.retry.${retryLevel}`;
}

export function getInventoryAiJobDlqRoutingKey(jobType: InventoryAiJobType): string {
  return `${jobType}.dlq`;
}

export function isInventoryAiJobType(value: unknown): value is InventoryAiJobType {
  return INVENTORY_AI_JOB_TYPES.includes(String(value || '') as InventoryAiJobType);
}
