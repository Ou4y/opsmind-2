/**
 * OpsMind - Junior Technician Dashboard Module
 * 
 * Handles junior technician functionality:
 * - View tickets assigned to the logged-in technician
 * - Update ticket status (OPEN → IN_PROGRESS → RESOLVED)
 * - Escalate to senior
 * - View workflow history
 */

import UI from '/assets/js/ui.js';
import WorkflowService, { getJuniorOverview, getJuniorTickets, getJuniorTicketDetails } from '/services/workflowService.js';
import { renderTicketDetailsInto, getTicketLocationDisplay } from '/assets/js/components/ticketDetailsModal.js';
import TicketService from '/services/ticketService.js';
import AuthService from '/services/authService.js';

/**
 * Page state
 */
const state = {
    myTickets: [],
    selectedTicket: null,
    selectedTicketDetails: null,
    overview: null,
    workflowLogs: [],
    slaData: {},
    currentUser: null,
    currentWorkflowTechnicianId: null,
    dashboardContext: null,
    isLoading: false,
    refreshInterval: null,
    locationWatchId: null
};

const geoOptions = { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 };

/**
 * Initialize the junior dashboard page
 */
export async function initJuniorDashboard() {
    // Wait for app to be ready
    await waitForApp();
    
    // Get current user
    state.currentUser = AuthService.getCurrentUser();
    if (!state.currentUser) {
        window.location.href = '/index.html';
        return;
    }

    state.dashboardContext = AuthService.resolveUserDashboardContext(state.currentUser);
    if (state.dashboardContext.dashboardType !== 'junior') {
        if (redirectToDashboard(state.dashboardContext)) return;
        showWorkflowProfileError('Workflow profile not found or incomplete. Please logout and login again.');
        return;
    }

    if (!state.dashboardContext.workflowUserId) {
        showWorkflowProfileError('Workflow profile not found or incomplete. Please logout and login again.');
        return;
    }

    state.currentWorkflowTechnicianId = String(state.dashboardContext.workflowUserId);

    // Start continuous location tracking
    startLocationTracking();
    
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

    // Back to tickets button
    document.getElementById('backToTickets')?.addEventListener('click', () => {
        state.selectedTicket = null;
        state.selectedTicketDetails = null;
        document.getElementById('detailsTabItem').style.display = 'none';
        const myTicketsTab = new bootstrap.Tab(document.getElementById('my-tickets-tab'));
        myTicketsTab.show();
    });

    // Tab change events (no-op: Available to Claim tab has been removed)

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (state.refreshInterval) {
            clearInterval(state.refreshInterval);
        }
        stopLocationTracking();
    });
}

/**
 * Load all dashboard data
 */
async function loadDashboardData() {
    if (state.isLoading) return;
    
    state.isLoading = true;
    
    try {
        // Load my tickets
        await loadMyTickets();
        
        // Update statistics
        updateStatistics();
        
    } catch (error) {
        console.error('[Junior Dashboard] Unexpected error loading dashboard data:', error);
        if (error?.status === 403) {
            UI.showToast('You do not have access to this dashboard.', 'error');
        } else {
            UI.showToast('Failed to load assigned tickets. Check Workflow Service connection.', 'error');
        }
    } finally {
        state.isLoading = false;
    }
}

/**
 * Resolve the workflow user_id for the logged-in technician.
 * Auth service identity is UUID-based, while workflow assignment uses numeric user_id.
 */
function resolveWorkflowTechnicianId() {
    if (state.currentWorkflowTechnicianId) {
        return state.currentWorkflowTechnicianId;
    }

    if (!state.dashboardContext?.workflowUserId) {
        showWorkflowProfileError('Workflow profile not found or incomplete. Please logout and login again.');
        return null;
    }

    state.currentWorkflowTechnicianId = String(state.dashboardContext.workflowUserId);
    return state.currentWorkflowTechnicianId;
}

