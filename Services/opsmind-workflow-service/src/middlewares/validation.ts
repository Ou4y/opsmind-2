import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';

/**
 * Validation Middleware Factory (TypeScript)
 *
 * Creates middleware that validates req.body against a Joi schema.
 */
export function validateBody(schema: Joi.ObjectSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error } = schema.validate(req.body, { abortEarly: false });

    if (error) {
      const details = error.details.map((d) => d.message).join(', ');
      res.status(400).json({ success: false, message: `Validation failed: ${details}` });
      return;
    }

    next();
  };
}

// ── Predefined Schemas ──

export const routeTicketSchema = Joi.object({
  ticketId: Joi.string().required(),
  building: Joi.string().required(),
  floor: Joi.number().integer().required(),
}).unknown(true);

export const claimTicketSchema = Joi.object({
  technician_id: Joi.number().integer().optional(),
  userId: Joi.number().integer().optional(),
}).or('technician_id', 'userId').unknown(true);

export const reassignTicketSchema = Joi.object({
  to_technician_id: Joi.number().integer().optional(),
  toMemberId: Joi.number().integer().optional(),
  reassigned_by: Joi.number().integer().optional(),
  userId: Joi.number().integer().optional(),
  reason: Joi.string().optional(),
  userRole: Joi.string().optional(),
  userBuilding: Joi.string().optional(),
}).or('to_technician_id', 'toMemberId').unknown(true);

export const escalateTicketSchema = Joi.object({
  reason: Joi.string().optional(),
  escalated_by: Joi.number().integer().optional(),
  triggerType: Joi.string().valid('SLA', 'MANUAL', 'CRITICAL', 'REOPEN_COUNT').optional(),
  performedBy: Joi.number().integer().optional(),
  userRole: Joi.string().optional(),
}).unknown(true);
