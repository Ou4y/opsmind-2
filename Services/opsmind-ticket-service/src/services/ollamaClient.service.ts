import { config } from "../config";
import { logger } from "../config/logger";
import { PromptMode } from "./aiPromptBuilder.service";

export interface OllamaGenerationOptions {
  temperature?: number;
  top_p?: number;
  num_predict?: number;
  repeat_penalty?: number;
}

export interface OllamaGenerateRequest {
  prompt: string;
  mode: PromptMode;
  options?: OllamaGenerationOptions;
}

export interface OllamaGenerateResult {
  text: string;
  elapsedMs: number;
  model: string;
  raw: Record<string, unknown> | null;
}

export interface OllamaStreamResult {
  text: string;
  elapsedMs: number;
  model: string;
  chunks: string[];
  rawMessages: Array<Record<string, unknown>>;
}

const MODE_DEFAULT_OPTIONS: Record<PromptMode, Required<OllamaGenerationOptions>> = {
  USER_AI_HELP_DIRECT_STEPS: {
    temperature: 0.2,
    top_p: 0.8,
    num_predict: 220,
    repeat_penalty: 1.1,
  },
  DESCRIPTION_ENHANCEMENT: {
    temperature: 0.3,
    top_p: 0.8,
    num_predict: 180,
    repeat_penalty: 1.1,
  },
  TECHNICIAN_DIRECT_ANALYSIS: {
    temperature: 0.2,
    top_p: 0.8,
    num_predict: 300,
    repeat_penalty: 1.1,
  },
  CHATBOT_SHORT_HELP: {
    temperature: 0.2,
    top_p: 0.8,
    num_predict: 220,
    repeat_penalty: 1.1,
  },
  CLASSIFICATION_ONLY: {
    temperature: 0.2,
    top_p: 0.8,
    num_predict: 300,
    repeat_penalty: 1.1,
  },
};

function resolveOptions(mode: PromptMode, options?: OllamaGenerationOptions): Required<OllamaGenerationOptions> {
  return {
    ...MODE_DEFAULT_OPTIONS[mode],
    ...(options ?? {}),
  };
}

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function parseNdjsonChunk(input: string): Array<Record<string, unknown>> {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

export function safeParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export class OllamaClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor() {
    this.baseUrl = config.ollama.baseUrl;
    this.model = config.ollama.model;
    this.timeoutMs = config.ollama.timeoutMs;
  }

  getModel(): string {
    return this.model;
  }

  async generate(input: OllamaGenerateRequest): Promise<OllamaGenerateResult> {
    const startedAt = Date.now();

    const response = await fetch(joinUrl(this.baseUrl, "/api/generate"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        prompt: input.prompt,
        stream: false,
        options: resolveOptions(input.mode, input.options),
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`Ollama request failed (${response.status}): ${errorBody || response.statusText}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const text = String(payload.response ?? "").trim();

    if (!text) {
      throw new Error("Ollama returned an empty response");
    }

    logger.debug("Ollama non-stream generation completed", {
      mode: input.mode,
      model: this.model,
      elapsedMs: Date.now() - startedAt,
    });

    return {
      text,
      elapsedMs: Date.now() - startedAt,
      model: this.model,
      raw: payload,
    };
  }

  async generateStream(
    input: OllamaGenerateRequest,
    onChunk?: (chunk: string) => void,
  ): Promise<OllamaStreamResult> {
    const startedAt = Date.now();
    const response = await fetch(joinUrl(this.baseUrl, "/api/generate"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        prompt: input.prompt,
        stream: true,
        options: resolveOptions(input.mode, input.options),
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`Ollama stream failed (${response.status}): ${errorBody || response.statusText}`);
    }

    if (!response.body) {
      throw new Error("Ollama stream body is unavailable");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let fullText = "";
    const chunks: string[] = [];
    const rawMessages: Array<Record<string, unknown>> = [];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const messages = parseNdjsonChunk(trimmed);
        for (const message of messages) {
          rawMessages.push(message);
          const token = String(message.response ?? "");

          if (token) {
            fullText += token;
            chunks.push(token);
            onChunk?.(token);
          }

          const hasError = typeof message.error === "string" && message.error.length > 0;
          if (hasError) {
            throw new Error(message.error as string);
          }
        }
      }
    }

    if (buffer.trim()) {
      const trailing = parseNdjsonChunk(buffer.trim());
      for (const message of trailing) {
        rawMessages.push(message);
        const token = String(message.response ?? "");
        if (token) {
          fullText += token;
          chunks.push(token);
          onChunk?.(token);
        }
      }
    }

    const text = fullText.trim();

    if (!text) {
      throw new Error("Ollama stream returned an empty response");
    }

    logger.debug("Ollama stream generation completed", {
      mode: input.mode,
      model: this.model,
      elapsedMs: Date.now() - startedAt,
      chunks: chunks.length,
    });

    return {
      text,
      elapsedMs: Date.now() - startedAt,
      model: this.model,
      chunks,
      rawMessages,
    };
  }
}

export const ollamaClient = new OllamaClient();
