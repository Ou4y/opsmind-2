const { generateWithOllama } = require("./ollamaClient.service");
const { parseModelJson } = require("../utils/parseModelJson");
const {
  normalizeTicket,
  normalizeCategory,
  validateRawPlan,
  sanitizeRawPlanParams,
  sanitizeRemediationPlan,
  enrichSafePlan,
} = require("../utils/remediationPolicy");

function buildGemmaPrompt(normalizedTicket) {
  return `You are the OpsMind Agentic AI remediation planner.

Your job is to analyze an IT support ticket and generate a safe remediation plan.

Architecture rules:
- You are only a planning model.
- You do not execute commands.
- You do not control the requester machine.
- You do not communicate with endpoint agents.
- A future execution layer will coordinate approval and execution.
- A future Endpoint Agent will execute predefined approved actions.

IMPORTANT OUTPUT RULES:
- Return raw JSON only.
- Do not use markdown.
- Do not wrap the response in code fences.
- Do not add explanations outside JSON.
- Do not output shell commands.
- Do not output PowerShell, Bash, CMD, terminal commands, scripts, or URLs to run.
- Do not invent action keys.
- Choose only from the allowed action keys.
- requiresApproval must always be true.
- If the issue is unclear or unsupported, use MANUAL_REVIEW_REQUIRED.
- The AI only proposes a plan. A technician must approve before execution.

Allowed action keys:
1. COLLECT_SYSTEM_INFO
2. CHECK_CONNECTIVITY
3. CHECK_DISK_SPACE
4. CHECK_MEMORY_USAGE
5. CHECK_INSTALLED_APPS
6. FLUSH_DNS
7. RESTART_PRINT_SPOOLER
8. DOWNLOAD_APPROVED_SOFTWARE
9. VERIFY_DOWNLOADED_SOFTWARE
10. MANUAL_REVIEW_REQUIRED

Category-specific rules:
- For NETWORK tickets, prefer this sequence:
  1. COLLECT_SYSTEM_INFO
  2. CHECK_CONNECTIVITY
  3. FLUSH_DNS
  4. CHECK_CONNECTIVITY
- Do not include CHECK_DISK_SPACE or CHECK_MEMORY_USAGE for NETWORK tickets unless the ticket description clearly mentions slow performance, freezing, storage, or disk problems.
- For PRINTER tickets, prefer:
  1. COLLECT_SYSTEM_INFO
  2. CHECK_CONNECTIVITY
  3. RESTART_PRINT_SPOOLER
- For PERFORMANCE tickets, prefer:
  1. COLLECT_SYSTEM_INFO
  2. CHECK_MEMORY_USAGE
  3. CHECK_DISK_SPACE
- For STORAGE tickets, prefer:
  1. COLLECT_SYSTEM_INFO
  2. CHECK_DISK_SPACE
- For SOFTWARE download/install tickets, prefer:
  1. COLLECT_SYSTEM_INFO
  2. CHECK_CONNECTIVITY
  3. CHECK_DISK_SPACE
  4. DOWNLOAD_APPROVED_SOFTWARE only if the requested software is from the approved catalog
  5. VERIFY_DOWNLOADED_SOFTWARE
- For SOFTWARE category:
  - Do not output URLs.
  - Do not output shell commands.
  - Do not output installer commands.
  - Do not use INSTALL_APPROVED_SOFTWARE yet.
  - If software is not clearly approved, use MANUAL_REVIEW_REQUIRED.
  - For Google Chrome, use softwareKey GOOGLE_CHROME.
- Use MANUAL_REVIEW_REQUIRED only when the issue is unsupported, unclear, or cannot be safely handled by the allowed actions.

Ticket execution context:
- If ai_agent_eligible is false, still generate a recommendation plan if the issue category is understandable.
- Automatic execution is only possible later when ai_agent_eligible is true.
- Do not add execution instructions.
- Do not mention direct machine control.

Return JSON using exactly this structure:
{
  "summary": "short summary of the issue",
  "riskLevel": "LOW or MEDIUM or HIGH",
  "requiresApproval": true,
  "steps": [
    {
      "stepOrder": 1,
      "actionKey": "ONE_ALLOWED_ACTION_KEY",
      "description": "what this step does",
      "params": {
        "softwareKey": "GOOGLE_CHROME",
        "softwareName": "Google Chrome"
      }
    }
  ]
}

The "params" object is optional and only valid for DOWNLOAD_APPROVED_SOFTWARE or VERIFY_DOWNLOADED_SOFTWARE.

Normalized ticket context JSON:
${JSON.stringify(normalizedTicket, null, 2)}
`;
}

function createValidationError(message) {
  const error = new Error(message);
  error.code = "VALIDATION_ERROR";
  return error;
}

async function generateRemediationPlan(ticket) {
  if (!ticket || typeof ticket !== "object" || Array.isArray(ticket)) {
    throw createValidationError("Ticket payload must be a JSON object.");
  }

  if (typeof ticket.title !== "string" || !ticket.title.trim()) {
    throw createValidationError("ticket.title is required.");
  }

  if (typeof ticket.description !== "string" || !ticket.description.trim()) {
    throw createValidationError("ticket.description is required.");
  }

  const normalizedTicket = normalizeTicket(ticket);
  normalizedTicket.category = normalizeCategory(
    normalizedTicket.category,
    normalizedTicket.title,
    normalizedTicket.description
  );

  const prompt = buildGemmaPrompt(normalizedTicket);
  const rawModelOutput = await generateWithOllama(prompt);
  const rawPlan = sanitizeRawPlanParams(parseModelJson(rawModelOutput));

  validateRawPlan(rawPlan);

  const sanitizedPlan = sanitizeRemediationPlan(rawPlan, normalizedTicket);
  const safePlan = enrichSafePlan(sanitizedPlan, normalizedTicket);

  return { rawPlan, safePlan };
}

module.exports = {
  generateRemediationPlan,
};
