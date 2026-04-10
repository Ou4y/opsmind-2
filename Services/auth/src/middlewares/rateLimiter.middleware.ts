import rateLimit from 'express-rate-limit';
import { logger } from '@config/logger';

interface RateLimiterOptions {
  windowMs?: number;
  max?: number;
  message?: string;
}

export const rateLimiter = (options: RateLimiterOptions = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes default
    max = 100, // 100 requests per window default
    message = 'Too many requests, please try again later.',
  } = options;

  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      message,
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next, options) => {
      logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
      res.status(429).json(options.message);
    },
  });
};

// Global rate limiter for all routes
export const globalRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: 'Too many requests from this IP, please try again after 15 minutes.',
});
