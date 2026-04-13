# Technician Hierarchy Implementation

## Overview

This implementation adds a flexible, admin-managed hierarchy system to the workflow service while keeping the existing score-based assignment logic intact for JUNIOR technicians.

## Database Changes

### 1. Updated `technicians` Table

**New/Modified Columns:**
- `user_id` (INT, NOT NULL, UNIQUE) - Links to auth service user ID
- `email` (VARCHAR(255), NULL) - Technician email from auth service
- `level` (ENUM) - Extended to include 'ADMIN': `['JUNIOR', 'SENIOR', 'SUPERVISOR', 'ADMIN']`
- `is_active` (BOOLEAN, DEFAULT TRUE) - Soft delete / active status flag

**Full Schema:**
```sql
CREATE TABLE technicians (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NULL,
  level ENUM('JUNIOR', 'SENIOR', 'SUPERVISOR', 'ADMIN') NOT NULL DEFAULT 'JUNIOR',
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  status ENUM('ACTIVE', 'OFFLINE', 'INACTIVE', 'ON_LEAVE') DEFAULT 'ACTIVE',
  is_active BOOLEAN DEFAULT TRUE,
  last_location_update TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_level (level),
  INDEX idx_status (status),
  INDEX idx_is_active (is_active)
);
```

### 2. New `reporting_relationships` Table

**Purpose:** Defines flexible, admin-managed technician hierarchy with no hardcoded limits.

**Schema:**
```sql
CREATE TABLE reporting_relationships (
  id INT AUTO_INCREMENT PRIMARY KEY,
  child_user_id INT NOT NULL,
  parent_user_id INT NOT NULL,
  relationship_type ENUM('JUNIOR_TO_SENIOR', 'SENIOR_TO_SUPERVISOR', 'SUPERVISOR_TO_ADMIN') NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_child_parent (child_user_id, parent_user_id),
  INDEX idx_child_user (child_user_id),
  INDEX idx_parent_user (parent_user_id),
  INDEX idx_relationship_type (relationship_type),
  INDEX idx_is_active (is_active),
  CHECK (child_user_id != parent_user_id)
);
```

## Hierarchy Structure

### Example (from seed data):

```
ADMIN (user_id: 101)
  └── SUPERVISOR (user_id: 100)
        ├── Senior M (user_id: 1) — manages 8 juniors (6-13)
        ├── Senior N (user_id: 2) — manages 8 juniors (14-21)
        ├── Senior S (user_id: 3) — manages 8 juniors (22-29)
        ├── Senior R (user_id: 4) — manages 10 juniors (30-39)
        └── Senior Pharmacy (user_id: 5) — manages 10 juniors (40-49)
```

**Key Points:**
- ✅ No hardcoded limit on juniors per senior
- ✅ No hardcoded limit on seniors per supervisor
- ✅ Fully flexible - admins can modify relationships freely
- ✅ Multiple supervisors supported
- ✅ Multiple admins supported

## Assignment Logic (UNCHANGED)

**Current Behavior:**
- Tickets are assigned to the **best-scoring JUNIOR** technician
- Scoring is based on:
  - Distance from ticket location
  - Current workload
  - Priority-based weighting
- **No hierarchy consideration in initial assignment**

