import { config } from "../../config";
import { logger } from "../../config/logger";
import { getChannel } from "../../lib/rabbitmq";

type Payload = Record<string, unknown>;

async function publish(routingKey: string | undefined, payload: Payload): Promise<void> {
  if (!routingKey) return;
  const channel = getChannel();
  channel.publish(
    config.rabbitmq.exchange,
    routingKey,
    Buffer.from(JSON.stringify(payload)),
    {
      contentType: "application/json",
      persistent: true,
    }
  );

  logger.info("RabbitMQ event published", { routingKey, payload });
}

export const slaPublisher = {
  publishStarted: (_payload: Payload) => Promise.resolve(),
  publishStatusUpdated: (_payload: Payload) => Promise.resolve(),
  publishPaused: (_payload: Payload) => Promise.resolve(),
  publishResumed: (_payload: Payload) => Promise.resolve(),
  publishResponseWarning: (payload: Payload) => publish(config.rabbitmq.notificationWarningKey, payload),
  publishResponseBreached: (payload: Payload) => publish(config.rabbitmq.notificationBreachKey, payload),
  publishResolutionWarning: (payload: Payload) => publish(config.rabbitmq.notificationWarningKey, payload),
  publishResolutionBreached: (payload: Payload) => publish(config.rabbitmq.notificationBreachKey, payload),
  publishWorkflowInterventionRequested: (payload: Payload) =>
    publish(config.rabbitmq.workflowInterventionKey || undefined, payload),
};
