const { runSafeCommand } = require("../utils/shell");

function parseDfOutput(stdout) {
  const lines = String(stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => Boolean(line));

  if (lines.length < 2) {
    return null;
  }

  const values = lines[1].split(/\s+/);
  if (values.length < 6) {
    return null;
  }

  return {
    filesystem: values[0],
    size: values[1],
    used: values[2],
    available: values[3],
    usePercent: values[4],
    mountedOn: values[5],
  };
}

async function checkDiskSpaceHandler() {
  try {
    const { stdout, stderr } = await runSafeCommand("df", ["-h", "/"]);
    const parsed = parseDfOutput(stdout);

    return {
      status: "SUCCESS",
      message: "Disk space check completed for root filesystem.",
      details: {
        parsed,
        rawOutput: stdout,
        stderr: stderr || null,
      },
    };
  } catch (error) {
    return {
      status: "FAILED",
      message: `Disk space check failed: ${error?.message || "unknown error"}`,
      details: {
        reason: "DISK_CHECK_FAILED",
      },
    };
  }
}

module.exports = checkDiskSpaceHandler;
