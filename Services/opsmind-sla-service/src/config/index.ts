import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export const config = {
  env: process.env.NODE_ENV ?? "development",
  port: optionalNumber("PORT", 3004),
  database: {
    url: required("DATABASE_URL"),
  },
  rabbitmq: {
    url: required("RABBITMQ_URL"),
    exchange: process.env.RABBITMQ_SLA_EXCHANGE ?? "opsmind.sla.exchange",
    notificationWarningKey:
      process.env.RABBITMQ_NOTIFICATION_WARNING_KEY ?? "ticket.notification.slaWarning",
    notificationBreachKey:
      process.env.RABBITMQ_NOTIFICATION_BREACH_KEY ?? "ticket.notification.slaBreached",
    workflowInterventionKey:
      process.env.RABBITMQ_WORKFLOW_INTERVENTION_KEY ?? "",
  },
  cors: {
    origins: (process.env.CORS_ORIGINS ?? "http://localhost:8085,http://localhost:3000")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  },
  sla: {
    checkIntervalMs: optionalNumber("SLA_CHECK_INTERVAL_MS", 60000),
    autoRequestWorkflowOnResponseBreach: optionalBoolean(
      "SLA_AUTO_REQUEST_WORKFLOW_ON_RESPONSE_BREACH",
      false
    ),
    autoRequestWorkflowOnResolutionBreach: optionalBoolean(
      "SLA_AUTO_REQUEST_WORKFLOW_ON_RESOLUTION_BREACH",
      false
    ),
  },
};
