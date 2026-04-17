/**
 * OpsMind - Senior Technician Dashboard Module (Hierarchy-Based)
 * 
 * Modern dashboard using hierarchy-based API:
 * - Team summary statistics
 * - Junior technicians overview
 * - Team tickets management
 * - Workload distribution visualization
 */

import UI from '/assets/js/ui.js';
import { getSeniorDashboard, resolveWorkflowUserId } from '/services/workflowService.js';
import AuthService from '/services/authService.js';

/**
 * Page state
 */
const state = {
    dashboardData: null,
    currentUser: null,
    isLoading: false,
    refreshInterval: null
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

    // Display user name
    const userNameEl = document.getElementById('userName');
    if (userNameEl && state.currentUser.name) {
        userNameEl.textContent = state.currentUser.name;
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
        // Resolve numeric workflow user_id from the auth UUID via email lookup
        const workflowUserId = await resolveWorkflowUserId(state.currentUser.email, 'SENIOR');
        if (!workflowUserId) {
            throw new Error(
                `Your account (${state.currentUser.email}) was not found in the technician system. ` +
                `Please contact your administrator to ensure your senior profile is set up.`
            );
        }

        console.log('Loading senior dashboard for workflow user_id:', workflowUserId);
        
        const response = await getSeniorDashboard(workflowUserId);
        
        if (!response.success || !response.data) {
            throw new Error(response.message || 'Failed to load dashboard data');
        }
        
        state.dashboardData = response.data;
        console.log('Dashboard data loaded:', state.dashboardData);
        
        // Hide loading, show content
        hideLoading();
        
        // Update all sections
        updateSummaryCards();
        renderJuniorsList();
        renderTicketsTable();
        renderWorkloadCharts();
        
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        showError(error.message || 'Failed to load dashboard data');
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
 * Update summary cards
 */
function updateSummaryCards() {
    if (!state.dashboardData) return;
    
    const { juniors, tickets, workload } = state.dashboardData;
    
    // Juniors count
    document.getElementById('juniorsCount').textContent = juniors?.length || 0;
    
    // Total tickets
    document.getElementById('totalTicketsCount').textContent = tickets?.length || 0;
    
    // In Progress tickets
    const inProgressCount = workload?.byStatus?.IN_PROGRESS || 0;
    document.getElementById('inProgressCount').textContent = inProgressCount;
    
    // Resolved tickets
    const resolvedCount = workload?.byStatus?.RESOLVED || 0;
    document.getElementById('resolvedCount').textContent = resolvedCount;
}

/**
 * Render juniors list
 */
function renderJuniorsList() {
    if (!state.dashboardData) return;
    
    const { juniors } = state.dashboardData;
    const listEl = document.getElementById('juniorsList');
    const emptyEl = document.getElementById('juniorsEmpty');
    const countEl = document.getElementById('juniorCount');
    
    if (!juniors || juniors.length === 0) {
        if (listEl) listEl.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('d-none');
        if (countEl) countEl.textContent = '0';
        return;
    }
    
    if (emptyEl) emptyEl.classList.add('d-none');
    if (countEl) countEl.textContent = juniors.length;
    
    if (!listEl) return;
    
    listEl.innerHTML = '';
    
    juniors.forEach(junior => {
        const col = document.createElement('div');
        col.className = 'col-md-6 col-lg-4';
        
        const ticketCount = junior.assignedTicketsCount || 0;
        const statusClass = ticketCount > 5 ? 'danger' : ticketCount > 2 ? 'warning' : 'success';
        const statusIcon = ticketCount > 5 ? 'exclamation-triangle' : ticketCount > 2 ? 'hourglass-split' : 'check-circle';
        const statusText = ticketCount > 5 ? 'Overloaded' : ticketCount > 2 ? 'Active' : 'Available';
        
        col.innerHTML = `
            <div class="card h-100 border-0 shadow-sm hover-lift">
                <div class="card-body p-3">
                    <div class="d-flex align-items-center mb-3">
                        <div class="avatar-circle bg-primary text-white me-3" style="width: 48px; height: 48px; font-size: 1.25rem;">
                            ${UI.escapeHTML((junior.name || 'U')[0].toUpperCase())}
                        </div>
                        <div class="flex-grow-1">
                            <h6 class="mb-1 fw-bold">${UI.escapeHTML(junior.name || 'Unknown')}</h6>
                            <small class="text-muted">
                                <i class="bi bi-envelope me-1"></i>
                                ${UI.escapeHTML(junior.email || 'No email')}
                            </small>
                        </div>
                    </div>
                    <div class="d-flex justify-content-between align-items-center gap-2">
                        <span class="badge bg-${statusClass} px-2 py-1">
                            <i class="bi bi-${statusIcon} me-1"></i>
                            ${statusText}
                        </span>
                        <span class="badge bg-primary-subtle text-primary px-2 py-1">
                            <i class="bi bi-ticket-perforated me-1"></i>
                            ${ticketCount} ticket${ticketCount !== 1 ? 's' : ''}
                        </span>
                    </div>
                </div>
            </div>
        `;
        
        listEl.appendChild(col);
    });
}

/**
 * Render tickets table
 */
function renderTicketsTable() {
    if (!state.dashboardData) return;
    
    const { tickets } = state.dashboardData;
    const tableBodyEl = document.getElementById('ticketsTableBody');
    const emptyEl = document.getElementById('ticketsEmpty');
    const countEl = document.getElementById('ticketCount');
    
    if (!tickets || tickets.length === 0) {
        if (tableBodyEl) tableBodyEl.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('d-none');
        if (countEl) countEl.textContent = '0';
        return;
    }
    
    if (emptyEl) emptyEl.classList.add('d-none');
    if (countEl) countEl.textContent = tickets.length;
    
    if (!tableBodyEl) return;
    
    tableBodyEl.innerHTML = '';
    
    tickets.forEach(ticket => {
        const row = document.createElement('tr');
        
        const assignedTo = ticket.assignedTo || ticket.assigned_to_name || 'Unassigned';
        const location = ticket.location?.latitude && ticket.location?.longitude
            ? `${ticket.location.latitude.toFixed(4)}, ${ticket.location.longitude.toFixed(4)}`
            : 'N/A';
        const hasLocation = ticket.location?.latitude && ticket.location?.longitude;
        const status = ticket.status || 'UNKNOWN';
        const priority = ticket.priority || 'UNKNOWN';
        
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
                <a href="#" onclick="window.viewTicket('${UI.escapeHTML(ticket.ticketId)}'); return false;" class="text-decoration-none fw-semibold">
                    <i class="bi bi-ticket-detailed me-1"></i>
                    ${UI.escapeHTML(ticket.ticketId).substring(0, 8)}...
                </a>
            </td>
            <td>
                <div class="d-flex align-items-center">
                    <div class="avatar-circle bg-secondary text-white me-2" style="width: 28px; height: 28px; font-size: 0.75rem;">
                        ${UI.escapeHTML((assignedTo || 'U')[0].toUpperCase())}
                    </div>
                    <span>${UI.escapeHTML(assignedTo)}</span>
                </div>
            </td>
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
            <td><small class="text-muted">${UI.formatDate(ticket.createdAt)}</small></td>
            <td>
                ${location}
                ${hasLocation ? `<br><a href="https://www.google.com/maps?q=${ticket.location.latitude},${ticket.location.longitude}" target="_blank" class="text-decoration-none small">
                    <i class="bi bi-geo-alt"></i> View Map
                </a>` : ''}
            </td>
        `;
        
        tableBodyEl.appendChild(row);
    });
}

/**
 * Render workload charts
 */
function renderWorkloadCharts() {
    if (!state.dashboardData || !state.dashboardData.workload) return;
    
    const { workload } = state.dashboardData;
    
    // Render by Status
    renderWorkloadByStatus(workload.byStatus || {});
    
    // Render by Priority
    renderWorkloadByPriority(workload.byPriority || {});
    
    // Render by Junior
    renderWorkloadByJunior(workload.byJunior || []);
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
        const percentage = count > 0 ? Math.min((count / 10) * 100, 100) : 0;
        
        html += `
            <div class="workload-bar-item mb-2">
                <div class="d-flex justify-content-between mb-1">
                    <span class="small">${status.replace('_', ' ')}</span>
                    <span class="small fw-bold">${count}</span>
                </div>
                <div class="progress" style="height: 8px;">
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
        const percentage = count > 0 ? Math.min((count / 10) * 100, 100) : 0;
        
        html += `
            <div class="workload-bar-item mb-2">
                <div class="d-flex justify-content-between mb-1">
                    <span class="small">${priority}</span>
                    <span class="small fw-bold">${count}</span>
                </div>
                <div class="progress" style="height: 8px;">
                    <div class="progress-bar" style="width: ${percentage}%; background-color: ${colors[priority]}"></div>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

/**
 * Render workload by junior
 */
function renderWorkloadByJunior(byJunior) {
    const container = document.getElementById('juniorWorkload');
    if (!container) return;
    
    if (!byJunior || byJunior.length === 0) {
        container.innerHTML = '<p class="text-muted small text-center py-3">No junior assignments yet</p>';
        return;
    }
    
    const maxCount = Math.max(...byJunior.map(j => j.count), 1);
    
    let html = '<div class="workload-bars">';
    
    byJunior.slice(0, 5).forEach(junior => {
        const percentage = (junior.count / maxCount) * 100;
        const juniorName = junior.name || `Junior #${junior.juniorId}`;
        
        html += `
            <div class="workload-bar-item mb-2">
                <div class="d-flex justify-content-between mb-1">
                    <span class="small">${UI.escapeHTML(juniorName)}</span>
                    <span class="small fw-bold">${junior.count}</span>
                </div>
                <div class="progress" style="height: 8px;">
                    <div class="progress-bar bg-primary" style="width: ${percentage}%"></div>
                </div>
            </div>
        `;
    });
    
    if (byJunior.length > 5) {
        html += `<p class="text-muted small text-center mt-2">+${byJunior.length - 5} more</p>`;
    }
    
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
 * View ticket details (placeholder)
 */
window.viewTicket = function(ticketId) {
    console.log('View ticket:', ticketId);
    UI.showToast('Ticket detail view not yet implemented', 'info');
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSeniorDashboard);
} else {
    initSeniorDashboard();
}
