import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { authService } from './auth.service';
import { logger } from '@config/logger';

export class AuthController {
  async signup(req: Request, res: Response): Promise<void> {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
        return;
      }

      const { email, password, firstName, lastName, role } = req.body;
      const result = await authService.signup({ email, password, firstName, lastName, role });

      if (!result.user) {
        res.status(400).json({
          success: false,
          message: result.message,
        });
        return;
      }

      res.status(201).json({
        success: true,
        message: result.message,
        data: {
          user: result.user,
          requiresOTP: result.requiresOTP,
        },
      });
    } catch (error) {
      logger.error('Signup error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  async login(req: Request, res: Response): Promise<void> {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
        return;
      }

      const { email, password } = req.body;
      const result = await authService.login({ email, password });

      if (!result.requiresOTP && !result.token) {
        res.status(401).json({
          success: false,
          message: result.message,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: result.message,
        data: {
          requiresOTP: result.requiresOTP,
        },
      });
    } catch (error) {
      logger.error('Login error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  async verifyOTP(req: Request, res: Response): Promise<void> {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
        return;
      }

      const { email, otp, purpose } = req.body;
      const result = await authService.verifyOTP({ email, otp, purpose });

      if (!result.token && purpose === 'LOGIN') {
        res.status(401).json({
          success: false,
          message: result.message,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: result.message,
        data: {
          user: result.user,
          token: result.token,
          requiresOTP: result.requiresOTP,
        },
      });
    } catch (error) {
      logger.error('Verify OTP error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  async resendOTP(req: Request, res: Response): Promise<void> {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
        return;
      }

      const { email, purpose } = req.body;
      const result = await authService.resendOTP(email, purpose);

      // Always return success to prevent email enumeration
      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      logger.error('Resend OTP error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }
}

export const authController = new AuthController();
