const fs = require("fs/promises");
const path = require("path");

const APPLICATIONS_DIRECTORY = "/Applications";
const APPROVED_SOFTWARE_APP_MAP = Object.freeze({
  GOOGLE_CHROME: "Google Chrome.app",
  RECTANGLE: "Rectangle.app",
});

function toOptionalString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function normalizeSoftwareKey(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

async function safeListApplications() {
  try {
    const entries = await fs.readdir(APPLICATIONS_DIRECTORY, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (_error) {
    return [];
  }
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function checkInstalledAppsHandler(step) {
  const params = step?.params && typeof step.params === "object" ? step.params : {};
  const softwareKey = normalizeSoftwareKey(params.softwareKey);
  const softwareName = toOptionalString(params.softwareName);

  const installedApplications = await safeListApplications();

  if (!softwareKey) {
    return {
      status: "SUCCESS",
      message: "Installed applications check completed without a target software key.",
      details: {
        installedAppCount: installedApplications.length,
        sampleApplications: installedApplications.slice(0, 20),
      },
    };
  }

  const expectedAppName = APPROVED_SOFTWARE_APP_MAP[softwareKey] || null;

  if (!expectedAppName) {
    return {
      status: "SUCCESS",
      message: "Installed applications check completed. Requested software key is not mapped in MVP checks.",
      details: {
        softwareKey,
        softwareName,
        installed: false,
        reason: "SOFTWARE_KEY_NOT_MAPPED_IN_MVP_CHECK",
        installedAppCount: installedApplications.length,
      },
    };
  }

  const targetPath = path.join(APPLICATIONS_DIRECTORY, expectedAppName);
  const installed = await fileExists(targetPath);

  return {
    status: "SUCCESS",
    message: installed
      ? `${expectedAppName} appears to be installed.`
      : `${expectedAppName} was not found in /Applications.`,
    details: {
      softwareKey,
      softwareName,
      expectedAppName,
      expectedPath: targetPath,
      installed,
      installedAppCount: installedApplications.length,
    },
  };
}

module.exports = checkInstalledAppsHandler;
