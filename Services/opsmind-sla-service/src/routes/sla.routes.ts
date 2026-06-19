import { Router } from "express";
import { requireAuth, requireAuthOrInternal, requireRole } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { slaController } from "../modules/sla/sla.controller";
import {
  bulkTicketStatusSchema,
  complianceReportQuerySchema,
  pauseTicketSlaSchema,
  pauseAnalyticsQuerySchema,
  startSlaSchema,
  ticketIdParamsSchema,
  updateTicketSlaDeadlinesSchema,
  updateTicketSlaStatusSchema,
  upsertPolicySchema,
} from "../validation/sla.schema";

export const slaRoutes = Router();

slaRoutes.get("/health", slaController.health);
slaRoutes.get("/health/ready", slaController.ready);
slaRoutes.get("/", slaController.health);

slaRoutes.post("/sla/start", requireAuthOrInternal, validate(startSlaSchema), slaController.start);
slaRoutes.post("/sla/calculate", requireAuthOrInternal, validate(startSlaSchema), slaController.start);

slaRoutes.get("/sla/tickets", slaController.listTickets);
slaRoutes.get("/sla/tickets/:ticketId", validate(ticketIdParamsSchema), slaController.getByTicketId);
slaRoutes.post("/sla/tickets/status", validate(bulkTicketStatusSchema), slaController.getBulkTicketStatus);
slaRoutes.get("/sla/reports/compliance", validate(complianceReportQuerySchema), slaController.getComplianceReport);
slaRoutes.get("/sla/reports/pause-analytics", validate(pauseAnalyticsQuerySchema), slaController.getPauseAnalytics);

slaRoutes.get("/sla/policies", requireAuth, requireRole("ADMIN"), slaController.getPolicies);
slaRoutes.post(
  "/sla/policies",
  requireAuth,
  requireRole("ADMIN"),
  validate(upsertPolicySchema),
  slaController.upsertPolicy
);

slaRoutes.patch(
  "/sla/tickets/:ticketId/status",
  requireAuthOrInternal,
  validate(updateTicketSlaStatusSchema),
  slaController.updateStatus
);
slaRoutes.patch(
  "/sla/tickets/:ticketId/deadlines",
  requireAuth,
  requireRole("ADMIN"),
  validate(updateTicketSlaDeadlinesSchema),
  slaController.updateDeadlines
);

slaRoutes.post(
  "/sla/tickets/:ticketId/pause",
  requireAuthOrInternal,
  validate(pauseTicketSlaSchema),
  slaController.pause
);
slaRoutes.post(
  "/sla/tickets/:ticketId/resume",
  requireAuthOrInternal,
  validate(ticketIdParamsSchema),
  slaController.resume
);

slaRoutes.post("/sla/monitor/run", requireAuthOrInternal, slaController.runMonitorNow);
