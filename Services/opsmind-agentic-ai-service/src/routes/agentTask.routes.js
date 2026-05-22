const express = require("express");

const { authenticateRequest } = require("../middleware/authenticateRequest");
const { isSupportOrAdminRole } = require("../middleware/requireSupportRole");
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
  const body = toObjectPayload(req.body);
  const actorPayload =
    body.actor && typeof body.actor === "object" && !Array.isArray(body.actor) ? body.actor : {};

  return {
    userId: toOptionalString(actorPayload.userId ?? req.headers["x-user-id"] ?? req.auth?.userId),
    role: toOptionalString(actorPayload.role ?? req.headers["x-user-role"] ?? resolveRoleFromJwt(req)),
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
        400,
        "Actor userId is required for queueing AI remediation plan tasks."
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

// Development agent task endpoints. Production should replace this with device-token authentication.
router.get("/api/agentic-ai/agent/tasks/pending", handleGetPendingTasksForDevice);
router.post("/api/agentic-ai/agent/tasks/:taskId/claim", requireDeviceIdHeader, handleClaimTask);
router.post("/api/agentic-ai/agent/tasks/:taskId/start", requireDeviceIdHeader, handleStartTask);
router.post(
  "/api/agentic-ai/agent/tasks/:taskId/steps/:stepId/result",
  requireDeviceIdHeader,
  handleSubmitTaskStepResult
);
router.post("/api/agentic-ai/agent/tasks/:taskId/complete", requireDeviceIdHeader, handleCompleteTask);

module.exports = router;
