// Central runtime config.
// Served as a static file so it can be edited without rebuilding JS bundles.
//
// OPSMIND_API_URL is read by services/* (e.g., services/authService.js)
// OPSMIND_TICKET_URL is used by ticketService.js for ticket operations
// OPSMIND_WORKFLOW_API_URL is read by workflowService.js for workflow operations
// OPSMIND_AI_API_URL is read by aiService.js for AI/ML endpoints
// OPSMIND_AGENTIC_AI_API_URL is read by agenticAiService.js for remediation plan generation
// OPSMIND_INVENTORY_AI_API_URL is read by inventory.js for asset lifespan predictions
// OPSMIND_SLA_URL is read by slaService.js for SLA operations
// OPSMIND_NOTIFICATION_URL is read by notificationService.js for notification operations
// OPSMIND_INVENTORY_API_URL is read by inventory page scripts for asset operations
// OPSMIND_REPORT_API_URL is read by reportService.js for analytics/report operations
// They can be overridden via a <script> tag before app scripts load.

// Backend API Configuration
const OPSMIND_LOCAL_HOST = window.location?.hostname || 'localhost';
const OPSMIND_LOCAL_PROTOCOL = window.location?.protocol || 'http:';
const OPSMIND_LOCAL_ORIGIN = window.location?.origin || 'http://localhost:8085';
const OPSMIND_LOCAL_SERVICE_URL = (port, path = '') => `${OPSMIND_LOCAL_PROTOCOL}//${OPSMIND_LOCAL_HOST}:${port}${path}`;

const OPSMIND_IS_LOCALHOST =
  OPSMIND_LOCAL_HOST === 'localhost' ||
  OPSMIND_LOCAL_HOST === '127.0.0.1' ||
  OPSMIND_LOCAL_HOST === '[::1]';

const OPSMIND_IS_PUBLIC_TUNNEL =
  /ngrok-free\.(app|dev)$/i.test(OPSMIND_LOCAL_HOST) ||
  /trycloudflare\.com$/i.test(OPSMIND_LOCAL_HOST);

const OPSMIND_PUBLIC_SERVICE_URL = (path = '') => `${OPSMIND_LOCAL_ORIGIN}${path}`;

if (OPSMIND_IS_PUBLIC_TUNNEL) {
  window.OPSMIND_API_URL = window.OPSMIND_API_URL || OPSMIND_PUBLIC_SERVICE_URL('/auth-api');
  window.OPSMIND_TICKET_URL = window.OPSMIND_TICKET_URL || OPSMIND_PUBLIC_SERVICE_URL('/ticket-api');
  window.OPSMIND_WORKFLOW_API_URL = window.OPSMIND_WORKFLOW_API_URL || OPSMIND_PUBLIC_SERVICE_URL('/workflow-api');
  window.OPSMIND_AI_API_URL = window.OPSMIND_AI_API_URL || OPSMIND_PUBLIC_SERVICE_URL('/ai-api');
  window.OPSMIND_AGENTIC_AI_API_URL = window.OPSMIND_AGENTIC_AI_API_URL || OPSMIND_PUBLIC_SERVICE_URL('/agentic-ai-api');
  window.OPSMIND_INVENTORY_AI_API_URL = window.OPSMIND_INVENTORY_AI_API_URL || OPSMIND_PUBLIC_SERVICE_URL('/inventory-ai-api');
  window.OPSMIND_SLA_URL = window.OPSMIND_SLA_URL || OPSMIND_PUBLIC_SERVICE_URL('/sla-api');
  window.OPSMIND_NOTIFICATION_URL = window.OPSMIND_NOTIFICATION_URL || OPSMIND_PUBLIC_SERVICE_URL('/notification-api/api/notifications');
  window.OPSMIND_INVENTORY_API_URL = window.OPSMIND_INVENTORY_API_URL || OPSMIND_PUBLIC_SERVICE_URL('/inventory-api/api');
  window.OPSMIND_REPORT_API_URL = window.OPSMIND_REPORT_API_URL || OPSMIND_PUBLIC_SERVICE_URL('/report-api/analytics');
} else {
  window.OPSMIND_API_URL = window.OPSMIND_API_URL || OPSMIND_LOCAL_SERVICE_URL(3012);
  window.OPSMIND_TICKET_URL = window.OPSMIND_TICKET_URL || OPSMIND_LOCAL_SERVICE_URL(3001);
  window.OPSMIND_WORKFLOW_API_URL = window.OPSMIND_WORKFLOW_API_URL || OPSMIND_LOCAL_SERVICE_URL(3003);
  window.OPSMIND_AI_API_URL = window.OPSMIND_AI_API_URL || OPSMIND_LOCAL_SERVICE_URL(8001);
  window.OPSMIND_AGENTIC_AI_API_URL = window.OPSMIND_AGENTIC_AI_API_URL || OPSMIND_LOCAL_SERVICE_URL(4010);
  window.OPSMIND_INVENTORY_AI_API_URL = window.OPSMIND_INVENTORY_AI_API_URL || OPSMIND_LOCAL_SERVICE_URL(8002);
  window.OPSMIND_SLA_URL = window.OPSMIND_SLA_URL || OPSMIND_LOCAL_SERVICE_URL(3004);
  window.OPSMIND_NOTIFICATION_URL = window.OPSMIND_NOTIFICATION_URL || OPSMIND_LOCAL_SERVICE_URL(3005, '/api/notifications');
  window.OPSMIND_INVENTORY_API_URL = window.OPSMIND_INVENTORY_API_URL || OPSMIND_LOCAL_SERVICE_URL(5000, '/api');
  window.OPSMIND_REPORT_API_URL = window.OPSMIND_REPORT_API_URL || OPSMIND_LOCAL_SERVICE_URL(3006, '/analytics');
}

