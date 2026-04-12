# OpsMind Docker Quick Start Guide

## 🎯 Quick Commands

### Start Individual Services (After Making Changes)

**Ticket Service** (notification publisher for resolved tickets):
```bash
cd Services\opsmind-ticket-service
# Double-click: start-dev.bat
# OR run: docker-compose up --build
```

**Workflow Service** (notification publisher for ticket assignments):
```bash
cd Services\opsmind-workflow-service
# Double-click: start-dev.bat
# OR run: docker-compose up --build
```

### Start All Services at Once

```bash
# From project root
# Double-click: start-all-services.bat
# OR run it in terminal
start-all-services.bat
```

### Stop All Services

```bash
# From project root
# Double-click: stop-all-services.bat
stop-all-services.bat
```

---

## 📁 Per-Service Scripts

Each service has these scripts:

- **`start-dev.bat`** - Build and start in dev mode
- **`restart.bat`** - Quick restart (for code changes)
- **`stop.bat`** - Stop the service

---

## 🔄 Workflow After Code Changes

### 1. Changed TypeScript Files (.ts)
```bash
cd Services\[service-name]
restart.bat
# OR: docker-compose restart
```

### 2. Changed package.json (new dependencies)
```bash
cd Services\[service-name]
start-dev.bat
# OR: docker-compose up --build
```

### 3. Changed Database Schema
```bash
# Ticket Service (Prisma)
cd Services\opsmind-ticket-service
docker-compose exec ticket-service npm run db:migrate

# Workflow Service (SQL)
cd Services\opsmind-workflow-service
docker-compose exec workflow-service sh
mysql -h opsmind-mysql -u root -proot workflow_db < db/seed.sql
```

---

## 📊 Service Ports

| Service | Port | URL |
|---------|------|-----|
| Ticket Service | 3001 | http://localhost:3001 |
| Auth Service | 3002 | http://localhost:3002 |
| Workflow Service | 3003 | http://localhost:3003 |
| MySQL | 3306 | localhost:3306 |
| RabbitMQ | 5672 | amqp://localhost:5672 |
| RabbitMQ Admin | 15672 | http://localhost:15672 |
| phpMyAdmin | 8080 | http://localhost:8080 |

---

## 🔍 Monitoring & Logs

```bash
# View logs for a service
cd Services\[service-name]
docker-compose logs -f

# View all running containers
docker ps

# Check container resource usage
docker stats
```

---

## 🆕 Recent Changes (Notification Publishers)

### Ticket Service
- **File**: `src/events/publishers/ticket.publisher.ts`
- **Function**: `publishTicketResolvedNotification()`
- **Routing Key**: `ticket.notification.resolved`
- **Trigger**: After ticket status changes to RESOLVED

### Workflow Service
- **File**: `src/services/NotificationPublisher.ts`
- **Function**: `publishTicketAssigned()`
- **Routing Key**: `ticket.notification.assigned`
- **Trigger**: After successful ticket assignment

---

## 🐛 Troubleshooting

### Changes not reflecting?
1. Make sure `.env` file exists in service folder
2. Restart: `docker-compose restart`
3. Rebuild: `docker-compose up --build`

### Port already in use?
```bash
# Stop all services
stop-all-services.bat
# Then start again
```

### Cannot connect to database?
```bash
cd opsmind-infrastructure
docker-compose up -d
```

### RabbitMQ not working?
1. Check RabbitMQ is running: http://localhost:15672
2. Login: username=`opsmind`, password=`opsmind`
3. Check queues and exchanges

---

## 📝 Development Workflow Example

```bash
# 1. Start infrastructure
cd opsmind-infrastructure
docker-compose up -d

# 2. Make changes to Ticket Service
cd ..\Services\opsmind-ticket-service
# Edit src/routes/ticket.routes.ts

# 3. Rebuild and restart
start-dev.bat
# OR: docker-compose up --build

# 4. Test changes
# Access http://localhost:3001

# 5. View logs
docker-compose logs -f

# 6. Stop when done
stop.bat
```

---

## 🎓 Additional Resources

- **Ticket Service Quick Start**: `Services/opsmind-ticket-service/QUICK_START.md`
- **Workflow Service Quick Start**: `Services/opsmind-workflow-service/QUICK_START.md`
- **Infrastructure Setup**: `opsmind-infrastructure/README.md`

---

**Created by**: OpsMind Development Team
**Last Updated**: April 12, 2026
