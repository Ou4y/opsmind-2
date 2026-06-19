import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

/**
 * JWT Authentication Middleware
 *
 * Extracts the Bearer token from the Authorization header,
 * verifies it, and attaches the decoded user payload to req.user.
 *
 * Frontend sends: Authorization: 'Bearer <token>'
 * via AuthService.getAuthHeaders()
 */

const JWT_SECRET = String(process.env.JWT_SECRET || '').trim();
const INTERNAL_API_TOKEN = String(process.env.INTERNAL_API_TOKEN || '').trim();

function isWeakSecret(secret: string): boolean {
  const normalized = String(secret || '').trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.length < 32) return true;
  if (normalized.includes('set_strong')) return true;
  if (normalized.includes('replace_with')) return true;
  if (normalized.includes('placeholder')) return true;
  return false;
}

// Extend Express Request to include user
export interface AuthUser {
  userId: string;
  email: string;
  roles: string[];
  role?: string;
  technicianLevel?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      isService?: boolean;
    }
  }
}

/**
 * Required auth — rejects with 401 if no valid token
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const nodeEnv = process.env.NODE_ENV || 'development';
  if (!JWT_SECRET || (nodeEnv !== 'development' && isWeakSecret(JWT_SECRET))) {
    res.status(500).json({ success: false, message: 'Server authentication misconfiguration' });
    return;
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const roles = Array.isArray(decoded?.roles) ? decoded.roles : (decoded?.role ? [decoded.role] : []);
    req.user = {
      userId: String(decoded.userId || decoded.id || decoded.sub || ''),
      email: String(decoded.email || ''),
      roles,
      role: roles[0],
      technicianLevel: decoded.technicianLevel,
    };
    next();
  } catch (error: any) {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

/**
 * Optional auth — attaches user if token present, continues either way
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const jwtSecretReady = JWT_SECRET && (nodeEnv === 'development' || !isWeakSecret(JWT_SECRET));
  const authHeader = req.headers.authorization;

  if (jwtSecretReady && authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const roles = Array.isArray(decoded?.roles) ? decoded.roles : (decoded?.role ? [decoded.role] : []);
      req.user = {
        userId: String(decoded.userId || decoded.id || decoded.sub || ''),
        email: String(decoded.email || ''),
        roles,
        role: roles[0],
        technicianLevel: decoded.technicianLevel,
      };
    } catch {
      // Token invalid — continue without user
    }
  }

  next();
}

/**
 * Role-based access control middleware factory
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.isService) {
      next();
      return;
    }

    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const userRoles = req.user.roles || [];
    const hasRole = roles.some((role) => userRoles.includes(role));
    if (!hasRole) {
      res.status(403).json({ success: false, message: 'Insufficient permissions' });
      return;
    }

    next();
  };
}

/**
 * Allow internal service calls via X-Internal-Token, otherwise require JWT auth.
 */
export function requireAuthOrInternal(req: Request, res: Response, next: NextFunction): void {
  const internalToken = req.headers['x-internal-token'];

  if (INTERNAL_API_TOKEN && internalToken === INTERNAL_API_TOKEN) {
    req.isService = true;
    return next();
  }

  return requireAuth(req, res, next);
}

/**
 * Require internal service token (no JWT fallback).
 */
export function requireInternalToken(req: Request, res: Response, next: NextFunction): void {
  const internalToken = req.headers['x-internal-token'];

  if (INTERNAL_API_TOKEN && internalToken === INTERNAL_API_TOKEN) {
    req.isService = true;
    return next();
  }

  res.status(403).json({ success: false, message: 'Internal service token required' });
}
