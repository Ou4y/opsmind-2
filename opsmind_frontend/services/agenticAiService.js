import AuthService from '/services/authService.js';
import { AGENTIC_AI_API_BASE_URL } from './apiConfig.js';

const AGENTIC_AI_BASE_URL = AGENTIC_AI_API_BASE_URL;

function createServiceError(message, code, status = null, details = null) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    if (details !== null && details !== undefined) {
        error.details = details;
    }
    return error;
}

function hasValue(value) {
    return value !== undefined && value !== null && value !== '';
}

function copyFieldIfPresent(target, source, key) {
    if (hasValue(source?.[key])) {
        target[key] = source[key];
    }
}

function toOptionalString(value) {
    if (!hasValue(value)) {
        return null;
    }

    const text = String(value).trim();
    return text || null;
}

function buildPlannerPayload(ticket) {
    const source = ticket && typeof ticket === 'object' ? ticket : {};
    const payload = {};

    copyFieldIfPresent(payload, source, 'id');

    if (hasValue(source.title)) payload.title = source.title;
    else if (hasValue(source.subject)) payload.title = source.subject;

    if (hasValue(source.description)) payload.description = source.description;
    else if (hasValue(source.descriptionPreview)) payload.description = source.descriptionPreview;

    copyFieldIfPresent(payload, source, 'category');
    copyFieldIfPresent(payload, source, 'priority');

    copyFieldIfPresent(payload, source, 'os_type');
    copyFieldIfPresent(payload, source, 'osType');

    copyFieldIfPresent(payload, source, 'issue_scope');
    copyFieldIfPresent(payload, source, 'issueScope');

    copyFieldIfPresent(payload, source, 'affected_device_id');
    copyFieldIfPresent(payload, source, 'affectedDeviceId');

    copyFieldIfPresent(payload, source, 'affected_device_name');
    copyFieldIfPresent(payload, source, 'affectedDeviceName');

    copyFieldIfPresent(payload, source, 'remote_support_consent');
    copyFieldIfPresent(payload, source, 'remoteSupportConsent');

    copyFieldIfPresent(payload, source, 'ai_agent_eligible');
    copyFieldIfPresent(payload, source, 'aiAgentEligible');

    copyFieldIfPresent(payload, source, 'ai_agent_eligibility_reason');
    copyFieldIfPresent(payload, source, 'aiAgentEligibilityReason');

    return payload;
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
        userId: toOptionalString(userId),
        role: toOptionalString(role ? String(role).toUpperCase() : null)
    };
}

function resolveActor(actor) {
    const source = actor && typeof actor === 'object' ? actor : {};
    const fallback = resolveCurrentActor();

    const resolved = {
        userId: toOptionalString(source.userId) || fallback.userId,
        role: toOptionalString(source.role ? String(source.role).toUpperCase() : null) || fallback.role
    };

    if (!resolved.userId && !resolved.role) {
        return null;
    }

    return resolved;
}

function buildHeaders() {
    return {
        'Content-Type': 'application/json',
        ...AuthService.getAuthHeaders()
    };
}

function buildJwtOnlyHeaders() {
    return {
        'Content-Type': 'application/json',
        ...AuthService.getAuthHeaders()
    };
}

async function parseJsonSafely(response) {
    try {
        return await response.json();
    } catch (_error) {
        return {};
    }
}

