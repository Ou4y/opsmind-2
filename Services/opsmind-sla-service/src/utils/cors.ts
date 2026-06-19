import { CorsOptions } from "cors";

const DEFAULT_ALLOWED_HEADERS = ["Content-Type", "Authorization", "X-Request-Id"];
const DEFAULT_METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"];

function parseCsv(rawValue: string | undefined): string[] {
  if (!rawValue) return [];
  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function resolveAllowedOrigins(env: NodeJS.ProcessEnv): string[] {
  const origins = [
    ...parseCsv(env.ALLOWED_ORIGINS),
    ...parseCsv(env.FRONTEND_ORIGIN),
    ...parseCsv(env.CORS_ORIGINS),
  ];
  const uniqueOrigins = Array.from(new Set(origins));
  if (uniqueOrigins.length > 0) return uniqueOrigins;

  if ((env.NODE_ENV || "development") === "development") {
    return ["http://localhost:8085", "http://localhost:5173", "http://127.0.0.1:5173"];
  }

  return [];
}

export function buildStrictCorsOptions(env: NodeJS.ProcessEnv): CorsOptions {
  const allowedOrigins = resolveAllowedOrigins(env);
  const allowCredentials =
    env.CORS_ALLOW_CREDENTIALS === "true" && allowedOrigins.length > 0;

  return {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      const error = new Error("CORS origin is not allowed") as Error & { statusCode?: number };
      error.statusCode = 403;
      callback(error);
    },
    methods: DEFAULT_METHODS,
    allowedHeaders: DEFAULT_ALLOWED_HEADERS,
    credentials: allowCredentials,
    optionsSuccessStatus: 204,
  };
}
