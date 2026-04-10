/**
 * OpsMind - AI Service
 * 
 * Handles all AI-related API operations including:
 * - Getting AI recommendations for tickets
 * - Retrieving AI insights for dashboard
 * - AI-powered search and categorization
 */

import AuthService from './authService.js';

const API_BASE_URL = window.OPSMIND_API_URL || '/api';
const AI_API_BASE_URL = window.OPSMIND_AI_API_URL || 'http://localhost:8000';

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
     * Get AI recommendations for a specific ticket
     * @param {string} ticketId - Ticket ID
     * @returns {Promise<Array>} List of AI recommendations
     */
    async getRecommendations(ticketId) {
        const response = await fetch(`${API_BASE_URL}/ai/recommendations/${ticketId}`, {
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
        const response = await fetch(`${API_BASE_URL}/ai/insights`, {
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
        const response = await fetch(`${API_BASE_URL}/ai/recommendations/count`, {
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
        const response = await fetch(`${API_BASE_URL}/ai/suggest-category`, {
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
        const response = await fetch(`${API_BASE_URL}/ai/suggest-priority`, {
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
        const response = await fetch(`${API_BASE_URL}/ai/similar-tickets/${ticketId}?limit=${limit}`, {
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
        const response = await fetch(`${API_BASE_URL}/ai/activity-summary/${ticketId}`, {
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
        const response = await fetch(`${API_BASE_URL}/ai/predict-resolution`, {
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
     * Get suggested response templates for a ticket
     * @param {string} ticketId - Ticket ID
     * @returns {Promise<Array>} Suggested response templates
     */
    async getSuggestedResponses(ticketId) {
        const response = await fetch(`${API_BASE_URL}/ai/suggested-responses/${ticketId}`, {
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
        // Map ticket data to backend expected format
        const createdAt = ticketData.createdAt ? new Date(ticketData.createdAt) : new Date();
        const requestBody = {
            support_level: String(ticketData.support_level || ticketData.type || 'INCIDENT'),
            priority: String(ticketData.priority || 'MEDIUM'),
            created_hour: Number(createdAt.getHours()),
            created_day: String(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][createdAt.getDay()]),
            assigned_team: String(ticketData.assigned_team || ticketData.assignee || 'General Support')
        };

        console.log('AIService - Predicting SLA breach:', requestBody);
        console.log('AIService - API URL:', `${AI_API_BASE_URL}/predict-sla`);

        const response = await fetch(`${AI_API_BASE_URL}/predict-sla`, {
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
        console.log('AIService - API URL:', `${AI_API_BASE_URL}/feedback/sla`);

        const response = await fetch(`${AI_API_BASE_URL}/feedback/sla`, {
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
