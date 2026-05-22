const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "opsmind-local-jwt";

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
