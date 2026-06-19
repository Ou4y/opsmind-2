import { CorsOptions } from 'cors';

const DEFAULT_ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'X-Request-Id'];
const DEFAULT_ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

function parseCsv(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const origins = [
    ...parseCsv(env.ALLOWED_ORIGINS),
    ...parseCsv(env.FRONTEND_ORIGIN),
    ...parseCsv(env.CORS_ORIGINS),
  ];

  const unique = Array.from(new Set(origins));
  if (unique.length > 0) {
    return unique;
  }

  if ((env.NODE_ENV || 'development') === 'development') {
    return ['http://localhost:8085', 'http://localhost:5173', 'http://127.0.0.1:5173'];
  }

  return [];
}

export function buildStrictCorsOptions(env: NodeJS.ProcessEnv = process.env): CorsOptions {
  const allowedOrigins = resolveAllowedOrigins(env);
  const allowCredentials = env.CORS_ALLOW_CREDENTIALS === 'true' && allowedOrigins.length > 0;

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

      const error = new Error('CORS origin is not allowed') as Error & { statusCode?: number };
      error.statusCode = 403;
      callback(error);
    },
    methods: DEFAULT_ALLOWED_METHODS,
    allowedHeaders: DEFAULT_ALLOWED_HEADERS,
    credentials: allowCredentials,
    optionsSuccessStatus: 204,
  };
}
