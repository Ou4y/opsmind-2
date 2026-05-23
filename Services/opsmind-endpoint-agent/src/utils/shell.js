const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const SAFE_COMMAND_ALLOWLIST = Object.freeze({
  df: ["-h", "/"],
  sw_vers: ["-productVersion"],
});

function arraysEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

async function runSafeCommand(command, args = [], options = {}) {
  const normalizedCommand = String(command || "").trim();
  const normalizedArgs = Array.isArray(args) ? args.map((value) => String(value)) : [];
  const allowlistedArgs = SAFE_COMMAND_ALLOWLIST[normalizedCommand];

  if (!allowlistedArgs || !arraysEqual(normalizedArgs, allowlistedArgs)) {
    throw new Error(`Command is not allowlisted for MVP endpoint agent: ${normalizedCommand} ${normalizedArgs.join(" ")}`);
  }

  const { stdout, stderr } = await execFileAsync(normalizedCommand, normalizedArgs, {
    shell: false,
    timeout: Number(options.timeoutMs) || 10000,
    maxBuffer: Number(options.maxBuffer) || 256 * 1024,
    windowsHide: true,
  });

  return {
    stdout: String(stdout || "").trim(),
    stderr: String(stderr || "").trim(),
  };
}

module.exports = {
  runSafeCommand,
};
