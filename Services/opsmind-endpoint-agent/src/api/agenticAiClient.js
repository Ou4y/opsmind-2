const axios = require("axios");

function createApiError(error, defaultMessage) {
  if (error && error.isOpsmindAgentApiError) {
    return error;
  }

  const status = Number(error?.response?.status || 0) || null;
  const payload = error?.response?.data && typeof error.response.data === "object" ? error.response.data : {};
  const code = payload?.code || null;
  const message = payload?.message || error?.message || defaultMessage || "Agentic AI API request failed.";

  const apiError = new Error(message);
  apiError.isOpsmindAgentApiError = true;
  apiError.status = status;
  apiError.code = code;
  apiError.payload = payload;

  return apiError;
}

function createAgenticAiClient({ baseUrl, jwt, timeoutMs, endpointAgentSharedSecret }) {
  const httpClient = axios.create({
    baseURL: String(baseUrl || "").replace(/\/+$/, ""),
    timeout: Number(timeoutMs) || 15000,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
  });

  async function request(method, path, options = {}) {
    try {
      const response = await httpClient.request({
        method,
        url: path,
        params: options.params,
        data: options.data,
        headers: options.headers,
      });

      const payload = response?.data && typeof response.data === "object" ? response.data : {};
      if (payload.success === false) {
        throw createApiError({ response: { status: response.status, data: payload } }, options.defaultMessage);
      }

      return payload;
    } catch (error) {
      throw createApiError(error, options.defaultMessage);
    }
  }

  function deviceHeader(deviceId) {
    const headers = {
      "x-device-id": String(deviceId || "").trim(),
    };

    if (endpointAgentSharedSecret) {
      headers["x-device-token"] = String(endpointAgentSharedSecret).trim();
    }

    return headers;
  }

  return {
    async registerEndpointDevice({ deviceName, osType, agentVersion }) {
      const payload = await request("POST", "/api/agentic-ai/endpoint-devices/register", {
        data: {
          deviceName,
          osType,
          agentVersion,
        },
        defaultMessage: "Failed to register endpoint device.",
      });

      return payload.device || null;
    },

    async heartbeatEndpointDevice(deviceId, { agentVersion }) {
      const payload = await request(
        "POST",
        `/api/agentic-ai/endpoint-devices/${encodeURIComponent(String(deviceId))}/heartbeat`,
        {
          data: {
            agentVersion,
          },
          defaultMessage: "Failed to send endpoint heartbeat.",
        }
      );

      return payload.device || null;
    },

    async getPendingTasksForDevice(deviceId) {
      const normalizedDeviceId = String(deviceId || "").trim();
      const payload = await request("GET", "/api/agentic-ai/agent/tasks/pending", {
        params: {
          deviceId: normalizedDeviceId,
        },
        headers: deviceHeader(normalizedDeviceId),
        defaultMessage: "Failed to fetch pending tasks for endpoint device.",
      });

      return Array.isArray(payload.tasks) ? payload.tasks : [];
    },

    async claimTask(taskId, deviceId) {
      const payload = await request(
        "POST",
        `/api/agentic-ai/agent/tasks/${encodeURIComponent(String(taskId))}/claim`,
        {
          headers: deviceHeader(deviceId),
          defaultMessage: "Failed to claim task.",
        }
      );

      return payload.task || null;
    },

    async startTask(taskId, deviceId) {
      const payload = await request(
        "POST",
        `/api/agentic-ai/agent/tasks/${encodeURIComponent(String(taskId))}/start`,
        {
          headers: deviceHeader(deviceId),
          defaultMessage: "Failed to start task.",
        }
      );

      return payload.task || null;
    },

    async submitTaskStepResult(taskId, stepId, deviceId, result) {
      const payload = await request(
        "POST",
        `/api/agentic-ai/agent/tasks/${encodeURIComponent(String(taskId))}/steps/${encodeURIComponent(String(stepId))}/result`,
        {
          headers: deviceHeader(deviceId),
          data: result,
          defaultMessage: "Failed to submit step result.",
        }
      );

      return payload.step || null;
    },

    async completeTask(taskId, deviceId, completionBody) {
      const payload = await request(
        "POST",
        `/api/agentic-ai/agent/tasks/${encodeURIComponent(String(taskId))}/complete`,
        {
          headers: deviceHeader(deviceId),
          data: completionBody && typeof completionBody === "object" ? completionBody : {},
          defaultMessage: "Failed to complete task.",
        }
      );

      return payload.task || null;
    },
  };
}

module.exports = {
  createAgenticAiClient,
};
