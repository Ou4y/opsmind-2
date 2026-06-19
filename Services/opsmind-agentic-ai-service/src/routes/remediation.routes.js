const express = require("express");

const { generateRemediationPlan } = require("../services/gemmaPlanner.service");
const {
  createRemediationPlanRecord,
  getRemediationPlanById,
  listRemediationPlansByTicket,
  approveRemediationPlan,
  rejectRemediationPlan,
} = require("../services/remediationPlanStore.service");
const {
  startMockExecution,
  getExecutionById,
  listExecutionsByPlan,
  listExecutionsByTicket,
} = require("../services/mockExecution.service");
const { requireSupportRole, isSupportOrAdminRole } = require("../middleware/requireSupportRole");
const { authenticateRequest } = require("../middleware/authenticateRequest");
const {
  aiPlanningLimiter,
  aiApprovalActionLimiter,
} = require("../middleware/rateLimiters");
const {
  registerEndpointDevice,
  heartbeatEndpointDevice,
  getEndpointDeviceById,
  listEndpointDevicesByAuthenticatedUser,
  listAllEndpointDevices,
  disableEndpointDevice,
  enableEndpointDevice,
} = require("../services/endpointDeviceRegistry.service");

const router = express.Router();

function toOptionalString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function createValidationError(message) {
  const error = new Error(message);
  error.code = "VALIDATION_ERROR";
  error.statusCode = 400;
  return error;
}

function createAuthForbiddenError(message) {
  const error = new Error(message);
  error.code = "AUTH_FORBIDDEN";
  error.statusCode = 403;
  return error;
}

function toObjectPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function resolveTicketPayload(req) {
  const body = toObjectPayload(req.body);
  if (body.ticket && typeof body.ticket === "object" && !Array.isArray(body.ticket)) {
    return body.ticket;
  }

  return body;
}

function resolveActor(req, bodyActor) {
  const authRoles = Array.isArray(req.auth?.roles) ? req.auth.roles : [];
  const primaryRole = authRoles.length > 0 ? authRoles[0] : null;

  return {
    userId: toOptionalString(req.auth?.userId),
    role: toOptionalString(primaryRole),
  };
}

function assertDeviceAccessAllowed(auth, device) {
  const authenticatedUserId = toOptionalString(auth?.userId);
  const isOwner = Boolean(authenticatedUserId && device?.user_id === authenticatedUserId);
  const isSupport = isSupportOrAdminRole(auth?.roles || []);

  if (!isOwner && !isSupport) {
    throw createAuthForbiddenError("You are not allowed to access this endpoint device.");
  }
}

function requireAuthenticatedSupportRole(req, _res, next) {
  if (!isSupportOrAdminRole(req.auth?.roles || [])) {
    return next(
      createAuthForbiddenError("Only support staff or administrators can access this endpoint device route.")
    );
  }

  return next();
}

async function handleTestRemediationPlan(req, res, next) {
  try {
    const ticket = resolveTicketPayload(req);
    const { rawPlan, safePlan } = await generateRemediationPlan(ticket);

    return res.status(200).json({
      success: true,
      rawPlan,
      safePlan,
    });
  } catch (error) {
    return next(error);
  }
}

async function handleCreateRemediationPlan(req, res, next) {
  try {
    const ticket = resolveTicketPayload(req);
    const ticketId = toOptionalString(ticket.id ?? ticket.ticketId);

    if (!ticketId) {
      throw createValidationError("ticket.id is required for /api/agentic-ai/remediation-plan.");
    }

    const body = toObjectPayload(req.body);
    const generatedBy = resolveActor(req, body.generatedBy);
    const { rawPlan, safePlan } = await generateRemediationPlan(ticket);

    const savedPlan = await createRemediationPlanRecord({
      ticket: {
        ...ticket,
        id: ticketId,
      },
      rawPlan,
      safePlan,
      generatedBy,
    });

    return res.status(200).json({
      success: true,
      plan: savedPlan,
      rawPlan,
      safePlan,
    });
  } catch (error) {
    return next(error);
  }
}

