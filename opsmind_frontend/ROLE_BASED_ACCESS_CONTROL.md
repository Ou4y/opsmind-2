# Role-Based Access Control (RBAC) Implementation

## Overview
This document describes the role-based access control implementation in the OpsMind ITSM frontend. The implementation uses **conditional rendering** and **role guards** to control UI visibility and page access based on user roles.

## Role Hierarchy
```
ADMIN (Full System Access)
    └── SUPERVISOR (Building-wide oversight)
        └── SENIOR (Building Manager, L2+ Technician)
            └── TECHNICIAN/JUNIOR (L1 Technician)
                └── DOCTOR (Healthcare provider, ticket submitter)
                └── STUDENT (Campus user, ticket submitter)
```

## Implementation Approach
- ✅ **NO refactoring or restructuring** - All changes are surgical additions
- ✅ **Conditional rendering** - UI elements shown/hidden based on role checks
- ✅ **Router guards** - Page access controlled at navigation level
- ✅ **Permission-based visibility** - Action buttons restricted by role
- ✅ **Data filtering** - Technicians see building-specific tickets only

---

## Modified Files

### 1. services/authService.js
**Purpose**: Core authentication service extended with role-checking methods

**New Methods Added** (Lines 370-441):
```javascript
isTechnician()           // Returns true for TECHNICIAN or JUNIOR role
isSenior()              // Returns true for SENIOR role
isSupervisor()          // Returns true for SUPERVISOR role
hasRole(role)           // Generic role check for any role string
hasAnyRole(roles[])     // Check if user has any of the provided roles
getTechnicianLevel()    // Returns technician level: L1, L2, L3
getUserBuilding()       // Returns user's assigned building ID
getUserSupportGroup()   // Returns user's support group ID
```

**Usage Pattern**:
```javascript
if (AuthService.isTechnician()) {
    // Show technician-specific UI
}

if (AuthService.hasAnyRole(['SENIOR', 'SUPERVISOR', 'ADMIN'])) {
    // Show management features
}
```

---

### 2. assets/js/router.js
**Purpose**: Client-side routing with hierarchical role-based page guards

**Role-Based Page Arrays** (Lines 14-48):
```javascript
studentDoctorPages: ['dashboard.html']
technicianPages: ['junior-dashboard.html', 'tickets.html']
seniorPages: ['senior-dashboard.html', 'workflows.html']
supervisorPages: ['supervisor-dashboard.html', 'ai-insights.html']
```

**Access Control Logic** (`checkRoleAccess()` method, Lines 86-122):
| Role | Pages Allowed |
|------|---------------|
| STUDENT/DOCTOR | dashboard.html only |
| TECHNICIAN | technician pages + tickets.html |
| SENIOR | technician pages + senior pages + workflows.html |
| SUPERVISOR | senior pages + supervisor pages + ai-insights.html |
| ADMIN | All pages (unrestricted) |

**Behavior**:
- Users attempting to access unauthorized pages are redirected to their role's default page
- Hierarchical access: higher roles inherit access from lower roles
- Login/public pages are always accessible

---

### 3. assets/js/pages/junior-dashboard.js
**Purpose**: Technician workflow dashboard with building-based filtering

**Ticket Filtering** (`loadAvailableTickets()`, Lines 173-200):
```javascript
// Technicians only see tickets from their assigned building
if (AuthService.getUserBuilding()) {
    filters.building = AuthService.getUserBuilding();
}

// Filter by technician level if available
if (AuthService.getTechnicianLevel()) {
    filters.level = AuthService.getTechnicianLevel();
}
```

**Action Button Visibility** (`renderMyTicketActions()`, Lines 304-339):
- **Start Work / Mark Resolved buttons**: Only visible for TECHNICIAN, SENIOR, SUPERVISOR, ADMIN
- **Escalate button**: Same role restrictions
- Students/Doctors cannot modify ticket status

**Claim Button Visibility** (`renderAvailableTicketActions()`, Lines 344-355):
- Only visible if:
  - User has TECHNICIAN+ role, AND
  - Ticket status is UNASSIGNED

---

### 4. assets/js/pages/senior-dashboard.js
**Purpose**: Senior technician (building manager) dashboard

**Action Button Visibility** (`createTicketCard()`, Lines 365-378):
- **Reassign button**: Only visible for SENIOR, SUPERVISOR, ADMIN
- **Claim & Handle button**: Same role restrictions
- Prevents unauthorized ticket reassignment

---

