const jwt = require("jsonwebtoken");

const SUPPORT_ROLES = new Set([
  "ADMIN",
  "SUPERVISOR",
  "TECHNICIAN",
  "JUNIOR",
  "SENIOR",
  "SYSTEM_ADMIN",
  "ADMINISTRATOR",
  "HEAD_OF_IT",
  "IT_ADMIN",
]);

function toOptionalString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeRoles(payload) {
  const source = payload?.roles ?? payload?.role ?? [];
  if (Array.isArray(source)) {
    return source.map((role) => String(role || "").trim().toUpperCase()).filter(Boolean);
  }

  const one = String(source || "").trim().toUpperCase();
  return one ? [one] : [];
}

function isWeakSecret(secret) {
  const normalized = String(secret || "").trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.length < 32) return true;
  if (normalized.includes("set_strong")) return true;
  if (normalized.includes("replace_with")) return true;
  if (normalized.includes("placeholder")) return true;
  return false;
}

function hasInternalAccess(req) {
  const expected = toOptionalString(process.env.INTERNAL_API_TOKEN);
  if (!expected) return false;

  const provided = toOptionalString(req.headers["x-internal-token"]);
  return Boolean(provided && provided === expected);
}

function buildJwtAuth(req) {
  const jwtSecret = toOptionalString(process.env.JWT_SECRET);
  if (!jwtSecret) {
    return null;
  }

  const nodeEnv = process.env.NODE_ENV || "development";
  if (nodeEnv !== "development" && isWeakSecret(jwtSecret)) {
    return null;
  }

  const header = toOptionalString(req.headers.authorization);
  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }

  try {
    const payload = jwt.verify(header.slice("Bearer ".length), jwtSecret);
    const userId = toOptionalString(payload?.userId ?? payload?.id ?? payload?.sub);
    if (!userId) {
      return null;
    }

    return {
      type: "jwt",
      userId,
      roles: normalizeRoles(payload),
    };
  } catch {
    return null;
  }
}

function isSupportOrAdmin(roles) {
  return (Array.isArray(roles) ? roles : []).some((role) => SUPPORT_ROLES.has(String(role || "").toUpperCase()));
}

function requireInternalToken(req, res, next) {
  const expected = toOptionalString(process.env.INTERNAL_API_TOKEN);
  if (!expected) {
    return res.status(500).json({ success: false, message: "INTERNAL_API_TOKEN is not configured" });
  }

  if (!hasInternalAccess(req)) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  req.auth = { type: "internal", userId: "internal", roles: ["INTERNAL"] };
  return next();
}

function requireAuthOrInternal(req, res, next) {
  if (hasInternalAccess(req)) {
    req.auth = { type: "internal", userId: "internal", roles: ["INTERNAL"] };
    return next();
  }

  const jwtSecret = toOptionalString(process.env.JWT_SECRET);
  const nodeEnv = process.env.NODE_ENV || "development";
  if (!jwtSecret || (nodeEnv !== "development" && isWeakSecret(jwtSecret))) {
    return res.status(500).json({ success: false, message: "Server authentication misconfiguration" });
  }

  const auth = buildJwtAuth(req);
  if (!auth) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }

  req.auth = auth;
  return next();
}

function requireSupportRole(req, res, next) {
  if (req.auth?.type === "internal") {
    return next();
  }

  if (!isSupportOrAdmin(req.auth?.roles || [])) {
    return res.status(403).json({ success: false, message: "Insufficient permissions" });
  }

  return next();
}

function requireSelfOrSupport(paramName) {
  return (req, res, next) => {
    if (req.auth?.type === "internal") {
      return next();
    }

    const target = toOptionalString(req.params[paramName]);
    if (!target) {
      return res.status(400).json({ success: false, message: `${paramName} is required` });
    }

    if (req.auth?.userId === target || isSupportOrAdmin(req.auth?.roles || [])) {
      return next();
    }

    return res.status(403).json({ success: false, message: "Forbidden" });
  };
}

module.exports = {
  SUPPORT_ROLES,
  isSupportOrAdmin,
  requireInternalToken,
  requireAuthOrInternal,
  requireSupportRole,
  requireSelfOrSupport,
};
