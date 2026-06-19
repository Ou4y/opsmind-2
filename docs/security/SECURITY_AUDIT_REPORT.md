# OpsMind Security Audit Report

- Project: OpsMind ITSM Microservices Platform
- Audit date: 2026-05-24
- Auditor: Codex (static code/config review + verification runs)
- Scope: Full repository pre-test deployment audit
- Report state: Final post-remediation update

## 1) Executive Summary
The baseline audit found critical issues in access control, CORS, service trust boundaries, secret handling, and deployment misconfiguration. A remediation pass was completed without removing features or intentionally changing core business logic/API contracts.

High-impact outcomes:
- Closed critical authz gaps on Ticket, Workflow, SLA, Agentic AI, and Reporting services.
- Replaced permissive CORS with strict allowlist middleware across Node/FastAPI services.
- Removed runtime hardcoded secret fallbacks and added non-development weak-secret protections.
- Added sensitive endpoint rate limiting to Agentic AI plan/action paths.
- Centralized frontend service URL configuration and reduced unsafe direct service URL sprawl.
- Hardened compose/env credential handling to env-driven configuration.

Residual risk remains primarily in dependency vulnerabilities and deployment-time secret/governance controls.

## 2) Scanned Services and Files
### Backend services
- `Services/opsmind-authentication`
- `Services/opsmind-ticket-service`
- `Services/opsmind-workflow-service`
- `Services/opsmind-sla-service`
- `Services/opsmind-agentic-ai-service`
- `Services/opsmind-endpoint-agent`
- `Services/inventory-backend`
- `Services/inventory-ai-service`
- `Services/ai-service`
- `Services/notification-service`
- `Services/reportandanalysis-service`

### Frontend and infrastructure
- `opsmind_frontend/services/**/*`
- `opsmind_frontend/assets/js/**/*`
- `docker-compose.yml`
- `Services/**/docker-compose*.yml`
- `.env.example` and service `.env.example`
- `package.json` and lockfiles

## 3) Vulnerability Register (Final)

