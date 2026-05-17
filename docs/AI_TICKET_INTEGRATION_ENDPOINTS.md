# AI-Ticket Service Integration Analysis (OpsMind)

Audit date: 2026-05-15
Codebase scope:
- `Services/ai-service`
- `Services/opsmind-ticket-service`
- Workflow dependency checks in `Services/opsmind-workflow-service`

## 1. Executive Summary
Current state:
- AI Service exposes 12 business endpoints today, but only `/predict` and `/ai/recommendations` use the ML priority pipeline directly.
- Ticket Service does not call AI Service at all. Ticket creation hardcodes `priority = "MEDIUM"`.
- Ticket Service persists ticket first, publishes `ticket.created`, then does a best-effort HTTP call to Workflow `/workflow/route-ticket`.
- Workflow assignment logic uses ticket priority weighting (`CRITICAL/HIGH` prioritize distance more), so priority quality directly affects assignment behavior.

Integration readiness:
- Not integration-ready for production AI priority yet.
- Critical mismatch exists between AI training artifacts and AI inference preprocessing:
  - Runtime `/predict` builds 8 features from `src/preprocess.py`.
  - Current selected model (`HistGradientBoostingClassifier`) expects 44 enriched features from `src/train.py`.
  - This causes runtime prediction failures (500) with current artifacts.

Main missing pieces:
1. A dedicated endpoint contract for ticket priority decisioning (`rulePriority`, `aiPriority`, `finalPriority`, `confidence`, `decisionSource`, metadata).
2. Shared feature engineering between training and inference for the selected model.
3. Ticket Service AI client and synchronous call in create flow.
4. Fallback priority path when AI is unavailable.
5. Ticket DB fields for AI decision traceability.

Recommended integration approach:
- Option A (synchronous Ticket -> AI call before publish), with strict fallback to rule/static priority when AI fails.
- Keep ticket creation successful even if AI is down.
- Persist AI status/decision metadata for observability and demo explainability.

## 2. AI Service Endpoint Inventory

### 2.1 Summary Table

| Method | Endpoint | Purpose | Required Body | Response | Status | Ready for Ticket Integration? |
|---|---|---|---|---|---|---|
| GET | `/health` | Service/model readiness | None | `status`, `models_loaded`, `version` | 200 | Yes (health checks only) |
| POST | `/predict` | Predict priority + estimated resolution | `TicketInput` | `suggested_priority`, `priority_confidence`, `estimated_resolution_hours` | 200, 422, 503, 500 | No (feature mismatch + contract gap) |
| GET | `/ai/recommendations/count` | Placeholder recommendation counters | None | `count`, `pending` | 200 | Not relevant |
| GET | `/ai/recommendations/{ticket_id}` | Placeholder recommendations by ID | Path `ticket_id` | List of recommendation text items | 200, 422 | Not relevant |
| POST | `/ai/recommendations` | Rule/text recommendations from ticket payload | `TicketInput` | List of recommendation text items | 200, 422, 503, 500 | Partial (not priority contract) |
| GET | `/ai/insights` | Model/feature metadata | None | model metadata object | 200 | Useful for diagnostics only |
| POST | `/ai/suggest-category` | Keyword category suggestion | `description` | `category`, `confidence` | 200, 422 | Optional helper only |
| POST | `/ai/suggest-priority` | Keyword priority suggestion | `subject`, `description` | `suggested_priority`, `confidence`, `reasoning` | 200, 422 | Optional fallback helper |
| GET | `/ai/similar-tickets/{ticket_id}` | Placeholder similar-ticket endpoint | Path `ticket_id` | `tickets: []` | 200, 422 | Not relevant |
| GET | `/ai/activity-summary/{ticket_id}` | Placeholder summary | Path `ticket_id` | `summary` | 200, 422 | Not relevant |
| POST | `/ai/predict-resolution` | Resolution-time prediction | `TicketInput` | `estimated_resolution_hours` | 200, 422, 503, 500 | Not needed for priority flow |
| GET | `/ai/suggested-responses/{ticket_id}` | Placeholder canned replies | Path `ticket_id` | list of strings | 200, 422 | Not relevant |

Also auto-exposed by FastAPI:
- `GET /docs`
- `GET /redoc`
- `GET /openapi.json`