async function handleGetRemediationPlanById(req, res, next) {
  try {
    const plan = await getRemediationPlanById(req.params.planId);

    return res.status(200).json({
      success: true,
      plan,
    });
  } catch (error) {
    return next(error);
  }
}

async function handleListRemediationPlansByTicket(req, res, next) {
  try {
    const plans = await listRemediationPlansByTicket(req.params.ticketId);

    return res.status(200).json({
      success: true,
      plans,
    });
  } catch (error) {
    return next(error);
  }
}

async function handleApproveRemediationPlan(req, res, next) {
  try {
    const actor = req.supportActor;

    const plan = await approveRemediationPlan(req.params.planId, actor);

    return res.status(200).json({
      success: true,
      plan,
      message: "Plan approved. Execution is not implemented in this phase.",
    });
  } catch (error) {
    return next(error);
  }
}

async function handleRejectRemediationPlan(req, res, next) {
  try {
    const body = toObjectPayload(req.body);
    const actor = req.supportActor;
    const reason = toOptionalString(body.reason);

    const plan = await rejectRemediationPlan(req.params.planId, actor, reason);

    return res.status(200).json({
      success: true,
      plan,
      message: "Plan rejected. Normal manual workflow should continue.",
    });
  } catch (error) {
    return next(error);
  }
}

async function handleStartMockExecution(req, res, next) {
  try {
    const actor = req.supportActor;
    const execution = await startMockExecution(req.params.planId, actor);

    return res.status(200).json({
      success: true,
      execution,
      message: "Mock execution completed. No real machine actions were performed.",
    });
  } catch (error) {
    return next(error);
  }
}

async function handleGetExecutionById(req, res, next) {
  try {
    const execution = await getExecutionById(req.params.executionId);

    return res.status(200).json({
      success: true,
      execution,
    });
  } catch (error) {
    return next(error);
  }
}

async function handleListExecutionsByPlan(req, res, next) {
  try {
    const executions = await listExecutionsByPlan(req.params.planId);

    return res.status(200).json({
      success: true,
      executions,
    });
  } catch (error) {
    return next(error);
  }
}

async function handleListExecutionsByTicket(req, res, next) {
  try {
    const executions = await listExecutionsByTicket(req.params.ticketId);

    return res.status(200).json({
      success: true,
      executions,
    });
  } catch (error) {
    return next(error);
  }
}

async function handleRegisterEndpointDevice(req, res, next) {
  try {
    const payload = toObjectPayload(req.body);
    const device = await registerEndpointDevice(req.auth, {
      deviceName: payload.deviceName,
      osType: payload.osType,
      agentVersion: payload.agentVersion,
    });

    return res.status(201).json({
      success: true,
      device,
    });
  } catch (error) {
    return next(error);
  }
}

async function handleListMyEndpointDevices(req, res, next) {
  try {
    const devices = await listEndpointDevicesByAuthenticatedUser(req.auth);

    return res.status(200).json({
      success: true,
      devices,
    });
  } catch (error) {
    return next(error);
  }
}

async function handleListAllEndpointDevices(req, res, next) {
  try {
    const devices = await listAllEndpointDevices({
      status: req.query.status,
      osType: req.query.osType,
      userId: req.query.userId,
    });

    return res.status(200).json({
      success: true,
      devices,
    });
  } catch (error) {
    return next(error);
  }
}

async function handleHeartbeatEndpointDevice(req, res, next) {
  try {
    const payload = toObjectPayload(req.body);
    const existingDevice = await getEndpointDeviceById(req.params.deviceId);
    assertDeviceAccessAllowed(req.auth, existingDevice);

    const device = await heartbeatEndpointDevice(req.params.deviceId, {
      agentVersion: payload.agentVersion,
    });

    return res.status(200).json({
      success: true,
      device,
    });
  } catch (error) {
    return next(error);
  }
}