function mapHttpError(response, payload, defaultMessage) {
    const status = Number(response?.status || 0);
    const backendMessage = payload?.message || payload?.error || null;
    const backendCode = payload?.code || null;

    if (status === 503 && backendCode === 'OLLAMA_UNAVAILABLE') {
        return createServiceError(
            'AI model is unavailable. Please make sure Ollama and gemma3:4b are running.',
            'AI_MODEL_UNAVAILABLE',
            status,
            payload
        );
    }

    if (status === 503) {
        return createServiceError(
            'Agentic AI Service is unavailable. Please make sure the service is running.',
            'AGENTIC_AI_SERVICE_UNAVAILABLE',
            status,
            payload
        );
    }

    if (status === 404) {
        if (backendCode === 'TASK_NOT_FOUND') {
            return createServiceError(
                backendMessage || 'The requested agent task was not found.',
                backendCode,
                status,
                payload
            );
        }

        return createServiceError(
            backendMessage || 'The requested remediation plan was not found.',
            backendCode || 'PLAN_NOT_FOUND',
            status,
            payload
        );
    }

    if (status === 409) {
        if (
            backendCode === 'TASK_QUEUE_CONFLICT' ||
            backendCode === 'TASK_STATUS_CONFLICT' ||
            backendCode === 'PLAN_REQUIRES_MANUAL_REVIEW'
        ) {
            return createServiceError(
                backendMessage || 'This agent task operation cannot be performed right now.',
                backendCode,
                status,
                payload
            );
        }

        if (backendCode === 'PLAN_NOT_APPROVED' || backendCode === 'EXECUTION_CONFLICT') {
            return createServiceError(
                backendMessage || 'This plan cannot be mock-executed from its current status.',
                backendCode,
                status,
                payload
            );
        }

        return createServiceError(
            backendMessage || 'This plan cannot be updated from its current status.',
            backendCode || 'INVALID_PLAN_STATUS_TRANSITION',
            status,
            payload
        );
    }

    if (status === 400 && backendCode === 'VALIDATION_ERROR') {
        const message = backendMessage || 'Ticket title and description are required to generate an AI fix plan.';
        return createServiceError(message, 'VALIDATION_ERROR', status, payload);
    }

    if (status === 403 && backendCode === 'DEVICE_MISMATCH') {
        return createServiceError(
            backendMessage || 'This task is assigned to a different endpoint device.',
            backendCode,
            status,
            payload
        );
    }

    return createServiceError(
        backendMessage || defaultMessage || `Agentic AI request failed (HTTP ${status || 'unknown'}).`,
        backendCode || 'AGENTIC_AI_REQUEST_FAILED',
        status,
        payload
    );
}

async function requestJson(path, options = {}, defaultErrorMessage = null) {
    try {
        const response = await fetch(`${AGENTIC_AI_BASE_URL}${path}`, options);
        const responsePayload = await parseJsonSafely(response);

        if (!response.ok || responsePayload?.success === false) {
            throw mapHttpError(response, responsePayload, defaultErrorMessage);
        }

        return responsePayload;
    } catch (error) {
        if (error?.code) {
            throw error;
        }

        throw createServiceError(
            'Agentic AI Service is unavailable. Please make sure the service is running.',
            'AGENTIC_AI_SERVICE_UNAVAILABLE'
        );
    }
}

export async function generateRemediationPlan(ticket, generatedBy = null) {
    const payload = buildPlannerPayload(ticket);
    void generatedBy;

    return requestJson(
        '/api/agentic-ai/remediation-plan',
        {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify({
                ticket: payload
            })
        },
        'Failed to generate AI remediation plan.'
    );
}

export async function approveRemediationPlan(planId, actor = null) {
    const normalizedPlanId = toOptionalString(planId);
    if (!normalizedPlanId) {
        throw createServiceError('Plan id is required.', 'VALIDATION_ERROR', 400);
    }

    void actor;

    return requestJson(
        `/api/agentic-ai/remediation-plans/${encodeURIComponent(normalizedPlanId)}/approve`,
        {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify({})
        },
        'Failed to approve remediation plan.'
    );
}

export async function rejectRemediationPlan(planId, actor = null, reason = null) {
    const normalizedPlanId = toOptionalString(planId);
    if (!normalizedPlanId) {
        throw createServiceError('Plan id is required.', 'VALIDATION_ERROR', 400);
    }

    void actor;

    return requestJson(
        `/api/agentic-ai/remediation-plans/${encodeURIComponent(normalizedPlanId)}/reject`,
        {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify({
                reason: toOptionalString(reason)
            })
        },
        'Failed to reject remediation plan.'
    );
}

export async function getRemediationPlanById(planId) {
    const normalizedPlanId = toOptionalString(planId);
    if (!normalizedPlanId) {
        throw createServiceError('Plan id is required.', 'VALIDATION_ERROR', 400);
    }

    return requestJson(
        `/api/agentic-ai/remediation-plans/${encodeURIComponent(normalizedPlanId)}`,
        {
            method: 'GET',
            headers: buildHeaders()
        },
        'Failed to fetch remediation plan.'
    );
}

export async function listRemediationPlansByTicket(ticketId) {
    const normalizedTicketId = toOptionalString(ticketId);
    if (!normalizedTicketId) {
        throw createServiceError('Ticket id is required.', 'VALIDATION_ERROR', 400);
    }

    return requestJson(
        `/api/agentic-ai/tickets/${encodeURIComponent(normalizedTicketId)}/remediation-plans`,
        {
            method: 'GET',
            headers: buildHeaders()
        },
        'Failed to fetch remediation plans for ticket.'
    );
}

