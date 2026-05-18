/**
 * OpsMind - Ticket Service
 * 
 * Handles all ticket-related API operations including:
 * - Fetching tickets (list and single)
 * - Creating tickets
 * - Updating ticket status
 * - Ticket search and filtering
 * 
 * All requests include authentication headers automatically.
 */

import AuthService from './authService.js';

// Prefer runtime-configured base URL (set by assets/js/config.js or docker env injection).
// Fallback to localhost for local dev, then to relative /api.
const API_BASE_URL = (
    (typeof window !== 'undefined' && window.OPSMIND_TICKET_URL) ? window.OPSMIND_TICKET_URL :
    (typeof process !== 'undefined' && process?.env?.OPSMIND_TICKET_URL) ? process.env.OPSMIND_TICKET_URL :
    'http://localhost:3001'
);

/**
 * @typedef {Object} Ticket
 * @property {string} [id]
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [type_of_request]
 * @property {string} [status]
 * @property {string} [priority]
 * @property {string} [requester_id]
 * @property {string} [requester_role]
 * @property {string} [product_group]
 * @property {number} [latitude]
 * @property {number} [longitude]
 * @property {string} [created_at]
 * @property {string} [updated_at]
 * @property {string} [ai_prediction_status]
 * @property {string} [rule_priority]
 * @property {string} [ai_priority]
 * @property {number|string} [ai_confidence]
 * @property {string|string[]} [ai_explanation]
 * @property {string} [ai_decision_source]
 * @property {string} [ai_model_name]
 * @property {string} [ai_model_version]
 * @property {string} [ai_predicted_at]
 * @property {number|string} [ai_priority_score]
 */

/**
 * @typedef {Object} CreateTicketPayload
 * @property {string} title
 * @property {string} description
 * @property {string} type_of_request
 * @property {string} requester_id
 * @property {string} [requester_role]
 * @property {string} [product_group]
 * @property {number} latitude
 * @property {number} longitude
 */

/**
 * Handle API response and errors consistently
 * @param {Response} response - Fetch response object
 * @returns {Promise<Object>} Parsed response data
 * @throws {Error} On API errors
 */
async function handleResponse(response) {
    if (response.status === 401) {
        // Token expired or invalid - redirect to login
        AuthService.clearAuth();
        window.location.href = '/index.html';
        throw new Error('Session expired');
    }

    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        // Backend returns { error: "...", details: [...] } — not { message: "..." }
        const message = errorBody.message || errorBody.error || `Request failed with status ${response.status}`;
        if (errorBody.details) {
            console.error('[TicketService] Validation details:', errorBody.details);
        }
        throw new Error(message);
    }

    return response.json();
}

const NORMALIZED_API_BASE_URL = API_BASE_URL
    .replace(/\/+$/, '')
    .replace(/\/api\/tickets$/i, '')
    .replace(/\/tickets$/i, '')
    .replace(/\/api$/i, '');

// Ticket service routes are mounted at /tickets (no /api prefix).
const TICKET_ROUTE_CANDIDATES = ['/tickets'];

function jsonHeaders() {
    return {
        'Content-Type': 'application/json',
        ...AuthService.getAuthHeaders()
    };
}

function buildTicketUrl(routePrefix, path = '', params) {
    const normalizedPrefix = routePrefix === '' ? '' : routePrefix.replace(/\/+$/, '');
    const normalizedPath = path ? `/${String(path).replace(/^\/+/, '')}` : '';
    const query = params instanceof URLSearchParams && params.toString()
        ? `?${params.toString()}`
        : '';
    return `${NORMALIZED_API_BASE_URL}${normalizedPrefix}${normalizedPath}${query}`;
}

