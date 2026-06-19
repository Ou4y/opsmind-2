import { Request, Response, Router } from "express";
import { logger } from "../config/logger";
import { config } from "../config";
import { requireAuthOrInternal } from "../middleware/auth.middleware";
import { buildPrompt, ClassificationPromptPayload, TicketContext } from "../services/aiPromptBuilder.service";
import { ollamaClient } from "../services/ollamaClient.service";
import {
  isRequesterAiUpstreamError,
  requesterAiOllamaService,
} from "../services/requesterAiOllama.service";
import {
  getTechnicianAnalysisFallback,
  getUserAiHelpFallback,
  parseModelJson,
  sanitizeChatbotShortHelp,
  sanitizeDescriptionEnhancementOutput,
  sanitizeTechnicianAnalysisOutput,
  sanitizeUserAiHelpOutput,
  stripMarkdownCodeFences,
} from "../services/aiOutputSanitizer.service";

const router = Router();
router.use(requireAuthOrInternal);

function normalizeTicketContext(input: unknown): TicketContext {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const ticket = source.ticket && typeof source.ticket === "object"
    ? (source.ticket as Record<string, unknown>)
    : source;

  return {
    id: ticket.id ? String(ticket.id) : undefined,
    title: ticket.title ? String(ticket.title) : undefined,
    description: ticket.description ? String(ticket.description) : undefined,
    type_of_request: ticket.type_of_request ? String(ticket.type_of_request) : undefined,
    category: ticket.category ? String(ticket.category) : undefined,
    os_type: ticket.os_type ? String(ticket.os_type) : undefined,
    issue_scope: ticket.issue_scope ? String(ticket.issue_scope) : undefined,
    building: ticket.building ? String(ticket.building) : undefined,
    room: ticket.room ? String(ticket.room) : undefined,
    latitude: ticket.latitude as number | string | undefined,
    longitude: ticket.longitude as number | string | undefined,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function trimToMaxChars(value: unknown, maxChars: number): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function normalizeShortField(value: unknown, fallback = "Unknown", maxChars = 80): string {
  const normalized = trimToMaxChars(value, maxChars);
  return normalized || fallback;
}

function countWords(text: string): number {
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}

function limitByWords(text: string, maxWords: number): string {
  if (maxWords <= 0) return "";

  let words = 0;
  const matcher = /\S+/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(text)) !== null) {
    words += 1;
    if (words > maxWords) {
      return text.slice(0, match.index).trimEnd();
    }
  }

  return text;
}

function appendWithWordLimit(existingText: string, chunk: string, maxWords: number): {
  nextText: string;
  delta: string;
  reachedLimit: boolean;
} {
  const candidate = `${existingText}${chunk}`;
  const limited = limitByWords(candidate, maxWords);
  const delta = limited.slice(existingText.length);
  const reachedLimit = countWords(limited) >= maxWords;

  return {
    nextText: limited,
    delta,
    reachedLimit,
  };
}

function buildAiHelpStreamPrompt(input: {
  title: string;
  description: string;
  category: string;
  osType: string;
  deviceType: string;
}): string {
  return [
    "You are an IT self-help assistant for a requester before ticket submission.",
    "Return only direct steps the user can try safely.",
    "No greeting. No markdown table. No JSON. No SLA. No priority. No technician-only actions.",
    "Maximum 4 steps.",
    "Each step must be short and safe for a normal user.",
    "Do not mention command line, registry, BIOS, admin permissions, driver uninstall, or internal systems.",
    "Use this exact format:",
    "",
    "Try these steps before submitting the ticket:",
    "",
    "Summary:",
    "<one short issue summary>",
    "",
    "1. <short step title>",
    "<simple instruction>",
    "",
    "2. <short step title>",
    "<simple instruction>",
    "",
    "3. <short step title>",
    "<simple instruction>",
    "",
    "4. Continue ticket submission",
    "If the issue is still not fixed, continue submitting the ticket.",
    "",
    "Ticket:",
    `Title: ${input.title}`,
    `Description: ${input.description}`,
    `Category: ${input.category}`,
    `OS: ${input.osType}`,
    `Device: ${input.deviceType}`,
    "",
    "Important:",
    "Keep the whole response under 120 words.",
  ].join("\n");
}

