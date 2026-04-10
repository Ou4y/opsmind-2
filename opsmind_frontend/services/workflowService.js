/**
 * OpsMind - Workflow Service
 * 
 * Complete integration with opsmind-workflow-service backend (http://localhost:3003)
 * 
 * API Contract Rules:
 * - All responses: { success: true/false, data: ..., message: "..." }
 * - On success: use response.data
 * - On error: use response.message (NOT response.error)
 * - ticketId is always a string (UUID)
 * - Query params use snake_case: start_date, end_date
 * - Request body fields use exact names from backend
 * - Every request includes Authorization: Bearer <token>
 */

import AuthService from './authService.js';

const WORKFLOW_API = window.OPSMIND_WORKFLOW_API_URL || 'http://localhost:3003';

/**
 * Get authentication headers with Bearer token
 * @returns {Object} Headers object
 */
function getAuthHeaders() {
    const token = AuthService.getToken();
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
}

/**
 * Make workflow API request with consistent error handling
 * @param {string} path - API path (appended to base URL)
 * @param {Object} options - Fetch options
 * @returns {Promise<Object>} Response data
 */
async function workflowRequest(path, options = {}) {
    const response = await fetch(`${WORKFLOW_API}${path}`, {
        headers: getAuthHeaders(),
        ...options
    });
    
    const json = await response.json();
    
    // Handle 401 Unauthorized
    if (response.status === 401) {
        AuthService.clearAuth();
        window.location.href = '/index.html';
        throw new Error('Session expired');
    }
    
    // Check success field instead of HTTP status alone
    if (!json.success && response.status >= 400) {
        throw new Error(json.message || `Request failed with status ${response.status}`);
    }
    
    return json;
}

// ===================================
// 1. HEALTH CHECK
// ===================================

/**
 * Health check for workflow service
 * @returns {Promise<Object>} { status, service, database, timestamp, uptime }
 */
export async function healthCheck() {
    return workflowRequest('/workflow/health', {
        method: 'GET'
    });
}

// ===================================
// 2. ROUTE A TICKET
// ===================================

/**
 * Route a ticket to appropriate support group by building and floor
 * @param {Object} data
 * @param {string} data.ticketId - Ticket UUID (string)
 * @param {string} data.building - Building identifier
 * @param {number} data.floor - Floor number
 * @returns {Promise<Object>} Routing result
 */
export async function routeTicket(data) {
    return workflowRequest('/workflow/route-ticket', {
        method: 'POST',
        body: JSON.stringify({
            ticketId: String(data.ticketId),  // Ensure string
            building: data.building,
            floor: data.floor
        })
    });
}

// ===================================
// 3. CLAIM A TICKET
// ===================================

/**
 * Claim a ticket by a technician
 * @param {string} ticketId - Ticket UUID
 * @param {number} technicianId - User ID of the technician
 * @returns {Promise<Object>} Claim result
 */
export async function claimTicket(ticketId, technicianId) {
    return workflowRequest(`/workflow/claim/${String(ticketId)}`, {
        method: 'POST',
        body: JSON.stringify({
            technician_id: technicianId
        })
    });
}

/**
 * Check if ticket is claimed
 * @param {string} ticketId - Ticket UUID
 * @returns {Promise<Object>} Claim status
 */
export async function getClaimStatus(ticketId) {
    return workflowRequest(`/workflow/claim/${String(ticketId)}/status`, {
        method: 'GET'
    });
}

/**
 * Get unclaimed tickets in a support group
 * @param {number} groupId - Support group ID
 * @returns {Promise<Array>} List of unclaimed tickets
 */
export async function getUnclaimedTickets(groupId) {
    return workflowRequest(`/workflow/group/${groupId}/unclaimed`, {
        method: 'GET'
    });
}

// ===================================
// 4. REASSIGN A TICKET
// ===================================

/**
 * Reassign a ticket to another technician
 * @param {string} ticketId - Ticket UUID
 * @param {Object} data
 * @param {number} data.toTechnicianId - group_members.id of target technician
 * @param {string} data.reason - Reason for reassignment
 * @param {number} data.reassignedBy - User ID of person doing reassignment
 * @returns {Promise<Object>} Reassignment result
 */
