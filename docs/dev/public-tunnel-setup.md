# OpsMind Public Tunnel Setup

This setup exposes the full local OpsMind stack through one public tunnel URL for demos and remote testing.

## Requirements

- Docker Compose stack running
- Caddy installed locally
- ngrok or Cloudflare Tunnel installed

## Local gateway

The Caddy gateway listens on:

    http://localhost:8090

It routes:

- `/` -> frontend `localhost:8085`
- `/auth-api` -> auth service `localhost:3012`
- `/ticket-api` -> ticket service `localhost:3001`
- `/workflow-api` -> workflow service `localhost:3003`
- `/sla-api` -> SLA service `localhost:3004`
- `/notification-api` -> notification service `localhost:3005`
- `/report-api` -> reporting service `localhost:3006`
- `/inventory-api` -> inventory backend `localhost:5000`
- `/inventory-ai-api` -> inventory AI service `localhost:8002`
- `/ai-api` -> AI service `localhost:8001`
- `/agentic-ai-api` -> agentic AI service `localhost:4010`

## Start local stack

    docker compose up -d --build

## Start Caddy gateway

    caddy run --config docs/dev/opsmind-public-tunnel.Caddyfile.example

## Start ngrok

    ngrok http 8090

Or with a reserved ngrok domain:

    ngrok http --url=YOUR_DOMAIN.ngrok-free.dev 8090

## Start Cloudflare Tunnel instead

    cloudflared tunnel --url http://localhost:8090

## Test gateway locally

    curl -s http://localhost:8090/auth-api/health
    curl -s "http://localhost:8090/inventory-api/api/inventory/public/asset-verify?assetTag=QA3P260620-P001"

## Public QR example

    https://YOUR_DOMAIN.ngrok-free.dev/assets/scan?assetTag=QA3P260620-P001

## Notes

Free ngrok may show a warning page. Click "Visit Site".

Do not commit `.env`, service-local `.env`, `docker-compose.override.yml`, ngrok tokens, passwords, runtime files, or database volumes.
