const os = require("os");

const { runSafeCommand } = require("../utils/shell");

function bytesToGiB(bytes) {
  const numeric = Number(bytes) || 0;
  return Number((numeric / (1024 ** 3)).toFixed(2));
}

async function collectSystemInfoHandler(_step, context = {}) {
  let macosProductVersion = null;

  if (process.platform === "darwin") {
    try {
      const { stdout } = await runSafeCommand("sw_vers", ["-productVersion"]);
      macosProductVersion = stdout || null;
    } catch (error) {
      if (context.logger) {
        context.logger.warn("Unable to read macOS product version using sw_vers.", {
          message: error?.message || String(error),
        });
      }
    }
  }

  const details = {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    osRelease: os.release(),
    macosProductVersion,
    uptimeSeconds: os.uptime(),
    totalMemoryBytes: os.totalmem(),
    totalMemoryGiB: bytesToGiB(os.totalmem()),
    freeMemoryBytes: os.freemem(),
    freeMemoryGiB: bytesToGiB(os.freemem()),
    currentUser: os.userInfo().username,
  };

  return {
    status: "SUCCESS",
    message: "Collected local system information diagnostics.",
    details,
  };
}

module.exports = collectSystemInfoHandler;
