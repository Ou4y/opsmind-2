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

const JWT_SECRET = process.env.JWT_SECRET || 'opsmind-secret-key';

// Extend Express Request to include user
export interface AuthUser {
  id: number;
  firstName?: string;
  lastName?: string;
  email: string;
  role: string;
  building?: string;
  supportGroupId?: number;
  groupId?: number;
  technicianLevel?: string;
  level?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Required auth — rejects with 401 if no valid token
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = decoded;
    next();
  } catch (error: any) {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

/**
 * Optional auth — attaches user if token present, continues either way
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
      req.user = decoded;
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
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, message: 'Insufficient permissions' });
      return;
    }

    next();
  };
}
