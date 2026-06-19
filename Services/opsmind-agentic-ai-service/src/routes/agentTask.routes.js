const express = require("express");

const { authenticateRequest } = require("../middleware/authenticateRequest");
const { isSupportOrAdminRole } = require("../middleware/requireSupportRole");
const {
  aiApprovalActionLimiter,
  agentDeviceActionLimiter,
} = require("../middleware/rateLimiters");
const { getEndpointDeviceById } = require("../services/endpointDeviceRegistry.service");
const {
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
} = require("../services/agentTaskQueue.service");

const router = express.Router();

function toOptionalString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function createError(code, statusCode, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function createValidationError(message) {
  return createError("VALIDATION_ERROR", 400, message);
}

function createAuthForbiddenError(message) {
  return createError("AUTH_FORBIDDEN", 403, message);
}

function toObjectPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function resolveRoleFromJwt(req) {
  const roles = Array.isArray(req.auth?.roles) ? req.auth.roles : [];
  const supportRole = roles.find((role) => isSupportOrAdminRole([role]));
  return toOptionalString(supportRole || roles[0]);
}

function resolveActor(req) {
  return {
    userId: toOptionalString(req.auth?.userId),
    role: resolveRoleFromJwt(req),
  };
}

function requireAuthenticatedSupportRole(req, _res, next) {
  if (!isSupportOrAdminRole(req.auth?.roles || [])) {
    return next(
      createAuthForbiddenError("Only support staff or administrators can access agent task queue endpoints.")
    );
  }

  return next();
}

function requireActorForQueue(req, _res, next) {
  const actor = resolveActor(req);

  if (!actor.userId) {
    return next(
      createError(
        "ACTOR_REQUIRED",
        401,
        "Authenticated actor userId is required for queueing AI remediation plan tasks."
      )
    );
  }

  req.supportActor = actor;
  return next();
}

function resolveDeviceIdForPending(req) {
  return toOptionalString(req.query.deviceId ?? req.query.device_id ?? req.headers["x-device-id"]);
}

function requireDeviceIdHeader(req, _res, next) {
  const deviceId = toOptionalString(req.headers["x-device-id"]);
  if (!deviceId) {
    return next(createValidationError("x-device-id header is required."));
  }

  req.deviceId = deviceId;
  return next();
}

function requireDeviceModeAccess(req, _res, next) {
  const nodeEnv = String(process.env.NODE_ENV || "development");
  const explicitlyEnabled = String(process.env.ENABLE_AGENT_DEVICE_ENDPOINTS || "false") === "true";
  const expectedDeviceToken = String(process.env.ENDPOINT_AGENT_SHARED_SECRET || "").trim();
  const providedDeviceToken = String(req.headers["x-device-token"] || "").trim();

  if (nodeEnv !== "development" && !explicitlyEnabled) {
    return next(
      createAuthForbiddenError(
        "Endpoint-agent task endpoints are disabled outside development. Set ENABLE_AGENT_DEVICE_ENDPOINTS=true to enable."
      )
    );
  }

  if (expectedDeviceToken) {
    if (!providedDeviceToken || providedDeviceToken !== expectedDeviceToken) {
      return next(createAuthForbiddenError("Invalid endpoint-agent device token."));
    }
  } else if (nodeEnv !== "development") {
    return next(
      createAuthForbiddenError(
        "ENDPOINT_AGENT_SHARED_SECRET is required when endpoint-agent task endpoints are enabled outside development."
      )
    );
  }

  return next();
}

async function requireDeviceOwnerOrSupport(req, _res, next) {
  try {
    const resolvedDeviceId = toOptionalString(req.deviceId || resolveDeviceIdForPending(req));
    if (!resolvedDeviceId) {
      throw createValidationError("deviceId is required.");
    }

    const device = await getEndpointDeviceById(resolvedDeviceId);
    const authenticatedUserId = toOptionalString(req.auth?.userId);
    const isSupport = isSupportOrAdminRole(req.auth?.roles || []);
    const isOwner = Boolean(authenticatedUserId && authenticatedUserId === String(device.user_id || ""));

    if (!isOwner && !isSupport) {
      throw createAuthForbiddenError("You are not allowed to operate on this endpoint device tasks.");
    }

    req.deviceId = resolvedDeviceId;
    return next();
  } catch (error) {
    return next(error);
  }
}

async function handleQueueTask(req, res, next) {
  try {
    const task = await queueTaskFromApprovedPlan(req.params.planId, req.supportActor);

    return res.status(200).json({
      success: true,
      task,
      message: "Agent task queued. No real execution has been performed.",
    });
  } catch (error) {
    return next(error);
  }
}

async function handleGetTaskById(req, res, next) {
  try {
    const task = await getTaskById(req.params.taskId);

    return res.status(200).json({
      success: true,
      task,
    });
  } catch (error) {
    return next(error);
  }
}

async function handleListTasksByPlan(req, res, next) {
  try {
    const tasks = await listTasksByPlan(req.params.planId);

    return res.status(200).json({
      success: true,
      tasks,
    });
  } catch (error) {
    return next(error);
  }
}

async function handleListTasksByTicket(req, res, next) {
  try {
    const tasks = await listTasksByTicket(req.params.ticketId);

    return res.status(200).json({
      success: true,
      tasks,
    });
  } catch (error) {
    return next(error);
  }
}

async function handleListTasksByDevice(req, res, next) {
  try {
    const tasks = await listTasksByDevice(req.params.deviceId);

    return res.status(200).json({
      success: true,
      tasks,
    });
  } catch (error) {
    return next(error);
  }
}

async function handleGetPendingTasksForDevice(req, res, next) {
  try {
    const deviceId = resolveDeviceIdForPending(req);
    if (!deviceId) {
      throw createValidationError("deviceId query param is required.");
    }

    const tasks = await getPendingTasksForDevice(deviceId);

    return res.status(200).json({
      success: true,
      tasks,
    });
  } catch (error) {
    return next(error);
  }
}

async function handleClaimTask(req, res, next) {
  try {
    const task = await claimTask(req.params.taskId, req.deviceId);

    return res.status(200).json({
      success: true,
      task,
    });
  } catch (error) {
    return next(error);
  }
}

async function handleStartTask(req, res, next) {
  try {
    const task = await startTask(req.params.taskId, req.deviceId);

    return res.status(200).json({
      success: true,
      task,
    });
  } catch (error) {
    return next(error);
  }
}

async function handleSubmitTaskStepResult(req, res, next) {
  try {
    const body = toObjectPayload(req.body);
    const step = await submitTaskStepResult(req.params.taskId, req.params.stepId, req.deviceId, body);

    return res.status(200).json({
      success: true,
      step,
    });
  } catch (error) {
    return next(error);
  }
}

async function handleCompleteTask(req, res, next) {
  try {
    const body = toObjectPayload(req.body);
    const task = await completeTask(req.params.taskId, req.deviceId, body);

    return res.status(200).json({
      success: true,
      task,
    });
  } catch (error) {
    return next(error);
  }
}

router.post(
  "/api/agentic-ai/remediation-plans/:planId/queue-task",
  aiApprovalActionLimiter,
  authenticateRequest,
  requireAuthenticatedSupportRole,
  requireActorForQueue,
  handleQueueTask
);

router.get(
  "/api/agentic-ai/agent-tasks/:taskId",
  authenticateRequest,
  requireAuthenticatedSupportRole,
  handleGetTaskById
);
router.get(
  "/api/agentic-ai/remediation-plans/:planId/agent-tasks",
  authenticateRequest,
  requireAuthenticatedSupportRole,
  handleListTasksByPlan
);
router.get(
  "/api/agentic-ai/tickets/:ticketId/agent-tasks",
  authenticateRequest,
  requireAuthenticatedSupportRole,
  handleListTasksByTicket
);
router.get(
  "/api/agentic-ai/endpoint-devices/:deviceId/agent-tasks",
  authenticateRequest,
  requireAuthenticatedSupportRole,
  handleListTasksByDevice
);

router.get(
  "/api/agentic-ai/agent/tasks/pending",
  agentDeviceActionLimiter,
  authenticateRequest,
  requireDeviceModeAccess,
  requireDeviceOwnerOrSupport,
  handleGetPendingTasksForDevice
);
router.post(
  "/api/agentic-ai/agent/tasks/:taskId/claim",
  agentDeviceActionLimiter,
  authenticateRequest,
  requireDeviceModeAccess,
  requireDeviceIdHeader,
  requireDeviceOwnerOrSupport,
  handleClaimTask
);
router.post(
  "/api/agentic-ai/agent/tasks/:taskId/start",
  agentDeviceActionLimiter,
  authenticateRequest,
  requireDeviceModeAccess,
  requireDeviceIdHeader,
  requireDeviceOwnerOrSupport,
  handleStartTask
);
router.post(
  "/api/agentic-ai/agent/tasks/:taskId/steps/:stepId/result",
  agentDeviceActionLimiter,
  authenticateRequest,
  requireDeviceModeAccess,
  requireDeviceIdHeader,
  requireDeviceOwnerOrSupport,
  handleSubmitTaskStepResult
);
router.post(
  "/api/agentic-ai/agent/tasks/:taskId/complete",
  agentDeviceActionLimiter,
  authenticateRequest,
  requireDeviceModeAccess,
  requireDeviceIdHeader,
  requireDeviceOwnerOrSupport,
  handleCompleteTask
);

module.exports = router;
