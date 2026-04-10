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
      created_at: ticket.created_at,
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
      resolution_summary: ticket.resolution_summary ?? null,
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