| ID | Severity | OWASP 2025 | OWASP 2021 | Location (file:function/module) | Risk | Recommended fix | Status |
|---|---|---|---|---|---|---|---|
| V-001 | HIGH | A05 Security Misconfiguration | Security Misconfiguration | `Services/*/src/app*`, `Services/*/src/config/cors*`, `Services/ai-service/src/main.py`, `Services/inventory-ai-service/src/main.py` | Wildcard/permissive CORS enables browser-origin abuse for authenticated APIs. | Strict env allowlist CORS; restricted methods/headers; conditional credentials. | **Fixed by Codex** |
| V-002 | CRITICAL | A01 Broken Access Control, A10 Unsafe Direct Object Consumption | Broken Access Control | `Services/opsmind-ticket-service/src/routes/ticket.routes.ts` | Missing/weak route guards allow unauthorized ticket access/mutation (BOLA/IDOR risk). | Enforce auth/internal guards + ownership/support checks per route. | **Fixed by Codex** |
| V-003 | HIGH | A01 Broken Access Control | Broken Access Control | `Services/opsmind-ticket-service/src/routes/ticket.routes.ts` (`resolveAuthenticatedUserId`, mutation handlers) | Trusting requester/actor input enables impersonation. | Derive actor identity from verified JWT/internal context only. | **Fixed by Codex** |
| V-004 | CRITICAL | A01 Broken Access Control | Broken Access Control | `Services/opsmind-workflow-service/src/routes/workflowRoutes.ts`, `src/middlewares/auth.ts` | Sensitive workflow endpoints accessible to non-support roles. | Add support/admin role middleware; internal token bypass only for service calls. | **Fixed by Codex** |
| V-005 | HIGH | A01 Broken Access Control | Broken Access Control | `Services/opsmind-workflow-service/src/controllers/ReassignmentController.ts` | Reassignment actor context type/identity handling could be bypassed/misapplied. | Enforce authenticated actor normalization and validation. | **Fixed by Codex** |
| V-006 | HIGH | A01 Broken Access Control | Broken Access Control | `Services/opsmind-sla-service/src/routes/sla.routes.ts` | SLA mutation and monitoring endpoints were under-protected. | `requireAuthOrInternal` and role checks on privileged paths. | **Fixed by Codex** |
| V-007 | CRITICAL | A01 Broken Access Control, A07 Identification and Authentication Failures | Identification and Authentication Failures | `Services/opsmind-agentic-ai-service/src/routes/remediation.routes.js`, `src/middleware/requireSupportRole.js` | Plan approval/rejection/execution actions could be abused without strict verified roles. | JWT auth + support-role checks from verified claims only. | **Fixed by Codex** |
| V-008 | HIGH | A01 Broken Access Control | Broken Access Control | `Services/opsmind-agentic-ai-service/src/routes/agentTask.routes.js` | Device-task actions weakly bounded by device headers alone. | JWT auth + owner/support checks + environment gate + shared secret for device mode. | **Fixed by Codex (manual ops controls remain)** |
| V-009 | HIGH | A01 Broken Access Control | Broken Access Control | `Services/reportandanalysis-service/src/routes/analytics.routes.js`, `src/middleware/auth.js` | Reporting endpoints exposed sensitive ticket/report operations. | Internal/JWT guard + support/self checks. | **Fixed by Codex** |
| V-010 | HIGH | A02 Cryptographic Failures, A07 Identification and Authentication Failures | Cryptographic Failures; Identification and Authentication Failures | `Services/*/src/middleware/*auth*` (ticket/workflow/sla/inventory/agentic/report/notification) | Missing/weak JWT secrets in non-dev permit token forgery or insecure operation. | Fail with 500 when JWT secret missing/weak in non-development. | **Fixed by Codex** |
| V-011 | HIGH | A02 Cryptographic Failures | Cryptographic Failures | `Services/notification-service/src/api/notification.api.js`, `Services/inventory-backend/src/services/NotificationService.ts`, `Services/opsmind-ticket-service/src/utils/notificationClient.ts` | Internal event/notification calls could use fallback secrets or insecure defaults. | Remove fallback secrets; require configured internal secret/token. | **Fixed by Codex** |
| V-012 | MEDIUM | A05 Security Misconfiguration | Security Misconfiguration | `docker-compose.yml`, `Services/**/docker-compose*.yml`, `.env.example`, `Services/**/.env.example` | Hardcoded/default credentials/tokens in compose can be reused accidentally in shared envs. | Move to env-driven credentials, remove weak defaults, document required vars. | **Fixed by Codex (manual secure value provisioning required)** |
| V-013 | MEDIUM | A05 Security Misconfiguration | Security Misconfiguration | `Services/*/src/app*`, `Services/ai-service/src/main.py`, `Services/inventory-ai-service/src/main.py` | Docs/debug exposure increases attack recon in shared environments. | Gate docs/debug by `ENABLE_API_DOCS` / `ENABLE_DEBUG_ROUTES` / env. | **Fixed by Codex** |
| V-014 | HIGH | A01 Broken Access Control | Broken Access Control | `Services/inventory-backend/src/server.ts` (`INVENTORY_ENFORCE_AUTH`) | Auth-enforcement default-off can silently expose inventory APIs. | Secure default on (`true`) with explicit env toggle. | **Fixed by Codex** |
| V-015 | MEDIUM | A05 Security Misconfiguration | Security Misconfiguration | `Services/inventory-backend/src/services/EventBus.ts`, `src/services/asset-ai-jobs/queue.ts`, `Services/notification-service/src/config/rabbitmq.js`, `Services/opsmind-workflow-service/src/jobs/*` | Hardcoded broker URI fallbacks create credential reuse and environment drift risk. | Require explicit env URI/user/pass. | **Fixed by Codex** |
| V-016 | MEDIUM | A04 Insecure Design | Insecure Design | `opsmind_frontend/services/apiConfig.js`, `opsmind_frontend/services/*.js`, selected `assets/js/*` | Scattered hardcoded service URLs bypass controlled browser API surface. | Centralize browser API base URLs and remove random direct service URL references. | **Fixed by Codex** |
| V-017 | MEDIUM | A09 Security Logging and Monitoring Failures | Security Logging and Monitoring Failures | `opsmind_frontend/services/*`, selected backend logs | Excessive debug logs can expose operational/user context. | Gate debug logs and avoid secrets/tokens in logs. | **Partially fixed by Codex** |
| V-018 | MEDIUM | A05 Security Misconfiguration | Security Misconfiguration | `Services/notification-service/src/index.js`, `Services/reportandanalysis-service/src/app.js`, `Services/inventory-backend/src/server.ts`, `Services/opsmind-agentic-ai-service/src/app.js` | Missing security middleware / safe error handling / body limits broadens abuse surface. | Add `helmet`, JSON limits, safer production 5xx responses. | **Fixed by Codex** |
| V-019 | MEDIUM | A06 Software Supply Chain Failures | Vulnerable and Outdated Components | `Services/**/package.json` + lockfiles | Known vulnerable dependency transitive graph remains. | Execute controlled package upgrade plan and retest. | **Open (manual remediation plan required)** |
| V-020 | HIGH | A04 Insecure Design, A08 Mishandling of Exceptional Conditions | Insecure Design; Security Logging and Monitoring Failures | `Services/opsmind-agentic-ai-service/src/routes/remediation.routes.js`, `src/routes/agentTask.routes.js`, `src/middleware/rateLimiters.js` | Sensitive AI plan/action endpoints can be brute-forced or abused without throttling. | Add route-level rate limits for planning, approval/queue, and agent device actions. | **Fixed by Codex** |
| V-021 | MEDIUM | A03 Injection, A04 Insecure Design | Injection | `opsmind_frontend/assets/js/**/*` (multiple `innerHTML`/`insertAdjacentHTML` render paths) | Dynamic HTML rendering can introduce DOM XSS if untrusted values are inserted without escaping. | Refactor high-risk paths to `textContent`/DOM APIs or enforce centralized escaping/sanitization. | **Open (manual remediation backlog)** |

