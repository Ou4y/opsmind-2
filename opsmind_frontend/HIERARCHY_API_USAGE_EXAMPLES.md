# Hierarchy API Usage Examples

## Overview
This document provides practical examples for using the new hierarchy and dashboard API methods added to `workflowService.js`.

All methods follow the same response pattern:
```javascript
{
  success: true/false,
  data: { ... },      // On success
  message: "..."      // On error
}
```

---

## 1. Dashboard APIs

### 1.1 Get Senior Dashboard

**Method:** `getSeniorDashboard(userId)`

**Purpose:** Shows a senior technician their assigned juniors, tickets, and workload.

**Example:**
```javascript
import { getSeniorDashboard } from './services/workflowService.js';

async function loadSeniorDashboard() {
  try {
    const response = await getSeniorDashboard(1); // user_id from auth service
    
    if (response.success) {
      const { seniorUserId, seniorName, juniors, tickets, workload } = response.data;
      
      console.log(`Dashboard for: ${seniorName} (User ID: ${seniorUserId})`);
      console.log(`Juniors: ${juniors.length}`);
      console.log(`Total Tickets: ${workload.totalTickets}`);
      
      // Display juniors
      juniors.forEach(junior => {
        console.log(`- ${junior.name} (${junior.assignedTickets} tickets)`);
      });
      
      // Display tickets
      tickets.forEach(ticket => {
        console.log(`Ticket ${ticket.ticketId}: ${ticket.status} - Assigned to ${ticket.assignedToName}`);
      });
    }
  } catch (error) {
    console.error('Failed to load senior dashboard:', error);
  }
}
```

**Response Structure:**
```javascript
{
  success: true,
  data: {
    seniorUserId: 1,
    seniorName: "Senior M",
    juniors: [
      {
        userId: 6,
        name: "M-F1 Tech 1",
        email: "tech.m.f1.1@opsmind.edu",
        status: "ACTIVE",
        location: { latitude: 31.9961, longitude: 35.8458 },
        assignedTickets: 5
      }
      // ... more juniors
    ],
    tickets: [
      {
        ticketId: "abc-123",
        assignedTo: 6,
        assignedToName: "M-F1 Tech 1",
        status: "IN_PROGRESS",
        priority: "HIGH",
        location: { latitude: 31.99, longitude: 35.84 },
        createdAt: "2026-04-12T12:00:00.000Z"
      }
      // ... more tickets
    ],
    workload: {
      totalTickets: 40,
      byStatus: { "OPEN": 10, "IN_PROGRESS": 20, "RESOLVED": 10 },
      byPriority: { "LOW": 10, "MEDIUM": 20, "HIGH": 10 },
      byJunior: { "6": 5, "7": 4, "8": 6 }
    }
  }
}
```

---

### 1.2 Get Supervisor Dashboard

**Method:** `getSupervisorDashboard(userId)`

**Purpose:** Shows a supervisor the entire team structure (seniors + juniors), all tickets, and metrics.

**Example:**
```javascript
import { getSupervisorDashboard } from './services/workflowService.js';

async function loadSupervisorDashboard() {
  try {
    const response = await getSupervisorDashboard(100);
    
    if (response.success) {
      const { supervisorName, teamStructure, tickets, workload, metrics } = response.data;
      
      console.log(`Dashboard for Supervisor: ${supervisorName}`);
      console.log(`Total Technicians: ${metrics.totalTechnicians}`);
      console.log(`Seniors: ${teamStructure.seniors.length}`);
      console.log(`Juniors: ${teamStructure.juniors.length}`);
      
      // Display senior teams
      teamStructure.seniors.forEach(senior => {
        console.log(`${senior.name}: ${senior.juniorCount} juniors, ${senior.assignedTickets} tickets`);
      });
    }
  } catch (error) {
    console.error('Failed to load supervisor dashboard:', error);
  }
}
```

