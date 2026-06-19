require("dotenv").config();

function toPositiveInt(value, fallback, minimum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < (minimum || 1)) {
    return fallback;
  }

  return parsed;
}

function normalizeBaseUrl(value) {
  const normalized = String(value || "http://localhost:4010").trim();
  if (!normalized) {
    return "http://localhost:4010";
  }

  return normalized.replace(/\/+$/, "");
}

function normalizeDeviceOs(value) {
  const normalized = String(value || "MACOS")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  return normalized || "UNKNOWN";
}

function loadConfig() {
  const config = {
    agenticAiBaseUrl: normalizeBaseUrl(process.env.AGENTIC_AI_BASE_URL),
    opsmindJwt: String(process.env.OPSMIND_JWT || "").trim(),
    endpointAgentSharedSecret: String(process.env.ENDPOINT_AGENT_SHARED_SECRET || "").trim(),
    deviceName: String(process.env.DEVICE_NAME || "OpsMind Endpoint Device").trim(),
    deviceOs: normalizeDeviceOs(process.env.DEVICE_OS),
    heartbeatIntervalMs: toPositiveInt(process.env.HEARTBEAT_INTERVAL_MS, 30000, 2000),
    pollIntervalMs: toPositiveInt(process.env.POLL_INTERVAL_MS, 10000, 2000),
    httpTimeoutMs: toPositiveInt(process.env.HTTP_TIMEOUT_MS, 15000, 1000),
    agentVersion: String(process.env.AGENT_VERSION || "endpoint-agent-mvp-0.1.0").trim(),
  };

  if (!config.opsmindJwt || config.opsmindJwt === "copy_logged_in_user_jwt_here") {
    throw new Error("OPSMIND_JWT is required. Copy a logged-in user JWT into .env before starting the agent.");
  }

  if (!config.deviceName) {
    throw new Error("DEVICE_NAME is required.");
  }

  return config;
}

module.exports = {
  loadConfig,
};
