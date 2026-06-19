const prisma = require("../db/prisma");
const { normalizeTicket } = require("../utils/remediationPolicy");

const PLAN_STATUS = Object.freeze({
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
});

const ALLOWED_RISK_LEVELS = new Set(["LOW", "MEDIUM", "HIGH"]);

function toOptionalString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function normalizeRiskLevel(value) {
  const riskLevel = String(value || "").trim().toUpperCase();
  return ALLOWED_RISK_LEVELS.has(riskLevel) ? riskLevel : "LOW";
}

function normalizeOsType(value) {
  const normalized = toOptionalString(value)?.toUpperCase() || "UNKNOWN";
  if (/(MAC|OSX|DARWIN)/.test(normalized)) return "MACOS";
  if (/WIN/.test(normalized)) return "WINDOWS";
  if (/LINUX/.test(normalized)) return "LINUX";
  return normalized || "UNKNOWN";
}

function normalizeIssueScope(value) {
  return String(value || "UNKNOWN")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_") || "UNKNOWN";
}

function buildSafeTicketContext(normalizedTicket) {
  return {
    ticketId: toOptionalString(normalizedTicket.id),
    affectedDeviceId: toOptionalString(normalizedTicket.affectedDeviceId),
    affectedDeviceName: toOptionalString(normalizedTicket.affectedDeviceName),
    osType: normalizeOsType(normalizedTicket.osType),
    issueScope: normalizeIssueScope(normalizedTicket.issueScope),
  };
}

function buildSafePlanForStorage(safePlan, normalizedTicket) {
  const safePlanPayload =
    safePlan && typeof safePlan === "object" && !Array.isArray(safePlan) ? { ...safePlan } : {};
  const ticketContext = buildSafeTicketContext(normalizedTicket);

  safePlanPayload.affectedDeviceId =
    toOptionalString(safePlanPayload.affectedDeviceId) || ticketContext.affectedDeviceId;
  safePlanPayload.affectedDeviceName =
    toOptionalString(safePlanPayload.affectedDeviceName) || ticketContext.affectedDeviceName;
  safePlanPayload.osType = normalizeOsType(safePlanPayload.osType || ticketContext.osType);
  safePlanPayload.issueScope = normalizeIssueScope(safePlanPayload.issueScope || ticketContext.issueScope);
  safePlanPayload.ticketContext = ticketContext;

  return safePlanPayload;
}

function createError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function createValidationError(message) {
  return createError("VALIDATION_ERROR", message, 400);
}

function createPlanNotFoundError(planId) {
  return createError("PLAN_NOT_FOUND", `Remediation plan not found: ${planId}`, 404);
}

function createConflictError(message) {
  return createError("INVALID_PLAN_STATUS_TRANSITION", message, 409);
}

function validatePlanId(planId) {
  const normalizedPlanId = toOptionalString(planId);
  if (!normalizedPlanId) {
    throw createValidationError("planId is required.");
  }
  return normalizedPlanId;
}

function validateTicketId(ticketId) {
  const normalizedTicketId = toOptionalString(ticketId);
  if (!normalizedTicketId) {
    throw createValidationError("ticketId is required.");
  }
  return normalizedTicketId;
}

function normalizeActor(actor) {
  const payload = actor && typeof actor === "object" && !Array.isArray(actor) ? actor : {};

  return {
    userId: toOptionalString(payload.userId),
    role: toOptionalString(payload.role),
  };
}

function ensureActorProvided(actor, actionLabel) {
  const normalizedActor = normalizeActor(actor);

  if (!normalizedActor.userId && !normalizedActor.role) {
    throw createValidationError(`Actor metadata is required to ${actionLabel} a remediation plan.`);
  }

  return normalizedActor;
}