### 5. assets/js/pages/tickets.js
**Purpose**: Main ticket list page with role-based action buttons

**Table View Rendering** (`renderTableView()`, Lines 375-450):
```javascript
const currentUser = AuthService.getCurrentUser();

// Role-based button visibility checks
const canTriggerWorkflow = AuthService.isTechnician() || 
                           AuthService.isSenior() || 
                           AuthService.isSupervisor() || 
                           AuthService.isAdmin();

const canUpdate = AuthService.isAdmin() || 
                 AuthService.isSupervisor() || 
                 AuthService.isSenior() ||
                 (ticket.assignee === currentUser?.email);

const canDelete = AuthService.isAdmin();
```

**Button Visibility Matrix**:
| Action | Roles Allowed | Additional Conditions |
|--------|---------------|----------------------|
| View (👁️) | All | None |
| Trigger Workflow (▶️) | TECHNICIAN+ | None |
| Update (✏️) | SENIOR+, or assigned technician | User is assignee OR has management role |
| Delete (🗑️) | ADMIN only | None |

---

### 6. components/sidebar.html
**Purpose**: Navigation sidebar with role-based link visibility

**Data Attributes**: All navigation links use `data-roles` attribute
```html
<!-- Example: Junior Dashboard -->
<a href="junior-dashboard.html" 
   data-roles="TECHNICIAN,JUNIOR,SENIOR,SUPERVISOR,ADMIN">
    Junior Dashboard
</a>
```

**Sidebar Sections with Role Restrictions**:

#### Main Navigation
- **Dashboard**: `STUDENT,DOCTOR,ADMIN`
- **Tickets**: All roles (no restriction)
- **Workflows**: `TECHNICIAN,JUNIOR,SENIOR,SUPERVISOR,ADMIN`

#### Workflow Management
- **Junior Dashboard**: `TECHNICIAN,JUNIOR,SENIOR,SUPERVISOR,ADMIN`
- **Senior Dashboard**: `SENIOR,SUPERVISOR,ADMIN`
- **Supervisor Dashboard**: `SUPERVISOR,ADMIN`

#### Management Section (entire section)
- Section visibility: `SENIOR,SUPERVISOR,ADMIN`
- Assets, Knowledge Base, SLA Policies: All within restricted section

#### AI & Automation
- **AI Insights**: `SUPERVISOR,ADMIN`
- **AI Chatbot**: All roles (no restriction)
- **Automations**: `SENIOR,SUPERVISOR,ADMIN`

#### Reports (entire section)
- Section visibility: `SENIOR,SUPERVISOR,ADMIN`
- Analytics, Reports: All within restricted section

#### Administration (entire section)
- Section visibility: `ADMIN`
- Users, Settings: Admin only

**Integration**: Works with `applyRoleBasedVisibility()` in app.js which:
1. Reads `data-roles` attribute from each element
2. Compares against current user's role
3. Shows/hides elements accordingly

---

## Testing Checklist

### STUDENT/DOCTOR Role Testing
- [ ] Can access dashboard.html only
- [ ] Cannot access any technician/senior/supervisor pages
- [ ] Sidebar shows: Dashboard, Tickets, AI Chatbot only
- [ ] Can view tickets in ticket list
- [ ] Can create new tickets
- [ ] Cannot see Workflow button, Update button, Delete button on tickets
- [ ] Cannot claim or update ticket status

### TECHNICIAN/JUNIOR Role Testing
- [ ] Can access: junior-dashboard.html, tickets.html
- [ ] Cannot access: senior-dashboard.html, supervisor-dashboard.html, ai-insights.html
- [ ] Sidebar shows: Tickets, Workflows, Junior Dashboard, AI Chatbot
- [ ] Sees only tickets from assigned building in Available Tickets
- [ ] Can claim UNASSIGNED tickets
- [ ] Can update status of assigned tickets (Start Work, Mark Resolved)
- [ ] Can escalate assigned tickets
- [ ] Can trigger workflows on tickets
- [ ] Can update assigned tickets
- [ ] Cannot delete tickets or reassign to others

### SENIOR Role Testing
- [ ] Can access: all technician pages + senior-dashboard.html, workflows.html
- [ ] Cannot access: supervisor-dashboard.html, ai-insights.html
- [ ] Sidebar shows: Management section, Reports section, Senior Dashboard
- [ ] Can reassign tickets to other technicians
- [ ] Can claim escalated tickets
- [ ] Can view building-wide analytics
- [ ] Can update any ticket in their building
- [ ] Cannot delete tickets

