import UI from '/assets/js/ui.js';
import SLAService from '/services/slaService.js';

const state = {
    tickets: [],
    total: 0,
    isLoading: false,
    filters: {
        q: '',
        status: '',
        priority: ''
    }
};

export async function initSLAPage() {
    await waitForApp();
    setupEventListeners();
    await loadTickets();
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

function setupEventListeners() {
    document.getElementById('refreshSlaBtn')?.addEventListener('click', () => loadTickets());

    document.getElementById('slaSearchInput')?.addEventListener('input', UI.debounce((event) => {
        state.filters.q = event.target.value.trim();
        loadTickets();
    }, 300));

    document.getElementById('slaStatusFilter')?.addEventListener('change', (event) => {
        state.filters.status = event.target.value;
        loadTickets();
    });

    document.getElementById('slaPriorityFilter')?.addEventListener('change', (event) => {
        state.filters.priority = event.target.value;
        loadTickets();
    });

    document.getElementById('clearSlaFilters')?.addEventListener('click', () => {
        state.filters = { q: '', status: '', priority: '' };
        document.getElementById('slaSearchInput').value = '';
        document.getElementById('slaStatusFilter').value = '';
        document.getElementById('slaPriorityFilter').value = '';
        loadTickets();
    });

    document.getElementById('slaTableBody')?.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-action]');
        if (!button) return;

        const { action, ticketId } = button.dataset;
        if (!ticketId) return;

        if (action === 'view') {
            await openDetails(ticketId);
            return;
        }

        if (action === 'pause') {
            const confirmed = await UI.confirm({
                title: 'Pause SLA',
                message: `Pause SLA tracking for ticket ${ticketId}?`,
                confirmText: 'Pause',
                confirmClass: 'btn-warning'
            });

            if (!confirmed) return;

            const loader = UI.showLoading('Pausing SLA...');
            try {
                await SLAService.pauseTicket(ticketId, 'Paused from SLA tracking page');
                UI.success(`SLA paused for ticket ${ticketId}`);
                await loadTickets();
            } catch (error) {
                UI.error(error.message || 'Failed to pause SLA');
            } finally {
                loader.hide();
            }
            return;
        }

        if (action === 'resume') {
            const loader = UI.showLoading('Resuming SLA...');
            try {
                await SLAService.resumeTicket(ticketId);
                UI.success(`SLA resumed for ticket ${ticketId}`);
                await loadTickets();
            } catch (error) {
                UI.error(error.message || 'Failed to resume SLA');
            } finally {
                loader.hide();
            }
        }
    });
}

async function loadTickets() {
    if (state.isLoading) return;
    state.isLoading = true;
    showLoading();

    try {
        const response = await SLAService.getTickets({
            ...state.filters,
            limit: 100
        });

        const data = response.data || {};
        state.tickets = Array.isArray(data.items) ? data.items : [];
        state.total = data.total || state.tickets.length;

        renderTickets();
        updateSummary();
        showTableState();
    } catch (error) {
        console.error('[SLA Page] Failed to load tickets:', error);
        showError(error.message || 'Failed to load SLA tickets');
    } finally {
        state.isLoading = false;
    }
}

function updateSummary() {
    const countEl = document.getElementById('slaTicketCount');
    const statusEl = document.getElementById('slaConnectionStatus');
    if (countEl) {
        countEl.textContent = `${state.total} ticket${state.total === 1 ? '' : 's'} connected to SLA`;
    }
    if (statusEl) {
        statusEl.textContent = state.total > 0 ? 'SLA tracking data loaded' : 'No SLA-linked tickets found yet';
    }
}

function showLoading() {
    UI.toggle('#slaLoading', true);
    UI.toggle('#slaEmpty', false);
    UI.toggle('#slaError', false);
    UI.toggle('#slaTableContainer', false);
}

function showTableState() {
    UI.toggle('#slaLoading', false);
    UI.toggle('#slaError', false);
    UI.toggle('#slaEmpty', state.tickets.length === 0);
    UI.toggle('#slaTableContainer', state.tickets.length > 0);
}