**Response Structure:**
```javascript
{
  success: true,
  data: {
    supervisorUserId: 100,
    supervisorName: "Main Supervisor",
    teamStructure: {
      seniors: [
        {
          userId: 1,
          name: "Senior M",
          email: "senior.m@opsmind.edu",
          status: "ACTIVE",
          juniorCount: 8,
          assignedTickets: 40
        }
        // ... more seniors
      ],
      juniors: [
        {
          userId: 6,
          name: "M-F1 Tech 1",
          email: "tech.m.f1.1@opsmind.edu",
          status: "ACTIVE",
          seniorUserId: 1,
          seniorName: "Senior M",
          assignedTickets: 5
        }
        // ... more juniors
      ]
    },
    tickets: [ /* same structure as senior dashboard */ ],
    workload: { /* same structure as senior dashboard */ },
    metrics: {
      totalTechnicians: 49,
      totalSeniors: 5,
      totalJuniors: 44,
      averageTicketsPerJunior: 2.3,
      averageJuniorsPerSenior: 8.8
    }
  }
}
```

---

## 2. Hierarchy Management APIs

### 2.1 Get Technicians by Level

**Method:** `getTechniciansByLevel(level)`

**Purpose:** Retrieve all technicians, optionally filtered by level.

**Example:**
```javascript
import { getTechniciansByLevel } from './services/workflowService.js';

// Get all technicians
async function getAllTechnicians() {
  const response = await getTechniciansByLevel();
  console.log(`Total technicians: ${response.data.length}`);
}

// Get only seniors
async function getSeniors() {
  const response = await getTechniciansByLevel('SENIOR');
  response.data.forEach(senior => {
    console.log(`${senior.name} - ${senior.email}`);
  });
}

// Get only juniors
async function getJuniors() {
  const response = await getTechniciansByLevel('JUNIOR');
  console.log(`Found ${response.data.length} junior technicians`);
}
```

**Valid levels:** `'JUNIOR'`, `'SENIOR'`, `'SUPERVISOR'`, `'ADMIN'`, or `null` for all.

---

### 2.2 Get Hierarchy Tree

**Method:** `getHierarchyTree()`

**Purpose:** Get the complete hierarchy visualization with all technicians and relationships.

**Example:**
```javascript
import { getHierarchyTree } from './services/workflowService.js';

async function displayHierarchyTree() {
  try {
    const response = await getHierarchyTree();
    
    if (response.success) {
      console.log(`Total Technicians: ${response.data.length}`);
      console.log(`Total Relationships: ${response.relationships.length}`);
      
      // Build visual tree
      const tree = buildTreeFromData(response.data, response.relationships);
      renderTree(tree);
    }
  } catch (error) {
    console.error('Failed to load hierarchy tree:', error);
  }
}
```

**Response:**
```javascript
{
  success: true,
  data: [ /* array of all technicians */ ],
  relationships: [
    {
      id: 7,
      child_user_id: 6,
      parent_user_id: 1,
      relationship_type: "JUNIOR_TO_SENIOR",
      is_active: 1,
      created_at: "2026-04-12T20:49:55.000Z"
    }
    // ... more relationships
  ]
}
```

---

### 2.3 Get Direct Reports

**Method:** `getDirectReports(userId)`

**Purpose:** Get all technicians directly reporting to a specific user.

**Example:**
```javascript
import { getDirectReports } from './services/workflowService.js';

async function showTeamMembers(userId) {
  try {
    const response = await getDirectReports(userId);
    
    if (response.success) {
      const { userName, level, directReports } = response.data;
      
      console.log(`${userName} (${level}) has ${directReports.length} direct reports:`);
      
      directReports.forEach(member => {
        console.log(`- ${member.name} (${member.level})`);
      });
    }
  } catch (error) {
    console.error('Failed to get direct reports:', error);
  }
}

// Example: Get juniors under Senior M (user_id: 1)
showTeamMembers(1);
```

---

### 2.4 Get Manager

**Method:** `getManager(userId)`

**Purpose:** Get the manager/supervisor of a specific user.

**Example:**
```javascript
import { getManager } from './services/workflowService.js';

async function showManager(userId) {
  try {
    const response = await getManager(userId);
    
    if (response.success && response.data) {
      const { userName, level, relationshipType } = response.data;
      console.log(`Reports to: ${userName} (${level}) via ${relationshipType}`);
    } else {
      console.log('No manager found (likely top-level)');
    }
  } catch (error) {
    console.error('Failed to get manager:', error);
  }
}

// Example: Find who Junior with user_id 6 reports to
showManager(6);
```

---

### 2.5 Create Hierarchy Relationship

**Method:** `createHierarchyRelationship(payload)`

**Purpose:** Assign a junior to a senior, or a senior to a supervisor.

