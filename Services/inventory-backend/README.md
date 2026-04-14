# Inventory Backend (opsmind-backend)

Minimal README for the inventory backend service used in the OpsMind project.

## Features
- REST API for managing assets, tickets and configuration
- Publishes domain events to RabbitMQ for background processing
- Stores data in MongoDB

## Quick start (Docker Compose)
Requirements: Docker, Docker Compose

1. Start services:

```bash
docker-compose up -d --build
```

2. Verify containers:

```bash
docker ps
```

3. Tail backend logs:

```bash
docker logs --tail 200 -f opsmind-inventory-backend
```

## Development (local)
- The API server runs on port `5000` inside the container and is proxied by nginx on `3002`.
- The backend connects to MongoDB using `MONGO_URI` env var (default `mongodb://opsmind-mongodb:27017/opsmind_assets`).

To run queries against Mongo from the host (example):

```bash
docker exec -it opsmind-mongodb mongosh
use opsmind_assets
db.assets.find().limit(20).pretty()
```

## Important files
- `src/server.ts` — Express app, routes and DB connection
- `src/routes/assetRoutes.ts` — Asset routes (GET/POST/PATCH/DELETE)
- `src/routes/ticketRoutes.ts` — Ticket CRUD routes
- `src/routes/configRoutes.ts` — Static config endpoints
- `src/services/EventBus.ts` — RabbitMQ publisher/subscriber
- `src/services/history-service` — Background consumer storing history
- `src/models` — Mongoose models (`Asset`, `History`, `Tickets`)

## API summary (top-level)
- `GET /api/assets` — list assets
- `GET /api/assets/:id` and `GET /api/assets/single/:id` — fetch single asset
- `GET /api/assets/search?query=...` — search assets
- `POST /api/assets` — create asset(s)
- `PATCH /api/assets/:id/transfer` — transfer/split asset
- `PATCH /api/assets/:id/status` — change status
- `PATCH /api/assets/:id/details` — update details/specs
- `DELETE /api/assets/:id` — delete asset
- `/api/tickets` — ticket endpoints (GET, POST, PATCH, DELETE)
- `GET /api/config` — returns `buildings`, `departments`, `assetTypes`

## Inspecting newly created assets
When you add an asset from the frontend, the API logs the created `customId`. Example flow:

1. Add asset in frontend
2. Check backend logs for `POST /api/assets` and `Created assets (customIds)`
3. Query Mongo for the `customId`:

```bash
docker exec opsmind-mongodb mongosh --quiet --eval "const d=db.getSiblingDB('opsmind_assets'); printjson(d.getCollection('assets').find({ customId: 'ASSET-1771172184216-1' }).toArray());"
```

## Event bus
- The API publishes events like `asset.created` and `asset.deleted` to RabbitMQ. A worker subscribes and writes history entries.

## Contributing
- Run linters/tests (if any) and open PRs.

---
If you want this README expanded with PlantUML diagrams or a SQL export, tell me which format you prefer.