async function createRemediationPlanRecord({ ticket, rawPlan, safePlan, generatedBy }) {
  const normalizedTicket = normalizeTicket(ticket);
  const actor = normalizeActor(generatedBy);
  const safePlanForStorage = buildSafePlanForStorage(safePlan, normalizedTicket);

  const ticketId = toOptionalString(normalizedTicket.id) || "test-ticket";
  const executionAvailable = safePlanForStorage?.executionAvailable === true;

  const createdPlan = await prisma.agenticRemediationPlan.create({
    data: {
      ticket_id: ticketId,
      ticket_title: toOptionalString(normalizedTicket.title),
      ticket_category: toOptionalString(normalizedTicket.category),
      ticket_priority: toOptionalString(normalizedTicket.priority),
      generated_by_user_id: actor.userId,
      generated_by_role: actor.role,
      raw_plan: rawPlan || {},
      safe_plan: safePlanForStorage,
      risk_level: normalizeRiskLevel(safePlanForStorage?.riskLevel),
      requires_approval: true,
      execution_available: executionAvailable,
      execution_blocked_reason: executionAvailable
        ? null
        : toOptionalString(safePlanForStorage?.executionBlockedReason),
      status: PLAN_STATUS.PENDING_APPROVAL,
    },
  });

  return createdPlan;
}

async function getRemediationPlanById(planId) {
  const normalizedPlanId = validatePlanId(planId);

  const plan = await prisma.agenticRemediationPlan.findUnique({
    where: { id: normalizedPlanId },
  });

  if (!plan) {
    throw createPlanNotFoundError(normalizedPlanId);
  }

  return plan;
}

async function listRemediationPlansByTicket(ticketId) {
  const normalizedTicketId = validateTicketId(ticketId);

  return prisma.agenticRemediationPlan.findMany({
    where: { ticket_id: normalizedTicketId },
    orderBy: { created_at: "desc" },
  });
}

function ensurePendingApproval(plan, transitionActionLabel) {
  if (plan.status === PLAN_STATUS.PENDING_APPROVAL) {
    return;
  }

  if (plan.status === PLAN_STATUS.APPROVED) {
    throw createConflictError(`Plan is already approved and cannot be ${transitionActionLabel}.`);
  }

  if (plan.status === PLAN_STATUS.REJECTED) {
    throw createConflictError(`Rejected plans cannot be ${transitionActionLabel}.`);
  }

  throw createConflictError(`Plan in status ${plan.status} cannot be ${transitionActionLabel}.`);
}

async function approveRemediationPlan(planId, actor) {
  const normalizedPlanId = validatePlanId(planId);
  const normalizedActor = ensureActorProvided(actor, "approve");
  const plan = await getRemediationPlanById(normalizedPlanId);

  ensurePendingApproval(plan, "approved");

  return prisma.agenticRemediationPlan.update({
    where: { id: normalizedPlanId },
    data: {
      status: PLAN_STATUS.APPROVED,
      approved_by_user_id: normalizedActor.userId,
      approved_by_role: normalizedActor.role,
      approved_at: new Date(),
      rejected_by_user_id: null,
      rejected_by_role: null,
      rejected_at: null,
      rejection_reason: null,
    },
  });
}

async function rejectRemediationPlan(planId, actor, rejectionReason) {
  const normalizedPlanId = validatePlanId(planId);
  const normalizedActor = ensureActorProvided(actor, "reject");
  const plan = await getRemediationPlanById(normalizedPlanId);

  ensurePendingApproval(plan, "rejected");

  return prisma.agenticRemediationPlan.update({
    where: { id: normalizedPlanId },
    data: {
      status: PLAN_STATUS.REJECTED,
      rejected_by_user_id: normalizedActor.userId,
      rejected_by_role: normalizedActor.role,
      rejected_at: new Date(),
      rejection_reason: toOptionalString(rejectionReason),
      approved_by_user_id: null,
      approved_by_role: null,
      approved_at: null,
    },
  });
}

module.exports = {
  createRemediationPlanRecord,
  getRemediationPlanById,
  listRemediationPlansByTicket,
  approveRemediationPlan,
  rejectRemediationPlan,
};
