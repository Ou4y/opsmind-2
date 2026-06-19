const {
  APPROVED_SOFTWARE_CATALOG,
  findApprovedSoftwareFromTicket,
} = require("../policies/approvedSoftwareCatalog");

const ACTION_REGISTRY = Object.freeze({
  COLLECT_SYSTEM_INFO: {
    categories: ["NETWORK", "PRINTER", "SOFTWARE", "PERFORMANCE", "STORAGE", "GENERAL"],
    riskLevel: "LOW",
    description: "Collect basic OS, hostname, IP, and environment information.",
  },
  CHECK_CONNECTIVITY: {
    categories: ["NETWORK", "PRINTER", "SOFTWARE"],
    riskLevel: "LOW",
    description: "Check gateway, DNS, and internet connectivity.",
  },
  CHECK_DISK_SPACE: {
    categories: ["PERFORMANCE", "STORAGE", "SOFTWARE"],
    riskLevel: "LOW",
    description: "Check available disk space.",
  },
  CHECK_MEMORY_USAGE: {
    categories: ["PERFORMANCE"],
    riskLevel: "LOW",
    description: "Check current memory usage.",
  },
  CHECK_INSTALLED_APPS: {
    categories: ["SOFTWARE", "GENERAL"],
    riskLevel: "LOW",
    description: "Check whether the requested approved software is already installed.",
  },
  FLUSH_DNS: {
    categories: ["NETWORK"],
    riskLevel: "LOW",
    description: "Clear the DNS resolver cache.",
  },
  RESTART_PRINT_SPOOLER: {
    categories: ["PRINTER"],
    riskLevel: "MEDIUM",
    description: "Restart the Windows print spooler service.",
  },
  DOWNLOAD_APPROVED_SOFTWARE: {
    categories: ["SOFTWARE"],
    riskLevel: "MEDIUM",
    description: "Download software from the approved software catalog.",
  },
  VERIFY_DOWNLOADED_SOFTWARE: {
    categories: ["SOFTWARE"],
    riskLevel: "LOW",
    description: "Verify the downloaded software against the approved software catalog metadata.",
  },
  OPEN_DOWNLOADED_INSTALLER: {
    categories: ["SOFTWARE"],
    riskLevel: "MEDIUM",
    description: "Open the downloaded installer for manual user/technician installation.",
    enabled: false,
  },
  INSTALL_APPROVED_SOFTWARE: {
    categories: ["SOFTWARE"],
    riskLevel: "HIGH",
    description: "Install approved software from the catalog.",
    enabled: false,
  },
  MANUAL_REVIEW_REQUIRED: {
    categories: ["NETWORK", "PRINTER", "SOFTWARE", "PERFORMANCE", "STORAGE", "GENERAL"],
    riskLevel: "MEDIUM",
    description: "Stop automation and require technician manual review.",
  },
});

const PARAM_ACTION_ALLOWLIST = new Set([
  "DOWNLOAD_APPROVED_SOFTWARE",
  "VERIFY_DOWNLOADED_SOFTWARE",
]);

