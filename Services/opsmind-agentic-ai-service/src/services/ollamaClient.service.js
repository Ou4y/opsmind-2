const axios = require("axios");

function getOllamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/+$/, "");
}

function getOllamaModel() {
  return process.env.OLLAMA_MODEL || "gemma3:4b";
}

function isOllamaUnavailableError(error) {
  return axios.isAxiosError(error);
}

async function generateWithOllama(prompt) {
  const baseUrl = getOllamaBaseUrl();
  const model = getOllamaModel();

  try {
    const response = await axios.post(
      `${baseUrl}/api/generate`,
      {
        model,
        stream: false,
        format: "json",
        prompt,
      },
      {
        timeout: 60000,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const rawResponse = response?.data?.response;

    if (typeof rawResponse !== "string") {
      const error = new Error("Ollama returned an invalid response payload.");
      error.code = "OLLAMA_INVALID_RESPONSE";
      throw error;
    }

    return rawResponse;
  } catch (error) {
    if (isOllamaUnavailableError(error)) {
      const unavailableError = new Error("Ollama is unavailable.");
      unavailableError.code = "OLLAMA_UNAVAILABLE";
      throw unavailableError;
    }

    throw error;
  }
}

async function checkOllamaReady() {
  const baseUrl = getOllamaBaseUrl();

  try {
    await axios.get(`${baseUrl}/api/tags`, { timeout: 5000 });
    return true;
  } catch (_error) {
    return false;
  }
}

module.exports = {
  generateWithOllama,
  checkOllamaReady,
};
