import UI from '/assets/js/ui.js';
import TicketService from '/services/ticketService.js';
import AgenticAiService from '/services/agenticAiService.js';
import AuthService from '/services/authService.js';
import {
    renderAiPriorityInsight,
    hasAiMetadata,
    isOperationalRole,
    isRequesterRole,
    getAiButtonLabel,
    normalizeRole,
    renderFinalPriorityBadge
} from '/assets/js/components/aiPriorityInsight.js';

const ticketAiCache = new Map();
let ticketEndpointDeviceStatusRequestId = 0;

const TICKET_SERVICE_PRIORITY_FIELDS = [
    'title',
    'description',
    'category',
    'priority',
    'status',
    'affected_device_id',
    'affected_device_name',
    'os_type',
    'issue_scope',
    'remote_support_consent',
    'ai_agent_eligible',
    'ai_agent_eligibility_reason',
    'affectedDeviceId',
    'affectedDeviceName',
    'osType',
    'issueScope',
    'remoteSupportConsent',
    'aiAgentEligible',
    'aiAgentEligibilityReason'
];

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

function resolveTicketId(ticket) {
    if (!ticket || typeof ticket !== 'object') return '';
    return String(ticket.id || ticket.ticketId || '').trim();
}

function normalizePriorityText(priority) {
    const normalized = String(priority || '').trim().toUpperCase();
    if (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(normalized)) return normalized;
    return 'N/A';
}

function renderAiInsightAction(ticket, currentUserRole) {
    const role = normalizeRole(currentUserRole);
    if (isRequesterRole(role) || !isOperationalRole(role)) {
        return '';
    }

    const ticketId = resolveTicketId(ticket);
    const buttonLabel = getAiButtonLabel(role);

        return `
            <div class="card mb-3 border-0 bg-light ai-status-card">
                <div class="card-body">
                    <button
                        type="button"
                        class="btn btn-sm ai-action-btn ai-action-btn-secondary"
                        data-ai-insight-toggle="true"
                        data-ticket-id="${UI.escapeHTML(ticketId)}"
                    >
                        <i class="bi bi-cpu me-1"></i>${UI.escapeHTML(buttonLabel)}
                    </button>
                    <div class="mt-3 d-none" data-ai-insight-content="true"></div>
                </div>
            </div>
        `;
}

function extractTicketFromServiceResponse(response) {
    return response?.data?.ticket || response?.data || response?.ticket || response || null;
}

function mergeHydratedTicket(baseTicket, fullTicket) {
    const workflowTicket = baseTicket && typeof baseTicket === 'object' ? baseTicket : {};
    const serviceTicket = fullTicket && typeof fullTicket === 'object' ? fullTicket : {};
    const merged = {
        ...workflowTicket,
        ...serviceTicket
    };

    // Ticket Service is the source of truth for core ticket and agentic fields.
    TICKET_SERVICE_PRIORITY_FIELDS.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(serviceTicket, field)) {
            merged[field] = serviceTicket[field];
        }
    });

    // Keep workflow display fields when they are not present in Ticket Service.
    const workflowDisplayFallbackFields = [
        'assignedToName',
        'assignedToEmail',
        'assignedToLevel',
        'assigned_to',
        'assigned_to_level',
        'assignedTechnicianName',
        'assignedTechnicianLevel',
        'supportLevel',
        'workflowStatus'
    ];

    workflowDisplayFallbackFields.forEach((field) => {
        if (
            (merged[field] === undefined || merged[field] === null || merged[field] === '') &&
            workflowTicket[field] !== undefined
        ) {
            merged[field] = workflowTicket[field];
        }
    });

    return merged;
}

async function hydrateTicketFromTicketService(ticket) {
    const baseTicket = ticket && typeof ticket === 'object' ? ticket : {};
    const ticketId = resolveTicketId(baseTicket);

    console.log('[TechnicianTicketDetails] Raw technician ticket object', baseTicket);

    if (!ticketId) {
        return baseTicket;
    }

    if (ticketAiCache.has(ticketId)) {
        const hydratedFromCache = mergeHydratedTicket(baseTicket, ticketAiCache.get(ticketId));
        console.log('[TechnicianTicketDetails] Hydrated Ticket Service ticket', hydratedFromCache);
        return hydratedFromCache;
    }

    try {
        const response = await TicketService.getTicketById(ticketId);
        const fetchedTicket = extractTicketFromServiceResponse(response);

        if (!fetchedTicket || typeof fetchedTicket !== 'object') {
            return baseTicket;
        }

        const hydratedTicket = mergeHydratedTicket(baseTicket, fetchedTicket);
        ticketAiCache.set(ticketId, hydratedTicket);

        console.log('[TechnicianTicketDetails] Hydrated Ticket Service ticket', hydratedTicket);
        return hydratedTicket;
    } catch (error) {
        console.warn('[TechnicianTicketDetails] Ticket hydration failed; falling back to workflow payload:', error);
        return baseTicket;
    }
}