function buildDescriptionEnhancementStreamPrompt(input: {
  description: string;
  title?: string;
  category?: string;
}): string {
  const header: string[] = [
    "Improve this IT support ticket description.",
    "Return only the improved description text.",
    "Do not add new facts.",
    "Do not add troubleshooting steps.",
    "Do not mention priority or SLA.",
    "Keep it professional, clear, and under 70 words.",
  ];

  if (input.title) {
    header.push(`Title: ${input.title}`);
  }

  if (input.category) {
    header.push(`Category: ${input.category}`);
  }

  header.push("", "Description:", input.description);
  return header.join("\n");
}

function writeSseEvent(res: Response, event: string, payload: Record<string, unknown>) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function startSseStream(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }
}

function getRequesterAiErrorStatus(error: unknown): number {
  if (isRequesterAiUpstreamError(error)) {
    return error.statusCode;
  }

  return 502;
}

function sendRequesterAiErrorResponse(
  res: Response,
  statusCode: number,
  message: string,
): void {
  res.status(statusCode).json({
    success: false,
    error: "AI troubleshooting suggestions are unavailable",
    details: message,
  });
}

async function generateUserAiHelp(ticket: TicketContext) {
  const prompt = buildPrompt("USER_AI_HELP_DIRECT_STEPS", { ticket });
  const response = await ollamaClient.generate({
    mode: "USER_AI_HELP_DIRECT_STEPS",
    prompt,
  });

  let parsedPlan: unknown = null;
  let parseSuccess = false;

  try {
    parsedPlan = parseModelJson(response.text);
    parseSuccess = true;
  } catch {
    parseSuccess = false;
  }

  return {
    plan: sanitizeUserAiHelpOutput(parsedPlan),
    model: response.model,
    rawPlanText: response.text,
    parseSuccess,
  };
}

async function generateTechnicianAnalysis(ticket: TicketContext) {
  const prompt = buildPrompt("TECHNICIAN_DIRECT_ANALYSIS", { ticket });
  const response = await ollamaClient.generate({
    mode: "TECHNICIAN_DIRECT_ANALYSIS",
    prompt,
  });

  let parsedPlan: unknown = null;
  let parseSuccess = false;

  try {
    parsedPlan = parseModelJson(response.text);
    parseSuccess = true;
  } catch {
    parseSuccess = false;
  }

  return {
    plan: sanitizeTechnicianAnalysisOutput(parsedPlan, ticket),
    model: response.model,
    rawPlanText: response.text,
    parseSuccess,
  };
}

async function respondWithTechnicianAnalysis(
  req: Request,
  res: Response,
  featureName: string,
): Promise<void> {
  const startedAt = Date.now();
  const modelName = ollamaClient.getModel();
  const ticket = normalizeTicketContext(req.body);

  try {
    const result = await generateTechnicianAnalysis(ticket);

    logger.info("Technician AI analysis generated", {
      featureName,
      modelName,
      elapsedTimeMs: Date.now() - startedAt,
      parseSuccess: result.parseSuccess,
      sanitizedStepCount: result.plan.steps.length,
    });

    const data: Record<string, unknown> = {
      ...result.plan,
      model: result.model,
      generatedAt: nowIso(),
    };

    if (config.ollama.debugRawOutput) {
      data.rawPlan = stripMarkdownCodeFences(result.rawPlanText);
    }

    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Technician AI analysis failed";
    const fallbackPlan = getTechnicianAnalysisFallback();

    logger.error("Technician AI analysis failed", {
      featureName,
      modelName,
      elapsedTimeMs: Date.now() - startedAt,
      parseSuccess: false,
      sanitizedStepCount: fallbackPlan.steps.length,
      error: message,
    });

    res.json({
      success: true,
      data: {
        ...fallbackPlan,
        model: modelName,
        generatedAt: nowIso(),
      },
      warning: message,
    });
  }
}