## 4) Agentic AI Security Model Validation
### Verified
- AI remains planner-only for remediation proposals.
- Execution queue creation reads persisted `safe_plan` (not `raw_plan`).
- Queueing requires approved plan state.
- Queueing blocks plans with `MANUAL_REVIEW_REQUIRED`.
- Endpoint agent execution path remains allowlist-only (no arbitrary shell execution).
- Device task endpoints require JWT + owner/support checks and optional shared secret for non-dev enablement.

### Remaining manual controls
- Keep `ENABLE_AGENT_DEVICE_ENDPOINTS=false` by default in shared environments.
- If enabling outside local dev: set strong `ENDPOINT_AGENT_SHARED_SECRET`, rotate regularly, and monitor access.
- Implement production-grade enrollment/device secret lifecycle beyond MVP JWT/dev assumptions.

## 5) Verification Commands and Results
### CORS / wildcard checks
```bash
rg -n "origin\s*:\s*['\"]\*['\"]|Access-Control-Allow-Origin\s*[:=]\s*['\"]\*['\"]|allow_origins\s*=\s*\[\s*['\"]\*['\"]\s*\]|allow_methods\s*=\s*\[\s*['\"]\*['\"]\s*\]|allow_headers\s*=\s*\[\s*['\"]\*['\"]\s*\]|app\.use\(cors\(\)" Services opsmind_frontend docker-compose.yml -g '!**/node_modules/**'
```
Result: no matches.

### Hardcoded secret/default scans
```bash
rg -n "password123|opsmind:opsmind|root:root|mysql://opsmind:opsmind|postgresql://postgres:|amqp://opsmind:opsmind|JWT_SECRET:-|INTERNAL_API_TOKEN:-|NOTIFICATION_INTERNAL_SECRET:-|INTERNAL_SECRET:-" docker-compose.yml Services/**/docker-compose*.yml .env.example Services/**/.env.example -g '!**/node_modules/**'
```
Result: no matches.