async function resolveFullTicketForAi(ticket) {
    const hydratedTicket = await hydrateTicketFromTicketService(ticket);
    const ticketId = resolveTicketId(hydratedTicket);
    if (ticketId && hasAiMetadata(hydratedTicket)) {
        ticketAiCache.set(ticketId, hydratedTicket);
    }
    return hydratedTicket;
}

function bindAiInsightActions(container, detailsPayload) {
    if (!container) return;

    const role = normalizeRole(
        detailsPayload?.currentUserRole ||
        detailsPayload?.viewerRole ||
        detailsPayload?.ticket?.currentUserRole ||
        ''
    );

    const button = container.querySelector('[data-ai-insight-toggle=\"true\"]');
    const output = container.querySelector('[data-ai-insight-content=\"true\"]');

    if (!button || !output) return;
    if (isRequesterRole(role) || !isOperationalRole(role)) return;

    const defaultLabel = getAiButtonLabel(role);

    button.addEventListener('click', async () => {
        if (output.dataset.loaded === 'true') {
            output.classList.remove('d-none');
            return;
        }

        button.disabled = true;
        button.innerHTML = '<span class=\"spinner-border spinner-border-sm me-1\" role=\"status\"></span>Loading...';

        try {
            const enrichedTicket = await resolveFullTicketForAi(detailsPayload?.ticket || {});
            detailsPayload.ticket = enrichedTicket;

            output.innerHTML = renderAiPriorityInsight({
                ticket: enrichedTicket,
                currentUserRole: role
            });
            output.dataset.loaded = 'true';
            output.classList.remove('d-none');
        } catch (error) {
            console.error('[ticketDetailsModal] Failed to load AI insight details:', error);
            output.innerHTML = `
                <div class=\"alert alert-warning mb-0\" role=\"alert\">
                    AI priority details could not be loaded right now.
                </div>
            `;
            output.classList.remove('d-none');
        } finally {
            button.disabled = false;
            button.innerHTML = `<i class=\"bi bi-cpu me-1\"></i>${UI.escapeHTML(defaultLabel)}`;
        }
    });
}

function renderAgenticPlanAction(ticket, currentUserRole) {
    const role = normalizeRole(currentUserRole);
    if (isRequesterRole(role) || !isOperationalRole(role)) {
        return '';
    }

    const ticketId = resolveTicketId(ticket);

    return `
        <div class="card mb-3 border-0 bg-light ai-status-card">
            <div class="card-body">
                <button
                    type="button"
                    class="btn btn-sm ai-action-btn ai-action-btn-primary"
                    data-agentic-plan-toggle="true"
                    data-ticket-id="${UI.escapeHTML(ticketId)}"
                >
                    <i class="bi bi-wrench-adjustable-circle me-1"></i>Generate AI Fix Plan
                </button>
                <div class="mt-3 d-none" data-agentic-plan-content="true"></div>
            </div>
        </div>
    `;
}

function hasPlanInput(ticket) {
    const title = String(ticket?.title || ticket?.subject || '').trim();
    const description = String(ticket?.description || ticket?.descriptionPreview || '').trim();
    return Boolean(title && description);
}

async function resolveFullTicketForAgenticPlan(ticket) {
    return hydrateTicketFromTicketService(ticket);
}

function formatBooleanText(value) {
    return value === true ? 'Yes' : 'No';
}

function resolveCurrentActor() {
    const currentUser = AuthService.getCurrentUser?.() || AuthService.getUser?.() || {};
    const userId =
        currentUser?.id ??
        currentUser?.userId ??
        currentUser?.user_id ??
        currentUser?.workflowUserId ??
        null;
    const role =
        currentUser?.technicianLevel ??
        currentUser?.level ??
        currentUser?.role ??
        (Array.isArray(currentUser?.roles) ? currentUser.roles[0] : null) ??
        null;

    return {
        userId: userId !== null && userId !== undefined ? String(userId) : null,
        role: role ? String(role).toUpperCase() : null
    };
}

function extractPlanDeviceId(planRecord, plan) {
    const safePlanFromRecord = planRecord?.safe_plan && typeof planRecord.safe_plan === 'object'
        ? planRecord.safe_plan
        : {};
    const ticketContext = plan?.ticketContext && typeof plan.ticketContext === 'object' ? plan.ticketContext : {};
    const persistedTicketContext = safePlanFromRecord?.ticketContext && typeof safePlanFromRecord.ticketContext === 'object'
        ? safePlanFromRecord.ticketContext
        : {};

    return String(
        plan?.affectedDeviceId ||
        plan?.affected_device_id ||
        safePlanFromRecord?.affectedDeviceId ||
        safePlanFromRecord?.affected_device_id ||
        ticketContext?.affectedDeviceId ||
        ticketContext?.affected_device_id ||
        persistedTicketContext?.affectedDeviceId ||
        persistedTicketContext?.affected_device_id ||
        ''
    ).trim();
}

function hasManualReviewStep(steps) {
    const stepList = Array.isArray(steps) ? steps : [];
    return stepList.some((step) => {
        const actionKey = String(step?.actionKey || step?.action_key || '').trim().toUpperCase();
        return actionKey === 'MANUAL_REVIEW_REQUIRED';
    });
}

