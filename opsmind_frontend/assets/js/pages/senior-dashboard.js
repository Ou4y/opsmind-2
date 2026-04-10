/**
 * OpsMind - Senior Technician Dashboard Module
 * 
 * Handles senior technician functionality:
 * - View all team tickets
 * - Manage escalated tickets
 * - Reassign tickets to team members
 * - Approve/reject resolutions
 * - Monitor team workload
 */

import UI from '/assets/js/ui.js';
import WorkflowService from '/services/workflowService.js';
import TicketService from '/services/ticketService.js';
import AuthService from '/services/authService.js';

/**
 * Page state
 */
const state = {
    teamTickets: [],
    myTickets: [],
    escalatedTickets: [],
    pendingReview: [],
    teamMembers: [],
    selectedTicket: null,
    currentUser: null,
    teamFilter: 'all',
    isLoading: false,
    refreshInterval: null,
    reassignModal: null
};

/**
 * Initialize the senior dashboard page
 */
export async function initSeniorDashboard() {
    // Wait for app to be ready
    await waitForApp();
    
    // Get current user
    state.currentUser = AuthService.getCurrentUser();
    if (!state.currentUser) {
        window.location.href = '/index.html';
        return;
    }
    
    // Initialize modal
    state.reassignModal = new bootstrap.Modal(document.getElementById('reassignModal'));
    
    // Set up event listeners
    setupEventListeners();
    
    // Load initial data
    await loadDashboardData();
    
    // Set up auto-refresh every 30 seconds
    state.refreshInterval = setInterval(loadDashboardData, 30000);
}

/**
 * Wait for the main app to initialize
 */
function waitForApp() {
    return new Promise((resolve) => {
        if (document.querySelector('.navbar-main')) {
            resolve();
        } else {
            document.addEventListener('app:ready', resolve, { once: true });
        }
    });
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
    // Refresh button
    document.getElementById('refreshDashboard')?.addEventListener('click', async () => {
        UI.showToast('Refreshing dashboard...', 'info');
        await loadDashboardData();
    });

    // Team filter radio buttons
    document.querySelectorAll('input[name="teamFilter"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            state.teamFilter = e.target.value;
            renderTeamTickets();
        });
    });

    // Reassign modal confirm button
    document.getElementById('confirmReassign')?.addEventListener('click', handleReassignConfirm);

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (state.refreshInterval) {
            clearInterval(state.refreshInterval);
        }
    });
}

/**
 * Load all dashboard data
 */
async function loadDashboardData() {
    if (state.isLoading) return;
    
    state.isLoading = true;
    
    try {
        const groupId = state.currentUser.group_id || 1;
        
        // Load all team tickets
        const ticketsResponse = await WorkflowService.getGroupTickets(groupId);
        state.teamTickets = ticketsResponse.data || [];
        
        // Filter my tickets
        state.myTickets = state.teamTickets.filter(t => t.assigned_to === state.currentUser.id);
        
        // Filter escalated tickets
        state.escalatedTickets = state.teamTickets.filter(t => t.status === 'ESCALATED');
        
        // Filter pending review tickets
        state.pendingReview = state.teamTickets.filter(t => t.status === 'RESOLVED');
        
        // Load team members
        try {
            const membersResponse = await WorkflowService.getGroupMembers(groupId);
            state.teamMembers = membersResponse.data || [];
        } catch (error) {
            console.error('Error loading team members:', error);
            state.teamMembers = [];
        }
        
        // Update UI
        updateStatistics();
        renderTeamTickets();
        renderEscalatedTickets();
        renderPendingReview();
        renderMyTickets();
        renderWorkloadDistribution();
        
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        UI.showToast('Failed to load dashboard data', 'error');
    } finally {
        state.isLoading = false;
    }
}

/**
 * Update statistics cards
 */
function updateStatistics() {
    document.getElementById('totalTeamTicketsCount').textContent = state.teamTickets.length;
    document.getElementById('myTicketsCount').textContent = state.myTickets.length;
    document.getElementById('escalatedCount').textContent = state.escalatedTickets.length;
    document.getElementById('pendingReviewCount').textContent = state.pendingReview.length;
    document.getElementById('unassignedCount').textContent = 
        state.teamTickets.filter(t => !t.assigned_to).length;
    
    // Update badges
    document.getElementById('myTicketsBadge').textContent = state.myTickets.length;
    document.getElementById('escalatedBadge').textContent = state.escalatedTickets.length;
    document.getElementById('pendingReviewBadge').textContent = state.pendingReview.length;
}

/**
 * Render team tickets
 */
