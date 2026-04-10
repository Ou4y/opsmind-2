import { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError";
import { logger } from "../config/logger";

export function errorMiddleware(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const requestId = req.requestId ?? "unknown";

  // Known / operational errors
  if (err instanceof AppError) {
    logger.warn("Operational error", {
      requestId,
      error: err.message,
      statusCode: err.statusCode,
    });

    return res.status(err.statusCode).json({
      error: err.message,
      ...((err as any).details && { details: (err as any).details }),
    });
  }

  // Unknown / programmer errors
  logger.error("Unexpected error", {
    requestId,
    error: err.message,
    stack: err.stack,
  });

  return res.status(500).json({
    error: "Internal Server Error",
  });
}
