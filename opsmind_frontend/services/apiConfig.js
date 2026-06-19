/**
 * Centralized frontend API endpoints.
 *
 * IMPORTANT:
 * - These defaults are for local test/dev only.
 * - Test/staging/prod must inject explicit URLs via window.OPSMIND_*.
 */

const runtime = typeof window !== 'undefined' ? window : {};

const DEFAULT_TEST_URLS = Object.freeze({
  OPSMIND_API_URL: 'http://localhost:3012',
  OPSMIND_TICKET_URL: 'http://localhost:3001',
  OPSMIND_WORKFLOW_API_URL: 'http://localhost:3003',
  OPSMIND_AI_API_URL: 'http://localhost:8001',
  OPSMIND_AGENTIC_AI_API_URL: 'http://localhost:4010',
  OPSMIND_SLA_URL: 'http://localhost:3004',
  OPSMIND_NOTIFICATION_URL: 'http://localhost:3005/api/notifications',
  OPSMIND_INVENTORY_API_URL: 'http://localhost:5000/api',
  OPSMIND_REPORT_API_URL: 'http://localhost:3006/analytics',
});

function normalizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function resolveUrl(key) {
  const fromRuntime = runtime && runtime[key] ? runtime[key] : DEFAULT_TEST_URLS[key];
  return normalizeBaseUrl(fromRuntime);
}

export const AUTH_API_BASE_URL = resolveUrl('OPSMIND_API_URL');
export const TICKET_API_BASE_URL = resolveUrl('OPSMIND_TICKET_URL');
export const WORKFLOW_API_BASE_URL = resolveUrl('OPSMIND_WORKFLOW_API_URL');
export const AI_API_BASE_URL = resolveUrl('OPSMIND_AI_API_URL');
export const AGENTIC_AI_API_BASE_URL = resolveUrl('OPSMIND_AGENTIC_AI_API_URL');
export const SLA_API_BASE_URL = resolveUrl('OPSMIND_SLA_URL');
export const NOTIFICATION_API_BASE_URL = resolveUrl('OPSMIND_NOTIFICATION_URL');
export const INVENTORY_API_BASE_URL = resolveUrl('OPSMIND_INVENTORY_API_URL');
export const REPORT_API_BASE_URL = resolveUrl('OPSMIND_REPORT_API_URL');
