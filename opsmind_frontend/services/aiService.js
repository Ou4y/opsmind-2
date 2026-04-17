/**
 * OpsMind - AI Service
 * 
 * Handles all AI-related API operations including:
 * - Getting AI recommendations for tickets
 * - Retrieving AI insights for dashboard
 * - AI-powered search and categorization
 */

import AuthService from './authService.js';

// Most AI endpoints are served directly by the Python AI container.
// Keep API_BASE_URL for backward compatibility, but prefer OPSMIND_AI_API_URL.
const API_BASE_URL = window.OPSMIND_API_URL || '/api';
const AI_API_BASE_URL = window.OPSMIND_AI_API_URL || 'http://localhost:8000';

const NORMALIZED_AI_BASE_URL = String(AI_API_BASE_URL).replace(/\/+$/, '');

function buildAiUrl(path) {
    const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${path}`;
    return `${NORMALIZED_AI_BASE_URL}${normalizedPath}`;
}

function toIsoDate(value) {
    if (!value) return new Date().toISOString();
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function normalizeTicketPayload(ticketData = {}) {
    return {
        id: ticketData.id || ticketData.ticket_id || ticketData.ticketId,
        title: String(ticketData.title || ticketData.subject || '').trim(),
        description: String(ticketData.description || '').trim(),
        type_of_request: String(ticketData.type_of_request || ticketData.type || 'INCIDENT'),
        support_level: String(ticketData.support_level || ticketData.supportLevel || 'L1'),
        priority: ticketData.priority ? String(ticketData.priority) : undefined,
        created_at: toIsoDate(ticketData.created_at || ticketData.createdAt),
        requester_id: ticketData.requester_id || ticketData.requesterId,
        latitude: ticketData.latitude,
        longitude: ticketData.longitude,
        building: ticketData.building,
        room: ticketData.room,
        assigned_team: ticketData.assigned_team || ticketData.assignedTeam || ticketData.assignee
    };
}

/**
 * Handle API response and errors consistently
 */
async function handleResponse(response) {
    if (response.status === 401) {
        AuthService.clearAuth();
        window.location.href = '/index.html';
        throw new Error('Session expired');
    }

    if (!response.ok) {
        let errorMessage = `Request failed with status ${response.status}`;
        try {
            const error = await response.json();
            // Handle different error response formats
            errorMessage = error.message || error.detail || error.error || JSON.stringify(error);
        } catch (e) {
            // If response is not JSON, use status text
            errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
    }

    return response.json();
}

/**
 * AIService - Singleton service for AI operations
 */
const AIService = {
    /**
     * Get model prediction for priority and estimated resolution time
     * @param {Object} ticketData - Ticket payload
     * @returns {Promise<Object>} Prediction response from /predict
     */
    async predictPriorityAndResolution(ticketData) {
        const payload = normalizeTicketPayload(ticketData);
        const response = await fetch(buildAiUrl('/predict'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...AuthService.getAuthHeaders()
            },
            body: JSON.stringify(payload)
        });

        return handleResponse(response);
    },

    /**
     * Get AI recommendations for a specific ticket
     * @param {string} ticketId - Ticket ID
     * @returns {Promise<Array>} List of AI recommendations
     */
    async getRecommendations(ticketOrId) {
        // Prefer model-powered recommendations by sending the ticket payload.
        if (ticketOrId && typeof ticketOrId === 'object') {
            const payload = normalizeTicketPayload(ticketOrId);
            if (payload.title && payload.description && payload.type_of_request) {
                const response = await fetch(buildAiUrl('/ai/recommendations'), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...AuthService.getAuthHeaders()
                    },
                    body: JSON.stringify(payload)
                });

                return handleResponse(response);
            }
        }

        const ticketId = String(ticketOrId || '');
        if (!ticketId) {
            throw new Error('Ticket ID is required');
        }

        // Fallback: id-only recommendations.
        const response = await fetch(buildAiUrl(`/ai/recommendations/${encodeURIComponent(ticketId)}`), {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...AuthService.getAuthHeaders()
            }
        });

        return handleResponse(response);
    },

    /**
     * Get AI insights summary for dashboard
     * @returns {Promise<Object>} AI insights data
     */
    async getInsights() {
        const response = await fetch(buildAiUrl('/ai/insights'), {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...AuthService.getAuthHeaders()
            }
        });

        return handleResponse(response);
    },

    /**
     * Get count of pending AI recommendations
     * @returns {Promise<Object>} Recommendation count
     */
    async getRecommendationCount() {
        const response = await fetch(buildAiUrl('/ai/recommendations/count'), {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...AuthService.getAuthHeaders()
            }
        });

        return handleResponse(response);
    },

    /**
     * Get AI-suggested category for a ticket description
     * @param {string} description - Ticket description text
     * @returns {Promise<Object>} Suggested category and confidence
     */
    async suggestCategory(description) {
        const response = await fetch(buildAiUrl('/ai/suggest-category'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...AuthService.getAuthHeaders()
            },
            body: JSON.stringify({ description })
        });

        return handleResponse(response);
    },

    /**
     * Get AI-suggested priority for a ticket
     * @param {string} subject - Ticket subject
     * @param {string} description - Ticket description
     * @returns {Promise<Object>} Suggested priority and reasoning
     */
    async suggestPriority(subject, description) {
        const response = await fetch(buildAiUrl('/ai/suggest-priority'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...AuthService.getAuthHeaders()
            },
            body: JSON.stringify({ subject, description })
        });

        return handleResponse(response);
    },

    /**
     * Get similar tickets based on content
     * @param {string} ticketId - Ticket ID to find similar tickets for
     * @param {number} limit - Max number of similar tickets
     * @returns {Promise<Array>} Similar tickets
     */
    async getSimilarTickets(ticketId, limit = 5) {
        const response = await fetch(buildAiUrl(`/ai/similar-tickets/${encodeURIComponent(ticketId)}?limit=${limit}`), {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...AuthService.getAuthHeaders()
            }
        });

        return handleResponse(response);
    },

    /**
     * Get AI-generated summary of ticket activity
     * @param {string} ticketId - Ticket ID
     * @returns {Promise<Object>} Activity summary
     */
    async getActivitySummary(ticketId) {
        const response = await fetch(buildAiUrl(`/ai/activity-summary/${encodeURIComponent(ticketId)}`), {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...AuthService.getAuthHeaders()
            }
        });

        return handleResponse(response);
    },

    /**
     * Get AI-predicted resolution time
     * @param {Object} ticketData - Ticket data for prediction
     * @returns {Promise<Object>} Predicted resolution time
     */
    async predictResolutionTime(ticketData) {
        const payload = normalizeTicketPayload(ticketData);
        const response = await fetch(buildAiUrl('/ai/predict-resolution'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...AuthService.getAuthHeaders()
            },
            body: JSON.stringify(payload)
        });

        return handleResponse(response);
    },

    /**
     * Get suggested response templates for a ticket
     * @param {string} ticketId - Ticket ID
     * @returns {Promise<Array>} Suggested response templates
     */
    async getSuggestedResponses(ticketId) {
        const response = await fetch(buildAiUrl(`/ai/suggested-responses/${encodeURIComponent(ticketId)}`), {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...AuthService.getAuthHeaders()
            }
        });

        return handleResponse(response);
    },

    /**
     * Get SLA breach prediction for a ticket
     * POST /predict-sla
     * @param {Object} ticketData - Ticket details for analysis
     * @returns {Promise<Object>} SLA breach percentage and analysis
     */
    async getSLABreachPrediction(ticketData) {
        const payload = normalizeTicketPayload(ticketData);
        const requestBody = {
            ticket_id: payload.id,
            title: payload.title,
            description: payload.description,
            type_of_request: payload.type_of_request,
            support_level: payload.support_level,
            priority: payload.priority,
            created_at: payload.created_at,
            assigned_team: payload.assigned_team
        };

        console.log('AIService - Predicting SLA breach:', requestBody);
        console.log('AIService - API URL:', buildAiUrl('/predict-sla'));

        const response = await fetch(buildAiUrl('/predict-sla'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        console.log('AIService - Prediction response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('AIService - Prediction error:', errorText);
        }

        const result = await handleResponse(response);
        console.log('AIService - Prediction result:', result);
        return result;
    },

    /**
     * Submit feedback for AI SLA prediction
     * POST /feedback/sla
     * @param {string} ticketId - Ticket ID
     * @param {number} aiProbability - AI predicted probability (0-100)
     * @param {number} adminDecision - Admin's decision (0 or 1)
     * @param {number} finalOutcome - Final outcome (0 = no breach, 1 = breach)
     * @returns {Promise<Object>} Feedback submission result
     */
    async submitFeedback(ticketId, aiProbability, adminDecision, finalOutcome) {
        // Ensure all values are the correct type and valid
        const requestBody = {
            ticket_id: String(ticketId),
            ai_probability: Number(aiProbability),
            admin_decision: Number(adminDecision),
            final_outcome: Number(finalOutcome)
        };

        console.log('AIService - Sending feedback to backend:', requestBody);
        console.log('AIService - API URL:', buildAiUrl('/feedback/sla'));

        const response = await fetch(buildAiUrl('/feedback/sla'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        console.log('AIService - Response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('AIService - Error response:', errorText);
        }

        return handleResponse(response);
    }
};

// Freeze the service to prevent modifications
Object.freeze(AIService);

export default AIService;
