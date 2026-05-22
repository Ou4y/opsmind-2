# OpsMind Agentic AI Service

## Purpose

`opsmind-agentic-ai-service` is the Agentic AI planner and orchestration-backend service for OpsMind.

It currently:

- Generates `rawPlan` + `safePlan` from ticket context (Ollama/Gemma)
- Persists remediation plans in MySQL
- Supports approve/reject plan workflow
- Supports mock execution simulation (database-only)
- Persists endpoint device registry linked to authenticated users
- Provides an Agent Task Queue foundation for future Endpoint Agent polling

## Current Scope (Phase 6)

Implemented:

- Plan generation and policy enforcement
- Plan persistence and retrieval
- Plan approve/reject workflow
- Mock execution simulation (no real machine actions)
- Endpoint device registration/list/heartbeat/enable/disable
- Agent task queue creation from approved plans
- Agent task lifecycle updates (claim/start/step-result/complete)

Still **not** implemented:

- Real endpoint command execution
- Desktop/background Endpoint Agent app
- Real software download/install execution
- Ticket Service status update automation
- Workflow Service update automation
- RabbitMQ execution publishing

## Safety

This service does not run shell/OS commands.

- No `child_process`
- No PowerShell/Bash/CMD execution
- No real device control
- No real download/install in this phase

Agent task queue endpoints only persist and transition task state in DB.

## Environment Variables

Use `.env.example`:

```env
PORT=4010
SERVICE_NAME=opsmind-agentic-ai-service
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gemma3:4b
NODE_ENV=development
DATABASE_URL=mysql://opsmind:opsmind@localhost:3307/agentic_ai_db
JWT_SECRET=opsmind-local-jwt
```

Inside Docker (main compose):

`DATABASE_URL=mysql://opsmind:opsmind@mysql:3306/agentic_ai_db`

## Database Setup

For existing MySQL volumes, create DB manually:

```sql
CREATE DATABASE IF NOT EXISTS agentic_ai_db;
GRANT ALL PRIVILEGES ON agentic_ai_db.* TO 'opsmind'@'%';
FLUSH PRIVILEGES;
```

## Prisma Commands

Run in `Services/opsmind-agentic-ai-service`:

```bash
npm run db:generate
npm run db:migrate
npm run db:migrate:deploy
npm run db:studio
```

For Docker deployments, run migrations explicitly:

```bash
docker compose exec opsmind-agentic-ai-service npm run db:migrate:deploy
```

## Local Run

```bash
cd Services/opsmind-agentic-ai-service
cp .env.example .env
npm install
npm run db:generate
npm run db:migrate
npm run dev
```

## Ollama Setup

```bash
ollama pull gemma3:4b
ollama serve
```

## Endpoints

### Health

- `GET /health`
- `GET /health/ready`

### Plan Generation

- `POST /api/agentic-ai/remediation-plan/test`
- `POST /api/agentic-ai/remediation-plan`

### Plan Persistence and Approval

- `GET /api/agentic-ai/remediation-plans/:planId`
- `GET /api/agentic-ai/tickets/:ticketId/remediation-plans`
- `POST /api/agentic-ai/remediation-plans/:planId/approve`
- `POST /api/agentic-ai/remediation-plans/:planId/reject`

### Mock Execution (Simulation Only)

- `POST /api/agentic-ai/remediation-plans/:planId/mock-execute`
- `GET /api/agentic-ai/executions/:executionId`
- `GET /api/agentic-ai/remediation-plans/:planId/executions`
- `GET /api/agentic-ai/tickets/:ticketId/executions`

### Endpoint Device Registry

JWT-protected:

- `POST /api/agentic-ai/endpoint-devices/register`
- `GET /api/agentic-ai/users/me/endpoint-devices`
- `GET /api/agentic-ai/endpoint-devices` (support/admin)
- `POST /api/agentic-ai/endpoint-devices/:deviceId/heartbeat`
- `GET /api/agentic-ai/endpoint-devices/:deviceId`
- `POST /api/agentic-ai/endpoint-devices/:deviceId/disable`
- `POST /api/agentic-ai/endpoint-devices/:deviceId/enable` (support/admin)

### Agent Task Queue (Support/Admin)

JWT + support/admin role guarded:

- `POST /api/agentic-ai/remediation-plans/:planId/queue-task`
- `GET /api/agentic-ai/agent-tasks/:taskId`
- `GET /api/agentic-ai/remediation-plans/:planId/agent-tasks`
- `GET /api/agentic-ai/tickets/:ticketId/agent-tasks`
- `GET /api/agentic-ai/endpoint-devices/:deviceId/agent-tasks`

### Agent Polling/Execution-State Endpoints (Development)

Development endpoints for future Endpoint Agent integration:

- `GET /api/agentic-ai/agent/tasks/pending?deviceId=...`
- `POST /api/agentic-ai/agent/tasks/:taskId/claim`
- `POST /api/agentic-ai/agent/tasks/:taskId/start`
- `POST /api/agentic-ai/agent/tasks/:taskId/steps/:stepId/result`
- `POST /api/agentic-ai/agent/tasks/:taskId/complete`

For claim/start/result/complete, `x-device-id` header is required.

Important: these dev endpoints are not production-grade agent authentication. Production must use device tokens/mTLS or equivalent.

## Agent Task Queue Behavior

`queue-task` creates `AgentTask` + `AgentTaskStep` rows only when:

- Plan status is `APPROVED`
- `safe_plan.executionAvailable === true`
- A linked endpoint device exists
- Device is enabled and `ONLINE`

Queueing updates remediation plan status to `EXECUTION_QUEUED`.

Task completion updates remediation plan status to:

- `COMPLETED` if all steps succeed/skip
- `FAILED` if any step fails

No real endpoint execution is performed in this phase.

## SOFTWARE Planning Notes

- `SOFTWARE` category planning is supported
- Approved software catalog currently includes `GOOGLE_CHROME`
- Download/verify actions are planning and simulation only
- No real software download/install execution in this phase
