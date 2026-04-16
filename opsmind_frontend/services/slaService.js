/**
 * OpsMind - SLA Service
 *
 * Handles SLA API operations including:
 * - Listing SLA-connected tickets
 * - Fetching SLA details for a single ticket
 * - Pausing and resuming SLA tracking
 */

import AuthService from './authService.js';

const API_BASE_URL = (
    (typeof window !== 'undefined' && window.OPSMIND_SLA_URL) ? window.OPSMIND_SLA_URL :
    'http://localhost:3004'
);

async function handleResponse(response) {
    if (response.status === 401) {
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

const SLAService = {
    async getTickets(filters = {}) {
        const params = new URLSearchParams();

        if (filters.q) params.append('q', filters.q);
        if (filters.status) params.append('status', filters.status);
        if (filters.priority) params.append('priority', filters.priority);
        if (filters.ticketStatus) params.append('ticketStatus', filters.ticketStatus);
        if (filters.assignedTo) params.append('assignedTo', filters.assignedTo);
        if (filters.limit) params.append('limit', String(filters.limit));
        if (filters.offset) params.append('offset', String(filters.offset));

        const queryString = params.toString();
        const response = await fetch(`${API_BASE_URL}/sla/tickets${queryString ? `?${queryString}` : ''}`, {
            method: 'GET',
            headers: {
                ...AuthService.getAuthHeaders()
            }
        });

        return handleResponse(response);
    },

    async getTicket(ticketId) {
        const response = await fetch(`${API_BASE_URL}/sla/tickets/${encodeURIComponent(ticketId)}`, {
            method: 'GET',
            headers: {
                ...AuthService.getAuthHeaders()
            }
        });

        return handleResponse(response);
    },

    async pauseTicket(ticketId, reason = 'Paused from frontend') {
        const response = await fetch(`${API_BASE_URL}/sla/tickets/${encodeURIComponent(ticketId)}/pause`, {
            method: 'POST',
            headers: {
                ...AuthService.getAuthHeaders()
            },
            body: JSON.stringify({ reason })
        });

        return handleResponse(response);
    },

    async resumeTicket(ticketId) {
        const response = await fetch(`${API_BASE_URL}/sla/tickets/${encodeURIComponent(ticketId)}/resume`, {
            method: 'POST',
            headers: {
                ...AuthService.getAuthHeaders()
            }
        });

        return handleResponse(response);
    },

    async getReadiness() {
        const response = await fetch(`${API_BASE_URL}/health/ready`, {
            method: 'GET',
            headers: {
                ...AuthService.getAuthHeaders()
            }
        });

        return handleResponse(response);
    }
};

Object.freeze(SLAService);

export default SLAService;
