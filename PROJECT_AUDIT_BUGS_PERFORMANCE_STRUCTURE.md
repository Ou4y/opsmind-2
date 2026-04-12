# OpsMind Full Project Audit

Date: 2026-04-12
Scope: opsmind_frontend, opsmind-infrastructure, Services (auth, ticket, workflow, notification, ai)
Method: static code and configuration review, API contract cross-checking, workspace diagnostics

## 1) Executive Summary

This audit found multiple critical security and reliability issues that can lead to unauthorized data access, broken workflows, and avoidable runtime load.

Priority counts:
- Critical: 6
- High: 9
- Medium: 5

Top 5 immediate actions:
1. Rotate and remove exposed secrets (frontend Gemini key, static internal secrets, compose credentials).
2. Enforce authentication and authorization on ticket, workflow, and notification mutating endpoints.
3. Fix ticket/notification and frontend/notification API contract mismatches.
4. Replace permissive CORS policies with strict allowlists per environment.
5. Remove fake keep-alive interval and harden RabbitMQ reconnection/channel lifecycle.

## 2) Critical Findings (Fix First)

### C1. Client-exposed Gemini API key (credential leak)
- Risk: Key theft, quota abuse, billing impact.
- Evidence:
  - opsmind_frontend/assets/js/config.js:17
- Notes:
  - Any frontend key is publicly recoverable. Move all Gemini calls server-side.

### C2. Ticket service endpoints are unauthenticated
- Risk: Anyone who reaches the service can create, update, escalate, and soft-delete tickets.
- Evidence:
  - Services/opsmind-ticket-service/src/app.ts:90
  - Services/opsmind-ticket-service/src/routes/ticket.routes.ts:18
  - Services/opsmind-ticket-service/src/routes/ticket.routes.ts:59
  - Services/opsmind-ticket-service/src/routes/ticket.routes.ts:335
  - Services/opsmind-ticket-service/src/routes/ticket.routes.ts:402
  - Services/opsmind-ticket-service/src/routes/ticket.routes.ts:454

### C3. Workflow mutating endpoints only use optional auth
- Risk: Unauthorized ticket routing/claim/reassign/escalate.
- Evidence:
  - Services/opsmind-workflow-service/src/routes/workflowRoutes.ts:32
  - Services/opsmind-workflow-service/src/routes/workflowRoutes.ts:139
  - Services/opsmind-workflow-service/src/routes/workflowRoutes.ts:147
  - Services/opsmind-workflow-service/src/routes/workflowRoutes.ts:154
  - Services/opsmind-workflow-service/src/routes/workflowRoutes.ts:160

### C4. Workflow admin endpoints are effectively unauthenticated
- Risk: Unauthorized support-group and membership manipulation.
- Evidence:
  - Services/opsmind-workflow-service/src/app.ts:71
  - Services/opsmind-workflow-service/src/routes/adminRoutes.ts:42
  - Services/opsmind-workflow-service/src/routes/adminRoutes.ts:76
  - Services/opsmind-workflow-service/src/routes/adminRoutes.ts:109

### C5. Notification API allows unauthenticated event injection and user data fetch
- Risk: Forged events, spam notifications, unauthorized read/mark operations by user id.
- Evidence:
  - Services/notification-service/src/index.js:30
  - Services/notification-service/src/api/notification.api.js:13
  - Services/notification-service/src/api/notification.api.js:41
  - Services/notification-service/src/api/notification.api.js:59
  - Services/notification-service/src/api/notification.api.js:14

### C6. Ticket -> Notification contract is broken (events not sent as expected)
- Risk: Lost operational notifications, inconsistent incident workflow.
- Evidence:
  - Services/opsmind-ticket-service/src/utils/notificationClient.ts:4
  - Services/opsmind-ticket-service/src/utils/notificationClient.ts:36
  - Services/notification-service/src/api/notification.api.js:13
  - Services/notification-service/src/api/notification.api.js:14
  - Services/notification-service/src/api/notification.api.js:17
- Details:
  - Sender posts to /api/notifications with type/payload body.
  - Receiver expects POST /api/notifications/events with routingKey/payload.

## 3) High Findings

### H1. Insecure default secrets and credentials in service config
- Risk: predictable secrets in misconfigured environments.
- Evidence:
  - Services/opsmind-authentication/src/config/index.ts:18
  - Services/opsmind-authentication/src/config/index.ts:14
  - Services/opsmind-workflow-service/src/middlewares/auth.ts:14
  - Services/opsmind-workflow-service/src/config/database.ts:15
  - Services/opsmind-workflow-service/src/config/database.ts:16

### H2. Plaintext credentials in compose files
- Risk: accidental leakage, insecure local-to-prod drift.
- Evidence:
  - opsmind-infrastructure/docker-compose.yml:8
  - opsmind-infrastructure/docker-compose.yml:10
  - opsmind-infrastructure/docker-compose.yml:25
  - opsmind-infrastructure/docker-compose.yml:40
  - Services/opsmind-workflow-service/docker-compose.yml:13
  - Services/opsmind-ticket-service/docker-compose.yml:14

