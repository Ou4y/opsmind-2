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
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || `Request failed with status ${response.status}`);
    }

    return response.json();
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
        
        // Add query parameters
        if (options.page) params.append('page', options.page);
        if (options.limit) params.append('limit', options.limit);
        if (options.status) params.append('status', options.status);
        if (options.priority) params.append('priority', options.priority);
        if (options.category) params.append('category', options.category);
        if (options.search) params.append('search', options.search);
        if (options.dateRange) params.append('dateRange', options.dateRange);
        if (options.sortBy) params.append('sortBy', options.sortBy);
        if (options.sortOrder) params.append('sortOrder', options.sortOrder);
        if (options.assigned_to) params.append('assigned_to', options.assigned_to);
        if (options.support_level) params.append('support_level', options.support_level);
        if (options.building) params.append('building', options.building);

        const queryString = params.toString();
        const url = `${API_BASE_URL}/tickets${queryString ? '?' + queryString : ''}`;

        console.log('[TicketService.getTickets] API Endpoint:', url);
        console.log('[TicketService.getTickets] Filters:', options);

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...AuthService.getAuthHeaders()
            }
        });

        const data = await handleResponse(response);
        console.log('[TicketService.getTickets] Response:', data);
        return data;
    },

    /**
     * Get a single ticket by ID
     * @param {string} ticketId - Ticket ID
     * @returns {Promise<Object>} Ticket details
     */
    async getTicket(ticketId) {
        const response = await fetch(`${API_BASE_URL}/tickets/${ticketId}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...AuthService.getAuthHeaders()
            }
        });

        return handleResponse(response);
    },

    /**
     * Create a new ticket
     * @param {Object} ticketData - Ticket data
     * @param {string} ticketData.title - Ticket title
     * @param {string} ticketData.description - Ticket description
     * @param {string} ticketData.type_of_request - Type: INCIDENT, SERVICE_REQUEST, MAINTENANCE
     * @param {string} ticketData.building - Building location
     * @param {string} ticketData.room - Room number
     * @param {string} ticketData.requester_id - Requester user ID
     * @returns {Promise<Object>} Created ticket
     */
    async createTicket(ticketData) {
        // Backend expects: title, description, type_of_request, building, room, requester_id
        const response = await fetch(`${API_BASE_URL}/tickets`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...AuthService.getAuthHeaders()
            },
            body: JSON.stringify(ticketData)
        });

        return handleResponse(response);
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
        
        const response = await fetch(`${API_BASE_URL}/tickets/${ticketId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                ...AuthService.getAuthHeaders()
            },
            body: JSON.stringify(updateData)
        });

        return handleResponse(response);
    },

    /**
     * Update ticket details
     * @param {string} ticketId - Ticket ID
     * @param {Object} updates - Fields to update
     * @returns {Promise<Object>} Updated ticket
     */
    async updateTicket(ticketId, updates) {
        const response = await fetch(`${API_BASE_URL}/tickets/${ticketId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                ...AuthService.getAuthHeaders()
            },
            body: JSON.stringify(updates)
        });

        return handleResponse(response);
    },

    /**
     * Delete a ticket
     * @param {string} ticketId - Ticket ID
     * @returns {Promise<void>}
     */
    async deleteTicket(ticketId) {
        const response = await fetch(`${API_BASE_URL}/tickets/${ticketId}`, {
            method: 'DELETE',
            headers: {
                ...AuthService.getAuthHeaders()
            }
        });

        if (response.status === 401) {
            AuthService.clearAuth();
            window.location.href = '/index.html';
            throw new Error('Session expired');
        }

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.message || 'Failed to delete ticket');
        }
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
        const response = await fetch(`${API_BASE_URL}/tickets/${ticketId}/escalate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...AuthService.getAuthHeaders()
            },
            body: JSON.stringify(escalationData)
        });

        return handleResponse(response);
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
            ...options
        };
        
        console.log('[TicketService.getTicketsByTechnician] Fetching tickets for technician:', technicianId);
        console.log('[TicketService.getTicketsByTechnician] Filters:', filters);
        
        return this.getTickets(filters);
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

        const queryString = params.toString();
        const url = `${API_BASE_URL}/tickets/requester/${requesterId}${queryString ? '?' + queryString : ''}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...AuthService.getAuthHeaders()
            }
        });

        return handleResponse(response);
    },

    /**
     * Get ticket statistics for dashboard
     * @returns {Promise<Object>} Ticket statistics
     */
    async getStatistics() {
        const response = await fetch(`${API_BASE_URL}/tickets/statistics`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...AuthService.getAuthHeaders()
            }
        });

        return handleResponse(response);
    },

    /**
     * Get high priority tickets
     * @param {number} limit - Max number of tickets to return
     * @returns {Promise<Array>} High priority tickets
     */
    async getHighPriority(limit = 5) {
        const response = await fetch(`${API_BASE_URL}/tickets/high-priority?limit=${limit}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...AuthService.getAuthHeaders()
            }
        });

        return handleResponse(response);
    },

    /**
     * Get recent activity for tickets
     * @param {number} limit - Max number of activities
     * @returns {Promise<Array>} Recent activities
     */
    async getRecentActivity(limit = 10) {
        const response = await fetch(`${API_BASE_URL}/tickets/activity?limit=${limit}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...AuthService.getAuthHeaders()
            }
        });

        return handleResponse(response);
    },

    /**
     * Get ticket trend data for charts
     * @param {number} days - Number of days of history
     * @returns {Promise<Object>} Trend data
     */
    async getTrends(days = 30) {
        const response = await fetch(`${API_BASE_URL}/tickets/trends?days=${days}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...AuthService.getAuthHeaders()
            }
        });

        return handleResponse(response);
    },

    /**
     * Get list of available assignees
     * @returns {Promise<Array>} List of users who can be assigned tickets
     */
    async getAssignees() {
        const response = await fetch(`${API_BASE_URL}/users/assignees`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...AuthService.getAuthHeaders()
            }
        });

        return handleResponse(response);
    }
};

// Freeze the service to prevent modifications
Object.freeze(TicketService);

export default TicketService;