export async function reassignTicket(ticketId, data) {
    return workflowRequest(`/workflow/reassign/${String(ticketId)}`, {
        method: 'POST',
        body: JSON.stringify({
            to_technician_id: data.toTechnicianId,
            reason: data.reason,
            reassigned_by: data.reassignedBy
        })
    });
}

/**
 * Get eligible reassignment targets for a ticket
 * @param {string} ticketId - Ticket UUID
 * @returns {Promise<Array>} List of eligible technicians
 */
export async function getReassignmentTargets(ticketId) {
    return workflowRequest(`/workflow/reassign/${String(ticketId)}/targets`, {
        method: 'GET'
    });
}

// ===================================
// 5. ESCALATE A TICKET
// ===================================

/**
 * Escalate a ticket to higher support level
 * @param {string} ticketId - Ticket UUID
 * @param {Object} data
 * @param {string} data.reason - Escalation reason
 * @param {number} data.escalatedBy - User ID of person escalating
 * @param {string} [data.triggerType] - Optional: "MANUAL"|"SLA"|"CRITICAL"|"REOPEN_COUNT"
 * @returns {Promise<Object>} Escalation result
 */
export async function escalateTicket(ticketId, data) {
    const body = {
        reason: data.reason,
        escalated_by: data.escalatedBy
    };
    
    if (data.triggerType) {
        body.triggerType = data.triggerType;
    }
    
    return workflowRequest(`/workflow/escalate/${String(ticketId)}`, {
        method: 'POST',
        body: JSON.stringify(body)
    });
}

/**
 * Get escalation history for a ticket
 * @param {string} ticketId - Ticket UUID
 * @returns {Promise<Array>} Escalation history
 */
export async function getEscalationHistory(ticketId) {
    return workflowRequest(`/workflow/escalate/${String(ticketId)}/history`, {
        method: 'GET'
    });
}

/**
 * Get escalation path for a support group
 * @param {number} groupId - Support group ID
 * @returns {Promise<Object>} Escalation path information
 */
export async function getEscalationPath(groupId) {
    return workflowRequest(`/workflow/group/${groupId}/escalation-path`, {
        method: 'GET'
    });
}

// ===================================
// 6. WORKFLOW LOGS (AUDIT TRAIL)
// ===================================

/**
 * Get workflow logs for a ticket
 * @param {string} ticketId - Ticket UUID
 * @returns {Promise<Array>} Audit log entries
 */
export async function getWorkflowLogs(ticketId) {
    return workflowRequest(`/workflow/logs/${String(ticketId)}`, {
        method: 'GET'
    });
}

// ===================================
// 7. GROUP TICKETS (FILTERED LIST)
// ===================================

/**
 * Get tickets assigned to a support group
 * @param {number} groupId - Support group ID
 * @param {Object} [filters] - Optional filters
 * @param {string} [filters.status] - "UNASSIGNED"|"ASSIGNED"|"ESCALATED"
 * @param {string} [filters.building] - Building filter
 * @returns {Promise<Array>} Filtered ticket list
 */
export async function getGroupTickets(groupId, filters = {}) {
    const params = new URLSearchParams();
    if (filters.status) params.append('status', filters.status);
    if (filters.building) params.append('building', filters.building);
    
    const queryString = params.toString();
    const path = `/workflow/group/${groupId}/tickets${queryString ? '?' + queryString : ''}`;
    
    return workflowRequest(path, {
        method: 'GET'
    });
}

// ===================================
// 8. TECHNICIAN TICKETS
// ===================================

/**
 * Get tickets assigned to a specific technician
 * @param {number} technicianId - User ID (from auth service)
 * @param {Object} [filters] - Optional filters
 * @param {string} [filters.status] - Status filter
 * @returns {Promise<Array>} Technician's tickets
 */
export async function getTechnicianTickets(technicianId, filters = {}) {
    const params = new URLSearchParams();
    if (filters.status) params.append('status', filters.status);
    
    const queryString = params.toString();
    const path = `/workflow/technician/${technicianId}/tickets${queryString ? '?' + queryString : ''}`;
    
    return workflowRequest(path, {
        method: 'GET'
    });
}

// ===================================
// 9. SLA STATUS (BATCH LOOKUP)
// ===================================

/**
 * Get SLA status for multiple tickets (batch)
 * @param {Array<string>} ticketIds - Array of ticket UUIDs (strings)
 * @returns {Promise<Object>} Map of ticketId -> SLA status
 */
