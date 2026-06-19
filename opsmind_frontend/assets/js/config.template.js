// Central runtime config template.
// This file is rendered to assets/js/config.js at container startup using environment variables.

// Backend API Configuration
const OPSMIND_LOCAL_HOST = window.location?.hostname || 'localhost';
const OPSMIND_LOCAL_PROTOCOL = window.location?.protocol || 'http:';
const OPSMIND_LOCAL_SERVICE_URL = (port, path = '') => `${OPSMIND_LOCAL_PROTOCOL}//${OPSMIND_LOCAL_HOST}:${port}${path}`;

window.OPSMIND_API_URL = window.OPSMIND_API_URL || '${OPSMIND_API_URL}';
window.OPSMIND_TICKET_URL = window.OPSMIND_TICKET_URL || '${OPSMIND_TICKET_URL}';
window.OPSMIND_WORKFLOW_API_URL = window.OPSMIND_WORKFLOW_API_URL || '${OPSMIND_WORKFLOW_API_URL}';
window.OPSMIND_AI_API_URL = window.OPSMIND_AI_API_URL || '${OPSMIND_AI_API_URL}';
window.OPSMIND_AGENTIC_AI_API_URL = window.OPSMIND_AGENTIC_AI_API_URL || '${OPSMIND_AGENTIC_AI_API_URL}';
window.OPSMIND_INVENTORY_AI_API_URL = window.OPSMIND_INVENTORY_AI_API_URL || '${OPSMIND_INVENTORY_AI_API_URL}' || OPSMIND_LOCAL_SERVICE_URL(8002);
window.OPSMIND_SLA_URL = window.OPSMIND_SLA_URL || '${OPSMIND_SLA_URL}';
window.OPSMIND_NOTIFICATION_URL = window.OPSMIND_NOTIFICATION_URL || '${OPSMIND_NOTIFICATION_URL}';
window.OPSMIND_INVENTORY_API_URL = window.OPSMIND_INVENTORY_API_URL || '${OPSMIND_INVENTORY_API_URL}' || OPSMIND_LOCAL_SERVICE_URL(5000, '/api');
window.OPSMIND_REPORT_API_URL = window.OPSMIND_REPORT_API_URL || '${OPSMIND_REPORT_API_URL}';
