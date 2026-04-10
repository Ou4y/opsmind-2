/**
 * OpsMind - Junior Technician Dashboard Module
 * 
 * Handles junior technician functionality:
 * - View assigned tickets
 * - Claim available tickets
 * - Update ticket status
 * - Escalate to senior
 * - View workflow history
 */

import UI from '/assets/js/ui.js';
import WorkflowService from '/services/workflowService.js';
import TicketService from '/services/ticketService.js';
import AuthService from '/services/authService.js';

/**
 * Page state
 */
const state = {
    myTickets: [],
    availableTickets: [],
    selectedTicket: null,
    workflowLogs: [],
    slaData: {},
    currentUser: null,
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
        document.getElementById('detailsTabItem').style.display = 'none';
        const myTicketsTab = new bootstrap.Tab(document.getElementById('my-tickets-tab'));
        myTicketsTab.show();
    });

    // Tab change events
    document.querySelectorAll('#dashboardTabs button[data-bs-toggle="tab"]').forEach(tab => {
        tab.addEventListener('shown.bs.tab', (event) => {
            const targetId = event.target.getAttribute('data-bs-target');
            if (targetId === '#available-pane' && state.availableTickets.length === 0) {
                loadAvailableTickets();
            }
        });
    });

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
        
        // Load available tickets
        await loadAvailableTickets();
        
        // Update statistics
        updateStatistics();
        
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        UI.showToast('Failed to load dashboard data', 'error');
    } finally {
        state.isLoading = false;
    }
}

/**
 * Load my assigned tickets
 */
async function loadMyTickets() {
    const loadingEl = document.getElementById('myTicketsLoading');
    const emptyEl = document.getElementById('myTicketsEmpty');
    const listEl = document.getElementById('myTicketsList');
    
    loadingEl.style.display = 'block';
    emptyEl.style.display = 'none';
    listEl.innerHTML = '';
    
    try {
        console.log('═══════════════════════════════════════════');
        console.log('[Junior Dashboard] Loading My Tickets');
        console.log('[Junior Dashboard] Current User:', state.currentUser);
        
        // Build filters for assigned tickets
        const filters = {};
        
        // Get technician level for filtering
        const techLevel = AuthService.getTechnicianLevel();
        if (techLevel) {
            filters.support_level = techLevel;
            console.log('[Junior Dashboard] Support Level Filter:', techLevel);
        }
        
        // Get building from user profile
        const building = state.currentUser.building || AuthService.getUserBuilding();
        if (building) {
            filters.building = building;
            console.log('[Junior Dashboard] Building Filter:', building);
        }
        
        console.log('[Junior Dashboard] Calling TicketService.getTicketsByTechnician');
        console.log('[Junior Dashboard] Technician ID:', state.currentUser.id);
        console.log('[Junior Dashboard] Filters:', filters);
        
        // Use TicketService directly with filters: assigned_to, support_level, building
        const response = await TicketService.getTicketsByTechnician(state.currentUser.id, filters);
        
        console.log('[Junior Dashboard] API Response:', response);
        
        // Handle different response formats
        if (response.data) {
            state.myTickets = Array.isArray(response.data) ? response.data : [];
        } else if (Array.isArray(response)) {
            state.myTickets = response;
        } else {
            state.myTickets = [];
        }
        
        console.log('[Junior Dashboard] Parsed Tickets:', state.myTickets);
        console.log('[Junior Dashboard] Ticket Count:', state.myTickets.length);
        console.log('═══════════════════════════════════════════');
        
        if (state.myTickets.length === 0) {
            loadingEl.style.display = 'none';
            emptyEl.style.display = 'block';
            return;
        }
        
        // Load SLA data for my tickets
        const ticketIds = state.myTickets.map(t => t.id);
        if (ticketIds.length > 0) {
            try {
                const slaResponse = await WorkflowService.getSLAStatus(ticketIds);
                state.slaData = slaResponse.data || {};
            } catch (error) {
                console.error('Error loading SLA data:', error);
            }
        }
        
        loadingEl.style.display = 'none';
        renderMyTickets();
        
    } catch (error) {
        console.error('═══ ERROR ═══');
        console.error('[Junior Dashboard] Error loading my tickets:', error);
        console.error('[Junior Dashboard] Error details:', {
            message: error.message,
            stack: error.stack
        });
        console.error('═══════════════');
        loadingEl.style.display = 'none';
        UI.showToast('Failed to load your tickets', 'error');
    }
}

