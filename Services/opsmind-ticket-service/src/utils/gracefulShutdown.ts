/*import { prisma } from "../lib/prisma";
import { closeRabbitMQ } from "../lib/rabbitmq";
import { logger } from "../config/logger";

let isShuttingDown = false;

export async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  try {
    // Close RabbitMQ
    await closeRabbitMQ();
    logger.info("RabbitMQ connection closed");

    // Close Prisma
    await prisma.$disconnect();
    logger.info("Database connection closed");

    logger.info("Graceful shutdown complete");
    process.exit(0);
  } catch (error) {
    logger.error("Error during shutdown", { error });
    process.exit(1);
  }
}

export function setupGracefulShutdown(): void {
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  process.on("uncaughtException", (error) => {
    logger.error("Uncaught Exception", { error: error.message, stack: error.stack });
    gracefulShutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled Rejection", { reason });
    gracefulShutdown("unhandledRejection");
  });
}
*/