function showWorkflowProfileError(message = 'Workflow profile not found or incomplete. Please logout and login again.') {
    const loadingEl = document.getElementById('myTicketsLoading');
    const emptyEl = document.getElementById('myTicketsEmpty');

    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl) {
        emptyEl.style.display = 'block';
        const messageEl = emptyEl.querySelector('p');
        if (messageEl) {
            messageEl.textContent = message;
        }
    }

    UI.showToast(message, 'error');
}

function redirectToDashboard(context) {
    const targetPath = context?.dashboardPath || '';
    if (targetPath && window.location.pathname !== targetPath) {
        window.location.href = targetPath;
        return true;
    }
    return false;
}

/**
 * Load my assigned tickets
 */
async function loadMyTickets() {
    // Grab DOM references first — all three are required; guard against missing elements
    const loadingEl = document.getElementById('myTicketsLoading');
    const emptyEl   = document.getElementById('myTicketsEmpty');
    const listEl    = document.getElementById('myTicketsList');

    try {
        if (loadingEl) loadingEl.style.display = 'block';
        if (emptyEl) {
            emptyEl.style.display = 'none';
            const messageEl = emptyEl.querySelector('p');
            if (messageEl) {
                messageEl.textContent = 'No tickets assigned to you yet. Tickets are automatically assigned by the system.';
            }
        }
        if (listEl)    listEl.innerHTML         = '';

        console.log('═══════════════════════════════════════════');
        console.log('[Junior Dashboard] Loading My Tickets');
        console.log('[Junior Dashboard] Current User object:', state.currentUser);

        const currentTechnicianId = resolveWorkflowTechnicianId();

        console.log('[Junior Dashboard] Resolved currentTechnicianId:', currentTechnicianId);

        if (!currentTechnicianId) {
            console.error('[Junior Dashboard] Cannot resolve technician ID from user object:', state.currentUser);
            if (loadingEl) loadingEl.style.display = 'none';
            if (emptyEl)   emptyEl.style.display   = 'block';
            return;
        }

        const [overviewResponse, ticketsResponse] = await Promise.all([
            getJuniorOverview(currentTechnicianId),
            getJuniorTickets(currentTechnicianId, { limit: 50, offset: 0 })
        ]);

        if (!overviewResponse?.success || !overviewResponse?.data) {
            throw new Error(overviewResponse?.message || 'Failed to load overview data');
        }

        if (!ticketsResponse?.success || !ticketsResponse?.data) {
            throw new Error(ticketsResponse?.message || 'Failed to load tickets');
        }

        state.overview = overviewResponse.data;

        const tickets = Array.isArray(ticketsResponse.data.items) ? ticketsResponse.data.items : [];
        console.log('[Junior Dashboard] Raw tickets from API:', tickets);

        state.myTickets = tickets.map((ticket) => normalizeJuniorTicket(ticket));
        state.slaData = {};

        console.log('[Junior Dashboard] state.myTickets after normalization:', state.myTickets.length, 'tickets');
        state.myTickets.forEach((t) => {
            console.log(`  [ticket ${t.id}] status=${t.status} normalizedAssignedId=${t.normalizedAssignedTechnicianId}`);
        });
        console.log('═══════════════════════════════════════════');
        
        if (state.myTickets.length === 0) {
            loadingEl.style.display = 'none';
            emptyEl.style.display = 'block';
            return;
        }
        
        loadingEl.style.display = 'none';
        renderMyTickets();
        
    } catch (error) {
        console.error('═══ ERROR ═══');
        console.error('[Junior Dashboard] Failed to load assigned tickets:', error.message);
        if (error.status || error.statusCode) {
            console.error('[Junior Dashboard] HTTP status:', error.status || error.statusCode);
        }
        console.error('[Junior Dashboard] Full error:', error);
        console.error('═══════════════');
        if (loadingEl) loadingEl.style.display = 'none';
        if (emptyEl)   emptyEl.style.display   = 'block';
        if (error?.status === 403) {
            UI.showToast('You do not have access to this dashboard.', 'error');
        } else {
            UI.showToast('Failed to load assigned tickets. Check Workflow Service connection.', 'error');
        }
        // Do NOT re-throw: optional metrics (SLA, etc.) must not block showing the page.
        // loadDashboardData() will only show its toast if something else throws after this.
    }
}