### 2.2 Shared AI Request Schema: `TicketInput`
Controller usage: `src/main.py` (`predict`, `get_recommendations_for_payload`, `predict_resolution`)

Required fields:
- `title` (string, min length 1)
- `description` (string, min length 1)
- `type_of_request` (string, required; enum type exists in codebase but is not enforced here)

Optional fields:
- `topic` (string)
- `source` (string)
- `product_group` or `productGroup` alias (string)
- `country` (string)
- `requester_id` (string)
- `latitude` (number, -90..90)
- `longitude` (number, -180..180)
- `support_level` (string, defaults to `L1`; not enforced enum)
- `created_at` or `createdAt` alias (datetime, defaults to now)
- `building` (string)
- `room` (string)

Validation behavior:
- FastAPI/Pydantic returns 422 for schema errors.
- No authentication/authorization is enforced.
- No required custom headers.

### 2.3 Detailed Endpoint Notes

#### `GET /health`
- Function: `health` in `src/main.py`.
- Purpose: service health and model readiness bit.
- Headers/auth: none.
- Path/query/body: none.
- Response 200:
```json
{
  "status": "ok | degraded",
  "models_loaded": true,
  "version": "1.0.0"
}
```
- Error behavior: no explicit errors.
- Ticket integration use: yes for readiness checks.

#### `POST /predict`
- Function: `predict`.
- Purpose: predict priority + estimated resolution time.
- Headers/auth: `Content-Type: application/json`; no auth.
- Body: `TicketInput`.
- Response 200:
```json
{
  "suggested_priority": "LOW | MEDIUM | HIGH | CRITICAL",
  "priority_confidence": 0.0,
  "estimated_resolution_hours": 0.0
}
```
- Status codes:
  - 200 success.
  - 422 request validation error.
  - 503 when models are not loaded.
  - 500 on prediction exceptions.
- Error behavior:
  - Wrapped exception text is returned in `detail` for 500.
- Usability for Ticket Service now:
  - Not reliable with current selected model artifacts.
  - Missing integration contract fields (`rulePriority`, `finalPriority`, `decisionSource`, explanations, model metadata block).

#### `GET /ai/recommendations/count`
- Function: `recommendations_count`.
- Purpose: placeholder counters.
- Response: `{ "count": 0, "pending": 0 }`.
- Status: 200 only in current implementation.
- Ticket integration: not required for priority flow.

#### `GET /ai/recommendations/{ticket_id}`
- Function: `get_recommendations`.
- Purpose: static text recommendations by ticket id.
- Path params: `ticket_id` string.
- Response: `[{"text":"..."}]`.
- Status: 200, plus 422 for path validation machinery.
- Ticket integration: optional; not used for priority decision.

#### `POST /ai/recommendations`
- Function: `get_recommendations_for_payload`.
- Purpose: recommendation text derived from predicted priority and request type.
- Body: `TicketInput`.
- Status:
  - 200 success.
  - 422 validation.
  - 503 models not loaded.
  - 500 if priority prediction fails.
- Ticket integration: optional advisory endpoint; not sufficient for authoritative priority.

#### `GET /ai/insights`
- Function: `insights`.
- Purpose: expose loaded model metadata and feature lists.
- Response includes:
  - `models_loaded`
  - `feature_names`
  - `transformed_feature_names`
  - `removed_feature_names`
  - `priority_labels`
  - selected model names
- Status: 200.
- Ticket integration: diagnostics only.

#### `POST /ai/suggest-category`
- Function: `suggest_category`.
- Purpose: keyword heuristic category suggestion.
- Body:
```json
{ "description": "..." }
```
- Response:
```json
{ "category": "NETWORK|ACCESS|EMAIL|GENERAL", "confidence": 0.0 }
```
- Status: 200, 422.
- Ticket integration: optional fallback/helper.

#### `POST /ai/suggest-priority`
- Function: `suggest_priority`.
- Purpose: keyword heuristic priority suggestion.
- Body:
```json
{ "subject": "...", "description": "..." }
```
- Response:
```json
{
  "suggested_priority": "LOW|MEDIUM|HIGH|CRITICAL",
  "confidence": 0.0,
  "reasoning": "..."
}
```
- Status: 200, 422.
- Ticket integration: optional fallback helper only; not model-backed decision layer.