### Build/test checks
- `Services/opsmind-workflow-service`: `npm run build` passed.
- `Services/opsmind-ticket-service`: `npm run build` passed.
- `Services/opsmind-authentication`: `npm run build` passed.
- `Services/inventory-backend`: `npm test -- --runInBand --passWithNoTests` passed (5 suites, 19 tests).
- `Services/opsmind-agentic-ai-service`: `node --check` on updated JS files passed.
- `Services/reportandanalysis-service`: `node --check` on updated JS files passed.

### Compose validation
```bash
docker compose -f docker-compose.yml config
```
Result: parses successfully; warns for unset required env vars (expected until deployment env is provided).

### Dependency audit snapshot (`npm audit --json`)
- `inventory-backend`: `critical=0 high=4 moderate=5 low=0 total=9`
- `notification-service`: `critical=0 high=2 moderate=3 low=0 total=5`
- `opsmind-agentic-ai-service`: `critical=0 high=0 moderate=0 low=0 total=0`
- `opsmind-authentication`: `critical=0 high=4 moderate=4 low=0 total=8`
- `opsmind-endpoint-agent`: `critical=0 high=0 moderate=0 low=0 total=0`
- `opsmind-sla-service`: `critical=0 high=0 moderate=3 low=0 total=3`
- `opsmind-ticket-service`: `critical=0 high=4 moderate=3 low=1 total=8`
- `opsmind-workflow-service`: `critical=1 high=4 moderate=5 low=0 total=10`
- `reportandanalysis-service`: `critical=0 high=5 moderate=7 low=0 total=12`

## 6) Files Added for Security
- `docs/security/TEST_ENV_SECURITY_CHECKLIST.md`
- `Services/opsmind-agentic-ai-service/src/config/cors.js`
- `Services/opsmind-agentic-ai-service/src/middleware/rateLimiters.js`
- `Services/notification-service/src/config/cors.js`
- `Services/inventory-backend/src/config/cors.ts`
- `Services/reportandanalysis-service/src/config/cors.js`
- `Services/reportandanalysis-service/src/middleware/auth.js`
- `opsmind_frontend/services/apiConfig.js`
- Additional strict CORS/auth helper files in ticket/workflow/SLA services.

## 7) Manual Deployment Actions (Required)
1. Set strong non-placeholder values for:
   - `JWT_SECRET`
   - `INTERNAL_API_TOKEN`
   - `INTERNAL_SECRET`
   - `NOTIFICATION_INTERNAL_SECRET`
   - `ENDPOINT_AGENT_SHARED_SECRET`
2. Set infrastructure credentials securely (do not reuse defaults):
   - `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD`, `AUTH_DB_PASSWORD`, `WORKFLOW_DB_PASSWORD`
   - `RABBITMQ_DEFAULT_PASS`
   - `POSTGRES_PASSWORD`
   - `MONGO_INITDB_ROOT_PASSWORD`
3. Keep `ENABLE_API_DOCS=false` and `ENABLE_DEBUG_ROUTES=false` in shared test/staging unless separately access-controlled.
4. Keep `ENABLE_AGENT_DEVICE_ENDPOINTS=false` by default outside local dev.
5. Triage and patch remaining dependency vulnerabilities (notably workflow/reporting/ticket/auth).
6. Perform secret rotation for any values previously used in local/shared environments.
7. Prioritize frontend DOM rendering hardening for `innerHTML`-heavy components handling user/AI/ticket data.

## 8) Final Risk Decisions Needed
- Accept temporary residual dependency vulnerabilities for test deployment vs. block until patched.
- Decide whether endpoint-agent externalized task endpoints should be enabled in test; if yes, define operational controls (IP scope, secret rotation cadence, audit ownership).
- Decide timeline for production-grade endpoint enrollment/device-secret architecture replacing MVP trust assumptions.

## 9) Fix Status Summary
- **Fixed by Codex**: V-001, V-002, V-003, V-004, V-005, V-006, V-007, V-009, V-010, V-011, V-013, V-014, V-015, V-016, V-018, V-020
- **Partially fixed by Codex**: V-008, V-017
- **Manual/open**: V-019, V-021, and deployment-value provisioning portions of V-012
