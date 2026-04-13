import amqplib, { Channel, ChannelModel } from 'amqplib';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://opsmind:opsmind@localhost:5672';
const TICKET_EVENTS_EXCHANGE = 'ticket.events';
const TICKET_ASSIGNED_ROUTING_KEY = 'ticket.notification.assigned';

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

/**
 * Notification Event Payload for Ticket Assignment
 */
export interface TicketAssignedNotificationPayload {
  ticket: {
    id: string;
    title: string;
  };
  technician: {
    id: string;
    name: string;
    email: string;
  };
  supervisor: {
    id: string;
    name: string;
    email: string;
  };
}

/**
 * Notification Publisher Service
 *
 * Publishes events to RabbitMQ for the Notification Service to consume.
 * Uses the existing ticket.events exchange with topic routing.
 */
export class NotificationPublisher {
  /**
   * Initialize RabbitMQ connection and channel if not already connected.
   * Reuses the same exchange as the ticket event system.
   */
  private async ensureConnection(): Promise<void> {
    if (!connection || !channel) {
      try {
        connection = await amqplib.connect(RABBITMQ_URL);
        channel = await connection.createChannel();
        
        // Assert the exchange (idempotent - safe to call multiple times)
        await channel.assertExchange(TICKET_EVENTS_EXCHANGE, 'topic', { durable: true });
        
        console.log('[NotificationPublisher] Connected to RabbitMQ and exchange asserted.');
      } catch (error) {
        console.error('[NotificationPublisher] Failed to connect to RabbitMQ:', error);
        throw error;
      }
    }
  }

  /**
   * Publish a ticket assignment notification event
   *
   * @param payload - The notification payload containing ticket, technician, and supervisor info
   */
  async publishTicketAssigned(payload: TicketAssignedNotificationPayload): Promise<void> {
    try {
      await this.ensureConnection();

      if (!channel) {
        throw new Error('RabbitMQ channel not initialized');
      }

      const message = JSON.stringify(payload);
      const published = channel.publish(
        TICKET_EVENTS_EXCHANGE,
        TICKET_ASSIGNED_ROUTING_KEY,
        Buffer.from(message),
        { persistent: true },
      );

      if (published) {
        console.log(
          `[NotificationPublisher] ✔ Published ticket.notification.assigned | ` +
            `ticket=${payload.ticket.id} | technician=${payload.technician.id} | ` +
            `supervisor=${payload.supervisor.id}`,
        );
      } else {
        console.warn(
          `[NotificationPublisher] ⚠ Message buffered (channel not ready) | ticket=${payload.ticket.id}`,
        );
      }
    } catch (error) {
      console.error('[NotificationPublisher] Failed to publish ticket assignment notification:', error);
      // Don't throw - notification failure should not break the assignment flow
    }
  }

  /**
   * Close the RabbitMQ connection (for graceful shutdown)
   */
  async close(): Promise<void> {
    try {
      if (channel) {
        await channel.close();
        channel = null;
      }
      if (connection) {
        await connection.close();
        connection = null;
      }
      console.log('[NotificationPublisher] RabbitMQ connection closed.');
    } catch (error) {
      console.error('[NotificationPublisher] Error closing RabbitMQ connection:', error);
    }
  }
}