async function requestTicketsApi({ path = '', method = 'GET', params, body, expectJson = true }) {
    let lastResponse = null;

    for (let idx = 0; idx < TICKET_ROUTE_CANDIDATES.length; idx += 1) {
        const routePrefix = TICKET_ROUTE_CANDIDATES[idx];
        const url = buildTicketUrl(routePrefix, path, params);

        const response = await fetch(url, {
            method,
            headers: jsonHeaders(),
            ...(body !== undefined ? { body: JSON.stringify(body) } : {})
        });

        const shouldFallback = (response.status === 404 || response.status === 405)
            && idx < TICKET_ROUTE_CANDIDATES.length - 1;

        if (shouldFallback) {
            continue;
        }

        lastResponse = response;

        if (!expectJson) {
            if (response.status === 401) {
                AuthService.clearAuth();
                window.location.href = '/index.html';
                throw new Error('Session expired');
            }

            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({}));
                const message = errorBody.message || errorBody.error || `Request failed with status ${response.status}`;
                if (errorBody.details) {
                    console.error('[TicketService] Validation details:', errorBody.details);
                }
                throw new Error(message);
            }

            return response;
        }

        return handleResponse(response);
    }

    if (lastResponse) {
        return handleResponse(lastResponse);
    }

    throw new Error('Ticket API request failed: no route candidates available');
}

function extractTicketsArray(response) {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.tickets)) return response.tickets;
    if (Array.isArray(response?.items)) return response.items;
    if (Array.isArray(response?.data)) return response.data;
    return [];
}

function applyTicketFilters(tickets, options = {}) {
    return tickets.filter((ticket) => {
        if (options.assigned_to && String(ticket.assigned_to || '') !== String(options.assigned_to)) {
            return false;
        }

        if (options.support_level && String(ticket.support_level || '').toUpperCase() !== String(options.support_level).toUpperCase()) {
            return false;
        }

        if (options.building) {
            const ticketBuilding = String(ticket.building || '').toLowerCase();
            if (!ticketBuilding.includes(String(options.building).toLowerCase())) {
                return false;
            }
        }

        if (options.search) {
            const query = String(options.search).toLowerCase();
            const blob = [ticket.id, ticket.title, ticket.description, ticket.type_of_request]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            if (!blob.includes(query)) {
                return false;
            }
        }

        return true;
    });
}

function withTicketsPayload(originalResponse, tickets) {
    if (Array.isArray(originalResponse)) {
        return tickets;
    }
    if (Array.isArray(originalResponse?.tickets)) {
        return { ...originalResponse, tickets, total: tickets.length };
    }
    if (Array.isArray(originalResponse?.items)) {
        return { ...originalResponse, items: tickets, total: tickets.length };
    }
    if (Array.isArray(originalResponse?.data)) {
        return { ...originalResponse, data: tickets, total: tickets.length };
    }
    return originalResponse;
}

function normalizeStatus(status) {
    return String(status || '').toUpperCase();
}

function parseTicketDate(ticket, ...candidateFields) {
    for (const field of candidateFields) {
        const raw = ticket?.[field];
        if (!raw) continue;
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }
    return null;
}

function normalizeTicket(ticket) {
    if (!ticket || typeof ticket !== 'object') return ticket;

    return {
        ...ticket,
        product_group: ticket.product_group ?? ticket.productGroup ?? ticket.category ?? null,
        ai_prediction_status: ticket.ai_prediction_status ?? ticket.aiPredictionStatus ?? null,
        rule_priority: ticket.rule_priority ?? ticket.rulePriority ?? null,
        ai_priority: ticket.ai_priority ?? ticket.aiPriority ?? null,
        ai_confidence: ticket.ai_confidence ?? ticket.aiConfidence ?? null,
        ai_decision_source: ticket.ai_decision_source ?? ticket.aiDecisionSource ?? null,
        ai_explanation: ticket.ai_explanation ?? ticket.aiExplanation ?? null,
        ai_model_name: ticket.ai_model_name ?? ticket.aiModelName ?? null,
        ai_model_version: ticket.ai_model_version ?? ticket.aiModelVersion ?? null,
        ai_predicted_at: ticket.ai_predicted_at ?? ticket.aiPredictedAt ?? null,
        ai_priority_score: ticket.ai_priority_score ?? ticket.aiPriorityScore ?? null
    };
}

