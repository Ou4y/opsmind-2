const DEFAULT_ALLOWED_HEADERS = ["Content-Type", "Authorization", "X-Request-Id", "X-Device-Id", "X-Device-Token"];
const DEFAULT_ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveAllowedOrigins(env = process.env) {
  const origins = [
    ...parseCsv(env.ALLOWED_ORIGINS),
    ...parseCsv(env.FRONTEND_ORIGIN),
    ...parseCsv(env.CORS_ORIGINS),
  ];

  const unique = Array.from(new Set(origins));
  if (unique.length > 0) {
    return unique;
  }

  if (String(env.NODE_ENV || "development") === "development") {
    return ["http://localhost:8085", "http://localhost:5173", "http://127.0.0.1:5173"];
  }

  return [];
}

function buildStrictCorsOptions(env = process.env) {
  const allowedOrigins = resolveAllowedOrigins(env);
  const allowCredentials = String(env.CORS_ALLOW_CREDENTIALS || "false") === "true" && allowedOrigins.length > 0;

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

      const error = new Error("CORS origin is not allowed");
      error.statusCode = 403;
      callback(error);
    },
    methods: DEFAULT_ALLOWED_METHODS,
    allowedHeaders: DEFAULT_ALLOWED_HEADERS,
    credentials: allowCredentials,
    optionsSuccessStatus: 204,
  };
}

module.exports = {
  buildStrictCorsOptions,
  resolveAllowedOrigins,
};
