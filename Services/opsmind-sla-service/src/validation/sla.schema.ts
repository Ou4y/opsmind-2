import { z } from "zod";

const priorityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const startSlaSchema = z.object({
  body: z.object({
    ticketId: z.string().min(1),
    priority: priorityEnum,
    createdAt: z.string().datetime().optional(),
    assignedTo: z.string().optional().nullable(),
    ticketStatus: z.string().optional(),
    building: z.string().optional().nullable(),
    floor: z.number().int().optional().nullable(),
    room: z.string().optional().nullable(),
    supportGroupId: z.union([z.string(), z.number()]).optional().nullable(),
    requesterId: z.union([z.string(), z.number()]).optional().nullable(),
  }),
  params: z.object({}),
  query: z.object({}),
});

export const updateTicketSlaStatusSchema = z.object({
  body: z.object({
    ticketStatus: z.string().min(1),
    assignedTo: z.string().optional().nullable(),
    resolvedAt: z.string().datetime().optional(),
    closedAt: z.string().datetime().optional(),
    firstResponseAt: z.string().datetime().optional(),
    building: z.string().optional().nullable(),
    floor: z.number().int().optional().nullable(),
    room: z.string().optional().nullable(),
    supportGroupId: z.union([z.string(), z.number()]).optional().nullable(),
  }),
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