**Example:**
```javascript
import { createHierarchyRelationship } from './services/workflowService.js';

// Assign junior (user_id: 50) to senior (user_id: 3)
async function assignJuniorToSenior() {
  try {
    const response = await createHierarchyRelationship({
      childUserId: 50,
      parentUserId: 3,
      relationshipType: 'JUNIOR_TO_SENIOR'
    });
    
    if (response.success) {
      console.log('Successfully assigned junior to senior');
      console.log(`Relationship ID: ${response.data.id}`);
    }
  } catch (error) {
    console.error('Failed to create relationship:', error.message);
  }
}

// Assign senior (user_id: 5) to supervisor (user_id: 100)
async function assignSeniorToSupervisor() {
  const response = await createHierarchyRelationship({
    childUserId: 5,
    parentUserId: 100,
    relationshipType: 'SENIOR_TO_SUPERVISOR'
  });
  
  console.log(response.message);
}
```

**Relationship Types:**
- `'JUNIOR_TO_SENIOR'` - Assign a junior technician to a senior
- `'SENIOR_TO_SUPERVISOR'` - Assign a senior to a supervisor
- `'SUPERVISOR_TO_ADMIN'` - Assign a supervisor to an admin

---

### 2.6 Update Hierarchy Relationship

**Method:** `updateHierarchyRelationship(relationshipId, payload)`

**Purpose:** Reassign a technician to a different supervisor/senior.

**Example:**
```javascript
import { updateHierarchyRelationship } from './services/workflowService.js';

// Reassign junior from one senior to another
async function reassignJunior() {
  try {
    const relationshipId = 7; // The ID of the existing relationship
    
    const response = await updateHierarchyRelationship(relationshipId, {
      childUserId: 6,   // Keep same junior
      parentUserId: 2   // Change from Senior M (1) to Senior N (2)
    });
    
    if (response.success) {
      console.log('Junior successfully reassigned to new senior');
    }
  } catch (error) {
    console.error('Failed to update relationship:', error.message);
  }
}
```

---

### 2.7 Delete Hierarchy Relationship

**Method:** `deleteHierarchyRelationship(relationshipId)`

**Purpose:** Remove a reporting relationship (unassign).

**Example:**
```javascript
import { deleteHierarchyRelationship } from './services/workflowService.js';

async function removeAssignment(relationshipId) {
  try {
    const response = await deleteHierarchyRelationship(relationshipId);
    
    if (response.success) {
      console.log('Relationship removed successfully');
    }
  } catch (error) {
    console.error('Failed to delete relationship:', error.message);
  }
}

// Example: Remove relationship with ID 10
removeAssignment(10);
```

---

## 3. Complete Example: Admin Hierarchy Management Page

```javascript
import {
  getTechniciansByLevel,
  getHierarchyTree,
  createHierarchyRelationship,
  updateHierarchyRelationship,
  deleteHierarchyRelationship
} from './services/workflowService.js';

class HierarchyManager {
  async initialize() {
    await this.loadAllData();
    this.setupEventListeners();
  }
  
  async loadAllData() {
    // Load all technicians grouped by level
    const [seniors, juniors] = await Promise.all([
      getTechniciansByLevel('SENIOR'),
      getTechniciansByLevel('JUNIOR')
    ]);
    
    this.seniors = seniors.data;
    this.juniors = juniors.data;
    
    // Load hierarchy tree
    const tree = await getHierarchyTree();
    this.relationships = tree.relationships;
    
    this.render();
  }
  
  async assignJunior(juniorUserId, seniorUserId) {
    try {
      const response = await createHierarchyRelationship({
        childUserId: juniorUserId,
        parentUserId: seniorUserId,
        relationshipType: 'JUNIOR_TO_SENIOR'
      });
      
      if (response.success) {
        alert('Junior assigned successfully');
        await this.loadAllData(); // Reload
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  }
  
  async reassignJunior(relationshipId, newSeniorUserId, juniorUserId) {
    try {
      const response = await updateHierarchyRelationship(relationshipId, {
        childUserId: juniorUserId,
        parentUserId: newSeniorUserId
      });
      
      if (response.success) {
        alert('Junior reassigned successfully');
        await this.loadAllData();
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  }
  
  async unassignJunior(relationshipId) {
    if (!confirm('Remove this assignment?')) return;
    
    try {
      const response = await deleteHierarchyRelationship(relationshipId);
      
      if (response.success) {
        alert('Assignment removed');
        await this.loadAllData();
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  }
  
  render() {
    // Render UI with seniors, juniors, and relationship management
    console.log('Rendering hierarchy manager...');
  }
  
  setupEventListeners() {
    // Setup buttons for assign/reassign/unassign actions
  }
}

// Initialize
const manager = new HierarchyManager();
manager.initialize();
```

