const express = require("express");

const { checkOllamaReady } = require("../services/ollamaClient.service");

const router = express.Router();

function getServiceName() {
  return process.env.SERVICE_NAME || "opsmind-agentic-ai-service";
}

function getModelName() {
  return process.env.OLLAMA_MODEL || "gemma3:4b";
}

router.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: getServiceName(),
  });
});

router.get("/health/ready", async (_req, res) => {
  const isReady = await checkOllamaReady();

  if (isReady) {
    return res.status(200).json({
      status: "ready",
      service: getServiceName(),
      ollama: "connected",
      model: getModelName(),
    });
  }

  return res.status(503).json({
    status: "not_ready",
    service: getServiceName(),
    ollama: "unavailable",
    message: "Ollama is not available. Make sure Ollama is running and gemma3:4b is installed.",
  });
});

module.exports = router;