const UNSAFE_DESCRIPTION_PATTERNS = [
  /```/i,
  /https?:\/\//i,
  /\bwww\./i,
  /\b[a-z0-9-]+\.[a-z]{2,}(\/\S*)?\b/i,
  /\b(powershell|bash|cmd|terminal|shell|script|curl|wget|sudo|regedit|gpedit|ipconfig|ifconfig|netsh|systemctl|ping|traceroute|nslookup)\b/i,
  /\b([a-z]+:\\|\\\\)\S+/i,
  /(^|\s)(\/usr|\/bin|\/etc|\/var|\/opt)\b/i,
  /[|;&><]/,
  /\b(run|execute|open)\b\s+\S+/i,
];

const EXECUTION_BLOCKED_REASON =
  "Automatic execution is unavailable for this ticket. The plan can be used as a technician recommendation only.";

function toCleanString(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

function toOptionalString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes", "y"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "n"].includes(normalized)) {
      return false;
    }
  }

  return fallback;
}

function pickFirstDefined(ticket, keys, fallback = null) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(ticket, key) && ticket[key] !== undefined) {
      return ticket[key];
    }
  }

  return fallback;
}

function normalizeActionKey(actionKey) {
  return String(actionKey || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function normalizeTicket(ticket) {
  const safeTicket = ticket && typeof ticket === "object" && !Array.isArray(ticket) ? ticket : {};

  return {
    id: pickFirstDefined(safeTicket, ["id"], null),
    title: toCleanString(pickFirstDefined(safeTicket, ["title"], "")),
    description: toCleanString(pickFirstDefined(safeTicket, ["description"], "")),
    category: toCleanString(pickFirstDefined(safeTicket, ["category"], "GENERAL"), "GENERAL"),
    priority: toCleanString(pickFirstDefined(safeTicket, ["priority"], "")),
    osType: toCleanString(pickFirstDefined(safeTicket, ["os_type", "osType"], "UNKNOWN"), "UNKNOWN"),
    issueScope: toCleanString(
      pickFirstDefined(safeTicket, ["issue_scope", "issueScope"], "UNKNOWN"),
      "UNKNOWN"
    ),
    affectedDeviceId: pickFirstDefined(safeTicket, ["affected_device_id", "affectedDeviceId"], null),
    affectedDeviceName: toCleanString(
      pickFirstDefined(safeTicket, ["affected_device_name", "affectedDeviceName"], ""),
      ""
    ),
    remoteSupportConsent: pickFirstDefined(
      safeTicket,
      ["remote_support_consent", "remoteSupportConsent"],
      null
    ),
    aiAgentEligible: toBoolean(
      pickFirstDefined(safeTicket, ["ai_agent_eligible", "aiAgentEligible"], false),
      false
    ),
    aiAgentEligibilityReason: toCleanString(
      pickFirstDefined(
        safeTicket,
        ["ai_agent_eligibility_reason", "aiAgentEligibilityReason"],
        ""
      ),
      ""
    ),
  };
}

function normalizeCategory(category, title, description) {
  const explicitCategory = toCleanString(category).toUpperCase();
  const inferenceText = `${toCleanString(title)} ${toCleanString(description)}`.toUpperCase();

  if (/(NETWORK|WIFI|WI[- ]?FI|INTERNET|DNS|CONNECTIVITY)/.test(explicitCategory)) {
    return "NETWORK";
  }

  if (/(PRINT|PRINTER|PRINTING)/.test(explicitCategory)) {
    return "PRINTER";
  }

  if (/(SOFTWARE|APPLICATION|APP|INSTALL|DOWNLOAD|CHROME|BROWSER)/.test(explicitCategory)) {
    return "SOFTWARE";
  }

  if (/(SLOW|FREEZE|FREEZING|PERFORMANCE|LAG)/.test(explicitCategory)) {
    return "PERFORMANCE";
  }

  if (/(DISK|STORAGE|SPACE)/.test(explicitCategory)) {
    return "STORAGE";
  }

  if (/(SOFTWARE|APPLICATION|APP|INSTALL|DOWNLOAD|CHROME|BROWSER)/.test(inferenceText)) {
    return "SOFTWARE";
  }

  if (/(NETWORK|WIFI|WI[- ]?FI|INTERNET|DNS|CONNECTIVITY)/.test(inferenceText)) {
    return "NETWORK";
  }

  if (/(PRINT|PRINTER|PRINTING)/.test(inferenceText)) {
    return "PRINTER";
  }

  if (/(SLOW|FREEZE|FREEZING|PERFORMANCE|LAG)/.test(inferenceText)) {
    return "PERFORMANCE";
  }

  if (/(DISK|STORAGE|SPACE)/.test(inferenceText)) {
    return "STORAGE";
  }

  return "GENERAL";
}

function normalizeOsType(osType) {
  const normalized = toCleanString(osType, "UNKNOWN").toUpperCase();

  if (/(MAC|OSX|DARWIN)/.test(normalized)) {
    return "MACOS";
  }

  if (/WIN/.test(normalized)) {
    return "WINDOWS";
  }

  return normalized || "UNKNOWN";
}

function buildSafeTicketContext(normalizedTicket) {
  const normalizedOs = normalizeOsType(normalizedTicket.osType);
  const normalizedIssueScope = toCleanString(normalizedTicket.issueScope, "UNKNOWN").toUpperCase();
  const affectedDeviceId = toOptionalString(normalizedTicket.affectedDeviceId);
  const affectedDeviceName = toOptionalString(normalizedTicket.affectedDeviceName);
  const ticketId = toOptionalString(normalizedTicket.id);

  return {
    ticketId,
    affectedDeviceId,
    affectedDeviceName,
    osType: normalizedOs || "UNKNOWN",
    issueScope: normalizedIssueScope || "UNKNOWN",
  };
}

function createPlanValidationError(message) {
  const error = new Error(message);
  error.code = "RAW_PLAN_INVALID";
  return error;
}

function validateRawPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw createPlanValidationError("Model plan must be a JSON object.");
  }

  if (!Array.isArray(plan.steps)) {
    throw createPlanValidationError("Model plan must include a steps array.");
  }

  const usableStepCount = plan.steps.filter((step) => {
    if (!step || typeof step !== "object") {
      return false;
    }

    const actionKey = normalizeActionKey(step.actionKey);
    const description = toCleanString(step.description);

    return Boolean(actionKey && description);
  }).length;

  if (usableStepCount < 1) {
    throw createPlanValidationError("Model plan must include at least one usable step.");
  }
}

function containsCommandLikeText(text) {
  if (!text) {
    return false;
  }

  return UNSAFE_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(text));
}

function sanitizeSoftwareParams(params) {
  const source = params && typeof params === "object" && !Array.isArray(params) ? params : {};

  const softwareKeyRaw = toOptionalString(source.softwareKey);
  const softwareNameRaw = toOptionalString(source.softwareName);

  const sanitized = {};

  if (softwareKeyRaw && !containsCommandLikeText(softwareKeyRaw)) {
    const normalizedSoftwareKey = softwareKeyRaw
      .toUpperCase()
      .replace(/[^A-Z0-9_]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");

    if (normalizedSoftwareKey) {
      sanitized.softwareKey = normalizedSoftwareKey;
    }
  }

  if (softwareNameRaw && !containsCommandLikeText(softwareNameRaw)) {
    sanitized.softwareName = softwareNameRaw;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function sanitizeStepParams(actionKey, params) {
  if (!PARAM_ACTION_ALLOWLIST.has(actionKey)) {
    return null;
  }

  return sanitizeSoftwareParams(params);
}

function sanitizeRawPlanParams(rawPlan) {
  if (!rawPlan || typeof rawPlan !== "object" || Array.isArray(rawPlan)) {
    return rawPlan;
  }

  const clonedPlan = { ...rawPlan };
  const rawSteps = Array.isArray(rawPlan.steps) ? rawPlan.steps : [];

  clonedPlan.steps = rawSteps.map((step) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      return step;
    }

    const sanitizedStep = { ...step };
    const actionKey = normalizeActionKey(step.actionKey);
    const sanitizedParams = sanitizeStepParams(actionKey, step.params);

    if (sanitizedParams) {
      sanitizedStep.params = sanitizedParams;
    } else {
      delete sanitizedStep.params;
    }

    return sanitizedStep;
  });

  return clonedPlan;
}

function getAllowedActionSetForCategory(category) {
  const normalizedCategory = category || "GENERAL";

  return new Set(
    Object.entries(ACTION_REGISTRY)
      .filter(([, metadata]) => metadata.enabled !== false && metadata.categories.includes(normalizedCategory))
      .map(([actionKey]) => actionKey)
  );
}

function buildStep(actionKey, options = {}) {
  const step = {
    stepOrder: 0,
    actionKey,
    description: toCleanString(options.description, ACTION_REGISTRY[actionKey].description),
  };

  if (options.params && typeof options.params === "object" && Object.keys(options.params).length > 0) {
    step.params = options.params;
  }

  return step;
}

function finalizeSteps(steps) {
  return steps.map((step, index) => {
    const finalizedStep = {
      stepOrder: index + 1,
      actionKey: step.actionKey,
      description: toCleanString(step.description, ACTION_REGISTRY[step.actionKey].description),
    };

    if (step.params && typeof step.params === "object" && Object.keys(step.params).length > 0) {
      finalizedStep.params = step.params;
    }

    return finalizedStep;
  });
}

function hasManualReviewStep(steps) {
  const normalizedSteps = Array.isArray(steps) ? steps : [];
  return normalizedSteps.some(
    (step) => normalizeActionKey(step?.actionKey ?? step?.action_key) === "MANUAL_REVIEW_REQUIRED"
  );
}

function sanitizeRemediationPlan(rawPlan, ticket) {
  const normalizedTicket = normalizeTicket(ticket);
  const normalizedCategory = normalizeCategory(
    normalizedTicket.category,
    normalizedTicket.title,
    normalizedTicket.description
  );

  const allowedActions = getAllowedActionSetForCategory(normalizedCategory);
  const rawSteps = Array.isArray(rawPlan.steps) ? rawPlan.steps : [];

  const sanitizedSteps = [];

  for (const step of rawSteps) {
    if (!step || typeof step !== "object") {
      continue;
    }

    const actionKey = normalizeActionKey(step.actionKey);

    if (!ACTION_REGISTRY[actionKey]) {
      continue;
    }

    if (ACTION_REGISTRY[actionKey].enabled === false) {
      continue;
    }

    if (!allowedActions.has(actionKey)) {
      continue;
    }

    const descriptionFromModel = toCleanString(step.description, ACTION_REGISTRY[actionKey].description);
    const safeDescription = containsCommandLikeText(descriptionFromModel)
      ? ACTION_REGISTRY[actionKey].description
      : descriptionFromModel;

    const safeParams = sanitizeStepParams(actionKey, step.params);

    sanitizedSteps.push(
      buildStep(actionKey, {
        description: safeDescription,
        params: safeParams,
      })
    );
  }

  if (sanitizedSteps.length === 0) {
    sanitizedSteps.push(buildStep("MANUAL_REVIEW_REQUIRED"));
  }

  const finalizedSteps = finalizeSteps(sanitizedSteps);
  const executionAvailable = normalizedTicket.aiAgentEligible === true && !hasManualReviewStep(finalizedSteps);
  const ticketContext = buildSafeTicketContext(normalizedTicket);

  return {
    summary: toCleanString(
      rawPlan.summary,
      `Recommended remediation plan for: ${normalizedTicket.title || "the reported issue"}`
    ),
    riskLevel: recalculateRisk(finalizedSteps),
    requiresApproval: true,
    steps: finalizedSteps,
    executionAvailable,
    executionBlockedReason: executionAvailable ? null : EXECUTION_BLOCKED_REASON,
    plannerService: "opsmind-agentic-ai-service",
    affectedDeviceId: ticketContext.affectedDeviceId,
    affectedDeviceName: ticketContext.affectedDeviceName,
    osType: ticketContext.osType,
    issueScope: ticketContext.issueScope,
    ticketContext,
  };
}

function enrichSafePlan(safePlan, ticket) {
  const normalizedTicket = normalizeTicket(ticket);
  const normalizedCategory = normalizeCategory(
    normalizedTicket.category,
    normalizedTicket.title,
    normalizedTicket.description
  );

  const existingSteps = Array.isArray(safePlan.steps) ? safePlan.steps : [];
  const allowedActions = getAllowedActionSetForCategory(normalizedCategory);
  const resultSteps = [];

  const connectivityLimit = normalizedCategory === "NETWORK" ? 2 : 1;
  const counts = new Map();

  function canUseAction(actionKey) {
    if (!allowedActions.has(actionKey)) {
      return false;
    }

    const currentCount = counts.get(actionKey) || 0;

    if (actionKey === "CHECK_CONNECTIVITY") {
      return currentCount < connectivityLimit;
    }

    return currentCount < 1;
  }

  function addAction(actionKey, options = {}) {
    if (!ACTION_REGISTRY[actionKey] || ACTION_REGISTRY[actionKey].enabled === false || !canUseAction(actionKey)) {
      return;
    }

    resultSteps.push(
      buildStep(actionKey, {
        params: sanitizeStepParams(actionKey, options.params),
      })
    );
    counts.set(actionKey, (counts.get(actionKey) || 0) + 1);
  }

  if (normalizedCategory === "NETWORK") {
    addAction("COLLECT_SYSTEM_INFO");
    addAction("CHECK_CONNECTIVITY");
    addAction("FLUSH_DNS");
    addAction("CHECK_CONNECTIVITY");
  } else if (normalizedCategory === "PRINTER") {
    addAction("COLLECT_SYSTEM_INFO");
    addAction("CHECK_CONNECTIVITY");

    const normalizedOs = normalizeOsType(normalizedTicket.osType);
    const includesSpoolerAlready = existingSteps.some(
      (step) => normalizeActionKey(step.actionKey) === "RESTART_PRINT_SPOOLER"
    );

    if (normalizedOs === "WINDOWS" || includesSpoolerAlready) {
      addAction("RESTART_PRINT_SPOOLER");
    }
  } else if (normalizedCategory === "SOFTWARE") {
    addAction("COLLECT_SYSTEM_INFO");
    addAction("CHECK_CONNECTIVITY");
    addAction("CHECK_DISK_SPACE");

    const approvedSoftware = findApprovedSoftwareFromTicket(normalizedTicket);
    const normalizedOs = normalizeOsType(normalizedTicket.osType);

    if (approvedSoftware) {
      const catalogEntry = APPROVED_SOFTWARE_CATALOG[approvedSoftware.softwareKey];
      const supportedOs = Array.isArray(catalogEntry?.supportedOs) ? catalogEntry.supportedOs : [];

      if (supportedOs.includes(normalizedOs)) {
        const softwareParams = {
          softwareKey: approvedSoftware.softwareKey,
          softwareName: approvedSoftware.displayName,
        };

        addAction("DOWNLOAD_APPROVED_SOFTWARE", { params: softwareParams });
        addAction("VERIFY_DOWNLOADED_SOFTWARE", { params: softwareParams });
      } else {
        addAction("MANUAL_REVIEW_REQUIRED");
      }
    } else {
      addAction("MANUAL_REVIEW_REQUIRED");
    }
  } else if (normalizedCategory === "PERFORMANCE") {
    addAction("COLLECT_SYSTEM_INFO");
    addAction("CHECK_MEMORY_USAGE");
    addAction("CHECK_DISK_SPACE");
  } else if (normalizedCategory === "STORAGE") {
    addAction("COLLECT_SYSTEM_INFO");
    addAction("CHECK_DISK_SPACE");
  } else {
    addAction("COLLECT_SYSTEM_INFO");
    addAction("MANUAL_REVIEW_REQUIRED");
  }

  if (resultSteps.length === 0) {
    addAction("MANUAL_REVIEW_REQUIRED");
  }

  const finalizedSteps = finalizeSteps(resultSteps);
  const ticketContext = buildSafeTicketContext(normalizedTicket);
  const baseExecutionAvailable = normalizedTicket.aiAgentEligible === true;
  const executionAvailable = baseExecutionAvailable && !hasManualReviewStep(finalizedSteps);

  return {
    summary: toCleanString(
      safePlan.summary,
      `Recommended remediation plan for: ${normalizedTicket.title || "the reported issue"}`
    ),
    riskLevel: recalculateRisk(finalizedSteps),
    requiresApproval: true,
    steps: finalizedSteps,
    executionAvailable,
    executionBlockedReason:
      executionAvailable
        ? null
        : safePlan.executionBlockedReason || EXECUTION_BLOCKED_REASON,
    plannerService: safePlan.plannerService || "opsmind-agentic-ai-service",
    affectedDeviceId: toOptionalString(safePlan.affectedDeviceId) || ticketContext.affectedDeviceId,
    affectedDeviceName: toOptionalString(safePlan.affectedDeviceName) || ticketContext.affectedDeviceName,
    osType: toCleanString(safePlan.osType, ticketContext.osType || "UNKNOWN"),
    issueScope: toCleanString(safePlan.issueScope, ticketContext.issueScope || "UNKNOWN"),
    ticketContext: {
      ticketId: toOptionalString(
        safePlan?.ticketContext?.ticketId || safePlan?.ticketContext?.ticket_id || ticketContext.ticketId
      ),
      affectedDeviceId: toOptionalString(
        safePlan?.ticketContext?.affectedDeviceId ||
          safePlan?.ticketContext?.affected_device_id ||
          ticketContext.affectedDeviceId
      ),
      affectedDeviceName: toOptionalString(
        safePlan?.ticketContext?.affectedDeviceName ||
          safePlan?.ticketContext?.affected_device_name ||
          ticketContext.affectedDeviceName
      ),
      osType: toCleanString(
        safePlan?.ticketContext?.osType || safePlan?.ticketContext?.os_type,
        ticketContext.osType
      ),
      issueScope: toCleanString(
        safePlan?.ticketContext?.issueScope || safePlan?.ticketContext?.issue_scope,
        ticketContext.issueScope
      ),
    },
  };
}

function recalculateRisk(steps) {
  const normalizedSteps = Array.isArray(steps) ? steps : [];

  let hasEnabledHighAction = false;
  let hasMediumAction = false;

  for (const step of normalizedSteps) {
    const actionKey = normalizeActionKey(step.actionKey);
    const metadata = ACTION_REGISTRY[actionKey];

    if (!metadata || metadata.enabled === false) {
      continue;
    }

    if (metadata.riskLevel === "HIGH") {
      hasEnabledHighAction = true;
    }

    if (
      [
        "RESTART_PRINT_SPOOLER",
        "MANUAL_REVIEW_REQUIRED",
        "DOWNLOAD_APPROVED_SOFTWARE",
        "OPEN_DOWNLOADED_INSTALLER",
      ].includes(actionKey)
    ) {
      hasMediumAction = true;
    }
  }

  if (hasEnabledHighAction) {
    return "HIGH";
  }

  if (hasMediumAction) {
    return "MEDIUM";
  }

  return "LOW";
}

module.exports = {
  ACTION_REGISTRY,
  normalizeTicket,
  normalizeCategory,
  validateRawPlan,
  sanitizeRawPlanParams,
  sanitizeRemediationPlan,
  enrichSafePlan,
  recalculateRisk,
};
