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
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
  priority: Joi.string().valid('CRITICAL', 'HIGH', 'MEDIUM', 'LOW').optional(),
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

export const updateTechnicianLocationSchema = Joi.object({
  technician_id: Joi.number().integer().required(),
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
}).unknown(false);

// ── Hierarchy Management Schemas ──

export const createRelationshipSchema = Joi.object({
  childUserId: Joi.number().integer().required(),
  parentUserId: Joi.number().integer().required(),
  relationshipType: Joi.string()
    .valid('JUNIOR_TO_SENIOR', 'SENIOR_TO_SUPERVISOR', 'SUPERVISOR_TO_ADMIN')
    .required(),
}).unknown(false);

export const deleteRelationshipSchema = Joi.object({
  childUserId: Joi.number().integer().required(),
  parentUserId: Joi.number().integer().required(),
}).unknown(false);

export const listTechniciansSchema = Joi.object({
  level: Joi.string().valid('JUNIOR', 'SENIOR', 'SUPERVISOR', 'ADMIN').optional(),
}).unknown(true);

export const syncTechnicianFromAuthSchema = Joi.object({
  authUserId: Joi.string().guid({ version: 'uuidv4' }).required(),
  firstName: Joi.string().trim().min(1).max(100).required(),
  lastName: Joi.string().trim().min(1).max(100).required(),
  email: Joi.string().email().required(),
  authRole: Joi.string().valid('ADMIN', 'TECHNICIAN', 'DOCTOR', 'STUDENT').required(),
  technicianLevel: Joi.string().valid('JUNIOR', 'SENIOR', 'SUPERVISOR', 'ADMIN').optional(),
})
  .custom((value, helpers) => {
    if (value.authRole === 'TECHNICIAN') {
      if (!value.technicianLevel) {
        return helpers.error('any.custom', {
          message: 'technicianLevel is required when authRole is TECHNICIAN',
        });
      }

      if (!['JUNIOR', 'SENIOR', 'SUPERVISOR'].includes(value.technicianLevel)) {
        return helpers.error('any.custom', {
          message: 'TECHNICIAN role supports only JUNIOR, SENIOR, or SUPERVISOR levels',
        });
      }
    }

    if (value.authRole === 'ADMIN' && value.technicianLevel && value.technicianLevel !== 'ADMIN') {
      return helpers.error('any.custom', {
        message: 'ADMIN role can only use ADMIN technicianLevel',
      });
    }

    if ((value.authRole === 'DOCTOR' || value.authRole === 'STUDENT') && value.technicianLevel) {
      return helpers.error('any.custom', {
        message: `${value.authRole} users cannot be synced as workflow technicians`,
      });
    }

    return value;
  }, 'role-level compatibility validation')
  .messages({
    'any.custom': '{{#message}}',
  })
  .unknown(false);