function showError(message) {
    UI.toggle('#slaLoading', false);
    UI.toggle('#slaEmpty', false);
    UI.toggle('#slaTableContainer', false);
    UI.toggle('#slaError', true);
    const errorEl = document.getElementById('slaErrorMessage');
    if (errorEl) errorEl.textContent = message;
}

function renderTickets() {
    const tableBody = document.getElementById('slaTableBody');
    if (!tableBody) return;

    tableBody.innerHTML = state.tickets.map((ticket) => {
        const title = ticket.ticketTitle || `Ticket ${ticket.ticketId}`;
        const assignedTo = ticket.technicianName || ticket.assignedTo || 'Unassigned';
        const responseDue = formatDateTime(ticket.responseDueAt);
        const resolutionDue = formatDateTime(ticket.resolutionDueAt);
        const remaining = getRemainingTime(ticket);

        return `
            <tr>
                <td>
                    <div class="fw-semibold">${UI.escapeHTML(ticket.ticketId)}</div>
                    <div class="text-muted small">${UI.escapeHTML(title)}</div>
                </td>
                <td>${renderStatusBadge(ticket.ticketStatus, 'ticket')}</td>
                <td>${renderStatusBadge(ticket.status, 'sla')}</td>
                <td><span class="badge bg-light text-dark">${UI.escapeHTML(ticket.priority)}</span></td>
                <td>${UI.escapeHTML(assignedTo)}</td>
                <td>${responseDue}</td>
                <td>${resolutionDue}</td>
                <td>${remaining}</td>
                <td class="text-end">${renderActionButtons(ticket)}</td>
            </tr>
        `;
    }).join('');
}

function renderActionButtons(ticket) {
    const ticketId = UI.escapeHTML(ticket.ticketId);
    const base = `
        <button class="btn btn-outline-secondary" data-action="view" data-ticket-id="${ticketId}">
            <i class="bi bi-eye"></i>
        </button>
    `;

    if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
        return `<div class="btn-group btn-group-sm">${base}</div>`;
    }

    const actionButton = ticket.status === 'PAUSED'
        ? `<button class="btn btn-outline-success" data-action="resume" data-ticket-id="${ticketId}"><i class="bi bi-play-fill"></i></button>`
        : `<button class="btn btn-outline-warning" data-action="pause" data-ticket-id="${ticketId}"><i class="bi bi-pause-fill"></i></button>`;

    return `<div class="btn-group btn-group-sm">${base}${actionButton}</div>`;
}

async function openDetails(ticketId) {
    const loader = UI.showLoading('Loading SLA details...');
    try {
        const response = await SLAService.getTicket(ticketId);
        const ticket = response.data;
        fillDetailsModal(ticket);
        bootstrap.Modal.getOrCreateInstance(document.getElementById('slaDetailsModal')).show();
    } catch (error) {
        UI.error(error.message || 'Failed to load SLA details');
    } finally {
        loader.hide();
    }
}

