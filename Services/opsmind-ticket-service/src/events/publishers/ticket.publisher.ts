import { getChannel, EXCHANGE_NAME } from "../../lib/rabbitmq";
import { logger } from "../../config/logger";
import { Ticket } from "@prisma/client";

export async function publishTicketCreated(ticket: Ticket): Promise<void> {
  const channel = getChannel();
  await channel.assertExchange("ticket.events", "topic", { durable: true });

  const payload = {
    eventType: "ticket.created",
    occurredAt: new Date().toISOString(),
    data: {
      id: ticket.id,
      ticket_id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      type_of_request: ticket.type_of_request,
      requester_id: ticket.requester_id,
      latitude: ticket.latitude,
      longitude: ticket.longitude,
      priority: ticket.priority,
      support_level: ticket.support_level,
      assigned_to: ticket.assigned_to,
      assigned_to_level: ticket.assigned_to_level,
      status: ticket.status,
      escalation_count: ticket.escalation_count,
      ai_prediction_status: (ticket as any).ai_prediction_status ?? null,
      rule_priority: (ticket as any).rule_priority ?? null,
      ai_priority: (ticket as any).ai_priority ?? null,
      ai_confidence: (ticket as any).ai_confidence ?? null,
      ai_decision_source: (ticket as any).ai_decision_source ?? null,
      resolution_summary: ticket.resolution_summary ?? null,
      resolved_at: ticket.resolved_at ?? null,
      created_at: ticket.created_at,
      updated_at: ticket.updated_at,
      closed_at: ticket.closed_at ?? null,
    },
  };

  logger.debug("Publishing ticket.created event", {
    exchange: "ticket.events",
    routingKey: "ticket.created",
    ticketId: ticket.id,
    latitude: ticket.latitude,
    longitude: ticket.longitude,
  });

  channel.publish("ticket.events", "ticket.created", Buffer.from(JSON.stringify(payload)));

  logger.info("Event published: ticket.created", {
    ticketId: ticket.id,
    latitude: ticket.latitude,
    longitude: ticket.longitude,
  });
}

export async function publishTicketUpdated(ticket: Ticket): Promise<void> {
  const channel = getChannel();
  const routingKey = "ticket.updated";

  const message = {
    eventType: "ticket.updated",
    occurredAt: new Date().toISOString(),
    data: {
      id: ticket.id,
      ticket_id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      type_of_request: ticket.type_of_request,
      requester_id: ticket.requester_id,
      latitude: ticket.latitude,
      longitude: ticket.longitude,
      priority: ticket.priority,
      support_level: ticket.support_level,
      assigned_to: ticket.assigned_to,
      assigned_to_level: ticket.assigned_to_level,
      status: ticket.status,
      escalation_count: ticket.escalation_count,
      ai_prediction_status: (ticket as any).ai_prediction_status ?? null,
      rule_priority: (ticket as any).rule_priority ?? null,
      ai_priority: (ticket as any).ai_priority ?? null,
      ai_confidence: (ticket as any).ai_confidence ?? null,
      ai_decision_source: (ticket as any).ai_decision_source ?? null,
      resolution_summary: ticket.resolution_summary ?? null,
      resolved_at: ticket.resolved_at ?? null,
      updated_at: ticket.updated_at,
      closed_at: ticket.closed_at ?? null,
    },
  };

  channel.publish(
    EXCHANGE_NAME,
    routingKey,
    Buffer.from(JSON.stringify(message)),
    { persistent: true }
  );

  logger.info("Event published: ticket.updated", {
    ticketId: ticket.id,
    latitude: ticket.latitude,
    longitude: ticket.longitude,
  });
}

/**
 * Notification Event Payload for Ticket Resolution
 */
interface TicketResolvedNotificationPayload {
  ticket: {
    id: string;
    title: string;
  };
  technician: {
    id: string;
    name: string;
  };
  supervisor: {
    id: string;
    name: string;
    email: string;
  };
  endUser: {
    id: string;
    name: string;
    email: string;
  };
}

/**
 * Publish ticket resolved notification event
 * 
 * This event is consumed by the Notification Service to send
 * resolution notifications to relevant parties.
 * 
 * @param payload - Notification payload with ticket, technician, supervisor, and end user info
 */
export async function publishTicketResolvedNotification(
  payload: TicketResolvedNotificationPayload
): Promise<void> {
  try {
    const channel = getChannel();
    const routingKey = "ticket.notification.resolved";

    const message = {
      eventType: "ticket.notification.resolved",
      occurredAt: new Date().toISOString(),
      data: payload,
    };

    channel.publish(
      EXCHANGE_NAME,
      routingKey,
      Buffer.from(JSON.stringify(message)),
      { persistent: true }
    );

    logger.info("Event published: ticket.notification.resolved", {
      ticketId: payload.ticket.id,
      technicianId: payload.technician.id,
      supervisorId: payload.supervisor.id,
      endUserId: payload.endUser.id,
    });
  } catch (error) {
    logger.error("Failed to publish ticket.notification.resolved event", {
      error: error instanceof Error ? error.message : String(error),
      ticketId: payload.ticket.id,
    });
    // Don't throw - notification failure should not break the update flow
  }
}
