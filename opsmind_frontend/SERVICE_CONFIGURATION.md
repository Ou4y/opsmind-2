# OpsMind Service Configuration

## Service URLs and Ports

Based on the Docker container setup, here are the correct service endpoints:

| Service | Container Name | Internal Port | External Port | Frontend URL |
|---------|---------------|---------------|---------------|--------------|
| **Auth Service** | opsmind-auth-service | 3002 | 3002 | `http://localhost:3002` |
| **Ticket Service** | opsmind-ticket-service | 3000 | 3001 | `http://localhost:3001` |
| **Workflow Service** | opsmind-workflow | 3003 | 3003 | `http://localhost:3003` |
| **Frontend** | opsmind-frontend | 85 | 8085 | `http://localhost:8085` |
| **MySQL** | opsmind-mysql | 3306 | - | Internal only |
| **RabbitMQ** | opsmind-rabbitmq | 5672, 15672 | 5672, 15672 | `http://localhost:15672` |
| **phpMyAdmin** | opsmind-phpmyadmin | 80 | 8080 | `http://localhost:8080` |

## Configuration Files

### Frontend Configuration
**File:** `assets/js/config.js`

```javascript
window.OPSMIND_API_URL = 'http://localhost:3002';        // Auth Service
window.OPSMIND_TICKET_URL = 'http://localhost:3001';     // Ticket Service
window.OPSMIND_WORKFLOW_API_URL = 'http://localhost:3003'; // Workflow Service
window.OPSMIND_AI_API_URL = 'http://localhost:8000';     // AI/ML Service
```

### Service Usage

1. **authService.js** → Uses `OPSMIND_API_URL` (Port 3002)
   - Login, signup, OTP verification
   - User authentication and session management

2. **ticketService.js** → Uses `OPSMIND_TICKET_URL` (Port 3001)
   - Ticket CRUD operations
   - Ticket search and filtering
   - Ticket status updates

3. **workflowService.js** → Uses `OPSMIND_WORKFLOW_API_URL` (Port 3003)
   - Ticket routing to support groups
   - Claim, reassign, escalate operations
   - Workflow logs and audit trail
   - SLA monitoring and metrics
   - Team performance analytics

## Testing Service Connectivity

### Option 1: Use the Test Page
Open in browser: `http://localhost:8085/test-connection.html`

This page will automatically test all three services and show:
- Connection status
- Response time
- Status codes
- Service availability

### Option 2: Manual Testing with curl

```powershell
# Test Auth Service
curl.exe http://localhost:3002/api/auth/health

# Test Ticket Service
curl.exe http://localhost:3001/api/tickets

# Test Workflow Service
curl.exe http://localhost:3003/api/workflow/metrics
```

### Option 3: Check Docker Container Health

```powershell
docker ps --filter "network=opsmind-net" --format "table {{.Names}}\t{{.Status}}"
```

All services should show `Up X hours (healthy)` status.

## Workflow Service Endpoints

The Workflow Service (Port 3003) provides these key endpoints:

### Ticket Operations
```
POST   /api/workflow/route                    - Route ticket to support group
POST   /api/workflow/:ticketId/claim          - Claim unassigned ticket
POST   /api/workflow/:ticketId/reassign       - Reassign ticket to another tech
POST   /api/workflow/:ticketId/escalate       - Escalate ticket to senior/supervisor
```

### Data Retrieval
```
GET    /api/workflow/:ticketId/logs           - Get workflow action history
GET    /api/workflow/my-tickets/:technicianId - Get technician's tickets
GET    /api/workflow/group/:groupId/tickets   - Get support group tickets
GET    /api/workflow/group/:groupId/members   - Get group members
GET    /api/workflow/sla/status               - Get SLA status for tickets
```

### Analytics & Reports
```
GET    /api/workflow/metrics                  - Get building-level metrics
GET    /api/workflow/team/:groupId/metrics    - Get team performance data
GET    /api/workflow/sla/report               - Get SLA compliance report
GET    /api/workflow/escalation/stats         - Get escalation statistics
```

## Common Issues and Solutions

### Issue: Services not connecting

**Check 1: Verify containers are running**
```powershell
docker ps --filter "network=opsmind-net"
```

**Check 2: Test service ports**
```powershell
Test-NetConnection -ComputerName localhost -Port 3002
Test-NetConnection -ComputerName localhost -Port 3001
Test-NetConnection -ComputerName localhost -Port 3003
```

**Check 3: Check Docker logs**
```powershell
docker logs opsmind-workflow
docker logs opsmind-ticket-service
docker logs opsmind-auth-service
```

### Issue: CORS errors in browser console

**Solution:** Ensure backend services have CORS enabled for `http://localhost:8085`

### Issue: 401 Unauthorized errors

**Solution:** 
1. Check that you're logged in (JWT token exists in localStorage)
2. Verify token hasn't expired
3. Check that `AuthService.getAuthHeaders()` is being called

### Issue: Workflow endpoints return 404

**Solution:**
1. Verify workflow service is running: `docker ps | Select-String workflow`
2. Check workflow service logs: `docker logs opsmind-workflow`
3. Ensure endpoints match the API specification in workflow service code

## Network Architecture

All services run on the `opsmind-net` Docker bridge network. This allows:
- Internal service-to-service communication
- External access via port mapping
- Isolated network for security

```
┌─────────────────────────────────────────────────────────────┐
│                     opsmind-net (Docker Network)             │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Auth Service │  │Ticket Service│  │Workflow Svc  │     │
│  │   :3002      │  │   :3000→3001 │  │   :3003      │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│         ↑                 ↑                   ↑              │
│         └─────────────────┴───────────────────┘              │
│                           │                                  │
│                  ┌────────┴────────┐                        │
│                  │   Frontend      │                        │
│                  │   :85→8085      │                        │
│                  └─────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
                           ↓
                    User's Browser
              http://localhost:8085
```

## Troubleshooting Checklist

- [ ] All Docker containers are running (`docker ps`)
- [ ] Services show "healthy" status
- [ ] Ports 3001, 3002, 3003, 8085 are not blocked by firewall
- [ ] `config.js` has correct service URLs
- [ ] Browser can access `http://localhost:8085`
- [ ] Test connection page shows all services as "Connected"
- [ ] Browser console shows no errors when loading pages
- [ ] Network tab shows successful API calls (200/404, not network errors)

## Next Steps

Once all services are connected:

1. **Test Login Flow**
   - Go to `http://localhost:8085`
   - Try logging in with test credentials
   - Verify JWT token is stored in localStorage

2. **Test Workflow Dashboards**
   - Login as junior technician
   - Navigate to Junior Dashboard
   - Verify stats load and tickets display
   - Try claiming a ticket

3. **Test Chart Visualizations**
   - Login as supervisor
   - Navigate to Supervisor Dashboard
   - Verify Chart.js charts render correctly
   - Check that analytics data loads

4. **Test Real-time Updates**
   - Keep dashboard open for 60 seconds
   - Verify auto-refresh works
   - Check browser console for refresh logs

## Additional Resources

- **Frontend**: http://localhost:8085
- **Service Test Page**: http://localhost:8085/test-connection.html
- **phpMyAdmin**: http://localhost:8080
- **RabbitMQ Management**: http://localhost:15672
- **Docker Dashboard**: Check Docker Desktop application

---

**Last Updated:** February 17, 2026