function normalizeTicketsPayload(payload) {
    if (Array.isArray(payload)) {
        return payload.map(normalizeTicket);
    }

    if (!payload || typeof payload !== 'object') {
        return payload;
    }

    if (Array.isArray(payload.tickets)) {
        return {
            ...payload,
            tickets: payload.tickets.map(normalizeTicket)
        };
    }

    if (Array.isArray(payload.items)) {
        return {
            ...payload,
            items: payload.items.map(normalizeTicket)
        };
    }

    if (Array.isArray(payload.data)) {
        return {
            ...payload,
            data: payload.data.map(normalizeTicket)
        };
    }

    if (payload.data && typeof payload.data === 'object') {
        if (payload.data.ticket && typeof payload.data.ticket === 'object') {
            return {
                ...payload,
                data: {
                    ...payload.data,
                    ticket: normalizeTicket(payload.data.ticket)
                }
            };
        }

        return {
            ...payload,
            data: normalizeTicket(payload.data)
        };
    }

    if (payload.ticket && typeof payload.ticket === 'object') {
        return {
            ...payload,
            ticket: normalizeTicket(payload.ticket)
        };
    }

    return normalizeTicket(payload);
}

/**
 * TicketService - Singleton service for ticket operations
 */
const TicketService = {
    /**
     * Get a paginated list of tickets with optional filters
     * @param {Object} options - Query options
     * @param {number} options.page - Page number (1-based)
     * @param {number} options.limit - Items per page
     * @param {string} options.status - Filter by status
     * @param {string} options.priority - Filter by priority
     * @param {string} options.category - Filter by category
     * @param {string} options.search - Search term
     * @param {string} options.dateRange - Date range filter
     * @param {string} options.sortBy - Sort field
     * @param {string} options.sortOrder - Sort direction (asc/desc)
     * @param {string} options.assigned_to - Filter by assigned technician ID
     * @param {string} options.support_level - Filter by support level (JUNIOR/SENIOR/SUPERVISOR)
     * @param {string} options.building - Filter by building
     * @returns {Promise<Object>} Tickets list with pagination info
     */
    async getTickets(options = {}) {
        const params = new URLSearchParams();

        const limit = options.limit || options.pageSize;
        const offset = options.offset !== undefined
            ? options.offset
            : (options.page && limit ? (Number(options.page) - 1) * Number(limit) : undefined);

        // Add query parameters supported by ticket-service
        if (limit !== undefined) params.append('limit', String(limit));
        if (offset !== undefined) params.append('offset', String(offset));
        if (options.status) params.append('status', options.status);
        if (options.priority) params.append('priority', options.priority);

        const requesterId = options.requester_id || options.requester;
        if (requesterId) params.append('requester_id', requesterId);

        if (options.assigned_to) {
            params.append('assigned_to', String(options.assigned_to));
        }

        const data = await requestTicketsApi({
            method: 'GET',
            params
        });

        const requiresClientFiltering = Boolean(
            options.assigned_to ||
            options.support_level ||
            options.building ||
            options.search
        );

        if (!requiresClientFiltering) {
            return normalizeTicketsPayload(data);
        }

        const filteredTickets = applyTicketFilters(extractTicketsArray(data), options);
        const filteredPayload = withTicketsPayload(data, filteredTickets);

        console.log('[TicketService.getTickets] Response:', data);
        return normalizeTicketsPayload(filteredPayload);
    },

    /**
     * Get a single ticket by ID
     * @param {string} ticketId - Ticket ID
     * @returns {Promise<Object>} Ticket details
     */
    async getTicket(ticketId) {
        const data = await requestTicketsApi({
            path: ticketId,
            method: 'GET'
        });
        return normalizeTicketsPayload(data);
    },

    /**
     * Create a new ticket
     * @param {Object} ticketData - Ticket data
     * @param {string} ticketData.title - Ticket title
     * @param {string} ticketData.description - Ticket description
     * @param {string} ticketData.type_of_request - Type: INCIDENT, SERVICE_REQUEST, MAINTENANCE
     * @param {string} [ticketData.product_group] - Category/product group for AI enrichment
     * @param {number} ticketData.latitude - Location latitude coordinate
     * @param {number} ticketData.longitude - Location longitude coordinate
     * @param {string} ticketData.requester_id - Requester user ID
     * @param {string} [ticketData.requester_role] - Optional requester role from auth context
     * @returns {Promise<Object>} Created ticket
     */
    async createTicket(ticketData) {
        const data = await requestTicketsApi({
            method: 'POST',
            body: ticketData
        });
        return normalizeTicketsPayload(data);
    },

    /**
     * Update ticket status
     * @param {string} ticketId - Ticket ID
     * @param {string} status - New status (OPEN, IN_PROGRESS, RESOLVED, CLOSED)
     * @param {string} resolution_summary - Optional resolution summary
     * @returns {Promise<Object>} Updated ticket
     */
    async updateStatus(ticketId, status, resolution_summary = '') {
        const updateData = { status };
        if (resolution_summary) {
            updateData.resolution_summary = resolution_summary;
        }

        const user = AuthService.getCurrentUser?.() || AuthService.getUser?.();
        const performedBy =
            user?.workflowUserId ||
            user?.workflow_user_id ||
            user?.user_id ||
            user?.id ||
            user?.userId ||
            null;
        const performedByRole =
            user?.technicianLevel ||
            user?.level ||
            user?.role ||
            null;

        if (performedBy) {
            updateData.performed_by = performedBy;
        }
        if (performedByRole) {
            updateData.performed_by_role = String(performedByRole).toUpperCase();
        }
        if (resolution_summary) {
            updateData.status_reason = resolution_summary;
        }

        const data = await requestTicketsApi({
            path: ticketId,
            method: 'PATCH',
            body: updateData
        });
        return normalizeTicketsPayload(data);
    },

    /**
     * Update ticket details
     * @param {string} ticketId - Ticket ID
     * @param {Object} updates - Fields to update
     * @returns {Promise<Object>} Updated ticket
     */
    async updateTicket(ticketId, updates) {
        const data = await requestTicketsApi({
            path: ticketId,
            method: 'PATCH',
            body: updates
        });
        return normalizeTicketsPayload(data);
    },

    /**
     * Delete a ticket
     * @param {string} ticketId - Ticket ID
     * @returns {Promise<void>}
     */
    async deleteTicket(ticketId) {
        await requestTicketsApi({
            path: ticketId,
            method: 'DELETE',
            expectJson: false
        });
    },

    /**
     * Escalate a ticket to a higher support level
     * @param {string} ticketId - Ticket ID
     * @param {Object} escalationData - Escalation data
     * @param {string} escalationData.from_level - Current level (L1, L2, L3, L4)
     * @param {string} escalationData.to_level - Target level (L1, L2, L3, L4)
     * @param {string} escalationData.reason - Reason for escalation
     * @returns {Promise<Object>} Updated ticket
     */
    async escalateTicket(ticketId, escalationData) {
        const data = await requestTicketsApi({
            path: `${ticketId}/escalate`,
            method: 'POST',
            body: escalationData
        });
        return normalizeTicketsPayload(data);
    },

    /**
     * Get tickets assigned to a technician with filters
     * @param {string} technicianId - Technician user ID
     * @param {Object} options - Additional filters
     * @param {string} options.status - Filter by status
     * @param {string} options.support_level - Filter by support level
     * @param {string} options.building - Filter by building
     * @returns {Promise<Object>} Technician's assigned tickets
     */
    async getTicketsByTechnician(technicianId, options = {}) {
        const filters = {
            assigned_to: technicianId,
            limit: options.limit || 500,
            offset: options.offset || 0,
            ...options
        };
        
        console.log('[TicketService.getTicketsByTechnician] Fetching tickets for technician:', technicianId);
        console.log('[TicketService.getTicketsByTechnician] Filters:', filters);
        
        return this.getTickets(filters);
    },

    /**
     * Get tickets assigned to a technician via the dedicated backend endpoint.
     * Falls back to client-side filtering if the endpoint is unavailable.
     * Normalizes assignment fields so the filter works regardless of which field
     * the backend uses (assigned_to, assignedTo, assignedTechnicianId, etc.).
     * @param {string} technicianId - Technician user ID
     * @returns {Promise<Array>} Array of assigned tickets
     */
    async getAssignedTickets(technicianId) {
        console.log('[TicketService.getAssignedTickets] technicianId:', technicianId);

        // 1. Try the dedicated endpoint first
        try {
            const data = await requestTicketsApi({
                path: `assigned/${technicianId}`,
                method: 'GET'
            });
            const tickets = extractTicketsArray(normalizeTicketsPayload(data));
            console.log('[TicketService.getAssignedTickets] Dedicated endpoint returned', tickets.length, 'tickets');
            return tickets;
        } catch (err) {
            console.warn('[TicketService.getAssignedTickets] Dedicated endpoint failed, falling back to client-side filter:', err.message);
        }

        // 2. Fallback: fetch all tickets and filter client-side
        const data = normalizeTicketsPayload(
            await requestTicketsApi({ method: 'GET', params: new URLSearchParams({ limit: '500', offset: '0' }) })
        );
        const all = extractTicketsArray(data);
        console.log('[TicketService.getAssignedTickets] Fallback: fetched', all.length, 'total tickets');

        const techId = String(technicianId);
        const assigned = all.filter((ticket) => {
            // Normalize all possible assignment fields
            const candidates = [
                ticket.assigned_to,
                ticket.assignedTo,
                ticket.assignedTechnicianId,
                ticket.technicianId,
                ticket.assignee_id,
                ticket.assigned_user_id,
            ];
            return candidates.some((v) => v !== undefined && v !== null && String(v) === techId);
        });

        console.log('[TicketService.getAssignedTickets] Fallback filtered to', assigned.length, 'assigned tickets');
        return assigned;
    },

    /**
     * Get tickets by requester
     * @param {string} requesterId - Requester user ID
     * @param {Object} options - Query options
     * @returns {Promise<Array>} Tickets list
     */
    async getTicketsByRequester(requesterId, options = {}) {
        const params = new URLSearchParams();

        if (options.status) params.append('status', options.status);
        if (options.priority) params.append('priority', options.priority);
        if (options.limit) params.append('limit', options.limit);
        if (options.offset) params.append('offset', options.offset);

        const data = await requestTicketsApi({
            path: `requester/${requesterId}`,
            method: 'GET',
            params
        });
        return normalizeTicketsPayload(data);
    },

    /**
     * Get ticket statistics for dashboard
     * @returns {Promise<Object>} Ticket statistics
     */
    async getStatistics() {
        const response = await this.getTickets({ limit: 500, offset: 0 });
        const tickets = extractTicketsArray(response);

        const open = tickets.filter((t) => normalizeStatus(t.status) === 'OPEN').length;
        const inProgress = tickets.filter((t) => normalizeStatus(t.status) === 'IN_PROGRESS').length;
        const slaViolations = tickets.filter((t) => normalizeStatus(t.status) === 'ESCALATED').length;

        return {
            open,
            inProgress,
            slaViolations,
            openChange: '0%',
            inProgressChange: '0%',
            slaChange: '0'
        };
    },

    /**
     * Get high priority tickets
     * @param {number} limit - Max number of tickets to return
     * @returns {Promise<Array>} High priority tickets
     */
    async getHighPriority(limit = 5) {
        const cappedLimit = Math.max(limit, 20);
        const [criticalResponse, highResponse] = await Promise.all([
            this.getTickets({ priority: 'CRITICAL', limit: cappedLimit, offset: 0 }),
            this.getTickets({ priority: 'HIGH', limit: cappedLimit, offset: 0 })
        ]);

        const merged = [
            ...extractTicketsArray(criticalResponse),
            ...extractTicketsArray(highResponse)
        ];

        const deduped = [];
        const seen = new Set();
        merged.forEach((ticket) => {
            const ticketId = String(ticket?.id || ticket?.ticketId || '');
            if (!ticketId || seen.has(ticketId)) return;
            seen.add(ticketId);
            deduped.push(ticket);
        });

        return deduped.slice(0, limit);
    },

    /**
     * Get recent activity for tickets
     * @param {number} limit - Max number of activities
     * @returns {Promise<Array>} Recent activities
     */
    async getRecentActivity(limit = 10) {
        const response = await this.getTickets({ limit: Math.max(limit * 5, 50), offset: 0 });
        const tickets = extractTicketsArray(response);

        const activities = tickets
            .map((ticket) => {
                const createdAt = parseTicketDate(ticket, 'created_at', 'createdAt');
                const updatedAt = parseTicketDate(ticket, 'updated_at', 'updatedAt');
                const status = normalizeStatus(ticket.status);

                const title = ticket.title || ticket.subject || 'Untitled Ticket';

                if (status === 'RESOLVED' || status === 'CLOSED') {
                    return {
                        type: 'ticket_resolved',
                        message: `Ticket ${ticket.id} resolved: "${title}"`,
                        time: updatedAt || createdAt || new Date()
                    };
                }

                return {
                    type: 'ticket_created',
                    message: `Ticket ${ticket.id} created: "${title}"`,
                    time: createdAt || updatedAt || new Date()
                };
            })
            .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
            .slice(0, limit);

        return activities;
    },

    /**
     * Get ticket trend data for charts
     * @param {number} days - Number of days of history
     * @returns {Promise<Object>} Trend data
     */
    async getTrends(days = 30) {
        const response = await this.getTickets({ limit: 1000, offset: 0 });
        const tickets = extractTicketsArray(response);

        const now = new Date();
        const totalDays = Math.max(1, Number(days) || 30);
        const bucketCount = totalDays <= 31 ? totalDays : 12;
        const bucketSize = Math.max(1, Math.ceil(totalDays / bucketCount));

        const labels = [];
        const created = Array.from({ length: bucketCount }, () => 0);
        const resolved = Array.from({ length: bucketCount }, () => 0);

        for (let i = bucketCount - 1; i >= 0; i -= 1) {
            const start = new Date(now);
            start.setDate(now.getDate() - (i + 1) * bucketSize + 1);
            labels.push(start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        }

        const createdCutoff = new Date(now);
        createdCutoff.setDate(now.getDate() - totalDays);

        tickets.forEach((ticket) => {
            const createdAt = parseTicketDate(ticket, 'created_at', 'createdAt');
            const updatedAt = parseTicketDate(ticket, 'updated_at', 'updatedAt', 'closed_at', 'closedAt');

            if (createdAt && createdAt >= createdCutoff) {
                const daysAgo = Math.floor((now.getTime() - createdAt.getTime()) / 86400000);
                const bucketFromEnd = Math.floor(daysAgo / bucketSize);
                const index = bucketCount - 1 - bucketFromEnd;
                if (index >= 0 && index < bucketCount) {
                    created[index] += 1;
                }
            }

            const status = normalizeStatus(ticket.status);
            if ((status === 'RESOLVED' || status === 'CLOSED') && updatedAt && updatedAt >= createdCutoff) {
                const daysAgo = Math.floor((now.getTime() - updatedAt.getTime()) / 86400000);
                const bucketFromEnd = Math.floor(daysAgo / bucketSize);
                const index = bucketCount - 1 - bucketFromEnd;
                if (index >= 0 && index < bucketCount) {
                    resolved[index] += 1;
                }
            }
        });

        return { labels, created, resolved };
    },

    /**
     * Get list of available assignees
     * @returns {Promise<Array>} List of users who can be assigned tickets
     */
    async getAssignees() {
        // Preferred new endpoint (if exposed by backend)
        try {
            const response = await requestTicketsApi({
                path: 'assignees',
                method: 'GET'
            });

            if (Array.isArray(response)) {
                return response;
            }
            if (Array.isArray(response?.data)) {
                return response.data;
            }
        } catch (error) {
            console.warn('[TicketService.getAssignees] /assignees not available, using ticket-derived assignees.');
        }

        // Fallback: derive assignees from currently available tickets
        const ticketsResponse = await this.getTickets({ limit: 1000, offset: 0 });
        const tickets = extractTicketsArray(ticketsResponse);

        const assigneeMap = new Map();
        tickets.forEach((ticket) => {
            if (!ticket.assigned_to) return;
            const id = String(ticket.assigned_to);
            if (!assigneeMap.has(id)) {
                assigneeMap.set(id, {
                    id,
                    name: ticket.assigned_to_name || ticket.assignedToName || `Technician #${id}`
                });
            }
        });

        return Array.from(assigneeMap.values());
    }
};

// Freeze the service to prevent modifications
Object.freeze(TicketService);

export default TicketService;
