const prisma = require("../db/prisma");

const MOCK_OUTPUT_BY_ACTION_KEY = Object.freeze({
  COLLECT_SYSTEM_INFO: "Mock execution: collected basic system and network information.",
  CHECK_CONNECTIVITY: "Mock execution: connectivity check completed.",
  FLUSH_DNS: "Mock execution: DNS cache flush simulated successfully.",
  CHECK_DISK_SPACE: "Mock execution: disk space check completed.",
  CHECK_MEMORY_USAGE: "Mock execution: memory usage check completed.",
  CHECK_INSTALLED_APPS: "Mock execution: checked installed applications.",
  DOWNLOAD_APPROVED_SOFTWARE: "Mock execution: approved software download simulated.",
  VERIFY_DOWNLOADED_SOFTWARE: "Mock execution: downloaded software verification simulated.",
  RESTART_PRINT_SPOOLER: "Mock execution: print spooler restart simulated successfully.",
  MANUAL_REVIEW_REQUIRED: "Mock execution: manual review required. No automated action simulated.",
});

const DEFAULT_MOCK_OUTPUT = "Mock execution: action simulated.";

function toOptionalString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
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

function ensureId(value, fieldName) {
  const normalized = toOptionalString(value);
  if (!normalized) {
    throw createValidationError(`${fieldName} is required.`);
  }
  return normalized;
}

function normalizeActor(actor) {
  const payload = actor && typeof actor === "object" && !Array.isArray(actor) ? actor : {};

  return {
    userId: toOptionalString(payload.userId),
    role: toOptionalString(payload.role),
  };
}

function normalizeStepsFromPlan(plan) {
  const safePlan = plan?.safe_plan && typeof plan.safe_plan === "object" ? plan.safe_plan : {};
  const steps = Array.isArray(safePlan.steps) ? safePlan.steps : [];

  return steps
    .map((step, index) => {
      const fallbackOrder = index + 1;
      const stepOrder =
        Number.isInteger(step?.stepOrder) && step.stepOrder > 0
          ? step.stepOrder
          : Number.isInteger(step?.step_order) && step.step_order > 0
          ? step.step_order
          : fallbackOrder;

      const actionKey = toOptionalString(step?.actionKey ?? step?.action_key) || "UNKNOWN_ACTION";
      const description = toOptionalString(step?.description) || null;

      return {
        stepOrder,
        actionKey,
        description,
      };
    })
    .sort((left, right) => left.stepOrder - right.stepOrder);
}

function getMockOutputForAction(actionKey) {
  return MOCK_OUTPUT_BY_ACTION_KEY[actionKey] || DEFAULT_MOCK_OUTPUT;
}

function buildExecutionConflictErrorForPlanStatus(planStatus) {
  if (planStatus === "PENDING_APPROVAL") {
    return createError("PLAN_NOT_APPROVED", "Only approved plans can be mock-executed.", 409);
  }

  if (planStatus === "REJECTED") {
    return createError("EXECUTION_CONFLICT", "Rejected plans cannot be executed.", 409);
  }

  if (planStatus === "COMPLETED") {
    return createError(
      "EXECUTION_CONFLICT",
      "This plan has already been completed and cannot be executed again.",
      409
    );
  }

  return createError(
    "EXECUTION_CONFLICT",
    `Plan in status ${planStatus} cannot be mock-executed.`,
    409
  );
}

async function getPlanOrThrow(planId) {
  const normalizedPlanId = ensureId(planId, "planId");
  const plan = await prisma.agenticRemediationPlan.findUnique({
    where: { id: normalizedPlanId },
  });

  if (!plan) {
    throw createError("PLAN_NOT_FOUND", `Remediation plan not found: ${normalizedPlanId}`, 404);
  }

  return plan;
}

async function startMockExecution(planId, actor) {
  const normalizedPlanId = ensureId(planId, "planId");
  const plan = await getPlanOrThrow(normalizedPlanId);

  if (plan.status !== "APPROVED") {
    throw buildExecutionConflictErrorForPlanStatus(plan.status);
  }

  const normalizedActor = normalizeActor(actor);
  const now = new Date();
  const normalizedSteps = normalizeStepsFromPlan(plan);

  const execution = await prisma.$transaction(async (tx) => {
    const createdExecution = await tx.agenticMockExecution.create({
      data: {
        plan_id: normalizedPlanId,
        ticket_id: plan.ticket_id,
        status: "RUNNING",
        started_by_user_id: normalizedActor.userId,
        started_by_role: normalizedActor.role,
        started_at: now,
      },
    });

    for (let index = 0; index < normalizedSteps.length; index += 1) {
      const step = normalizedSteps[index];
      const stepStartTime = new Date();

      const createdStep = await tx.agenticMockExecutionStep.create({
        data: {
          execution_id: createdExecution.id,
          step_order: step.stepOrder || index + 1,
          action_key: step.actionKey,
          description: step.description,
          status: "RUNNING",
          started_at: stepStartTime,
        },
      });

      await tx.agenticMockExecutionStep.update({
        where: { id: createdStep.id },
        data: {
          status: "SUCCESS",
          output: getMockOutputForAction(step.actionKey),
          completed_at: new Date(),
        },
      });
    }

    const completedAt = new Date();

    await tx.agenticMockExecution.update({
      where: { id: createdExecution.id },
      data: {
        status: "COMPLETED",
        completed_at: completedAt,
      },
    });

    await tx.agenticRemediationPlan.update({
      where: { id: normalizedPlanId },
      data: {
        status: "COMPLETED",
      },
    });

    return tx.agenticMockExecution.findUnique({
      where: { id: createdExecution.id },
      include: {
        steps: {
          orderBy: { step_order: "asc" },
        },
      },
    });
  });

  return execution;
}

async function getExecutionById(executionId) {
  const normalizedExecutionId = ensureId(executionId, "executionId");

  const execution = await prisma.agenticMockExecution.findUnique({
    where: { id: normalizedExecutionId },
    include: {
      steps: {
        orderBy: { step_order: "asc" },
      },
    },
  });

  if (!execution) {
    throw createError("EXECUTION_NOT_FOUND", `Execution not found: ${normalizedExecutionId}`, 404);
  }

  return execution;
}

async function listExecutionsByPlan(planId) {
  const normalizedPlanId = ensureId(planId, "planId");

  return prisma.agenticMockExecution.findMany({
    where: { plan_id: normalizedPlanId },
    include: {
      steps: {
        orderBy: { step_order: "asc" },
      },
    },
    orderBy: { created_at: "desc" },
  });
}

async function listExecutionsByTicket(ticketId) {
  const normalizedTicketId = ensureId(ticketId, "ticketId");

  return prisma.agenticMockExecution.findMany({
    where: { ticket_id: normalizedTicketId },
    include: {
      steps: {
        orderBy: { step_order: "asc" },
      },
    },
    orderBy: { created_at: "desc" },
  });
}

module.exports = {
  startMockExecution,
  getExecutionById,
  listExecutionsByPlan,
  listExecutionsByTicket,
};
