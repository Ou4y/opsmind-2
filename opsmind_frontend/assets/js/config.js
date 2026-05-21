// Central runtime config.
// Served as a static file so it can be edited without rebuilding JS bundles.
//
// OPSMIND_API_URL is read by services/* (e.g., services/authService.js)
// OPSMIND_TICKET_URL is used by ticketService.js for ticket operations
// OPSMIND_WORKFLOW_API_URL is read by workflowService.js for workflow operations
// OPSMIND_AI_API_URL is read by aiService.js for AI/ML endpoints
// OPSMIND_INVENTORY_AI_API_URL is read by inventory.js for asset lifespan predictions
// OPSMIND_SLA_URL is read by slaService.js for SLA operations
// OPSMIND_NOTIFICATION_URL is read by notificationService.js for notification operations
// OPSMIND_INVENTORY_API_URL is read by inventory page scripts for asset operations
// OPSMIND_REPORT_API_URL is read by reportService.js for analytics/report operations
// They can be overridden via a <script> tag before app scripts load.

// Backend API Configuration
window.OPSMIND_API_URL = window.OPSMIND_API_URL || 'http://localhost:3012';        // Auth Service
window.OPSMIND_TICKET_URL = window.OPSMIND_TICKET_URL || 'http://localhost:3001';  // Ticket Service  
window.OPSMIND_WORKFLOW_API_URL = window.OPSMIND_WORKFLOW_API_URL || 'http://localhost:3003'; // Workflow Service
window.OPSMIND_AI_API_URL = window.OPSMIND_AI_API_URL || 'http://localhost:8001';  // AI/ML Service
window.OPSMIND_INVENTORY_AI_API_URL = window.OPSMIND_INVENTORY_AI_API_URL || 'http://localhost:8002';  // Inventory AI Service
window.OPSMIND_SLA_URL = window.OPSMIND_SLA_URL || 'http://localhost:3004'; // SLA Service
window.OPSMIND_NOTIFICATION_URL = window.OPSMIND_NOTIFICATION_URL || 'http://localhost:3005/api/notifications'; // Notification Service
window.OPSMIND_INVENTORY_API_URL = window.OPSMIND_INVENTORY_API_URL || 'http://localhost:5000/api'; // Inventory Service
window.OPSMIND_REPORT_API_URL = window.OPSMIND_REPORT_API_URL || 'http://localhost:3006/analytics'; // Reporting Service
