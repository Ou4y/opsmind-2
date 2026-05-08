/**
 * OpsMind - Admin Dashboard Module
 *
 * Global workflow overview using role-based API:
 * - Summary statistics
 * - Ticket listing with details
 */

import UI from '/assets/js/ui.js';
import { getAdminOverview, getAdminTickets, getAdminTicketDetails } from '/services/workflowService.js';
import { openTicketDetailsModal, getTicketLocationDisplay } from '/assets/js/components/ticketDetailsModal.js';
import AuthService from '/services/authService.js';

const state = {
    overview: null,
    tickets: [],
    currentUser: null,
    dashboardContext: null,
    isLoading: false,
    refreshInterval: null
};

export async function initAdminDashboard() {
    await waitForApp();

    state.currentUser = AuthService.getCurrentUser();
    if (!state.currentUser) {
        window.location.href = '/index.html';
        return;
    }

    state.dashboardContext = AuthService.resolveUserDashboardContext(state.currentUser);
    if (state.dashboardContext.dashboardType !== 'admin') {
        if (redirectToDashboard(state.dashboardContext)) return;
        showError('Workflow profile not found or incomplete. Please logout and login again.');
        return;
    }

    const refreshButton = document.getElementById('refreshDashboard');
    if (refreshButton) {
        refreshButton.addEventListener('click', async () => {
            UI.showToast('Refreshing dashboard...', 'info');
            await loadDashboardData();
        });
    }

    await loadDashboardData();

    state.refreshInterval = setInterval(loadDashboardData, 60000);

    window.addEventListener('beforeunload', () => {
        if (state.refreshInterval) {
            clearInterval(state.refreshInterval);
        }
    });
}

function waitForApp() {
    return new Promise((resolve) => {
        if (document.querySelector('.navbar-main')) {
            resolve();
        } else {
            document.addEventListener('app:ready', resolve, { once: true });
        }
    });
}

