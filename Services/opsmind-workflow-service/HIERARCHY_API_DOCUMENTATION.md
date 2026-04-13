# Hierarchy Management & Dashboard API Documentation

## Overview

This document describes the complete hierarchy management system for technicians, including:
- **Admin APIs** for managing reporting relationships
- **SENIOR Dashboard** for viewing assigned juniors and their tickets
- **SUPERVISOR Dashboard** for viewing team structure and metrics

All hierarchy data is stored in `reporting_relationships` table and is **fully flexible** with **no hardcoded limits**.

---

## Files Changed

### New Files Created

1. **src/controllers/HierarchyController.ts**
   - Admin hierarchy management controller
   - 7 endpoint handlers for CRUD operations

### Modified Files

1. **src/routes/adminRoutes.ts**
   - Added 7 hierarchy management endpoints
   - Added validation middleware

2. **src/middlewares/validation.ts**
   - Added `createRelationshipSchema`
   - Added `deleteRelationshipSchema`
   - Added `listTechniciansSchema`

3. **src/services/DashboardService.ts**
   - Added `getSeniorDashboard(userId)` method
   - Added `getSupervisorDashboard(userId)` method
   - Added helper methods: `groupBy`, `groupByAssigned`

4. **src/controllers/MonitoringController.ts**
   - Added `getSeniorDashboard` handler
   - Added `getSupervisorDashboard` handler

5. **src/routes/workflowRoutes.ts**
   - Added `/dashboard/senior/:userId` route
   - Added `/dashboard/supervisor/:userId` route

6. **src/interfaces/types.ts**
   - Added `SeniorDashboard` interface
   - Added `SupervisorDashboard` interface
   - Added `JuniorSummary` interface
   - Added `TicketSummary` interface
   - Added `WorkloadSummary` interface
   - Added `TeamStructure` interface
   - Added `SeniorTeamMember` interface
   - Added `JuniorTeamMember` interface
   - Added `TeamMetrics` interface

7. **src/config/externalServices.ts**
   - Added `getTicketsByAssignedUsers(userIds)` helper function

---

## Admin Hierarchy Management APIs

All admin endpoints are mounted at `/workflow/admin/hierarchy`

### 1. List Technicians

**Endpoint:** `GET /workflow/admin/hierarchy/technicians`

