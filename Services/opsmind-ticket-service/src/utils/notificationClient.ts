import { logger } from "../config/logger";
import { Ticket } from "@prisma/client";

const NOTIFICATION_URL = "http://localhost:3000/api/notifications";
const INTERNAL_SECRET = "supersecret";

// Static defaults as per requirements
const STATIC_END_USER_EMAIL = "janah2202047@miuegypt.edu.eg";
const STATIC_ADMIN_ID = "6108650d-0526-11f1-8f40-c652d68f7502";
const STATIC_TECHNICIAN_ID = "it-1";
const STATIC_TECHNICIAN_NAME = "ismail nasser";

export async function sendTicketOpenedNotification(ticket: Ticket): Promise<void> {
  try {
    const body = {
      type: "TICKET_OPENED",
      payload: {
        ticket: {
          id: ticket.id,
          title: ticket.title,
        },
        endUser: {
          id: ticket.requester_id,
          email: STATIC_END_USER_EMAIL,
        },
        admin: {
          id: STATIC_ADMIN_ID,
        },
        technician: {
          id: STATIC_TECHNICIAN_ID,
          name: STATIC_TECHNICIAN_NAME,
        },
      },
    };

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
    const body = {
      type: "TICKET_RESOLVED",
      payload: {
        ticket: {
          id: ticket.id,
          title: ticket.title,
        },
        endUser: {
          id: ticket.requester_id,
          email: STATIC_END_USER_EMAIL,
        },
        admin: {
          id: STATIC_ADMIN_ID,
        },
        technician: {
          id: STATIC_TECHNICIAN_ID,
          name: STATIC_TECHNICIAN_NAME,
        },
      },
    };

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
