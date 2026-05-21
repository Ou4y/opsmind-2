import { createHmac, timingSafeEqual } from "crypto";
import { NextFunction, Request, Response } from "express";

type JwtPayload = {
  userId?: string | number;
  id?: string | number;
  sub?: string | number;
  email?: string;
  role?: string;
  roles?: string[];
  technicianLevel?: string;
  exp?: number;
};

type AuthUser = {
  userId: string;
  email: string;
  roles: string[];
  role?: string;
  technicianLevel?: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || "opsmind-secret-key";
const SUPPORTED_HMAC_ALGS: Record<string, string> = {
  HS256: "sha256",
  HS384: "sha384",
  HS512: "sha512",
};

function toBase64(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + "=".repeat(padding), "base64");
}

function parseJwt(token: string): JwtPayload {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error("Malformed token");
  }

  const header = JSON.parse(toBase64(encodedHeader).toString("utf8")) as { alg?: string };
  const algorithm = header.alg ? SUPPORTED_HMAC_ALGS[header.alg] : undefined;
  if (!algorithm) {
    throw new Error("Unsupported token algorithm");
  }

  const signedContent = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = createHmac(algorithm, JWT_SECRET)
    .update(signedContent)
    .digest();
  const actualSignature = toBase64(encodedSignature);

  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    throw new Error("Invalid token signature");
  }

  const payload = JSON.parse(toBase64(encodedPayload).toString("utf8")) as JwtPayload;
  if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) {
    throw new Error("Token expired");
  }

  return payload;
}

function normalizeRoles(payload: JwtPayload): string[] {
  const roles = Array.isArray(payload.roles)
    ? payload.roles
    : payload.role
      ? [payload.role]
      : [];

  return roles
    .map((role) => String(role || "").trim().toUpperCase())
    .filter(Boolean);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return;
  }

  try {
    const payload = parseJwt(authHeader.slice("Bearer ".length));
    const roles = normalizeRoles(payload);
    const technicianLevel = payload.technicianLevel
      ? String(payload.technicianLevel).toUpperCase()
      : undefined;

    req.user = {
      userId: String(payload.userId || payload.id || payload.sub || ""),
      email: String(payload.email || ""),
      roles,
      role: roles[0],
      technicianLevel,
    };

    next();
  } catch {
    res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
}

export function requireRole(...requiredRoles: string[]) {
  const normalizedRequired = requiredRoles.map((role) => role.toUpperCase());

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required" });
      return;
    }

    const userRoles = new Set([
      ...req.user.roles.map((role) => role.toUpperCase()),
      String(req.user.role || "").toUpperCase(),
      String(req.user.technicianLevel || "").toUpperCase(),
    ]);

    const allowed = normalizedRequired.some((role) => userRoles.has(role));
    if (!allowed) {
      res.status(403).json({ success: false, message: "Insufficient permissions" });
      return;
    }

    next();
  };
}
