const { loadConfig } = require("./config");
const logger = require("./utils/logger");
const { createAgenticAiClient } = require("./api/agenticAiClient");
const { createDeviceIdentityService } = require("./device/deviceIdentity");
const { createHeartbeatService } = require("./device/heartbeat.service");
const { createTaskRunner } = require("./tasks/taskRunner.service");
const { createTaskPoller } = require("./tasks/taskPoller.service");

async function ensureDeviceIdentity({ client, identityService, config }) {
  let identity = await identityService.loadIdentity();

  if (!identity) {
    logger.info("No local endpoint identity found. Registering this device.", {
      deviceName: config.deviceName,
      deviceOs: config.deviceOs,
      identityPath: identityService.getIdentityPath(),
    });

    const device = await client.registerEndpointDevice({
      deviceName: config.deviceName,
      osType: config.deviceOs,
      agentVersion: config.agentVersion,
    });

    if (!device?.id) {
      throw new Error("Device registration succeeded but no device id was returned.");
    }

    identity = identityService.buildIdentityFromDevice(device, {
      deviceName: config.deviceName,
      osType: config.deviceOs,
    });

    await identityService.saveIdentity(identity);

    logger.info("Device registered and local identity saved.", {
      deviceId: identity.deviceId,
      identityPath: identityService.getIdentityPath(),
    });

    return identity;
  }

  logger.info("Loaded local endpoint identity.", {
    deviceId: identity.deviceId,
    identityPath: identityService.getIdentityPath(),
  });

  try {
    await client.heartbeatEndpointDevice(identity.deviceId, {
      agentVersion: config.agentVersion,
    });

    identity = await identityService.updateLastSeen(identity);
    logger.info("Initial heartbeat check succeeded for stored identity.", {
      deviceId: identity.deviceId,
    });
    return identity;
  } catch (error) {
    if (error?.status === 404 || error?.code === "DEVICE_NOT_FOUND") {
      throw new Error(
        `Stored endpoint identity is stale or missing in backend. Reset local identity with: rm -rf ~/.opsmind-agent`
      );
    }

    if (error?.status === 403 || error?.code === "DEVICE_DISABLED") {
      throw new Error("Stored endpoint device is disabled. Re-enable it from Registered Devices before starting the agent.");
    }

    logger.warn("Initial heartbeat check failed. Continuing with periodic retry loops.", {
      deviceId: identity.deviceId,
      code: error?.code || null,
      status: error?.status || null,
      message: error?.message,
    });

    return identity;
  }
}

async function main() {
  const config = loadConfig();

  logger.info("Starting OpsMind Endpoint Agent MVP.", {
    baseUrl: config.agenticAiBaseUrl,
    deviceName: config.deviceName,
    deviceOs: config.deviceOs,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    pollIntervalMs: config.pollIntervalMs,
  });

  const client = createAgenticAiClient({
    baseUrl: config.agenticAiBaseUrl,
    jwt: config.opsmindJwt,
    timeoutMs: config.httpTimeoutMs,
  });

  const identityService = createDeviceIdentityService({ logger });

  let currentIdentity = await ensureDeviceIdentity({
    client,
    identityService,
    config,
  });

  function getIdentity() {
    return currentIdentity;
  }

  function setIdentity(nextIdentity) {
    currentIdentity = nextIdentity;
  }

  const heartbeatService = createHeartbeatService({
    client,
    identityService,
    getIdentity,
    setIdentity,
    config,
    logger,
  });

  const taskRunner = createTaskRunner({
    client,
    getIdentity,
    logger,
  });

  const taskPoller = createTaskPoller({
    client,
    taskRunner,
    getIdentity,
    config,
    logger,
  });

  heartbeatService.start();
  taskPoller.start();

  logger.info("Endpoint Agent MVP started.", {
    deviceId: currentIdentity.deviceId,
    note: "This MVP executes only allowlisted safe handlers. No download/install actions are performed.",
  });

  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info("Shutdown signal received. Stopping loops.", { signal });

    heartbeatService.stop();
    taskPoller.stop();

    setTimeout(() => {
      logger.info("Endpoint Agent stopped.");
      process.exit(0);
    }, 150);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.error("Endpoint Agent failed to start.", {
    message: error?.message || String(error),
  });
  process.exit(1);
});