#### `GET /ai/similar-tickets/{ticket_id}`
- Function: `similar_tickets`.
- Path params: `ticket_id`.
- Query params: `limit` integer optional (default 5).
- Response: `{ "tickets": [] }`.
- Status: 200, 422.
- Ticket integration: not relevant now.

#### `GET /ai/activity-summary/{ticket_id}`
- Function: `activity_summary`.
- Path params: `ticket_id`.
- Response: `{ "summary": "No activity summary available yet." }`.
- Status: 200, 422.
- Ticket integration: not relevant now.

#### `POST /ai/predict-resolution`
- Function: `predict_resolution`.
- Body: `TicketInput`.
- Response: `{ "estimated_resolution_hours": 0.0 }`.
- Status: 200, 422, 503, 500.
- Ticket integration: not needed for current priority-first routing objective.

#### `GET /ai/suggested-responses/{ticket_id}`
- Function: `suggested_responses`.
- Path params: `ticket_id`.
- Response: static list of 3 strings.
- Status: 200, 422.
- Ticket integration: not relevant now.

### 2.4 AI Model Loading, Artifact Paths, and Feature Engineering Findings

Model loading setup:
- Runtime startup loads models in FastAPI lifespan via `load_models()`.
- Expected model directory: `Services/ai-service/models`.
- Required files at runtime:
  - `priority_pipeline.pkl`
  - `est_pipeline.pkl`
  - `model_metadata.pkl`

Key finding 1: Training/runtime contract drift.
- Current training script writes:
  - `priority_model_pipeline.pkl`
  - compatibility copy `priority_pipeline.pkl`
  - `metrics.json`
- Current training script does not regenerate `est_pipeline.pkl` or `model_metadata.pkl`.
- Runtime still requires both, so those artifacts can be stale.

Key finding 2: Inference feature mismatch (critical).
- `/predict` uses `preprocess_for_inference` from `src/preprocess.py` and builds 8 features.
- Selected model in `metrics.json` (`HistGradientBoostingClassifier`, 84.955% accuracy) expects 44 enriched features from training logic in `src/train.py`.
- Result: priority prediction path fails at runtime with missing-column errors.

Key finding 3: Hybrid decision layer is not implemented in runtime.
- Runtime currently returns only `suggested_priority`, `priority_confidence`, and `estimated_resolution_hours`.
- No runtime outputs for `rulePriority`, `finalPriority`, `decisionSource`, `priorityScore`, or explanation list.

Conclusion for AI endpoint usability by Ticket Service:
- Existing `/predict` is not contract-compatible with required OpsMind hybrid priority integration and is currently unreliable with the selected model artifacts.
- A new endpoint and shared inference feature-engineering module are required.

## 3. Ticket Service Endpoint Inventory

### 3.1 Summary Table

| Method | Endpoint | Purpose | Required Body | Response | Current Priority Behavior | Integration Point |
|---|---|---|---|---|---|---|
| POST | `/tickets` | Create ticket | `title`, `description`, `type_of_request`, `requester_id`, `latitude`, `longitude` | Created ticket row | Hardcoded `MEDIUM` | Insert AI call before DB insert or before final persistence |
| PATCH | `/tickets/:id` | Update ticket lifecycle/assignment | Partial update schema | Updated ticket (or 502 sync-pending object) | No priority recalculation | Optional future re-score endpoint, not required for v1 |
| POST | `/tickets/:id/escalate` | Escalate support level | `from_level`, `to_level`, `reason` | Updated ticket | No priority change | Optional future hook for escalation-aware re-score |
| GET | `/tickets` | List tickets with filters | None | Enriched ticket list | Filters by `priority` query | No insertion point; read-only |
| GET | `/tickets/requester/:requester_id` | List requester's tickets | None | Enriched ticket list | Filters by `priority` query | No insertion point; read-only |
| GET | `/tickets/:id` | Read one ticket | None | Enriched single ticket | Returns persisted priority | No insertion point; read-only |

Additional existing ticket routes not primary for integration contract:
- `GET /tickets/assigned/:technicianId`
- `GET /tickets/:id/assignment-history`
- `GET /tickets/:id/status-history`
- `GET /tickets/:id/escalations`
- `DELETE /tickets/:id`

