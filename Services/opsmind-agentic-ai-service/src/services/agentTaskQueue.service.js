const prisma = require("../db/prisma");

const TASK_STATUS = Object.freeze({
  QUEUED: "QUEUED",
  CLAIMED: "CLAIMED",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
});

const TASK_STEP_RESULT_STATUS = new Set(["SUCCESS", "FAILED", "SKIPPED"]);

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

function normalizeStepParams(params) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }

  return { ...params };
}

function normalizeSafePlanSteps(safePlan) {
  const steps = Array.isArray(safePlan?.steps) ? safePlan.steps : [];

  return steps
    .map((step, index) => {
      if (!step || typeof step !== "object") {
        return null;
      }

      const rawStepOrder = Number(step.stepOrder ?? step.step_order);
      const stepOrder = Number.isInteger(rawStepOrder) && rawStepOrder > 0 ? rawStepOrder : index + 1;
      const actionKey = toOptionalString(step.actionKey ?? step.action_key);

      if (!actionKey) {
        return null;
      }

      return {
        step_order: stepOrder,
        action_key: actionKey,
        description: toOptionalString(step.description),
        params: normalizeStepParams(step.params),
      };
    })
    .filter((step) => Boolean(step))
    .sort((left, right) => left.step_order - right.step_order)
    .map((step, index) => ({
      ...step,
      step_order: index + 1,
    }));
}

function resolvePlanSafePlan(plan) {
  if (!plan || typeof plan !== "object") {
    return {};
  }

  const safePlan = plan.safe_plan;
  if (!safePlan || typeof safePlan !== "object" || Array.isArray(safePlan)) {
    return {};
  }

  return safePlan;
}

function resolveAffectedDeviceIdFromSafePlan(plan) {
  const safePlan = resolvePlanSafePlan(plan);

  const ticketContext =
    safePlan.ticketContext && typeof safePlan.ticketContext === "object" && !Array.isArray(safePlan.ticketContext)
      ? safePlan.ticketContext
      : {};

  const fallbackTicketContext =
    safePlan.ticket_context && typeof safePlan.ticket_context === "object" && !Array.isArray(safePlan.ticket_context)
      ? safePlan.ticket_context
      : {};

  return (
    toOptionalString(safePlan.affectedDeviceId) ||
    toOptionalString(safePlan.affected_device_id) ||
    toOptionalString(ticketContext.affectedDeviceId) ||
    toOptionalString(ticketContext.affected_device_id) ||
    toOptionalString(fallbackTicketContext.affectedDeviceId) ||
    toOptionalString(fallbackTicketContext.affected_device_id)
  );
}

function ensureTaskDeviceMatches(task, deviceId) {
  if (task.device_id !== deviceId) {
    throw createError("DEVICE_MISMATCH", "Task is assigned to a different endpoint device.", 403);
  }
}

function parseStepStatus(value) {
  const status = String(value || "").trim().toUpperCase();
  if (!TASK_STEP_RESULT_STATUS.has(status)) {
    throw createValidationError("result.status must be one of SUCCESS, FAILED, or SKIPPED.");
  }

  return status;
}

