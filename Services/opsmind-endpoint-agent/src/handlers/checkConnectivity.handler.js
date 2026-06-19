const dns = require("dns").promises;

const TEST_HOSTS = ["one.one.one.one", "google.com", "cloudflare.com"];

async function checkConnectivityHandler() {
  const checks = [];

  for (const host of TEST_HOSTS) {
    try {
      const result = await dns.lookup(host);
      checks.push({
        host,
        success: true,
        address: result?.address || null,
        family: result?.family || null,
      });
    } catch (error) {
      checks.push({
        host,
        success: false,
        error: error?.message || "DNS lookup failed",
      });
    }
  }

  const hasAnySuccess = checks.some((item) => item.success === true);

  return {
    status: hasAnySuccess ? "SUCCESS" : "FAILED",
    message: hasAnySuccess
      ? "Connectivity checks completed successfully for at least one target host."
      : "Connectivity checks failed for all target hosts.",
    details: {
      checks,
    },
  };
}

module.exports = checkConnectivityHandler;
