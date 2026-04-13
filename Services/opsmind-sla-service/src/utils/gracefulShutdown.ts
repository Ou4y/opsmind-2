import { logger } from "../config/logger";
import { stopSlaMonitorJob } from "../jobs/sla-check.job";
import { closeRabbitMQ } from "../lib/rabbitmq";
import { prisma } from "../lib/prisma";

export function registerGracefulShutdown(server: {
  close: (callback: (err?: Error) => void) => void;
}) {
  const shutdown = async (signal: string) => {
    logger.warn(`Received ${signal}, shutting down...`);
    stopSlaMonitorJob();
    server.close(async () => {
      await closeRabbitMQ();
      await prisma.$disconnect();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => { void shutdown("SIGINT"); });
  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
}