function renderTeamTickets() {
    const loadingEl = document.getElementById('teamTicketsLoading');
    const emptyEl = document.getElementById('teamTicketsEmpty');
    const listEl = document.getElementById('teamTicketsList');
    
    // Apply filter
    let filteredTickets = state.teamTickets;
    if (state.teamFilter === 'unassigned') {
        filteredTickets = state.teamTickets.filter(t => !t.assigned_to);
    } else if (state.teamFilter === 'active') {
        filteredTickets = state.teamTickets.filter(t => 
            t.status === 'OPEN' || t.status === 'IN_PROGRESS'
        );
    }
    
    loadingEl.style.display = 'none';
    
    if (filteredTickets.length === 0) {
        emptyEl.style.display = 'block';
        listEl.innerHTML = '';
        return;
    }
    
    emptyEl.style.display = 'none';
    listEl.innerHTML = '';
    
    filteredTickets.forEach(ticket => {
        const card = createTicketCard(ticket, 'team');
        listEl.appendChild(card);
    });
}

/**
 * Render escalated tickets
 */
function renderEscalatedTickets() {
    const loadingEl = document.getElementById('escalatedLoading');
    const emptyEl = document.getElementById('escalatedEmpty');
    const listEl = document.getElementById('escalatedList');
    
    loadingEl.style.display = 'none';
    
    if (state.escalatedTickets.length === 0) {
        emptyEl.style.display = 'block';
        listEl.innerHTML = '';
        return;
    }
    
    emptyEl.style.display = 'none';
    listEl.innerHTML = '';
    
    state.escalatedTickets.forEach(ticket => {
        const card = createTicketCard(ticket, 'escalated');
        listEl.appendChild(card);
    });
}

/**
 * Render pending review tickets
 */
function renderPendingReview() {
    const loadingEl = document.getElementById('pendingReviewLoading');
    const emptyEl = document.getElementById('pendingReviewEmpty');
    const listEl = document.getElementById('pendingReviewList');
    
    loadingEl.style.display = 'none';
    
    if (state.pendingReview.length === 0) {
        emptyEl.style.display = 'block';
        listEl.innerHTML = '';
        return;
    }
    
    emptyEl.style.display = 'none';
    listEl.innerHTML = '';
    
    state.pendingReview.forEach(ticket => {
        const card = createReviewCard(ticket);
        listEl.appendChild(card);
    });
}

/**
 * Render my tickets
 */
function renderMyTickets() {
    const loadingEl = document.getElementById('myTicketsLoading');
    const emptyEl = document.getElementById('myTicketsEmpty');
    const listEl = document.getElementById('myTicketsList');
    
    loadingEl.style.display = 'none';
    
    if (state.myTickets.length === 0) {
        emptyEl.style.display = 'block';
        listEl.innerHTML = '';
        return;
    }
    
    emptyEl.style.display = 'none';
    listEl.innerHTML = '';
    
    state.myTickets.forEach(ticket => {
        const card = createTicketCard(ticket, 'my');
        listEl.appendChild(card);
    });
}

/**
 * Render workload distribution
 */
