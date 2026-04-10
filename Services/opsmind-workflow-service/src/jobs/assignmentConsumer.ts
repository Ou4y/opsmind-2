import amqplib, { ChannelModel, Channel, ConsumeMessage } from 'amqplib';
import { AssignmentService } from '../services/AssignmentService';
import { TicketCreatedEvent } from '../interfaces/types';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://opsmind:opsmind@localhost:5672';
const TICKET_EVENTS_EXCHANGE = 'ticket.events';
const TICKET_CREATED_ROUTING_KEY = 'ticket.created';
const TICKET_CREATED_QUEUE = 'workflow.ticket.created';
const TICKET_ASSIGNED_QUEUE = process.env.RABBITMQ_TICKET_ASSIGNED_QUEUE || 'ticket.assigned';

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

const assignmentService = new AssignmentService();

export async function startAssignmentConsumer(): Promise<void> {
  try {
    const conn = await amqplib.connect(RABBITMQ_URL);
    const ch = await conn.createChannel();
    connection = conn;
    channel = ch;
    console.log('[AssignmentConsumer] Connected to RabbitMQ.');

    await ch.assertExchange(TICKET_EVENTS_EXCHANGE, 'topic', { durable: true });
    console.log(`[AssignmentConsumer] Exchange asserted: "${TICKET_EVENTS_EXCHANGE}" (topic, durable).`);

    await ch.assertQueue(TICKET_CREATED_QUEUE, { durable: true });
    console.log(`[AssignmentConsumer] Queue asserted: "${TICKET_CREATED_QUEUE}" (durable).`);

    await ch.bindQueue(TICKET_CREATED_QUEUE, TICKET_EVENTS_EXCHANGE, TICKET_CREATED_ROUTING_KEY);
    console.log(
      `[AssignmentConsumer] Queue "${TICKET_CREATED_QUEUE}" bound to exchange "${TICKET_EVENTS_EXCHANGE}" with routing key "${TICKET_CREATED_ROUTING_KEY}".`,
    );

    await ch.assertQueue(TICKET_ASSIGNED_QUEUE, { durable: true });

    console.log(`[AssignmentConsumer] Listening on queue "${TICKET_CREATED_QUEUE}"`);

    ch.consume(
      TICKET_CREATED_QUEUE,
      async (msg: ConsumeMessage | null) => {
        if (!msg) return;

        try {
          const raw = msg.content.toString();
          const event = JSON.parse(raw);
          console.log('[AssignmentConsumer] RAW message:', raw);
          console.log('[AssignmentConsumer] Parsed event:', event);

          const payload = event.data ?? event;
          console.log('[AssignmentConsumer] Extracted payload:', payload);

          const ticketId: string | undefined = payload.ticket_id ?? payload.id;
          const latitude: number | undefined = payload.latitude;
          const longitude: number | undefined = payload.longitude;
          const priority: string | undefined = payload.priority;

          if (!ticketId) {
            console.error('[AssignmentConsumer] Missing ticket_id in payload — discarding message.');
            ch.nack(msg, false, false);
            return;
          }
          if (latitude == null || longitude == null) {
            console.error(`[AssignmentConsumer] Missing lat/lon for ticket ${ticketId} — discarding message.`);
            ch.nack(msg, false, false);
            return;
          }

          const ticket: TicketCreatedEvent = { ticket_id: ticketId, latitude, longitude, priority: priority as TicketCreatedEvent['priority'] };
          console.log('[AssignmentConsumer] Final ticket object:', ticket);

          const assignment = await assignmentService.assignForTicket(ticket);

          if (assignment === null) {
            // Already assigned — idempotency guard fired; ack to drop the duplicate.
            ch.ack(msg);
            return;
          }

          ch.sendToQueue(
            TICKET_ASSIGNED_QUEUE,
            Buffer.from(JSON.stringify(assignment)),
            { persistent: true },
          );
          console.log(
            `[AssignmentConsumer] Assigned ticket ${assignment.ticket_id} -> technician ${assignment.technician_id} (score=${assignment.score.toFixed(
              2,
            )})`,
          );

          ch.ack(msg);
        } catch (error) {
          console.error('[AssignmentConsumer] Error handling message:', error);
          ch.nack(msg, false, false); // discard bad message
        }
      },
      { noAck: false },
    );
  } catch (error) {
    console.error('[AssignmentConsumer] Failed to start consumer:', error);
  }
}

export async function stopAssignmentConsumer(): Promise<void> {
  try {
    if (channel) await channel.close();
    if (connection) await connection.close(); // ChannelModel.close()
    console.log('[AssignmentConsumer] Closed RabbitMQ connection.');
  } catch (error) {
    console.error('[AssignmentConsumer] Error closing connection:', error);
  } finally {
    channel = null;
    connection = null;
  }
}