function normalizeJuniorTicket(ticket) {
    const ticketId = ticket.ticketId || ticket.id;
    const assignedTo = ticket.assignedTo ?? ticket.assigned_to ?? null;

    return {
        ...ticket,
        id: ticketId,
        created_at: ticket.createdAt || ticket.created_at,
        updated_at: ticket.updatedAt || ticket.updated_at,
        requester_name: ticket.requesterName || ticket.requester_name,
        assigned_to: assignedTo,
        assigned_to_name: ticket.assignedToName || ticket.assigned_to_name,
        assignedToName: ticket.assignedToName || ticket.assigned_to_name,
        assignedToEmail: ticket.assignedToEmail,
        assignedToLevel: ticket.assignedToLevel,
        normalizedAssignedTechnicianId: String(assignedTo ?? ''),
        building: ticket.building,
        room: ticket.room
    };
}

/**
 * Render my tickets list
 */
function renderMyTickets() {
    const listEl = document.getElementById('myTicketsList');
    listEl.innerHTML = '';
    
    state.myTickets.forEach(ticket => {
        const ticketCard = createTicketCard(ticket, 'my');
        listEl.appendChild(ticketCard);
    });
}

// renderAvailableTickets() removed — no available-tickets tab in this dashboard.

/**
 * Create a ticket card element
 */
