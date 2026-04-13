# OpsMind SLA Service

TypeScript SLA service aligned with OpsMind Ticket and Workflow services.

## What it does
- starts SLA tracking for a ticket
- calculates response and resolution deadlines
- stores SLA data in MySQL
- seeds default policies automatically
- runs monitor checks every interval
- publishes warning and breached notifications to RabbitMQ

## Run order
1. Start infrastructure first:
```bash
docker compose up -d
```
2. Ensure `sla_db` exists once:
```bash
docker exec -it opsmind-mysql mysql -uroot -proot -e "CREATE DATABASE IF NOT EXISTS sla_db;"
```
3. Start SLA service:
```bash
docker compose up -d --build
```

The service will create tables automatically on startup with Prisma.

## URLs
- Health: `http://localhost:3004/health`
- Swagger: `http://localhost:3004/api-docs`

## Current MQ behavior
- publishes warnings to `ticket.notification.slaWarning`
- publishes breaches to `ticket.notification.slaBreached`
- workflow intervention is disabled by default
