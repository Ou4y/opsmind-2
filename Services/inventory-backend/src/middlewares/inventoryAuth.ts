import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'opsmind-secret-key';

const INVENTORY_READ_ROLE_SET = new Set(['ADMIN', 'TECHNICIAN', 'JUNIOR', 'SENIOR', 'SUPERVISOR']);
const ADMIN_ROLE_SET = new Set(['ADMIN']);
const TECHNICIAN_LEVEL_SET = new Set(['JUNIOR', 'SENIOR', 'SUPERVISOR', 'ADMIN']);

type JwtClaims = {
  userId?: string;
  id?: string;
  sub?: string;
  email?: string;
  role?: string;
  roles?: string[];
  technicianLevel?: string;
  technician_level?: string;
  level?: string;
  supportLevel?: string;
  support_level?: string;
};

export type InventoryAuthUser = {
  userId: string;
  email: string;
  roles: string[];
  role?: string;
  technicianLevel: string | null;
};

export type InventoryAccessContext = {
  roles: string[];
  technicianLevel: string | null;
  isAdmin: boolean;
};

declare global {
  namespace Express {
    interface Request {
      user?: InventoryAuthUser;
    }
  }
}

function normalizeRole(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function mapSupportLevel(level: string): string {
  const map: Record<string, string> = {
    L1: 'JUNIOR',
    L2: 'SENIOR',
    L3: 'SUPERVISOR',
    L4: 'ADMIN',
  };
  return map[level] || level;
}

function resolveTechnicianLevel(claims: JwtClaims): string | null {
  const rawLevel =
    claims.technicianLevel ??
    claims.technician_level ??
    claims.level ??
    claims.supportLevel ??
    claims.support_level;

  if (!rawLevel) {
    return null;
  }

  const normalized = mapSupportLevel(normalizeRole(rawLevel));
  return TECHNICIAN_LEVEL_SET.has(normalized) ? normalized : null;
}

function resolveRoles(claims: JwtClaims): string[] {
  const normalizedRoles = Array.isArray(claims.roles)
    ? claims.roles.map((role) => normalizeRole(role)).filter(Boolean)
    : [];

  if (normalizedRoles.length > 0) {
    return normalizedRoles;
  }

  const normalizedRole = normalizeRole(claims.role);
  return normalizedRole ? [normalizedRole] : [];
}

export function buildInventoryAccessContext(claims: JwtClaims): InventoryAccessContext {
  const roles = resolveRoles(claims);
  const technicianLevel = resolveTechnicianLevel(claims);
  const isAdmin = roles.some((role) => ADMIN_ROLE_SET.has(role)) || technicianLevel === 'ADMIN';
  return {
    roles,
    technicianLevel,
    isAdmin,
  };
}

export function canReadInventory(context: InventoryAccessContext): boolean {
  if (context.roles.some((role) => INVENTORY_READ_ROLE_SET.has(role))) {
    return true;
  }
  return context.technicianLevel !== null;
}

export function canManageInventory(context: InventoryAccessContext): boolean {
  return context.isAdmin;
}

function unauthorized(res: Response, message = 'Authentication required'): void {
  res.status(401).json({ success: false, message });
}

function forbidden(res: Response, message = 'Access denied. Insufficient permissions.'): void {
  res.status(403).json({ success: false, message });
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice('Bearer '.length).trim();
}

function attachAuthUser(req: Request, claims: JwtClaims, context: InventoryAccessContext): void {
  req.user = {
    userId: String(claims.userId || claims.id || claims.sub || ''),
    email: String(claims.email || ''),
    roles: context.roles,
    role: context.roles[0],
    technicianLevel: context.technicianLevel,
  };
}

function verifyTokenAndResolveContext(req: Request, res: Response): InventoryAccessContext | null {
  const token = getBearerToken(req);
  if (!token) {
    unauthorized(res);
    return null;
  }

  try {
    const claims = jwt.verify(token, JWT_SECRET) as JwtClaims;
    const context = buildInventoryAccessContext(claims);
    attachAuthUser(req, claims, context);
    return context;
  } catch {
    unauthorized(res, 'Invalid or expired token');
    return null;
  }
}

export function requireInventoryReadAccess(req: Request, res: Response, next: NextFunction): void {
  const context = verifyTokenAndResolveContext(req, res);
  if (!context) return;

  if (!canReadInventory(context)) {
    forbidden(res);
    return;
  }

  next();
}

export function requireInventoryAdminAccess(req: Request, res: Response, next: NextFunction): void {
  const context = verifyTokenAndResolveContext(req, res);
  if (!context) return;

  if (!canManageInventory(context)) {
    forbidden(res, 'Access denied. Admin privileges required.');
    return;
  }

  next();
}

