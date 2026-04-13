import { app } from "./app";
import { config } from "./config";
import { logger } from "./config/logger";
import { startSlaMonitorJob } from "./jobs/sla-check.job";
import { prisma } from "./lib/prisma";
import { connectRabbitMQ } from "./lib/rabbitmq";
import { slaService } from "./modules/sla/sla.service";
import { registerGracefulShutdown } from "./utils/gracefulShutdown";

async function retry<T>(label: string, fn: () => Promise<T>, retries = 10, delayMs = 5000): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      logger.warn(`${label} attempt failed`, {
        attempt,
        retries,
        error: error instanceof Error ? error.message : String(error),
      });
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

async function bootstrap() {
  await retry("Database connection", async () => {
    await prisma.$connect();
    logger.info("Database connected");
  });

  await retry("Seed default SLA policies", async () => {
    await slaService.seedDefaultPolicies();
    logger.info("Default SLA policies seeded/ensured");
  });

  await retry("RabbitMQ connection", async () => {
    await connectRabbitMQ();
  });

  const server = app.listen(config.port, () => {
    logger.info(`SLA service listening on port ${config.port}`);
  });

  startSlaMonitorJob();
  registerGracefulShutdown(server);
}

bootstrap().catch((error) => {
  logger.error("Failed to start SLA service", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
