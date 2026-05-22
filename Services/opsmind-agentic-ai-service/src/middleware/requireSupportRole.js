const ALLOWED_SUPPORT_ROLES = new Set([
  // Required by this phase
  "ADMIN",
  "SUPERVISOR",
  "TECHNICIAN",
  "JUNIOR_TECHNICIAN",
  "SENIOR_TECHNICIAN",
  "L1_TECHNICIAN",
  "L2_TECHNICIAN",
  "L3_TECHNICIAN",
  "L4_TECHNICIAN",
  "L1",
  "L2",
  "L3",
  "L4",

  // Existing OpsMind role variants used in frontend/auth
  "JUNIOR",
  "SENIOR",
  "SYSTEM_ADMIN",
  "ADMINISTRATOR",
  "HEAD_OF_IT",
  "IT_ADMIN",
  "BUILDING_MANAGER",
  "SENIOR_BUILDING_MANAGER",
]);

function toOptionalString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function normalizeRole(role) {
  const roleText = toOptionalString(role);
  if (!roleText) {
    return null;
  }

  return roleText.toUpperCase().replace(/[\s-]+/g, "_");
}

function isSupportOrAdminRole(roles) {
  const roleList = Array.isArray(roles) ? roles : [roles];
  return roleList
    .map((role) => normalizeRole(role))
    .filter((role) => Boolean(role))
    .some((role) => ALLOWED_SUPPORT_ROLES.has(role));
}

function createAuthError(code, statusCode, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function toObjectPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function requireSupportRole(req, _res, next) {
  const body = toObjectPayload(req.body);
  const actorPayload =
    body.actor && typeof body.actor === "object" && !Array.isArray(body.actor) ? body.actor : {};

  const userId = toOptionalString(actorPayload.userId ?? req.headers["x-user-id"]);
  const role = normalizeRole(actorPayload.role ?? req.headers["x-user-role"]);

  if (!userId) {
    return next(
      createAuthError(
        "ACTOR_REQUIRED",
        400,
        "Actor userId is required for approving or rejecting AI remediation plans."
      )
    );
  }

  if (!role || !ALLOWED_SUPPORT_ROLES.has(role)) {
    return next(
      createAuthError(
        "AUTH_FORBIDDEN",
        403,
        "Only support staff or administrators can approve or reject AI remediation plans."
      )
    );
  }

  req.supportActor = {
    userId,
    role,
  };

  return next();
}

module.exports = {
  requireSupportRole,
  ALLOWED_SUPPORT_ROLES,
  normalizeRole,
  isSupportOrAdminRole,
};
