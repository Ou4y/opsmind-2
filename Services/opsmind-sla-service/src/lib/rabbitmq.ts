import amqplib, { Channel, ChannelModel } from "amqplib";
import { config } from "../config";
import { logger } from "../config/logger";

let connection: ChannelModel | null = null;
let channel: Channel | null = null;
let connecting = false;

export async function connectRabbitMQ(): Promise<void> {
  if (connection && channel) return;
  if (connecting) return;
  connecting = true;

  try {
    const conn = await amqplib.connect(config.rabbitmq.url);
    const ch = await conn.createChannel();
    await ch.assertExchange(config.rabbitmq.exchange, "topic", { durable: true });

    connection = conn;
    channel = ch;

    conn.on("close", () => {
      logger.warn("RabbitMQ connection closed");
      connection = null;
      channel = null;
      setTimeout(() => {
        void connectRabbitMQ();
      }, 5000);
    });

    conn.on("error", (error) => {
      logger.error("RabbitMQ connection error", {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    logger.info("RabbitMQ connected", {
      exchange: config.rabbitmq.exchange,
      notificationWarningKey: config.rabbitmq.notificationWarningKey,
      notificationBreachKey: config.rabbitmq.notificationBreachKey,
      workflowInterventionKey: config.rabbitmq.workflowInterventionKey || null,
    });
  } finally {
    connecting = false;
  }
}

export function getChannel(): Channel {
  if (!channel) throw new Error("RabbitMQ channel not initialized");
  return channel;
}

export async function closeRabbitMQ(): Promise<void> {
  if (channel) {
    await channel.close().catch(() => undefined);
  }
  if (connection) {
    await connection.close().catch(() => undefined);
  }
  connection = null;
  channel = null;
}
