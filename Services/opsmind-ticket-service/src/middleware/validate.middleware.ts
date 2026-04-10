import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import { AppError } from "../errors/AppError";

export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.issues.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        }));

        const appError = new AppError("Validation failed", 400);
        (appError as any).details = details;
        return next(appError);
      }
      next(error);
    }
  };
}
