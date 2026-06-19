# Azure Environment Mapping Notes

This file records safe environment-variable mapping for OpsMind Inventory, Procurement, approval workflow, AI, and notifications.

## Inventory Approval / RBAC

- `INVENTORY_ENFORCE_AUTH=true`
- `AUTH_SERVICE_URL=https://<auth-app>.<region>.azurecontainerapps.io`
- `NOTIFICATION_SERVICE_URL=https://<notification-app>.<region>.azurecontainerapps.io/api/notifications`
- `INVENTORY_APPROVAL_NOTIFICATION_ENABLED=true`
- `INTERNAL_API_TOKEN=<set-in-container-app-secret>`
- `JWT_SECRET=<set-in-azure-key-vault>`

## Inventory Database

- `DATABASE_URL=postgresql://<user>:<password>@<postgres-flexible-server>.postgres.database.azure.com:5432/opsmind_inventory_staging?sslmode=require`
- `INVENTORY_DATABASE_URL=postgresql://<user>:<password>@<postgres-flexible-server>.postgres.database.azure.com:5432/opsmind_inventory_staging?sslmode=require`

Use `prisma migrate deploy` only. Do not use `prisma migrate reset` against staging or production-like data.

## Notification Service

- `MONGO_URI=<set-in-container-app-secret-or-managed-alternative>`
- `RABBITMQ_URL=<set-in-container-app-secret-if-rabbitmq-used>`
- `EVENTS_EXCHANGE_NAME=opsmind.events`

Inventory approval events are published through the notification API event endpoint and consumed by notification-service from `inventory.notification.*`.

## Inventory AI

- `OPSMIND_INVENTORY_AI_API_URL=https://<inventory-ai-app>.<region>.azurecontainerapps.io`
- `LLM_PROVIDER=deterministic` for low-cost staging, or configured provider when available.
- `OLLAMA_*` values are local-only unless a managed Ollama host is explicitly provided.

## Security Notes

- Do not put real secrets in `.env.example` or docs.
- Store real values in Azure Container App secrets or Key Vault.
- Approval workflow does not replace auth-service user management; it only evaluates Inventory/Procurement actions and stores audit/approval records.
