# OpsMind Ticket Service

A microservice for managing IT support tickets with event-driven architecture and intelligent location-based technician assignment.

---

## Table of Contents

- [System Overview](#system-overview)
- [Functional Requirements](#functional-requirements)
- [Non-Functional Requirements](#non-functional-requirements)
- [Use Cases](#use-cases)
- [System Architecture](#system-architecture)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [API Endpoints](#api-endpoints)
- [Events Published](#events-published)
- [Scripts](#scripts)
- [Docker](#docker)
- [Project Structure](#project-structure)

---

## System Overview

The OpsMind Ticket Service is a stateless microservice responsible for creating, tracking, and managing IT support tickets. When a ticket is submitted, the service captures the requester's GPS coordinates alongside the ticket metadata, persists the record, and forwards it to the Workflow Service for intelligent assignment. The Workflow Service selects the optimal technician by combining three factors: **geospatial proximity** (using the ticket's latitude and longitude), **current technician workload** (active ticket count), and **ticket priority** (LOW / MEDIUM / HIGH). All lifecycle events are published to a RabbitMQ topic exchange for consumption by downstream services.

---

## Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-01 | Users must be able to submit a support ticket by providing a title, description, request type, requester UUID, and GPS coordinates (latitude / longitude). |
| FR-02 | The system must automatically determine ticket priority and support level at creation time without requiring user input for those fields. |
| FR-03 | On ticket creation the service must forward the ticket ID, GPS coordinates, and priority to the Workflow Service for location-aware technician assignment. |
| FR-04 | The Workflow Service must assign the ticket to the nearest available technician, weighted by current active-ticket workload and adjusted by ticket priority. |
| FR-05 | High-priority tickets must receive expedited routing; the assignment algorithm must reduce the proximity threshold so that workload balancing does not delay critical work. |
| FR-06 | Tickets must follow a strict status lifecycle: **OPEN → IN_PROGRESS → RESOLVED → CLOSED**. Invalid transitions must be rejected with HTTP 400. |
| FR-07 | Technicians or support leads must be able to escalate a ticket from one support level to another (L1–L4), with a mandatory written reason recorded in the audit trail. |
| FR-08 | Tickets must support soft deletion; no record is physically removed, and all historical data is preserved for audit purposes. |
| FR-09 | Every create and update operation must publish a corresponding event (`ticket.created`, `ticket.updated`) to the `ticket.events` RabbitMQ exchange. |
| FR-10 | The service must expose basic and deep health-check endpoints for readiness probes in container orchestration environments. |

---

## Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-01 | **Availability** — The service must achieve 99.9% uptime. RabbitMQ and MySQL connections must implement reconnection logic with graceful shutdown support. |
| NFR-02 | **Scalability** — The service is stateless; multiple instances can run behind a load balancer. Database indexes on `status`, `priority`, `assigned_to`, and `created_at` must support query performance at scale. |
| NFR-03 | **Assignment Latency** — Location-based assignment computation in the Workflow Service must complete within 500 ms to maintain a responsive user experience. |
| NFR-04 | **Resilience** — A failure in the Workflow Service must not roll back ticket creation. The ticket is persisted in OPEN status and flagged for manual intervention if automated assignment fails. |
| NFR-05 | **Security** — All incoming payloads must be validated with Zod schemas before any database operation. No raw SQL is permitted; all queries go through Prisma ORM. |
| NFR-06 | **Observability** — Every request must carry a unique request ID. All create, update, assignment, and error events must be emitted as structured JSON logs for tracing and auditing. |
| NFR-07 | **Maintainability** — TypeScript strict mode, a modular directory structure, and schema-driven validation must be enforced to reduce regression risk during ongoing development. |
| NFR-08 | **Portability** — The service must run identically in local development (Docker Compose) and production (container orchestration) environments without code changes. |

---

## Use Cases

### UC-01 — Submit a New Ticket

| Field | Detail |
|-------|--------|
| **Actor** | Requester (end user or integrated system) |
| **Precondition** | The requester has a valid UUID and knows their current GPS coordinates. |
| **Main Flow** | 1. Requester submits `POST /tickets` with title, description, type, requester UUID, latitude, and longitude. 2. The service validates the payload. 3. System-assigned fields (priority, support_level, status = OPEN) are applied. 4. Ticket is persisted. 5. A `ticket.created` event is published. 6. The ticket ID, coordinates, and priority are forwarded to the Workflow Service for assignment. |
| **Alternate Flow** | If the Workflow Service is unreachable, the ticket remains in OPEN status. The failure is logged and flagged; manual assignment is possible via `PATCH /tickets/:id`. |
| **Outcome** | Ticket is stored, event emitted, and intelligent assignment triggered. |

---

### UC-02 — Intelligent Location-Based Assignment

| Field | Detail |
|-------|--------|
| **Actor** | Workflow Service (internal) |
| **Precondition** | A `ticket.created` event has been received containing `ticketId`, `latitude`, `longitude`, and `priority`. |
| **Main Flow** | 1. Workflow Service queries all available technicians with their current active-ticket counts and last-known locations. 2. Geodesic distance is computed between the ticket coordinates and each technician's location. 3. Each technician receives a composite score: `score = (α × distance_km) + (β × active_tickets)`. 4. For HIGH priority tickets, α is increased so proximity carries greater weight. 5. The technician with the lowest composite score is selected. 6. The Ticket Service `PATCH /tickets/:id` endpoint is called to set `assigned_to` and update status. |
| **Outcome** | Ticket is assigned to the optimal technician; the technician is notified via downstream event consumers. |

---

### UC-03 — Update Ticket Status

| Field | Detail |
|-------|--------|
| **Actor** | Technician or Workflow Service |
| **Precondition** | Ticket exists and `is_deleted = false`. |
| **Main Flow** | 1. `PATCH /tickets/:id` submitted with a new `status`. 2. System validates the transition against the allowed state machine. 3. If the new status is `CLOSED`, `closed_at` is recorded automatically. 4. A `ticket.updated` event is published. |
| **Outcome** | Ticket status updated and downstream services notified. |

---

### UC-04 — Escalate a Ticket

| Field | Detail |
|-------|--------|
| **Actor** | Technician or Support Lead |
| **Precondition** | Ticket exists and cannot be resolved at the current support level. |
| **Main Flow** | 1. `POST /tickets/:id/escalate` submitted with `from_level`, `to_level`, and `reason`. 2. A `TicketEscalation` record is inserted with the full audit details. 3. `escalation_count` on the ticket is incremented. 4. `assigned_to_level` on the ticket is updated to `to_level`. |
| **Outcome** | Ticket is escalated with a complete audit record. |

---

### UC-05 — Query Tickets

| Field | Detail |
|-------|--------|
| **Actor** | Support dashboard, reporting service, or technician client |
| **Precondition** | None. |
| **Main Flow** | 1. `GET /tickets` called with optional filters (`status`, `priority`, `requester_id`) and pagination (`limit`, `offset`). 2. Soft-deleted tickets are excluded. 3. Results are ordered by `created_at` descending. |
| **Outcome** | Paginated, filtered list of active tickets returned. |

---

### UC-06 — Soft Delete a Ticket

| Field | Detail |
|-------|--------|
| **Actor** | Support administrator |
| **Precondition** | Ticket exists and `is_deleted = false`. |
| **Main Flow** | 1. `DELETE /tickets/:id` submitted. 2. `is_deleted` is set to `true`; no record is physically removed. |
| **Outcome** | Ticket hidden from all standard queries; audit trail preserved. |

---

## System Architecture

The OpsMind Ticket Service is a stateless microservice in an event-driven ecosystem. Assignment responsibility is delegated to a dedicated Workflow Service that applies a location-aware scoring algorithm.

```
┌──────────────────────────────────────────────────────────────┐
│                    Client / Frontend                         │
└────────────────────────┬─────────────────────────────────────┘
                         │ REST (Port 3001)
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                 OpsMind Ticket Service                       │
│                                                              │
│  Express Routes → Zod Validation → Prisma ORM               │
│                                        │                     │
│                                   MySQL 8 DB                 │
│                                                              │
│  RabbitMQ Publisher  →  ticket.events  (topic exchange)      │
│    ticket.created                                            │
│    ticket.updated                                            │
└────────────────────────┬─────────────────────────────────────┘
                         │ HTTP POST (ticketId, lat, lng, priority)
                         ▼
┌──────────────────────────────────────────────────────────────┐
│              Workflow / Assignment Service                    │
│                                                              │
│  Inputs:  ticketId · latitude · longitude · priority         │
│                                                              │
│  Algorithm:                                                  │
│   1. Fetch available technicians + active-ticket counts      │
│   2. Compute geodesic distance per technician                │
│   3. Score = (α × distance_km) + (β × active_tickets)       │
│   4. Apply priority weight: HIGH → increase α                │
│   5. Assign technician with lowest composite score           │
│   6. PATCH /tickets/:id  →  { assigned_to, status }         │
└──────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| GPS coordinates as location input | Decouples assignment from physical naming conventions; works across any facility or outdoor environment. |
| Composite scoring (proximity + workload) | Prevents individual technicians from being overloaded while still prioritising the closest available resource. |
| Priority-weighted proximity factor (α) | Ensures urgent incidents are not queued behind low-priority work regardless of workload distribution. |
| Non-blocking workflow call | Ticket persistence is never gated on assignment success; routing failures are logged and flagged for manual intervention without data loss. |
| Event-driven notification | Downstream consumers (notifications, analytics, SLAs) react to events independently without coupling to the ticket service. |
| Soft delete | Preserves audit history and referential integrity with escalation records. |

---

## Features

- ✅ CRUD operations for tickets
- ✅ Location-aware intelligent technician assignment (latitude / longitude + workload + priority)
- ✅ Request validation with Zod
- ✅ Event publishing to RabbitMQ
- ✅ MySQL database with Prisma ORM
- ✅ Graceful shutdown handling
- ✅ Structured JSON logging with request IDs
- ✅ Health checks (basic + deep)
- ✅ CORS support (see below)
- ✅ Docker + Docker Compose ready

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Express.js 5
- **Language**: TypeScript
- **Database**: MySQL 8 + Prisma ORM
- **Message Broker**: RabbitMQ
- **Validation**: Zod

## Getting Started

### Prerequisites

- Node.js 20+
- Docker & Docker Compose (for local dependencies)

### 1. Install dependencies

```bash
npm install
```

### 2. Setup environment

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 3. Start dependencies (MySQL + RabbitMQ)

```bash
docker-compose up -d db rabbitmq
```

### 4. Run database migrations

```bash
npm run db:generate
npm run db:migrate
```

### 5. Start development server

```bash
npm run dev
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Basic health check |
| GET | `/health/ready` | Deep health check (DB + RabbitMQ) |
| GET | `/tickets` | List tickets (with filtering) |
| GET | `/tickets/:id` | Get ticket by ID |
| POST | `/tickets` | Create a new ticket |
| PATCH | `/tickets/:id` | Update a ticket |
| DELETE | `/tickets/:id` | Delete a ticket |

### Query Parameters for GET /tickets

- `status` — Filter by status (`OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`)
- `priority` — Filter by priority (`LOW`, `MEDIUM`, `HIGH`)
- `requester_id` — Filter by requester UUID
- `limit` — Number of results (default: 50)
- `offset` — Pagination offset (default: 0)

### Create Ticket Request Body

User-provided fields only. Priority and support level are **system-assigned**. GPS coordinates drive the intelligent assignment algorithm.

```json
{
  "title": "Printer not working",
  "description": "Office printer near the north wing shows error E-01",
  "type_of_request": "INCIDENT",
  "requester_id": "550e8400-e29b-41d4-a716-446655440000",
  "latitude": 31.9913,
  "longitude": 35.8664
}
```

## Events Published

| Event | Routing Key | When |
|-------|-------------|------|
| Ticket Created | `ticket.created` | After POST /tickets |
| Ticket Updated | `ticket.updated` | After PATCH /tickets/:id |

Events are published to exchange: `ticket.events` (topic exchange).

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled production server |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Run migrations (dev) |
| `npm run db:migrate:prod` | Run migrations (prod) |
| `npm run db:studio` | Open Prisma Studio |
| `npm run typecheck` | Type check without emitting |

## Docker

### Build and run with Docker Compose

```bash
docker-compose up --build
```

- The service is exposed on port **3001** (host) mapped to **3000** (container).
- CORS is enabled for: `http://localhost:5173`, `http://localhost:3001`, and `http://localhost:8085` (see `CORS_ORIGINS` in `docker-compose.yml`).

### Build image only

```bash
docker build -t opsmind-ticket-service .
```

## Project Structure

```
src/
├── server.ts              # Entry point
├── app.ts                 # Express app setup
├── config/
│   ├── index.ts           # Environment config
│   └── logger.ts          # Structured logger
├── routes/
│   └── ticket.routes.ts   # Ticket endpoints
├── validation/
│   └── ticket.schema.ts   # Zod schemas
├── middleware/
│   ├── error.middleware.ts
│   ├── validate.middleware.ts
│   └── requestId.middleware.ts
├── errors/
│   └── AppError.ts        # Custom error class
├── lib/
│   ├── prisma.ts          # Prisma client
│   └── rabbitmq.ts        # RabbitMQ connection
├── events/
│   └── publishers/
│       └── ticket.publisher.ts
└── utils/
    └── gracefulShutdown.ts
```

## GitHub User Configuration (Local Commits)

To ensure all commits and pushes from this project are associated with your GitHub user:

```bash
git config user.name "Janah-mahmoudd"
git config user.email "janahmahmoud94@gmail.com"
```

This sets your Git identity for this repository only.

## License

ISC
