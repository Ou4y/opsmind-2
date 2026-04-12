# Hierarchy-Based Dashboards - Quick Reference

## Overview
This document provides a quick reference for the newly implemented hierarchy-based dashboards for Senior and Supervisor roles.

---

## Senior Dashboard

### Purpose
Allows a senior technician to manage their assigned junior technicians and oversee their team's tickets.

### API Endpoint
```
GET /api/workflow/dashboard/senior/:userId
```

### UI Sections
1. **Summary Cards (4)**
   - Juniors Count
   - Total Tickets
   - In Progress Tickets
   - Resolved Tickets

2. **Workload Distribution (3 charts)**
   - By Status (OPEN, IN_PROGRESS, RESOLVED, CLOSED)
   - By Priority (CRITICAL, HIGH, MEDIUM, LOW)
   - By Junior (top 5 juniors by ticket count)

3. **My Team (Junior Cards Grid)**
   - Avatar with initial
   - Name and email
   - Ticket count badge
   - Status indicator (color-coded)

4. **Team Tickets (Table)**
   - Ticket ID (truncated, clickable)
   - Assigned To
   - Status badge
   - Priority badge
   - Created date
   - Location (coordinates + Maps link)

### Files
- HTML: `opsmind_frontend/senior-dashboard.html`
- JS: `opsmind_frontend/assets/js/pages/senior-dashboard.js`
- Backup: `senior-dashboard-old.html`, `senior-dashboard-old.js`
- Docs: `SENIOR_DASHBOARD_IMPLEMENTATION.md`

### Key Features
✅ Displays juniors assigned to the senior
✅ Shows tickets for those juniors
✅ Visual workload breakdown
✅ Location coordinates (no building/floor)
✅ Auto-refresh every 60 seconds
✅ Loading/error/empty states

---

## Supervisor Dashboard

### Purpose
Allows a supervisor to oversee their entire team hierarchy: all seniors, all juniors under those seniors, and all team tickets.

### API Endpoint
```
GET /api/workflow/dashboard/supervisor/:userId
```

### UI Sections
1. **Team Overview Cards (4)**
   - Total Seniors
   - Total Juniors
   - Total Tickets
   - Average Tickets per Junior

2. **Workload Distribution (2 charts)**
   - By Status (OPEN, IN_PROGRESS, RESOLVED, CLOSED)
   - By Priority (CRITICAL, HIGH, MEDIUM, LOW)

3. **Senior Technicians (Table)**
   - Name
   - Email
   - Status (Light Load / Moderate / Heavy Load)
   - Junior Count
   - Ticket Count

4. **Junior Technicians (Table)**
   - Name
   - Reporting To (Senior)
   - Status (Available / Active / Overloaded)
   - Tickets Assigned

5. **Team Tickets (Table)**
   - Ticket ID (truncated, clickable)
   - Title (truncated)
   - Assigned Junior
   - Senior Owner
   - Status badge
   - Priority badge
   - Created date
   - Location (Open in Maps button)

### Files
- HTML: `opsmind_frontend/supervisor-dashboard.html`
- JS: `opsmind_frontend/assets/js/pages/supervisor-dashboard.js`
- Backup: `supervisor-dashboard-old.html`, `supervisor-dashboard-old.js`
- Docs: `SUPERVISOR_DASHBOARD_IMPLEMENTATION.md`

### Key Features
✅ Displays ALL seniors under the supervisor
✅ Displays ALL juniors under those seniors
✅ Shows full team hierarchy relationships
✅ Shows tickets for entire scope
✅ Workload-based status indicators
✅ Team metrics (avg tickets per junior)
✅ Location with Maps integration (no building/floor)
✅ Auto-refresh every 60 seconds
✅ Loading/error/empty states

---

## Key Differences

| Feature | Senior Dashboard | Supervisor Dashboard |
|---------|------------------|---------------------|
| **Scope** | Single senior's team | All seniors + their juniors |
| **Juniors Display** | Card grid | Table with senior names |
| **Seniors Display** | N/A | Table with metrics |
| **Hierarchy View** | Flat (just juniors) | Two-level (seniors → juniors) |
| **Metrics** | Team workload | Organization-level metrics |
| **Status Indicators** | Junior workload | Senior AND junior workload |
| **Tickets View** | Team tickets | Full scope tickets |
| **Average Calculation** | N/A | Avg tickets per junior |

---

## Common Features

### Both Dashboards Include:
✅ Modern card-based design
✅ Hierarchy-based API integration
✅ Location coordinates (NO building/floor)
✅ Google Maps integration
✅ Loading/error/empty states
✅ Auto-refresh (60 seconds)
✅ Responsive design
✅ Color-coded badges
✅ Workload distribution charts
✅ Proper error handling

---

## API Response Structures

### Senior Dashboard Response
```json
{
  "success": true,
  "data": {
    "juniors": [
      {
        "userId": 123,
        "name": "John Doe",
        "email": "john@example.com",
        "assignedTicketsCount": 5
      }
    ],
    "tickets": [
      {
        "ticketId": "uuid",
        "assignedTo": "John Doe",
        "status": "IN_PROGRESS",
        "priority": "HIGH",
        "createdAt": "2026-04-13T10:30:00Z",
        "location": {
          "latitude": 30.0444,
          "longitude": 31.2357
        }
      }
    ],
    "workload": {
      "byStatus": { "OPEN": 10, "IN_PROGRESS": 5, "RESOLVED": 15, "CLOSED": 20 },
      "byPriority": { "CRITICAL": 2, "HIGH": 8, "MEDIUM": 15, "LOW": 25 },
      "byJunior": [
        { "juniorId": 123, "name": "John Doe", "count": 5 }
      ]
    }
  }
}
```

