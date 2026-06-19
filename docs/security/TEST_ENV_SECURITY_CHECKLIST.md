# OpsMind Test Environment Security Checklist

Audit date: 2026-05-24

## 1) Required Environment Variables
Set these before deploying to test/staging. Do not use defaults from local development.

- `JWT_SECRET`: strong random secret, at least 32 characters.
- `INTERNAL_API_TOKEN`: strong random token for service-to-service auth (`x-internal-token`).
- `INTERNAL_SECRET`: strong random secret for notification/internal HTTP calls.
- `NOTIFICATION_INTERNAL_SECRET`: if used separately, also set to strong random secret.
- `ENDPOINT_AGENT_SHARED_SECRET`: required when enabling endpoint-agent task endpoints outside development.
- `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD`, `AUTH_DB_PASSWORD`, `WORKFLOW_DB_PASSWORD`: strong DB credentials.
- `RABBITMQ_DEFAULT_PASS`: strong broker password.
- `POSTGRES_PASSWORD`: strong Postgres password.
- `MONGO_INITDB_ROOT_PASSWORD`: strong Mongo root password (if Mongo auth is enabled for your deployment mode).
- `ALLOWED_ORIGINS`: comma-separated browser origins (no wildcard).
- `FRONTEND_ORIGIN`: single primary browser origin.
- `CORS_ALLOW_CREDENTIALS`: `false` unless absolutely needed.
- `ENABLE_API_DOCS`: `false` in test/prod-like shared environments unless access-controlled.
- `ENABLE_DEBUG_ROUTES`: `false` outside local development.
- `ENABLE_AGENT_DEVICE_ENDPOINTS`: `false` by default; enable only in controlled test scenarios.
- `JSON_BODY_LIMIT`: recommended `1mb` unless larger payloads are required.
- `LOW_STOCK_ADMIN_ID`, `LOW_STOCK_ADMIN_EMAIL`: required if low-stock notifications are expected.

## 2) Allowed Origins Policy
- Never set wildcard origins (`*`).
- Use only explicit origins, for example:
  - `ALLOWED_ORIGINS=http://localhost:8085,https://test.opsmind.example`
- Keep internal service URLs out of browser-origin allowlists.

## 3) JWT Secret Requirements
- Minimum 32 random characters.
- Must not be committed to git.
- Rotate if previously exposed.
- Use separate values for local/dev and shared test/staging.

## 4) Database/RabbitMQ Secret Requirements
- Do not keep hardcoded passwords in compose for shared test environments.
- Move credentials into external secret management (or `.env` not committed).
- Rotate any previously committed dev-style credentials before shared deployment.

## 5) Ports Exposure Review
Expose only what is required for browser/test access:
- Keep DB/RabbitMQ management ports bound to localhost or private network only.
- Do not expose internal-only service ports publicly if not needed.
- Confirm host firewall/security-group restrictions match intended exposure.

## 6) Docs/Debug Endpoint Policy
- `ENABLE_API_DOCS=false` unless explicitly needed.
- `ENABLE_DEBUG_ROUTES=false` in all non-local environments.
- If docs must be enabled, restrict access through gateway/IP allowlist/basic auth.

## 7) Rate Limiting Policy
- Keep auth rate limits enabled on login/signup/OTP routes.
- Add gateway-level rate limits for:
  - AI plan generation
  - AI queue/execute endpoints
  - Any write-heavy admin endpoints

## 8) Run npm Audit
Run for each Node service:

```bash
for d in Services/*; do
  if [ -f "$d/package.json" ]; then
    echo "== $d =="
    (cd "$d" && npm audit)
  fi
done
```

## 9) Verify CORS Hardening

```bash
rg -n "origin\s*:\s*['\"]\*['\"]|app\.use\(cors\(\)\)|allow_origins=\[\"\*\"\]|allow_methods=\[\"\*\"\]|allow_headers=\[\"\*\"\]|CORS_ORIGIN:\s*\"\*\"" Services docker-compose.yml -g '!**/node_modules/**'
```

Expected: no matches.

## 10) Verify Auth/Role Guards
- Confirm these routes reject unauthenticated access with `401`:
  - `/tickets/*`
  - `/workflow/*` protected endpoints
  - `/sla/*` operational/mutation endpoints
  - `/api/agentic-ai/*` remediation/queue/execution endpoints
  - `/analytics/*` reporting endpoints
- Confirm role restrictions with tokens for:
  - requester/student/doctor (must not mutate privileged resources)
  - technician/supervisor/admin (must only access allowed paths)

## 11) Verify Agentic AI Execution Safety
- Generate plan and confirm `rawPlan` is informational only.
- Confirm queueing uses approved `safePlan` only.
- Confirm queueing fails when plan contains `MANUAL_REVIEW_REQUIRED`.
- Confirm endpoint agent executes allowlisted handlers only.
- Confirm unsupported/download/install actions are skipped safely.
- Outside development, confirm endpoint-agent task endpoints remain disabled unless explicitly enabled and protected by `ENDPOINT_AGENT_SHARED_SECRET`.

## 12) Pre-Deployment Go/No-Go
- No wildcard CORS.
- No hardcoded secrets in runtime config.
- JWT/internal tokens configured securely.
- Critical authz routes return correct `401/403` behavior.
- Manual risk decisions accepted for any unresolved dependency vulnerabilities.
