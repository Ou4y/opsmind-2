import { Router } from "express";
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
import { enrichTicketWithTechnicianName, enrichTicketsWithTechnicianNames } from "../utils/ticketEnrichment";
import { fetchUserDetails } from "../utils/userServiceClient";
import { fetchSupervisor } from "../utils/workflowServiceClient";

const router = Router();

/**
 * @openapi
 * /tickets:
 *   post:
 *     tags: [Tickets]
 *     summary: Create a ticket
 *     description: "User-provided fields: title, description, type_of_request, requester_id, latitude, longitude. Priority, support level, and initial status (OPEN) are system-assigned. GPS coordinates are used by the Workflow Service for location-aware technician assignment weighted by proximity, workload, and priority."
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
 *     responses:
 *       201:
 *         description: Created
 */
router.post("/", validate(createTicketSchema), async (req, res, next) => {
  try {
    const { title, description, type_of_request, requester_id, latitude, longitude } = req.body as CreateTicketInput;
    // System-assigned fields — priority and support level are determined by the system, not the requester
    const priority = "MEDIUM"; // Resolved by priority-classification rules in the Workflow Service
    const support_level = "L1";
    const assigned_to_level = "L1";
    const status = "OPEN";
    const escalation_count = 0;
    const ticket = await prisma.ticket.create({
      data: {
        title,
        description,
        type_of_request,
        requester_id,
        latitude,
        longitude,
        priority,
        support_level,
        assigned_to_level,
        status,
        escalation_count,
        is_deleted: false,
      },
    });
    
    logger.info(`✅ Ticket created successfully`, {
      ticketId: ticket.id,
      latitude: ticket.latitude,
      longitude: ticket.longitude,
      priority: ticket.priority,
      requester_id: ticket.requester_id,
    });
    
    await publishTicketCreated(ticket);
    // Fire-and-forget: notification failure must never break ticket creation
    sendTicketOpenedNotification(ticket);
    
    // Notify Workflow Service (non-blocking) — provides coordinates and priority for intelligent assignment
    const workflowUrl = "http://opsmind-workflow:3003/workflow/route-ticket";
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
      const workflowResponse = await fetch(workflowUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(workflowPayload),
      });
      logger.info(`✅ Workflow Service notified successfully`, {
        ticketId: ticket.id,
        status: workflowResponse.status,
      });
    } catch (workflowError: any) {
      logger.error(`❌ Failed to notify Workflow Service`, {
        ticketId: ticket.id,
        workflowUrl,
        error: workflowError.message,
        code: workflowError.code,
      });
      // Do not rollback ticket creation - ticket remains valid
      logger.warn(`⚠️ Ticket ${ticket.id} created but location-based assignment failed — manual assignment required via PATCH /tickets/:id`);
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
    const { status, priority, requester_id, limit, offset } = req.query;
    const tickets = await prisma.ticket.findMany({
      where: {
        is_deleted: false,
        ...(typeof status === "string" && { status: status as any }),
        ...(typeof priority === "string" && { priority: priority as any }),
        ...(typeof requester_id === "string" && { requester_id }),
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
    // State transition validation
    if (updateData.status) {
      const validTransitions: Record<string, string[]> = {
        OPEN: ["IN_PROGRESS"],
        IN_PROGRESS: ["RESOLVED"],
        RESOLVED: ["CLOSED"],
      };
      if (
        !validTransitions[existing.status]?.includes(updateData.status)
      ) {
        return res.status(400).json({ error: "Invalid state transition" });
      }
      // Closed timestamp
      if (updateData.status === "CLOSED") {
        // Prisma expects closed_at in the update object
        (updateData as any).closed_at = new Date();
      }
    }
    const ticket = await prisma.ticket.update({
      where: { id },
      data: updateData,
    });
    await publishTicketUpdated(ticket);

    // Publish notification event if ticket was resolved
    if (updateData.status === "RESOLVED") {
      await publishResolvedNotification(ticket);
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

export default router;