### Supervisor Dashboard Response
```json
{
  "success": true,
  "data": {
    "teamStructure": {
      "seniors": [
        {
          "userId": 456,
          "name": "Alice Senior",
          "email": "alice@example.com",
          "juniorCount": 3,
          "assignedTicketsCount": 12
        }
      ],
      "juniors": [
        {
          "userId": 123,
          "name": "Bob Junior",
          "email": "bob@example.com",
          "seniorId": 456,
          "seniorName": "Alice Senior",
          "assignedTicketsCount": 4
        }
      ]
    },
    "tickets": [
      {
        "ticketId": "uuid",
        "title": "Network issue",
        "assignedTo": "Bob Junior",
        "seniorName": "Alice Senior",
        "status": "IN_PROGRESS",
        "priority": "HIGH",
        "createdAt": "2026-04-13T10:30:00Z",
        "location": {
          "latitude": 30.0444,
          "longitude": 31.2357
        }
      }
    ],
    "workload": {
      "byStatus": { "OPEN": 15, "IN_PROGRESS": 8, "RESOLVED": 20, "CLOSED": 30 },
      "byPriority": { "CRITICAL": 3, "HIGH": 12, "MEDIUM": 20, "LOW": 38 }
    }
  }
}
```

---

## Status Badge Logic

### Senior Dashboard
Junior status based on ticket count:
- ✅ **0-2 tickets**: Success badge (green) - "Available"
- ⚠️ **3-5 tickets**: Warning badge (yellow) - "Active"
- 🔴 **>5 tickets**: Danger badge (red) - "Overloaded"

### Supervisor Dashboard

**Senior Workload Status:**
- ✅ **≤5 tickets**: Success badge (green) - "Light Load"
- ⚠️ **6-10 tickets**: Warning badge (yellow) - "Moderate"
- 🔴 **>10 tickets**: Danger badge (red) - "Heavy Load"

**Junior Capacity Status:**
- ✅ **≤2 tickets**: Success badge (green) - "Available"
- ⚠️ **3-5 tickets**: Warning badge (yellow) - "Active"
- 🔴 **>5 tickets**: Danger badge (red) - "Overloaded"

---

## Frontend API Methods Used

Both dashboards use methods from `workflowService.js`:

```javascript
// Import
import { getSeniorDashboard, getSupervisorDashboard } from '/services/workflowService.js';

// Usage
const response = await getSeniorDashboard(userId);
const response = await getSupervisorDashboard(userId);

// Both return:
// { success: true/false, data: {...}, message: "..." }
```

---

## CSS Classes Added

New classes in `main.css`:

```css
/* Avatar circles */
.avatar-circle { ... }

/* Empty states */
.empty-state { ... }

/* Workload bars */
.workload-bars { ... }
.workload-bar-item { ... }

/* Icon badges */
.icon-badge { ... }

/* Summary cards */
.summary-card { ... }

/* Purple badge for IN_PROGRESS */
.bg-purple { ... }

/* Orange badge for HIGH priority */
.bg-orange { ... }

/* Card hover effects */
.card.h-100:hover { ... }

/* Table scrollbar styling */
.table-responsive::-webkit-scrollbar { ... }
```

---

## Testing Both Dashboards

### Test as Senior:
1. Login as senior user
2. Navigate to `/senior-dashboard.html`
3. Verify juniors list shows your team
4. Verify tickets show assignments
5. Verify workload charts display
6. Verify location shows coordinates (no building/floor)

### Test as Supervisor:
1. Login as supervisor user
2. Navigate to `/supervisor-dashboard.html`
3. Verify seniors table shows all seniors
4. Verify juniors table shows all juniors with senior names
5. Verify tickets show full team scope
6. Verify metrics calculate correctly
7. Verify location shows "Open in Maps" button

---

## Migration Notes

### From Old to New:
- ✅ Building/floor fields removed completely
- ✅ Location coordinates added with Maps integration
- ✅ Tab-based layouts replaced with linear card design
- ✅ Group-based APIs replaced with hierarchy-based APIs
- ✅ Loading/error states improved
- ✅ Responsive design enhanced
- ✅ Auto-refresh implemented

### Backward Compatibility:
- Old HTML/JS files backed up as `-old.html` and `-old.js`
- Original files can be restored if needed
- Backend APIs support both old and new formats

---

## Related Documentation

- `HIERARCHY_API_USAGE_EXAMPLES.md` - API usage examples
- `HIERARCHY_API_IMPLEMENTATION_SUMMARY.md` - API implementation details
- `SENIOR_DASHBOARD_IMPLEMENTATION.md` - Senior dashboard details
- `SUPERVISOR_DASHBOARD_IMPLEMENTATION.md` - Supervisor dashboard details

---

**Last Updated:** April 13, 2026  
**Status:** ✅ Production Ready  
**Version:** 2.0 (Hierarchy-Based)