### 3.2 Shared Ticket Validation and Auth Findings
Validation middleware:
- Zod-based middleware validates request body only on `POST /tickets`, `PATCH /tickets/:id`, `POST /tickets/:id/escalate`.
- On validation error: returns 400 with `{ error: "Validation failed", details: [...] }`.

Auth/header requirements:
- No authentication middleware is applied on ticket routes.
- No required `Authorization` header in Ticket Service code.
- Optional `x-request-id` header is accepted for tracing; generated when missing.

Requester info extraction:
- `requester_id` is client-supplied in request body.
- No JWT-derived requester identity enforcement in this service today.

### 3.3 Detailed Endpoint Notes

#### `POST /tickets`
- Handler: inline async route handler in `src/routes/ticket.routes.ts`.
- Purpose: create new ticket, publish event, notify workflow.
- Headers/auth:
  - `Content-Type: application/json`.
  - No auth required.
- Path params: none.
- Query params: none.
- Body required fields:
  - `title` string min length 3.
  - `description` string min length 5.
  - `type_of_request` enum: `INCIDENT|SERVICE_REQUEST|MAINTENANCE`.
  - `requester_id` valid UUID.
  - `latitude` number range -90..90.
  - `longitude` number range -180..180.
- Body optional fields: none today.
- Server-assigned fields today:
  - `priority = "MEDIUM"`
  - `support_level = "L1"`
  - `assigned_to_level = "L1"`
  - `status = "OPEN"`
  - `escalation_count = 0`
- Response 201: raw Prisma `Ticket` row.
- Status codes in behavior:
  - 201 success.
  - 400 validation failed.
  - 500 internal errors (DB failure, publish failure, channel unavailable, etc.).
- Event publishing behavior:
  - Persists to DB first.
  - Calls `publishTicketCreated(ticket)` after save.
  - Then calls Workflow HTTP `/workflow/route-ticket` as best-effort safety net.
- Error cases:
  - RabbitMQ channel not initialized can throw and return 500 even after ticket row is already inserted.
  - Workflow callback failure does not rollback creation.
- Integration insertion point:
  - Best place is after validation and before final ticket write/event publish.

#### `PATCH /tickets/:id`
- Handler: inline async route handler.
- Purpose: update status/details/assignment and publish update events.
- Headers/auth: no auth required.
- Path params:
  - `id` ticket UUID string.
- Body optional fields:
  - `title`, `description`, `type_of_request`, `status`, `resolution_summary`, `assigned_to`, `assigned_to_level`, `assignment_method`, `assignment_reason`, `performed_by`, `performed_by_role`, `status_reason`.
- Validation rules:
  - Enums are validated for status/levels/method.
  - Lifecycle transitions only:
    - `OPEN -> IN_PROGRESS`
    - `IN_PROGRESS -> RESOLVED`
    - `RESOLVED -> CLOSED`
- Response:
  - 200 enriched ticket response (`assigned_to_name` included).
  - 400 invalid transition or validation error.
  - 404 ticket not found.
  - 502 when workflow sync fails after DB update.
  - 500 unexpected failures.
- Priority behavior:
  - Priority is not patchable via schema and no recomputation occurs.
- Event behavior:
  - Publishes `ticket.updated` before workflow sync call.
  - If sync fails, API returns 502 though update/event already happened.
- Integration point:
  - Optional future manual reclassify endpoint; not required for initial create-flow integration.

#### `POST /tickets/:id/escalate`
- Handler: inline async route handler.
- Purpose: add escalation record and move `assigned_to_level`.
- Headers/auth: no auth required.
- Path params: `id`.
- Body required:
  - `from_level`, `to_level` enum `L1..L4`.
  - `reason` non-empty string.
- Response:
  - 200 updated ticket.
  - 400 validation failed.
  - 404 ticket not found.
  - 502 workflow sync failed after update.
  - 500 unexpected failures.
- Priority behavior:
  - Does not adjust priority.
- Integration point:
  - Optional for future re-score/escalation intelligence.

#### `GET /tickets`
- Handler: inline async route handler.
- Purpose: list tickets.
- Headers/auth: none required.
- Query params:
  - `status`, `priority`, `requester_id`, `assigned_to`, `limit`, `offset`.
- Response 200: array of enriched tickets (`assigned_to_name`).
- Status codes:
  - 200 success.
  - 500 on Prisma or parsing/runtime errors.
