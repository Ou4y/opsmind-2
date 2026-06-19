import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

const SUPPORT_ROLE_SET = new Set([
  "ADMIN",
  "TECHNICIAN",
  "SUPERVISOR",
  "JUNIOR",
  "SENIOR",
  "L1",
  "L2",
  "L3",
  "L4",
  "JUNIOR_TECHNICIAN",
  "SENIOR_TECHNICIAN",
  "L1_TECHNICIAN",
  "L2_TECHNICIAN",
  "L3_TECHNICIAN",
  "L4_TECHNICIAN",
]);

type JwtPayload = {
  userId?: string | number;
  id?: string | number;
  sub?: string | number;
  email?: string;
  role?: string;
  roles?: string[];
  technicianLevel?: string;
  technician_level?: string;
  supportLevel?: string;
  support_level?: string;
};

export type AuthenticatedUser = {
  userId: string;
  email: string;
  roles: string[];
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      isService?: boolean;
    }
  }
}

function toOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeRole(role: unknown): string | null {
  const value = toOptionalString(role);
  if (!value) return null;
  return value.toUpperCase().replace(/[\s-]+/g, "_");
}

function isWeakSecret(secret: string): boolean {
  const normalized = secret.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.length < 32) return true;
  if (normalized.includes("set_strong")) return true;
  if (normalized.includes("replace_with")) return true;
  if (normalized.includes("placeholder")) return true;
  return false;
}

function extractRoles(payload: JwtPayload): string[] {
  const roles = Array.isArray(payload.roles) ? payload.roles : [];
  const normalized = roles
    .map((role) => normalizeRole(role))
    .filter((role): role is string => Boolean(role));

  const singleRole = normalizeRole(payload.role);
  if (singleRole) normalized.push(singleRole);

  const technicianLevel =
    normalizeRole(payload.technicianLevel) ||
    normalizeRole(payload.technician_level) ||
    normalizeRole(payload.supportLevel) ||
    normalizeRole(payload.support_level);
  if (technicianLevel) normalized.push(technicianLevel);

  return Array.from(new Set(normalized));
}

function resolveUserId(payload: JwtPayload): string | null {
  return toOptionalString(payload.userId ?? payload.id ?? payload.sub);
}

function getJwtSecret(): string {
  const secret = toOptionalString(process.env.JWT_SECRET);
  if (!secret) {
    throw new Error("JWT_SECRET is required");
  }
  if ((process.env.NODE_ENV || "development") !== "development" && isWeakSecret(secret)) {
    throw new Error("JWT_SECRET is insecure for non-development environments");
  }
  return secret;
}

function attachAuthenticatedUser(req: Request, payload: JwtPayload): void {
  req.user = {
    userId: resolveUserId(payload) || "",
    email: toOptionalString(payload.email) || "",
    roles: extractRoles(payload),
  };
}

function unauthorized(res: Response): void {
  res.status(401).json({ error: "Authentication required" });
}

function isInternalRequest(req: Request): boolean {
  const expectedToken = toOptionalString(process.env.INTERNAL_API_TOKEN);
  if (!expectedToken) return false;
  const providedToken = toOptionalString(req.headers["x-internal-token"]);
  return providedToken === expectedToken;
}

export function hasSupportOrAdminRole(user: AuthenticatedUser | undefined): boolean {
  if (!user) return false;
  return user.roles.some((role) => SUPPORT_ROLE_SET.has(role));
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = toOptionalString(req.headers.authorization);
  if (!authHeader) {
    unauthorized(res);
    return;
  }

  const [scheme, token] = authHeader.split(/\s+/);
  if (!/^Bearer$/i.test(scheme || "") || !token) {
    unauthorized(res);
    return;
  }

  try {
    const secret = getJwtSecret();
    const payload = jwt.verify(token, secret) as JwtPayload;
    const userId = resolveUserId(payload);
    if (!userId) {
      unauthorized(res);
      return;
    }
    attachAuthenticatedUser(req, payload);
    next();
  } catch (error) {
    if (
      (error as Error).message === "JWT_SECRET is required" ||
      (error as Error).message === "JWT_SECRET is insecure for non-development environments"
    ) {
      res.status(500).json({ error: "Server authentication misconfiguration" });
      return;
    }
    unauthorized(res);
  }
}

export function requireAuthOrInternal(req: Request, res: Response, next: NextFunction): void {
  if (isInternalRequest(req)) {
    req.isService = true;
    return next();
  }
  return requireAuth(req, res, next);
}
