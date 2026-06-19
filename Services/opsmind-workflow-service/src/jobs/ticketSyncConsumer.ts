import amqplib, { ChannelModel, Channel, ConsumeMessage } from 'amqplib';
import { TicketRepository } from '../repositories/TicketRepository';
import { getTicket } from '../config/externalServices';

const RABBITMQ_URL = String(process.env.RABBITMQ_URL || '').trim();
const TICKET_EVENTS_EXCHANGE = 'ticket.events';
const TICKET_UPDATED_ROUTING_KEY = 'ticket.updated';
const TICKET_CREATED_ROUTING_KEY = 'ticket.created';
const TICKET_SYNC_QUEUE = process.env.RABBITMQ_TICKET_SYNC_QUEUE || 'workflow.ticket.sync';

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

const ticketRepo = new TicketRepository();

async function resolveTicketSnapshot(payload: any, ticketId: string) {
  try {
    const ticket = await getTicket(ticketId);
    return { ...ticket, id: String(ticket.id || ticketId) };
  } catch (error) {
    console.warn(`[TicketSyncConsumer] Falling back to event payload for ticket ${ticketId}:`, error);
    const fallback = { ...payload, id: String(payload.id || ticketId) };
    if ('ticket_id' in fallback) {
      delete (fallback as any).ticket_id;
    }
    return fallback;
  }
}

export async function startTicketSyncConsumer(): Promise<void> {
  try {
    if (!RABBITMQ_URL) {
      throw new Error('RABBITMQ_URL is required');
    }

    const conn = await amqplib.connect(RABBITMQ_URL);
    const ch = await conn.createChannel();
    connection = conn;
    channel = ch;

    await ch.assertExchange(TICKET_EVENTS_EXCHANGE, 'topic', { durable: true });
    await ch.assertQueue(TICKET_SYNC_QUEUE, { durable: true });
    await ch.bindQueue(TICKET_SYNC_QUEUE, TICKET_EVENTS_EXCHANGE, TICKET_UPDATED_ROUTING_KEY);
    await ch.bindQueue(TICKET_SYNC_QUEUE, TICKET_EVENTS_EXCHANGE, TICKET_CREATED_ROUTING_KEY);

    console.log(`[TicketSyncConsumer] Listening on queue "${TICKET_SYNC_QUEUE}"`);

    ch.consume(
      TICKET_SYNC_QUEUE,
      async (msg: ConsumeMessage | null) => {
        if (!msg) return;

        try {
          const raw = msg.content.toString();
          const event = JSON.parse(raw);
          const payload = event?.data ?? event;
          const ticketId: string | undefined = payload.ticket_id ?? payload.id;

          if (!ticketId) {
            console.error('[TicketSyncConsumer] Missing ticket_id in payload — discarding message.');
            ch.nack(msg, false, false);
            return;
          }

          const snapshot = await resolveTicketSnapshot(payload, ticketId);
          await ticketRepo.syncTicketFromSource(snapshot);

          ch.ack(msg);
        } catch (error) {
          console.error('[TicketSyncConsumer] Error handling message:', error);
          ch.nack(msg, false, false);
        }
      },
      { noAck: false },
    );
  } catch (error) {
    console.error('[TicketSyncConsumer] Failed to start consumer:', error);
  }
}

export async function stopTicketSyncConsumer(): Promise<void> {
  try {
    if (channel) await channel.close();
    if (connection) await connection.close();
    console.log('[TicketSyncConsumer] Closed RabbitMQ connection.');
  } catch (error) {
    console.error('[TicketSyncConsumer] Error closing connection:', error);
  } finally {
    channel = null;
    connection = null;
  }
}