- Priority behavior:
  - Filter only; no computation.
- Integration point: none.

#### `GET /tickets/requester/:requester_id`
- Handler: inline async route handler.
- Purpose: list requester tickets.
- Headers/auth: none required.
- Path params: `requester_id`.
- Query params: `status`, `priority`, `limit`, `offset`.
- Response 200: array of enriched tickets.
- Status codes: 200, 500.
- Priority behavior: filter only.
- Integration point: none.

#### `GET /tickets/:id`
- Handler: inline async route handler.
- Purpose: fetch one ticket.
- Headers/auth: none.
- Path params: `id`.
- Response:
  - 200 enriched ticket.
  - 404 ticket not found.
  - 500 unexpected errors.
- Priority behavior: returns stored priority.
- Integration point: none.

### 3.4 Ticket Creation Flow Order (Current)
Current create path order:
1. Validate incoming body.
2. Assign static system values (`priority=MEDIUM`, `support_level=L1`, etc.).
3. Persist ticket in MySQL.
4. Publish `ticket.created` event to RabbitMQ.
5. Fire-and-forget opened notification.
6. Call Workflow `/workflow/route-ticket` over HTTP as best-effort fallback.
7. Return 201 with ticket.

Workflow dependency on priority:
- Workflow consumes `ticket.created` and uses `priority` for assignment weighting.
- Workflow `/workflow/route-ticket` also accepts `priority` and uses the same weighting logic.

## 4. Required Ticket -> AI Payload
Recommended payload (v1 contract):

```json
{
  "ticketId": "uuid-or-temp-id",
  "requesterId": "user-id",
  "requesterRole": "STUDENT | DOCTOR | ADMIN | TECHNICIAN",
  "title": "string",
  "description": "string",
  "topic": "string",
  "productGroup": "NETWORK | HARDWARE | SOFTWARE | CLOUD | AUTHENTICATION",
  "category": "string",
  "building": "string",
  "room": "string",
  "createdAt": "ISO datetime",
  "typeOfRequest": "INCIDENT | SERVICE_REQUEST | MAINTENANCE",
  "latitude": 30.0,
  "longitude": 31.0
}
```

Field-by-field fit against current Ticket Service:

| Field | Current Ticket Service State | Recommendation |
|---|---|---|
| `ticketId` | Derivable (generated on DB insert today) | Generate UUID in service before AI call, or keep optional in request and required in response after save |
| `requesterId` | Exists (`requester_id`) | Required |
| `requesterRole` | Missing in current create payload/DB | Derivable from auth token or user service; keep optional in phase 1, required in phase 2 |
| `title` | Exists | Required |
| `description` | Exists | Required |
| `topic` | Missing | Optional at first; AI should derive from `typeOfRequest` + text |
| `productGroup` | Missing | Optional; AI should derive heuristically when absent |
| `category` | Missing | Optional or AI-derived |
| `building` | Missing (removed from schema) | Optional; do not block prediction |
| `room` | Missing (removed from schema) | Optional; do not block prediction |
| `createdAt` | Derivable | Required in AI contract (fallback to now if absent) |
| `typeOfRequest` | Exists (`type_of_request`) | Required |
| `latitude`/`longitude` | Exists | Optional for priority model; useful for future risk heuristics |

Important policy alignment:
- Do not use `resolution_time_hours` as prediction input.
- Do not use SLA fields as prediction inputs.
- Do not use `ticket_id` as ML feature.
- `requester_id` for traceability only.
- `requester_role` can be used when available.

## 5. Required AI -> Ticket Response
Recommended response contract:

```json
{
  "ticketId": "uuid",
  "rulePriority": "LOW | MEDIUM | HIGH | CRITICAL",
  "aiPriority": "LOW | MEDIUM | HIGH | CRITICAL",
  "finalPriority": "LOW | MEDIUM | HIGH | CRITICAL",
  "confidence": 0.87,
  "decisionSource": "AI_CONFIDENT | RULE_FALLBACK | RULE_AI_AGREEMENT | HUMAN_REVIEW_REQUIRED",
  "priorityScore": 10,
  "explanation": [
    "Core network service is affected.",
    "Failure-related keywords were detected.",
    "Issue was submitted during peak hours."
  ],
  "model": {
    "name": "HistGradientBoostingClassifier",
    "version": "priority_model_pipeline.pkl",
    "metrics": {
      "accuracy": 0.84955,
      "macroF1": 0.84574
    }
  }
}
```

