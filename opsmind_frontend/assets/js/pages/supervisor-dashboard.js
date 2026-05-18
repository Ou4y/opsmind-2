/**
 * OpsMind - Supervisor Dashboard Module (Hierarchy-Based)
 * 
 * Modern dashboard using hierarchy-based API:
 * - Team overview with metrics
 * - Senior technicians management
 * - Junior technicians under seniors
 * - All team tickets
 * - Workload distribution visualization
 */

import UI from '/assets/js/ui.js';
import { getSupervisorOverview, getSupervisorTickets, getSupervisorTicketDetails, escalateTicket } from '/services/workflowService.js';
import TicketService from '/services/ticketService.js';
import { openTicketDetailsModal, getTicketLocationDisplay } from '/assets/js/components/ticketDetailsModal.js';
import { openEscalationModal } from '/assets/js/components/escalationModal.js';
import AuthService from '/services/authService.js';

/**
 * Page state
 */
const state = {
    overview: null,
    tickets: [],
    currentUser: null,
    workflowUserId: null,
    dashboardContext: null,
    isLoading: false,
    refreshInterval: null
};

/**
 * Initialize the supervisor dashboard page
 */
export async function initSupervisorDashboard() {
    // Wait for app to be ready
    await waitForApp();
    
    // Get current user
    state.currentUser = AuthService.getCurrentUser();
    if (!state.currentUser) {
        window.location.href = '/index.html';
        return;
    }

    state.dashboardContext = AuthService.resolveUserDashboardContext(state.currentUser);
    if (state.dashboardContext.dashboardType !== 'supervisor') {
        if (redirectToDashboard(state.dashboardContext)) return;
        showError('Workflow profile not found or incomplete. Please logout and login again.');
        return;
    }

    if (!state.dashboardContext.workflowUserId) {
        showError('Workflow profile not found or incomplete. Please logout and login again.');
        return;
    }

    state.workflowUserId = state.dashboardContext.workflowUserId;

    // Display user name
    const userNameEl = document.getElementById('userName');
    if (userNameEl && state.currentUser.name) {
        userNameEl.textContent = state.currentUser.name;
    }

    const refreshButton = document.getElementById('refreshDashboard');
    if (refreshButton) {
        refreshButton.addEventListener('click', async () => {
            UI.showToast('Refreshing dashboard...', 'info');
            await loadDashboardData();
        });
    }
    
    // Load initial data
    await loadDashboardData();
    
    // Set up auto-refresh every 60 seconds
    state.refreshInterval = setInterval(loadDashboardData, 60000);
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (state.refreshInterval) {
            clearInterval(state.refreshInterval);
        }
    });
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
 * Load dashboard data from hierarchy API
 */
async function loadDashboardData() {
    if (state.isLoading) return;

    state.isLoading = true;
    showLoading();

    try {
        const workflowUserId = resolveWorkflowUserId();
        if (!workflowUserId) return;

        const [overviewResponse, ticketsResponse] = await Promise.all([
            getSupervisorOverview(workflowUserId),
            getSupervisorTickets(workflowUserId, { limit: 50, offset: 0 })
        ]);

        if (!overviewResponse?.success || !overviewResponse?.data) {
            throw new Error(overviewResponse?.message || 'Failed to load overview data');
        }

        if (!ticketsResponse?.success || !ticketsResponse?.data) {
            throw new Error(ticketsResponse?.message || 'Failed to load tickets');
        }

        state.overview = overviewResponse.data;
        state.tickets = Array.isArray(ticketsResponse.data.items) ? ticketsResponse.data.items : [];

        hideLoading();
        updateMetricCards();
        renderSeniorsTable();
        renderJuniorsTable();
        renderTicketsTable();
        renderWorkloadCharts();
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        if (error?.status === 403) {
            showError('You do not have access to this dashboard.');
        } else {
            showError(error.message || 'Failed to load dashboard data');
        }
    } finally {
        state.isLoading = false;
    }
}

