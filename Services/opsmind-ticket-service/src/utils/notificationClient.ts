import { logger } from "../config/logger";
import { Ticket } from "@prisma/client";

const NOTIFICATION_URL = process.env.NOTIFICATION_URL || "http://notification-service:3000/api/notifications";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || process.env.NOTIFICATION_INTERNAL_SECRET || "";
const NOTIFICATION_ADMIN_ID = process.env.NOTIFICATION_ADMIN_ID || "";

function buildLegacyPayload(ticket: Ticket, type: "TICKET_OPENED" | "TICKET_RESOLVED") {
  const payload: Record<string, any> = {
    ticket: {
      id: ticket.id,
      title: ticket.title,
    },
    endUser: {
      id: ticket.requester_id,
    },
  };

  if (NOTIFICATION_ADMIN_ID) {
    payload.admin = { id: NOTIFICATION_ADMIN_ID };
  }

  if (ticket.assigned_to) {
    payload.technician = { id: ticket.assigned_to };
  }

  return {
    type,
    payload,
  };
}

export async function sendTicketOpenedNotification(ticket: Ticket): Promise<void> {
  try {
    if (!INTERNAL_SECRET) {
      logger.warn("Skipping notification call because INTERNAL_SECRET is not configured");
      return;
    }

    const body = buildLegacyPayload(ticket, "TICKET_OPENED");

    const response = await fetch(NOTIFICATION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      logger.warn("Notification service returned non-OK status", {
        status: response.status,
        ticketId: ticket.id,
      });
    } else {
      logger.info("TICKET_OPENED notification sent", { ticketId: ticket.id });
    }
  } catch (err) {
    // Never propagate – notification failure must not break ticket creation
    logger.warn("Failed to send TICKET_OPENED notification (non-fatal)", {
      ticketId: ticket.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function sendTicketResolvedNotification(ticket: Ticket): Promise<void> {
  try {
    if (!INTERNAL_SECRET) {
      logger.warn("Skipping notification call because INTERNAL_SECRET is not configured");
      return;
    }

    const body = buildLegacyPayload(ticket, "TICKET_RESOLVED");

    const response = await fetch(NOTIFICATION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      logger.warn("Notification service returned non-OK status", {
        status: response.status,
        ticketId: ticket.id,
      });
    } else {
      logger.info("TICKET_RESOLVED notification sent", { ticketId: ticket.id });
    }
  } catch (err) {
    logger.warn("Failed to send TICKET_RESOLVED notification (non-fatal)", {
      ticketId: ticket.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
