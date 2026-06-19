const rateLimit = require("express-rate-limit");

function buildLimiter(windowMs, max, message) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message,
    },
  });
}

const aiPlanningLimiter = buildLimiter(
  60 * 1000,
  Number(process.env.AI_PLANNING_RATE_LIMIT_MAX || 20),
  "Too many AI planning requests. Please retry shortly."
);

const aiApprovalActionLimiter = buildLimiter(
  5 * 60 * 1000,
  Number(process.env.AI_ACTION_RATE_LIMIT_MAX || 40),
  "Too many sensitive AI action requests. Please retry shortly."
);

const agentDeviceActionLimiter = buildLimiter(
  60 * 1000,
  Number(process.env.AGENT_DEVICE_RATE_LIMIT_MAX || 120),
  "Too many endpoint-agent task requests. Please retry shortly."
);

module.exports = {
  aiPlanningLimiter,
  aiApprovalActionLimiter,
  agentDeviceActionLimiter,
};
