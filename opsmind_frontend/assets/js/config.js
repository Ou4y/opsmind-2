// Central runtime config.
// Served as a static file so it can be edited without rebuilding JS bundles.
//
// OPSMIND_API_URL is read by services/* (e.g., services/authService.js)
// OPSMIND_TICKET_URL is used by ticketService.js for ticket operations
// OPSMIND_WORKFLOW_API_URL is read by workflowService.js for workflow operations
// OPSMIND_AI_API_URL is read by aiService.js for AI/ML endpoints
// They can be overridden via a <script> tag before app scripts load.

// Backend API Configuration
window.OPSMIND_API_URL = window.OPSMIND_API_URL || 'http://localhost:3002';        // Auth Service
window.OPSMIND_TICKET_URL = window.OPSMIND_TICKET_URL || 'http://localhost:3001';  // Ticket Service  
window.OPSMIND_WORKFLOW_API_URL = window.OPSMIND_WORKFLOW_API_URL || 'http://localhost:3003'; // Workflow Service
window.OPSMIND_AI_API_URL = window.OPSMIND_AI_API_URL || 'http://localhost:8000';  // AI/ML Service

// Google Gemini AI Configuration
window.GEMINI_API_KEY = 'AIzaSyD0bNho9ANp84teBi4sZ3K02zpI51ZvuPY';
window.GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent';

// Debug: Log configuration loaded
console.log('[Config] OpsMind Configuration Loaded');
console.log('[Config] Auth Service:', window.OPSMIND_API_URL);
console.log('[Config] Ticket Service:', window.OPSMIND_TICKET_URL);
console.log('[Config] Workflow Service:', window.OPSMIND_WORKFLOW_API_URL);
console.log('[Config] AI Service:', window.OPSMIND_AI_API_URL);
console.log('[Config] Gemini API Key:', window.GEMINI_API_KEY ? '✓ Configured (' + window.GEMINI_API_KEY.substring(0, 10) + '...)' : '✗ Missing');
console.log('[Config] Gemini API URL:', window.GEMINI_API_URL);
