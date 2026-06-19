const os = require("os");

function bytesToGiB(bytes) {
  const numeric = Number(bytes) || 0;
  return Number((numeric / (1024 ** 3)).toFixed(2));
}

async function checkMemoryUsageHandler() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const usedPercent = totalBytes > 0 ? Number(((usedBytes / totalBytes) * 100).toFixed(2)) : 0;

  return {
    status: "SUCCESS",
    message: "Memory usage check completed.",
    details: {
      totalBytes,
      freeBytes,
      usedBytes,
      totalGiB: bytesToGiB(totalBytes),
      freeGiB: bytesToGiB(freeBytes),
      usedGiB: bytesToGiB(usedBytes),
      usedPercent,
    },
  };
}

module.exports = checkMemoryUsageHandler;