function normalizeAgentTaskPayload(payload) {
    const singleTask = payload?.task && typeof payload.task === 'object' ? payload.task : null;
    const taskList = Array.isArray(payload?.tasks) ? payload.tasks : [];
    const latestTask = singleTask || taskList[0] || null;

    return { latestTask, taskList };
}

function normalizePlanResponse(payload) {
    const rawPlan = payload?.rawPlan && typeof payload.rawPlan === 'object' ? payload.rawPlan : {};
    const safePlan = payload?.safePlan && typeof payload.safePlan === 'object' ? payload.safePlan : {};
    const planRecord = payload?.plan && typeof payload.plan === 'object' ? payload.plan : null;
    const persistedSafePlan = planRecord?.safe_plan && typeof planRecord.safe_plan === 'object'
        ? planRecord.safe_plan
        : {};
    const displayPlan = Object.keys(safePlan).length
        ? safePlan
        : (Object.keys(persistedSafePlan).length ? persistedSafePlan : rawPlan);

    const execution = payload?.execution && typeof payload.execution === 'object' ? payload.execution : null;
    const executions = Array.isArray(payload?.executions) ? payload.executions : [];
    const latestExecution = execution || executions[0] || null;
    const { latestTask, taskList } = normalizeAgentTaskPayload(payload);

    return { rawPlan, safePlan, planRecord, displayPlan, latestExecution, latestTask, taskList };
}