function createTicketCard(ticket, type) {
    const sla = state.slaData[ticket.id];
    const isEscalated = ticket.status === 'ESCALATED';
    const locationLabel = getTicketLocationDisplay(ticket);
    
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
                        ${sla ? renderSLABadge(sla) : ''}
                    </div>
                    <h6 class="card-subtitle mb-2">${UI.escapeHTML(ticket.title)}</h6>
                    <div class="text-muted small">
                        <div><i class="bi bi-geo-alt me-1"></i> Location: ${UI.escapeHTML(locationLabel)}</div>
                        <div><i class="bi bi-person me-1"></i> Requester: ${UI.escapeHTML(ticket.requester_name || 'N/A')}</div>
                        ${ticket.assigned_to ? `<div><i class="bi bi-person-badge me-1"></i> Assigned to: ${UI.escapeHTML(ticket.assigned_to_name || ticket.assignedToName || `Technician #${ticket.assigned_to}`)}</div>` : ''}
                        <div><i class="bi bi-calendar me-1"></i> Created: ${UI.formatDate(ticket.created_at)}</div>
                    </div>
                </div>
                <div class="col-lg-4 text-lg-end mt-3 mt-lg-0">
                    <div class="d-flex flex-column gap-2">
                        <button class="btn btn-sm btn-primary" onclick="window.viewTicketDetails('${ticket.id}')">
                            <i class="bi bi-eye me-1"></i> View Details
                        </button>
                        ${type === 'my' ? renderMyTicketActions(ticket) : ''}
                        ${type === 'available' ? renderAvailableTicketActions(ticket) : ''}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    return card;
}

/**
 * Render actions for my tickets
 */
function renderMyTicketActions(ticket) {
    let actions = '';
    
    // Status update buttons - visible for TECHNICIAN and above
    if (AuthService.isTechnician() || AuthService.isSenior() || AuthService.isSupervisor()) {
        // All tickets in state.myTickets are already assigned to the current user.
        // No need to re-check assigned_to here.
        if (ticket.status === 'OPEN') {
            actions += `
                <button class="btn btn-sm btn-purple" onclick="window.updateTicketStatus('${ticket.id}', 'IN_PROGRESS')">
                    <i class="bi bi-play-circle me-1"></i> Start Working
                </button>
            `;
        }

        if (ticket.status === 'IN_PROGRESS') {
            actions += `
                <button class="btn btn-sm btn-success" onclick="window.updateTicketStatus('${ticket.id}', 'RESOLVED')">
                    <i class="bi bi-check-circle me-1"></i> Resolve Ticket
                </button>
            `;
        }
    }
    
    // Escalate button - visible for TECHNICIAN, SENIOR, and SUPERVISOR
    // (Students and Doctors cannot escalate)
    if (AuthService.isTechnician() || AuthService.isSenior() || AuthService.isSupervisor()) {
        actions += `
            <button class="btn btn-sm btn-warning" onclick="window.escalateTicket('${ticket.id}')">
                <i class="bi bi-arrow-up-circle me-1"></i> Escalate
            </button>
        `;
    }
    
    return actions;
}

/**
 * Render actions for available tickets
 * NOTE: Available to Claim tab has been removed. This function is no longer called.
 * Tickets are auto-assigned by the Workflow Service; no manual claiming is needed.
 */
function renderAvailableTicketActions(_ticket) {
    return '';
}

/**
 * Render SLA badge
 */
function renderSLABadge(sla) {
    if (sla.sla_breached) {
        return '<span class="badge bg-danger"><i class="bi bi-exclamation-triangle me-1"></i> SLA BREACHED</span>';
    }
    if (sla.at_risk) {
        return `<span class="badge bg-warning text-dark"><i class="bi bi-clock me-1"></i> At Risk (${sla.time_remaining || 'N/A'})</span>`;
    }
    return `<span class="badge bg-success"><i class="bi bi-check me-1"></i> On Track (${sla.time_remaining || 'N/A'})</span>`;
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
 * Resolve the assignment field from a ticket, normalizing all possible backend field names.
 * @param {Object} ticket
 * @returns {string}
 */
function getAssignedTechnicianId(ticket) {
    return String(
        ticket.normalizedAssignedTechnicianId ??
        ticket.assigned_to ??
        ticket.assignedTo ??
        ticket.assignedTechnicianId ??
        ticket.technicianId ??
        ticket.assignee_id ??
        ticket.assigned_user_id ??
        ''
    );
}

/**
 * Update statistics cards.
 *
 * Shared filtering rule:
 *   assignedTickets  = allTickets where getAssignedTechnicianId(t) === currentTechnicianId
 *   openTickets      = assignedTickets where status === "OPEN"
 *   inProgressTickets= assignedTickets where status === "IN_PROGRESS"
 *   activeTickets    = assignedTickets where status in ["OPEN", "IN_PROGRESS"]
 *
 * state.myTickets is already the assignedTickets set (filtered at fetch time).
 */
function updateStatistics() {
    const currentTechnicianId = String(state.currentWorkflowTechnicianId || '');

    // Shared dashboard rule
    const assignedTickets   = state.myTickets.filter(t =>
        getAssignedTechnicianId(t) === currentTechnicianId
    );
    const openTickets        = assignedTickets.filter(t => t.status === 'OPEN');
    const inProgressTickets  = assignedTickets.filter(t => t.status === 'IN_PROGRESS');
    const activeTickets      = assignedTickets.filter(t =>
        t.status === 'OPEN' || t.status === 'IN_PROGRESS'
    );

    const myActiveEl = document.getElementById('myActiveTicketsCount');
    if (myActiveEl) myActiveEl.textContent = activeTickets.length;

    const openTicketsCountEl = document.getElementById('openTicketsCount');
    if (openTicketsCountEl) openTicketsCountEl.textContent = openTickets.length;

    // Tab badge shows active (OPEN + IN_PROGRESS) tickets
    const badgeEl = document.getElementById('myTicketsBadge');
    if (badgeEl) badgeEl.textContent = activeTickets.length;

    // availableTicketsCount / availableBadge removed from DOM — guard against missing elements
    const availableTicketsCountEl = document.getElementById('availableTicketsCount');
    if (availableTicketsCountEl) availableTicketsCountEl.textContent = 0;
    const availableBadgeEl = document.getElementById('availableBadge');
    if (availableBadgeEl) availableBadgeEl.textContent = 0;

    const slaRisk = state.overview
        ? (state.overview.slaAtRiskTickets || 0) + (state.overview.slaBreachedTickets || 0)
        : Object.values(state.slaData).filter(s => s?.at_risk || s?.sla_breached).length;
    document.getElementById('slaRiskCount').textContent = slaRisk;

    const today = new Date().toDateString();
    const resolvedToday = assignedTickets.filter(t => {
        if (t.status !== 'RESOLVED') return false;
        const resolvedDate = t.updated_at || t.updatedAt || t.resolved_at || t.resolvedAt;
        if (!resolvedDate) return false;
        return new Date(resolvedDate).toDateString() === today;
    }).length;
    document.getElementById('resolvedTodayCount').textContent = resolvedToday;

    // Expose counts for debugging
    console.log('[Junior Dashboard] Stats — assigned:', assignedTickets.length,
        '| open:', openTickets.length,
        '| inProgress:', inProgressTickets.length,
        '| active:', activeTickets.length,
        '| slaRisk:', slaRisk,
        '| resolvedToday:', resolvedToday);
}

// claimTicket() removed: tickets are auto-assigned by the Workflow Service.
// Junior Technicians no longer manually claim tickets.

/**
 * Update ticket status
 */
window.updateTicketStatus = async function(ticketId, newStatus) {
    UI.showToast('Updating ticket status...', 'info');
    
    try {
        await TicketService.updateTicket(ticketId, { status: newStatus });
        UI.showToast('Ticket status updated!', 'success');
        await loadDashboardData();
        
        // If viewing details, refresh the details
        if (state.selectedTicket?.id === ticketId) {
            await viewTicketDetails(ticketId);
        }
    } catch (error) {
        console.error('Error updating ticket status:', error);
        UI.showToast(error.message || 'Failed to update ticket status', 'error');
    }
};

/**
 * Escalate ticket
 */
window.escalateTicket = async function(ticketId) {
    const reason = prompt('Enter reason for escalation:');
    if (!reason || reason.trim() === '') {
        UI.showToast('Please provide a reason for escalation', 'warning');
        return;
    }
    
    UI.showToast('Escalating ticket...', 'info');
    
    try {
        const performerIdCandidate = await resolveWorkflowTechnicianId();
        const performerId = Number(performerIdCandidate);
        const userRole = String(
            state.currentUser?.technicianLevel ||
            state.currentUser?.level ||
            AuthService.getTechnicianLevel() ||
            'JUNIOR'
        ).toUpperCase();

        await WorkflowService.escalateTicket(ticketId, {
            reason: reason.trim(),
            escalatedBy: Number.isFinite(performerId) ? performerId : undefined,
            userRole
        });

        const escalationTargets = {
            JUNIOR: 'senior',
            SENIOR: 'supervisor',
            SUPERVISOR: 'admin'
        };
        const targetLabel = escalationTargets[userRole] || 'next-level support';

        UI.showToast(`Ticket escalated to ${targetLabel} successfully!`, 'success');
        await loadDashboardData();
        
        // Return to my tickets tab
        state.selectedTicket = null;
        document.getElementById('detailsTabItem').style.display = 'none';
        const myTicketsTab = new bootstrap.Tab(document.getElementById('my-tickets-tab'));
        myTicketsTab.show();
    } catch (error) {
        console.error('Error escalating ticket:', error);
        UI.showToast(error.message || 'Failed to escalate ticket', 'error');
    }
};

/**
 * View ticket details
 */
window.viewTicketDetails = async function(ticketId) {
    const workflowUserId = resolveWorkflowTechnicianId();
    if (!workflowUserId) return;

    const ticket = state.myTickets.find(t => String(t.id) === String(ticketId));

    if (!ticket) {
        UI.showToast('Ticket not found', 'error');
        return;
    }

    state.selectedTicket = ticket;

    const loading = UI.showLoading('Loading ticket details...');

    try {
        const detailsResponse = await getJuniorTicketDetails(workflowUserId, ticketId);
        if (!detailsResponse?.success || !detailsResponse?.data) {
            throw new Error(detailsResponse?.message || 'Failed to load ticket details');
        }

        state.selectedTicketDetails = detailsResponse.data;
    } catch (error) {
        console.error('Error loading ticket details:', error);
        if (error?.status === 403) {
            UI.showToast('You do not have access to this dashboard.', 'error');
        } else {
            UI.showToast(error.message || 'Failed to load ticket details', 'error');
        }
        state.selectedTicketDetails = null;
    } finally {
        loading.hide();
    }

    // Show details tab
    document.getElementById('detailsTabItem').style.display = 'block';
    const detailsTab = new bootstrap.Tab(document.getElementById('details-tab'));
    detailsTab.show();

    renderTicketDetails();
};

/**
 * Render ticket details
 */
function renderTicketDetails() {
    const detailsEl = document.getElementById('ticketDetailsContent');
    const details = state.selectedTicketDetails;

    if (!detailsEl) return;

    if (!details) {
        detailsEl.innerHTML = '<p class="text-muted">No ticket details available.</p>';
        return;
    }

    renderTicketDetailsInto(detailsEl, details);

    if (state.selectedTicket) {
        const actionsWrapper = document.createElement('div');
        actionsWrapper.className = 'mt-3 d-flex gap-2 flex-wrap';
        actionsWrapper.innerHTML = renderMyTicketActions(state.selectedTicket);
        detailsEl.appendChild(actionsWrapper);
    }
}

/**
 * Render workflow timeline
 */
function renderWorkflowTimeline() {
    // Ensure workflowLogs is a valid array
    const logs = Array.isArray(state.workflowLogs) ? state.workflowLogs : [];
    
    if (logs.length === 0) {
        return '<p class="text-muted text-center py-3">No workflow history available</p>';
    }
    
    let html = '<div class="timeline">';
    
    logs.forEach((log, index) => {
        const icon = getActionIcon(log.action);
        const color = getActionColor(log.action);
        
        html += `
            <div class="timeline-item">
                <div class="timeline-marker" style="background-color: ${color};">
                    <i class="bi ${icon}"></i>
                </div>
                <div class="timeline-content">
                    <div class="d-flex justify-content-between align-items-start mb-1">
                        <strong style="color: ${color};">${UI.escapeHTML(log.action)}</strong>
                        <small class="text-muted">${UI.formatDate(log.created_at)}</small>
                    </div>
                    <div class="text-muted small">
                        ${log.performed_by ? `<div>👤 By: ${UI.escapeHTML(log.performed_by_name || log.performedByName || `User #${log.performed_by}`)}</div>` : ''}
                        ${log.from_group_id && log.to_group_id ? `<div>📦 From Group #${log.from_group_id} → Group #${log.to_group_id}</div>` : ''}
                        ${log.from_member_id && log.to_member_id ? `<div>👥 From Member #${log.from_member_id} → Member #${log.to_member_id}</div>` : ''}
                        ${log.reason ? `<div class="mt-1 fst-italic">💬 ${UI.escapeHTML(log.reason)}</div>` : ''}
                    </div>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    return html;
}

/**
 * Get action icon
 */
function getActionIcon(action) {
    switch (action) {
        case 'CREATED': return 'bi-file-plus';
        case 'ROUTED': return 'bi-arrow-repeat';
        case 'CLAIMED': return 'bi-hand-index';
        case 'REASSIGNED': return 'bi-people';
        case 'ESCALATED': return 'bi-arrow-up-circle';
        case 'RESOLVED': return 'bi-check-circle';
        case 'CLOSED': return 'bi-lock';
        case 'REOPENED': return 'bi-unlock';
        default: return 'bi-circle';
    }
}

/**
 * Get action color
 */
function getActionColor(action) {
    switch (action) {
        case 'CREATED': return '#0d6efd';
        case 'ROUTED': return '#6610f2';
        case 'CLAIMED': return '#198754';
        case 'REASSIGNED': return '#fd7e14';
        case 'ESCALATED': return '#dc3545';
        case 'RESOLVED': return '#198754';
        case 'CLOSED': return '#6c757d';
        case 'REOPENED': return '#ffc107';
        default: return '#6c757d';
    }
}

/**
 * Start watching technician location
 */
function startLocationTracking() {
    if (state.locationWatchId !== null) return state.locationWatchId;

    if (!state.currentUser || !state.currentUser.id) {
        console.warn('Cannot start location tracking: missing technician id');
        return null;
    }

    if (!('geolocation' in navigator)) {
        UI.showToast('Geolocation is not supported by this browser.', 'error');
        return null;
    }

    state.locationWatchId = navigator.geolocation.watchPosition(
        position => sendLocationUpdate(state.currentWorkflowTechnicianId || state.currentUser.id, position.coords),
        handleLocationError,
        geoOptions
    );

    return state.locationWatchId;
}

/**
 * Send location update to backend
 * Note: This endpoint may not be implemented on the backend yet.
 * Gracefully handles errors to prevent blocking the UI.
 */
async function sendLocationUpdate(technicianId, coords) {
    try {
        const workflowApiBase = (window.OPSMIND_WORKFLOW_API_URL || 'http://localhost:3003').replace(/\/+$/, '');
        const workflowTechnicianId = Number(technicianId);

        if (!Number.isFinite(workflowTechnicianId)) {
            console.warn('Skipping location update: workflow technician ID is missing or invalid.', technicianId);
            return;
        }

        const response = await fetch(`${workflowApiBase}/workflow/technicians/location`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                technician_id: workflowTechnicianId,
                latitude: coords.latitude,
                longitude: coords.longitude
            })
        });

        if (!response.ok) {
            // If endpoint doesn't exist (404), log but don't show error to user
            if (response.status === 404) {
                console.warn('Location tracking endpoint not available (404). Location tracking disabled.');
                stopLocationTracking();
                return;
            }
            const detail = await response.text().catch(() => '');
            throw new Error(detail || `HTTP ${response.status}`);
        }
        console.log('Location updated successfully');
    } catch (error) {
        console.error('Error sending location update:', error);
        // Don't show toast for network errors to avoid spamming user
        // UI.showToast('Failed to update location.', 'error');
    }
}

/**
 * Stop watching technician location
 */
function stopLocationTracking() {
    if (state.locationWatchId !== null) {
        navigator.geolocation.clearWatch(state.locationWatchId);
        state.locationWatchId = null;
    }
}

/**
 * Handle geolocation errors
 */
function handleLocationError(error) {
    switch (error.code) {
        case error.PERMISSION_DENIED:
            UI.showToast('Location permission denied.', 'error');
            stopLocationTracking();
            break;
        case error.POSITION_UNAVAILABLE:
            UI.showToast('Location unavailable.', 'warning');
            break;
        case error.TIMEOUT:
            UI.showToast('Location request timed out.', 'warning');
            break;
        default:
            UI.showToast('Unable to retrieve location.', 'error');
    }
    console.error('Geolocation error:', error);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initJuniorDashboard);
} else {
    initJuniorDashboard();
}

// Export for use in other modules
export default {
    initJuniorDashboard,
    loadDashboardData,
    startLocationTracking,
    stopLocationTracking,
    sendLocationUpdate
};
