export type PromptMode =
  | "USER_AI_HELP_DIRECT_STEPS"
  | "DESCRIPTION_ENHANCEMENT"
  | "TECHNICIAN_DIRECT_ANALYSIS"
  | "CHATBOT_SHORT_HELP"
  | "CLASSIFICATION_ONLY";

export interface TicketContext {
  id?: string;
  title?: string;
  description?: string;
  type_of_request?: string;
  category?: string;
  os_type?: string;
  issue_scope?: string;
  building?: string;
  room?: string;
  latitude?: number | string;
  longitude?: number | string;
}

export interface ClassificationPromptPayload {
  task: string;
  input: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  allowReason?: boolean;
}

function normalizeInline(value: unknown, fallback = "UNKNOWN"): string {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || fallback;
}

function compactJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function buildTicketContextBlock(ticket: TicketContext = {}): string {
  return [
    `Ticket ID: ${normalizeInline(ticket.id, "N/A")}`,
    `Title: ${normalizeInline(ticket.title)}`,
    `Description: ${normalizeInline(ticket.description)}`,
    `Type: ${normalizeInline(ticket.type_of_request, "INCIDENT")}`,
    `Category: ${normalizeInline(ticket.category)}`,
    `OS: ${normalizeInline(ticket.os_type)}`,
    `Issue Scope: ${normalizeInline(ticket.issue_scope)}`,
    `Building: ${normalizeInline(ticket.building)}`,
    `Room: ${normalizeInline(ticket.room)}`,
    `Latitude: ${normalizeInline(ticket.latitude, "N/A")}`,
    `Longitude: ${normalizeInline(ticket.longitude, "N/A")}`,
  ].join("\n");
}

function buildUserAiHelpPrompt(ticket: TicketContext = {}): string {
  return [
    "SYSTEM INSTRUCTIONS:",
    "Return valid JSON only.",
    "No markdown.",
    "No code fences.",
    "No greeting.",
    "No long analysis.",
    "No SLA.",
    "No priority classification.",
    "No technician-only instructions.",
    "No admin/internal wording.",
    "Maximum 5 steps.",
    "Each step must be safe for a normal user.",
    "Each instruction must be short and clear.",
    "Do not ask multiple questions.",
    "Do not invent missing device data.",
    "Do not recommend risky actions.",
    "Do not include command line, registry edits, BIOS changes, driver uninstall, or admin-only actions.",
    "Do not say submit the ticket except the final step.",
    "Final step may say: If the issue is still not fixed, continue submitting the ticket.",
    "",
    "Required JSON schema:",
    compactJson({
      summary: "short issue summary",
      steps: [
        {
          stepOrder: 1,
          title: "short step title",
          instruction: "simple user-safe instruction",
        },
      ],
      canTryBeforeSubmitting: true,
    }),
    "",
    "Ticket context:",
    buildTicketContextBlock(ticket),
  ].join("\n");
}

function buildDescriptionEnhancementPrompt(ticket: TicketContext = {}): string {
  return [
    "SYSTEM INSTRUCTIONS:",
    "Return valid JSON only.",
    "No markdown.",
    "Return one final JSON object only.",
    "Improve grammar and clarity only.",
    "Keep exactly the same meaning.",
    "Do not invent details.",
    "Do not add troubleshooting steps.",
    "Do not add priority or SLA.",
    "Keep output concise and professional.",
    "",
    "Required JSON schema:",
    compactJson({
      enhancedDescription: "clear professional ticket description",
    }),
    "",
    "Ticket context:",
    buildTicketContextBlock(ticket),
  ].join("\n");
}

function buildTechnicianAnalysisPrompt(ticket: TicketContext = {}): string {
  return [
    "SYSTEM INSTRUCTIONS:",
    "Return JSON only.",
    "No markdown.",
    "Maximum 5 technical steps.",
    "No long text.",
    "Include only relevant technical actions.",
    "requiresApproval must be true.",
    "",
    "Required JSON schema:",
    compactJson({
      summary: "short technical summary",
      steps: [
        {
          stepOrder: 1,
          actionKey: "UPPER_SNAKE_CASE_ACTION",
          title: "short title",
          instruction: "short technical instruction",
        },
      ],
      riskLevel: "LOW",
      requiresApproval: true,
    }),
    "",
    "Ticket context:",
    buildTicketContextBlock(ticket),
  ].join("\n");
}

function buildChatbotPrompt(message: string, conversationHistory: Array<{ sender?: string; text?: string }> = []): string {
  const history = conversationHistory
    .slice(-5)
    .map((item) => `${normalizeInline(item.sender, "user")}: ${normalizeInline(item.text, "")}`)
    .join("\n");

  return [
    "You are OpsMind assistant.",
    "Rules:",
    "- Maximum 5 bullets.",
    "- No long intro.",
    "- Answer directly.",
    "- Ask at most one clarification question only if required.",
    "- Prefer actionable steps.",
    "",
    history ? `Recent conversation:\n${history}` : "",
    `User request: ${normalizeInline(message)}`,
    "Return plain bullet lines only.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildClassificationPrompt(payload: ClassificationPromptPayload): string {
  return [
    "Return JSON only.",
    "No markdown.",
    "No explanation unless there is a field named reason.",
    payload.allowReason === false
      ? "Do not include reason field."
      : "If reason exists, keep it to one short sentence.",
    "",
    `Task: ${normalizeInline(payload.task)}`,
    "Input:",
    compactJson(payload.input),
    "Output schema:",
    compactJson(payload.outputSchema),
  ].join("\n");
}

export function buildPrompt(mode: PromptMode, payload: unknown): string {
  if (mode === "USER_AI_HELP_DIRECT_STEPS") {
    const value = (payload ?? {}) as { ticket?: TicketContext };
    return buildUserAiHelpPrompt(value.ticket ?? {});
  }

  if (mode === "DESCRIPTION_ENHANCEMENT") {
    const value = (payload ?? {}) as { ticket?: TicketContext };
    return buildDescriptionEnhancementPrompt(value.ticket ?? {});
  }

  if (mode === "TECHNICIAN_DIRECT_ANALYSIS") {
    const value = (payload ?? {}) as { ticket?: TicketContext };
    return buildTechnicianAnalysisPrompt(value.ticket ?? {});
  }

  if (mode === "CHATBOT_SHORT_HELP") {
    const value = (payload ?? {}) as {
      message?: string;
      conversationHistory?: Array<{ sender?: string; text?: string }>;
    };

    return buildChatbotPrompt(value.message ?? "", value.conversationHistory ?? []);
  }

  const value = (payload ?? {}) as ClassificationPromptPayload;
  return buildClassificationPrompt({
    task: value.task ?? "Classify input",
    input: value.input ?? {},
    outputSchema: value.outputSchema ?? {},
    allowReason: value.allowReason,
  });
}