function renderAgenticPlan(planPayload) {
    const {
        rawPlan,
        displayPlan,
        planRecord,
        latestExecution,
        latestTask,
        taskList
    } = normalizePlanResponse(planPayload);
    const plan = Object.keys(displayPlan).length ? displayPlan : rawPlan;
    const planId = planRecord?.id || '--';
    const planStatus = planRecord?.status || 'PENDING_APPROVAL';
    const normalizedPlanStatus = String(planStatus || '').toUpperCase();
    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    const executionAvailable = plan?.executionAvailable === true || planRecord?.execution_available === true;
    const resolvedDeviceId = extractPlanDeviceId(planRecord, plan);
    const hasLinkedDevice = Boolean(resolvedDeviceId);
    const hasManualReview = hasManualReviewStep(steps);
    const executionBlockedReason = plan?.executionBlockedReason || planRecord?.execution_blocked_reason || '--';
    const riskLevel = plan?.riskLevel || planRecord?.risk_level || '--';
    const requiresApproval = plan?.requiresApproval === true || planRecord?.requires_approval === true;
    const showPlanActions = normalizedPlanStatus === 'PENDING_APPROVAL' && planRecord?.id;
    const showMockExecutionAction = normalizedPlanStatus === 'APPROVED' && planRecord?.id;
    const showQueueTaskAction =
        normalizedPlanStatus === 'APPROVED' &&
        executionAvailable &&
        hasLinkedDevice &&
        !hasManualReview &&
        planRecord?.id;
    const executionSteps = Array.isArray(latestExecution?.steps) ? latestExecution.steps : [];
    const queuedTaskSteps = Array.isArray(latestTask?.steps) ? latestTask.steps : [];
    const executionStepsHtml = executionSteps.length
        ? executionSteps.map((step) => `
            <li class="list-group-item">
                <div class="d-flex justify-content-between flex-wrap gap-2">
                    <span class="fw-semibold">Step ${safeText(step?.step_order ?? step?.stepOrder ?? '--')}</span>
                    <span class="badge bg-primary-subtle text-primary">${safeText(step?.action_key ?? step?.actionKey ?? '--')}</span>
                </div>
                <div class="small mt-2 text-muted">Status: ${safeText(step?.status || '--')}</div>
                <div class="small mt-2">${safeText(step?.output || '--')}</div>
            </li>
        `).join('')
        : `<li class="list-group-item text-muted small">No mock execution steps are available.</li>`;

    const taskStepsHtml = queuedTaskSteps.length
        ? queuedTaskSteps.map((step) => `
            <li class="list-group-item">
                <div class="d-flex justify-content-between flex-wrap gap-2">
                    <span class="fw-semibold">Step ${safeText(step?.step_order ?? step?.stepOrder ?? '--')}</span>
                    <span class="badge bg-secondary-subtle text-secondary">${safeText(step?.action_key ?? step?.actionKey ?? '--')}</span>
                </div>
                <div class="small mt-2 text-muted">Status: ${safeText(step?.status || '--')}</div>
                <div class="small mt-2">${safeText(step?.description || '--')}</div>
            </li>
        `).join('')
        : `<li class="list-group-item text-muted small">No agent task steps are available.</li>`;

    const stepsHtml = steps.length
        ? steps.map((step) => {
            const params = step?.params && typeof step.params === 'object' ? step.params : {};
            const softwareName = params?.softwareName ? safeText(params.softwareName) : null;
            const softwareKey = params?.softwareKey ? safeText(params.softwareKey) : null;
            const softwareDetails = softwareName || softwareKey
                ? `<div class="small mt-1 text-muted">Software: ${softwareName || softwareKey}${softwareName && softwareKey ? ` (${softwareKey})` : ''}</div>`
                : '';

            return `
            <li class="list-group-item">
                <div class="d-flex justify-content-between flex-wrap gap-2">
                    <span class="fw-semibold">Step ${safeText(step?.stepOrder ?? '--')}</span>
                    <span class="badge bg-secondary-subtle text-secondary">${safeText(step?.actionKey || '--')}</span>
                </div>
                <div class="small mt-2">${safeText(step?.description || '--')}</div>
                ${softwareDetails}
            </li>
        `;
        }).join('')
        : `<li class="list-group-item text-muted small">No remediation steps were generated.</li>`;

    return `
        <div class="card border-success-subtle ai-plan-card">
            <div class="card-header bg-white">
                <h6 class="mb-0">AI Remediation Plan</h6>
            </div>
            <div class="card-body">
                <div class="row g-3 mb-3">
                    <div class="col-md-6">
                        <div class="text-muted small">Plan ID</div>
                        <div class="fw-semibold">${safeText(planId)}</div>
                    </div>
                    <div class="col-md-3">
                        <div class="text-muted small">Plan Status</div>
                        <div class="fw-semibold">${safeText(planStatus)}</div>
                    </div>
                    <div class="col-md-3">
                        <div class="text-muted small">Summary</div>
                        <div>${safeText(plan?.summary || '--')}</div>
                    </div>
                    <div class="col-md-3">
                        <div class="text-muted small">Risk Level</div>
                        <div class="fw-semibold">${safeText(riskLevel)}</div>
                    </div>
                    <div class="col-md-3">
                        <div class="text-muted small">Requires Approval</div>
                        <div class="fw-semibold">${safeText(formatBooleanText(requiresApproval))}</div>
                    </div>
                    <div class="col-md-6">
                        <div class="text-muted small">Execution Available</div>
                        <div class="fw-semibold">${safeText(formatBooleanText(executionAvailable))}</div>
                    </div>
                    ${executionAvailable ? '' : `
                        <div class="col-md-6">
                            <div class="text-muted small">Execution Blocked Reason</div>
                            <div>${safeText(executionBlockedReason)}</div>
                        </div>
                    `}
                </div>

                <div class="alert alert-warning small mb-3" role="alert">
                    This plan is generated for technician review only. No actions are executed in this phase.
                </div>

                <div class="text-muted small mb-2">Steps</div>
                <ul class="list-group list-group-flush border rounded">
                    ${stepsHtml}
                </ul>

                ${showPlanActions ? `
                    <div class="mt-3 d-flex gap-2 flex-wrap">
                        <button
                            type="button"
                            class="btn btn-sm ai-action-btn ai-action-btn-safe"
                            data-agentic-plan-approve="true"
                            data-plan-id="${UI.escapeHTML(String(planRecord.id))}"
                        >
                            <i class="bi bi-check2-circle me-1"></i>Approve AI Plan
                        </button>
                        <button
                            type="button"
                            class="btn btn-sm ai-action-btn ai-action-btn-danger"
                            data-agentic-plan-reject="true"
                            data-plan-id="${UI.escapeHTML(String(planRecord.id))}"
                        >
                            <i class="bi bi-x-octagon me-1"></i>Reject AI Plan
                        </button>
                    </div>
                ` : ''}
                ${showMockExecutionAction ? `
                    <div class="mt-3 d-flex gap-2 flex-wrap">
                        <button
                            type="button"
                            class="btn btn-sm ai-action-btn ai-action-btn-secondary"
                            data-agentic-plan-mock-execute="true"
                            data-plan-id="${UI.escapeHTML(String(planRecord.id))}"
                        >
                            <i class="bi bi-bezier2 me-1"></i>Run Mock Execution
                        </button>
                    </div>
                ` : ''}
                ${showQueueTaskAction ? `
                    <div class="mt-3 d-flex gap-2 flex-wrap">
                        <button
                            type="button"
                            class="btn btn-sm ai-action-btn ai-action-btn-operational"
                            data-agentic-plan-queue-task="true"
                            data-plan-id="${UI.escapeHTML(String(planRecord.id))}"
                        >
                            <i class="bi bi-cpu-fill me-1"></i>Queue Agent Task
                        </button>
                    </div>
                ` : ''}
                ${hasManualReview ? `
                    <div class="alert alert-secondary small mt-3 mb-0" role="alert">
                        This plan requires manual review and cannot be queued for endpoint execution.
                    </div>
                ` : ''}
                ${latestTask ? `
                    <div class="mt-3 ai-status-card">
                        <div class="text-muted small mb-2">Agent Task Queue</div>
                        <div class="row g-3 mb-3">
                            <div class="col-md-4">
                                <div class="text-muted small">Task ID</div>
                                <div class="fw-semibold">${safeText(latestTask?.id || '--')}</div>
                            </div>
                            <div class="col-md-4">
                                <div class="text-muted small">Device ID</div>
                                <div class="fw-semibold">${safeText(latestTask?.device_id || latestTask?.deviceId || resolvedDeviceId || '--')}</div>
                            </div>
                            <div class="col-md-4">
                                <div class="text-muted small">Task Status</div>
                                <div class="fw-semibold">${safeText(latestTask?.status || '--')}</div>
                            </div>
                        </div>
                        <ul class="list-group list-group-flush border rounded">
                            ${taskStepsHtml}
                        </ul>
                        <div class="alert alert-warning small mt-3 mb-0" role="alert">
                            Task queued for future Endpoint Agent. No real execution has been performed.
                        </div>
                    </div>
                ` : ''}
                ${taskList.length > 1 ? `
                    <div class="small text-muted mt-2">
                        Additional queued tasks for this plan: ${safeText(taskList.length - 1)}
                    </div>
                ` : ''}

                ${latestExecution ? `
                    <div class="mt-3 ai-execution-card">
                        <div class="text-muted small mb-2">Mock Execution</div>
                        <div class="row g-3 mb-3">
                            <div class="col-md-6">
                                <div class="text-muted small">Execution ID</div>
                                <div class="fw-semibold">${safeText(latestExecution?.id || '--')}</div>
                            </div>
                            <div class="col-md-3">
                                <div class="text-muted small">Execution Status</div>
                                <div class="fw-semibold">${safeText(latestExecution?.status || '--')}</div>
                            </div>
                            <div class="col-md-3">
                                <div class="text-muted small">Completed At</div>
                                <div class="fw-semibold">${safeText(formatDateTime(latestExecution?.completed_at || latestExecution?.completedAt))}</div>
                            </div>
                        </div>
                        <ul class="list-group list-group-flush border rounded">
                            ${executionStepsHtml}
                        </ul>
                        <div class="alert alert-info small mt-3 mb-0" role="alert">
                            Mock execution only. No real device actions were performed.
                        </div>
                    </div>
                ` : ''}
                <div class="mt-2" data-agentic-plan-action-message="true"></div>
            </div>
        </div>
    `;
}

