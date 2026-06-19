const ALLOWED_SUPPORT_ROLES = new Set([
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

function resolveSupportActor(auth) {
  const userId = toOptionalString(auth?.userId);
  const normalizedRoles = Array.isArray(auth?.roles)
    ? auth.roles.map((role) => normalizeRole(role)).filter(Boolean)
    : [];

  const matchingRole = normalizedRoles.find((role) => ALLOWED_SUPPORT_ROLES.has(role)) || null;

  return {
    userId,
    role: matchingRole,
  };
}

function requireSupportRole(req, _res, next) {
  const actor = resolveSupportActor(req.auth);

  if (!actor.userId) {
    return next(
      createAuthError(
        "ACTOR_REQUIRED",
        401,
        "Authentication is required for approving or rejecting AI remediation plans."
      )
    );
  }

  if (!actor.role) {
    return next(
      createAuthError(
        "AUTH_FORBIDDEN",
        403,
        "Only support staff or administrators can approve or reject AI remediation plans."
      )
    );
  }

  req.supportActor = actor;
  return next();
}

module.exports = {
  requireSupportRole,
  ALLOWED_SUPPORT_ROLES,
  normalizeRole,
  isSupportOrAdminRole,
};
