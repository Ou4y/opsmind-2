import UI from '/assets/js/ui.js';
import { renderAiPriorityInsight } from '/assets/js/components/aiPriorityInsight.js';

function normalizeArray(value) {
    return Array.isArray(value) ? value : [];
}

function safeText(value) {
    if (value === null || value === undefined || value === '') {
        return '--';
    }
    return UI.escapeHTML(String(value));
}

function formatDateTime(value) {
    if (!value) return '--';
    return UI.formatDateTime(value);
}

function formatCoordinates(latitude, longitude) {
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

function extractLocationFromObject(location) {
    if (!location || typeof location !== 'object') return null;

    const building = location.building ?? null;
    const room = location.room ?? null;

    if (building && room) return `${building} / ${room}`;
    if (building) return String(building);
    if (room) return String(room);

    const coords = formatCoordinates(location.latitude, location.longitude);
    return coords;
}

export function getTicketLocationDisplay(ticket) {
    if (!ticket) return 'N/A';

    if (ticket.location) {
        if (typeof ticket.location === 'string') return ticket.location;
        const locationValue = extractLocationFromObject(ticket.location);
        if (locationValue) return locationValue;
    }

    const building = ticket.building ?? null;
    const room = ticket.room ?? null;

    if (building && room) return `${building} / ${room}`;
    if (building) return String(building);
    if (room) return String(room);

    const coords = formatCoordinates(ticket.latitude, ticket.longitude);
    if (coords) return coords;

    return 'N/A';
}

function buildPersonLabel(person, fallback) {
    if (!person) return safeText(fallback || '--');
    const name = person.name || person.email || person.userId || person.id;
    const email = person.email ? ` (${UI.escapeHTML(String(person.email))})` : '';
    const level = person.level ? ` - ${UI.escapeHTML(String(person.level))}` : '';
    return `${safeText(name)}${email}${level}`;
}

function sortByTimestamp(items) {
    return [...items].sort((a, b) => {
        const left = new Date(a.timestamp || a.created_at || a.createdAt || 0).getTime();
        const right = new Date(b.timestamp || b.created_at || b.createdAt || 0).getTime();
        return left - right;
    });
}

function renderList(items, emptyText, renderItem) {
    if (!items.length) {
        return `<p class="text-muted small mb-0">${UI.escapeHTML(emptyText)}</p>`;
    }

    const rows = items.map(renderItem).join('');
    return `<ul class="list-group list-group-flush">${rows}</ul>`;
}

function renderTicketCore(ticket) {
    const assignedLabel = ticket.assignedToName || ticket.assignedToEmail || ticket.assignedTo || ticket.assigned_to || '--';
    const requesterLabel = ticket.requester || ticket.requesterName || ticket.requesterId || '--';
    const locationLabel = getTicketLocationDisplay(ticket);

    return `
        <div class="card mb-3">
            <div class="card-header bg-white">
                <h6 class="mb-0">Ticket</h6>
            </div>
            <div class="card-body">
                <div class="row g-3">
                    <div class="col-md-6">
                        <div class="text-muted small">Ticket ID</div>
                        <div class="fw-semibold">${safeText(ticket.id || ticket.ticketId)}</div>
                    </div>
                    <div class="col-md-6">
                        <div class="text-muted small">Status</div>
                        <div>${safeText(ticket.status)}</div>
                    </div>
                    <div class="col-md-6">
                        <div class="text-muted small">Priority</div>
                        <div>${safeText(ticket.priority)}</div>
                    </div>
                    <div class="col-md-6">
                        <div class="text-muted small">Assigned To</div>
                        <div>${safeText(assignedLabel)}</div>
                        <div class="text-muted small">Level: ${safeText(ticket.assignedToLevel)}</div>
                    </div>
                    <div class="col-md-6">
                        <div class="text-muted small">Requester</div>
                        <div>${safeText(requesterLabel)}</div>
                    </div>
                    <div class="col-md-6">
                        <div class="text-muted small">Location</div>
                        <div>${safeText(locationLabel)}</div>
                    </div>
                    <div class="col-md-6">
                        <div class="text-muted small">Created</div>
                        <div>${safeText(formatDateTime(ticket.createdAt || ticket.created_at))}</div>
                    </div>
                    <div class="col-md-6">
                        <div class="text-muted small">Updated</div>
                        <div>${safeText(formatDateTime(ticket.updatedAt || ticket.updated_at))}</div>
                    </div>
                    <div class="col-md-6">
                        <div class="text-muted small">Closed</div>
                        <div>${safeText(formatDateTime(ticket.closedAt || ticket.closed_at))}</div>
                    </div>
                    <div class="col-md-6">
                        <div class="text-muted small">Escalations</div>
                        <div>${safeText(ticket.escalationCount)}</div>
                    </div>
                </div>
                <div class="mt-3">
                    <div class="text-muted small">Title</div>
                    <div class="fw-semibold">${safeText(ticket.title)}</div>
                </div>
                <div class="mt-3">
                    <div class="text-muted small">Description</div>
                    <div class="text-wrap">${safeText(ticket.description || ticket.descriptionPreview || 'No description provided')}</div>
                </div>
            </div>
        </div>
    `;
}

function renderHierarchy(hierarchy) {
    const assigned = hierarchy.assignedTechnician ? buildPersonLabel(hierarchy.assignedTechnician) : '--';
    const junior = hierarchy.junior ? buildPersonLabel(hierarchy.junior) : '--';
    const senior = hierarchy.senior ? buildPersonLabel(hierarchy.senior) : '--';
    const supervisor = hierarchy.supervisor ? buildPersonLabel(hierarchy.supervisor) : '--';

    return `
        <div class="card mb-3">
            <div class="card-header bg-white">
                <h6 class="mb-0">Hierarchy</h6>
            </div>
            <div class="card-body">
                <div class="mb-2"><span class="text-muted small">Assigned:</span> ${assigned}</div>
                <div class="mb-2"><span class="text-muted small">Junior:</span> ${junior}</div>
                <div class="mb-2"><span class="text-muted small">Senior:</span> ${senior}</div>
                <div class="mb-0"><span class="text-muted small">Supervisor:</span> ${supervisor}</div>
            </div>
        </div>
    `;
}

function renderEscalationHistory(items) {
    return renderList(items, 'No escalation history available.', (item) => {
        return `
            <li class="list-group-item">
                <div class="d-flex justify-content-between">
                    <span class="fw-semibold">${safeText(item.fromLevel)} -> ${safeText(item.toLevel)}</span>
                    <small class="text-muted">${safeText(formatDateTime(item.timestamp))}</small>
                </div>
                <div class="text-muted small">Reason: ${safeText(item.reason)}</div>
                <div class="text-muted small">By: ${safeText(item.performedBy || '--')} ${item.performedByRole ? `(${safeText(item.performedByRole)})` : ''}</div>
            </li>
        `;
    });
}

function renderAssignmentHistory(items) {
    return renderList(items, 'No assignment history available.', (item) => {
        const fromAssignee = item.previousAssignee || '--';
        const toAssignee = item.newAssignee || '--';
        const fromLevel = item.previousLevel || '--';
        const toLevel = item.newLevel || '--';
        return `
            <li class="list-group-item">
                <div class="d-flex justify-content-between">
                    <span class="fw-semibold">${safeText(fromAssignee)} -> ${safeText(toAssignee)}</span>
                    <small class="text-muted">${safeText(formatDateTime(item.timestamp))}</small>
                </div>
                <div class="text-muted small">Level: ${safeText(fromLevel)} -> ${safeText(toLevel)}</div>
                <div class="text-muted small">Method: ${safeText(item.method)}</div>
                <div class="text-muted small">By: ${safeText(item.performedBy || '--')} ${item.performedByRole ? `(${safeText(item.performedByRole)})` : ''}</div>
                <div class="text-muted small">Reason: ${safeText(item.reason)}</div>
            </li>
        `;
    });
}

function renderStatusHistory(items) {
    return renderList(items, 'No status history available.', (item) => {
        return `
            <li class="list-group-item">
                <div class="d-flex justify-content-between">
                    <span class="fw-semibold">${safeText(item.oldStatus)} -> ${safeText(item.newStatus)}</span>
                    <small class="text-muted">${safeText(formatDateTime(item.timestamp))}</small>
                </div>
                <div class="text-muted small">By: ${safeText(item.performedBy || '--')} ${item.performedByRole ? `(${safeText(item.performedByRole)})` : ''}</div>
                <div class="text-muted small">Reason: ${safeText(item.reason)}</div>
            </li>
        `;
    });
}

function renderWorkflowLogs(items) {
    return renderList(items, 'No workflow logs available.', (item) => {
        return `
            <li class="list-group-item">
                <div class="d-flex justify-content-between">
                    <span class="fw-semibold">${safeText(item.action)}</span>
                    <small class="text-muted">${safeText(formatDateTime(item.timestamp || item.created_at))}</small>
                </div>
                <div class="text-muted small">By: ${safeText(item.performedBy || '--')}</div>
                <div class="text-muted small">From: ${safeText(item.fromGroup)} To: ${safeText(item.toGroup)}</div>
                <div class="text-muted small">Reason: ${safeText(item.reason)}</div>
            </li>
        `;
    });
}

function renderSlaEvents(items) {
    return renderList(items, 'No SLA events available.', (item) => {
        return `
            <li class="list-group-item">
                <div class="d-flex justify-content-between">
                    <span class="fw-semibold">${safeText(item.type)}</span>
                    <small class="text-muted">${safeText(formatDateTime(item.timestamp))}</small>
                </div>
            </li>
        `;
    });
}

function renderTimeline(items) {
    return renderList(items, 'No timeline events available.', (item) => {
        return `
            <li class="list-group-item">
                <div class="d-flex justify-content-between">
                    <span class="fw-semibold">${safeText(item.actionType)}</span>
                    <small class="text-muted">${safeText(formatDateTime(item.timestamp))}</small>
                </div>
                <div class="text-muted small">Actor: ${safeText(item.actor || '--')} ${item.actorRole ? `(${safeText(item.actorRole)})` : ''}</div>
                <div class="text-muted small">Source: ${safeText(item.source)}</div>
                <div class="text-muted small">Reason: ${safeText(item.reason)}</div>
            </li>
        `;
    });
}

function renderAvailableActions(allowedActions) {
    if (!allowedActions) {
        return '';
    }

    const actions = [];
    if (allowedActions.canStart) actions.push('Start Work');
    if (allowedActions.canResolve) actions.push('Resolve');
    if (allowedActions.canEscalate) actions.push('Escalate');
    if (allowedActions.canReassign) actions.push('Reassign');
    if (allowedActions.canViewDetails) actions.push('View Details');

    if (actions.length === 0) {
        return `
            <div class="card mb-3">
                <div class="card-header bg-white"><h6 class="mb-0">Available Actions</h6></div>
                <div class="card-body">
                    <p class="text-muted small mb-0">No actions available for your role on this ticket.</p>
                </div>
            </div>
        `;
    }

    const badges = actions
        .map((label) => `<span class="badge bg-secondary-subtle text-secondary me-2 mb-2">${UI.escapeHTML(label)}</span>`)
        .join('');

    return `
        <div class="card mb-3">
            <div class="card-header bg-white"><h6 class="mb-0">Available Actions</h6></div>
            <div class="card-body">
                ${badges}
            </div>
        </div>
    `;
}

export function buildTicketDetailsContent(details) {
    const payload = details || {};
    const ticket = payload.ticket || {};
    const currentUserRole = payload.currentUserRole || payload.viewerRole || ticket.currentUserRole || null;
    const hierarchy = payload.hierarchy || {};
    const allowedActions = payload.allowedActions || ticket.allowedActions || null;
    const escalationHistory = sortByTimestamp(normalizeArray(payload.escalationHistory));
    const assignmentHistory = sortByTimestamp(normalizeArray(payload.assignmentHistory));
    const statusHistory = sortByTimestamp(normalizeArray(payload.statusHistory));
    const workflowLogs = sortByTimestamp(normalizeArray(payload.workflowLogs));
    const slaEvents = sortByTimestamp(normalizeArray(payload.slaEvents));
    const timeline = sortByTimestamp(normalizeArray(payload.timeline));

    return `
        <div class="ticket-details">
            ${renderTicketCore(ticket)}
            ${renderAiPriorityInsight({ ticket, currentUserRole })}
            ${renderHierarchy(hierarchy)}
            ${renderAvailableActions(allowedActions)}

            <div class="card mb-3">
                <div class="card-header bg-white"><h6 class="mb-0">Escalation History</h6></div>
                <div class="card-body p-0">${renderEscalationHistory(escalationHistory)}</div>
            </div>

            <div class="card mb-3">
                <div class="card-header bg-white"><h6 class="mb-0">Assignment History</h6></div>
                <div class="card-body p-0">${renderAssignmentHistory(assignmentHistory)}</div>
            </div>

            <div class="card mb-3">
                <div class="card-header bg-white"><h6 class="mb-0">Status History</h6></div>
                <div class="card-body p-0">${renderStatusHistory(statusHistory)}</div>
            </div>

            <div class="card mb-3">
                <div class="card-header bg-white"><h6 class="mb-0">Workflow Logs</h6></div>
                <div class="card-body p-0">${renderWorkflowLogs(workflowLogs)}</div>
            </div>

            <div class="card mb-3">
                <div class="card-header bg-white"><h6 class="mb-0">SLA Events</h6></div>
                <div class="card-body p-0">${renderSlaEvents(slaEvents)}</div>
            </div>

            <div class="card mb-0">
                <div class="card-header bg-white"><h6 class="mb-0">Timeline</h6></div>
                <div class="card-body p-0">${renderTimeline(timeline)}</div>
            </div>
        </div>
    `;
}

export function renderTicketDetailsInto(container, details) {
    if (!container) return;
    container.innerHTML = buildTicketDetailsContent(details);
}

export function openTicketDetailsModal(options = {}) {
    const modalId = `ticketDetailsModal-${Date.now()}`;
    const title = options.title || 'Ticket Details';
    const modalHtml = `
        <div class="modal fade" id="${modalId}" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-dialog-scrollable modal-xl">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">${UI.escapeHTML(title)}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body"></div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modalEl = document.getElementById(modalId);
    const modal = new bootstrap.Modal(modalEl);
    const bodyEl = modalEl.querySelector('.modal-body');

    const setLoading = (message = 'Loading ticket details...') => {
        if (!bodyEl) return;
        bodyEl.innerHTML = `
            <div class="text-center py-5">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <p class="mt-3 text-muted">${UI.escapeHTML(message)}</p>
            </div>
        `;
    };

    const setContent = (details) => {
        if (!bodyEl) return;
        const mergedDetails = {
            ...(details || {}),
            currentUserRole: options.currentUserRole || details?.currentUserRole || null
        };
        bodyEl.innerHTML = buildTicketDetailsContent(mergedDetails);
    };

    const setError = (message) => {
        if (!bodyEl) return;
        bodyEl.innerHTML = `
            <div class="alert alert-danger mb-0" role="alert">
                <strong>Unable to load ticket details.</strong>
                <div class="small mt-2">${UI.escapeHTML(message || 'Please try again.')}</div>
            </div>
        `;
    };

    modalEl.addEventListener('hidden.bs.modal', () => {
        modalEl.remove();
    }, { once: true });

    modal.show();

    return { modalEl, setLoading, setContent, setError, hide: () => modal.hide() };
}

export function showTicketDetailsModal(details, options = {}) {
    const modalHandle = openTicketDetailsModal({
        title: options.title,
        currentUserRole: options.currentUserRole
    });
    modalHandle.setContent(details);
    return modalHandle;
}