/**
 * Show loading state
 */
function showLoading() {
    const loadingEl = document.getElementById('dashboardLoading');
    const contentEl = document.getElementById('dashboardContent');
    const errorEl = document.getElementById('dashboardError');
    
    if (loadingEl) loadingEl.classList.remove('d-none');
    if (contentEl) contentEl.classList.add('d-none');
    if (errorEl) errorEl.classList.add('d-none');
}

/**
 * Hide loading, show content
 */
function hideLoading() {
    const loadingEl = document.getElementById('dashboardLoading');
    const contentEl = document.getElementById('dashboardContent');
    
    if (loadingEl) loadingEl.classList.add('d-none');
    if (contentEl) contentEl.classList.remove('d-none');
}

/**
 * Show error state
 */
function showError(message) {
    const loadingEl = document.getElementById('dashboardLoading');
    const contentEl = document.getElementById('dashboardContent');
    const errorEl = document.getElementById('dashboardError');
    const errorMsgEl = document.getElementById('errorMessage');
    
    if (loadingEl) loadingEl.classList.add('d-none');
    if (contentEl) contentEl.classList.add('d-none');
    if (errorEl) errorEl.classList.remove('d-none');
    if (errorMsgEl) errorMsgEl.textContent = message;
}

/**
 * Retry loading data
 */
window.retryLoadDashboard = async function() {
    await loadDashboardData();
};

/**
 * Update metric cards
 */
function updateMetricCards() {
    if (!state.overview) return;

    const overview = state.overview;
    const seniorTeams = Array.isArray(overview.ticketsPerSeniorTeam) ? overview.ticketsPerSeniorTeam : [];
    const seniorsCount = seniorTeams.length;
    const juniorsCount = seniorTeams.reduce((sum, team) => sum + (team.juniorCount || 0), 0);
    const totalTickets = overview.totalTickets || 0;
    const avgTickets = juniorsCount > 0 ? (totalTickets / juniorsCount).toFixed(1) : '0';

    document.getElementById('seniorsCount').textContent = seniorsCount;
    document.getElementById('seniorCount').textContent = seniorsCount;
    document.getElementById('juniorsCount').textContent = juniorsCount;
    document.getElementById('juniorCount').textContent = juniorsCount;
    document.getElementById('totalTicketsCount').textContent = totalTickets;
    document.getElementById('ticketCount').textContent = totalTickets;
    document.getElementById('avgTicketsPerJunior').textContent = avgTickets;
}

/**
 * Render seniors table
 */