export async function startMockExecution(planId, actor = null) {
    const normalizedPlanId = toOptionalString(planId);
    if (!normalizedPlanId) {
        throw createServiceError('Plan id is required.', 'VALIDATION_ERROR', 400);
    }

    void actor;

    return requestJson(
        `/api/agentic-ai/remediation-plans/${encodeURIComponent(normalizedPlanId)}/mock-execute`,
        {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify({})
        },
        'Failed to run mock execution.'
    );
}

export async function getExecutionById(executionId) {
    const normalizedExecutionId = toOptionalString(executionId);
    if (!normalizedExecutionId) {
        throw createServiceError('Execution id is required.', 'VALIDATION_ERROR', 400);
    }

    return requestJson(
        `/api/agentic-ai/executions/${encodeURIComponent(normalizedExecutionId)}`,
        {
            method: 'GET',
            headers: buildHeaders()
        },
        'Failed to fetch execution.'
    );
}

export async function listExecutionsByPlan(planId) {
    const normalizedPlanId = toOptionalString(planId);
    if (!normalizedPlanId) {
        throw createServiceError('Plan id is required.', 'VALIDATION_ERROR', 400);
    }

    return requestJson(
        `/api/agentic-ai/remediation-plans/${encodeURIComponent(normalizedPlanId)}/executions`,
        {
            method: 'GET',
            headers: buildHeaders()
        },
        'Failed to fetch executions for plan.'
    );
}

export async function listExecutionsByTicket(ticketId) {
    const normalizedTicketId = toOptionalString(ticketId);
    if (!normalizedTicketId) {
        throw createServiceError('Ticket id is required.', 'VALIDATION_ERROR', 400);
    }

    return requestJson(
        `/api/agentic-ai/tickets/${encodeURIComponent(normalizedTicketId)}/executions`,
        {
            method: 'GET',
            headers: buildHeaders()
        },
        'Failed to fetch executions for ticket.'
    );
}

export async function queueAgentTaskFromPlan(planId, actor = null) {
    const normalizedPlanId = toOptionalString(planId);
    if (!normalizedPlanId) {
        throw createServiceError('Plan id is required.', 'VALIDATION_ERROR', 400);
    }

    void actor;

    return requestJson(
        `/api/agentic-ai/remediation-plans/${encodeURIComponent(normalizedPlanId)}/queue-task`,
        {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify({})
        },
        'Failed to queue endpoint agent task.'
    );
}

export async function getAgentTaskById(taskId) {
    const normalizedTaskId = toOptionalString(taskId);
    if (!normalizedTaskId) {
        throw createServiceError('Task id is required.', 'VALIDATION_ERROR', 400);
    }

    return requestJson(
        `/api/agentic-ai/agent-tasks/${encodeURIComponent(normalizedTaskId)}`,
        {
            method: 'GET',
            headers: buildHeaders()
        },
        'Failed to fetch agent task.'
    );
}

export async function listAgentTasksByPlan(planId) {
    const normalizedPlanId = toOptionalString(planId);
    if (!normalizedPlanId) {
        throw createServiceError('Plan id is required.', 'VALIDATION_ERROR', 400);
    }

    return requestJson(
        `/api/agentic-ai/remediation-plans/${encodeURIComponent(normalizedPlanId)}/agent-tasks`,
        {
            method: 'GET',
            headers: buildHeaders()
        },
        'Failed to fetch agent tasks for plan.'
    );
}

export async function listAgentTasksByTicket(ticketId) {
    const normalizedTicketId = toOptionalString(ticketId);
    if (!normalizedTicketId) {
        throw createServiceError('Ticket id is required.', 'VALIDATION_ERROR', 400);
    }

    return requestJson(
        `/api/agentic-ai/tickets/${encodeURIComponent(normalizedTicketId)}/agent-tasks`,
        {
            method: 'GET',
            headers: buildHeaders()
        },
        'Failed to fetch agent tasks for ticket.'
    );
}

export async function listAgentTasksByDevice(deviceId) {
    const normalizedDeviceId = toOptionalString(deviceId);
    if (!normalizedDeviceId) {
        throw createServiceError('Device id is required.', 'VALIDATION_ERROR', 400);
    }

    return requestJson(
        `/api/agentic-ai/endpoint-devices/${encodeURIComponent(normalizedDeviceId)}/agent-tasks`,
        {
            method: 'GET',
            headers: buildHeaders()
        },
        'Failed to fetch agent tasks for endpoint device.'
    );
}

