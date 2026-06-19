import UI from '/assets/js/ui.js';
import SLAService from '/services/slaService.js';
import AuthService from '/services/authService.js';

const state = {
    tickets: [],
    total: 0,
    isLoading: false,
    isAdmin: false,
    policies: [],
    pauseAnalytics: null,
    filters: {
        q: '',
        status: '',
        priority: ''
    }
};

const PAUSE_REASON_LABELS = {
    WAITING_FOR_USER: 'Waiting For User',
    WAITING_FOR_ASSET: 'Waiting For Asset',
    PENDING_VENDOR: 'Pending Vendor',
    APPROVAL_REQUIRED: 'Approval Required',
    OUT_OF_STOCK: 'Out Of Stock',
    OTHER: 'Other',
};

const PAUSE_SOURCE_LABELS = {
    USER_RELATED: 'User Related',
    INVENTORY_RELATED: 'Inventory Related',
    VENDOR_RELATED: 'Vendor Related',
    APPROVAL: 'Approval',
    SYSTEM: 'System',
    MANUAL: 'Manual',
    OTHER: 'Other',
};

export async function initSLAPage() {
    await waitForApp();
    state.isAdmin = AuthService.isAdmin();
    toggleAdminControls();
    setupEventListeners();
    await loadPageData();
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
    document.getElementById('refreshSlaBtn')?.addEventListener('click', () => loadPageData());
    document.getElementById('editSlaPoliciesBtn')?.addEventListener('click', () => openPoliciesModal());
    document.getElementById('slaPoliciesForm')?.addEventListener('submit', handlePoliciesSave);
    document.getElementById('slaTicketDeadlineForm')?.addEventListener('submit', handleTicketDeadlineSave);
    document.getElementById('slaPauseForm')?.addEventListener('submit', handlePauseSave);

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
        const searchEl = document.getElementById('slaSearchInput');
        const statusEl = document.getElementById('slaStatusFilter');
        const priorityEl = document.getElementById('slaPriorityFilter');
        if (searchEl) searchEl.value = '';
        if (statusEl) statusEl.value = '';
        if (priorityEl) priorityEl.value = '';
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

        if (action === 'edit-deadline') {
            await openTicketDeadlineModal(ticketId);
            return;
        }

        if (action === 'pause') {
            openPauseModal(ticketId);
            return;
        }

        if (action === 'resume') {
            const loader = UI.showLoading('Resuming SLA...');
            try {
                await SLAService.resumeTicket(ticketId);
                UI.success(`SLA resumed for ticket ${ticketId}`);
                await loadPageData();
            } catch (error) {
                UI.error(error.message || 'Failed to resume SLA');
            } finally {
                loader.hide();
            }
        }
    });
}

function toggleAdminControls() {
    UI.toggle('#editSlaPoliciesBtn', state.isAdmin);
}

