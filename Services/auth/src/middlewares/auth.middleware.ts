import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '@utils/jwt.util';
import { userRepository } from '@modules/users/user.repository';
import { logger } from '@config/logger';
import { AuthTokenPayload } from '@/types';

export interface AuthenticatedRequest extends Request {
  user?: AuthTokenPayload & { isActive: boolean };
}

export const authMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.',
      });
      return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    try {
      const decoded = verifyToken(token);
      
      // Verify user still exists and is active
      const user = await userRepository.findById(decoded.userId);
      if (!user) {
        res.status(401).json({
          success: false,
          message: 'User not found.',
        });
        return;
      }

      if (!user.is_active) {
        res.status(401).json({
          success: false,
          message: 'Account has been deactivated.',
        });
        return;
      }

      req.user = {
        ...decoded,
        isActive: user.is_active,
      };

      next();
    } catch (tokenError) {
      logger.warn('Invalid token:', tokenError);
      res.status(401).json({
        success: false,
        message: 'Invalid or expired token.',
      });
      return;
    }
  } catch (error) {
    logger.error('Auth middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error.',
    });
  }
};