Recommended persistence policy in Ticket Service:
- Persist for business/audit:
  - `finalPriority` -> `ticket.priority`
  - `rulePriority`
  - `aiPriority`
  - `confidence`
  - `decisionSource`
  - `ai_prediction_status`
  - `ai_predicted_at`
  - `ai_model_name`
  - `ai_model_version`
- Persist optional for demo explainability:
  - `explanation` (JSON/text)
  - `priorityScore`
- Keep only in logs/debug (not required per ticket row):
  - full model metrics block (can be static service metadata)

## 6. Recommended Integration Flow

Primary synchronous flow:
1. Frontend submits create request to Ticket Service.
2. Ticket Service validates input.
3. Ticket Service derives/prepares AI payload.
4. Ticket Service calls AI endpoint synchronously.
5. AI returns priority decision object.
6. Ticket Service persists ticket with `finalPriority` and AI metadata.
7. Ticket Service publishes `ticket.created` with final priority.
8. Workflow consumes event and/or route call assigns technician.

Fallback behavior when AI fails:
1. Ticket Service logs AI failure context.
2. Ticket Service computes fallback static/rule priority locally.
3. Ticket Service persists ticket with fallback priority.
4. Ticket Service sets `ai_prediction_status = FAILED`.
5. Ticket Service still emits `ticket.created`.
6. Ticket creation response remains successful (201).

Where to insert AI call in current code:
- Insert after request validation and before `prisma.ticket.create`.
- If keeping one-write path, generate ticket UUID in app code first, call AI, then insert with final priority.

## 7. Required Database Changes
Current ticket schema has no AI metadata columns.

Important schema consistency note:
- Prisma enum includes `CRITICAL`, but initial SQL migration created `priority ENUM('LOW','MEDIUM','HIGH')` only.
- Add/verify migration to ensure DB enum supports `CRITICAL` on all environments.

### 7.1 Recommended Minimal DB Change (graduation demo)
Add columns:
- `ai_prediction_status ENUM('SUCCESS','FAILED','SKIPPED') NOT NULL DEFAULT 'SKIPPED'`
- `ai_confidence DECIMAL(5,4) NULL`
- `ai_decision_source VARCHAR(64) NULL`
- `rule_priority ENUM('LOW','MEDIUM','HIGH','CRITICAL') NULL`
- `ai_priority ENUM('LOW','MEDIUM','HIGH','CRITICAL') NULL`

Why minimal:
- Enough to prove fallback reliability and explain priority decisions.

### 7.2 Recommended Complete DB Change (production/audit)
Add all minimal fields plus:
- `ai_explanation JSON NULL` or `TEXT NULL`
- `ai_model_name VARCHAR(128) NULL`
- `ai_model_version VARCHAR(128) NULL`
- `ai_predicted_at DATETIME(3) NULL`
- `ai_priority_score DECIMAL(6,2) NULL`

### 7.3 Field Necessity Classification

| Field | Demo | Production | Auditability |
|---|---|---|---|
| `ai_prediction_status` | Required | Required | Required |
| `rule_priority` | Recommended | Required | Required |
| `ai_priority` | Recommended | Required | Required |
| `ai_confidence` | Recommended | Required | Required |
| `ai_decision_source` | Required | Required | Required |
| `ai_explanation` | Recommended | Recommended | Strongly recommended |
| `ai_model_name` | Optional | Recommended | Recommended |
| `ai_model_version` | Optional | Recommended | Recommended |
| `ai_predicted_at` | Optional | Recommended | Recommended |
| `ai_priority_score` | Optional | Optional | Useful |

## 8. Required Code Changes

### 8.1 AI Service