/**
 * Load available tickets to claim
 */
async function loadAvailableTickets() {
    const loadingEl = document.getElementById('availableLoading');
    const emptyEl = document.getElementById('availableEmpty');
    const listEl = document.getElementById('availableList');
    
    loadingEl.style.display = 'block';
    emptyEl.style.display = 'none';
    listEl.innerHTML = '';
    
    try {
        console.log('═════════════════════════════════════════════');
        console.log('[Junior Dashboard] Loading Available Tickets');
        
        // Build filters for available tickets
        // Note: With location-based assignment, tickets are auto-routed
        // We look for tickets that are OPEN and not yet claimed by anyone
        let filters = { 
            status: 'OPEN'  // Get open tickets that haven't been started
        };
        
        // Apply additional filters for TECHNICIAN role
        if (AuthService.isTechnician() && !AuthService.isSenior() && !AuthService.isSupervisor()) {
            // Technicians only see tickets from their building
            const building = AuthService.getUserBuilding() || state.currentUser.building;
            if (building) {
                filters.building = building;
                console.log('[Junior Dashboard] Building Filter:', building);
            }
            
            // Filter by technician level if available
            const techLevel = AuthService.getTechnicianLevel();
            if (techLevel) {
                filters.support_level = techLevel;
                console.log('[Junior Dashboard] Support Level Filter:', techLevel);
            }
        }
        
        console.log('[Junior Dashboard] Calling TicketService.getTickets for available tickets');
        console.log('[Junior Dashboard] Filters:', filters);
        
        // Use TicketService directly to get available tickets
        const response = await TicketService.getTickets(filters);
        
        console.log('[Junior Dashboard] Available Tickets Response:', response);
        
        // Handle different response formats
        if (response.data) {
            state.availableTickets = Array.isArray(response.data) ? response.data : [];
        } else if (Array.isArray(response)) {
            state.availableTickets = response;
        } else {
            state.availableTickets = [];
        }
        
        console.log('[Junior Dashboard] Available Tickets:', state.availableTickets);
        console.log('[Junior Dashboard] Available Ticket Count:', state.availableTickets.length);
        console.log('═════════════════════════════════════════════');
        
        if (state.availableTickets.length === 0) {
            loadingEl.style.display = 'none';
            emptyEl.style.display = 'block';
            return;
        }
        
        // Load SLA data for available tickets
        const ticketIds = state.availableTickets.map(t => t.id);
        if (ticketIds.length > 0) {
            try {
                const slaResponse = await WorkflowService.getSLAStatus(ticketIds);
                const availableSLA = slaResponse.data || {};
                state.slaData = { ...state.slaData, ...availableSLA };
            } catch (error) {
                console.error('Error loading SLA data:', error);
            }
        }
        
        loadingEl.style.display = 'none';
        renderAvailableTickets();
        
    } catch (error) {
        console.error('═══ ERROR ═══');
        console.error('[Junior Dashboard] Error loading available tickets:', error);
        console.error('[Junior Dashboard] Error details:', {
            message: error.message,
            stack: error.stack
        });
        console.error('═════════════');
        
        loadingEl.style.display = 'none';
        emptyEl.style.display = 'block';
        
        // Update empty message to explain the error
        emptyEl.innerHTML = `
            <i class="bi bi-exclamation-circle text-muted" style="font-size: 3rem;"></i>
            <p class="mt-3 text-muted">
                Unable to load available tickets.<br>
                ${error.message.includes('500') ? 'The ticket service is temporarily unavailable.' : 'Please check your connection and try again.'}
            </p>
        `;
        
        // Show a less intrusive notification
        console.warn('Available tickets section is currently unavailable');
    }
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

/**
 * Render available tickets list
 */
function renderAvailableTickets() {
    const listEl = document.getElementById('availableList');
    listEl.innerHTML = '';
    
    state.availableTickets.forEach(ticket => {
        const ticketCard = createTicketCard(ticket, 'available');
        listEl.appendChild(ticketCard);
    });
}

/**
 * Create a ticket card element
 */
function createTicketCard(ticket, type) {
    const sla = state.slaData[ticket.id];
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
                        ${sla ? renderSLABadge(sla) : ''}
                    </div>
                    <h6 class="card-subtitle mb-2">${UI.escapeHTML(ticket.title)}</h6>
                    <div class="text-muted small">
                        <div><i class="bi bi-geo-alt me-1"></i> Location: ${ticket.latitude && ticket.longitude ? `${ticket.latitude}, ${ticket.longitude}` : 'Not available'}</div>
                        ${ticket.latitude && ticket.longitude ? `<div><a href="https://www.google.com/maps?q=${ticket.latitude},${ticket.longitude}" target="_blank" class="text-decoration-none"><i class="bi bi-map me-1"></i> Open in Maps</a></div>` : ''}
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
        if (ticket.status === 'OPEN') {
            actions += `
                <button class="btn btn-sm btn-purple" onclick="window.updateTicketStatus('${ticket.id}', 'IN_PROGRESS')">
                    <i class="bi bi-play-circle me-1"></i> Start Work
                </button>
            `;
        }
        
        if (ticket.status === 'IN_PROGRESS') {
            actions += `
                <button class="btn btn-sm btn-success" onclick="window.updateTicketStatus('${ticket.id}', 'RESOLVED')">
                    <i class="bi bi-check-circle me-1"></i> Mark Resolved
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
 */
function renderAvailableTicketActions(ticket) {
    let actions = '';
    
    // Claim button - visible for TECHNICIAN and above
    // Show for OPEN tickets that are not yet assigned to the current user
    if ((AuthService.isTechnician() || AuthService.isSenior() || AuthService.isSupervisor()) && 
        ticket.status === 'OPEN' && ticket.assigned_to !== state.currentUser.id) {
        actions += `
            <button class="btn btn-sm btn-success" onclick="window.claimTicket('${ticket.id}')">
                <i class="bi bi-hand-index me-1"></i> Claim Ticket
            </button>
        `;
    }
    
    return actions;
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
 * Update statistics cards
 */
function updateStatistics() {
    document.getElementById('myActiveTicketsCount').textContent = state.myTickets.length;
    document.getElementById('availableTicketsCount').textContent = state.availableTickets.length;
    document.getElementById('myTicketsBadge').textContent = state.myTickets.length;
    document.getElementById('availableBadge').textContent = state.availableTickets.length;
    
    const slaRisk = Object.values(state.slaData).filter(s => s?.at_risk || s?.sla_breached).length;
    document.getElementById('slaRiskCount').textContent = slaRisk;
    
    const resolvedToday = state.myTickets.filter(t => {
        if (t.status !== 'RESOLVED') return false;
        const today = new Date().toDateString();
        const ticketDate = new Date(t.updated_at).toDateString();
        return today === ticketDate;
    }).length;
    document.getElementById('resolvedTodayCount').textContent = resolvedToday;
}

/**
 * Claim a ticket
 */
window.claimTicket = async function(ticketId) {
    if (!confirm('Are you sure you want to claim this ticket?')) {
        return;
    }
    
    console.log('[Junior Dashboard] Claiming ticket:', ticketId);
    UI.showToast('Claiming ticket...', 'info');
    
    try {
        const result = await WorkflowService.claimTicket(ticketId, state.currentUser.id);
        console.log('[Junior Dashboard] Claim result:', result);
        
        UI.showToast('Ticket claimed successfully!', 'success');
        
        console.log('[Junior Dashboard] Refreshing dashboard after claim...');
        await loadDashboardData();
        
        // Switch to my tickets tab
        const myTicketsTab = new bootstrap.Tab(document.getElementById('my-tickets-tab'));
        myTicketsTab.show();
        
        console.log('[Junior Dashboard] Dashboard refresh complete');
    } catch (error) {
        console.error('[Junior Dashboard] Error claiming ticket:', error);
        UI.showToast(error.message || 'Failed to claim ticket', 'error');
    }
};

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
        await WorkflowService.escalateTicket(ticketId, {
            reason: reason,
            escalated_by: state.currentUser.id
        });
        UI.showToast('Ticket escalated to senior successfully!', 'success');
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
    // Find ticket in either list
    const ticket = state.myTickets.find(t => t.id === ticketId) || 
                   state.availableTickets.find(t => t.id === ticketId);
    
    if (!ticket) {
        UI.showToast('Ticket not found', 'error');
        return;
    }
    
    state.selectedTicket = ticket;
    
    // Load workflow logs
    try {
        const logsResponse = await WorkflowService.getWorkflowLogs(ticketId);
        state.workflowLogs = logsResponse.data || [];
    } catch (error) {
        console.error('Error loading workflow logs:', error);
        state.workflowLogs = [];
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
    const ticket = state.selectedTicket;
    const sla = state.slaData[ticket.id];
    
    const detailsEl = document.getElementById('ticketDetailsContent');
    detailsEl.innerHTML = `
        <div class="row g-4">
            <!-- Ticket Information -->
            <div class="col-12">
                <div class="card">
                    <div class="card-header">
                        <h5 class="card-title mb-0">Ticket Information</h5>
                    </div>
                    <div class="card-body">
                        <div class="row g-3">
                            <div class="col-md-6">
                                <strong class="text-muted">Ticket ID</strong>
                                <p class="mb-0">#${UI.escapeHTML(ticket.id)}</p>
                            </div>
                            <div class="col-md-6">
                                <strong class="text-muted">Status</strong>
                                <p class="mb-0"><span class="badge ${getStatusBadgeClass(ticket.status)}">${UI.escapeHTML(ticket.status)}</span></p>
                            </div>
                            <div class="col-md-6">
                                <strong class="text-muted">Priority</strong>
                                <p class="mb-0"><span class="badge ${getPriorityBadgeClass(ticket.priority)}">${UI.escapeHTML(ticket.priority)}</span></p>
                            </div>
                            <div class="col-md-6">
                                <strong class="text-muted">Location</strong>
                                <p class="mb-0">${ticket.latitude && ticket.longitude ? `${ticket.latitude}, ${ticket.longitude}` : 'Not available'}</p>
                                ${ticket.latitude && ticket.longitude ? `<a href="https://www.google.com/maps?q=${ticket.latitude},${ticket.longitude}" target="_blank" class="btn btn-sm btn-outline-primary mt-2"><i class="bi bi-map me-1"></i> Open in Maps</a>` : ''}
                            </div>
                            <div class="col-md-6">
                                <strong class="text-muted">Requester</strong>
                                <p class="mb-0">${UI.escapeHTML(ticket.requester_name || 'N/A')}</p>
                            </div>
                            <div class="col-md-6">
                                <strong class="text-muted">Created At</strong>
                                <p class="mb-0">${UI.formatDate(ticket.created_at)}</p>
                            </div>
                            ${sla ? `
                            <div class="col-md-6">
                                <strong class="text-muted">SLA Status</strong>
                                <p class="mb-0">${renderSLABadge(sla)}</p>
                            </div>
                            ` : ''}
                        </div>
                        <div class="mt-3">
                            <strong class="text-muted">Title</strong>
                            <p class="mb-2">${UI.escapeHTML(ticket.title)}</p>
                        </div>
                        <div class="mt-3">
                            <strong class="text-muted">Description</strong>
                            <p class="mb-0" style="white-space: pre-wrap;">${UI.escapeHTML(ticket.description || 'No description provided')}</p>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Workflow History -->
            <div class="col-12">
                <div class="card">
                    <div class="card-header">
                        <h5 class="card-title mb-0">Workflow History</h5>
                    </div>
                    <div class="card-body">
                        ${renderWorkflowTimeline()}
                    </div>
                </div>
            </div>
            
            <!-- Action Buttons -->
            <div class="col-12">
                <div class="d-flex gap-2 flex-wrap">
                    ${state.myTickets.find(t => t.id === ticket.id) ? renderMyTicketActions(ticket) : ''}
                    ${state.availableTickets.find(t => t.id === ticket.id) ? renderAvailableTicketActions(ticket) : ''}
                </div>
            </div>
        </div>
    `;
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
        position => sendLocationUpdate(state.currentUser.id, position.coords),
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
        // Use the correct backend API endpoint
        const API_BASE = window.AppConfig?.API_BASE_URL || 'http://localhost:8000';
        const response = await fetch(`${API_BASE}/api/technicians/${technicianId}/location`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
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