function parseDateOrNull(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
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

async function getTaskOrThrow(taskId) {
  const normalizedTaskId = ensureId(taskId, "taskId");

  const task = await prisma.agentTask.findUnique({
    where: { id: normalizedTaskId },
    include: {
      steps: {
        orderBy: { step_order: "asc" },
      },
    },
  });

  if (!task) {
    throw createError("TASK_NOT_FOUND", `Agent task not found: ${normalizedTaskId}`, 404);
  }

  return task;
}

function buildQueueConflictForPlanStatus(planStatus) {
  if (planStatus === "PENDING_APPROVAL") {
    return createError("TASK_QUEUE_CONFLICT", "Only approved plans can be queued for agent execution.", 409);
  }

  if (planStatus === "REJECTED") {
    return createError("TASK_QUEUE_CONFLICT", "Rejected plans cannot be queued for execution.", 409);
  }

  if (planStatus === "EXECUTION_QUEUED") {
    return createError("TASK_QUEUE_CONFLICT", "This plan is already queued for endpoint execution.", 409);
  }

  if (planStatus === "COMPLETED") {
    return createError("TASK_QUEUE_CONFLICT", "Completed plans cannot be queued again.", 409);
  }

  if (planStatus === "FAILED") {
    return createError("TASK_QUEUE_CONFLICT", "Failed plans cannot be queued again without regeneration.", 409);
  }

  return createError(
    "TASK_QUEUE_CONFLICT",
    `Plan in status ${planStatus} cannot be queued for endpoint execution.`,
    409
  );
}

function buildTaskStatusConflict(message) {
  return createError("TASK_STATUS_CONFLICT", message, 409);
}

function ensureTaskCanTransition(task, allowedStatuses, operation) {
  if (!allowedStatuses.includes(task.status)) {
    throw buildTaskStatusConflict(
      `Task in status ${task.status} cannot be ${operation}. Allowed statuses: ${allowedStatuses.join(", ")}.`
    );
  }
}

async function queueTaskFromApprovedPlan(planId, actor) {
  const normalizedPlanId = ensureId(planId, "planId");
  const normalizedActor = normalizeActor(actor);
  const plan = await getPlanOrThrow(normalizedPlanId);

  if (plan.status !== "APPROVED") {
    throw buildQueueConflictForPlanStatus(plan.status);
  }

  const safePlan = resolvePlanSafePlan(plan);
  if (safePlan.executionAvailable !== true) {
    throw createError(
      "TASK_QUEUE_CONFLICT",
      "Cannot queue task because automatic execution is unavailable for this plan.",
      409
    );
  }

  const deviceId = resolveAffectedDeviceIdFromSafePlan(plan);
  if (!deviceId) {
    throw createError(
      "TASK_QUEUE_CONFLICT",
      "Cannot queue task because no endpoint device is linked to this plan.",
      409
    );
  }

  const device = await prisma.endpointDevice.findUnique({
    where: { id: deviceId },
  });

  if (!device) {
    throw createError("DEVICE_NOT_FOUND", "Endpoint device was not found.", 404);
  }

  if (device.is_agent_enabled === false || device.agent_status === "DISABLED") {
    throw createError("DEVICE_DISABLED", "Endpoint device is disabled.", 403);
  }

  if (device.agent_status !== "ONLINE") {
    throw createError(
      "TASK_QUEUE_CONFLICT",
      "Cannot queue task because the endpoint device is not online.",
      409
    );
  }

  const normalizedSteps = normalizeSafePlanSteps(safePlan);
  if (normalizedSteps.length < 1) {
    throw createError("TASK_QUEUE_CONFLICT", "Cannot queue task because the plan has no executable steps.", 409);
  }

  const createdTask = await prisma.$transaction(async (tx) => {
    const task = await tx.agentTask.create({
      data: {
        plan_id: normalizedPlanId,
        ticket_id: plan.ticket_id,
        device_id: deviceId,
        status: TASK_STATUS.QUEUED,
        created_by_user_id: normalizedActor.userId,
        created_by_role: normalizedActor.role,
      },
    });

    await tx.agentTaskStep.createMany({
      data: normalizedSteps.map((step) => ({
        task_id: task.id,
        step_order: step.step_order,
        action_key: step.action_key,
        description: step.description,
        params: step.params,
        status: "PENDING",
      })),
    });

    await tx.agenticRemediationPlan.update({
      where: { id: normalizedPlanId },
      data: {
        status: "EXECUTION_QUEUED",
      },
    });

    return tx.agentTask.findUnique({
      where: { id: task.id },
      include: {
        steps: {
          orderBy: { step_order: "asc" },
        },
      },
    });
  });

  return createdTask;
}

async function getTaskById(taskId) {
  return getTaskOrThrow(taskId);
}

async function listTasksByDevice(deviceId) {
  const normalizedDeviceId = ensureId(deviceId, "deviceId");

  return prisma.agentTask.findMany({
    where: { device_id: normalizedDeviceId },
    include: {
      steps: {
        orderBy: { step_order: "asc" },
      },
    },
    orderBy: { created_at: "desc" },
  });
}

async function listTasksByPlan(planId) {
  const normalizedPlanId = ensureId(planId, "planId");

  return prisma.agentTask.findMany({
    where: { plan_id: normalizedPlanId },
    include: {
      steps: {
        orderBy: { step_order: "asc" },
      },
    },
    orderBy: { created_at: "desc" },
  });
}

async function listTasksByTicket(ticketId) {
  const normalizedTicketId = ensureId(ticketId, "ticketId");

  return prisma.agentTask.findMany({
    where: { ticket_id: normalizedTicketId },
    include: {
      steps: {
        orderBy: { step_order: "asc" },
      },
    },
    orderBy: { created_at: "desc" },
  });
}

async function getPendingTasksForDevice(deviceId) {
  const normalizedDeviceId = ensureId(deviceId, "deviceId");

  return prisma.agentTask.findMany({
    where: {
      device_id: normalizedDeviceId,
      status: {
        in: [TASK_STATUS.QUEUED, TASK_STATUS.CLAIMED],
      },
    },
    include: {
      steps: {
        orderBy: { step_order: "asc" },
      },
    },
    orderBy: { created_at: "asc" },
  });
}

async function claimTask(taskId, deviceId) {
  const normalizedTaskId = ensureId(taskId, "taskId");
  const normalizedDeviceId = ensureId(deviceId, "deviceId");
  const task = await getTaskOrThrow(normalizedTaskId);

  ensureTaskDeviceMatches(task, normalizedDeviceId);
  ensureTaskCanTransition(task, [TASK_STATUS.QUEUED], "claimed");

  await prisma.agentTask.update({
    where: { id: normalizedTaskId },
    data: {
      status: TASK_STATUS.CLAIMED,
      claimed_at: new Date(),
    },
  });

  return getTaskOrThrow(normalizedTaskId);
}

async function startTask(taskId, deviceId) {
  const normalizedTaskId = ensureId(taskId, "taskId");
  const normalizedDeviceId = ensureId(deviceId, "deviceId");
  const task = await getTaskOrThrow(normalizedTaskId);

  ensureTaskDeviceMatches(task, normalizedDeviceId);
  ensureTaskCanTransition(task, [TASK_STATUS.QUEUED, TASK_STATUS.CLAIMED], "started");

  await prisma.agentTask.update({
    where: { id: normalizedTaskId },
    data: {
      status: TASK_STATUS.RUNNING,
      claimed_at: task.claimed_at || new Date(),
      started_at: new Date(),
    },
  });

  return getTaskOrThrow(normalizedTaskId);
}

async function submitTaskStepResult(taskId, stepId, deviceId, result) {
  const normalizedTaskId = ensureId(taskId, "taskId");
  const normalizedStepId = ensureId(stepId, "stepId");
  const normalizedDeviceId = ensureId(deviceId, "deviceId");
  const payload = result && typeof result === "object" && !Array.isArray(result) ? result : {};

  const task = await getTaskOrThrow(normalizedTaskId);
  ensureTaskDeviceMatches(task, normalizedDeviceId);
  ensureTaskCanTransition(task, [TASK_STATUS.CLAIMED, TASK_STATUS.RUNNING], "updated with step results");

  const step = await prisma.agentTaskStep.findUnique({
    where: { id: normalizedStepId },
  });

  if (!step || step.task_id !== normalizedTaskId) {
    throw createError("TASK_NOT_FOUND", `Task step not found for task: ${normalizedTaskId}`, 404);
  }

  const stepStatus = parseStepStatus(payload.status);
  const startedAt = parseDateOrNull(payload.startedAt ?? payload.started_at);
  const completedAt = parseDateOrNull(payload.completedAt ?? payload.completed_at) || new Date();

  const updateData = {
    status: stepStatus,
    output: toOptionalString(payload.output),
    error_message: toOptionalString(payload.errorMessage ?? payload.error_message),
    completed_at: completedAt,
  };

  if (startedAt) {
    updateData.started_at = startedAt;
  } else if (!step.started_at) {
    updateData.started_at = new Date();
  }

  const updatedStep = await prisma.$transaction(async (tx) => {
    const nextStep = await tx.agentTaskStep.update({
      where: { id: normalizedStepId },
      data: updateData,
    });

    if (task.status === TASK_STATUS.CLAIMED) {
      await tx.agentTask.update({
        where: { id: normalizedTaskId },
        data: {
          status: TASK_STATUS.RUNNING,
          started_at: task.started_at || new Date(),
        },
      });
    }

    return nextStep;
  });

  return updatedStep;
}

async function completeTask(taskId, deviceId, completion) {
  const normalizedTaskId = ensureId(taskId, "taskId");
  const normalizedDeviceId = ensureId(deviceId, "deviceId");
  const completionPayload = completion && typeof completion === "object" && !Array.isArray(completion) ? completion : {};

  const task = await getTaskOrThrow(normalizedTaskId);
  ensureTaskDeviceMatches(task, normalizedDeviceId);
  ensureTaskCanTransition(
    task,
    [TASK_STATUS.QUEUED, TASK_STATUS.CLAIMED, TASK_STATUS.RUNNING],
    "completed"
  );

  const taskSteps = await prisma.agentTaskStep.findMany({
    where: { task_id: normalizedTaskId },
  });

  const hasFailedStep = taskSteps.some((step) => step.status === "FAILED");
  const finalStatus = hasFailedStep ? TASK_STATUS.FAILED : TASK_STATUS.COMPLETED;

  const failureReason =
    toOptionalString(completionPayload.failureReason ?? completionPayload.failure_reason) ||
    (finalStatus === TASK_STATUS.FAILED ? "One or more task steps failed." : null);

  await prisma.$transaction(async (tx) => {
    await tx.agentTask.update({
      where: { id: normalizedTaskId },
      data: {
        status: finalStatus,
        completed_at: new Date(),
        failure_reason: finalStatus === TASK_STATUS.FAILED ? failureReason : null,
      },
    });

    await tx.agenticRemediationPlan.update({
      where: { id: task.plan_id },
      data: {
        status: finalStatus === TASK_STATUS.FAILED ? "FAILED" : "COMPLETED",
      },
    });
  });

  return getTaskOrThrow(normalizedTaskId);
}

module.exports = {
  queueTaskFromApprovedPlan,
  getTaskById,
  listTasksByDevice,
  listTasksByPlan,
  listTasksByTicket,
  getPendingTasksForDevice,
  claimTask,
  startTask,
  submitTaskStepResult,
  completeTask,
};
