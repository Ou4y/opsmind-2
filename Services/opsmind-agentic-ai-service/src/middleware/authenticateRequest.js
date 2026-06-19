const jwt = require("jsonwebtoken");

const JWT_SECRET = String(process.env.JWT_SECRET || "").trim();

function isWeakSecret(secret) {
  const normalized = String(secret || "").trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.length < 32) return true;
  if (normalized.includes("set_strong")) return true;
  if (normalized.includes("replace_with")) return true;
  if (normalized.includes("placeholder")) return true;
  return false;
}

function toOptionalString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function normalizeRoles(payload) {
  const source = payload?.roles ?? payload?.role ?? payload?.userRole ?? [];

  if (Array.isArray(source)) {
    return source
      .map((role) => toOptionalString(role))
      .filter((role) => Boolean(role));
  }

  const singleRole = toOptionalString(source);
  return singleRole ? [singleRole] : [];
}

function resolveUserId(payload) {
  return toOptionalString(payload?.userId ?? payload?.user_id ?? payload?.sub ?? payload?.id);
}

function authenticateRequest(req, res, next) {
  const nodeEnv = String(process.env.NODE_ENV || "development");
  if (!JWT_SECRET || (nodeEnv !== "development" && isWeakSecret(JWT_SECRET))) {
    return res.status(500).json({
      success: false,
      message: "Server authentication misconfiguration.",
    });
  }

  const authHeader = toOptionalString(req.headers.authorization);

  if (!authHeader) {
    return res.status(401).json({
      success: false,
      message: "Authentication token is required.",
    });
  }

  const [scheme, token] = authHeader.split(/\s+/);
  if (!/^Bearer$/i.test(scheme || "") || !token) {
    return res.status(401).json({
      success: false,
      message: "Authentication token is required.",
    });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const userId = resolveUserId(payload);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired authentication token.",
      });
    }

    req.auth = {
      userId,
      email: toOptionalString(payload?.email),
      roles: normalizeRoles(payload),
    };

    return next();
  } catch (_error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token.",
    });
  }
}

module.exports = {
  authenticateRequest,
};
