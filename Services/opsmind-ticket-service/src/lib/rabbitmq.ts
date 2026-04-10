import amqplib, { Channel, ChannelModel } from "amqplib";
import { config } from "../config";
import { logger } from "../config/logger";

let connection: ChannelModel | null = null;
let channel: Channel | null = null;
let isConnecting = false;

const EXCHANGE_NAME = "ticket.events";

export async function connectRabbitMQ(): Promise<void> {
  if (connection && channel) {
    return;
  }

  if (isConnecting) {
    return;
  }

  isConnecting = true;

  try {
    const conn = await amqplib.connect(config.rabbitmq.url);
    connection = conn;
    const ch = await conn.createChannel();
    channel = ch;

    // Pre-assert exchange once on startup
    await ch.assertExchange(EXCHANGE_NAME, "topic", { durable: true });

    // Handle connection close
    conn.on("close", () => {
      logger.warn("RabbitMQ connection closed, will reconnect...");
      connection = null;
      channel = null;
      setTimeout(() => connectRabbitMQ(), 5000);
    });

    conn.on("error", (err) => {
      logger.error("RabbitMQ connection error", { error: err.message });
    });

    logger.info("RabbitMQ connected");
  } catch (error) {
    logger.error("Failed to connect to RabbitMQ", { error });
    isConnecting = false;
    // Retry after delay
    setTimeout(() => connectRabbitMQ(), 5000);
    throw error;
  } finally {
    isConnecting = false;
  }
}

export function getChannel(): Channel {
  if (!channel) {
    throw new Error("RabbitMQ channel not initialized");
  }
  return channel;
}

export async function closeRabbitMQ(): Promise<void> {
  try {
    if (channel) {
      await channel.close();
      channel = null;
    }
    if (connection) {
      await connection.close();
      connection = null;
    }
  } catch (error) {
    logger.error("Error closing RabbitMQ", { error });
  }
}

export async function checkRabbitMQConnection(): Promise<boolean> {
  return connection !== null && channel !== null;
}

export { EXCHANGE_NAME };