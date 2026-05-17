import "dotenv/config";

export const config = {
  env: process.env.NODE_ENV ?? "development",
  port: parseInt(process.env.PORT ?? "3000", 10),

  database: {
    url: process.env.DATABASE_URL!,
  },

  rabbitmq: {
    url: process.env.RABBITMQ_URL ?? "amqp://opsmind:opsmind@rabbitmq:5672",
  },

  userService: {
    url: process.env.USER_SERVICE_URL ?? "http://opsmind-user:3002",
  },

  slaService: {
    url: process.env.SLA_SERVICE_URL ?? "http://opsmind-sla-service:3004",
  },

  workflowService: {
    url: process.env.WORKFLOW_SERVICE_URL ?? "http://workflow-service:3003",
    internalApiToken: process.env.INTERNAL_API_TOKEN ?? "",
  },

  aiService: {
    url: process.env.AI_SERVICE_URL ?? "http://localhost:8000",
    timeoutMs: parseInt(process.env.AI_SERVICE_TIMEOUT_MS ?? "3000", 10),
  },

  cors: {
    origins: (process.env.CORS_ORIGINS ?? "http://localhost:5173")
      .split(",")
      .map((o) => o.trim()),
  },

  isDev: process.env.NODE_ENV === "development",
  isProd: process.env.NODE_ENV === "production",
} as const;