async function handleGetEndpointDeviceById(req, res, next) {
  try {
    const device = await getEndpointDeviceById(req.params.deviceId);
    assertDeviceAccessAllowed(req.auth, device);

    return res.status(200).json({
      success: true,
      device,
    });
  } catch (error) {
    return next(error);
  }
}

async function handleDisableEndpointDevice(req, res, next) {
  try {
    const existingDevice = await getEndpointDeviceById(req.params.deviceId);
    assertDeviceAccessAllowed(req.auth, existingDevice);
    const device = await disableEndpointDevice(req.params.deviceId);

    return res.status(200).json({
      success: true,
      device,
    });
  } catch (error) {
    return next(error);
  }
}

async function handleEnableEndpointDevice(req, res, next) {
  try {
    await getEndpointDeviceById(req.params.deviceId);
    const device = await enableEndpointDevice(req.params.deviceId);

    return res.status(200).json({
      success: true,
      device,
    });
  } catch (error) {
    return next(error);
  }
}

router.post(
  "/api/agentic-ai/remediation-plan/test",
  aiPlanningLimiter,
  authenticateRequest,
  handleTestRemediationPlan
);
router.post(
  "/api/agentic-ai/remediation-plan",
  aiPlanningLimiter,
  authenticateRequest,
  handleCreateRemediationPlan
);
router.get("/api/agentic-ai/remediation-plans/:planId", authenticateRequest, handleGetRemediationPlanById);
router.get(
  "/api/agentic-ai/tickets/:ticketId/remediation-plans",
  authenticateRequest,
  handleListRemediationPlansByTicket
);
router.post(
  "/api/agentic-ai/remediation-plans/:planId/approve",
  aiApprovalActionLimiter,
  authenticateRequest,
  requireSupportRole,
  handleApproveRemediationPlan
);
router.post(
  "/api/agentic-ai/remediation-plans/:planId/reject",
  aiApprovalActionLimiter,
  authenticateRequest,
  requireSupportRole,
  handleRejectRemediationPlan
);
router.post(
  "/api/agentic-ai/remediation-plans/:planId/mock-execute",
  aiApprovalActionLimiter,
  authenticateRequest,
  requireSupportRole,
  handleStartMockExecution
);
router.get("/api/agentic-ai/executions/:executionId", authenticateRequest, handleGetExecutionById);
router.get(
  "/api/agentic-ai/remediation-plans/:planId/executions",
  authenticateRequest,
  handleListExecutionsByPlan
);
router.get(
  "/api/agentic-ai/tickets/:ticketId/executions",
  authenticateRequest,
  handleListExecutionsByTicket
);
router.post(
  "/api/agentic-ai/endpoint-devices/register",
  authenticateRequest,
  handleRegisterEndpointDevice
);
router.get(
  "/api/agentic-ai/users/me/endpoint-devices",
  authenticateRequest,
  handleListMyEndpointDevices
);
router.get(
  "/api/agentic-ai/endpoint-devices",
  authenticateRequest,
  requireAuthenticatedSupportRole,
  handleListAllEndpointDevices
);
router.post(
  "/api/agentic-ai/endpoint-devices/:deviceId/heartbeat",
  authenticateRequest,
  handleHeartbeatEndpointDevice
);
router.get(
  "/api/agentic-ai/endpoint-devices/:deviceId",
  authenticateRequest,
  handleGetEndpointDeviceById
);
router.post(
  "/api/agentic-ai/endpoint-devices/:deviceId/disable",
  authenticateRequest,
  handleDisableEndpointDevice
);
router.post(
  "/api/agentic-ai/endpoint-devices/:deviceId/enable",
  authenticateRequest,
  requireAuthenticatedSupportRole,
  handleEnableEndpointDevice
);

module.exports = router;