---

## 4. Complete Example: Senior Dashboard Page

```javascript
import { getSeniorDashboard } from './services/workflowService.js';
import AuthService from './services/authService.js';

async function loadSeniorDashboardPage() {
  const currentUser = AuthService.getUser();
  const userId = currentUser.id;
  
  try {
    const response = await getSeniorDashboard(userId);
    
    if (!response.success) {
      throw new Error(response.message);
    }
    
    const { seniorName, juniors, tickets, workload } = response.data;
    
    // Update page title
    document.getElementById('dashboard-title').textContent = 
      `${seniorName}'s Dashboard`;
    
    // Display juniors
    const juniorsList = document.getElementById('juniors-list');
    juniorsList.innerHTML = juniors.map(junior => `
      <div class="junior-card">
        <h3>${junior.name}</h3>
        <p>${junior.email}</p>
        <span class="status ${junior.status}">${junior.status}</span>
        <p>Assigned Tickets: ${junior.assignedTickets}</p>
      </div>
    `).join('');
    
    // Display workload summary
    document.getElementById('total-tickets').textContent = workload.totalTickets;
    document.getElementById('open-tickets').textContent = workload.byStatus.OPEN || 0;
    document.getElementById('in-progress').textContent = workload.byStatus.IN_PROGRESS || 0;
    
    // Display recent tickets
    const ticketsList = document.getElementById('tickets-list');
    ticketsList.innerHTML = tickets.slice(0, 10).map(ticket => `
      <tr>
        <td>${ticket.ticketId}</td>
        <td>${ticket.assignedToName}</td>
        <td><span class="status-badge ${ticket.status}">${ticket.status}</span></td>
        <td>${ticket.priority}</td>
        <td>${new Date(ticket.createdAt).toLocaleString()}</td>
      </tr>
    `).join('');
    
  } catch (error) {
    console.error('Failed to load senior dashboard:', error);
    alert('Failed to load dashboard. Please try again.');
  }
}

// Load on page ready
document.addEventListener('DOMContentLoaded', loadSeniorDashboardPage);
```

---

## Error Handling Best Practices

```javascript
import { getSeniorDashboard } from './services/workflowService.js';

async function safeLoadDashboard(userId) {
  try {
    const response = await getSeniorDashboard(userId);
    
    // Check success field
    if (!response.success) {
      // Backend returned error
      console.error('Backend error:', response.message);
      showErrorToUser(response.message);
      return null;
    }
    
    // Success - use response.data
    return response.data;
    
  } catch (error) {
    // Network error or other exception
    console.error('Request failed:', error);
    
    if (error.message === 'Session expired') {
      // User was logged out - handled by workflowRequest
      return null;
    }
    
    showErrorToUser('Failed to load dashboard. Please check your connection.');
    return null;
  }
}

function showErrorToUser(message) {
  // Display error in UI
  const errorDiv = document.getElementById('error-message');
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';
}
```

---

## Summary

### Files Changed
- `services/workflowService.js` - Added 9 new API methods

### API Methods Added

**Dashboard APIs:**
1. `getSeniorDashboard(userId)` - Get senior's juniors and tickets
2. `getSupervisorDashboard(userId)` - Get supervisor's team overview

**Hierarchy Management APIs:**
3. `getTechniciansByLevel(level)` - List technicians by level
4. `getHierarchyTree()` - Get complete hierarchy tree
5. `getDirectReports(userId)` - Get user's direct reports
6. `getManager(userId)` - Get user's manager
7. `createHierarchyRelationship(payload)` - Assign technician to supervisor/senior
8. `updateHierarchyRelationship(relationshipId, payload)` - Reassign technician
9. `deleteHierarchyRelationship(relationshipId)` - Remove assignment

### Key Features
- ✅ Consistent error handling with try/catch
- ✅ Authentication headers automatically included
- ✅ Normalized response format (`{ success, data, message }`)
- ✅ Comprehensive JSDoc documentation
- ✅ Example usage for every method
- ✅ Centralized in `workflowService.js`
- ✅ Available in both named exports and WorkflowService object
