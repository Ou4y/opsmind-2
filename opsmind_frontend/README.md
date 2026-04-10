# OpsMind Frontend

A modern, responsive IT Service Management (ITSM) frontend built with HTML5, CSS3, Bootstrap 5, and Vanilla JavaScript with integrated workflow management for multi-role ticket processing.

## Features

- **Login Page** - Secure authentication with email/password
- **Dashboard** - Overview with stats, charts, activity feed, priority tickets
- **Tickets** - Full ticket management with filters, search, and AI recommendations
- **Workflows** - Workflow management and execution history
- **Role-Based Workflow Dashboards**:
  - **Junior Technician Dashboard** - Claim tickets, update status, escalate issues
  - **Senior Technician Dashboard** - Team management, reassignment, resolution approval
  - **Supervisor Dashboard** - Building-level analytics, SLA monitoring, team performance

## Quick Start

### Running the Application

1. Start a local HTTP server in this directory:

```bash
# Using Python 3
python3 -m http.server 8080

# Using Node.js (if http-server is installed)
npx http-server -p 8080

# Using PHP
php -S localhost:8080
```

2. Open http://localhost:8080 in your browser

### Demo Credentials

The application includes a mock API for demo purposes. Use these credentials to log in:

| Email | Password | Role | Access |
|-------|----------|------|--------|
| junior@opsmind.io | junior123 | JUNIOR | Junior Technician Dashboard |
| senior@opsmind.io | senior123 | SENIOR | Junior + Senior Dashboards |
| supervisor@opsmind.io | super123 | SUPERVISOR | All Dashboards + Analytics |
| admin@opsmind.io | admin123 | ADMIN | Full System Access |

### Role-Based Access Control

The frontend automatically shows/hides navigation items based on user role:

- **JUNIOR**: Can access Junior Technician Dashboard only
- **SENIOR**: Can access Junior and Senior Technician Dashboards
- **SUPERVISOR**: Can access all three workflow dashboards
- **ADMIN**: Full access to all features

Role-based visibility is handled by `data-roles` attributes in [components/sidebar.html](components/sidebar.html) and processed by [assets/js/app.js](assets/js/app.js).

## Project Structure

```
opsmind_frontend/
├── index.html              # Login page
├── dashboard.html          # Dashboard overview
├── tickets.html            # Ticket management
├── workflows.html          # Workflow management
├── junior-dashboard.html   # Junior Technician workflow dashboard
├── senior-dashboard.html   # Senior Technician workflow dashboard
├── supervisor-dashboard.html # Supervisor workflow dashboard
├── assets/
│   ├── css/
│   │   └── main.css        # All custom styles including workflow components
│   └── js/
│       ├── app.js          # Main application controller with role-based visibility
│       ├── auth.js         # Login page script
│       ├── config.js       # Runtime configuration (API URLs)
│       ├── router.js       # Client-side routing
│       ├── ui.js           # UI utilities (toasts, modals, etc.)
│       └── pages/
│           ├── dashboard.js
│           ├── tickets.js
│           ├── workflows.js
│           ├── junior-dashboard.js    # Junior tech workflow logic
│           ├── senior-dashboard.js    # Senior tech workflow logic
│           └── supervisor-dashboard.js # Supervisor analytics logic
├── components/
│   ├── navbar.html         # Top navigation bar
│   ├── sidebar.html        # Left sidebar navigation with role-based menu
│   └── modal.html          # Modal templates
└── services/
    ├── authService.js      # Authentication API
    ├── ticketService.js    # Ticket API
    ├── workflowService.js  # Workflow API (extended with ticket routing)
    ├── aiService.js        # AI recommendations API
    ├── userService.js      # User management API
    └── geminiService.js    # Gemini AI integration
```

## Tech Stack

- **HTML5** - Semantic, accessible markup
- **CSS3** - Custom properties, Flexbox, Grid
- **Bootstrap 5** - Responsive framework
- **Bootstrap Icons** - Icon library
- **Vanilla JavaScript (ES6+)** - No frameworks, ES modules

## Features by Page

### Login (`index.html`)
- Email/password authentication
- Password visibility toggle
- Remember me option
- Form validation with error messages
- Loading state during authentication

### Dashboard (`dashboard.html`)
- Statistics cards (Open Tickets, Avg Response Time, etc.)
- Ticket trend chart (weekly)
- Category distribution chart
- Recent activity feed
- Priority tickets list
- Active workflows status

