import { Request, Response, NextFunction } from 'express';

/**
 * Global Error Handler Middleware (TypeScript)
 *
 * Catches unhandled errors and returns a consistent JSON response.
 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('Unhandled error:', err);

  const nodeEnv = process.env.NODE_ENV || 'development';
  const statusCode = (err as any).statusCode || 500;
  const message = statusCode >= 500 && nodeEnv !== 'development'
    ? 'Internal Server Error'
    : (err.message || 'Internal Server Error');

  res.status(statusCode).json({
    success: false,
    message: message,
    ...(nodeEnv === 'development' && { stack: err.stack }),
  });
}

/**
 * Not Found Handler
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
}
