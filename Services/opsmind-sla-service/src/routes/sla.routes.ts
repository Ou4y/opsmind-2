import { Router } from "express";
import { validate } from "../middleware/validate.middleware";
import { slaController } from "../modules/sla/sla.controller";
import {
  pauseTicketSlaSchema,
  startSlaSchema,
  ticketIdParamsSchema,
  updateTicketSlaStatusSchema,
  upsertPolicySchema,
} from "../validation/sla.schema";

export const slaRoutes = Router();

slaRoutes.get("/health", slaController.health);
slaRoutes.get("/", slaController.health);

slaRoutes.post("/sla/start", validate(startSlaSchema), slaController.start);
slaRoutes.post("/sla/calculate", validate(startSlaSchema), slaController.start);

slaRoutes.get("/sla/tickets/:ticketId", validate(ticketIdParamsSchema), slaController.getByTicketId);

slaRoutes.get("/sla/policies", slaController.getPolicies);
slaRoutes.post("/sla/policies", validate(upsertPolicySchema), slaController.upsertPolicy);

slaRoutes.patch(
  "/sla/tickets/:ticketId/status",
  validate(updateTicketSlaStatusSchema),
  slaController.updateStatus
);

slaRoutes.post("/sla/tickets/:ticketId/pause", validate(pauseTicketSlaSchema), slaController.pause);
slaRoutes.post("/sla/tickets/:ticketId/resume", validate(ticketIdParamsSchema), slaController.resume);

slaRoutes.post("/sla/monitor/run", slaController.runMonitorNow);
