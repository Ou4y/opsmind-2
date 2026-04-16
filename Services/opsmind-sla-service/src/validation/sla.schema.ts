import { z } from "zod";

const priorityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const contactSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
});

export const startSlaSchema = z.object({
  body: z.object({
    ticketId: z.string().min(1),
    priority: priorityEnum,
    title: z.string().optional().nullable(),
    createdAt: z.string().datetime().optional(),
    assignedTo: z.string().optional().nullable(),
    ticketStatus: z.string().optional(),
    building: z.string().optional().nullable(),
    floor: z.number().int().optional().nullable(),
    room: z.string().optional().nullable(),
    supportGroupId: z.union([z.string(), z.number()]).optional().nullable(),
    requesterId: z.union([z.string(), z.number()]).optional().nullable(),
    technician: contactSchema.optional().nullable(),
    supervisor: contactSchema.optional().nullable(),
  }),
  params: z.object({}),
  query: z.object({}),
});

export const updateTicketSlaStatusSchema = z.object({
  body: z.object({
    ticketStatus: z.string().min(1).optional(),
    assignedTo: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    resolvedAt: z.string().datetime().optional(),
    closedAt: z.string().datetime().optional(),
    firstResponseAt: z.string().datetime().optional(),
    building: z.string().optional().nullable(),
    floor: z.number().int().optional().nullable(),
    room: z.string().optional().nullable(),
    supportGroupId: z.union([z.string(), z.number()]).optional().nullable(),
    technician: contactSchema.optional().nullable(),
    supervisor: contactSchema.optional().nullable(),
  }).refine(
    (body) =>
      body.ticketStatus !== undefined ||
      body.assignedTo !== undefined ||
      body.title !== undefined ||
      body.resolvedAt !== undefined ||
      body.closedAt !== undefined ||
      body.firstResponseAt !== undefined ||
      body.building !== undefined ||
      body.floor !== undefined ||
      body.room !== undefined ||
      body.supportGroupId !== undefined ||
      body.technician !== undefined ||
      body.supervisor !== undefined,
    {
      message: "At least one SLA field must be provided",
    }
  ),
  params: z.object({
    ticketId: z.string().min(1),
  }),
  query: z.object({}),
});

export const pauseTicketSlaSchema = z.object({
  body: z.object({
    reason: z.string().optional(),
  }).optional(),
  params: z.object({
    ticketId: z.string().min(1),
  }),
  query: z.object({}),
});

export const ticketIdParamsSchema = z.object({
  body: z.any().optional(),
  params: z.object({
    ticketId: z.string().min(1),
  }),
  query: z.object({}),
});

export const upsertPolicySchema = z.object({
  body: z.object({
    priority: priorityEnum,
    name: z.string().min(1),
    responseMinutes: z.number().int().positive(),
    resolutionMinutes: z.number().int().positive(),
    warning1Percent: z.number().int().min(1).max(99).default(70),
    warning2Percent: z.number().int().min(1).max(99).default(85),
    breachPercent: z.number().int().min(100).default(100),
    breachAction: z.string().min(1).default("NOTIFY_AND_REQUEST_WORKFLOW"),
  }),
  params: z.object({}),
  query: z.object({}),
});