export async function getSLAStatus(ticketIds) {
    return workflowRequest('/workflow/sla/status', {
        method: 'POST',
        body: JSON.stringify({
            ticket_ids: ticketIds.map(String)  // Ensure all are strings
        })
    });
}

// ===================================
// 10. OVERVIEW METRICS
// ===================================

/**
 * Get workflow overview metrics
 * @param {Object} [filters] - Date range filters
 * @param {string} [filters.startDate] - Start date (YYYY-MM-DD)
 * @param {string} [filters.endDate] - End date (YYYY-MM-DD)
 * @returns {Promise<Object>} Overview metrics
 */
export async function getOverviewMetrics(filters = {}) {
    const params = new URLSearchParams();
    if (filters.startDate) params.append('start_date', filters.startDate);
    if (filters.endDate) params.append('end_date', filters.endDate);
    
    const queryString = params.toString();
    const path = `/workflow/metrics${queryString ? '?' + queryString : ''}`;
    
    return workflowRequest(path, {
        method: 'GET'
    });
}

// ===================================
// 11. TEAM METRICS
// ===================================

/**
 * Get team-specific metrics for a support group
 * @param {number} groupId - Support group ID
 * @param {Object} [filters] - Date range filters
 * @param {string} [filters.startDate] - Start date (YYYY-MM-DD)
 * @param {string} [filters.endDate] - End date (YYYY-MM-DD)
 * @returns {Promise<Object>} Team metrics
 */
export async function getTeamMetrics(groupId, filters = {}) {
    const params = new URLSearchParams();
    if (filters.startDate) params.append('start_date', filters.startDate);
    if (filters.endDate) params.append('end_date', filters.endDate);
    
    const queryString = params.toString();
    const path = `/workflow/metrics/team/${groupId}${queryString ? '?' + queryString : ''}`;
    
    return workflowRequest(path, {
        method: 'GET'
    });
}

// ===================================
// 12. SLA REPORT
// ===================================

/**
 * Get SLA compliance report
 * @param {Object} [filters] - Date range filters
 * @param {string} [filters.startDate] - Start date (YYYY-MM-DD)
 * @param {string} [filters.endDate] - End date (YYYY-MM-DD)
 * @returns {Promise<Object>} SLA report with compliance rate
 */
export async function getSLAReport(filters = {}) {
    const params = new URLSearchParams();
    if (filters.startDate) params.append('start_date', filters.startDate);
    if (filters.endDate) params.append('end_date', filters.endDate);
    
    const queryString = params.toString();
    const path = `/workflow/reports/sla${queryString ? '?' + queryString : ''}`;
    
    return workflowRequest(path, {
        method: 'GET'
    });
}

// ===================================
// 13. ESCALATION REPORT
// ===================================

/**
 * Get escalation statistics report
 * @param {Object} [filters] - Date range filters
 * @param {string} [filters.startDate] - Start date (YYYY-MM-DD)
 * @param {string} [filters.endDate] - End date (YYYY-MM-DD)
 * @returns {Promise<Object>} Escalation report
 */
export async function getEscalationReport(filters = {}) {
    const params = new URLSearchParams();
    if (filters.startDate) params.append('start_date', filters.startDate);
    if (filters.endDate) params.append('end_date', filters.endDate);
    
    const queryString = params.toString();
    const path = `/workflow/reports/escalations${queryString ? '?' + queryString : ''}`;
    
    return workflowRequest(path, {
        method: 'GET'
    });
}

// ===================================
// 14. DASHBOARD ENDPOINTS
// ===================================

/**
 * Get audit trail for a ticket
 * @param {string} ticketId - Ticket UUID
 * @returns {Promise<Array>} Audit trail
 */
export async function getAuditTrail(ticketId) {
    return workflowRequest(`/workflow/dashboard/audit/${String(ticketId)}`, {
        method: 'GET'
    });
}

/**
 * Get building-specific dashboard data
 * @param {string} buildingId - Building identifier
 * @returns {Promise<Object>} Building dashboard data
 */
export async function getBuildingDashboard(buildingId) {
    return workflowRequest(`/workflow/dashboard/building/${buildingId}`, {
        method: 'GET'
    });
}

/**
 * Get member-specific dashboard data
 * @param {number} memberId - Group member ID
 * @returns {Promise<Object>} Member dashboard data
 */
