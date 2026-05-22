import { Router } from "express";
import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import {
  createTicketSchema,
  updateTicketSchema,
  escalateTicketSchema,
  CreateTicketInput,
  UpdateTicketInput,
  EscalateTicketInput,
} from "../validation/ticket.schema";
import { AppError } from "../errors/AppError";
import { publishTicketCreated, publishTicketUpdated, publishTicketResolvedNotification } from "../events/publishers/ticket.publisher";
import { sendTicketOpenedNotification } from "../utils/notificationClient";
import { validate } from "../middleware/validate.middleware";
import { logger } from "../config/logger";
import { config } from "../config";
import { enrichTicketWithTechnicianName, enrichTicketsWithTechnicianNames } from "../utils/ticketEnrichment";
import { fetchUserDetails } from "../utils/userServiceClient";
import { fetchSupervisor, syncWorkflowTicket } from "../utils/workflowServiceClient";
import { updateSlaStatus, SlaStatusPayload } from "../utils/slaServiceClient";
import {
  getFallbackPriority,
  predictTicketPriority,
  Priority,
  PriorityFallbackDecision,
} from "../utils/aiServiceClient";
import { evaluateAiAgentEligibility } from "../utils/aiAgentEligibility";
import { IssueScope, OperatingSystemType } from "@prisma/client";

const router = Router();

/**
 * @openapi
 * /tickets:
 *   post:
 *     tags: [Tickets]
 *     summary: Create a ticket
 *     description: "User-provided fields: title, description, type_of_request, requester_id, latitude, longitude, plus optional endpoint context for future agentic AI routing. Priority, support level, and initial status (OPEN) are system-assigned. GPS coordinates are used by the Workflow Service for location-aware technician assignment weighted by proximity, workload, and priority."
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, description, type_of_request, requester_id, latitude, longitude]
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               type_of_request:
 *                 type: string
 *                 enum: [INCIDENT, SERVICE_REQUEST, MAINTENANCE]
 *               requester_id:
 *                 type: string
 *                 description: UUID of the user submitting the ticket
 *               latitude:
 *                 type: number
 *                 minimum: -90
 *                 maximum: 90
 *                 description: GPS latitude of the incident location — used for intelligent assignment
 *               longitude:
 *                 type: number
 *                 minimum: -180
 *                 maximum: 180
 *                 description: GPS longitude of the incident location — used for intelligent assignment
 *               affectedDeviceId:
 *                 type: string
 *                 nullable: true
 *                 description: Soft reference to a future endpoint-device registry record (no FK yet)
 *               affectedDeviceName:
 *                 type: string
 *                 nullable: true
 *                 description: Human-readable device name supplied by requester
 *               osType:
 *                 type: string
 *                 enum: [WINDOWS, MACOS, LINUX, UNKNOWN]
 *               issueScope:
 *                 type: string
 *                 enum: [MY_DEVICE, ROOM_DEVICE, MULTIPLE_DEVICES, BUILDING_WIDE, UNKNOWN]
 *               remoteSupportConsent:
 *                 type: boolean
 *                 description: Whether requester consents to remote support actions
 *     responses:
 *       201:
 *         description: Created
 */