| File | Current Responsibility | Required Change | Reason |
|---|---|---|---|
| `Services/ai-service/src/main.py` | FastAPI routes and prediction execution | Add `POST /api/ai/predict-priority` returning hybrid decision contract | Existing `/predict` response is insufficient for Ticket integration |
| `Services/ai-service/src/schemas.py` | API schemas | Add request/response schemas for priority decision endpoint | Enforce stable contract with required/optional fields |
| `Services/ai-service/src/preprocess.py` | Legacy 8-feature preprocessing | Replace or extend with feature builder matching selected 44-feature model, or load model matching 8-feature pipeline | Current model/inference mismatch causes runtime failure |
| `Services/ai-service/src/train.py` | Training pipeline with derived features + rule logic | Extract reusable feature/rule functions into shared module used by inference | Prevent training-inference drift |
| `Services/ai-service/src/models.py` | Artifact loading | Align required artifacts with new training output or retrain/export all required artifacts (`est_pipeline`, metadata) | Avoid stale artifact coupling and startup/runtime inconsistency |

### 8.2 Ticket Service

| File | Current Responsibility | Required Change | Reason |
|---|---|---|---|
| `Services/opsmind-ticket-service/src/config/index.ts` | Service config/env parsing | Add `aiService.url`, timeout, optional internal token | Needed for outbound AI call configuration |
| `Services/opsmind-ticket-service/src/utils/aiServiceClient.ts` (new) | N/A | Add resilient AI HTTP client with timeout and fallback signaling | Keep integration isolated/testable |
| `Services/opsmind-ticket-service/src/routes/ticket.routes.ts` | Ticket CRUD/create flow | Call AI before persist/publish; apply fallback; persist AI metadata; publish final priority | Core integration requirement |
| `Services/opsmind-ticket-service/src/validation/ticket.schema.ts` | Input validation | Optionally add new create fields (`topic`, `product_group`, etc.) as optional | Better payload quality to AI without breaking current clients |
| `Services/opsmind-ticket-service/src/events/publishers/ticket.publisher.ts` | Event payload publication | Ensure `ticket.created` includes final priority and optionally decision metadata | Workflow and downstream consumers need authoritative final priority |
| `Services/opsmind-ticket-service/prisma/schema.prisma` | Ticket DB model | Add AI metadata fields and ensure priority enum includes CRITICAL in DB | Persistence and traceability |
| `Services/opsmind-ticket-service/prisma/migrations/*` | DB migrations | Add migration for AI fields + enum alignment | Deployable schema evolution |
| `Services/opsmind-ticket-service/docker-compose.yml` and root `docker-compose.yml` | Runtime env wiring | Add `AI_SERVICE_URL` and related env vars | Service-to-service connectivity |

## 9. Recommended Endpoint Contract

Proposed authoritative endpoint:
- `POST /api/ai/predict-priority`

Request JSON schema:
- Required:
  - `title` string (min 3)
  - `description` string (min 5)
  - `typeOfRequest` enum `INCIDENT|SERVICE_REQUEST|MAINTENANCE`
  - `requesterId` string
  - `createdAt` ISO datetime
- Optional:
  - `ticketId`
  - `requesterRole`
  - `topic`
  - `productGroup`
  - `category`
  - `building`
  - `room`
  - `latitude`
  - `longitude`

Success response example (200):
```json
{
  "ticketId": "c7ee4a17-58f2-4e59-9ff6-47d34f3bc2a3",
  "rulePriority": "HIGH",
  "aiPriority": "CRITICAL",
  "finalPriority": "HIGH",
  "confidence": 0.71,
  "decisionSource": "RULE_FALLBACK",
  "priorityScore": 10,
  "explanation": [
    "Core service impact detected",
    "Urgency/failure keywords found"
  ],
  "model": {
    "name": "HistGradientBoostingClassifier",
    "version": "priority_model_pipeline.pkl",
    "metrics": {
      "accuracy": 0.84955,
      "macroF1": 0.84574
    }
  }
}
```

Failure response example (503):
```json
{
  "error": "MODEL_UNAVAILABLE",
  "message": "Priority model artifacts are not loaded",
  "ticketId": "c7ee4a17-58f2-4e59-9ff6-47d34f3bc2a3"
}
```

Recommended error codes:
- 200 success.
- 400 validation error (bad domain values/format).
- 422 cannot derive enough features from payload.
- 500 inference/pipeline runtime failure.
- 503 model unavailable/not loaded.

Timeout/retry/circuit recommendations:
- Ticket -> AI timeout: 2 to 5 seconds.
- Retry policy during create flow: zero retries or one short retry max.
- Circuit breaker: open quickly on repeated failures and force rule fallback until recovery.