function fillDetailsModal(ticket) {
    document.getElementById('slaDetailsTitle').textContent = ticket.ticketTitle || `Ticket ${ticket.ticketId}`;
    document.getElementById('slaDetailsBody').innerHTML = `
        <div class="row g-3">
            <div class="col-md-6">
                <div class="border rounded p-3 h-100">
                    <h6 class="text-muted text-uppercase small mb-3">Ticket</h6>
                    ${detailRow('Ticket ID', ticket.ticketId)}
                    ${detailRow('Ticket Status', renderStatusBadge(ticket.ticketStatus, 'ticket'))}
                    ${detailRow('SLA Status', renderStatusBadge(ticket.status, 'sla'))}
                    ${detailRow('Priority', ticket.priority)}
                    ${detailRow('Assigned To', ticket.technicianName || ticket.assignedTo || 'Unassigned')}
                    ${detailRow('Support Group', ticket.supportGroupId || 'N/A')}
                </div>
            </div>
            <div class="col-md-6">
                <div class="border rounded p-3 h-100">
                    <h6 class="text-muted text-uppercase small mb-3">Deadlines</h6>
                    ${detailRow('Created At', formatDateTime(ticket.createdAt))}
                    ${detailRow('Response Due', formatDateTime(ticket.responseDueAt))}
                    ${detailRow('Resolution Due', formatDateTime(ticket.resolutionDueAt))}
                    ${detailRow('First Response', formatDateTime(ticket.firstResponseAt))}
                    ${detailRow('Resolved At', formatDateTime(ticket.resolvedAt))}
                    ${detailRow('Closed At', formatDateTime(ticket.closedAt))}
                </div>
            </div>
            <div class="col-md-6">
                <div class="border rounded p-3 h-100">
                    <h6 class="text-muted text-uppercase small mb-3">Contacts</h6>
                    ${detailRow('Technician', ticket.technicianName || 'N/A')}
                    ${detailRow('Technician Email', ticket.technicianEmail || 'N/A')}
                    ${detailRow('Supervisor', ticket.supervisorName || 'N/A')}
                    ${detailRow('Supervisor Email', ticket.supervisorEmail || 'N/A')}
                </div>
            </div>
            <div class="col-md-6">
                <div class="border rounded p-3 h-100">
                    <h6 class="text-muted text-uppercase small mb-3">Policy & Flags</h6>
                    ${detailRow('Policy', ticket.policy?.name || 'N/A')}
                    ${detailRow('Response Warning 1', ticket.responseWarning1Sent ? 'Sent' : 'Not sent')}
                    ${detailRow('Response Warning 2', ticket.responseWarning2Sent ? 'Sent' : 'Not sent')}
                    ${detailRow('Response Breach', ticket.responseBreachSent ? 'Yes' : 'No')}
                    ${detailRow('Resolution Warning 1', ticket.resolutionWarning1Sent ? 'Sent' : 'Not sent')}
                    ${detailRow('Resolution Warning 2', ticket.resolutionWarning2Sent ? 'Sent' : 'Not sent')}
                    ${detailRow('Resolution Breach', ticket.resolutionBreachSent ? 'Yes' : 'No')}
                </div>
            </div>
        </div>
    `;
}

function detailRow(label, value) {
    return `
        <div class="d-flex justify-content-between align-items-start gap-3 mb-2">
            <span class="text-muted small">${UI.escapeHTML(label)}</span>
            <span class="text-end">${value}</span>
        </div>
    `;
}

function renderStatusBadge(value, type) {
    const normalized = String(value || '').toUpperCase();
    let badgeClass = 'bg-secondary';

    if (type === 'sla') {
        if (normalized === 'ACTIVE') badgeClass = 'bg-success';
        if (normalized === 'PAUSED') badgeClass = 'bg-warning text-dark';
        if (normalized === 'BREACHED') badgeClass = 'bg-danger';
        if (normalized === 'RESOLVED' || normalized === 'CLOSED') badgeClass = 'bg-info text-dark';
    } else {
        if (normalized === 'OPEN') badgeClass = 'bg-secondary';
        if (normalized === 'IN_PROGRESS') badgeClass = 'bg-primary';
        if (normalized === 'RESOLVED') badgeClass = 'bg-success';
        if (normalized === 'CLOSED') badgeClass = 'bg-dark';
    }

    return `<span class="badge ${badgeClass}">${UI.escapeHTML(normalized || 'UNKNOWN')}</span>`;
}

function getRemainingTime(ticket) {
    if (ticket.status === 'PAUSED') return '<span class="text-warning fw-semibold">Paused</span>';
    if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') return '<span class="text-success">Completed</span>';

    const dueDate = ticket.firstResponseAt ? ticket.resolutionDueAt : ticket.responseDueAt;
    if (!dueDate) return 'N/A';

    const ms = new Date(dueDate).getTime() - Date.now();
    const minutes = Math.ceil(ms / 60000);

    if (minutes < 0) {
        return `<span class="text-danger fw-semibold">${Math.abs(minutes)} min overdue</span>`;
    }
    if (minutes < 60) {
        return `<span class="text-warning fw-semibold">${minutes} min</span>`;
    }

    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return `${hours}h ${remainder}m`;
}

function formatDateTime(value) {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleString();
}

document.addEventListener('DOMContentLoaded', initSLAPage);