**Query Parameters:**
- `level` (optional): Filter by level - `JUNIOR`, `SENIOR`, `SUPERVISOR`, `ADMIN`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "user_id": 6,
      "name": "Alice Johnson",
      "email": "alice@example.com",
      "level": "JUNIOR",
      "latitude": 34.0522,
      "longitude": -118.2437,
      "status": "ACTIVE",
      "is_active": true,
      "created_at": "2024-01-15T10:00:00.000Z",
      "updated_at": "2024-01-15T10:00:00.000Z"
    }
  ]
}
```

**Validation Rules:**
- `level` must be one of: `JUNIOR`, `SENIOR`, `SUPERVISOR`, `ADMIN`

---

### 2. Create Reporting Relationship

**Endpoint:** `POST /workflow/admin/hierarchy/relationships`

**Request Body:**
```json
{
  "childUserId": 6,
  "parentUserId": 1,
  "relationshipType": "JUNIOR_TO_SENIOR"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Assigned Alice Johnson (JUNIOR) to Michael Smith (SENIOR)",
  "data": {
    "child": {
      "userId": 6,
      "name": "Alice Johnson",
      "level": "JUNIOR"
    },
    "parent": {
      "userId": 1,
      "name": "Michael Smith",
      "level": "SENIOR"
    },
    "relationshipType": "JUNIOR_TO_SENIOR"
  }
}
```

**Validation Rules:**
- `childUserId` (required): Integer, user must exist
- `parentUserId` (required): Integer, user must exist
- `relationshipType` (required): Must be one of:
  - `JUNIOR_TO_SENIOR` - Junior reports to Senior
  - `SENIOR_TO_SUPERVISOR` - Senior reports to Supervisor
  - `SUPERVISOR_TO_ADMIN` - Supervisor reports to Admin
- Child user level must match relationship type (e.g., JUNIOR for JUNIOR_TO_SENIOR)
- Parent user level must match relationship type (e.g., SENIOR for JUNIOR_TO_SENIOR)

**Error Responses:**
- `404` - Child or parent user not found
- `400` - Invalid relationship type or level mismatch

---

### 3. Update Reporting Relationship

**Endpoint:** `PUT /workflow/admin/hierarchy/relationships`

**Request Body:** (same as POST)
```json
{
  "childUserId": 6,
  "parentUserId": 2,
  "relationshipType": "JUNIOR_TO_SENIOR"
}
```

**Response:** Same as POST

**Notes:**
- Uses `ON DUPLICATE KEY UPDATE` internally
- Will update existing relationship or create new one
- Same validation rules as POST

---

### 4. Delete Reporting Relationship

**Endpoint:** `DELETE /workflow/admin/hierarchy/relationships`

**Request Body:**
```json
{
  "childUserId": 6,
  "parentUserId": 1
}
```

**Response:**
```json
{
  "success": true,
  "message": "Removed relationship: Alice Johnson → Michael Smith"
}
```

**Validation Rules:**
- `childUserId` (required): Integer
- `parentUserId` (required): Integer
- Both users must exist

**Notes:**
- Performs soft delete (sets `is_active = FALSE`)
- Does not actually remove the record from database

---

### 5. Get Hierarchy Tree

**Endpoint:** `GET /workflow/admin/hierarchy/tree`

**Response:**
```json
{
  "success": true,
  "data": {
    "relationships": [
      {
        "id": 1,
        "child_user_id": 6,
        "parent_user_id": 1,
        "relationship_type": "JUNIOR_TO_SENIOR",
        "is_active": true,
        "created_at": "2024-01-15T10:00:00.000Z",
        "updated_at": "2024-01-15T10:00:00.000Z"
      }
    ],
    "technicians": [
      {
        "id": 1,
        "user_id": 1,
        "name": "Michael Smith",
        "level": "SENIOR",
        ...
      }
    ]
  }
}
```

**Notes:**
- Returns all active relationships
- Includes technician details for all users in relationships
- Useful for building org chart visualization

---

### 6. Get Direct Reports

**Endpoint:** `GET /workflow/admin/hierarchy/user/:userId/reports`

**Response:**
```json
{
  "success": true,
  "data": {
    "userId": 1,
    "userName": "Michael Smith",
    "level": "SENIOR",
    "directReports": [
      {
        "id": 1,
        "user_id": 6,
        "name": "Alice Johnson",
        "level": "JUNIOR",
        ...
      }
    ]
  }
}
```

**Error Responses:**
- `404` - User not found

---

### 7. Get Manager

**Endpoint:** `GET /workflow/admin/hierarchy/user/:userId/manager`

**Response:**
```json
{
  "success": true,
  "data": {
    "userId": 6,
    "userName": "Alice Johnson",
    "level": "JUNIOR",
    "manager": {
      "id": 1,
      "user_id": 1,
      "name": "Michael Smith",
      "level": "SENIOR",
      ...
    }
  }
}
```

**Notes:**
- `manager` will be `null` if user has no manager assigned

---

## SENIOR Dashboard API

### Get Senior Dashboard

**Endpoint:** `GET /workflow/dashboard/senior/:userId`

**Description:** Returns all juniors assigned to this senior and their tickets

**Response Shape:**
```json
{
  "success": true,
  "data": {
    "seniorUserId": 1,
    "seniorName": "Michael Smith",
    "juniors": [
      {
        "userId": 6,
        "name": "Alice Johnson",
        "email": "alice@example.com",
        "status": "ACTIVE",
        "location": {
          "latitude": 34.0522,
          "longitude": -118.2437
        },
        "assignedTickets": 5
      }
    ],
    "tickets": [
      {
        "ticketId": "T-1001",
        "assignedTo": 6,
        "assignedToName": "Alice Johnson",
        "status": "IN_PROGRESS",
        "priority": "HIGH",
        "building": "Building A",
        "floor": 3,
        "createdAt": "2024-04-12T10:00:00.000Z"
      }
    ],
    "workload": {
      "totalTickets": 15,
      "byStatus": {
        "OPEN": 5,
        "IN_PROGRESS": 8,
        "COMPLETED": 2
      },
      "byPriority": {
        "CRITICAL": 1,
        "HIGH": 4,
        "MEDIUM": 7,
        "LOW": 3
      },
      "byJunior": {
        "6": 5,
        "7": 4,
        "8": 6
      }
    }
  }
}
```

**Validation Rules:**
- User with `userId` must exist
- User must have level = `SENIOR`
- Only shows juniors explicitly assigned via `reporting_relationships`
- No hardcoded team size limit

**Error Responses:**
- `404` - Senior user not found
- `400` - User is not a SENIOR

---

## SUPERVISOR Dashboard API

### Get Supervisor Dashboard

**Endpoint:** `GET /workflow/dashboard/supervisor/:userId`

**Description:** Returns team structure (seniors + their juniors) and all tickets

**Response Shape:**
```json
{
  "success": true,
  "data": {
    "supervisorUserId": 100,
    "supervisorName": "Robert Johnson",
    "teamStructure": {
      "seniors": [
        {
          "userId": 1,
          "name": "Michael Smith",
          "email": "michael@example.com",
          "status": "ACTIVE",
          "juniorCount": 8,
          "assignedTickets": 25
        }
      ],
      "juniors": [
        {
          "userId": 6,
          "name": "Alice Johnson",
          "email": "alice@example.com",
          "status": "ACTIVE",
          "seniorUserId": 1,
          "seniorName": "Michael Smith",
          "assignedTickets": 5
        }
      ]
    },
    "tickets": [
      {
        "ticketId": "T-1001",
        "assignedTo": 6,
        "assignedToName": "Alice Johnson",
        "status": "IN_PROGRESS",
        "priority": "HIGH",
        "building": "Building A",
        "floor": 3,
        "createdAt": "2024-04-12T10:00:00.000Z"
      }
    ],
    "workload": {
      "totalTickets": 75,
      "byStatus": {
        "OPEN": 15,
        "IN_PROGRESS": 45,
        "COMPLETED": 15
      },
      "byPriority": {
        "CRITICAL": 3,
        "HIGH": 12,
        "MEDIUM": 35,
        "LOW": 25
      },
      "byJunior": {
        "6": 5,
        "7": 4,
        "8": 6
      }
    },
    "metrics": {
      "totalTechnicians": 49,
      "totalSeniors": 5,
      "totalJuniors": 44,
      "averageTicketsPerJunior": 1.7,
      "averageJuniorsPerSenior": 8.8
    }
  }
}
```

**Validation Rules:**
- User with `userId` must exist
- User must have level = `SUPERVISOR`
- Shows all seniors assigned to this supervisor
- Shows all juniors under those seniors (hierarchical)
- No hardcoded team size limits

**Error Responses:**
- `404` - Supervisor user not found
- `400` - User is not a SUPERVISOR

---

## Assignment Logic

**IMPORTANT:** The ticket assignment logic in `AssignmentService.ts` is **completely unchanged**. It still uses:

1. Distance-based scoring
2. Workload-based scoring
3. Best junior technician selection

The hierarchy system is **only for visibility and dashboard purposes**, not for routing or assignment decisions.

---

## Testing Examples

### Admin: Assign Junior to Senior

```bash
curl -X POST http://localhost:3003/workflow/admin/hierarchy/relationships \
  -H "Content-Type: application/json" \
  -d '{
    "childUserId": 6,
    "parentUserId": 1,
    "relationshipType": "JUNIOR_TO_SENIOR"
  }'