function renderAgenticPlanError(message) {
    return `
        <div class="alert alert-danger mb-0" role="alert">
            ${UI.escapeHTML(message)}
        </div>
    `;
}

function resolveAgenticPlanErrorMessage(error) {
    if (error?.code === 'AI_MODEL_UNAVAILABLE') {
        return 'AI model is unavailable. Please make sure Ollama and gemma3:4b are running.';
    }

    if (error?.code === 'AGENTIC_AI_SERVICE_UNAVAILABLE') {
        return 'Agentic AI Service is unavailable. Please make sure the service is running.';
    }

    if (error?.code === 'VALIDATION_ERROR') {
        return error.message || 'Ticket title and description are required to generate an AI fix plan.';
    }

    if (error?.code === 'INVALID_PLAN_STATUS_TRANSITION') {
        return error.message || 'This plan cannot be changed from its current status.';
    }

    if (error?.code === 'PLAN_NOT_FOUND') {
        return error.message || 'The selected remediation plan no longer exists.';
    }

    if (error?.code === 'PLAN_NOT_APPROVED' || error?.code === 'EXECUTION_CONFLICT') {
        return error.message || 'This plan cannot be mock-executed from its current status.';
    }

    if (
        error?.code === 'TASK_QUEUE_CONFLICT' ||
        error?.code === 'TASK_STATUS_CONFLICT' ||
        error?.code === 'PLAN_REQUIRES_MANUAL_REVIEW'
    ) {
        return error.message || 'This plan cannot be queued for endpoint task execution right now.';
    }

    if (error?.code === 'TASK_NOT_FOUND') {
        return error.message || 'The selected agent task was not found.';
    }

    return error?.message || 'Unable to generate AI fix plan right now.';
}

