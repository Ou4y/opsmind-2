# Azure Student Staging Deployment Plan for OpsMind

Last updated: 2026-06-07

## Purpose

This plan prepares OpsMind for a safe Azure student-account staging deployment. It does not deploy from the repository, does not create cloud resources, and does not include secrets. OpsMind is a multi-service ITSM, ITAM, Inventory, Procurement, AI, reporting, and operations platform, so the staging architecture should be practical and cost-controlled rather than an oversized production clone.

## Recommended Azure Architecture

### Core Runtime

- Azure Container Apps for backend services:
  - auth-service
  - ticket-service
  - workflow-service
  - sla-service
  - notification-service
  - inventory-backend
  - inventory-backend-worker
  - inventory-ai-service
  - inventory-ai-scheduler
  - ai-service
  - reporting-service, if needed for staging
  - opsmind-agentic-ai-service, if needed for staging
- Azure Container Registry for service images.
- Frontend option A: Azure Static Web Apps for `opsmind_frontend` if runtime config can be injected at build/deploy time.
- Frontend option B: frontend container in Azure Container Apps if the existing Nginx/runtime-config pattern is easier to preserve.
- Azure Database for PostgreSQL Flexible Server for `inventory-backend`, including Inventory, CMDB, Procurement, ABC, EOQ/MOQ, FIFO, finance foundations, supplier foundations, audit/alert foundations, and Prisma migrations.
- Azure Database for MySQL Flexible Server for MySQL-backed services such as auth, ticket, SLA, workflow, and agentic AI where applicable.
- Mongo-compatible storage should be handled deliberately. For a student staging phase, keep Mongo-dependent services optional or evaluate Azure Cosmos DB for MongoDB only if cost is acceptable.
- Azure Service Bus is the recommended long-term replacement for RabbitMQ event flows.
- Azure Key Vault or Container App secrets should hold secrets, connection strings, JWT secrets, internal API tokens, SMTP credentials, and external provider keys.
- Azure Monitor and Log Analytics should collect Container App logs, health check failures, restart counts, and API errors.

## Why Not AKS for Student Staging

AKS is not recommended for the student-account stage because it adds cluster management overhead, baseline compute cost, networking complexity, ingress configuration, observability setup, and security responsibilities before the application needs Kubernetes scale. Azure Container Apps gives enough service isolation, revisions, ingress control, scaling, and logs for staging at lower operational cost.

## Why Not GPU or Self-hosted Ollama Initially

Self-hosted Ollama or GPU-backed LLM hosting can consume student credit quickly and adds cold-start, model storage, VM sizing, and reliability concerns. Start staging with deterministic fallback mode or a hosted provider behind secrets. Keep local Ollama/Gemma for development and demos. If LLM-backed staging is required later, add it as Phase 2 with explicit budget alerts.

## Public vs Internal Ingress

Public ingress should be limited to:

- Frontend: public.
- Auth service: public if the frontend must call it directly.
- Ticket service API: public only if browser calls it directly; otherwise internal behind a gateway/BFF.
- Inventory backend API: public only if browser calls it directly; otherwise internal behind a gateway/BFF.
- Notification read API: public only if browser calls it directly and auth is enforced.

Internal-only services should include:

- workflow-service
- sla-service
- inventory-backend-worker
- inventory-ai-scheduler
- inventory-ai-service, unless browser diagnostics require direct staging access
- ai-service, unless browser calls it directly
- reporting-service, unless browser calls it directly
- RabbitMQ/Service Bus equivalent
- databases
- phpMyAdmin/MailHog equivalents should not be public in Azure staging

For the current frontend, several services are called directly by the browser. In Phase 1, public ingress may be necessary for those APIs. Phase 2 should move toward a gateway/BFF pattern or strict CORS/auth enforcement per service.

## Staging vs Production Differences

Staging:

- Lower min replicas, often zero or one.
- Smaller database SKUs.
- Deterministic AI fallback or hosted LLM only if budget allows.
- Manual finance/supplier providers.
- Limited data retention.
- Test/sample data only.
- Developer-friendly diagnostics, but no raw secrets or tokens in logs.

Production:

- Enforced auth and role checks on every service.
- Private networking where possible.
- Managed messaging via Azure Service Bus.
- Reliable backups and restore drills.
- Budget approvals and real operational runbooks.
- Production-grade monitoring, alerting, audit trails, and incident response.
- Real data privacy review before enabling external LLM calls.

## Cost-Control Checklist

