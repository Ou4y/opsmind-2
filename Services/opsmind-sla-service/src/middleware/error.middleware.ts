import { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/AppError";
import { logger } from "../config/logger";

export function errorMiddleware(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      details: error.details ?? null,
    });
    return;
  }

  logger.error("Unhandled error", {
    error: error instanceof Error ? error.message : String(error),
  });

  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
}