router.post("/", validate(createTicketSchema), async (req, res, next) => {
  try {
    console.log("[TicketService] Incoming agentic fields", {
      affectedDeviceId: req.body?.affectedDeviceId,
      affectedDeviceName: req.body?.affectedDeviceName,
      osType: req.body?.osType,
      issueScope: req.body?.issueScope,
      remoteSupportConsent: req.body?.remoteSupportConsent,
    });

    const parsed = createTicketSchema.parse(req.body) as CreateTicketInput;

    console.log("[TicketService] Parsed agentic fields", {
      affectedDeviceId: parsed.affectedDeviceId,
      affectedDeviceName: parsed.affectedDeviceName,
      osType: parsed.osType,
      issueScope: parsed.issueScope,
      remoteSupportConsent: parsed.remoteSupportConsent,
    });

    const {
      title,
      description,
      type_of_request,
      requester_id,
      requester_role,
      topic,
      product_group,
      category,
      building,
      room,
      affectedDeviceId,
      affectedDeviceName,
      osType,
      issueScope,
      remoteSupportConsent,
      latitude,
      longitude,
    } = parsed;

    const ticketId = randomUUID();
    const createdAt = new Date();
    const normalizedAffectedDeviceId =
      typeof affectedDeviceId === "string" && affectedDeviceId.trim().length > 0
        ? affectedDeviceId.trim()
        : null;
    const normalizedAffectedDeviceName =
      typeof affectedDeviceName === "string" && affectedDeviceName.trim().length > 0
        ? affectedDeviceName.trim()
        : null;
    const normalizedOsType: OperatingSystemType = (osType ?? "UNKNOWN") as OperatingSystemType;
    const normalizedIssueScope: IssueScope = (issueScope ?? "UNKNOWN") as IssueScope;
    const hasRemoteSupportConsent = remoteSupportConsent === true;
    const remoteSupportConsentAt = hasRemoteSupportConsent ? createdAt : null;
    const remoteSupportConsentBy = hasRemoteSupportConsent ? requester_id : null;
    const aiAgentEligibility = evaluateAiAgentEligibility({
      title,
      description,
      typeOfRequest: type_of_request,
      category,
      issueScope: normalizedIssueScope,
      remoteSupportConsent: hasRemoteSupportConsent,
      osType: normalizedOsType,
      affectedDeviceId: normalizedAffectedDeviceId,
    });

    let aiDecision: {
      finalPriority: Priority;
      rulePriority: Priority | null;
      aiPriority: Priority | null;
      confidence: number | null;
      decisionSource: string | null;
      priorityScore: number | null;
      explanation: string[] | null;
      modelName: string | null;
      modelVersion: string | null;
      aiPredictionStatus: "SUCCESS" | "FAILED" | "SKIPPED";
    };

    try {
      const prediction = await predictTicketPriority({
        ticketId,
        requesterId: requester_id,
        requesterRole: requester_role,
        title,
        description,
        typeOfRequest: type_of_request,
        topic,
        productGroup: product_group,
        category,
        building,
        room,
        createdAt: createdAt.toISOString(),
        latitude,
        longitude,
      });

      aiDecision = {
        finalPriority: prediction.finalPriority,
        rulePriority: prediction.rulePriority,
        aiPriority: prediction.aiPriority,
        confidence: prediction.confidence,
        decisionSource: prediction.decisionSource,
        priorityScore: prediction.priorityScore,
        explanation: prediction.explanation,
        modelName: prediction.model?.name ?? null,
        modelVersion: prediction.model?.version ?? null,
        aiPredictionStatus: "SUCCESS",
      };
    } catch (aiError: any) {
      logger.warn("AI prediction failed during ticket creation, applying fallback", {
        ticketId,
        requester_id,
        type_of_request,
        error: aiError?.message || String(aiError),
        code: aiError?.code,
      });

      const fallback: PriorityFallbackDecision = getFallbackPriority({
        ticketId,
        title,
        description,
        type_of_request,
      });

      aiDecision = {
        finalPriority: fallback.finalPriority,
        rulePriority: fallback.rulePriority,
        aiPriority: fallback.aiPriority,
        confidence: fallback.confidence,
        decisionSource: fallback.decisionSource,
        priorityScore: fallback.priorityScore,
        explanation: fallback.explanation,
        modelName: null,
        modelVersion: null,
        aiPredictionStatus: "FAILED",
      };
    }

    // System-assigned fields
    const priority = aiDecision.finalPriority;
    const support_level = "L1";
    const assigned_to_level = "L1";
    const status = "OPEN";
    const escalation_count = 0;
    const ticket = await prisma.ticket.create({
      data: {
        id: ticketId,
        title,
        description,
        type_of_request,
        requester_id,
        affected_device_id: normalizedAffectedDeviceId,
        affected_device_name: normalizedAffectedDeviceName,
        os_type: normalizedOsType,
        issue_scope: normalizedIssueScope,
        remote_support_consent: hasRemoteSupportConsent,
        remote_support_consent_at: remoteSupportConsentAt,
        remote_support_consent_by: remoteSupportConsentBy,
        ai_agent_eligible: aiAgentEligibility.aiAgentEligible,
        ai_agent_eligibility_reason: aiAgentEligibility.aiAgentEligibilityReason,
        latitude,
        longitude,
        priority: priority as any,
        support_level,
        assigned_to_level,
        status,
        escalation_count,
        ai_prediction_status: aiDecision.aiPredictionStatus,
        rule_priority: aiDecision.rulePriority,
        ai_priority: aiDecision.aiPriority,
        ai_confidence: aiDecision.confidence,
        ai_decision_source: aiDecision.decisionSource,
        ai_explanation: (aiDecision.explanation ?? undefined) as any,
        ai_model_name: aiDecision.modelName,
        ai_model_version: aiDecision.modelVersion,
        ai_predicted_at: createdAt,
        ai_priority_score: aiDecision.priorityScore,
        created_at: createdAt,
        is_deleted: false,
      },
    });
    
    logger.info(`✅ Ticket created successfully`, {
      ticketId: ticket.id,
      latitude: ticket.latitude,
      longitude: ticket.longitude,
      priority: ticket.priority,
      requester_id: ticket.requester_id,
      ai_prediction_status: (ticket as any).ai_prediction_status,
      ai_decision_source: (ticket as any).ai_decision_source,
      affected_device_id: (ticket as any).affected_device_id,
      os_type: (ticket as any).os_type,
      issue_scope: (ticket as any).issue_scope,
      ai_agent_eligible: (ticket as any).ai_agent_eligible,
    });
    
    await publishTicketCreated(ticket);
    // Fire-and-forget: notification failure must never break ticket creation
    sendTicketOpenedNotification(ticket);
    
    // Best-effort fallback trigger: RabbitMQ is primary, direct HTTP call is safety net.
    const workflowBaseUrl = config.workflowService.url.replace(/\/+$/, "");
    const workflowUrl = `${workflowBaseUrl}/workflow/route-ticket`;
    const workflowPayload = {
      ticketId: ticket.id,
      latitude: ticket.latitude,
      longitude: ticket.longitude,
      priority: ticket.priority,
    };
    
    logger.info(`🔄 Calling Workflow Service for location-based ticket assignment`, {
      ticketId: ticket.id,
      workflowUrl,
      payload: workflowPayload,
    });
    
    try {
      const workflowHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (config.workflowService.internalApiToken) {
        workflowHeaders["x-internal-token"] = config.workflowService.internalApiToken;
      }

      const workflowResponse = await fetch(workflowUrl, {
        method: "POST",
        headers: workflowHeaders,
        body: JSON.stringify(workflowPayload),
      });

      if (workflowResponse.ok) {
        const workflowResult = await workflowResponse.json().catch(() => null);

        if (workflowResponse.status === 202 || workflowResult?.pending) {
          logger.warn(`⚠️ Workflow assignment deferred`, {
            ticketId: ticket.id,
            status: workflowResponse.status,
            response: workflowResult,
          });
        } else {
          logger.info(`✅ Workflow Service notified successfully`, {
            ticketId: ticket.id,
            status: workflowResponse.status,
          });
        }
      } else {
        const workflowErrorBody = await workflowResponse.text().catch(() => "");
        logger.warn(`⚠️ Workflow Service accepted ticket but did not auto-assign immediately`, {
          ticketId: ticket.id,
          status: workflowResponse.status,
          response: workflowErrorBody,
        });
      }
    } catch (workflowError: any) {
      logger.error(`❌ Failed to notify Workflow Service`, {
        ticketId: ticket.id,
        workflowUrl,
        error: workflowError.message,
        code: workflowError.code,
      });
      // Do not rollback ticket creation - ticket remains valid
      logger.warn(`⚠️ Ticket ${ticket.id} created but immediate workflow assignment callback failed. Ticket remains OPEN/UNASSIGNED for review.`);
    }
    
    return res.status(201).json(ticket);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /tickets:
 *   get:
 *     tags: [Tickets]
 *     summary: List tickets
 *     description: "Returns all tickets except soft-deleted (is_deleted = false)."
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [OPEN, IN_PROGRESS, RESOLVED, CLOSED]
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           enum: [LOW, MEDIUM, HIGH]
 *       - in: query
 *         name: requester_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/", async (req, res, next) => {
  try {
    const { status, priority, requester_id, assigned_to, limit, offset } = req.query;
    const assignedToFilter = typeof assigned_to === "string"
      ? assigned_to.split(",").map((value) => value.trim()).filter(Boolean)
      : [];

    const tickets = await prisma.ticket.findMany({
      where: {
        is_deleted: false,
        ...(typeof status === "string" && { status: status as any }),
        ...(typeof priority === "string" && { priority: priority as any }),
        ...(typeof requester_id === "string" && { requester_id }),
        ...(assignedToFilter.length > 0 && {
          assigned_to: {
            in: assignedToFilter,
          },
        }),
      },
      orderBy: { created_at: "desc" },
      take: typeof limit === "string" ? parseInt(limit, 10) : 50,
      skip: typeof offset === "string" ? parseInt(offset, 10) : 0,
    });
    const enrichedTickets = await enrichTicketsWithTechnicianNames(tickets);
    return res.json(enrichedTickets);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /tickets/requester/{requester_id}:
 *   get:
 *     tags: [Tickets]
 *     summary: Get tickets by requester_id
 *     description: "Returns all tickets for a specific requester (not soft-deleted)."
 *     parameters:
 *       - in: path
 *         name: requester_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [OPEN, IN_PROGRESS, RESOLVED, CLOSED]
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           enum: [LOW, MEDIUM, HIGH]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/requester/:requester_id", async (req, res, next) => {
  try {
    const { requester_id } = req.params;
    const { status, priority, limit, offset } = req.query;
    const tickets = await prisma.ticket.findMany({
      where: {
        is_deleted: false,
        requester_id,
        ...(typeof status === "string" && { status: status as any }),
        ...(typeof priority === "string" && { priority: priority as any }),
      },
      orderBy: { created_at: "desc" },
      take: typeof limit === "string" ? parseInt(limit, 10) : 50,
      skip: typeof offset === "string" ? parseInt(offset, 10) : 0,
    });
    const enrichedTickets = await enrichTicketsWithTechnicianNames(tickets);
    return res.json(enrichedTickets);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /tickets/assigned/{technicianId}:
 *   get:
 *     tags: [Tickets]
 *     summary: Get tickets assigned to a technician
 *     description: "Returns all non-deleted tickets where assigned_to matches the given technician ID."
 *     parameters:
 *       - in: path
 *         name: technicianId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [OPEN, IN_PROGRESS, RESOLVED, CLOSED]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 500
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/assigned/:technicianId", async (req, res, next) => {
  try {
    const { technicianId } = req.params;
    const { status, limit, offset } = req.query;
    const tickets = await prisma.ticket.findMany({
      where: {
        is_deleted: false,
        assigned_to: technicianId,
        ...(typeof status === "string" && { status: status as any }),
      },
      orderBy: { created_at: "desc" },
      take: typeof limit === "string" ? parseInt(limit, 10) : 500,
      skip: typeof offset === "string" ? parseInt(offset, 10) : 0,
    });
    const enrichedTickets = await enrichTicketsWithTechnicianNames(tickets);
    return res.json(enrichedTickets);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /tickets/{id}:
 *   get:
 *     tags: [Tickets]
 *     summary: Get ticket by id
 *     description: "Returns ticket if not soft-deleted."
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: OK
 *       404:
 *         description: Ticket not found
 */
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const ticket = await prisma.ticket.findFirst({ where: { id, is_deleted: false } });
    if (!ticket) {
      throw new AppError("Ticket not found", 404);
    }
    const enrichedTicket = await enrichTicketWithTechnicianName(ticket);
    return res.json(enrichedTicket);
  } catch (err) {
    next(err);
  }
});

/**
 * Get assignment history for a ticket
 */
router.get("/:id/assignment-history", async (req, res, next) => {
  try {
    const { id } = req.params;
    const history = await prisma.ticketAssignmentHistory.findMany({
      where: { ticket_id: id },
      orderBy: { created_at: "desc" },
    });
    return res.json({ ticketId: id, items: history });
  } catch (err) {
    next(err);
  }
});

/**
 * Get status history for a ticket
 */
router.get("/:id/status-history", async (req, res, next) => {
  try {
    const { id } = req.params;
    const history = await prisma.ticketStatusHistory.findMany({
      where: { ticket_id: id },
      orderBy: { created_at: "desc" },
    });
    return res.json({ ticketId: id, items: history });
  } catch (err) {
    next(err);
  }
});

/**
 * Get escalation history for a ticket
 */
router.get("/:id/escalations", async (req, res, next) => {
  try {
    const { id } = req.params;
    const escalations = await prisma.ticketEscalation.findMany({
      where: { ticket_id: id },
      orderBy: { created_at: "desc" },
    });
    return res.json({ ticketId: id, items: escalations });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /tickets/{id}:
 *   patch:
 *     tags: [Tickets]
 *     summary: Update a ticket
 *     description: "Updates allowed ticket fields. Status transitions are validated against the state machine (OPEN → IN_PROGRESS → RESOLVED → CLOSED). The assigned_to field is typically set by the Workflow Service after location-based assignment; it can also be set manually here."
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               type_of_request:
 *                 type: string
 *                 enum: [INCIDENT, SERVICE_REQUEST, MAINTENANCE]
 *               status:
 *                 type: string
 *                 enum: [OPEN, IN_PROGRESS, RESOLVED, CLOSED]
 *               resolution_summary:
 *                 type: string
 *               assigned_to:
 *                 type: string
 *                 description: UUID of the technician — set automatically by location-based assignment or manually overridden here
 *               assigned_to_level:
 *                 type: string
 *                 enum: [L1, L2, L3, L4]
 *                 description: Support level of the assigned technician
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: Invalid state transition
 *       404:
 *         description: Ticket not found
 */
router.patch("/:id", validate(updateTicketSchema), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const updateData = req.body as UpdateTicketInput;
    const existing = await prisma.ticket.findFirst({ where: { id, is_deleted: false } });
    if (!existing) {
      throw new AppError("Ticket not found", 404);
    }

    const {
      assignment_method,
      assignment_reason,
      performed_by,
      performed_by_role,
      status_reason,
      ...ticketUpdates
    } = updateData as UpdateTicketInput & {
      assignment_method?: string;
      assignment_reason?: string;
      performed_by?: string | number;
      performed_by_role?: string;
      status_reason?: string;
    };

    // State transition validation
    if (ticketUpdates.status) {
      const validTransitions: Record<string, string[]> = {
        OPEN: ["IN_PROGRESS"],
        IN_PROGRESS: ["RESOLVED"],
        RESOLVED: ["CLOSED"],
      };
      if (
        !validTransitions[existing.status]?.includes(ticketUpdates.status)
      ) {
        return res.status(400).json({ error: "Invalid state transition" });
      }

      if (ticketUpdates.status === "RESOLVED") {
        const incomingSummary = (ticketUpdates.resolution_summary || "").trim();
        const existingSummary = (existing.resolution_summary || "").trim();

        if (!incomingSummary && !existingSummary) {
          ticketUpdates.resolution_summary = "Resolution summary not provided";
        } else if (!incomingSummary) {
          ticketUpdates.resolution_summary = existingSummary;
        }

        (ticketUpdates as any).resolved_at = new Date();
      }

      // Closed timestamp
      if (ticketUpdates.status === "CLOSED") {
        // Prisma expects closed_at in the update object
        (ticketUpdates as any).closed_at = new Date();
      }
    }

    const shouldLogStatus =
      ticketUpdates.status && ticketUpdates.status !== existing.status;

    const shouldLogAssignment =
      (ticketUpdates.assigned_to !== undefined && ticketUpdates.assigned_to !== existing.assigned_to) ||
      (ticketUpdates.assigned_to_level !== undefined && ticketUpdates.assigned_to_level !== existing.assigned_to_level);

    const ticket = await prisma.ticket.update({
      where: { id },
      data: ticketUpdates,
    });

    if (shouldLogStatus) {
      await prisma.ticketStatusHistory.create({
        data: {
          ticket_id: id,
          old_status: existing.status,
          new_status: ticketUpdates.status as any,
          performed_by: performed_by != null ? String(performed_by) : null,
          performed_by_role: performed_by_role || null,
          reason: status_reason || null,
        },
      });
    }

    if (shouldLogAssignment) {
      await prisma.ticketAssignmentHistory.create({
        data: {
          ticket_id: id,
          previous_assignee: existing.assigned_to,
          new_assignee: ticket.assigned_to,
          previous_level: existing.assigned_to_level,
          new_level: ticket.assigned_to_level,
          method: (assignment_method as any) || "WORKFLOW",
          reason: assignment_reason || null,
          performed_by: performed_by != null ? String(performed_by) : null,
          performed_by_role: performed_by_role || null,
        },
      });
    }

    await publishTicketUpdated(ticket);

    // Update SLA status if status changed
    if (ticketUpdates.status) {
      await updateSlaOnStatusChange(ticket, existing.status);
    }

    // Publish notification event if ticket was resolved
    if (ticketUpdates.status === "RESOLVED") {
      await publishResolvedNotification(ticket);
    }

    try {
      await syncWorkflowTicket(ticket, "ticket-service.patch");
    } catch (syncError: any) {
      logger.error("Workflow ticket sync failed after update", {
        ticketId: ticket.id,
        error: syncError?.message || String(syncError),
      });
      return res.status(502).json({
        error: "Ticket updated but workflow sync failed",
        ticketId: ticket.id,
        syncPending: true,
      });
    }

    const enrichedTicket = await enrichTicketWithTechnicianName(ticket);
    return res.json(enrichedTicket);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /tickets/{id}/escalate:
 *   post:
 *     tags: [Tickets]
 *     summary: Escalate a ticket
 *     description: "Escalates ticket, increments escalation_count, updates assigned_to_level, and inserts escalation record."
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [from_level, to_level, reason]
 *             properties:
 *               from_level:
 *                 type: string
 *                 enum: [L1, L2, L3, L4]
 *               to_level:
 *                 type: string
 *                 enum: [L1, L2, L3, L4]
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Ticket escalated
 *       404:
 *         description: Ticket not found
 */
router.post("/:id/escalate", validate(escalateTicketSchema), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const { from_level, to_level, reason } = req.body as EscalateTicketInput;
    const ticket = await prisma.ticket.findFirst({ where: { id, is_deleted: false } });
    if (!ticket) {
      throw new AppError("Ticket not found", 404);
    }
    // Insert escalation record
    await prisma.ticketEscalation.create({
      data: {
        ticket_id: id,
        from_level,
        to_level,
        reason,
      },
    });
    // Update ticket
    const updated = await prisma.ticket.update({
      where: { id },
      data: {
        escalation_count: ticket.escalation_count + 1,
        assigned_to_level: to_level,
      },
    });
    await publishTicketUpdated(updated);
    try {
      await syncWorkflowTicket(updated, "ticket-service.escalate");
    } catch (syncError: any) {
      logger.error("Workflow ticket sync failed after escalation", {
        ticketId: updated.id,
        error: syncError?.message || String(syncError),
      });
      return res.status(502).json({
        error: "Ticket escalated but workflow sync failed",
        ticketId: updated.id,
        syncPending: true,
      });
    }
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /tickets/{id}:
 *   delete:
 *     tags: [Tickets]
 *     summary: Soft delete a ticket
 *     description: "Sets is_deleted = true. Does not physically delete ticket. Escalations are cascade deleted if ticket is physically deleted."
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Deleted
 *       404:
 *         description: Ticket not found
 */
router.delete("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.ticket.findFirst({ where: { id, is_deleted: false } });
    if (!existing) {
      throw new AppError("Ticket not found", 404);
    }
    await prisma.ticket.update({ where: { id }, data: { is_deleted: true } });
    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * Validate user data for notification publishing
 * 
 * Ensures all required fields (id, name, email) are present.
 * 
 * @param userData - User data object to validate
 * @param userType - Type of user for logging ('technician', 'supervisor', 'endUser')
 * @param ticketId - Ticket ID for logging context
 * @returns true if valid, false otherwise
 */
function validateUserData(
  userData: any,
  userType: string,
  ticketId: string
): userData is { id: string; name: string; email: string } {
  if (!userData) {
    logger.warn(`Cannot publish resolved notification: ${userType} data is null`, {
      ticketId,
      userType,
    });
    return false;
  }

  const missingFields: string[] = [];
  if (!userData.id) missingFields.push("id");
  if (!userData.name) missingFields.push("name");
  if (!userData.email) missingFields.push("email");

  if (missingFields.length > 0) {
    logger.warn(
      `Cannot publish resolved notification: ${userType} missing required fields`,
      {
        ticketId,
        userType,
        missingFields: missingFields.join(", "),
        userId: userData.id || "unknown",
      }
    );
    return false;
  }

  logger.debug(`${userType} data validated successfully`, {
    ticketId,
    userType,
    userId: userData.id,
    userName: userData.name,
    userEmail: userData.email,
  });

  return true;
}

/**
 * Helper function to publish ticket resolved notification
 * 
 * Data Flow:
 * 1. Fetches technician from Auth Service (id, name, email)
 * 2. Fetches supervisor from Workflow Service (id, name, email)
 * 3. Fetches end user from Auth Service (id, name, email)
 * 4. Validates all required fields are present
 * 5. Publishes event to RabbitMQ
 * 
 * Validation:
 * - Technician: validates id, name, email (name optional in payload)
 * - Supervisor: validates id, name, email (all required)
 * - End User: validates id, name, email (all required)
 * 
 * Error Handling:
 * - Missing data → logged with specific fields, event not published
 * - API failures → logged, event not published
 * - Never throws → ticket resolution continues
 * 
 * Non-blocking: failures are logged but do not break the update flow.
 */
async function publishResolvedNotification(ticket: any): Promise<void> {
  try {
    logger.info("Publishing ticket resolved notification", { ticketId: ticket.id });

    // Step 1: Validate required ticket fields
    if (!ticket.assigned_to) {
      logger.warn("Cannot publish resolved notification: ticket has no assigned technician", {
        ticketId: ticket.id,
      });
      return;
    }

    if (!ticket.requester_id) {
      logger.warn("Cannot publish resolved notification: ticket has no requester", {
        ticketId: ticket.id,
      });
      return;
    }

    // Step 2: Fetch technician details from Auth Service
    const technician = await fetchUserDetails(ticket.assigned_to);
    if (!technician) {
      logger.warn("Cannot publish resolved notification: failed to fetch technician details", {
        ticketId: ticket.id,
        technicianId: ticket.assigned_to,
      });
      return;
    }

    // Step 3: Validate technician data (id is required, name can be derived from email)
    const technicianData = {
      id: technician.id,
      name: technician.name || technician.email?.split("@")[0] || String(ticket.assigned_to),
      email: technician.email,
    };

    if (!technicianData.email) {
      logger.warn("Cannot publish resolved notification: technician missing email", {
        ticketId: ticket.id,
        technicianId: ticket.assigned_to,
      });
      return;
    }

    // Step 4: Fetch supervisor details from Workflow Service
    const supervisor = await fetchSupervisor();
    if (!supervisor) {
      logger.warn("Cannot publish resolved notification: failed to fetch supervisor details", {
        ticketId: ticket.id,
      });
      return;
    }

    // Step 5: Validate supervisor data (all fields required)
    if (!validateUserData(supervisor, "supervisor", ticket.id)) {
      return;
    }

    // Step 6: Fetch end user details from Auth Service
    const endUser = await fetchUserDetails(ticket.requester_id);
    if (!endUser) {
      logger.warn("Cannot publish resolved notification: failed to fetch end user details", {
        ticketId: ticket.id,
        requesterId: ticket.requester_id,
      });
      return;
    }

    // Step 7: Validate end user data (all fields required)
    if (!validateUserData(endUser, "endUser", ticket.id)) {
      return;
    }

    // Step 8: Build validated payload
    const payload = {
      ticket: {
        id: ticket.id,
        title: ticket.title || "Untitled Ticket",
      },
      technician: {
        id: technicianData.id,
        name: technicianData.name,
      },
      supervisor: {
        id: supervisor.id,
        name: supervisor.name,
        email: supervisor.email,
      },
      endUser: {
        id: endUser.id,
        name: endUser.name,
        email: endUser.email,
      },
    };

    // Step 9: Publish notification event
    await publishTicketResolvedNotification(payload);

    logger.info("Ticket resolved notification published successfully", {
      ticketId: ticket.id,
      technicianEmail: technicianData.email,
      supervisorEmail: supervisor.email,
      endUserEmail: endUser.email,
    });
  } catch (error) {
    logger.error("Failed to publish ticket resolved notification", {
      ticketId: ticket.id,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - notification failure should not break the update flow
  }
}

/**
 * Update SLA status after ticket status change
 * 
 * Data Flow:
 * 1. Fetches technician from Auth Service (id, name, email)
 * 2. Fetches supervisor from Workflow Service (id, name, email)
 * 3. Validates all required fields are present
 * 4. Builds SLA payload with appropriate timestamp fields:
 *    - IN_PROGRESS: firstResponseAt
 *    - RESOLVED: resolvedAt
 *    - CLOSED: closedAt
 * 5. Calls PATCH /sla/tickets/{ticketId}/status
 * 
 * Validation:
 * - Requires assigned_to to be set
 * - Validates technician data (id, name, email)
 * - Validates supervisor data (id, name, email)
 * 
 * Error Handling:
 * - Missing assigned_to → logged, SLA not updated
 * - Missing data → logged, SLA not updated
 * - API failures → logged, SLA not updated
 * - Never throws → ticket update continues
 * 
 * Non-blocking: failures are logged but do not break the update flow.
 */
async function updateSlaOnStatusChange(ticket: any, oldStatus: string): Promise<void> {
  try {
    logger.info("Updating SLA status after ticket status change", {
      ticketId: ticket.id,
      oldStatus,
      newStatus: ticket.status,
    });

    // Only update SLA for these statuses
    if (!["IN_PROGRESS", "RESOLVED", "CLOSED"].includes(ticket.status)) {
      return;
    }

    let technicianData = undefined;
    if (ticket.assigned_to) {
      try {
        const technician = await fetchUserDetails(ticket.assigned_to);
        if (technician) {
          technicianData = {
            id: technician.id,
            name: technician.name || technician.email?.split("@")[0] || String(ticket.assigned_to),
            email: technician.email,
          };
        } else {
          logger.warn("Technician enrichment failed, proceeding without technician", {
            ticketId: ticket.id,
            technicianId: ticket.assigned_to,
          });
        }
      } catch (err) {
        logger.warn("Technician enrichment threw error, proceeding without technician", {
          ticketId: ticket.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    let supervisorData = undefined;
    try {
      const supervisor = await fetchSupervisor();
      if (supervisor && supervisor.id && supervisor.name && supervisor.email) {
        supervisorData = {
          id: supervisor.id,
          name: supervisor.name,
          email: supervisor.email,
        };
      } else {
        logger.warn("Supervisor enrichment failed, proceeding without supervisor", {
          ticketId: ticket.id,
        });
      }
    } catch (err) {
      logger.warn("Supervisor enrichment threw error, proceeding without supervisor", {
        ticketId: ticket.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Build SLA payload with optional technician/supervisor
    const payload: SlaStatusPayload = {
      ticketStatus: ticket.status,
      assignedTo: ticket.assigned_to,
      title: ticket.title || "Untitled Ticket",
      ...(technicianData ? { technician: technicianData } : {}),
      ...(supervisorData ? { supervisor: supervisorData } : {}),
    };

    // Add appropriate timestamp based on status
    if (ticket.status === "IN_PROGRESS" && oldStatus === "OPEN") {
      payload.firstResponseAt = new Date().toISOString();
    } else if (ticket.status === "RESOLVED") {
      payload.resolvedAt = ticket.resolved_at?.toISOString() || new Date().toISOString();
    } else if (ticket.status === "CLOSED") {
      payload.closedAt = ticket.closed_at?.toISOString() || new Date().toISOString();
    }

    // Call SLA service to update status
    await updateSlaStatus(ticket.id, payload);

    logger.info("SLA status update completed", {
      ticketId: ticket.id,
      status: ticket.status,
      technicianEmail: technicianData?.email,
      supervisorEmail: supervisorData?.email,
    });
  } catch (error) {
    logger.error("Failed to update SLA status", {
      ticketId: ticket.id,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - SLA failure should not break the update flow
  }
}

export default router;