function renderSeniorsTable() {
    if (!state.overview) return;

    const teams = Array.isArray(state.overview.ticketsPerSeniorTeam)
        ? state.overview.ticketsPerSeniorTeam
        : [];
    const technicians = Array.isArray(state.overview.ticketsPerTechnician)
        ? state.overview.ticketsPerTechnician
        : [];
    const seniorMap = new Map(
        technicians
            .filter((tech) => tech.level === 'SENIOR')
            .map((tech) => [tech.userId, tech])
    );
    
    const tableBodyEl = document.getElementById('seniorsTableBody');
    const emptyEl = document.getElementById('seniorsEmpty');
    
    if (teams.length === 0) {
        if (tableBodyEl) tableBodyEl.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('d-none');
        return;
    }
    
    if (emptyEl) emptyEl.classList.add('d-none');
    if (!tableBodyEl) return;
    
    tableBodyEl.innerHTML = '';
    
    teams.forEach(team => {
        const row = document.createElement('tr');

        const seniorTech = seniorMap.get(team.seniorUserId) || {};
        const juniorCount = team.juniorCount || 0;
        const ticketCount = team.ticketCount || seniorTech.ticketCount || 0;
        const statusClass = ticketCount > 10 ? 'danger' : ticketCount > 5 ? 'warning' : 'success';
        const statusIcon = ticketCount > 10 ? 'exclamation-triangle' : ticketCount > 5 ? 'hourglass-split' : 'check-circle';
        const statusText = ticketCount > 10 ? 'Heavy Load' : ticketCount > 5 ? 'Moderate Load' : 'Light Load';
        const seniorName = team.seniorName || seniorTech.name || 'Unknown';
        const seniorEmail = seniorTech.email || 'N/A';
        
        row.innerHTML = `
            <td>
                <div class="d-flex align-items-center">
                    <div class="avatar-circle bg-primary text-white me-2" style="width: 32px; height: 32px; font-size: 0.875rem;">
                        ${UI.escapeHTML((seniorName || 'U')[0].toUpperCase())}
                    </div>
                    <span class="fw-semibold">${UI.escapeHTML(seniorName)}</span>
                </div>
            </td>
            <td><small class="text-muted">${UI.escapeHTML(seniorEmail)}</small></td>
            <td>
                <span class="badge bg-${statusClass} px-2 py-1">
                    <i class="bi bi-${statusIcon} me-1"></i>
                    ${statusText}
                </span>
            </td>
            <td>
                <span class="badge bg-info-subtle text-info px-2 py-1">
                    <i class="bi bi-people me-1"></i>
                    ${juniorCount} junior${juniorCount !== 1 ? 's' : ''}
                </span>
            </td>
            <td>
                <span class="badge bg-primary-subtle text-primary px-2 py-1">
                    <i class="bi bi-ticket-perforated me-1"></i>
                    ${ticketCount} ticket${ticketCount !== 1 ? 's' : ''}
                </span>
            </td>
        `;
        
        tableBodyEl.appendChild(row);
    });
}

/**
 * Render juniors table
 */
function renderJuniorsTable() {
    if (!state.tickets) return;

    const juniors = buildJuniorSummary();
    
    const tableBodyEl = document.getElementById('juniorsTableBody');
    const emptyEl = document.getElementById('juniorsEmpty');
    
    if (juniors.length === 0) {
        if (tableBodyEl) tableBodyEl.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('d-none');
        return;
    }
    
    if (emptyEl) emptyEl.classList.add('d-none');
    if (!tableBodyEl) return;
    
    tableBodyEl.innerHTML = '';
    
    juniors.forEach(junior => {
        const row = document.createElement('tr');

        const ticketCount = junior.ticketCount || 0;
        const statusClass = ticketCount > 5 ? 'danger' : ticketCount > 2 ? 'warning' : 'success';
        const statusIcon = ticketCount > 5 ? 'exclamation-triangle' : ticketCount > 2 ? 'hourglass-split' : 'check-circle';
        const statusText = ticketCount > 5 ? 'Overloaded' : ticketCount > 2 ? 'Active' : 'Available';
        const seniorName = junior.seniorName || 'Unassigned';
        
        row.innerHTML = `
            <td>
                <div class="d-flex align-items-center">
                    <div class="avatar-circle bg-success text-white me-2" style="width: 32px; height: 32px; font-size: 0.875rem;">
                        ${UI.escapeHTML((junior.name || 'U')[0].toUpperCase())}
                    </div>
                    <span class="fw-semibold">${UI.escapeHTML(junior.name || 'Unknown')}</span>
                </div>
            </td>
            <td>
                <span class="text-muted small">
                    <i class="bi bi-arrow-up-right me-1"></i>
                    ${UI.escapeHTML(seniorName)}
                </span>
            </td>
            <td>
                <span class="badge bg-${statusClass} px-2 py-1">
                    <i class="bi bi-${statusIcon} me-1"></i>
                    ${statusText}
                </span>
            </td>
            <td>
                <span class="badge bg-primary-subtle text-primary px-2 py-1">
                    <i class="bi bi-ticket-perforated me-1"></i>
                    ${ticketCount} ticket${ticketCount !== 1 ? 's' : ''}
                </span>
            </td>
        `;
        
        tableBodyEl.appendChild(row);
    });
}

/**
 * Render tickets table
 */
