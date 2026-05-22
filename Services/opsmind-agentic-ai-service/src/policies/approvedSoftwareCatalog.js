const APPROVED_SOFTWARE_CATALOG = Object.freeze({
  GOOGLE_CHROME: {
    displayName: "Google Chrome",
    aliases: ["google chrome", "chrome", "browser chrome"],
    supportedOs: ["MACOS", "WINDOWS"],
    downloadRiskLevel: "MEDIUM",
    installRiskLevel: "HIGH",
    macos: {
      fileType: "DMG",
      downloadStrategy: "APPROVED_CATALOG",
      installSupported: false,
    },
    windows: {
      fileType: "EXE",
      downloadStrategy: "APPROVED_CATALOG",
      installSupported: false,
    },
  },
});

function toTicketText(ticket) {
  const payload = ticket && typeof ticket === "object" && !Array.isArray(ticket) ? ticket : {};
  const title = String(payload.title || "").trim();
  const description = String(payload.description || "").trim();
  return `${title} ${description}`.toLowerCase();
}

function findApprovedSoftwareFromTicket(ticket) {
  const text = toTicketText(ticket);
  if (!text) {
    return null;
  }

  for (const [softwareKey, software] of Object.entries(APPROVED_SOFTWARE_CATALOG)) {
    const aliases = Array.isArray(software.aliases) ? software.aliases : [];
    const hasMatch = aliases.some((alias) => text.includes(String(alias || "").toLowerCase().trim()));

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
