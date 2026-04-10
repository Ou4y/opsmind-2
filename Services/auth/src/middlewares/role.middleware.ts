import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.middleware';
import { RoleName } from '@/types';

export const roleMiddleware = (allowedRoles: RoleName[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
      return;
    }

    const userRoles = req.user.roles;
    const hasPermission = userRoles.some(role => 
      allowedRoles.includes(role as RoleName)
    );

    if (!hasPermission) {
      res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions.',
      });
      return;
    }

    next();
  };
};