async function loadPageData() {
    await Promise.all([
        loadTickets(),
        loadPauseAnalytics(),
    ]);
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

async function loadPauseAnalytics() {
    showAnalyticsLoading();

    try {
        const response = await SLAService.getPauseAnalytics();
        state.pauseAnalytics = response.data || null;
        renderPauseAnalytics();
    } catch (error) {
        console.error('[SLA Page] Failed to load pause analytics:', error);
        showAnalyticsError(error.message || 'Failed to load pause analytics');
    }
}

function updateSummary() {
    const countEl = document.getElementById('slaTicketCount');
    const statusEl = document.getElementById('slaConnectionStatus');
    if (countEl) {
        countEl.textContent = `${state.total} ticket${state.total === 1 ? '' : 's'} connected to SLA`;
    }
    if (statusEl) {
        const pausedCount = Array.isArray(state.pauseAnalytics?.current_paused_tickets)
            ? state.pauseAnalytics.current_paused_tickets.length
            : 0;
        statusEl.textContent = pausedCount > 0
            ? `${pausedCount} ticket${pausedCount === 1 ? '' : 's'} currently paused`
            : (state.total > 0 ? 'SLA tracking data loaded' : 'No SLA-linked tickets found yet');
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

function showAnalyticsLoading() {
    UI.toggle('#slaAnalyticsLoading', true);
    UI.toggle('#slaAnalyticsContent', false);
    UI.toggle('#slaAnalyticsError', false);
}

function showAnalyticsError(message) {
    UI.toggle('#slaAnalyticsLoading', false);
    UI.toggle('#slaAnalyticsContent', false);
    UI.toggle('#slaAnalyticsError', true);
    const errorEl = document.getElementById('slaAnalyticsError');
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
        const pauseMeta = ticket.status === 'PAUSED'
            ? `<div class="small text-warning mt-1">Paused: ${UI.escapeHTML(formatPauseReason(ticket.pauseReason || 'OTHER'))}</div>`
            : '';

        return `
            <tr>
                <td>
                    <div class="fw-semibold">${UI.escapeHTML(ticket.ticketId)}</div>
                    <div class="text-muted small">${UI.escapeHTML(title)}</div>
                    ${pauseMeta}
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
    const editButton = state.isAdmin
        ? `<button class="btn btn-outline-info" data-action="edit-deadline" data-ticket-id="${ticketId}" title="Edit Ticket SLA Time"><i class="bi bi-pencil"></i></button>`
        : '';

    if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
        return `<div class="btn-group btn-group-sm">${base}${editButton}</div>`;
    }

    const actionButton = ticket.status === 'PAUSED'
        ? `<button class="btn btn-outline-success" data-action="resume" data-ticket-id="${ticketId}"><i class="bi bi-play-fill"></i></button>`
        : `<button class="btn btn-outline-warning" data-action="pause" data-ticket-id="${ticketId}"><i class="bi bi-pause-fill"></i></button>`;

    return `<div class="btn-group btn-group-sm">${base}${editButton}${actionButton}</div>`;
}

function renderPauseAnalytics() {
    const data = state.pauseAnalytics || {};
    const totalPauseCount = Number(data.total_pause_count || 0);
    const currentPausedTickets = Array.isArray(data.current_paused_tickets) ? data.current_paused_tickets : [];
    const reasonStats = Array.isArray(data.pause_reason_statistics) ? data.pause_reason_statistics : [];
    const rankedReasons = reasonStats
        .slice()
        .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
    const visibleReasonStats = rankedReasons.filter((entry) => Number(entry.count || 0) > 0);
    const topReason = totalPauseCount > 0 ? (visibleReasonStats[0] || null) : null;

    const totalCountEl = document.getElementById('slaTotalPauseCount');
    const currentPausedEl = document.getElementById('slaCurrentlyPausedCount');
    const topReasonEl = document.getElementById('slaTopPauseReason');
    const topReasonMetaEl = document.getElementById('slaTopPauseReasonMeta');
    const reasonsOverviewChipEl = document.getElementById('slaReasonsOverviewChip');
    const currentPausedChipEl = document.getElementById('slaCurrentPausedChip');
    const topReasonHighlightTitleEl = document.getElementById('slaTopReasonHighlightTitle');
    const topReasonHighlightMetaEl = document.getElementById('slaTopReasonHighlightMeta');
    const reasonsBody = document.getElementById('slaPauseReasonsBody');
    const currentPausedBody = document.getElementById('slaCurrentPausedBody');

    if (totalCountEl) totalCountEl.textContent = String(totalPauseCount);
    if (currentPausedEl) currentPausedEl.textContent = String(currentPausedTickets.length);
    if (topReasonEl) topReasonEl.textContent = topReason?.value ? formatPauseReason(topReason.value) : 'N/A';
    if (topReasonMetaEl) {
        topReasonMetaEl.textContent = topReason?.value
            ? `${topReason.count} event${topReason.count === 1 ? '' : 's'} • ${formatPercentage(topReason.percentage || 0)} share`
            : 'No pause events yet';
    }
    if (reasonsOverviewChipEl) reasonsOverviewChipEl.textContent = `${visibleReasonStats.length} active reason${visibleReasonStats.length === 1 ? '' : 's'}`;
    if (currentPausedChipEl) currentPausedChipEl.textContent = `${currentPausedTickets.length} active`;
    if (topReasonHighlightTitleEl) {
        topReasonHighlightTitleEl.textContent = topReason?.value ? formatPauseReason(topReason.value) : 'N/A';
    }
    if (topReasonHighlightMetaEl) {
        topReasonHighlightMetaEl.textContent = topReason?.value
            ? `${topReason.count} pause event${topReason.count === 1 ? '' : 's'} recorded, representing ${formatPercentage(topReason.percentage || 0)} of all pauses.`
            : 'No pause events available yet.';
    }

    if (reasonsBody) {
        const maxCount = visibleReasonStats[0]?.count || 0;
        reasonsBody.innerHTML = visibleReasonStats.length > 0
            ? visibleReasonStats
                .map((entry) => `
                    <div class="sla-reason-row ${entry === topReason ? 'is-top' : ''}">
                        <div class="sla-reason-row-head">
                            <div>
                                <strong>${UI.escapeHTML(formatPauseReason(entry.value))}</strong>
                                <span>${UI.escapeHTML(String(entry.count || 0))} event${Number(entry.count || 0) === 1 ? '' : 's'}</span>
                            </div>
                            <em>${UI.escapeHTML(formatPercentage(entry.percentage || 0))}</em>
                        </div>
                        <div class="sla-reason-bar-track">
                            <i style="width: ${maxCount > 0 ? Math.max(8, Math.round((Number(entry.count || 0) / maxCount) * 100)) : 0}%"></i>
                        </div>
                    </div>
                `).join('')
            : `
                <div class="sla-empty-analytics">
                    <i class="bi bi-bar-chart"></i>
                    <span>No pause data available yet.</span>
                </div>
            `;
    }

    if (currentPausedBody) {
        currentPausedBody.innerHTML = currentPausedTickets.length > 0
            ? currentPausedTickets.map((ticket) => `
                <div class="sla-paused-ticket-item">
                    <div class="sla-paused-ticket-top">
                        <strong>${UI.escapeHTML(ticket.ticketId || '-')}</strong>
                        <span class="badge bg-light text-dark">${UI.escapeHTML(ticket.priority || '-')}</span>
                    </div>
                    <div class="sla-paused-ticket-meta">
                        <span>${UI.escapeHTML(formatPauseReason(ticket.pauseReason || 'OTHER'))}</span>
                        <span>${UI.escapeHTML(formatDateTime(ticket.pausedAt))}</span>
                    </div>
                </div>
            `).join('')
            : `
                <div class="sla-empty-analytics">
                    <i class="bi bi-check2-circle"></i>
                    <span>No tickets are currently paused.</span>
                </div>
            `;
    }

    UI.toggle('#slaAnalyticsLoading', false);
    UI.toggle('#slaAnalyticsError', false);
    UI.toggle('#slaAnalyticsContent', true);
    updateSummary();
}

function openPauseModal(ticketId) {
    document.getElementById('slaPauseTicketId').value = ticketId;
    document.getElementById('slaPauseReason').value = 'WAITING_FOR_USER';
    document.getElementById('slaPauseSource').value = 'USER_RELATED';
    document.getElementById('slaPauseNotes').value = '';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('slaPauseModal')).show();
}

async function handlePauseSave(event) {
    event.preventDefault();

    const ticketId = document.getElementById('slaPauseTicketId').value;
    const reason = document.getElementById('slaPauseReason').value;
    const source = document.getElementById('slaPauseSource').value;
    const notes = document.getElementById('slaPauseNotes').value.trim();

    if (!ticketId || !reason || !source) {
        UI.error('Pause reason and source are required.');
        return;
    }

    const loader = UI.showLoading('Pausing SLA...');
    const saveButton = document.getElementById('saveSlaPauseBtn');
    if (saveButton) saveButton.disabled = true;

    try {
        await SLAService.pauseTicket(ticketId, {
            reason,
            source,
            notes,
        });
        UI.success(`SLA paused for ticket ${ticketId}`);
        bootstrap.Modal.getOrCreateInstance(document.getElementById('slaPauseModal')).hide();
        document.getElementById('slaPauseForm')?.reset();
        await loadPageData();
    } catch (error) {
        UI.error(error.message || 'Failed to pause SLA');
    } finally {
        if (saveButton) saveButton.disabled = false;
        loader.hide();
    }
}

async function openPoliciesModal() {
    if (!state.isAdmin) {
        UI.error('Only administrators can edit SLA policy time.');
        return;
    }

    const modalElement = document.getElementById('slaPoliciesModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
    modal.show();

    await loadPolicies();
}

async function loadPolicies() {
    const body = document.getElementById('slaPoliciesBody');
    if (!body) return;

    body.innerHTML = `
        <div class="text-center py-4">
            <div class="spinner-border text-primary mb-3" role="status">
                <span class="visually-hidden">Loading policies...</span>
            </div>
            <p class="text-muted mb-0">Loading SLA policies...</p>
        </div>
    `;

    try {
        const response = await SLAService.getPolicies();
        const items = Array.isArray(response.data) ? response.data : [];
        state.policies = items
            .slice()
            .sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority));
        renderPoliciesForm();
    } catch (error) {
        body.innerHTML = `
            <div class="alert alert-danger mb-0">
                ${UI.escapeHTML(error.message || 'Failed to load SLA policies.')}
            </div>
        `;
    }
}

function renderPoliciesForm() {
    const body = document.getElementById('slaPoliciesBody');
    if (!body) return;

    if (state.policies.length === 0) {
        body.innerHTML = '<div class="alert alert-warning mb-0">No SLA policies were found.</div>';
        return;
    }

    body.innerHTML = `
        <div class="table-responsive">
            <table class="table align-middle">
                <thead>
                    <tr>
                        <th>Priority</th>
                        <th>Policy Name</th>
                        <th>Response Minutes</th>
                        <th>Resolution Minutes</th>
                    </tr>
                </thead>
                <tbody>
                    ${state.policies.map((policy) => `
                        <tr data-priority="${UI.escapeHTML(policy.priority)}">
                            <td><span class="badge bg-light text-dark">${UI.escapeHTML(policy.priority)}</span></td>
                            <td>${UI.escapeHTML(policy.name || `${policy.priority} Priority`)}</td>
                            <td>
                                <input
                                    type="number"
                                    class="form-control"
                                    data-field="responseMinutes"
                                    data-priority="${UI.escapeHTML(policy.priority)}"
                                    value="${Number(policy.responseMinutes || 0)}"
                                    min="1"
                                    step="1"
                                    required
                                >
                            </td>
                            <td>
                                <input
                                    type="number"
                                    class="form-control"
                                    data-field="resolutionMinutes"
                                    data-priority="${UI.escapeHTML(policy.priority)}"
                                    value="${Number(policy.resolutionMinutes || 0)}"
                                    min="1"
                                    step="1"
                                    required
                                >
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function handlePoliciesSave(event) {
    event.preventDefault();

    if (!state.isAdmin) {
        UI.error('Only administrators can edit SLA policy time.');
        return;
    }

    const nextPolicies = collectPoliciesFromForm();
    if (!nextPolicies) return;

    const changedPolicies = nextPolicies.filter((policy, index) => {
        const current = state.policies[index];
        return !current ||
            Number(current.responseMinutes) !== Number(policy.responseMinutes) ||
            Number(current.resolutionMinutes) !== Number(policy.resolutionMinutes);
    });

    if (changedPolicies.length === 0) {
        UI.info('No SLA time changes to save.');
        return;
    }

    const loader = UI.showLoading('Saving SLA policy time...');
    const saveButton = document.getElementById('saveSlaPoliciesBtn');
    if (saveButton) saveButton.disabled = true;

    try {
        for (const policy of changedPolicies) {
            await SLAService.upsertPolicy(policy);
        }

        state.policies = nextPolicies;
        UI.success('SLA policy time updated successfully.');
        bootstrap.Modal.getOrCreateInstance(document.getElementById('slaPoliciesModal')).hide();
    } catch (error) {
        UI.error(error.message || 'Failed to save SLA policy time.');
    } finally {
        if (saveButton) saveButton.disabled = false;
        loader.hide();
    }
}

async function openTicketDeadlineModal(ticketId) {
    if (!state.isAdmin) {
        UI.error('Only administrators can edit ticket SLA time.');
        return;
    }

    const existing = state.tickets.find((ticket) => String(ticket.ticketId) === String(ticketId));
    const ticket = existing || (await SLAService.getTicket(ticketId)).data;

    document.getElementById('slaDeadlineTicketId').value = ticket.ticketId;
    document.getElementById('slaDeadlineResponseDueAt').value = toDateTimeLocalValue(ticket.responseDueAt);
    document.getElementById('slaDeadlineResolutionDueAt').value = toDateTimeLocalValue(ticket.resolutionDueAt);
    document.getElementById('slaTicketDeadlineTitle').textContent = `Edit SLA Time: ${ticket.ticketId}`;

    bootstrap.Modal.getOrCreateInstance(document.getElementById('slaTicketDeadlineModal')).show();
}

async function handleTicketDeadlineSave(event) {
    event.preventDefault();

    if (!state.isAdmin) {
        UI.error('Only administrators can edit ticket SLA time.');
        return;
    }

    const ticketId = document.getElementById('slaDeadlineTicketId').value;
    const responseDueAtRaw = document.getElementById('slaDeadlineResponseDueAt').value;
    const resolutionDueAtRaw = document.getElementById('slaDeadlineResolutionDueAt').value;

    if (!ticketId || !responseDueAtRaw || !resolutionDueAtRaw) {
        UI.error('Both SLA time values are required.');
        return;
    }

    const responseDueAt = new Date(responseDueAtRaw);
    const resolutionDueAt = new Date(resolutionDueAtRaw);

    if (Number.isNaN(responseDueAt.getTime()) || Number.isNaN(resolutionDueAt.getTime())) {
        UI.error('Please enter valid SLA time values.');
        return;
    }

    if (resolutionDueAt.getTime() < responseDueAt.getTime()) {
        UI.error('Resolution due time must be after response due time.');
        return;
    }

    const loader = UI.showLoading('Saving ticket SLA time...');
    const saveButton = document.getElementById('saveSlaTicketDeadlineBtn');
    if (saveButton) saveButton.disabled = true;

    try {
        await SLAService.updateTicketDeadlines(ticketId, {
            responseDueAt: responseDueAt.toISOString(),
            resolutionDueAt: resolutionDueAt.toISOString(),
        });

        UI.success(`SLA time updated for ticket ${ticketId}.`);
        bootstrap.Modal.getOrCreateInstance(document.getElementById('slaTicketDeadlineModal')).hide();
        await loadTickets();
    } catch (error) {
        UI.error(error.message || 'Failed to update ticket SLA time.');
    } finally {
        if (saveButton) saveButton.disabled = false;
        loader.hide();
    }
}

function collectPoliciesFromForm() {
    const nextPolicies = state.policies.map((policy) => {
        const responseInput = document.querySelector(`[data-field="responseMinutes"][data-priority="${cssEscape(policy.priority)}"]`);
        const resolutionInput = document.querySelector(`[data-field="resolutionMinutes"][data-priority="${cssEscape(policy.priority)}"]`);

        const responseMinutes = Number(responseInput?.value);
        const resolutionMinutes = Number(resolutionInput?.value);

        if (!Number.isInteger(responseMinutes) || responseMinutes <= 0) {
            UI.error(`Response minutes must be a positive number for ${policy.priority}.`);
            responseInput?.focus();
            return null;
        }

        if (!Number.isInteger(resolutionMinutes) || resolutionMinutes <= 0) {
            UI.error(`Resolution minutes must be a positive number for ${policy.priority}.`);
            resolutionInput?.focus();
            return null;
        }

        return {
            ...policy,
            responseMinutes,
            resolutionMinutes,
        };
    });

    return nextPolicies.every(Boolean) ? nextPolicies : null;
}

function priorityRank(priority) {
    const order = {
        LOW: 0,
        MEDIUM: 1,
        HIGH: 2,
        CRITICAL: 3,
    };

    return order[String(priority || '').toUpperCase()] ?? 99;
}

function cssEscape(value) {
    if (window.CSS?.escape) return window.CSS.escape(String(value || ''));
    return String(value || '').replace(/"/g, '\\"');
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
    const isPaused = String(ticket.status || '').toUpperCase() === 'PAUSED';
    const totalPausedMinutes = getAggregatePausedMinutes(ticket);

    document.getElementById('slaDetailsTitle').textContent = ticket.ticketTitle || `Ticket ${ticket.ticketId}`;
    document.getElementById('slaDetailsBody').innerHTML = `
        <div class="row g-3">
            <div class="col-md-6">
                <div class="border rounded p-3 h-100">
                    <h6 class="text-muted text-uppercase small mb-3">Ticket</h6>
                    ${detailRow('Ticket ID', ticket.ticketId)}
                    ${detailRow('Ticket Status', renderStatusBadge(ticket.ticketStatus, 'ticket'))}
                    ${detailRow('SLA Status', renderStatusBadge(ticket.status, 'sla'))}
                    ${detailRow('Priority', UI.escapeHTML(ticket.priority || 'N/A'))}
                    ${detailRow('Assigned To', UI.escapeHTML(ticket.technicianName || ticket.assignedTo || 'Unassigned'))}
                    ${detailRow('Support Group', UI.escapeHTML(ticket.supportGroupId || 'N/A'))}
                </div>
            </div>
            <div class="col-md-6">
                <div class="border rounded p-3 h-100">
                    <h6 class="text-muted text-uppercase small mb-3">Deadlines</h6>
                    ${detailRow('Created At', UI.escapeHTML(formatDateTime(ticket.createdAt)))}
                    ${detailRow('Response Due', UI.escapeHTML(formatDateTime(ticket.responseDueAt)))}
                    ${detailRow('Resolution Due', UI.escapeHTML(formatDateTime(ticket.resolutionDueAt)))}
                    ${detailRow('First Response', UI.escapeHTML(formatDateTime(ticket.firstResponseAt)))}
                    ${detailRow('Resolved At', UI.escapeHTML(formatDateTime(ticket.resolvedAt)))}
                    ${detailRow('Closed At', UI.escapeHTML(formatDateTime(ticket.closedAt)))}
                </div>
            </div>
            <div class="col-md-6">
                <div class="border rounded p-3 h-100">
                    <h6 class="text-muted text-uppercase small mb-3">Contacts</h6>
                    ${detailRow('Technician', UI.escapeHTML(ticket.technicianName || 'N/A'))}
                    ${detailRow('Technician Email', UI.escapeHTML(ticket.technicianEmail || 'N/A'))}
                    ${detailRow('Supervisor', UI.escapeHTML(ticket.supervisorName || 'N/A'))}
                    ${detailRow('Supervisor Email', UI.escapeHTML(ticket.supervisorEmail || 'N/A'))}
                </div>
            </div>
            <div class="col-md-6">
                <div class="border rounded p-3 h-100">
                    <h6 class="text-muted text-uppercase small mb-3">Policy & Flags</h6>
                    ${detailRow('Policy', UI.escapeHTML(ticket.policy?.name || 'N/A'))}
                    ${detailRow('Response Warning 1', UI.escapeHTML(ticket.responseWarning1Sent ? 'Sent' : 'Not sent'))}
                    ${detailRow('Response Warning 2', UI.escapeHTML(ticket.responseWarning2Sent ? 'Sent' : 'Not sent'))}
                    ${detailRow('Response Breach', UI.escapeHTML(ticket.responseBreachSent ? 'Yes' : 'No'))}
                    ${detailRow('Resolution Warning 1', UI.escapeHTML(ticket.resolutionWarning1Sent ? 'Sent' : 'Not sent'))}
                    ${detailRow('Resolution Warning 2', UI.escapeHTML(ticket.resolutionWarning2Sent ? 'Sent' : 'Not sent'))}
                    ${detailRow('Resolution Breach', UI.escapeHTML(ticket.resolutionBreachSent ? 'Yes' : 'No'))}
                </div>
            </div>
            <div class="col-12">
                <div class="border rounded p-3">
                    <h6 class="text-muted text-uppercase small mb-3">Pause Tracking</h6>
                    ${detailRow('SLA Status', renderStatusBadge(ticket.status, 'sla'))}
                    ${detailRow('Pause Reason', UI.escapeHTML(isPaused ? formatPauseReason(ticket.pauseReason || 'OTHER') : 'N/A'))}
                    ${detailRow('Pause Source', UI.escapeHTML(isPaused ? formatPauseSource(ticket.pauseSource || 'MANUAL') : 'N/A'))}
                    ${detailRow('Pause Notes', UI.escapeHTML(isPaused ? (ticket.pauseNotes || 'N/A') : 'N/A'))}
                    ${detailRow('Paused Since', UI.escapeHTML(isPaused ? formatDateTime(ticket.pausedAt) : 'N/A'))}
                    ${detailRow('Total Paused Time', UI.escapeHTML(formatDurationMinutes(totalPausedMinutes)))}
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
    if (ticket.status === 'PAUSED') {
        const reason = ticket.pauseReason ? ` (${formatPauseReason(ticket.pauseReason)})` : '';
        return `<span class="text-warning fw-semibold">Paused${UI.escapeHTML(reason)}</span>`;
    }
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

function getAggregatePausedMinutes(ticket) {
    const persisted = Number(ticket.totalPausedMinutes || 0);
    if (String(ticket.status || '').toUpperCase() !== 'PAUSED' || !ticket.pausedAt) {
        return persisted;
    }

    const pausedAt = new Date(ticket.pausedAt);
    if (Number.isNaN(pausedAt.getTime())) return persisted;
    return persisted + Math.max(0, Math.ceil((Date.now() - pausedAt.getTime()) / 60000));
}

function formatDurationMinutes(totalMinutes) {
    const safeMinutes = Math.max(0, Number(totalMinutes || 0));
    if (safeMinutes < 60) return `${safeMinutes}m`;

    const hours = Math.floor(safeMinutes / 60);
    const minutes = safeMinutes % 60;
    if (hours < 24) return `${hours}h ${minutes}m`;

    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h ${minutes}m`;
}

function formatDateTime(value) {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleString();
}

function formatPercentage(value) {
    const safeNumber = Number(value || 0);
    return `${safeNumber.toFixed(safeNumber % 1 === 0 ? 0 : 2)}%`;
}

function formatPauseReason(value) {
    const key = String(value || '').toUpperCase();
    return PAUSE_REASON_LABELS[key] || key.replace(/_/g, ' ') || 'Other';
}

function formatPauseSource(value) {
    const key = String(value || '').toUpperCase();
    return PAUSE_SOURCE_LABELS[key] || key.replace(/_/g, ' ') || 'Manual';
}

function toDateTimeLocalValue(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    const pad = (number) => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

document.addEventListener('DOMContentLoaded', initSLAPage);
