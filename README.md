# OpsMind Monorepo

OpsMind is a multi-service IT Service Management (ITSM) platform that combines ticketing, workflow assignment, SLA tracking, notifications, inventory, AI-assisted insights, and a role-based frontend dashboard.

This repository contains:
- A production-style frontend in `opsmind_frontend`
- Multiple backend microservices in `Services`
- Shared infrastructure bootstrapping in `docker-compose.yml` and `opsmind-infrastructure`
- Team workflow, hierarchy, testing, and audit documentation in top-level markdown guides

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Repository Structure](#repository-structure)
3. [Service Inventory](#service-inventory)
4. [Prerequisites](#prerequisites)
5. [Quick Start (Full Stack with Docker)](#quick-start-full-stack-with-docker)
6. [Default URLs and Ports](#default-urls-and-ports)
7. [Environment Configuration](#environment-configuration)
8. [Development Workflows](#development-workflows)
9. [Running Tests](#running-tests)
10. [Hierarchy Features](#hierarchy-features)
11. [Known Development Caveats](#known-development-caveats)
12. [Troubleshooting](#troubleshooting)
13. [Documentation Index](#documentation-index)

## Architecture Overview

At a high level, the platform follows a microservice architecture:

- Frontend serves the UI and calls backend APIs.
- Auth service manages identity, OTP, JWT, and admin user/domain workflows.
- Ticket service handles ticket lifecycle and publishes events.
- Workflow service handles assignment logic and technician hierarchy.
- SLA service tracks deadlines and emits warning/breach events.
- Notification service consumes events and stores/sends notifications.
- Inventory service manages assets and inventory tickets.
- AI service provides priority and resolution-time predictions.

Shared infrastructure includes MySQL, MongoDB, RabbitMQ, MailHog, and phpMyAdmin.

## Repository Structure

```text
opsmind/
|- docker-compose.yml                 # Full-stack local orchestrator
|- .env.example                       # Root runtime variables (frontend/API URLs)
|- opsmind_frontend/                  # Frontend app
|- opsmind-infrastructure/            # Infra-specific compose and DB init files
|- Services/
|  |- opsmind-authentication/         # Auth service (TypeScript)
|  |- opsmind-ticket-service/         # Ticket service (TypeScript + Prisma)
|  |- opsmind-workflow-service/       # Workflow service (TypeScript)
|  |- opsmind-sla-service/            # SLA service (TypeScript + Prisma)
|  |- notification-service/           # Notification service (Node.js)
|  |- inventory-backend/              # Inventory service (TypeScript + MongoDB)
|  |- ai-service/                     # AI service (FastAPI/Python)
|  |- reportandanalysis-service/      # Reporting service (Node.js, standalone compose)
|- UNIT_TESTING_GUIDE.md              # Cross-service unit test guide
|- DOCKER_QUICK_GUIDE.md              # Docker-focused workflow shortcuts
|- QUICK_START_HIERARCHY.md           # Hierarchy quick start
```

## Service Inventory

| Service | Path | Stack | Host Port | Notes |
|---|---|---|---:|---|
| Frontend | `opsmind_frontend` | HTML/CSS/JS + Nginx | 8085 | Main UI |
| Auth | `Services/opsmind-authentication` | Node.js + TypeScript + MySQL | 3002 | JWT, OTP, admin endpoints |
| Ticket | `Services/opsmind-ticket-service` | Node.js + TypeScript + Prisma/MySQL | 3001 | Ticket CRUD + event publishing |
| Workflow | `Services/opsmind-workflow-service` | Node.js + TypeScript + MySQL + RabbitMQ | 3003 | Assignment + hierarchy |
| SLA | `Services/opsmind-sla-service` | Node.js + TypeScript + Prisma/MySQL + RabbitMQ | 3004 | SLA timer tracking |
| Notification | `Services/notification-service` | Node.js + MongoDB + RabbitMQ | 3005 | Notification storage + delivery |
| Inventory | `Services/inventory-backend` | Node.js + TypeScript + MongoDB + RabbitMQ | 5000 | Asset/inventory APIs |
| AI | `Services/ai-service` | Python + FastAPI | 8000 | Priority and ETA predictions |
| Reporting (optional) | `Services/reportandanalysis-service` | Node.js + MongoDB | 3004* | Standalone compose, not in root stack |

Infrastructure in root compose:
- MySQL: `3306`
- MongoDB (notifications): `27017`
- MongoDB (inventory): `27018`
- RabbitMQ AMQP: `5672`
- RabbitMQ Management UI: `15672`
- MailHog SMTP/UI: `1025` / `8025`
- phpMyAdmin: `8080`

`*` Reporting service default port collides with SLA (`3004`) if both are run together without remapping.

## Prerequisites

- Docker Desktop with Compose support
- Git
- Node.js 20+ (for local non-container development of JS/TS services)
- Python 3.10+ and pip (for local non-container AI service development)

## Quick Start (Full Stack with Docker)

### 1. Configure root environment

```bash
cp .env.example .env
```

Edit `.env` as needed. At minimum, review:
- `OPSMIND_API_URL`
- `OPSMIND_TICKET_URL`
- `OPSMIND_WORKFLOW_API_URL`
- `OPSMIND_AI_API_URL`
- `GEMINI_API_KEY`

### 2. Build and start everything

```bash
docker compose up -d --build
```

### 3. Verify containers

```bash
docker compose ps
```

### 4. Open the frontend

Navigate to:

`http://localhost:8085`

### 5. Stop stack

```bash
docker compose down
```

To also remove local volumes:

```bash
docker compose down -v
```

## Default URLs and Ports

| Component | URL |
|---|---|
| Frontend | http://localhost:8085 |
| Auth Service | http://localhost:3002 |
| Ticket Service | http://localhost:3001 |
| Workflow Service | http://localhost:3003 |
| SLA Service | http://localhost:3004 |
| Notification Service | http://localhost:3005 |
| Inventory Backend | http://localhost:5000 |
| AI Service | http://localhost:8000 |
| RabbitMQ Management | http://localhost:15672 |
| phpMyAdmin | http://localhost:8080 |
| MailHog UI | http://localhost:8025 |

Common local credentials used in compose (development only):
- RabbitMQ: `opsmind` / `opsmind`
- MySQL root: `root` / `root`
- MySQL app user: `opsmind` / `opsmind`

## Environment Configuration

### Root `.env`

Root env values are mainly used to inject runtime API URLs and AI config into the frontend container.

Start from:
- `.env.example`

### Service-specific env files

Many services include their own `.env.example` or service-level compose env sections. Review each service README before standalone runs.

### Security note

Do not commit real secrets to this repository. Treat compose defaults as local development values only.

## Development Workflows

### Full stack iteration

```bash
# Rebuild and restart all services
docker compose up -d --build

# Stream logs for one service
docker compose logs -f ticket-service

# Restart one service after code changes
docker compose restart workflow-service
```

### Per-service standalone compose

Several services include their own `docker-compose.yml` and helper scripts for isolated development. Examples:
- `Services/opsmind-ticket-service/QUICK_START.md`
- `Services/opsmind-workflow-service/QUICK_START.md`
- `DOCKER_QUICK_GUIDE.md`

### Local non-container commands (examples)

```bash
# Auth service
cd Services/opsmind-authentication
npm install
npm run dev

# Ticket service
cd ../opsmind-ticket-service
npm install
npm run dev

# Workflow service
cd ../opsmind-workflow-service
npm install
npm run dev

# SLA service
cd ../opsmind-sla-service
npm install
npm run dev

# Inventory backend
cd ../inventory-backend
npm install
npm run dev

# AI service
cd ../ai-service
pip install -r requirements.txt
uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
```

## Running Tests

Based on the repository test guide, run the following from repository root:

```bash
cd Services/inventory-backend && npm test
cd ../opsmind-authentication && npm test
cd ../opsmind-ticket-service && npm test
cd ../opsmind-workflow-service && npm test
cd ../opsmind-sla-service && npm test
cd ../reportandanalysis-service && npm test
```

Reference:
- `UNIT_TESTING_GUIDE.md`

## Hierarchy Features

Hierarchy management (admin/supervisor flows, reporting relationships, dashboards) is documented in:
- `QUICK_START_HIERARCHY.md`
- `HIERARCHY_IMPLEMENTATION_COMPLETE.md`
- `HIERARCHY_FIX_SUMMARY.md`
- `Services/opsmind-workflow-service/HIERARCHY_API_DOCUMENTATION.md`
- `Services/opsmind-workflow-service/HIERARCHY_IMPLEMENTATION.md`

## Known Development Caveats

- The optional reporting service (`Services/reportandanalysis-service`) maps to `3004` by default, which conflicts with SLA service in the root stack.
- Frontend AI integration depends on configured runtime values in root `.env` and browser-exposed frontend config. Keep API keys out of committed files.
- If you change DB initialization SQL, existing Docker volumes can hide those updates until volumes are recreated.

## Troubleshooting

### Services start but app behavior is wrong

```bash
docker compose logs -f auth-service
docker compose logs -f ticket-service
docker compose logs -f workflow-service
```

### Database init scripts did not apply

```bash
docker compose down -v
docker compose up -d --build
```

### Port is already in use

- Stop old containers or processes using that port.
- Remap host ports in compose if needed.
- Be careful with `3004` overlap (SLA vs reporting service).

### RabbitMQ debugging

- Open `http://localhost:15672`
- Verify exchanges/queues and connected services.

### Email debugging in local development

- Open MailHog UI: `http://localhost:8025`

## Documentation Index

Top-level docs:
- `DOCKER_QUICK_GUIDE.md`
- `UNIT_TESTING_GUIDE.md`
- `PROJECT_AUDIT_BUGS_PERFORMANCE_STRUCTURE.md`
- `QUICK_START_HIERARCHY.md`
- `HIERARCHY_IMPLEMENTATION_COMPLETE.md`
- `HIERARCHY_FIX_SUMMARY.md`

Frontend docs:
- `opsmind_frontend/README.md`
- `opsmind_frontend/DASHBOARDS_QUICK_REFERENCE.md`
- `opsmind_frontend/HIERARCHY_API_USAGE_EXAMPLES.md`

Service docs:
- `Services/opsmind-authentication/README.md`
- `Services/opsmind-authentication/SETUP_GUIDE.md`
- `Services/opsmind-ticket-service/README.md`
- `Services/opsmind-ticket-service/QUICK_START.md`
- `Services/opsmind-sla-service/README.md`
- `Services/inventory-backend/README.md`
- `Services/ai-service/README.md`
- `Services/opsmind-workflow-service/QUICK_START.md`

---

If you want, this README can be extended next with:
- endpoint-level API map across all services,
- sequence diagrams for ticket lifecycle,
- production deployment profile (security-hardening checklist + env matrix).