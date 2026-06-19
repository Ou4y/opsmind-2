const collectSystemInfoHandler = require("./collectSystemInfo.handler");
const checkConnectivityHandler = require("./checkConnectivity.handler");
const checkDiskSpaceHandler = require("./checkDiskSpace.handler");
const checkMemoryUsageHandler = require("./checkMemoryUsage.handler");
const checkInstalledAppsHandler = require("./checkInstalledApps.handler");

const SUPPORTED_HANDLERS = Object.freeze({
  COLLECT_SYSTEM_INFO: collectSystemInfoHandler,
  CHECK_CONNECTIVITY: checkConnectivityHandler,
  CHECK_DISK_SPACE: checkDiskSpaceHandler,
  CHECK_MEMORY_USAGE: checkMemoryUsageHandler,
  CHECK_INSTALLED_APPS: checkInstalledAppsHandler,
});

const NOT_IMPLEMENTED_ACTIONS = new Set([
  "DOWNLOAD_APPROVED_SOFTWARE",
  "VERIFY_DOWNLOADED_SOFTWARE",
  "OPEN_DOWNLOADED_INSTALLER",
  "INSTALL_APPROVED_SOFTWARE",
]);

const NOT_IMPLEMENTED_MESSAGE =
  "No download was performed. No install was performed. The action is not implemented in the MVP endpoint agent.";

function normalizeActionKey(actionKey) {
  return String(actionKey || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function createSkippedResult(actionKey) {
  return {
    status: "SKIPPED",
    message: NOT_IMPLEMENTED_MESSAGE,
    details: {
      reason: "NOT_IMPLEMENTED_IN_ENDPOINT_AGENT_MVP",
      actionKey,
    },
  };
}

async function executeStepHandler(step, context = {}) {
  const actionKey = normalizeActionKey(step?.action_key || step?.actionKey);
  const handler = SUPPORTED_HANDLERS[actionKey];

  if (handler) {
    return handler(step, context);
  }

  if (context.logger) {
    context.logger.warn("Skipping unsupported action for MVP endpoint agent.", {
      actionKey,
      reason: "NOT_IMPLEMENTED_IN_ENDPOINT_AGENT_MVP",
      note: "No download or install was performed.",
    });
  }

  if (NOT_IMPLEMENTED_ACTIONS.has(actionKey)) {
    return createSkippedResult(actionKey);
  }

  return createSkippedResult(actionKey || "UNKNOWN_ACTION");
}

module.exports = {
  executeStepHandler,
  SUPPORTED_HANDLERS,
  NOT_IMPLEMENTED_ACTIONS,
};
