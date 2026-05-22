export const INVENTORY_AI_JOB_TYPES = [
  'inventory.ai.asset_created',
  'inventory.ai.spec_refresh',
  'inventory.ai.lifespan_prediction',
  'inventory.ai.eol_assessment',
  'inventory.ai.procurement_refresh',
  'inventory.ai.telemetry_rollup',
] as const;

export type InventoryAiJobType = (typeof INVENTORY_AI_JOB_TYPES)[number];

export const INVENTORY_AI_JOB_STATUSES = [
  'queued',
  'running',
  'retry_scheduled',
  'completed',
  'failed',
  'cancelled',
] as const;

export type InventoryAiJobStatus = (typeof INVENTORY_AI_JOB_STATUSES)[number];

export type InventoryAiJobMessage = {
  jobId: string;
  jobType: InventoryAiJobType;
  assetId: string;
  idempotencyKey: string;
  parentJobId?: string | null;
  attempt: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
  enqueuedAt: string;
};

export type InventoryAiJobPayload = {
  trigger?: string;
  requestId?: string;
  source?: string;
  specConfirmationReviewed?: boolean;
  specConfirmationReviewedBy?: string;
  [key: string]: unknown;
};

export type EnqueueInventoryAiJobInput = {
  jobType: InventoryAiJobType;
  assetId: string;
  payload?: InventoryAiJobPayload;
  idempotencyKey: string;
  maxAttempts?: number;
  scheduledAt?: Date;
  parentJobId?: string | null;
};

export type InventoryAiPipelineSummary = {
  assetId: string;
  hasActiveJobs: boolean;
  pipelineStatus: 'processing' | 'completed' | 'failed' | 'unknown';
  latestByType: Record<string, {
    status: string;
    attempts: number;
    maxAttempts: number;
    updatedAt: string;
    lastError: string | null;
  }>;
  activeJobs: Array<{
    id: string;
    jobType: string;
    status: string;
    attempts: number;
    maxAttempts: number;
    scheduledAt: string;
    updatedAt: string;
    lastError: string | null;
  }>;
};