function renderTicketsTable() {
    if (!state.tickets) return;
    
    const tickets = state.tickets;
    
    const tableBodyEl = document.getElementById('ticketsTableBody');
    const emptyEl = document.getElementById('ticketsEmpty');
    
    if (!tickets || tickets.length === 0) {
        if (tableBodyEl) tableBodyEl.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('d-none');
        return;
    }
    
    if (emptyEl) emptyEl.classList.add('d-none');
    if (!tableBodyEl) return;
    
    tableBodyEl.innerHTML = '';
    
    tickets.forEach(ticket => {
        const row = document.createElement('tr');
        
        const ticketId = ticket.ticketId || ticket.id || 'N/A';
        const title = ticket.title || 'No title';
        const assignedUserLabel = ticket.assignedToName
            || ticket.assigned_to_name
            || ticket.assignedToEmail
            || (ticket.assignedTo != null ? `User ${ticket.assignedTo}` : 'Unassigned');
        const assigneeLevel = ticket.assignedToLevel || ticket.assignedToLevelCode || 'UNASSIGNED';
        const avatarInitial = String(assignedUserLabel || 'U').charAt(0).toUpperCase();
        const juniorOwner = ticket.hierarchy?.junior?.name || 'Unassigned';
        const seniorOwner = ticket.hierarchy?.senior?.name || 'Unassigned';
        const supervisorOwner = ticket.hierarchy?.supervisor?.name || 'Unassigned';
        const status = String(ticket.status || 'UNKNOWN').toUpperCase();
        const priority = String(ticket.priority || 'UNKNOWN').toUpperCase();
        const createdAt = ticket.createdAt || ticket.created_at;
        const escalationCount = ticket.escalationCount ?? ticket.escalation_count ?? 0;
        const allowedActions = ticket.allowedActions || ticket.allowed_actions || {};
        const location = getTicketLocationDisplay(ticket);
        
        // Status icons
        const statusIcons = {
            'OPEN': 'circle',
            'IN_PROGRESS': 'hourglass-split',
            'RESOLVED': 'check-circle-fill',
            'CLOSED': 'x-circle',
            'ESCALATED': 'exclamation-circle-fill'
        };
        
        // Priority icons
        const priorityIcons = {
            'CRITICAL': 'exclamation-triangle-fill',
            'HIGH': 'exclamation-circle',
            'MEDIUM': 'dash-circle',
            'LOW': 'check-circle'
        };
        
        row.innerHTML = `
            <td>
                <a href="#" onclick="window.viewTicketDetails('${UI.escapeHTML(String(ticketId))}'); return false;" class="text-decoration-none fw-semibold">
                    <i class="bi bi-ticket-detailed me-1"></i>
                    ${UI.escapeHTML(ticketId.toString().substring(0, 8))}...
                </a>
            </td>
            <td>
                <div class="text-truncate" style="max-width: 200px;" title="${UI.escapeHTML(title)}">
                    ${UI.escapeHTML(title)}
                </div>
            </td>
            <td>
                <div class="d-flex align-items-center">
                    <div class="avatar-circle bg-secondary text-white me-2" style="width: 24px; height: 24px; font-size: 0.7rem;">
                        ${UI.escapeHTML(avatarInitial)}
                    </div>
                    <small>${UI.escapeHTML(String(assignedUserLabel))}</small>
                </div>
            </td>
            <td><small class="text-muted">${UI.escapeHTML(String(assigneeLevel))}</small></td>
            <td><small class="text-muted">${UI.escapeHTML(juniorOwner)}</small></td>
            <td><small class="text-muted">${UI.escapeHTML(seniorOwner)}</small></td>
            <td><small class="text-muted">${UI.escapeHTML(supervisorOwner)}</small></td>
            <td>
                <span class="badge ${getStatusBadgeClass(status)} px-2 py-1">
                    <i class="bi bi-${statusIcons[status.toUpperCase()] || 'circle'} me-1"></i>
                    ${UI.escapeHTML(status)}
                </span>
            </td>
            <td>
                <span class="badge ${getPriorityBadgeClass(priority)} px-2 py-1">
                    <i class="bi bi-${priorityIcons[priority.toUpperCase()] || 'circle'} me-1"></i>
                    ${UI.escapeHTML(priority)}
                </span>
            </td>
            <td><small class="text-muted">${UI.formatDate(createdAt)}</small></td>
            <td><small class="text-muted">${UI.escapeHTML(location)}</small></td>
            <td>
                <span class="badge bg-warning-subtle text-warning">${UI.escapeHTML(String(escalationCount))}</span>
            </td>
            <td>
                ${buildActionButtons(ticketId, allowedActions)}
            </td>
        `;
        
        tableBodyEl.appendChild(row);
    });
}