export async function listMyEndpointDevices() {
    const payload = await requestJson(
        '/api/agentic-ai/users/me/endpoint-devices',
        {
            method: 'GET',
            headers: buildJwtOnlyHeaders()
        },
        'Failed to fetch your registered endpoint devices.'
    );

    return Array.isArray(payload?.devices) ? payload.devices : [];
}

export async function registerEndpointDevice({ deviceName, osType, agentVersion } = {}) {
    const normalizedDeviceName = toOptionalString(deviceName);
    if (!normalizedDeviceName) {
        throw createServiceError('deviceName is required.', 'VALIDATION_ERROR', 400);
    }

    return requestJson(
        '/api/agentic-ai/endpoint-devices/register',
        {
            method: 'POST',
            headers: buildJwtOnlyHeaders(),
            body: JSON.stringify({
                deviceName: normalizedDeviceName,
                osType: toOptionalString(osType) || 'UNKNOWN',
                agentVersion: toOptionalString(agentVersion)
            })
        },
        'Failed to register endpoint device.'
    );
}

export async function listAllEndpointDevices(filters = {}) {
    const payload = filters && typeof filters === 'object' ? filters : {};
    const params = new URLSearchParams();

    if (toOptionalString(payload.status)) {
        params.set('status', String(payload.status).trim().toUpperCase());
    }

    if (toOptionalString(payload.osType)) {
        params.set('osType', String(payload.osType).trim().toUpperCase());
    }

    if (toOptionalString(payload.userId)) {
        params.set('userId', String(payload.userId).trim());
    }

    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await requestJson(
        `/api/agentic-ai/endpoint-devices${query}`,
        {
            method: 'GET',
            headers: buildJwtOnlyHeaders()
        },
        'Failed to fetch registered endpoint devices.'
    );

    return Array.isArray(response?.devices) ? response.devices : [];
}

export async function getEndpointDeviceById(deviceId) {
    const normalizedDeviceId = toOptionalString(deviceId);
    if (!normalizedDeviceId) {
        throw createServiceError('deviceId is required.', 'VALIDATION_ERROR', 400);
    }

    return requestJson(
        `/api/agentic-ai/endpoint-devices/${encodeURIComponent(normalizedDeviceId)}`,
        {
            method: 'GET',
            headers: buildJwtOnlyHeaders()
        },
        'Failed to fetch endpoint device.'
    );
}

export async function enableEndpointDevice(deviceId) {
    const normalizedDeviceId = toOptionalString(deviceId);
    if (!normalizedDeviceId) {
        throw createServiceError('deviceId is required.', 'VALIDATION_ERROR', 400);
    }

    return requestJson(
        `/api/agentic-ai/endpoint-devices/${encodeURIComponent(normalizedDeviceId)}/enable`,
        {
            method: 'POST',
            headers: buildJwtOnlyHeaders(),
            body: JSON.stringify({})
        },
        'Failed to enable endpoint device.'
    );
}

export async function disableEndpointDevice(deviceId) {
    const normalizedDeviceId = toOptionalString(deviceId);
    if (!normalizedDeviceId) {
        throw createServiceError('deviceId is required.', 'VALIDATION_ERROR', 400);
    }

    return requestJson(
        `/api/agentic-ai/endpoint-devices/${encodeURIComponent(normalizedDeviceId)}/disable`,
        {
            method: 'POST',
            headers: buildJwtOnlyHeaders(),
            body: JSON.stringify({})
        },
        'Failed to disable endpoint device.'
    );
}

const AgenticAiService = {
    generateRemediationPlan,
    approveRemediationPlan,
    rejectRemediationPlan,
    getRemediationPlanById,
    listRemediationPlansByTicket,
    startMockExecution,
    getExecutionById,
    listExecutionsByPlan,
    listExecutionsByTicket,
    queueAgentTaskFromPlan,
    getAgentTaskById,
    listAgentTasksByPlan,
    listAgentTasksByTicket,
    listAgentTasksByDevice,
    listMyEndpointDevices,
    registerEndpointDevice,
    listAllEndpointDevices,
    getEndpointDeviceById,
    enableEndpointDevice,
    disableEndpointDevice
};

export default AgenticAiService;
