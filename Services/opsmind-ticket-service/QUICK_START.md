# Quick Start Scripts

## 🚀 Start Service (First Time / After Code Changes)

Double-click: **`start-dev.bat`**

This will:
1. Create `.env` file for development
2. Start infrastructure (MySQL + RabbitMQ)
3. Build and start Ticket Service
4. Auto-reload on code changes

## 🔄 Restart Service (Quick)

Double-click: **`restart.bat`**

Use this when:
- Code changes in development mode
- Need to refresh the service

## 🛑 Stop Service

Double-click: **`stop.bat`**

---

## Manual Commands

If you prefer terminal commands:

```bash
# Start (with rebuild)
docker-compose up --build

# Start in background
docker-compose up -d --build

# Restart
docker-compose restart

# Stop
docker-compose down

# View logs
docker-compose logs -f

# Execute commands in container
docker-compose exec ticket-service sh
```

---

## After Making Changes

**TypeScript changes (.ts files):**
- Just click `restart.bat` in development mode
- OR run `docker-compose restart`

**Dependencies changed (package.json):**
- Click `start-dev.bat` to rebuild
- OR run `docker-compose up --build`

**Database schema changed (prisma):**
```bash
docker-compose exec ticket-service npm run db:migrate
```

---

## Troubleshooting

**Port 3001 already in use?**
- Stop other services: `docker-compose down`
- Or change port in docker-compose.yml

**Changes not reflecting?**
- Make sure `.env` exists (run `start-dev.bat`)
- Rebuild: `docker-compose up --build`

**Cannot connect to database?**
- Ensure infrastructure is running:
  ```bash
  cd ../../opsmind-infrastructure
  docker-compose up -d
  ```