**Why Hierarchy Doesn't Affect Assignment:**
- The assignment algorithm in `AssignmentService.ts` queries all ACTIVE JUNIOR technicians
- Scoring and selection happen independently of reporting relationships
- Hierarchy is used **only** for:
  - Visibility (seniors see their juniors' tickets)
  - Escalation paths
  - Notification routing
  - Dashboard filtering

## Code Changes

### New Files:

1. **`db/migrations/001_add_technician_hierarchy.sql`**
   - Migration script to add new columns and table

2. **`db/seed_with_hierarchy.sql`**
   - Updated seed data with 51 technicians + hierarchy relationships

3. **`src/repositories/ReportingRelationshipRepository.ts`**
   - Repository for managing reporting relationships
   - Methods: `getDirectReports()`, `getManager()`, `getJuniorsForSenior()`, etc.

### Modified Files:

1. **`db/init.sql`**
   - Updated technicians table definition
   - Added reporting_relationships table

2. **`src/interfaces/types.ts`**
   - Updated `TechnicianRow` interface with new fields
   - Updated `GroupMemberRow` to include 'ADMIN' role
   - Added `ReportingRelationshipRow` interface

3. **`src/repositories/TechnicianRepository.ts`**
   - Updated queries to include new fields
   - Added `getByUserId()`, `getByLevel()`, `getByUserIds()` methods
   - Added `is_active` filter to all queries

## Migration Instructions

### Option 1: Fresh Database (Recommended for Development)

```bash
# Drop and recreate database
docker compose down -v
docker compose up -d

# Run init.sql and seed_with_hierarchy.sql
mysql -h localhost -P 3306 -u opsmind -popsmind workflow_db < db/init.sql
mysql -h localhost -P 3306 -u opsmind -popsmind workflow_db < db/seed_with_hierarchy.sql
```

### Option 2: Migrate Existing Database

```bash
# Run migration script
mysql -h localhost -P 3306 -u opsmind -popsmind workflow_db < db/migrations/001_add_technician_hierarchy.sql

# Update existing data
UPDATE technicians SET user_id = id WHERE user_id IS NULL;
UPDATE technicians SET is_active = TRUE WHERE is_active IS NULL;

# Optionally load hierarchy relationships
mysql -h localhost -P 3306 -u opsmind -popsmind workflow_db < db/seed_with_hierarchy.sql
```

## Example Queries

### Get all juniors for a specific senior:
```sql
SELECT t.*
FROM technicians t
JOIN reporting_relationships rr ON t.user_id = rr.child_user_id
WHERE rr.parent_user_id = 1  -- Senior M
  AND rr.relationship_type = 'JUNIOR_TO_SENIOR'
  AND rr.is_active = TRUE
  AND t.is_active = TRUE;
```

### Get a technician's manager:
```sql
SELECT t.*
FROM technicians t
JOIN reporting_relationships rr ON t.user_id = rr.parent_user_id
WHERE rr.child_user_id = 6  -- Junior technician
  AND rr.is_active = TRUE
  AND t.is_active = TRUE;
```

### Get full hierarchy chain:
```typescript
const hierarchyRepo = new ReportingRelationshipRepository();
const chain = await hierarchyRepo.getHierarchyChain(6);
// Returns: [1, 100, 101] (Senior → Supervisor → Admin)
```

## Admin Management (Future)

The hierarchy is designed to be fully admin-managed via API endpoints:

**Planned Endpoints:**
- `POST /admin/hierarchy/relationships` - Create reporting relationship
- `DELETE /admin/hierarchy/relationships/:id` - Remove relationship
- `GET /admin/hierarchy/tree` - Get full hierarchy tree
- `GET /admin/hierarchy/user/:userId/reports` - Get direct reports
- `GET /admin/hierarchy/user/:userId/manager` - Get manager

**Business Rules:**
- No hardcoded limits enforced by code
- Admins can assign any number of juniors to a senior
- Admins can reassign relationships freely
- Soft deletes (`is_active`) preserve history

## Testing

### Verify Migration:
```sql
-- Check technicians table structure
DESCRIBE technicians;

-- Check reporting_relationships table
DESCRIBE reporting_relationships;

-- Count relationships by type
SELECT relationship_type, COUNT(*) as count
FROM reporting_relationships
WHERE is_active = TRUE
GROUP BY relationship_type;
```

### Expected Results:
- 1 SUPERVISOR_TO_ADMIN relationship
- 5 SENIOR_TO_SUPERVISOR relationships
- 44 JUNIOR_TO_SENIOR relationships

## Notes

- ✅ Assignment logic remains unchanged (scoring-based for juniors)
- ✅ No building/floor routing reintroduced
- ✅ Hierarchy is purely for visibility and management
- ✅ Fully flexible - no hardcoded limits
- ✅ Admin-managed via database or future API endpoints
- ✅ Backward compatible with existing assignment service
