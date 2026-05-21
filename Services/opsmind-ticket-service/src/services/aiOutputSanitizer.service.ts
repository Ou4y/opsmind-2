import { TicketContext } from "./aiPromptBuilder.service";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface UserAiHelpStep {
  stepOrder: number;
  title: string;
  instruction: string;
}

export interface UserAiHelpPlan {
  summary: string;
  steps: UserAiHelpStep[];
  canTryBeforeSubmitting: true;
}

export interface TechnicianStep {
  stepOrder: number;
  actionKey: string;
  title: string;
  instruction: string;
}

export interface TechnicianAnalysisPlan {
  summary: string;
  steps: TechnicianStep[];
  riskLevel: RiskLevel;
  requiresApproval: true;
}

const VALID_RISK_LEVELS = new Set<RiskLevel>(["LOW", "MEDIUM", "HIGH"]);

const USER_RISKY_PATTERNS = [
  /\bcmd\b/i,
  /command\s+prompt/i,
  /powershell/i,
  /terminal/i,
  /\bregistry\b/i,
  /\bbios\b/i,
  /\buefi\b/i,
  /uninstall\s+driver/i,
  /device\s+manager/i,
  /admin\s+privilege/i,
  /run\s+as\s+administrator/i,
  /sudo\b/i,
  /regedit/i,
  /gpedit/i,
];

const USER_HELP_FALLBACK: UserAiHelpPlan = {
  summary: "Try these basic checks before submitting the ticket.",
  steps: [
    {
      stepOrder: 1,
      title: "Check the basics",
      instruction: "Confirm the device, cable, power, and connection are working correctly.",
    },
    {
      stepOrder: 2,
      title: "Restart the device",
      instruction: "Restart the device and check if the issue is resolved.",
    },
    {
      stepOrder: 3,
      title: "Continue ticket submission",
      instruction: "If the issue is still not fixed, continue submitting the ticket.",
    },
  ],
  canTryBeforeSubmitting: true,
};

const TECHNICIAN_FALLBACK: TechnicianAnalysisPlan = {
  summary: "AI could not generate a reliable plan. Manual review is required.",
  steps: [
    {
      stepOrder: 1,
      actionKey: "MANUAL_REVIEW_REQUIRED",
      title: "Review ticket manually",
      instruction: "Check ticket details and continue with the normal support workflow.",
    },
  ],
  riskLevel: "MEDIUM",
  requiresApproval: true,
};

const TECHNICIAN_ACTION_ALLOWLIST_BY_TOPIC: Array<{ keywords: string[]; actions: string[] }> = [
  {
    keywords: ["display", "monitor", "screen", "video", "hdmi", "vga", "displayport"],
    actions: [
      "CHECK_CABLE_CONNECTION",
      "CHECK_MONITOR_INPUT",
      "RESTART_DEVICE_AND_MONITOR",
      "CHECK_DISPLAY_SETTINGS",
      "UPDATE_DISPLAY_DRIVER",
      "TEST_WITH_DIFFERENT_CABLE",
      "TEST_WITH_DIFFERENT_MONITOR",
    ],
  },
  {
    keywords: ["network", "wifi", "internet", "vpn", "lan", "ethernet"],
    actions: [
      "CHECK_NETWORK_CABLE",
      "RESTART_NETWORK_ADAPTER",
      "RECONNECT_WIFI",
      "VERIFY_VPN_CREDENTIALS",
      "FLUSH_DNS_CACHE",
      "CHECK_PROXY_SETTINGS",
      "RUN_NETWORK_DIAGNOSTICS",
    ],
  },
  {
    keywords: ["printer", "printing", "print"],
    actions: [
      "CHECK_PRINTER_POWER",
      "CHECK_PRINTER_CONNECTION",
      "CLEAR_PRINT_QUEUE",
      "RESTART_PRINT_SPOOLER",
      "REINSTALL_PRINTER_DRIVER",
    ],
  },
  {
    keywords: ["password", "access", "login", "signin", "authentication", "auth"],
    actions: [
      "VERIFY_ACCOUNT_STATUS",
      "RESET_PASSWORD",
      "CLEAR_CACHED_CREDENTIALS",
      "VERIFY_MFA_METHOD",
      "CHECK_ACCESS_PERMISSIONS",
    ],
  },
  {
    keywords: ["software", "application", "app", "crash", "error", "bug"],
    actions: [
      "RESTART_APPLICATION",
      "CHECK_APPLICATION_LOGS",
      "CLEAR_APPLICATION_CACHE",
      "REPAIR_APPLICATION_INSTALL",
      "UPDATE_APPLICATION",
      "REINSTALL_APPLICATION",
      "CHECK_SYSTEM_RESOURCES",
    ],
  },
];

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have", "i", "if", "in",
  "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "we", "with", "you", "your",
  "user", "device", "issue", "ticket",
]);

