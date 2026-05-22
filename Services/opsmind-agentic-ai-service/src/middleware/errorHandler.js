function notFoundHandler(_req, res) {
  res.status(404).json({
    success: false,
    message: "Route not found.",
  });
}

function errorHandler(error, _req, res, _next) {
  const nodeEnv = process.env.NODE_ENV || "development";

  let statusCode = Number(error?.statusCode) || 500;
  let message = "Internal server error.";

  if (error?.code === "VALIDATION_ERROR") {
    statusCode = 400;
    message = error.message || "Validation failed.";
  } else if (error?.code === "ACTOR_REQUIRED") {
    statusCode = 400;
    message =
      error.message ||
      "Actor userId is required for approving or rejecting AI remediation plans.";
  } else if (error?.code === "AUTH_FORBIDDEN") {
    statusCode = 403;
    message =
      error.message ||
      "Only support staff or administrators can approve or reject AI remediation plans.";
  } else if (error?.code === "DEVICE_NOT_FOUND") {
    statusCode = 404;
    message = error.message || "Endpoint device was not found.";
  } else if (error?.code === "DEVICE_DISABLED") {
    statusCode = 403;
    message = error.message || "Endpoint device is disabled.";
  } else if (error?.code === "DEVICE_MISMATCH") {
    statusCode = 403;
    message = error.message || "You are not allowed to access this endpoint device.";
  } else if (error?.code === "EXECUTION_NOT_FOUND") {
    statusCode = 404;
    message = error.message || "Mock execution was not found.";
  } else if (error?.code === "EXECUTION_CONFLICT" || error?.code === "PLAN_NOT_APPROVED") {
    statusCode = 409;
    message = error.message || "Mock execution could not be started for this plan.";
  } else if (error?.code === "TASK_NOT_FOUND") {
    statusCode = 404;
    message = error.message || "Agent task was not found.";
  } else if (error?.code === "TASK_QUEUE_CONFLICT") {
    statusCode = 409;
    message = error.message || "Agent task queue conflict.";
  } else if (error?.code === "TASK_STATUS_CONFLICT") {
    statusCode = 409;
    message = error.message || "Invalid agent task status transition.";
  } else if (error?.code === "PLAN_NOT_FOUND") {
    statusCode = 404;
    message = error.message || "Remediation plan was not found.";
  } else if (error?.code === "INVALID_PLAN_STATUS_TRANSITION") {
    statusCode = 409;
    message = error.message || "Invalid remediation plan status transition.";
  } else if (error?.code === "OLLAMA_UNAVAILABLE") {
    statusCode = 503;
    message =
      "Ollama is not available. Make sure Ollama is running and gemma3:4b is installed.";
  } else if (error?.code === "MODEL_PARSE_FAILURE" || error?.code === "RAW_PLAN_INVALID") {
    statusCode = 502;
    message = error.message || "Failed to parse or validate the model response.";
  } else if (error?.code === "P2025") {
    statusCode = 404;
    message = "Requested record was not found.";
  }

  const responsePayload = {
    success: false,
    message,
  };

  if (error?.code) {
    responsePayload.code = error.code;
  }

  if (nodeEnv === "development" && error?.stack) {
    responsePayload.stack = error.stack;
  }

  res.status(statusCode).json(responsePayload);
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