async function loadDashboardData() {
    if (state.isLoading) return;

    state.isLoading = true;
    showLoading();

    try {
        const [overviewResponse, ticketsResponse] = await Promise.all([
            getAdminOverview({}),
            getAdminTickets({ limit: 50, offset: 0 })
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
        updateSummaryCards();
        renderTicketsTable();
    } catch (error) {
        console.error('Error loading admin dashboard:', error);
        if (error?.status === 403) {
            showError('You do not have access to this dashboard.');
        } else {
            showError(error.message || 'Failed to load dashboard data');
        }
    } finally {
        state.isLoading = false;
    }
}

function redirectToDashboard(context) {
    const targetPath = context?.dashboardPath || '';
    if (targetPath && window.location.pathname !== targetPath) {
        window.location.href = targetPath;
        return true;
    }
    return false;
}

function showLoading() {
    const loadingEl = document.getElementById('loadingState');
    const contentEl = document.getElementById('dashboardContent');
    const errorEl = document.getElementById('errorState');

    if (loadingEl) loadingEl.classList.remove('d-none');
    if (contentEl) contentEl.classList.add('d-none');
    if (errorEl) errorEl.classList.add('d-none');
}

function hideLoading() {
    const loadingEl = document.getElementById('loadingState');
    const contentEl = document.getElementById('dashboardContent');

    if (loadingEl) loadingEl.classList.add('d-none');
    if (contentEl) contentEl.classList.remove('d-none');
}

function showError(message) {
    const loadingEl = document.getElementById('loadingState');
    const contentEl = document.getElementById('dashboardContent');
    const errorEl = document.getElementById('errorState');
    const errorMsgEl = document.getElementById('errorMessage');

    if (loadingEl) loadingEl.classList.add('d-none');
    if (contentEl) contentEl.classList.add('d-none');
    if (errorEl) errorEl.classList.remove('d-none');
    if (errorMsgEl) errorMsgEl.textContent = message;
}

function updateSummaryCards() {
    if (!state.overview) return;

    const overview = state.overview;
    const totalTickets = overview.totalTickets || 0;
    const activeTickets = (overview.openTickets || 0) + (overview.inProgressTickets || 0);
    const resolvedTickets = overview.resolvedTickets || 0;
    const slaRiskTickets = (overview.slaAtRiskTickets || 0) + (overview.slaBreachedTickets || 0);

    document.getElementById('totalTickets').textContent = totalTickets;
    document.getElementById('activeTickets').textContent = activeTickets;
    document.getElementById('resolvedTickets').textContent = resolvedTickets;
    document.getElementById('slaRiskTickets').textContent = slaRiskTickets;

    const ticketCountEl = document.getElementById('ticketCount');
    if (ticketCountEl) ticketCountEl.textContent = totalTickets;
}

function renderTicketsTable() {
    const tableBodyEl = document.getElementById('ticketsTableBody');
    const emptyEl = document.getElementById('ticketsEmpty');

    if (!tableBodyEl) return;

    if (!state.tickets || state.tickets.length === 0) {
        tableBodyEl.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('d-none');
        return;
    }

    if (emptyEl) emptyEl.classList.add('d-none');

    tableBodyEl.innerHTML = '';

    state.tickets.forEach((ticket) => {
        const row = document.createElement('tr');
        const ticketId = ticket.ticketId || ticket.id || 'N/A';
        const assignedTo = ticket.assignedToName || ticket.assignedToEmail || ticket.assignedTo || 'Unassigned';
        const assignedLevel = ticket.assignedToLevel || 'N/A';
        const requester = ticket.requesterName || ticket.requester || ticket.requesterId || 'N/A';
        const location = getTicketLocationDisplay(ticket);
        const updatedAt = ticket.updatedAt || ticket.updated_at || ticket.createdAt || ticket.created_at;
        const status = ticket.status || 'UNKNOWN';
        const priority = ticket.priority || 'UNKNOWN';

        row.innerHTML = `
            <td>
                <a href="#" onclick="window.viewTicketDetails('${UI.escapeHTML(String(ticketId))}'); return false;" class="text-decoration-none fw-semibold">
                    <i class="bi bi-ticket-detailed me-1"></i>
                    ${UI.escapeHTML(String(ticketId)).substring(0, 8)}...
                </a>
            </td>
            <td>
                <div class="text-truncate" style="max-width: 220px;" title="${UI.escapeHTML(ticket.title || 'No title')}">
                    ${UI.escapeHTML(ticket.title || 'No title')}
                </div>
            </td>
            <td>
                <span class="badge ${getStatusBadgeClass(status)} px-2 py-1">
                    ${UI.escapeHTML(status)}
                </span>
            </td>
            <td>
                <span class="badge ${getPriorityBadgeClass(priority)} px-2 py-1">
                    ${UI.escapeHTML(priority)}
                </span>
            </td>
            <td>${UI.escapeHTML(String(assignedTo))}</td>
            <td><small class="text-muted">${UI.escapeHTML(String(assignedLevel))}</small></td>
            <td><small class="text-muted">${UI.escapeHTML(String(requester))}</small></td>
            <td><small class="text-muted">${UI.formatDate(updatedAt)}</small></td>
            <td><small class="text-muted">${UI.escapeHTML(location)}</small></td>
            <td>
                <button class="btn btn-sm btn-outline-primary" onclick="window.viewTicketDetails('${UI.escapeHTML(String(ticketId))}')">
                    View Details
                </button>
            </td>
        `;

        tableBodyEl.appendChild(row);
    });
}

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

function getPriorityBadgeClass(priority) {
    switch (priority?.toUpperCase()) {
        case 'CRITICAL': return 'bg-danger';
        case 'HIGH': return 'bg-warning text-dark';
        case 'MEDIUM': return 'bg-info';
        case 'LOW': return 'bg-success';
        default: return 'bg-secondary';
    }
}

window.viewTicketDetails = async function(ticketId) {
    const modalHandle = openTicketDetailsModal({ title: `Ticket ${ticketId}` });
    modalHandle.setLoading('Loading ticket details...');

    try {
        const response = await getAdminTicketDetails(ticketId);
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

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdminDashboard);
} else {
    initAdminDashboard();
}