function normalizeText(input: unknown): string {
  return String(input ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function trimText(input: unknown, maxLength: number, fallback = ""): string {
  const normalized = normalizeText(input);
  if (!normalized) return fallback;
  return normalized.length > maxLength ? normalized.slice(0, maxLength).trim() : normalized;
}

function sanitizeLineText(input: string): string {
  return input
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function toActionKey(input: unknown): string {
  const normalized = String(input ?? "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toUpperCase();

  return normalized || "MANUAL_REVIEW_REQUIRED";
}

function tokenize(input: string): string[] {
  return normalizeText(input)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token.length > 2)
    .filter((token) => !STOP_WORDS.has(token));
}

function hasListLikeShape(text: string): boolean {
  return /(^|\n)\s*[-*]\s+/.test(text) || /(^|\n)\s*\d+[.)]\s+/.test(text);
}

function hasTroubleshootingDirective(text: string): boolean {
  return /(\btry\b\s+|\bcheck\b\s+|\brestart\b\s+|\bstep\s+\d+|\bfollow\s+these\s+steps)/i.test(text);
}

function containsRiskyUserContent(text: string): boolean {
  return USER_RISKY_PATTERNS.some((pattern) => pattern.test(text));
}

function resolveTechnicianAllowlist(ticket: TicketContext = {}): Set<string> | null {
  const haystack = [ticket.title, ticket.description, ticket.category, ticket.type_of_request]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");

  for (const entry of TECHNICIAN_ACTION_ALLOWLIST_BY_TOPIC) {
    if (entry.keywords.some((keyword) => haystack.includes(keyword))) {
      return new Set(entry.actions.map((item) => item.toUpperCase()));
    }
  }

  return null;
}

function extractFirstJsonBlock(rawText: string): string | null {
  const startIndex = rawText.search(/[\[{]/);
  if (startIndex < 0) return null;

  const opening = rawText[startIndex];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < rawText.length; index += 1) {
    const char = rawText[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === opening) depth += 1;
    if (char === closing) {
      depth -= 1;
      if (depth === 0) {
        return rawText.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function limitWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ");
}

function cleanOriginalDescription(originalDescription: string): string {
  return trimText(sanitizeLineText(normalizeText(originalDescription)), 600, "");
}

function isMeaningPreserved(originalDescription: string, enhancedDescription: string): boolean {
  const originalTokens = new Set(tokenize(originalDescription));
  const enhancedTokens = new Set(tokenize(enhancedDescription));

  if (originalTokens.size === 0 || enhancedTokens.size === 0) {
    return true;
  }

  let overlappingCount = 0;
  for (const token of enhancedTokens) {
    if (originalTokens.has(token)) overlappingCount += 1;
  }

  const overlapRatio = overlappingCount / enhancedTokens.size;
  return overlapRatio >= 0.5;
}

function hasUnsupportedFactExpansion(originalDescription: string, enhancedDescription: string): boolean {
  const originalTokens = new Set(tokenize(originalDescription));
  const enhancedTokens = new Set(tokenize(enhancedDescription));

  const newTokens = Array.from(enhancedTokens).filter((token) => !originalTokens.has(token));
  if (enhancedTokens.size > 0) {
    const newTokenRatio = newTokens.length / enhancedTokens.size;
    if (newTokens.length > 8 && newTokenRatio > 0.45) {
      return true;
    }
  }

  const originalNumbers = new Set((originalDescription.match(/\d+(?:[.:]\d+)?/g) ?? []).map((value) => value.trim()));
  const enhancedNumbers = (enhancedDescription.match(/\d+(?:[.:]\d+)?/g) ?? []).map((value) => value.trim());

  for (const numberToken of enhancedNumbers) {
    if (!originalNumbers.has(numberToken)) {
      return true;
    }
  }

  return false;
}

export function stripMarkdownCodeFences(rawText: string): string {
  const text = normalizeText(rawText);
  const fenced = text.match(/^```(?:json|javascript|js|ts)?\s*([\s\S]*?)\s*```$/i);

  if (fenced) {
    return fenced[1].trim();
  }

  return text
    .replace(/^```(?:json|javascript|js|ts)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function parseModelJson(rawText: string): unknown {
  const cleaned = stripMarkdownCodeFences(String(rawText ?? ""));

  try {
    return JSON.parse(cleaned);
  } catch {
    const extracted = extractFirstJsonBlock(cleaned);
    if (!extracted) {
      throw new Error("No JSON object found in model output");
    }

    return JSON.parse(extracted);
  }
}

export function getUserAiHelpFallback(): UserAiHelpPlan {
  return USER_HELP_FALLBACK;
}

export function getTechnicianAnalysisFallback(): TechnicianAnalysisPlan {
  return TECHNICIAN_FALLBACK;
}

export function sanitizeUserAiHelpOutput(plan: unknown): UserAiHelpPlan {
  const parsed = plan && typeof plan === "object" ? (plan as Record<string, unknown>) : null;
  if (!parsed) {
    return USER_HELP_FALLBACK;
  }

  const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
  const safeSteps = rawSteps
    .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : null))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => {
      const title = trimText(sanitizeLineText(String(item.title ?? "")), 45, "Try this step");
      const instruction = trimText(sanitizeLineText(String(item.instruction ?? "")), 120, "Follow this basic check.");
      return { title, instruction };
    })
    .filter((item) => !containsRiskyUserContent(`${item.title} ${item.instruction}`));

  const stepsWithoutEarlySubmit = safeSteps.map((step, index) => {
    if (index < safeSteps.length - 1 && /submit(ting)?\s+the\s+ticket|submit\s+ticket/i.test(step.instruction)) {
      return {
        ...step,
        instruction: step.instruction.replace(/submit(ting)?\s+the\s+ticket|submit\s+ticket/gi, "continue troubleshooting"),
      };
    }

    return step;
  });

  let steps = stepsWithoutEarlySubmit.slice(0, 5).map((step, index) => ({
    stepOrder: index + 1,
    title: step.title,
    instruction: step.instruction,
  }));

  const hasSubmitStep = steps.some((step) => /continue submitting the ticket|submit\s+the\s+ticket/i.test(step.instruction));
  if (!hasSubmitStep && steps.length < 5) {
    steps.push({
      stepOrder: steps.length + 1,
      title: "Continue ticket submission",
      instruction: "If the issue is still not fixed, continue submitting the ticket.",
    });
  }

  if (steps.length === 0) {
    return USER_HELP_FALLBACK;
  }

  const summary = trimText(parsed.summary, 120, USER_HELP_FALLBACK.summary);

  return {
    summary,
    steps: steps.map((step, index) => ({
      ...step,
      stepOrder: index + 1,
      title: trimText(step.title, 45, "Try this step"),
      instruction: trimText(step.instruction, 120, "Follow this basic check."),
    })),
    canTryBeforeSubmitting: true,
  };
}

export function sanitizeDescriptionEnhancementOutput(
  result: unknown,
  originalDescription: string,
): { enhancedDescription: string } {
  const cleanedOriginal = cleanOriginalDescription(originalDescription);
  const parsed = result && typeof result === "object" ? (result as Record<string, unknown>) : null;
  const enhancedCandidate = parsed ? String(parsed.enhancedDescription ?? "") : "";

  const normalizedEnhanced = trimText(sanitizeLineText(enhancedCandidate), 600, "");

  if (!normalizedEnhanced) {
    return { enhancedDescription: cleanedOriginal };
  }

  if (hasListLikeShape(normalizedEnhanced) || hasTroubleshootingDirective(normalizedEnhanced)) {
    return { enhancedDescription: cleanedOriginal };
  }

  if (!isMeaningPreserved(cleanedOriginal, normalizedEnhanced)) {
    return { enhancedDescription: cleanedOriginal };
  }

  if (hasUnsupportedFactExpansion(cleanedOriginal, normalizedEnhanced)) {
    return { enhancedDescription: cleanedOriginal };
  }

  return { enhancedDescription: normalizedEnhanced };
}

export function sanitizeTechnicianAnalysisOutput(
  plan: unknown,
  ticket: TicketContext = {},
): TechnicianAnalysisPlan {
  const parsed = plan && typeof plan === "object" ? (plan as Record<string, unknown>) : null;
  if (!parsed) {
    return TECHNICIAN_FALLBACK;
  }

  const allowlist = resolveTechnicianAllowlist(ticket);
  const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];

  const steps = rawSteps
    .map((item, index) => {
      const step = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
      if (!step) return null;

      const actionKey = toActionKey(step.actionKey ?? step.title ?? `STEP_${index + 1}`);
      const title = trimText(step.title, 50, "Perform technical check");
      const instruction = trimText(limitWords(String(step.instruction ?? ""), 18), 120, "Follow standard technical diagnostics.");

      return {
        stepOrder: index + 1,
        actionKey,
        title,
        instruction,
      };
    })
    .filter((item): item is TechnicianStep => Boolean(item))
    .filter((item) => (allowlist ? allowlist.has(item.actionKey) : true))
    .slice(0, 5)
    .map((item, index) => ({
      ...item,
      stepOrder: index + 1,
    }));

  if (steps.length === 0) {
    return TECHNICIAN_FALLBACK;
  }

  const riskCandidate = String(parsed.riskLevel ?? "LOW").toUpperCase() as RiskLevel;
  const riskLevel: RiskLevel = VALID_RISK_LEVELS.has(riskCandidate) ? riskCandidate : "LOW";

  return {
    summary: trimText(parsed.summary, 140, TECHNICIAN_FALLBACK.summary),
    steps,
    riskLevel,
    requiresApproval: true,
  };
}

export function sanitizeChatbotShortHelp(rawText: string): string {
  const cleaned = stripMarkdownCodeFences(rawText)
    .replace(/\r/g, "")
    .trim();

  const lines = cleaned
    .split("\n")
    .map((line) => sanitizeLineText(line))
    .filter(Boolean)
    .map((line) => trimText(line, 140))
    .slice(0, 5);

  let questionCount = 0;
  const limitedLines = lines.filter((line) => {
    if (!line.endsWith("?")) return true;
    questionCount += 1;
    return questionCount <= 1;
  });

  if (limitedLines.length === 0) {
    return "- Please share the exact error message and recent changes.";
  }

  return limitedLines.map((line) => `- ${line}`).join("\n");
}