## 10. Best Integration Recommendation
Chosen option: Option A (synchronous Ticket -> AI call before event publishing), with fallback.

Why this is best for OpsMind:
- Workflow routing uses ticket priority immediately.
- Final priority should be present before `ticket.created` is emitted.
- Keeps architecture easy to explain and demo.
- Fallback prevents AI downtime from blocking ticket creation.

Tradeoff:
- Slightly increases ticket create latency.
- This is acceptable with strict timeout and fallback.

## 11. Implementation Plan

Phase 1: Endpoint inventory and contract freeze.
- Finalize `POST /api/ai/predict-priority` request/response schema.
- Align enum sets and decision-source values across services.

Phase 2: AI Service priority endpoint.
- Implement new endpoint.
- Implement shared feature derivation that matches trained model columns.
- Add rule engine + decision layer output.

Phase 3: Ticket Service AI client.
- Add AI service config and client with timeout and fallback mapping.

Phase 4: Ticket create flow integration.
- Insert AI call before persistence/publish.
- Apply fallback behavior on AI error/timeout.

Phase 5: DB migration for AI metadata.
- Add minimal fields first.
- Ensure priority enum supports `CRITICAL` in DB.

Phase 6: Event payload alignment.
- Confirm `ticket.created` includes final priority.
- Optionally include decision metadata for downstream observability.

Phase 7: End-to-end verification.
- Validate online/offline AI behavior and workflow routing outputs.

## 12. Testing Plan

AI Service tests:
1. Valid ticket payload returns priority contract with all required fields.
2. Missing title/description returns validation error.
3. Missing model files returns 503.
4. Feature derivation output columns match model expected features.
5. Decision layer rules produce expected `decisionSource` for confidence/priority disagreement cases.

Ticket Service tests:
1. Create ticket with AI online returns 201 and stores final priority + AI metadata.
2. Create ticket with AI offline/timeout still returns 201 with fallback priority and `ai_prediction_status=FAILED`.
3. `ticket.created` event carries final persisted priority.
4. Workflow receives/uses final priority.
5. Invalid create payload still returns 400.
6. AI timeout does not break ticket creation.

End-to-end flow test:
1. Start MySQL, RabbitMQ, AI Service, Ticket Service, Workflow Service.
2. Submit sample ticket via `POST /tickets`.
3. Confirm Ticket DB row has final priority and AI metadata.
4. Confirm RabbitMQ `ticket.created` event contains final priority.
5. Confirm Workflow assignment decision uses the same final priority.

## 13. Model Result Usage and Decision Layer Recommendation
Selected model (from `models/metrics.json`):
- Model: `HistGradientBoostingClassifier`
- Accuracy: `84.95%`
- Macro F1: `84.57%`
- Weighted F1: `84.89%`
- Model file: `models/priority_model_pipeline.pkl`

Interpretation:
- This is strong for the controlled enriched/generated dataset.
- Real production performance must be validated later on real historical OpsMind tickets.
- For now, use as AI-assisted recommendation, not irreversible autonomous logic.

Recommended decision logic:
1. If AI and rule agree:
   - `finalPriority = aiPriority`
   - `decisionSource = RULE_AI_AGREEMENT`
2. If AI confidence `>= 0.75` and differs by one level only:
   - `finalPriority = aiPriority`
   - `decisionSource = AI_CONFIDENT`
3. If AI confidence `< 0.75`:
   - `finalPriority = rulePriority`
   - `decisionSource = RULE_FALLBACK`
4. If AI and rule differ by two or more levels:
   - `finalPriority = rulePriority`
   - `decisionSource = HUMAN_REVIEW_REQUIRED` (or `RULE_FALLBACK` for strict automation)

## Implementation Readiness Checklist
- [ ] AI prediction endpoint exists
- [ ] AI prediction endpoint loads trained model
- [ ] AI endpoint derives same features as training
- [ ] Ticket Service has AI client
- [ ] Ticket create flow calls AI before event publishing
- [ ] Fallback priority logic exists
- [ ] Ticket DB stores AI metadata
- [ ] ticket.created event includes final priority
- [ ] End-to-end test completed

Current assessed state from this audit:
- Existing `/predict` endpoint exists but does not yet satisfy the required hybrid contract.
- Current runtime feature derivation does not match the selected model artifacts.
