const APPROVED_SOFTWARE_CATALOG = Object.freeze({
  GOOGLE_CHROME: {
    displayName: "Google Chrome",
    aliases: [
      "chrome",
      "google chrome",
      "google chrom",
      "chrom",
      "googlechrome",
      "chrome browser",
      "download chrome",
      "install chrome",
      "download google chrome",
      "install google chrome",
    ],
    supportedOs: ["MACOS"],
    downloadRiskLevel: "MEDIUM",
    installRiskLevel: "HIGH",
    macos: {
      fileType: "DMG",
      downloadStrategy: "APPROVED_CATALOG",
      installSupported: false,
    },
  },
  RECTANGLE: {
    displayName: "Rectangle",
    description: "macOS window management app",
    aliases: [
      "rectangle",
      "rectangle app",
      "rectangle mac",
      "rectangle macos",
      "window manager",
      "window management",
      "window management app",
      "mac window manager",
      "macos window manager",
      "install rectangle",
      "download rectangle",
      "install rectangle app",
      "download rectangle app",
    ],
    supportedOs: ["MACOS"],
    downloadRiskLevel: "MEDIUM",
    installRiskLevel: "HIGH",
    macos: {
      fileType: "DMG",
      downloadStrategy: "APPROVED_CATALOG",
      installSupported: false,
    },
  },
});

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTicketText(ticket) {
  const payload = ticket && typeof ticket === "object" && !Array.isArray(ticket) ? ticket : {};
  const title = payload.title || "";
  const description = payload.description || "";
  return normalizeText(`${title} ${description}`);
}

function findApprovedSoftwareFromTicket(ticket) {
  const text = toTicketText(ticket);
  if (!text) {
    return null;
  }

  for (const [softwareKey, software] of Object.entries(APPROVED_SOFTWARE_CATALOG)) {
    const aliases = Array.isArray(software.aliases) ? software.aliases : [];
    const hasMatch = aliases.some((alias) => {
      const normalizedAlias = normalizeText(alias);
      return normalizedAlias && text.includes(normalizedAlias);
    });

    if (hasMatch) {
      return {
        softwareKey,
        displayName: software.displayName,
        supported: true,
      };
    }
  }

  return null;
}

module.exports = {
  APPROVED_SOFTWARE_CATALOG,
  findApprovedSoftwareFromTicket,
};