export async function getMemberDashboard(memberId) {
    return workflowRequest(`/workflow/dashboard/member/${memberId}`, {
        method: 'GET'
    });
}

/**
 * Get group-specific metrics for dashboard
 * @param {number} groupId - Support group ID
 * @returns {Promise<Object>} Group metrics
 */
export async function getGroupMetrics(groupId) {
    return workflowRequest(`/workflow/dashboard/group/${groupId}/metrics`, {
        method: 'GET'
    });
}

/**
 * Get recent activity across the system
 * @returns {Promise<Array>} Recent activities
 */
export async function getRecentActivity() {
    return workflowRequest('/workflow/dashboard/activity/recent', {
        method: 'GET'
    });
}

// ===================================
// 15. ROUTING INFO
// ===================================

/**
 * Get current routing state of a ticket
 * @param {string} ticketId - Ticket UUID
 * @returns {Promise<Object>} Routing state
 */
export async function getTicketRouting(ticketId) {
    return workflowRequest(`/workflow/ticket/${String(ticketId)}/routing`, {
        method: 'GET'
    });
}

/**
 * Get all queued tickets in a support group
 * @param {number} groupId - Support group ID
 * @returns {Promise<Array>} Queued tickets
 */
export async function getGroupQueue(groupId) {
    return workflowRequest(`/workflow/group/${groupId}/queue`, {
        method: 'GET'
    });
}

/**
 * Get support group metadata
 * @param {number} groupId - Support group ID
 * @returns {Promise<Object>} Group information
 */
export async function getGroupInfo(groupId) {
    return workflowRequest(`/workflow/group/${groupId}/info`, {
        method: 'GET'
    });
}

// ===================================
// 16. ADMIN - SUPPORT GROUPS
// ===================================

/**
 * Get all support groups
 * @returns {Promise<Array>} List of support groups
 */
export async function getAllSupportGroups() {
    return workflowRequest('/workflow/admin/support-groups', {
        method: 'GET'
    });
}

/**
 * Create a new support group
 * @param {Object} data
 * @param {string} data.name - Group name (REQUIRED)
 * @param {string} data.building - Building identifier (REQUIRED)
 * @param {number} data.floor - Floor number (REQUIRED)
 * @param {number} [data.parentGroupId] - Optional parent group ID
 * @returns {Promise<Object>} Created support group
 */
export async function createSupportGroup(data) {
    return workflowRequest('/workflow/admin/support-groups', {
        method: 'POST',
        body: JSON.stringify({
            name: data.name,
            building: data.building,
            floor: data.floor,
            parentGroupId: data.parentGroupId || null
        })
    });
}

/**
 * Update a support group
 * @param {number} groupId - Support group ID
 * @param {Object} data - Fields to update (partial)
 * @param {string} [data.name] - Group name
 * @param {string} [data.building] - Building identifier
 * @param {number} [data.floor] - Floor number
 * @param {number} [data.parentGroupId] - Parent group ID
 * @param {boolean} [data.isActive] - Active status
 * @returns {Promise<Object>} Updated support group
 */
