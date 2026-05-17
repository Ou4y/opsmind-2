import { config } from "../config";
import { logger } from "../config/logger";

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type DecisionSource =
  | "AI_CONFIDENT"
  | "RULE_FALLBACK"
  | "RULE_AI_AGREEMENT"
  | "HUMAN_REVIEW_REQUIRED";

export type AiPredictionStatus = "SUCCESS" | "FAILED" | "SKIPPED";

export interface AiPriorityRequestPayload {
  ticketId?: string;
  requesterId?: string;
  requesterRole?: string;
  title: string;
  description: string;
  typeOfRequest: "INCIDENT" | "SERVICE_REQUEST" | "MAINTENANCE";
  topic?: string;
  productGroup?: string;
  category?: string;
  building?: string;
  room?: string;
  createdAt?: string;
  latitude?: number;
  longitude?: number;
}

export interface AiPriorityDecision {
  ticketId?: string | null;
  rulePriority: Priority;
  aiPriority: Priority | null;
  finalPriority: Priority;
  confidence: number | null;
  decisionSource: DecisionSource;
  priorityScore: number | null;
  explanation: string[];
  model?: {
    name?: string;
    version?: string;
    metrics?: Record<string, unknown>;
  } | null;
}

export interface PriorityFallbackDecision extends AiPriorityDecision {
  aiPredictionStatus: AiPredictionStatus;
}

export class AiPredictionError extends Error {
  public readonly statusCode?: number;
  public readonly code: string;
  public readonly isTimeout: boolean;

  constructor(message: string, options?: { statusCode?: number; code?: string; isTimeout?: boolean }) {
    super(message);
    this.name = "AiPredictionError";
    this.statusCode = options?.statusCode;
    this.code = options?.code ?? "AI_PREDICTION_ERROR";
    this.isTimeout = options?.isTimeout ?? false;
  }
}

function normalizePriority(priority: string): Priority {
  const normalized = String(priority || "").trim().toUpperCase();
  if (normalized === "LOW" || normalized === "MEDIUM" || normalized === "HIGH" || normalized === "CRITICAL") {
    return normalized;
  }
  return "MEDIUM";
}

export async function predictTicketPriority(
  payload: AiPriorityRequestPayload,
): Promise<AiPriorityDecision> {
  const baseUrl = config.aiService.url.replace(/\/+$/, "");
  const url = `${baseUrl}/api/ai/predict-priority`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(config.aiService.timeoutMs),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AiPredictionError(
        `AI Service returned ${response.status}${body ? `: ${body}` : ""}`,
        {
          statusCode: response.status,
          code: "AI_HTTP_ERROR",
        },
      );
    }

    const data = (await response.json()) as Record<string, unknown>;

    return {
      ticketId: (data.ticketId as string | undefined) ?? payload.ticketId ?? null,
      rulePriority: normalizePriority(String(data.rulePriority ?? "MEDIUM")),
      aiPriority: normalizePriority(String(data.aiPriority ?? "MEDIUM")),
      finalPriority: normalizePriority(String(data.finalPriority ?? "MEDIUM")),
      confidence:
        typeof data.confidence === "number" && Number.isFinite(data.confidence)
          ? data.confidence
          : null,
      decisionSource: String(data.decisionSource ?? "RULE_FALLBACK") as DecisionSource,
      priorityScore:
        typeof data.priorityScore === "number" && Number.isFinite(data.priorityScore)
          ? data.priorityScore
          : null,
      explanation: Array.isArray(data.explanation)
        ? data.explanation.map((item) => String(item))
        : [],
      model:
        data.model && typeof data.model === "object"
          ? (data.model as AiPriorityDecision["model"])
          : null,
    };
  } catch (error) {
    if (error instanceof AiPredictionError) {
      logger.warn("AI priority prediction request failed", {
        url,
        statusCode: error.statusCode,
        code: error.code,
        message: error.message,
      });
      throw error;
    }

    const isTimeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || /aborted|timeout/i.test(error.message));

    const wrappedError = new AiPredictionError(
      error instanceof Error ? error.message : "Unknown AI prediction failure",
      {
        code: isTimeout ? "AI_TIMEOUT" : "AI_REQUEST_FAILED",
        isTimeout,
      },
    );

    logger.warn("AI priority prediction request failed", {
      url,
      code: wrappedError.code,
      isTimeout,
      message: wrappedError.message,
    });

    throw wrappedError;
  }
}

export interface FallbackPriorityInput {
  title: string;
  description: string;
  type_of_request: "INCIDENT" | "SERVICE_REQUEST" | "MAINTENANCE";
  ticketId?: string;
}

export function getFallbackPriority(
  input: FallbackPriorityInput,
  status: AiPredictionStatus = "FAILED",
): PriorityFallbackDecision {
  const title = String(input.title || "").toLowerCase();
  const description = String(input.description || "").toLowerCase();
  const text = `${title} ${description}`;

  const urgentPattern = /\b(urgent|down|cannot|can't|error|failed|not\s+working|outage|critical)\b/i;

  let finalPriority: Priority = "MEDIUM";
  if (input.type_of_request === "INCIDENT" && urgentPattern.test(text)) {
    finalPriority = "HIGH";
  } else if (input.type_of_request === "INCIDENT") {
    finalPriority = "HIGH";
  } else if (input.type_of_request === "SERVICE_REQUEST") {
    finalPriority = "MEDIUM";
  } else if (input.type_of_request === "MAINTENANCE") {
    finalPriority = "MEDIUM";
  }

  return {
    ticketId: input.ticketId ?? null,
    rulePriority: finalPriority,
    aiPriority: null,
    finalPriority,
    confidence: null,
    decisionSource: "RULE_FALLBACK",
    priorityScore: null,
    explanation: [
      "AI Service unavailable; fallback priority was applied.",
    ],
    model: null,
    aiPredictionStatus: status,
  };
}