function buildActionButtons(ticketId, allowedActions) {
    const actions = [];

    if (allowedActions?.canStart) {
        actions.push(
            `<button type="button" class="btn btn-sm btn-purple" onclick="window.updateTicketStatus('${UI.escapeHTML(String(ticketId))}', 'IN_PROGRESS')">Start</button>`
        );
    }

    if (allowedActions?.canResolve) {
        actions.push(
            `<button type="button" class="btn btn-sm btn-success" onclick="window.updateTicketStatus('${UI.escapeHTML(String(ticketId))}', 'RESOLVED')">Resolve</button>`
        );
    }

    if (allowedActions?.canEscalate) {
        actions.push(
            `<button type="button" class="btn btn-sm btn-warning" onclick="window.escalateTicket('${UI.escapeHTML(String(ticketId))}')">Escalate</button>`
        );
    }

    actions.push(
        `<button type="button" class="btn btn-sm btn-outline-primary" onclick="window.viewTicketDetails('${UI.escapeHTML(String(ticketId))}')">View Details</button>`
    );

    return `<div class="d-flex flex-wrap gap-2">${actions.join('')}</div>`;
}

/**
 * Render workload charts
 */
function renderWorkloadCharts() {
    if (!state.overview) return;

    renderWorkloadByStatus(state.overview.ticketsByStatus || {});
    renderWorkloadByPriority(state.overview.ticketsByPriority || {});
}

/**
 * Render workload by status
 */