function renderWorkloadDistribution() {
    const container = document.getElementById('workloadDistribution');
    
    if (state.teamMembers.length === 0) {
        container.innerHTML = '<p class="text-muted text-center py-3">Team member data not available</p>';
        return;
    }
    
    // Count tickets per technician
    const workload = {};
    state.teamMembers.forEach(member => {
        workload[member.user_id] = {
            name: member.username || `User #${member.user_id}`,
            role: member.role,
            count: 0
        };
    });
    
    state.teamTickets.forEach(ticket => {
        if (ticket.assigned_to && workload[ticket.assigned_to]) {
            workload[ticket.assigned_to].count++;
        }
    });
    
    const maxCount = Math.max(...Object.values(workload).map(w => w.count), 1);
    
    let html = '<div class="list-group list-group-flush">';
    
    Object.entries(workload).forEach(([userId, data]) => {
        const percentage = (data.count / maxCount) * 100;
        const roleClass = data.role === 'SENIOR' ? 'text-primary' : 'text-secondary';
        
        html += `
            <div class="list-group-item">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <div>
                        <strong>${UI.escapeHTML(data.name)}</strong>
                        <span class="badge bg-light ${roleClass} ms-2">${data.role}</span>
                    </div>
                    <span class="badge bg-primary">${data.count} tickets</span>
                </div>
                <div class="progress" style="height: 10px;">
                    <div class="progress-bar" role="progressbar" 
                         style="width: ${percentage}%" 
                         aria-valuenow="${data.count}" 
                         aria-valuemin="0" 
                         aria-valuemax="${maxCount}">
                    </div>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

/**
 * Create a ticket card element
 */
function createTicketCard(ticket, type) {
    const isEscalated = ticket.status === 'ESCALATED';
    
    const card = document.createElement('div');
    card.className = `card mb-3 ${isEscalated ? 'border-danger' : ''}`;
    
    card.innerHTML = `
        <div class="card-body">
            <div class="row align-items-start">
                <div class="col-lg-8">
                    <div class="d-flex align-items-center mb-2 flex-wrap gap-2">
                        <h5 class="card-title mb-0">#${UI.escapeHTML(ticket.id)}</h5>
                        <span class="badge ${getPriorityBadgeClass(ticket.priority)}">${UI.escapeHTML(ticket.priority)}</span>
                        <span class="badge ${getStatusBadgeClass(ticket.status)}">${UI.escapeHTML(ticket.status)}</span>
                        ${isEscalated ? '<span class="badge bg-danger"><i class="bi bi-exclamation-triangle me-1"></i> ESCALATED</span>' : ''}
                    </div>
                    <h6 class="card-subtitle mb-2">${UI.escapeHTML(ticket.title)}</h6>
                    <div class="text-muted small">
                        <div><i class="bi bi-geo-alt me-1"></i> ${UI.escapeHTML(ticket.building)} - Floor ${ticket.floor} - Room ${ticket.room}</div>
                        <div><i class="bi bi-person me-1"></i> Requester: ${UI.escapeHTML(ticket.requester_name || 'N/A')}</div>
                        ${ticket.assigned_to ? `<div><i class="bi bi-person-badge me-1"></i> Assigned to: User #${ticket.assigned_to}</div>` : '<div><i class="bi bi-inbox me-1"></i> Unassigned</div>'}
                        <div><i class="bi bi-calendar me-1"></i> Created: ${UI.formatDate(ticket.created_at)}</div>
                    </div>
                </div>
                <div class="col-lg-4 text-lg-end mt-3 mt-lg-0">
                    <div class="d-flex flex-column gap-2">
                        <button class="btn btn-sm btn-primary" onclick="window.viewTicketDetails('${ticket.id}')">
                            <i class="bi bi-eye me-1"></i> View
                        </button>
                        ${(type === 'team' || type === 'escalated') && (AuthService.isSenior() || AuthService.isSupervisor() || AuthService.isAdmin()) ? `
                            <button class="btn btn-sm btn-warning" onclick="window.showReassignModal('${ticket.id}')">
                                <i class="bi bi-arrow-left-right me-1"></i> Reassign
                            </button>
                        ` : ''}
                        ${type === 'escalated' && (AuthService.isSenior() || AuthService.isSupervisor() || AuthService.isAdmin()) ? `
                            <button class="btn btn-sm btn-success" onclick="window.claimTicket('${ticket.id}')">
                                <i class="bi bi-hand-index me-1"></i> Claim & Handle
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    return card;
}

/**
 * Create a review card element
 */
function createReviewCard(ticket) {
    const card = document.createElement('div');
    card.className = 'card mb-3 border-warning';
    
    card.innerHTML = `
        <div class="card-body">
            <div class="row align-items-start">
                <div class="col-lg-8">
                    <div class="d-flex align-items-center mb-2 flex-wrap gap-2">
                        <h5 class="card-title mb-0">#${UI.escapeHTML(ticket.id)}</h5>
                        <span class="badge ${getPriorityBadgeClass(ticket.priority)}">${UI.escapeHTML(ticket.priority)}</span>
                        <span class="badge bg-success">RESOLVED</span>
                        <span class="badge bg-warning text-dark"><i class="bi bi-clock-history me-1"></i> Pending Review</span>
                    </div>
                    <h6 class="card-subtitle mb-2">${UI.escapeHTML(ticket.title)}</h6>
                    <div class="text-muted small">
                        <div><i class="bi bi-geo-alt me-1"></i> ${UI.escapeHTML(ticket.building)} - Floor ${ticket.floor} - Room ${ticket.room}</div>
                        <div><i class="bi bi-person-badge me-1"></i> Resolved by: User #${ticket.assigned_to}</div>
                        <div><i class="bi bi-calendar me-1"></i> Resolved: ${UI.formatDate(ticket.updated_at)}</div>
                    </div>
                </div>
                <div class="col-lg-4 text-lg-end mt-3 mt-lg-0">
                    <div class="d-flex flex-column gap-2">
                        <button class="btn btn-sm btn-primary" onclick="window.viewTicketDetails('${ticket.id}')">
                            <i class="bi bi-eye me-1"></i> View Details
                        </button>
                        <button class="btn btn-sm btn-success" onclick="window.approveResolution('${ticket.id}')">
                            <i class="bi bi-check-circle me-1"></i> Approve & Close
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="window.rejectResolution('${ticket.id}')">
                            <i class="bi bi-x-circle me-1"></i> Reject
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    return card;
}

/**
 * Get priority badge class
 */
function getPriorityBadgeClass(priority) {
    switch (priority?.toUpperCase()) {
        case 'CRITICAL': return 'bg-danger';
        case 'HIGH': return 'bg-orange';
        case 'MEDIUM': return 'bg-warning text-dark';
        case 'LOW': return 'bg-success';
        default: return 'bg-secondary';
    }
}

/**
 * Get status badge class
 */
function getStatusBadgeClass(status) {
    switch (status?.toUpperCase()) {
        case 'OPEN': return 'bg-info';
        case 'IN_PROGRESS': return 'bg-purple';
        case 'RESOLVED': return 'bg-success';
        case 'CLOSED': return 'bg-secondary';
        case 'ESCALATED': return 'bg-danger';
        default: return 'bg-secondary';
    }
}

/**
 * Show reassign modal
 */
window.showReassignModal = function(ticketId) {
    document.getElementById('reassignTicketId').value = ticketId;
    document.getElementById('reassignReason').value = '';
    
    // Populate technician dropdown
    const select = document.getElementById('reassignTechnician');
    select.innerHTML = '<option value="">Choose technician...</option>';
    
    state.teamMembers.forEach(member => {
        const option = document.createElement('option');
        option.value = member.user_id;
        option.textContent = `${member.username || `User #${member.user_id}`} - ${member.role}`;
        select.appendChild(option);
    });
    
    state.reassignModal.show();
};

/**
 * Handle reassign confirmation
 */
async function handleReassignConfirm() {
    const ticketId = document.getElementById('reassignTicketId').value;
    const technicianId = document.getElementById('reassignTechnician').value;
    const reason = document.getElementById('reassignReason').value;
    
    if (!technicianId) {
        UI.showToast('Please select a technician', 'warning');
        return;
    }
    
    if (!reason || reason.trim() === '') {
        UI.showToast('Please provide a reason for reassignment', 'warning');
        return;
    }
    
    UI.showToast('Reassigning ticket...', 'info');
    
    try {
        await WorkflowService.reassignTicket(ticketId, {
            to_technician_id: parseInt(technicianId),
            reason: reason,
            reassigned_by: state.currentUser.id
        });
        
        UI.showToast('Ticket reassigned successfully!', 'success');
        state.reassignModal.hide();
        await loadDashboardData();
    } catch (error) {
        console.error('Error reassigning ticket:', error);
        UI.showToast(error.message || 'Failed to reassign ticket', 'error');
    }
}

/**
 * Claim ticket (for escalated tickets)
 */
window.claimTicket = async function(ticketId) {
    if (!confirm('Are you sure you want to claim and handle this escalated ticket?')) {
        return;
    }
    
    UI.showToast('Claiming ticket...', 'info');
    
    try {
        await WorkflowService.claimTicket(ticketId, state.currentUser.id);
        UI.showToast('Ticket claimed successfully!', 'success');
        await loadDashboardData();
    } catch (error) {
        console.error('Error claiming ticket:', error);
        UI.showToast(error.message || 'Failed to claim ticket', 'error');
    }
};

/**
 * Approve resolution
 */
window.approveResolution = async function(ticketId) {
    if (!confirm('Are you sure you want to approve this resolution and close the ticket?')) {
        return;
    }
    
    UI.showToast('Approving resolution...', 'info');
    
    try {
        await TicketService.updateTicket(ticketId, {
            status: 'CLOSED',
            closed_by: state.currentUser.id,
            closed_at: new Date().toISOString()
        });
        
        UI.showToast('Resolution approved, ticket closed!', 'success');
        await loadDashboardData();
    } catch (error) {
        console.error('Error approving resolution:', error);
        UI.showToast(error.message || 'Failed to approve resolution', 'error');
    }
};

/**
 * Reject resolution
 */
window.rejectResolution = async function(ticketId) {
    const reason = prompt('Enter reason for rejecting this resolution:');
    if (!reason || reason.trim() === '') {
        UI.showToast('Please provide a reason for rejection', 'warning');
        return;
    }
    
    UI.showToast('Rejecting resolution...', 'info');
    
    try {
        await TicketService.updateTicket(ticketId, {
            status: 'IN_PROGRESS',
            rejection_reason: reason
        });
        
        UI.showToast('Resolution rejected, ticket reopened!', 'success');
        await loadDashboardData();
    } catch (error) {
        console.error('Error rejecting resolution:', error);
        UI.showToast(error.message || 'Failed to reject resolution', 'error');
    }
};

/**
 * View ticket details
 */
window.viewTicketDetails = async function(ticketId) {
    // For now, just show an alert. You can implement a modal or redirect to tickets page
    UI.showToast('Ticket details view - to be implemented', 'info');
    // window.location.href = `/tickets.html?id=${ticketId}`;
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSeniorDashboard);
} else {
    initSeniorDashboard();
}

// Export for use in other modules
export default {
    initSeniorDashboard,
    loadDashboardData
};
