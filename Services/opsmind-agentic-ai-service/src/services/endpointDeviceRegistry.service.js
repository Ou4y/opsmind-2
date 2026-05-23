const prisma = require("../db/prisma");

const ALLOWED_OS_TYPES = new Set(["MACOS", "WINDOWS", "LINUX", "UNKNOWN"]);
const ALLOWED_AGENT_STATUSES = new Set(["ONLINE", "OFFLINE", "DISABLED"]);

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

function createDeviceNotFoundError() {
  return createError("DEVICE_NOT_FOUND", 404, "Endpoint device was not found.");
}

function createDeviceDisabledError() {
  return createError("DEVICE_DISABLED", 403, "Endpoint device is disabled.");
}

function normalizeOsType(osType) {
  const normalized = toOptionalString(osType)?.toUpperCase().replace(/[\s-]+/g, "_") || "UNKNOWN";
  return ALLOWED_OS_TYPES.has(normalized) ? normalized : "UNKNOWN";
}

function normalizeAgentStatus(status) {
  const normalized = toOptionalString(status)?.toUpperCase().replace(/[\s-]+/g, "_");
  if (!normalized) {
    return null;
  }

  return ALLOWED_AGENT_STATUSES.has(normalized) ? normalized : null;
}

function ensureAuthenticatedUserId(auth) {
  const userId = toOptionalString(auth?.userId);
  if (!userId) {
    throw createValidationError("Authenticated userId is required.");
  }
  return userId;
}

function ensureDeviceName(input) {
  const deviceName = toOptionalString(input?.deviceName);
  if (!deviceName) {
    throw createValidationError("deviceName is required.");
  }
  return deviceName;
}

function ensureDeviceId(deviceId) {
  const normalizedDeviceId = toOptionalString(deviceId);
  if (!normalizedDeviceId) {
    throw createValidationError("deviceId is required.");
  }
  return normalizedDeviceId;
}

async function getEndpointDeviceById(deviceId) {
  const normalizedDeviceId = ensureDeviceId(deviceId);
  const device = await prisma.endpointDevice.findUnique({
    where: { id: normalizedDeviceId },
  });

  if (!device) {
    throw createDeviceNotFoundError();
  }

  return device;
}

async function registerEndpointDevice(auth, input) {
  const userId = ensureAuthenticatedUserId(auth);
  const payload = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const deviceName = ensureDeviceName(payload);

  return prisma.endpointDevice.create({
    data: {
      user_id: userId,
      device_name: deviceName,
      os_type: normalizeOsType(payload.osType),
      agent_version: toOptionalString(payload.agentVersion),
      agent_status: "ONLINE",
      last_seen_at: new Date(),
      is_agent_enabled: true,
    },
  });
}

async function heartbeatEndpointDevice(deviceId, input) {
  const normalizedDeviceId = ensureDeviceId(deviceId);
  const payload = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const device = await getEndpointDeviceById(normalizedDeviceId);

  if (device.is_agent_enabled === false || device.agent_status === "DISABLED") {
    throw createDeviceDisabledError();
  }

  const data = {
    agent_status: "ONLINE",
    last_seen_at: new Date(),
  };

  const agentVersion = toOptionalString(payload.agentVersion);
  if (agentVersion) {
    data.agent_version = agentVersion;
  }

  return prisma.endpointDevice.update({
    where: { id: normalizedDeviceId },
    data,
  });
}

async function listEndpointDevicesByAuthenticatedUser(auth) {
  const userId = ensureAuthenticatedUserId(auth);

  return prisma.endpointDevice.findMany({
    where: { user_id: userId },
    orderBy: [{ last_seen_at: "desc" }, { registered_at: "desc" }],
  });
}

async function listAllEndpointDevices(filters = {}) {
  const payload = filters && typeof filters === "object" && !Array.isArray(filters) ? filters : {};
  const where = {};

  const status = normalizeAgentStatus(payload.status);
  if (status) {
    where.agent_status = status;
  }

  const osType = normalizeOsType(payload.osType);
  if (toOptionalString(payload.osType)) {
    where.os_type = osType;
  }

  const userId = toOptionalString(payload.userId);
  if (userId) {
    where.user_id = userId;
  }

  return prisma.endpointDevice.findMany({
    where,
    orderBy: [{ last_seen_at: "desc" }, { registered_at: "desc" }],
  });
}

async function disableEndpointDevice(deviceId) {
  const normalizedDeviceId = ensureDeviceId(deviceId);
  await getEndpointDeviceById(normalizedDeviceId);

  return prisma.endpointDevice.update({
    where: { id: normalizedDeviceId },
    data: {
      is_agent_enabled: false,
      agent_status: "DISABLED",
    },
  });
}

async function enableEndpointDevice(deviceId) {
  const normalizedDeviceId = ensureDeviceId(deviceId);
  await getEndpointDeviceById(normalizedDeviceId);

  return prisma.endpointDevice.update({
    where: { id: normalizedDeviceId },
    data: {
      is_agent_enabled: true,
      // Development/demo behavior: mark ONLINE immediately on enable.
      // Production should use real heartbeat to determine online status.
      agent_status: "ONLINE",
      last_seen_at: new Date(),
    },
  });
}

module.exports = {
  registerEndpointDevice,
  heartbeatEndpointDevice,
  getEndpointDeviceById,
  listEndpointDevicesByAuthenticatedUser,
  listAllEndpointDevices,
  disableEndpointDevice,
  enableEndpointDevice,
};