function renderWorkloadByStatus(byStatus) {
    const container = document.getElementById('statusWorkload');
    if (!container) return;
    
    const statuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
    const colors = {
        'OPEN': '#0dcaf0',
        'IN_PROGRESS': '#6f42c1',
        'RESOLVED': '#198754',
        'CLOSED': '#6c757d'
    };
    
    let html = '<div class="workload-bars">';
    
    statuses.forEach(status => {
        const count = byStatus[status] || 0;
        const percentage = count > 0 ? Math.min((count / 20) * 100, 100) : 0;
        
        html += `
            <div class="workload-bar-item mb-2">
                <div class="d-flex justify-content-between mb-1">
                    <span class="small">${status.replace('_', ' ')}</span>
                    <span class="small fw-bold">${count}</span>
                </div>
                <div class="progress" style="height: 10px;">
                    <div class="progress-bar" style="width: ${percentage}%; background-color: ${colors[status]}"></div>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

/**
 * Render workload by priority
 */
function renderWorkloadByPriority(byPriority) {
    const container = document.getElementById('priorityWorkload');
    if (!container) return;
    
    const priorities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
    const colors = {
        'CRITICAL': '#dc3545',
        'HIGH': '#fd7e14',
        'MEDIUM': '#ffc107',
        'LOW': '#198754'
    };
    
    let html = '<div class="workload-bars">';
    
    priorities.forEach(priority => {
        const count = byPriority[priority] || 0;
        const percentage = count > 0 ? Math.min((count / 20) * 100, 100) : 0;
        
        html += `
            <div class="workload-bar-item mb-2">
                <div class="d-flex justify-content-between mb-1">
                    <span class="small">${priority}</span>
                    <span class="small fw-bold">${count}</span>
                </div>
                <div class="progress" style="height: 10px;">
                    <div class="progress-bar" style="width: ${percentage}%; background-color: ${colors[priority]}"></div>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
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
 * Get priority badge class
 */
function getPriorityBadgeClass(priority) {
    switch (priority?.toUpperCase()) {
        case 'CRITICAL': return 'bg-danger';
        case 'HIGH': return 'bg-warning text-dark';
        case 'MEDIUM': return 'bg-info';
        case 'LOW': return 'bg-success';
        default: return 'bg-secondary';
    }
}

/**
 * Update ticket status
 */
window.updateTicketStatus = async function(ticketId, newStatus) {
    UI.showToast('Updating ticket status...', 'info');

    try {
        await TicketService.updateStatus(ticketId, newStatus);
        UI.showToast('Ticket status updated!', 'success');
        await loadDashboardData();
    } catch (error) {
        console.error('Error updating ticket status:', error);
        UI.showToast(error.message || 'Failed to update ticket status', 'error');
    }
};

/**
 * Escalate ticket
 */
window.escalateTicket = async function(ticketId) {
    const workflowUserId = resolveWorkflowUserId();
    if (!workflowUserId) return;

    openEscalationModal({
        title: `Escalate Ticket ${ticketId}`,
        onSubmit: async (reason) => {
            const userRole = resolveUserRole('SUPERVISOR');

            await escalateTicket(ticketId, {
                reason: reason.trim(),
                escalatedBy: workflowUserId,
                userRole
            });

            UI.showToast('Ticket escalated successfully!', 'success');
            await loadDashboardData();
        }
    });
};

/**
 * View ticket details (placeholder)
 */
window.viewTicketDetails = async function(ticketId) {
    const workflowUserId = resolveWorkflowUserId();
    if (!workflowUserId) return;

    const modalHandle = openTicketDetailsModal({
        title: `Ticket ${ticketId}`,
        currentUserRole: resolveUserRole('SUPERVISOR')
    });
    modalHandle.setLoading('Loading ticket details...');

    try {
        const response = await getSupervisorTicketDetails(workflowUserId, ticketId);
        if (!response?.success || !response?.data?.ticket) {
            console.error('Unexpected ticket details response:', response);
            throw new Error(response?.message || 'Ticket details unavailable');
        }

        modalHandle.setContent(response.data);
    } catch (error) {
        console.error('Failed to load ticket details:', error);
        if (error?.status === 403) {
            modalHandle.setError('You do not have access to this dashboard.');
        } else {
            modalHandle.setError(error.message || 'Failed to load ticket details');
        }
    }
};

function resolveWorkflowUserId() {
    if (state.workflowUserId) return state.workflowUserId;
    if (!state.dashboardContext?.workflowUserId) {
        showError('Workflow profile not found or incomplete. Please logout and login again.');
        return null;
    }
    state.workflowUserId = state.dashboardContext.workflowUserId;
    return state.workflowUserId;
}

function resolveUserRole(defaultRole) {
    return String(
        state.currentUser?.technicianLevel ||
        state.currentUser?.level ||
        AuthService.getTechnicianLevel() ||
        defaultRole
    ).toUpperCase();
}

function redirectToDashboard(context) {
    const targetPath = context?.dashboardPath || '';
    if (targetPath && window.location.pathname !== targetPath) {
        window.location.href = targetPath;
        return true;
    }
    return false;
}

function buildJuniorSummary() {
    const juniorMap = new Map();

    state.tickets.forEach((ticket) => {
        const junior = ticket.hierarchy?.junior;
        if (!junior?.userId) return;

        const current = juniorMap.get(junior.userId) || {
            userId: junior.userId,
            name: junior.name || 'Unknown',
            seniorName: ticket.hierarchy?.senior?.name || 'Unassigned',
            ticketCount: 0
        };

        current.ticketCount += 1;
        juniorMap.set(junior.userId, current);
    });

    return Array.from(juniorMap.values());
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSupervisorDashboard);
} else {
    initSupervisorDashboard();
}
