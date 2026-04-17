// Central runtime config template.
// This file is rendered to assets/js/config.js at container startup using environment variables.

// Backend API Configuration
window.OPSMIND_API_URL = window.OPSMIND_API_URL || '${OPSMIND_API_URL}';
window.OPSMIND_TICKET_URL = window.OPSMIND_TICKET_URL || '${OPSMIND_TICKET_URL}';
window.OPSMIND_WORKFLOW_API_URL = window.OPSMIND_WORKFLOW_API_URL || '${OPSMIND_WORKFLOW_API_URL}';
window.OPSMIND_AI_API_URL = window.OPSMIND_AI_API_URL || '${OPSMIND_AI_API_URL}';

// Google Gemini AI Configuration
window.GEMINI_API_KEY = window.GEMINI_API_KEY || '${GEMINI_API_KEY}';
window.GEMINI_API_URL = window.GEMINI_API_URL || '${GEMINI_API_URL}';