async function respondWithTechnicianAnalysisStream(
  req: Request,
  res: Response,
  featureName: string,
): Promise<void> {
  const startedAt = Date.now();
  const modelName = ollamaClient.getModel();
  const ticket = normalizeTicketContext(req.body);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  writeSseEvent(res, "start", { message: "AI analysis started" });
  writeSseEvent(res, "progress", { message: "Understanding the ticket" });

  const fallbackPlan = getTechnicianAnalysisFallback();
  let parseSuccess = false;
  let sanitizedStepCount = fallbackPlan.steps.length;

  try {
    const prompt = buildPrompt("TECHNICIAN_DIRECT_ANALYSIS", { ticket });

    writeSseEvent(res, "progress", { message: "Generating direct steps" });

    const streamResult = await ollamaClient.generateStream(
      {
        mode: "TECHNICIAN_DIRECT_ANALYSIS",
        prompt,
      },
      () => {
        // Do not expose raw token chunks to UI.
      },
    );

    writeSseEvent(res, "progress", { message: "Validating safety" });

    let parsedPlan: unknown = null;
    try {
      parsedPlan = parseModelJson(streamResult.text);
      parseSuccess = true;
    } catch {
      parseSuccess = false;
    }

    const plan = sanitizeTechnicianAnalysisOutput(parsedPlan, ticket);
    sanitizedStepCount = plan.steps.length;

    const data: Record<string, unknown> = {
      ...plan,
      model: streamResult.model,
      generatedAt: nowIso(),
    };

    if (config.ollama.debugRawOutput) {
      data.rawPlan = stripMarkdownCodeFences(streamResult.text);
    }

    writeSseEvent(res, "result", data);
    writeSseEvent(res, "done", { message: "completed" });

    logger.info("Technician AI analysis stream completed", {
      featureName,
      modelName,
      elapsedTimeMs: Date.now() - startedAt,
      parseSuccess,
      sanitizedStepCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Technician AI analysis stream failed";

    writeSseEvent(res, "error", { message });
    writeSseEvent(res, "result", {
      ...fallbackPlan,
      model: modelName,
      generatedAt: nowIso(),
    });
    writeSseEvent(res, "done", { message: "completed_with_fallback" });

    logger.error("Technician AI analysis stream failed", {
      featureName,
      modelName,
      elapsedTimeMs: Date.now() - startedAt,
      parseSuccess,
      sanitizedStepCount,
      error: message,
    });
  } finally {
    res.end();
  }
}

router.post("/help", async (req, res) => {
  const startedAt = Date.now();
  const featureName = "USER_AI_HELP";
  const modelName = ollamaClient.getModel();
  const ticket = normalizeTicketContext(req.body);

  try {
    const result = await generateUserAiHelp(ticket);

    logger.info("User AI help generated", {
      featureName,
      modelName,
      elapsedTimeMs: Date.now() - startedAt,
      parseSuccess: result.parseSuccess,
      sanitizedStepCount: result.plan.steps.length,
    });

    const data: Record<string, unknown> = {
      ...result.plan,
      model: result.model,
      generatedAt: nowIso(),
    };

    if (config.ollama.debugRawOutput) {
      data.rawPlan = stripMarkdownCodeFences(result.rawPlanText);
    }

    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "User AI help failed";
    const fallbackPlan = getUserAiHelpFallback();

    logger.error("User AI help failed", {
      featureName,
      modelName,
      elapsedTimeMs: Date.now() - startedAt,
      parseSuccess: false,
      sanitizedStepCount: fallbackPlan.steps.length,
      error: message,
    });

    res.json({
      success: true,
      data: {
        ...fallbackPlan,
        model: modelName,
        generatedAt: nowIso(),
      },
      warning: message,
    });
  }
});

router.post("/help/stream", async (req, res) => {
  const startedAt = Date.now();
  const body = req.body as Record<string, unknown>;
  const ticket = normalizeTicketContext(body);
  const featureName = "AI_HELP";

  const title = trimToMaxChars(body.title ?? ticket.title, 160);
  const description = trimToMaxChars(body.description ?? ticket.description, 600);
  const category = trimToMaxChars(body.category ?? ticket.category, 80);
  const osType = normalizeShortField(body.osType ?? body.os_type ?? ticket.os_type, "Unknown", 60);
  const deviceType = normalizeShortField(body.deviceType ?? body.affectedDeviceName ?? body.affected_device_name, "Unknown", 80);

  if (!title || !description || !category) {
    res.status(400).json({
      success: false,
      error: "title, description, and category are required",
    });
    return;
  }

  const prompt = buildAiHelpStreamPrompt({
    title,
    description,
    category,
    osType,
    deviceType,
  });

  let emittedText = "";
  let streamStarted = false;

  try {
    await requesterAiOllamaService.stream({
      featureName,
      prompt,
      options: requesterAiOllamaService.getDefaultOptions(featureName),
      onChunk: (chunk) => {
        const { nextText, delta, reachedLimit } = appendWithWordLimit(emittedText, chunk, 120);
        emittedText = nextText;

        if (delta) {
          if (!streamStarted) {
            streamStarted = true;
            startSseStream(res);
            writeSseEvent(res, "start", { message: "AI Help started" });
          }

          writeSseEvent(res, "chunk", { text: delta });
        }

        return !reachedLimit;
      },
    });

    if (!emittedText.trim()) {
      const message = "Ollama returned an empty AI Help response";
      if (!streamStarted) {
        sendRequesterAiErrorResponse(res, 502, message);
        return;
      }

      writeSseEvent(res, "error", { message });
    } else if (streamStarted) {
      writeSseEvent(res, "done", {
        message: "completed",
        outputWords: countWords(emittedText),
      });
    }

    logger.info("Requester AI Help stream sent", {
      featureName,
      modelName: ollamaClient.getModel(),
      elapsedTimeMs: Date.now() - startedAt,
      outputWords: countWords(emittedText),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Requester AI Help stream failed";
    const statusCode = getRequesterAiErrorStatus(error);
    logger.error("Requester AI Help stream failed", {
      featureName,
      modelName: ollamaClient.getModel(),
      elapsedTimeMs: Date.now() - startedAt,
      outputWords: countWords(emittedText),
      error: message,
      statusCode,
    });

    if (!res.headersSent) {
      sendRequesterAiErrorResponse(res, statusCode, message);
      return;
    }

    writeSseEvent(res, "error", { message });
  }

  if (!res.writableEnded) {
    res.end();
  }
});

router.post("/technician/analysis", async (req, res) => {
  await respondWithTechnicianAnalysis(req, res, "TECHNICIAN_AI_ANALYSIS");
});

router.post("/technician/analysis/stream", async (req, res) => {
  await respondWithTechnicianAnalysisStream(req, res, "TECHNICIAN_AI_ANALYSIS_STREAM");
});

// Backward-compatible aliases.
router.post("/analysis", async (req, res) => {
  await respondWithTechnicianAnalysis(req, res, "TECHNICIAN_AI_ANALYSIS_ALIAS");
});

router.post("/analysis/stream", async (req, res) => {
  await respondWithTechnicianAnalysisStream(req, res, "TECHNICIAN_AI_ANALYSIS_STREAM_ALIAS");
});

router.post("/chatbot", async (req, res) => {
  const startedAt = Date.now();
  const featureName = "CHATBOT_SHORT_HELP";
  const modelName = ollamaClient.getModel();

  try {
    const message = String((req.body as Record<string, unknown>)?.message ?? "").trim();
    const conversationHistory = Array.isArray((req.body as Record<string, unknown>)?.conversationHistory)
      ? ((req.body as Record<string, unknown>).conversationHistory as Array<{ sender?: string; text?: string }>)
      : [];

    if (!message) {
      res.status(400).json({ success: false, error: "message is required" });
      return;
    }

    const prompt = buildPrompt("CHATBOT_SHORT_HELP", {
      message,
      conversationHistory,
    });

    const response = await ollamaClient.generate({
      mode: "CHATBOT_SHORT_HELP",
      prompt,
    });

    const reply = sanitizeChatbotShortHelp(response.text);

    logger.info("Chatbot response generated", {
      featureName,
      modelName,
      elapsedTimeMs: Date.now() - startedAt,
      parseSuccess: true,
      sanitizedStepCount: reply.split("\n").length,
    });

    res.json({
      success: true,
      data: {
        reply,
        model: response.model,
        generatedAt: nowIso(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chatbot generation failed";

    logger.error("Chatbot generation failed", {
      featureName,
      modelName,
      elapsedTimeMs: Date.now() - startedAt,
      parseSuccess: false,
      sanitizedStepCount: 0,
      error: message,
    });

    res.status(503).json({
      success: false,
      error: "AI assistant is temporarily unavailable. Please try again.",
      details: message,
    });
  }
});

router.post("/classification", async (req, res) => {
  const startedAt = Date.now();
  const featureName = "CLASSIFICATION_ONLY";
  const modelName = ollamaClient.getModel();

  try {
    const payload = req.body as ClassificationPromptPayload;

    const prompt = buildPrompt("CLASSIFICATION_ONLY", {
      task: payload?.task,
      input: payload?.input,
      outputSchema: payload?.outputSchema,
      allowReason: payload?.allowReason,
    });

    const response = await ollamaClient.generate({
      mode: "CLASSIFICATION_ONLY",
      prompt,
    });

    const result = parseModelJson(response.text);

    logger.info("Classification response generated", {
      featureName,
      modelName,
      elapsedTimeMs: Date.now() - startedAt,
      parseSuccess: true,
      sanitizedStepCount: 0,
    });

    res.json({
      success: true,
      data: {
        result,
        model: response.model,
        generatedAt: nowIso(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Classification failed";

    logger.error("Classification generation failed", {
      featureName,
      modelName,
      elapsedTimeMs: Date.now() - startedAt,
      parseSuccess: false,
      sanitizedStepCount: 0,
      error: message,
    });

    res.status(503).json({ success: false, error: "Classification failed", details: message });
  }
});

router.post("/enhance-description", async (req, res) => {
  const startedAt = Date.now();
  const featureName = "DESCRIPTION_ENHANCEMENT";
  const modelName = ollamaClient.getModel();

  const body = req.body as Record<string, unknown>;
  const ticket = normalizeTicketContext(body);
  const originalDescription = String(body.description ?? ticket.description ?? "").trim();

  if (!originalDescription) {
    res.status(400).json({ success: false, error: "description is required" });
    return;
  }

  try {
    const prompt = buildPrompt("DESCRIPTION_ENHANCEMENT", { ticket });
    const response = await ollamaClient.generate({
      mode: "DESCRIPTION_ENHANCEMENT",
      prompt,
    });

    let parsed: unknown = null;
    let parseSuccess = false;

    try {
      parsed = parseModelJson(response.text);
      parseSuccess = true;
    } catch {
      parseSuccess = false;
    }

    const sanitized = sanitizeDescriptionEnhancementOutput(parsed, originalDescription);

    logger.info("Description enhancement generated", {
      featureName,
      modelName,
      elapsedTimeMs: Date.now() - startedAt,
      parseSuccess,
      sanitizedStepCount: 1,
    });

    res.json({
      success: true,
      data: {
        enhancedDescription: sanitized.enhancedDescription,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Description enhancement failed";
    const fallback = sanitizeDescriptionEnhancementOutput(null, originalDescription);

    logger.error("Description enhancement failed", {
      featureName,
      modelName,
      elapsedTimeMs: Date.now() - startedAt,
      parseSuccess: false,
      sanitizedStepCount: 1,
      error: message,
    });

    res.json({
      success: true,
      data: {
        enhancedDescription: fallback.enhancedDescription,
      },
      warning: message,
    });
  }
});

async function respondWithDescriptionEnhancementStream(req: Request, res: Response): Promise<void> {
  const startedAt = Date.now();
  const body = req.body as Record<string, unknown>;
  const ticket = normalizeTicketContext(body);
  const featureName = "DESCRIPTION_ENHANCEMENT";

  const description = trimToMaxChars(body.description ?? ticket.description, 800);
  if (!description) {
    res.status(400).json({
      success: false,
      error: "description is required",
    });
    return;
  }

  const title = trimToMaxChars(body.title ?? ticket.title, 160);
  const category = trimToMaxChars(body.category ?? ticket.category, 80);
  const prompt = buildDescriptionEnhancementStreamPrompt({
    description,
    title: title || undefined,
    category: category || undefined,
  });

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  let emittedText = "";

  try {
    await requesterAiOllamaService.stream({
      featureName,
      prompt,
      options: requesterAiOllamaService.getDefaultOptions(featureName),
      onChunk: (chunk) => {
        const { nextText, delta, reachedLimit } = appendWithWordLimit(emittedText, chunk, 70);
        emittedText = nextText;

        if (delta) {
          res.write(delta);
        }

        return !reachedLimit;
      },
    });

    logger.info("Requester description enhancement stream sent", {
      featureName,
      modelName: ollamaClient.getModel(),
      elapsedTimeMs: Date.now() - startedAt,
      outputWords: countWords(emittedText),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Description enhancement stream failed";
    logger.error("Requester description enhancement stream failed", {
      featureName,
      modelName: ollamaClient.getModel(),
      elapsedTimeMs: Date.now() - startedAt,
      outputWords: countWords(emittedText),
      error: message,
    });
  } finally {
    res.end();
  }
}

router.post("/description-enhancement/stream", async (req, res) => {
  await respondWithDescriptionEnhancementStream(req, res);
});

router.post("/enhance-description/stream", async (req, res) => {
  await respondWithDescriptionEnhancementStream(req, res);
});

export default router;
