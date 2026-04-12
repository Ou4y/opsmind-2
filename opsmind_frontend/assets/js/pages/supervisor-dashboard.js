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
import { getSupervisorDashboard } from '/services/workflowService.js';
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
        console.log('Loading supervisor dashboard for user:', state.currentUser.id);
        
        const response = await getSupervisorDashboard(state.currentUser.id);
        
        if (!response.success || !response.data) {
            throw new Error(response.message || 'Failed to load dashboard data');
        }
        
        state.dashboardData = response.data;
        console.log('Dashboard data loaded:', state.dashboardData);
        
        // Hide loading, show content
        hideLoading();
        
        // Update all sections
        updateMetricCards();
        renderSeniorsTable();
        renderJuniorsTable();
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
 * Update metric cards
 */
function updateMetricCards() {
    if (!state.dashboardData) return;
    
    const { teamStructure, tickets } = state.dashboardData;
    
    // Seniors count
    const seniorsCount = teamStructure?.seniors?.length || 0;
    document.getElementById('seniorsCount').textContent = seniorsCount;
    document.getElementById('seniorCount').textContent = seniorsCount;
    
    // Juniors count
    const juniorsCount = teamStructure?.juniors?.length || 0;
    document.getElementById('juniorsCount').textContent = juniorsCount;
    document.getElementById('juniorCount').textContent = juniorsCount;
    
    // Total tickets
    const totalTickets = tickets?.length || 0;
    document.getElementById('totalTicketsCount').textContent = totalTickets;
    document.getElementById('ticketCount').textContent = totalTickets;
    
    // Average tickets per junior
    const avgTickets = juniorsCount > 0 ? (totalTickets / juniorsCount).toFixed(1) : '0';
    document.getElementById('avgTicketsPerJunior').textContent = avgTickets;
}

/**
 * Render seniors table
 */
function renderSeniorsTable() {
    if (!state.dashboardData) return;
    
    const { teamStructure } = state.dashboardData;
    const seniors = teamStructure?.seniors || [];
    
    const tableBodyEl = document.getElementById('seniorsTableBody');
    const emptyEl = document.getElementById('seniorsEmpty');
    
    if (seniors.length === 0) {
        if (tableBodyEl) tableBodyEl.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('d-none');
        return;
    }
    
    if (emptyEl) emptyEl.classList.add('d-none');
    if (!tableBodyEl) return;
    
    tableBodyEl.innerHTML = '';
    
    seniors.forEach(senior => {
        const row = document.createElement('tr');
        
        const juniorCount = senior.juniorCount || 0;
        const ticketCount = senior.assignedTicketsCount || 0;
        const statusClass = ticketCount > 10 ? 'danger' : ticketCount > 5 ? 'warning' : 'success';
        const statusIcon = ticketCount > 10 ? 'exclamation-triangle' : ticketCount > 5 ? 'hourglass-split' : 'check-circle';
        const statusText = ticketCount > 10 ? 'Heavy Load' : ticketCount > 5 ? 'Moderate Load' : 'Light Load';
        
        row.innerHTML = `
            <td>
                <div class="d-flex align-items-center">
                    <div class="avatar-circle bg-primary text-white me-2" style="width: 32px; height: 32px; font-size: 0.875rem;">
                        ${UI.escapeHTML((senior.name || 'U')[0].toUpperCase())}
                    </div>
                    <span class="fw-semibold">${UI.escapeHTML(senior.name || 'Unknown')}</span>
                </div>
            </td>
            <td><small class="text-muted">${UI.escapeHTML(senior.email || 'No email')}</small></td>
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
    if (!state.dashboardData) return;
    
    const { teamStructure } = state.dashboardData;
    const juniors = teamStructure?.juniors || [];
    
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
        
        const ticketCount = junior.assignedTicketsCount || 0;
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
    if (!state.dashboardData) return;
    
    const { tickets } = state.dashboardData;
    
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
        const assignedJunior = ticket.assignedTo || ticket.assigned_to_name || 'Unassigned';
        const seniorOwner = ticket.seniorName || 'N/A';
        const status = ticket.status || 'UNKNOWN';
        const priority = ticket.priority || 'UNKNOWN';
        const createdAt = ticket.createdAt || ticket.created_at;
        
        const location = ticket.location?.latitude && ticket.location?.longitude
            ? `${ticket.location.latitude.toFixed(4)}, ${ticket.location.longitude.toFixed(4)}`
            : 'N/A';
        const hasLocation = ticket.location?.latitude && ticket.location?.longitude;
        
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
                <a href="#" onclick="window.viewTicket('${UI.escapeHTML(ticketId)}'); return false;" class="text-decoration-none fw-semibold">
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
                        ${UI.escapeHTML((assignedJunior || 'U')[0].toUpperCase())}
                    </div>
                    <small>${UI.escapeHTML(assignedJunior)}</small>
                </div>
            </td>
            <td><small  class="text-muted">${UI.escapeHTML(seniorOwner)}</small></td>
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
            <td>
                ${hasLocation ? `
                    <a href="https://www.google.com/maps?q=${ticket.location.latitude},${ticket.location.longitude}" 
                       target="_blank" class="btn btn-sm btn-outline-primary">
                        <i class="bi bi-geo-alt"></i>
                    </a>
                ` : '<span class="text-muted small">N/A</span>'}
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
 * View ticket details (placeholder)
 */
window.viewTicket = function(ticketId) {
    console.log('View ticket:', ticketId);
    UI.showToast('Ticket detail view not yet implemented', 'info');
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSupervisorDashboard);
} else {
    initSupervisorDashboard();
}