function bindAgenticPlanDecisionHandlers(output) {
    if (!output) return;

    const approveButton = output.querySelector('[data-agentic-plan-approve=\"true\"]');
    const rejectButton = output.querySelector('[data-agentic-plan-reject=\"true\"]');
    const mockExecuteButton = output.querySelector('[data-agentic-plan-mock-execute=\"true\"]');
    const queueTaskButton = output.querySelector('[data-agentic-plan-queue-task=\"true\"]');
    const messageContainer = output.querySelector('[data-agentic-plan-action-message=\"true\"]');
    const planId =
        approveButton?.dataset?.planId ||
        rejectButton?.dataset?.planId ||
        mockExecuteButton?.dataset?.planId ||
        queueTaskButton?.dataset?.planId ||
        null;

    if (!planId) return;

    const setButtonsState = (isLoading, loadingLabel) => {
        if (approveButton) {
            approveButton.disabled = isLoading;
            approveButton.innerHTML = isLoading && loadingLabel === 'approve'
                ? '<span class=\"spinner-border spinner-border-sm me-1\" role=\"status\"></span>Approving...'
                : '<i class=\"bi bi-check2-circle me-1\"></i>Approve AI Plan';
        }

        if (rejectButton) {
            rejectButton.disabled = isLoading;
            rejectButton.innerHTML = isLoading && loadingLabel === 'reject'
                ? '<span class=\"spinner-border spinner-border-sm me-1\" role=\"status\"></span>Rejecting...'
                : '<i class=\"bi bi-x-octagon me-1\"></i>Reject AI Plan';
        }

        if (mockExecuteButton) {
            mockExecuteButton.disabled = isLoading;
            mockExecuteButton.innerHTML = isLoading && loadingLabel === 'mock'
                ? '<span class=\"spinner-border spinner-border-sm me-1\" role=\"status\"></span>Running mock execution...'
                : '<i class=\"bi bi-bezier2 me-1\"></i>Run Mock Execution';
        }

        if (queueTaskButton) {
            queueTaskButton.disabled = isLoading;
            queueTaskButton.innerHTML = isLoading && loadingLabel === 'queue'
                ? '<span class=\"spinner-border spinner-border-sm me-1\" role=\"status\"></span>Queueing task...'
                : '<i class=\"bi bi-cpu-fill me-1\"></i>Queue Agent Task';
        }
    };

    if (approveButton) {
        approveButton.addEventListener('click', async () => {
            setButtonsState(true, 'approve');
            try {
                const responsePayload = await AgenticAiService.approveRemediationPlan(planId, resolveCurrentActor());
                output.innerHTML = renderAgenticPlan(responsePayload);
                bindAgenticPlanDecisionHandlers(output);
                UI.success(responsePayload?.message || 'Plan approved. Execution is not implemented yet.');
            } catch (error) {
                if (messageContainer) {
                    messageContainer.innerHTML = `
                        <div class=\"alert alert-danger py-2 px-3 mb-0\" role=\"alert\">
                            ${UI.escapeHTML(resolveAgenticPlanErrorMessage(error))}
                        </div>
                    `;
                }
            } finally {
                setButtonsState(false, '');
            }
        });
    }

    if (rejectButton) {
        rejectButton.addEventListener('click', async () => {
            const reasonInput = window.prompt('Optional rejection reason:', '');
            if (reasonInput === null) {
                return;
            }

            setButtonsState(true, 'reject');
            try {
                const responsePayload = await AgenticAiService.rejectRemediationPlan(
                    planId,
                    resolveCurrentActor(),
                    reasonInput
                );
                output.innerHTML = renderAgenticPlan(responsePayload);
                bindAgenticPlanDecisionHandlers(output);
                UI.success(responsePayload?.message || 'Plan rejected. Continue with the normal manual workflow.');
            } catch (error) {
                if (messageContainer) {
                    messageContainer.innerHTML = `
                        <div class=\"alert alert-danger py-2 px-3 mb-0\" role=\"alert\">
                            ${UI.escapeHTML(resolveAgenticPlanErrorMessage(error))}
                        </div>
                    `;
                }
            } finally {
                setButtonsState(false, '');
            }
        });
    }

    if (mockExecuteButton) {
        mockExecuteButton.addEventListener('click', async () => {
            setButtonsState(true, 'mock');
            try {
                const executionPayload = await AgenticAiService.startMockExecution(planId, resolveCurrentActor());
                const planPayload = await AgenticAiService.getRemediationPlanById(planId);
                const mergedPayload = {
                    ...planPayload,
                    execution: executionPayload?.execution || null
                };

                output.innerHTML = renderAgenticPlan(mergedPayload);
                bindAgenticPlanDecisionHandlers(output);
                UI.success(executionPayload?.message || 'Mock execution completed. No real machine actions were performed.');
            } catch (error) {
                if (messageContainer) {
                    messageContainer.innerHTML = `
                        <div class=\"alert alert-danger py-2 px-3 mb-0\" role=\"alert\">
                            ${UI.escapeHTML(resolveAgenticPlanErrorMessage(error))}
                        </div>
                    `;
                }
            } finally {
                setButtonsState(false, '');
            }
        });
    }

    if (queueTaskButton) {
        queueTaskButton.addEventListener('click', async () => {
            setButtonsState(true, 'queue');
            try {
                const queuePayload = await AgenticAiService.queueAgentTaskFromPlan(planId, resolveCurrentActor());
                const [planPayload, tasksPayload] = await Promise.all([
                    AgenticAiService.getRemediationPlanById(planId),
                    AgenticAiService.listAgentTasksByPlan(planId)
                ]);

                const mergedPayload = {
                    ...planPayload,
                    task: queuePayload?.task || null,
                    tasks: Array.isArray(tasksPayload?.tasks) ? tasksPayload.tasks : []
                };

                output.innerHTML = renderAgenticPlan(mergedPayload);
                bindAgenticPlanDecisionHandlers(output);
                UI.success(queuePayload?.message || 'Task queued for future Endpoint Agent. No real execution has been performed.');
            } catch (error) {
                if (messageContainer) {
                    messageContainer.innerHTML = `
                        <div class=\"alert alert-danger py-2 px-3 mb-0\" role=\"alert\">
                            ${UI.escapeHTML(resolveAgenticPlanErrorMessage(error))}
                        </div>
                    `;
                }
            } finally {
                setButtonsState(false, '');
            }
        });
    }
}