- Set an Azure budget alert before deploying anything.
- Use the smallest practical Container Apps CPU/memory profile.
- Keep min replicas at 0 for non-critical staging services where acceptable.
- Avoid AKS, GPU VMs, always-on large databases, and public preview features with unclear billing.
- Use one region.
- Avoid duplicating databases unless required.
- Disable self-hosted Ollama in Azure student staging by default.
- Stop or scale down staging when not in use.
- Review Log Analytics ingestion costs.
- Keep retention short for staging logs.

## Budget Alert Reminder

Before Phase 1 deployment, create a student-credit budget alert in Azure Cost Management. Use at least two thresholds, for example 50% and 80% of the monthly/student-credit allowance.

## Secrets Strategy

- Do not commit `.env` files.
- Use `.env.azure.example` only as a placeholder template.
- Store real secrets in Azure Key Vault or Container App secrets.
- Rotate any local/demo token that was ever committed or copied into issue trackers, chat, screenshots, or docs.
- Use secure production values for `JWT_SECRET`, `INTERNAL_API_TOKEN`, database passwords, SMTP credentials, and external AI/search/provider keys.

## Database Plan

### PostgreSQL Flexible Server

Use for Inventory/Procurement/ITAM via `Services/inventory-backend/prisma/schema.prisma`.

Recommended staging tasks:

1. Create PostgreSQL Flexible Server.
2. Create `opsmind_inventory_staging` database.
3. Configure SSL-required connection string.
4. Run Prisma migrations from a controlled deployment step.
5. Validate `/api/inventory/procurement/board`, ABC, EOQ/MOQ, FIFO, and asset APIs.

Never run destructive migration reset commands against staging or production.

### MySQL Flexible Server

Use for MySQL-backed services: auth, ticket, SLA, workflow, and agentic AI where applicable. Keep databases separated by schema/database name.

### Mongo-Compatible Services

Notification and reporting currently depend on Mongo-style storage. For Phase 1, either keep these out of the minimal staging slice or use a managed Mongo-compatible option after cost review.

## Messaging Plan

Phase 1 can keep RabbitMQ only if the containerized setup is required for feature parity. The recommended long-term Azure approach is Azure Service Bus topics/queues because it is managed, durable, and easier to operate than self-hosted RabbitMQ in a student staging account.

Migration direction:

1. Wrap publish/consume logic behind provider interfaces.
2. Keep RabbitMQ provider for local dev.
3. Add Service Bus provider for Azure staging.
4. Move event names/routing keys into config.
5. Test ticket assignment, SLA notifications, inventory AI jobs, and reporting events.

## AI Plan

- Local development can use Ollama/Gemma.
- Azure student staging should default to deterministic/fallback mode or a hosted provider with strict budget limits.
- Do not expose raw prompts or sensitive inventory data in logs.
- Keep AI source labels honest: Gemma-generated, deterministic, hybrid, fallback, or unavailable.
- Keep Inventory AI diagnostics internal or protected.

## Phased Migration Plan

### Phase 1: Minimal Azure Staging

Goal: prove the app can run in Azure with safe cost.

- Deploy frontend.
- Deploy auth, ticket, workflow, SLA, notification if required for login/ticket flows.
- Deploy inventory-backend and inventory-ai-service in deterministic/fallback-safe mode.
- Use PostgreSQL Flexible Server for inventory-backend.
- Use MySQL Flexible Server for MySQL-backed services.
- Keep RabbitMQ only if required; otherwise defer event-heavy workflows.
- Use Container App secrets.
- Enable Log Analytics.
- Validate login, ticket basics, inventory browsing, procurement board, and AI fallback labels.

### Phase 2: Production-like Hardening

Goal: reduce staging/production gaps.

- Move messaging to Azure Service Bus provider.
- Enforce auth for Inventory APIs.
- Restrict CORS to frontend domain.
- Add managed backups and restore test notes.
- Add service health dashboards.
- Protect diagnostics endpoints.
- Add revision rollout strategy for Container Apps.
- Add staging seed-data strategy.

### Phase 3: Real Production

Goal: operate with real users and real data.

- Private networking and least-privilege identities.
- Formal backup/restore runbook.
- Incident response and audit retention.
- Production monitoring alerts.
- Security review of all external AI/provider integrations.
- Data privacy review for inventory, user, and procurement records.
- Optional hosted LLM integration with budget controls and data governance.

## Deployment Blockers to Resolve Before Real Staging

- Replace local compose secrets with Azure secrets.
- Decide Mongo-compatible path for notification/reporting services.
- Decide RabbitMQ vs Service Bus for Phase 1.
- Confirm all public APIs enforce auth where required.
- Confirm CORS does not use `*` in Azure.
- Confirm Prisma migrations apply cleanly to a fresh Azure PostgreSQL database.
- Confirm no runtime JSON/cache/model artifacts are committed.