### H3. Permissive CORS policies
- Risk: cross-origin abuse and unwanted browser access.
- Evidence:
  - Services/ai-service/src/main.py:60
  - Services/ai-service/src/main.py:61
  - Services/notification-service/src/index.js:21
  - Services/opsmind-workflow-service/src/app.ts:24
  - Services/opsmind-authentication/src/server.ts:48

### H4. Notification reconnection and keep-alive anti-patterns (performance leak)
- Risk: orphaned channels, silent consume/publish failures, pointless event-loop wakeups.
- Evidence:
  - Services/notification-service/src/config/rabbitmq.js:22
  - Services/notification-service/src/config/rabbitmq.js:24
  - Services/notification-service/src/config/rabbitmq.js:12
  - Services/notification-service/src/index.js:39

### H5. Ticket service can write ticket then fail response when MQ is unavailable
- Risk: client retries can create duplicates while first write already succeeded.
- Evidence:
  - Services/opsmind-ticket-service/src/app.ts:99
  - Services/opsmind-ticket-service/src/app.ts:101
  - Services/opsmind-ticket-service/src/routes/ticket.routes.ts:68
  - Services/opsmind-ticket-service/src/routes/ticket.routes.ts:93
  - Services/opsmind-ticket-service/src/lib/rabbitmq.ts:57

### H6. Notification read APIs mismatch frontend/backend
- Risk: mark-as-read UI silently fails, growing unread state and repeated fetches.
- Evidence:
  - opsmind_frontend/services/notificationService.js:48
  - opsmind_frontend/services/notificationService.js:65
  - Services/notification-service/src/api/notification.api.js:41

### H7. Stored notification text is rendered unsanitized in HTML
- Risk: XSS from crafted notification messages.
- Evidence:
  - opsmind_frontend/assets/js/app.js:95
  - opsmind_frontend/assets/js/app.js:101

### H8. Frontend notification polling creates avoidable backend load
- Risk: sustained DB/network load from polling + full list retrieval.
- Evidence:
  - opsmind_frontend/assets/js/app.js:254
  - Services/notification-service/src/api/notification.api.js:59
  - Services/notification-service/src/api/notification.api.js:63
  - Services/notification-service/src/api/notification.api.js:64

### H9. Frontend user management expects endpoints not implemented by auth admin routes
- Risk: edit/details/stats operations can fail in production UI.
- Evidence:
  - opsmind_frontend/services/userService.js:98
  - opsmind_frontend/services/userService.js:193
  - opsmind_frontend/services/userService.js:262
  - Services/opsmind-authentication/src/modules/admin/admin.routes.ts:166
  - Services/opsmind-authentication/src/modules/admin/admin.routes.ts:381
  - Services/opsmind-authentication/src/modules/admin/admin.routes.ts:449

## 4) Medium Findings

### M1. Role-routing inconsistency can force admins into unauthorized redirect loop
- Evidence:
  - opsmind_frontend/assets/js/router.js:101
  - opsmind_frontend/assets/js/router.js:247
  - opsmind_frontend/assets/js/router.js:286

### M2. Unbounded pagination inputs on ticket listing endpoints
- Risk: expensive DB reads with large limit values.
- Evidence:
  - Services/opsmind-ticket-service/src/routes/ticket.routes.ts:186
  - Services/opsmind-ticket-service/src/routes/ticket.routes.ts:245
  - Services/opsmind-ticket-service/src/routes/ticket.routes.ts:187
  - Services/opsmind-ticket-service/src/routes/ticket.routes.ts:246

### M3. Domain delete returns success without checking affected rows
- Risk: false-positive success responses and poor API correctness.
- Evidence:
  - Services/opsmind-authentication/src/modules/admin/domain.controller.ts:36
  - Services/opsmind-authentication/src/modules/admin/domain.controller.ts:37
  - Services/opsmind-authentication/src/modules/admin/domain.repository.ts:19

### M4. API docs type drift for domain id (integer vs string UUID)
- Evidence:
  - Services/opsmind-authentication/src/modules/admin/admin.routes.ts:622
  - Services/opsmind-authentication/src/modules/admin/domain.repository.ts:4

### M5. TypeScript config deprecations (future build-break risk)
- Evidence:
  - Services/opsmind-workflow-service/tsconfig.json:16
  - Services/opsmind-authentication/tsconfig.json:16
  - Services/opsmind-authentication/tsconfig.json:17

## 5) Performance Leak Analysis

### Leak/Load Pattern A: Notification poll amplification
- Cause:
  - Frontend polls every 5s and fetches full notification history.
- Impact:
  - N users -> 12N requests/minute to a potentially unbounded query.
- Evidence:
  - opsmind_frontend/assets/js/app.js:254
  - Services/notification-service/src/api/notification.api.js:59
  - Services/notification-service/src/api/notification.api.js:64