export async function updateSupportGroup(groupId, data) {
    return workflowRequest(`/workflow/admin/support-groups/${groupId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    });
}

/**
 * Delete a support group (soft delete - sets is_active=false)
 * @param {number} groupId - Support group ID
 * @returns {Promise<Object>} Deletion result
 */
export async function deleteSupportGroup(groupId) {
    return workflowRequest(`/workflow/admin/support-groups/${groupId}`, {
        method: 'DELETE'
    });
}

// ===================================
// 17. ADMIN - GROUP MEMBERS
// ===================================

/**
 * Get all members of a support group
 * @param {number} groupId - Support group ID
 * @returns {Promise<Array>} List of group members
 */
export async function getGroupMembers(groupId) {
    return workflowRequest(`/workflow/admin/support-groups/${groupId}/members`, {
        method: 'GET'
    });
}

/**
 * Add a member to a support group
 * @param {number} groupId - Support group ID
 * @param {Object} data
 * @param {number} data.userId - User ID (REQUIRED)
 * @param {string} data.role - "JUNIOR"|"SENIOR" (REQUIRED)
 * @param {boolean} [data.canAssign] - Can assign tickets (optional, default false)
 * @param {boolean} [data.canEscalate] - Can escalate tickets (optional, default false)
 * @returns {Promise<Object>} Added member
 */
export async function addGroupMember(groupId, data) {
    return workflowRequest(`/workflow/admin/support-groups/${groupId}/members`, {
        method: 'POST',
        body: JSON.stringify({
            userId: data.userId,
            role: data.role,
            canAssign: data.canAssign || false,
            canEscalate: data.canEscalate || false
        })
    });
}

/**
 * Remove a member from a support group
 * @param {number} groupId - Support group ID
 * @param {number} memberId - Group member ID
 * @returns {Promise<Object>} Removal result
 */
export async function removeGroupMember(groupId, memberId) {
    return workflowRequest(`/workflow/admin/support-groups/${groupId}/members/${memberId}`, {
        method: 'DELETE'
    });
}

// ===================================
// 18. ADMIN - ESCALATION RULES
// ===================================

/**
 * Get all escalation rules
 * @returns {Promise<Array>} List of escalation rules
 */
export async function getAllEscalationRules() {
    return workflowRequest('/workflow/admin/escalation-rules', {
        method: 'GET'
    });
}

/**
 * Create a new escalation rule
 * @param {Object} data
 * @param {number} data.sourceGroupId - Source support group ID (REQUIRED)
 * @param {number} data.targetGroupId - Target support group ID (REQUIRED)
 * @param {string} data.triggerType - "SLA"|"MANUAL"|"CRITICAL"|"REOPEN_COUNT" (REQUIRED)
 * @param {number} [data.delayMinutes] - Delay in minutes (optional, default 0)
 * @param {number} [data.priority] - Priority level (optional, default 0)
 * @returns {Promise<Object>} Created escalation rule
 */
export async function createEscalationRule(data) {
    return workflowRequest('/workflow/admin/escalation-rules', {
        method: 'POST',
        body: JSON.stringify({
            sourceGroupId: data.sourceGroupId,
            targetGroupId: data.targetGroupId,
            triggerType: data.triggerType,
            delayMinutes: data.delayMinutes || 0,
            priority: data.priority || 0
        })
    });
}

/**
 * Update an escalation rule
 * @param {number} ruleId - Escalation rule ID
 * @param {Object} data - Fields to update
 * @returns {Promise<Object>} Updated escalation rule
 */
export async function updateEscalationRule(ruleId, data) {
    return workflowRequest(`/workflow/admin/escalation-rules/${ruleId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    });
}

/**
 * Delete an escalation rule
 * @param {number} ruleId - Escalation rule ID
 * @returns {Promise<Object>} Deletion result
 */
export async function deleteEscalationRule(ruleId) {
    return workflowRequest(`/workflow/admin/escalation-rules/${ruleId}`, {
        method: 'DELETE'
    });
}

// ===================================
// LEGACY COMPATIBILITY (if needed)
// ===================================

// Export as default object for backward compatibility
const WorkflowService = {
    // Health
    healthCheck,
    
    // Routing & Assignment
    routeTicket,
    claimTicket,
    getClaimStatus,
    getUnclaimedTickets,
    reassignTicket,
    getReassignmentTargets,
    
    // Escalation
    escalateTicket,
    getEscalationHistory,
    getEscalationPath,
    
    // Logs & Audit
    getWorkflowLogs,
    getAuditTrail,
    
    // Tickets
    getGroupTickets,
    getTechnicianTickets,
    getTicketRouting,
    
    // SLA
    getSLAStatus,
    getSLAReport,
    
    // Metrics & Reports
    getOverviewMetrics,
    getTeamMetrics,
    getEscalationReport,
    
    // Dashboard
    getBuildingDashboard,
    getMemberDashboard,
    getGroupMetrics,
    getRecentActivity,
    
    // Group Management
    getGroupInfo,
    getGroupQueue,
    
    // Admin - Support Groups
    getAllSupportGroups,
    createSupportGroup,
    updateSupportGroup,
    deleteSupportGroup,
    
    // Admin - Members
    getGroupMembers,
    addGroupMember,
    removeGroupMember,
    
    // Admin - Escalation Rules
    getAllEscalationRules,
    createEscalationRule,
    updateEscalationRule,
    deleteEscalationRule
};

Object.freeze(WorkflowService);

export default WorkflowService;
