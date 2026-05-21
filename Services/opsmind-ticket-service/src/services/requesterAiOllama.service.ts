import { config } from "../config";
import { logger } from "../config/logger";

export type RequesterAiFeature = "AI_HELP" | "DESCRIPTION_ENHANCEMENT";

export interface RequesterAiOptions {
  temperature: number;
  top_p: number;
  num_predict: number;
  repeat_penalty: number;
}

export interface StreamRequesterAiParams {
  featureName: RequesterAiFeature;
  prompt: string;
  options: RequesterAiOptions;
  onChunk: (chunk: string) => boolean | void;
}

interface OllamaStreamMessage {
  response?: string;
  done?: boolean;
  error?: string;
}

const REQUESTER_AI_OPTIONS = {
  AI_HELP: {
    temperature: 0.2,
    top_p: 0.8,
    num_predict: 180,
    repeat_penalty: 1.1,
  },
  DESCRIPTION_ENHANCEMENT: {
    temperature: 0.3,
    top_p: 0.8,
    num_predict: 120,
    repeat_penalty: 1.1,
  },
} satisfies Record<RequesterAiFeature, RequesterAiOptions>;

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function safeJsonParse(raw: string): OllamaStreamMessage | null {
  try {
    return JSON.parse(raw) as OllamaStreamMessage;
  } catch {
    return null;
  }
}

async function readStreamBody(
  body: ReadableStream<Uint8Array>,
  featureName: RequesterAiFeature,
  onMessage: (message: OllamaStreamMessage) => boolean | void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const parsed = safeJsonParse(trimmed);
      if (!parsed) {
        logger.debug("Requester AI stream malformed chunk skipped", {
          featureName,
          chunkSize: trimmed.length,
        });
        continue;
      }

      if (typeof parsed.error === "string" && parsed.error.trim()) {
        throw new Error(parsed.error);
      }

      const shouldContinue = onMessage(parsed);
      if (shouldContinue === false) {
        try {
          await reader.cancel();
        } catch {
          // Ignore cancellation errors during early stop.
        }
        return;
      }
    }
  }

  if (!buffer.trim()) return;

  const trailing = safeJsonParse(buffer.trim());
  if (!trailing) {
    logger.debug("Requester AI stream malformed trailing chunk skipped", {
      featureName,
      chunkSize: buffer.trim().length,
    });
    return;
  }

  if (typeof trailing.error === "string" && trailing.error.trim()) {
    throw new Error(trailing.error);
  }

  onMessage(trailing);
}

class RequesterAiOllamaService {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor() {
    this.baseUrl = config.ollama.baseUrl;
    this.model = config.ollama.model;
    this.timeoutMs = config.ollama.timeoutMs;
  }

  getDefaultOptions(featureName: RequesterAiFeature): RequesterAiOptions {
    return REQUESTER_AI_OPTIONS[featureName];
  }

  async stream(params: StreamRequesterAiParams): Promise<{ text: string; elapsedMs: number }> {
    const startedAt = Date.now();
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), this.timeoutMs);

    let fullText = "";
    try {
      const response = await fetch(joinUrl(this.baseUrl, "/api/generate"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          prompt: params.prompt,
          stream: true,
          options: params.options,
        }),
        signal: timeoutController.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(`Ollama request failed (${response.status}): ${errorBody || response.statusText}`);
      }

      if (!response.body) {
        throw new Error("Ollama stream body is unavailable");
      }

      await readStreamBody(response.body, params.featureName, (message) => {
        const token = String(message.response ?? "");
        if (!token) return true;

        fullText += token;
        const shouldContinue = params.onChunk(token);
        return shouldContinue;
      });

      const elapsedMs = Date.now() - startedAt;
      logger.info("Requester AI stream completed", {
        featureName: params.featureName,
        model: this.model,
        elapsedTimeMs: elapsedMs,
        outputChars: fullText.length,
      });

      return {
        text: fullText,
        elapsedMs,
      };
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : "Requester AI stream failed";
      logger.error("Requester AI stream failed", {
        featureName: params.featureName,
        model: this.model,
        elapsedTimeMs: elapsedMs,
        outputChars: fullText.length,
        error: message,
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async warmup(): Promise<void> {
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), 3000);

    try {
      await fetch(joinUrl(this.baseUrl, "/api/generate"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          prompt: "Reply OK.",
          stream: false,
          options: {
            temperature: 0,
            top_p: 0.8,
            num_predict: 2,
            repeat_penalty: 1,
          },
        }),
        signal: timeoutController.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const requesterAiOllamaService = new RequesterAiOllamaService();
