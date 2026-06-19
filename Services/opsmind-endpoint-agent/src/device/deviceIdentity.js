const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const AGENT_DIRECTORY_PATH = path.join(os.homedir(), ".opsmind-agent");
const DEVICE_IDENTITY_FILE_PATH = path.join(AGENT_DIRECTORY_PATH, "config.json");

function toOptionalString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function buildIdentityFromDevice(device, fallback) {
  const nowIso = new Date().toISOString();

  return {
    deviceId: toOptionalString(device?.id),
    deviceName: toOptionalString(device?.device_name || device?.deviceName || fallback?.deviceName) || "Unknown Device",
    osType: toOptionalString(device?.os_type || device?.osType || fallback?.osType) || "UNKNOWN",
    registeredAt: toOptionalString(device?.registered_at || device?.registeredAt) || nowIso,
    lastSeenAt: nowIso,
  };
}

function createDeviceIdentityService({ logger }) {
  async function ensureDirectory() {
    await fs.mkdir(AGENT_DIRECTORY_PATH, { recursive: true });
  }

  async function loadIdentity() {
    try {
      const raw = await fs.readFile(DEVICE_IDENTITY_FILE_PATH, "utf8");
      const parsed = JSON.parse(raw);

      const normalized = {
        deviceId: toOptionalString(parsed?.deviceId),
        deviceName: toOptionalString(parsed?.deviceName),
        osType: toOptionalString(parsed?.osType),
        registeredAt: toOptionalString(parsed?.registeredAt),
        lastSeenAt: toOptionalString(parsed?.lastSeenAt),
      };

      if (!normalized.deviceId) {
        logger.warn("Local device identity exists but is invalid. Ignoring it.", {
          identityPath: DEVICE_IDENTITY_FILE_PATH,
        });
        return null;
      }

      return normalized;
    } catch (error) {
      if (error?.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  async function saveIdentity(identity) {
    await ensureDirectory();
    await fs.writeFile(DEVICE_IDENTITY_FILE_PATH, `${JSON.stringify(identity, null, 2)}\n`, "utf8");
    return identity;
  }

  async function updateLastSeen(identity) {
    const updated = {
      ...identity,
      lastSeenAt: new Date().toISOString(),
    };

    await saveIdentity(updated);
    return updated;
  }

  return {
    getIdentityPath() {
      return DEVICE_IDENTITY_FILE_PATH;
    },
    buildIdentityFromDevice,
    loadIdentity,
    saveIdentity,
    updateLastSeen,
  };
}

module.exports = {
  createDeviceIdentityService,
};