### SUPERVISOR Role Testing
- [ ] Can access: all pages except admin pages (users.html)
- [ ] Sidebar shows: Supervisor Dashboard, AI Insights, full navigation
- [ ] Can oversee multiple buildings
- [ ] Can access AI insights and analytics
- [ ] Can reassign tickets across buildings
- [ ] Cannot delete tickets or manage users

### ADMIN Role Testing
- [ ] Can access all pages without restriction
- [ ] Sidebar shows all sections including Administration
- [ ] Can delete tickets
- [ ] Can manage users
- [ ] Can access all features and dashboards
- [ ] No UI elements are hidden

---

## Technical Notes

### Role Check Pattern
All role checks follow this consistent pattern:
```javascript
// Single role check
if (AuthService.isTechnician()) { ... }

// Multiple role check (OR logic)
if (AuthService.isSenior() || AuthService.isSupervisor() || AuthService.isAdmin()) { ... }

// Using hasAnyRole helper
if (AuthService.hasAnyRole(['SENIOR', 'SUPERVISOR', 'ADMIN'])) { ... }
```

### Hierarchical Access
Higher roles automatically inherit permissions from lower roles:
```
ADMIN → can do everything
SUPERVISOR → can do everything SENIOR can + supervisor features
SENIOR → can do everything TECHNICIAN can + senior features
TECHNICIAN → can do technician tasks
STUDENT/DOCTOR → can submit and view own tickets
```

### Data Filtering
Building-based filtering for technicians:
```javascript
// In junior-dashboard.js loadAvailableTickets()
if (AuthService.getUserBuilding()) {
    filters.building = AuthService.getUserBuilding();
}
```

### Conditional Button Rendering
Template literal pattern for conditional buttons:
```javascript
${canUpdate ? `
    <button class="btn btn-outline-info">Update</button>
` : ''}
```

---

## Integration with Existing Code

### No Breaking Changes
- All modifications are additive, not replacements
- Existing functionality preserved
- No restructuring or refactoring performed
- Uses existing AuthService singleton pattern
- Leverages existing Router page guard system
- Extends existing UI visibility pattern (data-roles)

### Dependencies
- **AuthService**: Must be loaded before any page scripts
- **Router**: Handles page navigation and guards
- **app.js**: Contains `applyRoleBasedVisibility()` for sidebar
- **UI utility**: Provides helper methods for rendering

---

## Future Enhancements (Optional)

### Optional Add-ons (if needed later):
1. **Granular Permissions**: Add permission matrix beyond roles
2. **Dynamic Role Assignment**: Allow runtime role changes
3. **Audit Logging**: Track role-based access attempts
4. **Role-Based Dashboard Widgets**: Customize dashboard per role
5. **Field-Level Security**: Hide specific form fields by role

### NOT RECOMMENDED (would require refactoring):
- ❌ Moving to a framework (React, Vue) for RBAC
- ❌ Creating separate dashboards per role
- ❌ Restructuring folder architecture by role
- ❌ Adding authentication middleware (backend concern)

---

## Summary

### What Was Added
✅ 8 new role-checking methods in AuthService  
✅ Hierarchical page guards in Router  
✅ Building-based ticket filtering for technicians  
✅ Role-based button visibility in 3 pages  
✅ Comprehensive sidebar role restrictions  
✅ Action button visibility controls in ticket list  

### What Was NOT Changed
✅ No refactoring or restructuring  
✅ No new dependencies or libraries  
✅ No changes to existing business logic  
✅ No modifications to API contracts  
✅ No database schema changes  
✅ No removal of existing features  

### Code Quality
✅ All changes follow existing patterns  
✅ No errors or linting issues  
✅ Backward compatible  
✅ Minimal LOC additions  
✅ Maintainable and readable  

---

## Deployment Notes

### Pre-Deployment Checklist
1. Ensure all Docker services are running (auth, ticket, workflow)
2. Verify service URLs in config.js match Docker ports
3. Clear browser cache to load updated JavaScript
4. Test with real user accounts for each role
5. Verify JWT tokens contain role information

### Post-Deployment Verification
1. Login with each role type
2. Verify page access restrictions work
3. Check sidebar visibility per role
4. Test action button visibility
5. Confirm building-based filtering for technicians
6. Verify no console errors

---

**Document Version**: 1.0  
**Last Updated**: 2024  
**Implementation Type**: Surgical (non-breaking, additive only)
