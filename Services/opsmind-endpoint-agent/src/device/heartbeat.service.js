function createHeartbeatService({ client, identityService, getIdentity, setIdentity, config, logger }) {
  let timerId = null;
  let inProgress = false;

  async function sendHeartbeat() {
    const identity = getIdentity();
    if (!identity?.deviceId) {
      logger.warn("Skipping heartbeat because no device identity is loaded.");
      return;
    }

    if (inProgress) {
      return;
    }

    inProgress = true;

    try {
      const device = await client.heartbeatEndpointDevice(identity.deviceId, {
        agentVersion: config.agentVersion,
      });

      const updatedIdentity = await identityService.updateLastSeen({
        ...identity,
        deviceName: device?.device_name || device?.deviceName || identity.deviceName,
        osType: device?.os_type || device?.osType || identity.osType,
      });

      setIdentity(updatedIdentity);

      logger.info("Heartbeat sent.", {
        deviceId: updatedIdentity.deviceId,
        agentStatus: device?.agent_status || device?.agentStatus || "ONLINE",
      });
    } catch (error) {
      logger.error("Heartbeat failed. Will retry on next interval.", {
        deviceId: identity.deviceId,
        code: error?.code || null,
        status: error?.status || null,
        message: error?.message,
      });
    } finally {
      inProgress = false;
    }
  }

  function start() {
    if (timerId) {
      return;
    }

    sendHeartbeat().catch((error) => {
      logger.error("Initial heartbeat tick failed.", { message: error?.message || String(error) });
    });

    timerId = setInterval(() => {
      sendHeartbeat().catch((error) => {
        logger.error("Heartbeat tick crashed.", { message: error?.message || String(error) });
      });
    }, config.heartbeatIntervalMs);
  }

  function stop() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  return {
    start,
    stop,
    sendHeartbeat,
  };
}

module.exports = {
  createHeartbeatService,
};