```

### Admin: List All Juniors

```bash
curl http://localhost:3003/workflow/admin/hierarchy/technicians?level=JUNIOR
```

### Admin: Get Hierarchy Tree

```bash
curl http://localhost:3003/workflow/admin/hierarchy/tree
```

### Senior: Get Dashboard

```bash
curl http://localhost:3003/workflow/dashboard/senior/1
```

### Supervisor: Get Dashboard

```bash
curl http://localhost:3003/workflow/dashboard/supervisor/100
```

---

## Database Schema

The hierarchy uses the `reporting_relationships` table:

```sql
CREATE TABLE reporting_relationships (
  id INT AUTO_INCREMENT PRIMARY KEY,
  child_user_id INT NOT NULL,
  parent_user_id INT NOT NULL,
  relationship_type ENUM('JUNIOR_TO_SENIOR', 'SENIOR_TO_SUPERVISOR', 'SUPERVISOR_TO_ADMIN') NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_relationship (child_user_id, parent_user_id)
);
```

**Key Features:**
- No foreign key constraints (flexible)
- Soft delete via `is_active` flag
- UNIQUE constraint prevents duplicate relationships
- `ON DUPLICATE KEY UPDATE` allows updates via POST

---

## Frontend Integration

### Admin Panel - Hierarchy Management

```javascript
// List all juniors
const response = await fetch('/workflow/admin/hierarchy/technicians?level=JUNIOR');
const { data: juniors } = await response.json();

// Assign junior to senior
await fetch('/workflow/admin/hierarchy/relationships', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    childUserId: 6,
    parentUserId: 1,
    relationshipType: 'JUNIOR_TO_SENIOR'
  })
});

// Get hierarchy tree for visualization
const treeResponse = await fetch('/workflow/admin/hierarchy/tree');
const { data: { relationships, technicians } } = await treeResponse.json();
```

### Senior Dashboard

```javascript
// Get senior's dashboard (userId from auth service)
const response = await fetch(`/workflow/dashboard/senior/${currentUser.id}`);
const { data: dashboard } = await response.json();

console.log(`Team size: ${dashboard.juniors.length}`);
console.log(`Total tickets: ${dashboard.workload.totalTickets}`);
```

### Supervisor Dashboard

```javascript
// Get supervisor's dashboard
const response = await fetch(`/workflow/dashboard/supervisor/${currentUser.id}`);
const { data: dashboard } = await response.json();

console.log(`Seniors: ${dashboard.metrics.totalSeniors}`);
console.log(`Juniors: ${dashboard.metrics.totalJuniors}`);
console.log(`Avg tickets per junior: ${dashboard.metrics.averageTicketsPerJunior}`);
```

---

## Summary

### Flexibility
- ✅ No hardcoded team size limits
- ✅ Fully admin-managed relationships
- ✅ Soft deletes allow historical tracking
- ✅ No foreign key constraints for flexibility

### Assignment Logic
- ✅ Unchanged - still uses distance + workload scoring
- ✅ Hierarchy does NOT affect routing decisions
- ✅ Assignment logic remains in AssignmentService.ts

### Dashboard Visibility
- ✅ SENIOR sees only their assigned juniors
- ✅ SUPERVISOR sees their seniors + all juniors under them
- ✅ Real-time ticket data from ticket-service
- ✅ Comprehensive workload metrics

### API Design
- ✅ RESTful endpoints
- ✅ Joi validation on all inputs
- ✅ Consistent error responses
- ✅ Type-safe TypeScript implementation