### Tickets (`tickets.html`)
- Ticket list with table/card view toggle
- Filter by status, priority, category, date range
- Search by ticket ID or subject
- Pagination
- Create new ticket modal
- Ticket detail view with AI recommendations
- Trigger workflow from ticket

### Workflows (`workflows.html`)
- Workflow list with status toggles
- Execution history tab
- Workflow detail modal with step visualization
- Execution detail with step status
- Create new workflow modal

### Junior Technician Dashboard (`junior-dashboard.html`)
- **My Tickets Tab**: View and update assigned tickets with SLA indicators
- **Available Tickets Tab**: Claim unassigned tickets from support group
- **Ticket Details Tab**: View complete workflow timeline, update status, add notes
- **Actions**: Claim tickets, update status (OPEN → IN_PROGRESS → RESOLVED), escalate to senior
- Real-time updates every 30 seconds

### Senior Technician Dashboard (`senior-dashboard.html`)
- **Team Overview**: View all team tickets with workload distribution visualization
- **Escalated Tickets**: Handle escalations from junior technicians with context
- **Pending Review**: Approve or reject resolutions before ticket closure
- **Actions**: Reassign tickets to balance workload, approve/reject resolutions, escalate critical issues
- Team performance metrics and member activity tracking

### Supervisor Dashboard (`supervisor-dashboard.html`)
- **Building Overview**: Multi-floor ticket analytics with Chart.js visualizations
- **SLA Monitoring**: Real-time compliance tracking with breach alerts
- **Team Performance**: Technician metrics including avg resolution time, ticket counts, efficiency
- **Workflow Analytics**: 
  - Ticket trend line chart (weekly/monthly)
  - Priority distribution doughnut chart
  - Status distribution doughnut chart
  - Resolution time bar chart by priority
  - Floor-based ticket breakdown table
- **Support Group Management**: Create/edit support groups and assign members
- **Audit Log**: Searchable workflow action history with filters
- Auto-refresh every 60 seconds for live monitoring

## Connecting to the Backend

OpsMind uses a microservices architecture with the following services:

### Service Configuration

Update [assets/js/config.js](assets/js/config.js) with your service URLs:

```javascript
window.OPSMIND_API_URL = 'http://localhost:3000';        // Auth Service
window.OPSMIND_TICKET_URL = 'http://localhost:3001';     // Ticket Service
window.OPSMIND_WORKFLOW_URL = 'http://localhost:3002';   // Workflow Service
```

### Required Backend Services

1. **Auth Service (Port 3000)**
   - POST `/api/auth/login` - User authentication
   - POST `/api/auth/register` - User registration
   - GET `/api/auth/me` - Get current user
   - JWT token-based authentication

2. **Ticket Service (Port 3001)**
   - GET `/api/tickets` - List tickets with filters
   - POST `/api/tickets` - Create new ticket
   - GET `/api/tickets/:id` - Get ticket details
   - PATCH `/api/tickets/:id` - Update ticket
   - DELETE `/api/tickets/:id` - Delete ticket

3. **Workflow Service (Port 3002)**
   - POST `/api/workflow/route` - Route ticket to support group
   - POST `/api/workflow/:ticketId/claim` - Claim ticket
   - POST `/api/workflow/:ticketId/reassign` - Reassign ticket
   - POST `/api/workflow/:ticketId/escalate` - Escalate ticket
   - GET `/api/workflow/:ticketId/logs` - Get workflow logs
   - GET `/api/workflow/my-tickets/:technicianId` - Get technician's tickets
   - GET `/api/workflow/group/:groupId/tickets` - Get group tickets
   - GET `/api/workflow/sla/status` - Get SLA status for tickets
   - GET `/api/workflow/group/:groupId/members` - Get support group members
   - GET `/api/workflow/metrics` - Get workflow metrics
   - GET `/api/workflow/sla/report` - Get SLA compliance report

### Docker Setup

The backend services should be running on Docker network `opsmind-net`:

```bash
docker-compose up -d
```

### Database Schema

The Workflow Service requires MySQL with the following tables:
- `support_groups` - Support group definitions with building/floor hierarchy
- `group_members` - Technician assignments to support groups
- `ticket_routing_state` - Current ticket assignment state
- `workflow_logs` - Audit trail of all workflow actions
- `escalation_rules` - Escalation policies and thresholds
- `sla_tracking` - SLA violation monitoring

See the workflow service repository for complete database schema.

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## License

© 2026 OpsMind. All rights reserved.