function bindAgenticPlanActions(container, detailsPayload) {
    if (!container) return;

    const role = normalizeRole(
        detailsPayload?.currentUserRole ||
        detailsPayload?.viewerRole ||
        detailsPayload?.ticket?.currentUserRole ||
        ''
    );

    const button = container.querySelector('[data-agentic-plan-toggle=\"true\"]');
    const output = container.querySelector('[data-agentic-plan-content=\"true\"]');

    if (!button || !output) return;
    if (isRequesterRole(role) || !isOperationalRole(role)) return;

    button.addEventListener('click', async () => {
        if (output.dataset.loaded === 'true') {
            output.classList.remove('d-none');
            return;
        }

        button.disabled = true;
        button.innerHTML = '<span class=\"spinner-border spinner-border-sm me-1\" role=\"status\"></span>Generating AI fix plan...';

        try {
            const enrichedTicket = await resolveFullTicketForAgenticPlan(detailsPayload?.ticket || {});
            detailsPayload.ticket = enrichedTicket;

            if (!hasPlanInput(enrichedTicket)) {
                const validationError = new Error('Ticket title and description are required to generate an AI fix plan.');
                validationError.code = 'VALIDATION_ERROR';
                throw validationError;
            }

            const planPayload = await AgenticAiService.generateRemediationPlan(enrichedTicket, resolveCurrentActor());
            output.innerHTML = renderAgenticPlan(planPayload);
            bindAgenticPlanDecisionHandlers(output);
            output.dataset.loaded = 'true';
            output.classList.remove('d-none');
        } catch (error) {
            console.error('[ticketDetailsModal] Failed to generate AI remediation plan:', error);
            output.innerHTML = renderAgenticPlanError(resolveAgenticPlanErrorMessage(error));
            output.classList.remove('d-none');
        } finally {
            button.disabled = false;
            button.innerHTML = '<i class=\"bi bi-wrench-adjustable-circle me-1\"></i>Generate AI Fix Plan';
        }
    });
}

function resolveEndpointContextFromTicket(ticket) {
    const affectedDeviceId = String(ticket?.affected_device_id || ticket?.affectedDeviceId || '').trim();
    const affectedDeviceName = String(ticket?.affected_device_name || ticket?.affectedDeviceName || '').trim();
    const osType = String(ticket?.os_type || ticket?.osType || 'UNKNOWN').toUpperCase();
    const issueScope = String(ticket?.issue_scope || ticket?.issueScope || 'UNKNOWN').toUpperCase();
    const remoteSupportConsent = ticket?.remote_support_consent === true || ticket?.remoteSupportConsent === true;
    const aiAgentEligible = ticket?.ai_agent_eligible === true || ticket?.aiAgentEligible === true;
    const aiAgentEligibilityReason = String(
        ticket?.ai_agent_eligibility_reason || ticket?.aiAgentEligibilityReason || ''
    ).trim();

    return {
        affectedDeviceId,
        affectedDeviceName,
        osType,
        issueScope,
        remoteSupportConsent,
        aiAgentEligible,
        aiAgentEligibilityReason
    };
}

async function loadTicketEndpointDeviceLiveStatus(container, ticket) {
    if (!container) return;

    const { affectedDeviceId } = resolveEndpointContextFromTicket(ticket || {});
    if (!affectedDeviceId) return;

    const statusEl = container.querySelector('[data-ticket-endpoint-agent-status="true"]');
    const versionEl = container.querySelector('[data-ticket-endpoint-agent-version="true"]');
    const lastSeenEl = container.querySelector('[data-ticket-endpoint-last-seen="true"]');
    const enabledEl = container.querySelector('[data-ticket-endpoint-enabled="true"]');

    if (!statusEl || !versionEl || !lastSeenEl || !enabledEl) return;

    const requestId = ++ticketEndpointDeviceStatusRequestId;
    statusEl.textContent = 'Loading...';
    versionEl.textContent = '--';
    lastSeenEl.textContent = '--';
    enabledEl.textContent = '--';

    try {
        const response = await AgenticAiService.getEndpointDeviceById(affectedDeviceId);
        if (requestId !== ticketEndpointDeviceStatusRequestId) {
            return;
        }

        const device = response?.device || response || {};
        const status = String(device.agent_status || device.agentStatus || '--').trim() || '--';
        const version = String(device.agent_version || device.agentVersion || '--').trim() || '--';
        const lastSeen = device.last_seen_at || device.lastSeenAt || null;
        const enabled = device.is_agent_enabled === true || device.isAgentEnabled === true;

        statusEl.textContent = status;
        versionEl.textContent = version;
        lastSeenEl.textContent = lastSeen ? formatDateTime(lastSeen) : '--';
        enabledEl.textContent = enabled ? 'Yes' : 'No';
    } catch (_error) {
        if (requestId !== ticketEndpointDeviceStatusRequestId) {
            return;
        }

        statusEl.textContent = 'Unavailable';
        versionEl.textContent = '--';
        lastSeenEl.textContent = '--';
        enabledEl.textContent = '--';
    }
}

