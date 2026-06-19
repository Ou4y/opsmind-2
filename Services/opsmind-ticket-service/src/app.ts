import express from "express";
import cors from "cors";
import helmet from "helmet";
import ticketRouter from "./routes/ticket.routes";
import aiRouter from "./routes/ai.routes";
import { errorMiddleware } from "./middleware/error.middleware";
import { requestIdMiddleware } from "./middleware/requestId.middleware";
import { connectRabbitMQ, checkRabbitMQConnection } from "./lib/rabbitmq";
import { checkDatabaseConnection } from "./lib/prisma";
import { config } from "./config";
import { logger } from "./config/logger";
import { requesterAiOllamaService } from "./services/requesterAiOllama.service";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./docs/swagger";
import { buildStrictCorsOptions } from "./utils/cors";
//import { setupGracefulShutdown } from "./utils/gracefulShutdown";

export const app = express();
const enableApiDocs =
  process.env.ENABLE_API_DOCS === "true" ||
  (process.env.ENABLE_API_DOCS !== "false" && config.env === "development");

// Middleware
app.use(helmet());
app.use(cors(buildStrictCorsOptions(process.env)));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));
app.use(requestIdMiddleware);

/**
 * @openapi
 * /openapi.json:
 *   get:
 *     tags: [Docs]
 *     summary: Get OpenAPI specification (JSON)
 *     responses:
 *       200:
 *         description: OpenAPI specification
 */
if (enableApiDocs) {
  app.get("/openapi.json", (_req, res) => {
    res.json(swaggerSpec);
  });

  // Swagger UI
  app.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      explorer: true,
      customSiteTitle: "Ticket Service API Docs",
    })
  );
}

// Health check (basic)
/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Basic health check
 *     responses:
 *       200:
 *         description: Service is up
 */
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "ticket-service" });
});

// Health check (deep - checks dependencies)
/**
 * @openapi
 * /health/ready:
 *   get:
 *     tags: [Health]
 *     summary: Dependency readiness check
 *     responses:
 *       200:
 *         description: All dependencies are ready
 *       503:
 *         description: One or more dependencies are not ready
 */
app.get("/health/ready", async (_req, res) => {
  const dbOk = await checkDatabaseConnection();
  const rabbitOk = await checkRabbitMQConnection();

  const allOk = dbOk && rabbitOk;

  res.status(allOk ? 200 : 503).json({
    status: allOk ? "ready" : "degraded",
    service: "ticket-service",
    checks: {
      database: dbOk ? "ok" : "fail",
      rabbitmq: rabbitOk ? "ok" : "fail",
    },
  });
});

// Routes
app.use("/tickets", ticketRouter);
app.use("/ai", aiRouter);

// Error handler (must be last)
app.use(errorMiddleware);

async function bootstrap() {
  //setupGracefulShutdown();

  try {
    await connectRabbitMQ();
  } catch (error) {
    logger.warn("RabbitMQ not available at startup, will retry in background");
  }

  requesterAiOllamaService
    .warmup()
    .then(() => {
      logger.info("Requester AI model warm-up completed");
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : "unknown";
      logger.warn("Requester AI model warm-up skipped or failed", { error: message });
    });

  return app;
}

export default bootstrap;