- Fix:
  - Add pagination and cursor query params.
  - Poll only unread count, fetch full list on dropdown open.
  - Pause polling when tab is hidden via Page Visibility API.

### Leak/Load Pattern B: No-op keepalive interval
- Cause:
  - Empty setInterval loop in notification service.
- Impact:
  - Unnecessary event-loop wakeups and noisy process behavior.
- Evidence:
  - Services/notification-service/src/index.js:39
- Fix:
  - Remove the interval entirely.

### Leak/Load Pattern C: RabbitMQ reconnect lifecycle is not safe
- Cause:
  - Close callback reconnects without re-binding app consumer/publisher state.
- Impact:
  - Stale channels and silent message flow breaks.
- Evidence:
  - Services/notification-service/src/config/rabbitmq.js:22
  - Services/notification-service/src/config/rabbitmq.js:24
- Fix:
  - Centralize connection state with a singleton manager.
  - Recreate consumers and API channel references on reconnect.

### Leak/Load Pattern D: Per-publish assertExchange overhead in ticket service
- Cause:
  - Exchange assertion on each event publish.
- Impact:
  - Extra broker roundtrips on hot paths.
- Evidence:
  - Services/opsmind-ticket-service/src/events/publishers/ticket.publisher.ts:7
- Fix:
  - Assert exchanges once on startup after channel init.

## 6) Best-Practice File Structuring (Recommended)

## Target Monorepo Layout

opsmind/
- apps/
  - web/
    - public/
    - src/
      - app/
      - pages/
      - features/
        - auth/
        - tickets/
        - workflows/
        - notifications/
        - admin/
      - shared/
        - components/
        - services/
        - hooks/
        - utils/
      - config/
      - styles/
- services/
  - auth-service/
    - src/
      - modules/
      - middleware/
      - config/
      - database/
      - utils/
    - test/
  - ticket-service/
    - src/
      - modules/
      - routes/
      - events/
      - middleware/
      - config/
      - utils/
    - test/
  - workflow-service/
    - src/
      - modules/
      - routes/
      - jobs/
      - repositories/
      - middleware/
      - config/
    - test/
  - notification-service/
    - src/
      - api/
      - consumers/
      - services/
      - models/
      - config/
    - test/
  - ai-service/
    - src/
      - api/
      - ml/
      - preprocessing/
      - schemas/
      - config/
    - tests/
- packages/
  - contracts/
    - openapi/
    - events/
  - shared-types/
  - shared-logger/
  - shared-config/
- infrastructure/
  - docker/
    - compose/
    - env/
  - k8s/
  - terraform/
- docs/
  - architecture/
  - api/
  - runbooks/
  - adr/
- scripts/
  - ci/
  - dev/

## Structuring Rules

1. Keep runtime-generated outputs out of source paths.
- dist, coverage, logs, cache directories should never be committed.

2. Centralize contracts.
- Keep OpenAPI specs and event schemas in packages/contracts.
- Generate clients from contracts for frontend and services.

3. Separate domain and transport concerns.
- HTTP routes/controllers only orchestrate.
- Domain/application services hold business rules.

4. Co-locate tests with clear boundaries.
- Unit tests in each service module.
- Contract tests between services.
- Integration tests in service-level test directories.

5. Normalize configuration.
- Use typed config loaders with mandatory environment validation.
- Keep only .env.example in repo; inject real secrets at runtime.

6. Enforce shared lint/type/test standards at monorepo root.
- Single CI pipeline with per-package matrix and cache.

## 7) Remediation Roadmap

### Phase 0 (24-48 hours)
- Revoke and rotate exposed API keys and secrets.
- Remove hardcoded secrets from frontend and service code.
- Lock down ticket, workflow, and notification mutating endpoints with auth + role checks.

### Phase 1 (Week 1)
- Fix API contract mismatches:
  - ticket-service -> notification-service event endpoint/body.
  - frontend notification read endpoints.
  - frontend user management endpoints vs auth routes.
- Replace permissive CORS with explicit origins per environment.
- Add pagination/limits for notification and ticket list APIs.

### Phase 2 (Week 2)
- Implement robust RabbitMQ connection manager and reconnection flow.
- Remove no-op keepalive intervals and add graceful shutdown uniformly.
- Add idempotency keys for ticket creation and event publishing.

### Phase 3 (Weeks 3-4)
- Adopt the proposed monorepo structure incrementally.
- Introduce shared contracts and generated API clients.
- Add CI quality gates: lint, typecheck, unit tests, contract tests, security scanning.

## 8) Validation Gaps

Not executed in this audit:
- End-to-end runtime tests across all containers.
- Load testing to measure throughput and p95 latency.
- Dynamic security tests (auth bypass probing, fuzzing, token replay).

Recommended next step:
- Run an integrated staging test after applying Phase 0 and Phase 1 fixes, then re-audit.