function renderTicketCore(ticket, currentUserRole) {
    const assignedLabel = ticket.assignedToName || ticket.assignedToEmail || ticket.assignedTo || ticket.assigned_to || '--';
    const requesterLabel = ticket.requester || ticket.requesterName || ticket.requesterId || '--';
    const locationLabel = getTicketLocationDisplay(ticket);
    const normalizedPriority = normalizePriorityText(ticket.priority);
    const priorityBadge = renderFinalPriorityBadge(normalizedPriority);
    const normalizedRole = normalizeRole(currentUserRole || '');
    const showDetailedAgenticContext = isOperationalRole(normalizedRole) && !isRequesterRole(normalizedRole);

    const {
        affectedDeviceId,
        affectedDeviceName,
        osType,
        issueScope,
        remoteSupportConsent,
        aiAgentEligible,
        aiAgentEligibilityReason
    } = resolveEndpointContextFromTicket(ticket);
    const endpointSummary = affectedDeviceId
        ? 'Registered endpoint device linked to this ticket.'
        : 'No registered endpoint device linked to this ticket.';

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
                            <div class="d-flex align-items-center gap-2">
                                ${priorityBadge}
                                <span class="fw-semibold">${safeText(normalizedPriority)}</span>
                            </div>
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
                    <div class="mt-3 border rounded p-3 bg-light-subtle ai-status-card">
                        <div class="text-muted small fw-semibold mb-2">Endpoint Device Context</div>
                        <div class="small text-muted mb-2">${safeText(endpointSummary)}</div>
                        <div class="row g-2">
                            <div class="col-12 col-md-6">
                                <div class="text-muted small">Affected Device Name</div>
                                <div>${safeText(affectedDeviceName || '--')}</div>
                            </div>
                            <div class="col-12 col-md-6">
                                <div class="text-muted small">Affected Device ID</div>
                                <div>${safeText(affectedDeviceId || '--')}</div>
                            </div>
                            <div class="col-6 col-md-4">
                                <div class="text-muted small">OS Type</div>
                                <div>${safeText(osType || 'UNKNOWN')}</div>
                            </div>
                            <div class="col-6 col-md-4">
                                <div class="text-muted small">Issue Scope</div>
                                <div>${safeText(issueScope || 'UNKNOWN')}</div>
                            </div>
                            <div class="col-12 col-md-4">
                                <div class="text-muted small">Remote Support Consent</div>
                                <div>${safeText(formatBooleanText(remoteSupportConsent))}</div>
                            </div>
                            ${showDetailedAgenticContext ? `
                                <div class="col-6">
                                    <div class="text-muted small">AI Agent Eligible</div>
                                    <div>${safeText(formatBooleanText(aiAgentEligible))}</div>
                                </div>
                                <div class="col-6">
                                    <div class="text-muted small">AI Agent Eligibility Reason</div>
                                    <div>${safeText(aiAgentEligibilityReason || '--')}</div>
                                </div>
                            ` : ''}
                            ${showDetailedAgenticContext && affectedDeviceId ? `
                                <div class="col-12 mt-2">
                                    <div class="border rounded p-2 bg-white">
                                        <div class="text-muted small fw-semibold mb-2">Live Endpoint Registry Status</div>
                                        <div class="row g-2">
                                            <div class="col-6 col-md-3">
                                                <div class="text-muted small">Agent Status</div>
                                                <div data-ticket-endpoint-agent-status="true">Loading...</div>
                                            </div>
                                            <div class="col-6 col-md-3">
                                                <div class="text-muted small">Agent Version</div>
                                                <div data-ticket-endpoint-agent-version="true">--</div>
                                            </div>
                                            <div class="col-6 col-md-3">
                                                <div class="text-muted small">Last Seen</div>
                                                <div data-ticket-endpoint-last-seen="true">--</div>
                                            </div>
                                            <div class="col-6 col-md-3">
                                                <div class="text-muted small">Is Agent Enabled</div>
                                                <div data-ticket-endpoint-enabled="true">--</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ` : ''}
                        </div>
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

async function hydrateDetailsPayload(detailsPayload) {
    const payload = detailsPayload && typeof detailsPayload === 'object' ? detailsPayload : {};
    const sourceTicket = payload?.ticket && typeof payload.ticket === 'object'
        ? payload.ticket
        : payload;

    const hydratedTicket = await hydrateTicketFromTicketService(sourceTicket);

    return {
        ...payload,
        ticket: hydratedTicket
    };
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
            ${renderTicketCore(ticket, currentUserRole)}
            ${renderAiInsightAction(ticket, currentUserRole)}
            ${renderAgenticPlanAction(ticket, currentUserRole)}
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

export async function renderTicketDetailsInto(container, details) {
    if (!container) return;
    const detailsPayload = await hydrateDetailsPayload(details || {});
    container.innerHTML = buildTicketDetailsContent(detailsPayload);
    bindAiInsightActions(container, detailsPayload);
    bindAgenticPlanActions(container, detailsPayload);
    await loadTicketEndpointDeviceLiveStatus(container, detailsPayload.ticket);
    return detailsPayload;
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
        setLoading('Loading ticket details...');
        renderTicketDetailsInto(bodyEl, mergedDetails).catch((error) => {
            console.error('[ticketDetailsModal] Failed to render hydrated ticket details:', error);
            setError(error?.message || 'Failed to render ticket details');
        });
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
