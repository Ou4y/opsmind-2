import { Request, Response, NextFunction } from 'express';

/**
 * Request Logger Middleware (TypeScript)
 *
 * Logs every incoming request with timing.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`,
    );
  });

  next();
}
