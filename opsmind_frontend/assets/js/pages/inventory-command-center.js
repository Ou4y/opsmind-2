import UI from '/assets/js/ui.js';
import AuthService from '/services/authService.js';
import { initInventoryAiCopilot } from '/assets/js/components/inventoryAiCopilot.js';

const API_URL = window.OPSMIND_INVENTORY_API_URL || 'http://localhost:5000/api';
const INVENTORY_AI_URL = window.OPSMIND_INVENTORY_AI_API_URL || 'http://localhost:8002';
const ALLOWED_LEVELS = new Set(['JUNIOR', 'SENIOR', 'SUPERVISOR']);
const PAGE_SIZE = 500;
const MAX_ASSET_PAGES = 12;
const AUTO_REFRESH_INTERVAL_MS = 60 * 1000;
const AUTO_REFRESH_PREF_KEY = 'opsmind_auto_refresh_enabled';
const PRIORITY_STATE_KEY = 'opsmind_icc_priority_state_v1';
const PRIORITY_REASONS = ['fixed', 'escalated', 'false alarm', 'duplicate'];
const QUALITY_FIELD_CONFIG = {
  serial: { label: 'Serial Number', assetField: 'serialNumber', inputType: 'text', missingKey: 'serial' },
  department: { label: 'Department', assetField: 'department', inputType: 'text', missingKey: 'department' },
  location: { label: 'Location', assetField: 'location', inputType: 'text', missingKey: 'location' },
  purchaseDate: { label: 'Purchase Date', assetField: 'purchaseDate', inputType: 'date', missingKey: 'purchase date' },
  warranty: { label: 'Warranty End', assetField: 'warrantyEndDate', inputType: 'date', missingKey: 'warranty' },
  purchaseCost: { label: 'Purchase Cost', assetField: 'purchaseCost', inputType: 'number', missingKey: 'purchase cost' },
};

const state = {
  assets: [],
  board: null,
  audit: null,
  smartAlerts: null,
  alertRules: null,
  eolBudgetTimeline: null,
  eolBudgetHorizon: 12,
  eolBudgetFilters: { department: 'all', building: 'all', category: 'all' },
  eolBudgetSelectedQuarter: '',
  executive: null,
  loadedAt: null,
  errors: [],
  briefingRequestId: 0,
  autoRefreshTimer: null,
  refreshing: false,
  walkthroughStep: -1,
  focusMode: String(localStorage.getItem('opsmind_inventory_focus_mode') || '').toLowerCase() === 'true',
  priorityState: null,
};

function ensureAccess() {
  const user = AuthService.getCurrentUser();
  const context = AuthService.resolveUserDashboardContext(user);
  const level = String(context.technicianLevel || '').toUpperCase();
  const allowed = AuthService.isAuthenticated() && (context.roleCategory === 'ADMIN' || ALLOWED_LEVELS.has(level));
  if (!allowed) {
    sessionStorage.setItem('opsmind_error', 'Access denied: Inventory Command Center is available only to Admin and Technician levels (Junior/Senior/Supervisor).');
    window.location.href = context.dashboardPath || '/pages/dashboard.html';
    return false;
  }
  return true;
}

function authHeaders(extra = {}) {
  return {
    ...AuthService.getAuthHeaders(),
    ...extra,
  };
}

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: authHeaders(options.headers || {}),
  });
  if (response.status === 401) {
    AuthService.clearAuth();
    window.location.href = '/index.html';
    throw new Error('Session expired. Please sign in again.');
  }
  if (response.status === 403) {
    throw new Error('You do not have permission to view Inventory Command Center data.');
  }
  return response;
}

async function readJson(path) {
  const response = await request(path);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || `Request failed (${response.status})`);
  return payload;
}

async function postJson(path, body = {}) {
  const response = await request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || `Request failed (${response.status})`);
  return payload;
}

async function sendJson(path, body = {}, method = 'POST') {
  const response = await request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || `Request failed (${response.status})`);
  return payload;
}

function escapeHtml(value) {
  return UI.escapeHTML(String(value ?? ''));
}

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatCount(value) {
  return numberValue(value).toLocaleString();
}

function formatCurrency(value) {
  if (value === null || typeof value === 'undefined' || String(value).trim() === '') return 'Cost data missing';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Cost data missing';
  return new Intl.NumberFormat('en-EG', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDateTime(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString();
}

function timeAgo(value) {
  if (!value) return 'not updated yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'not updated yet';
  const diffSeconds = Math.max(0, Math.round((Date.now() - parsed.getTime()) / 1000));
  if (diffSeconds < 45) return 'just now';
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  return parsed.toLocaleString();
}

function autoRefreshEnabled() {
  return String(localStorage.getItem(AUTO_REFRESH_PREF_KEY) || 'true').toLowerCase() !== 'false';
}

function shouldPauseAutoRefresh() {
  if (document.visibilityState === 'hidden') return true;
  if (document.querySelector('.modal.show')) return true;
  if (document.getElementById('inventoryAiChatPanel')?.classList.contains('is-open')) return true;
  const active = document.activeElement;
  if (!active) return false;
  const tag = String(active.tagName || '').toLowerCase();
  return ['input', 'textarea', 'select'].includes(tag) || active.isContentEditable;
}

function updateFreshnessStatus(status = 'ready', message = '') {
  const text = document.getElementById('iccLoadStatus');
  const dot = document.getElementById('iccLoadDot');
  if (dot) {
    dot.classList.remove('ready', 'loading', 'error', 'stale');
    dot.classList.add(status === 'error' ? 'error' : (status === 'refreshing' ? 'loading' : 'ready'));
  }
  if (!text) return;
  if (status === 'refreshing') {
    text.textContent = message || 'Refreshing...';
    return;
  }
  if (status === 'error') {
    text.textContent = message || `Failed to refresh. Last updated ${timeAgo(state.loadedAt)}.`;
    return;
  }
  const autoText = autoRefreshEnabled() ? `Auto-refreshes every ${AUTO_REFRESH_INTERVAL_MS / 1000}s` : 'Auto-refresh paused';
  text.textContent = message || `Updated ${timeAgo(state.loadedAt)}. ${autoText}.`;
}

function toTitle(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Unknown';
}

function readSpecs(asset = {}) {
  const specs = asset.specifications;
  if (specs && typeof specs === 'object' && !Array.isArray(specs)) return specs;
  return {};
}

function displayLocation(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Unassigned';
  const map = {
    CENTRAL_WAREHOUSE: 'Central Warehouse',
    MAIN_BUILDING: 'Main Building',
    K_BUILDING: 'K Building',
    N_BUILDING: 'N Building',
    S_BUILDING: 'S Building',
    R_BUILDING: 'R Building',
    PHARMACY_BUILDING: 'Pharmacy Building',
    COPY_CENTER: 'Copy Center',
    MOSQUE: 'Mosque',
    WORKSHOP: 'Workshop',
  };
  const upper = raw.toUpperCase().replace(/\s+/g, '_');
  return map[upper] || toTitle(raw);
}

function displayDepartment(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Unassigned';
  const key = normalize(raw);
  const map = {
    computerscience: 'Computer Science',
    cs: 'Computer Science',
    business: 'Business',
    businessadministration: 'Business',
    masscommunication: 'Mass Communication',
    masscomm: 'Mass Communication',
    pharmacy: 'Pharmacy',
    dentistry: 'Dentistry',
    engineering: 'Engineering',
    architecture: 'Architecture',
    alsun: 'ALSUN',
    alalsun: 'ALSUN',
    languages: 'ALSUN',
    unassigned: 'Unassigned',
    unknown: 'Unassigned',
  };
  return map[key] || toTitle(raw);
}

function getAssetId(asset = {}) {
  return String(asset.customId || asset.assetTag || asset.id || '').trim();
}

function assetCategory(asset = {}) {
  return String(asset.category || '').trim().toLowerCase();
}

function assetName(asset = {}) {
  return String(asset.name || asset.assetName || getAssetId(asset) || 'Unnamed asset').trim();
}

function hasValue(value) {
  return String(value ?? '').trim() !== '';
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function readPriorityState() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(PRIORITY_STATE_KEY) || '{}');
    if (parsed?.date === todayKey() && parsed.handled && typeof parsed.handled === 'object') return parsed;
  } catch (_) {
    // Ignore malformed session storage and start a clean daily state.
  }
  return { date: todayKey(), handled: {} };
}

function writePriorityState(nextState) {
  state.priorityState = nextState || { date: todayKey(), handled: {} };
  sessionStorage.setItem(PRIORITY_STATE_KEY, JSON.stringify(state.priorityState));
}

function ensurePriorityState() {
  if (!state.priorityState || state.priorityState.date !== todayKey()) writePriorityState(readPriorityState());
  return state.priorityState;
}

function priorityId(row = {}) {
  return String(row.id || normalize(row.title || '') || 'priority').trim();
}

function priorityHandledRecord(row = {}) {
  const store = ensurePriorityState();
  return store.handled?.[priorityId(row)] || null;
}

function isPriorityHandled(row = {}) {
  return Boolean(priorityHandledRecord(row));
}

function isPriorityIssue(row = {}) {
  return numberValue(row.count) > 0 || ['critical', 'urgent', 'high', 'medium', 'review'].includes(normalize(row.severity));
}

function readablePriorityReason(reason = '') {
  return toTitle(String(reason || '').replace(/_/g, ' '));
}

function getWarrantyEnd(asset = {}) {
  const specs = readSpecs(asset);
  return asset.warrantyEndDate || specs.warrantyEndDate || specs.warrantyEnd || null;
}

function getPurchaseDate(asset = {}) {
  const specs = readSpecs(asset);
  return asset.purchaseDate || specs.purchaseDate || specs.acquiredAt || null;
}

function getPurchaseCost(asset = {}) {
  const specs = readSpecs(asset);
  return asset.purchaseCost ?? specs.purchaseCost ?? specs.purchase_cost ?? specs.replacementCost ?? null;
}

function getTelemetryInfo(asset = {}) {
  const specs = readSpecs(asset);
  const configured = Boolean(
    asset.telemetryEnabledDerived
    || asset.telemetryCapableDerived
    || specs.telemetryEnabled
    || specs.telemetryApplicable
    || specs.lastSeenAt
    || specs.wifiLastSeenAt
    || specs.mockWifiLastSeenAt
  );
  const rawLastSeen = specs.lastSeenAt || specs.wifiLastSeenAt || specs.mockWifiLastSeenAt || specs.lastNetworkSeenAt || null;
  const lastSeen = rawLastSeen ? new Date(rawLastSeen) : null;
  const validLastSeen = lastSeen && !Number.isNaN(lastSeen.getTime()) ? lastSeen : null;
  const ageHours = validLastSeen ? (Date.now() - validLastSeen.getTime()) / 3600000 : null;
  const source = specs.telemetrySource || specs.wifiSource || specs.mockWifiSource || (configured ? 'manual/demo' : 'none');
  let stateLabel = 'Unknown';
  if (!configured) stateLabel = 'Not telemetry-enabled';
  else if (ageHours === null) stateLabel = 'Unknown';
  else if (ageHours <= 2) stateLabel = 'Recently Seen';
  else stateLabel = 'Stale';
  return {
    configured,
    lastSeen: validLastSeen,
    ageHours,
    source,
    stateLabel,
    stale: configured && (ageHours === null || ageHours > 24),
  };
}

function getLifecycleKey(asset = {}) {
  return normalize(asset.lifecycleStatus || asset.status || '');
}

function isNearEol(asset = {}) {
  const lifecycle = getLifecycleKey(asset);
  if (lifecycle.includes('eol') || lifecycle.includes('retired') || lifecycle.includes('disposed')) return true;
  const warrantyEnd = getWarrantyEnd(asset);
  if (!warrantyEnd) return false;
  const parsed = new Date(warrantyEnd);
  if (Number.isNaN(parsed.getTime())) return false;
  const days = (parsed.getTime() - Date.now()) / 86400000;
  return days <= 180;
}

function isLowStockAsset(asset = {}) {
  const specs = readSpecs(asset);
  const category = assetCategory(asset);
  if (!['spare_stock', 'spare_part', 'consumable', 'accessory', 'component'].includes(category)) return false;
  const quantity = Number(asset.quantityAvailable ?? asset.quantity ?? specs.quantityAvailable ?? specs.quantity ?? specs.availableQuantity);
  const threshold = Number(asset.reorderPoint ?? asset.minimumStockLevel ?? specs.reorderPoint ?? specs.minimumStockLevel ?? specs.minStock);
  return Number.isFinite(quantity) && Number.isFinite(threshold) && threshold > 0 && quantity <= threshold;
}

function missingDataForAsset(asset = {}) {
  const missing = [];
  if (!hasValue(asset.serialNumber) && !hasValue(readSpecs(asset).serialNumber)) missing.push('serial');
  if (!hasValue(asset.department) || displayDepartment(asset.department) === 'Unassigned') missing.push('department');
  if (!hasValue(asset.location) || displayLocation(asset.location) === 'Unassigned') missing.push('location');
  if (!hasValue(getPurchaseDate(asset))) missing.push('purchase date');
  if (!hasValue(getWarrantyEnd(asset))) missing.push('warranty');
  if (!hasValue(getPurchaseCost(asset))) missing.push('purchase cost');
  return missing;
}

function severityClass(severity) {
  const key = normalize(severity);
  if (['critical', 'urgent', 'high', 'danger', 'red'].includes(key)) return 'is-urgent';
  if (['medium', 'warning', 'review', 'yellow'].includes(key)) return 'is-review';
  if (['success', 'healthy', 'good', 'green'].includes(key)) return 'is-healthy';
  if (['neutral', 'unknown', 'missing', 'gray', 'grey'].includes(key)) return 'is-neutral';
  return 'is-info';
}

function technicalSourceLabel(row = {}) {
  const raw = row.sourceLabel || row.source || row.aiSource || row.recommendationSource || '';
  const key = normalize(raw);
  if (key.includes('gemma')) return 'Gemma';
  if (key.includes('hybrid')) return 'Hybrid';
  if (key.includes('fallback')) return 'Fallback';
  if ((key.includes('ai') || key.includes('plus')) && key.includes('deterministic')) return 'Hybrid';
  if (key.includes('deterministic') || key.includes('rule')) return 'Deterministic';
  return raw ? toTitle(raw) : 'Deterministic';
}

function sourceLabel(row = {}) {
  const technical = technicalSourceLabel(row);
  if (technical === 'Gemma') return 'AI insight';
  if (technical === 'Hybrid') return 'Estimated';
  return 'System data';
}

function sourceInfoIcon(row = {}) {
  const technical = technicalSourceLabel(row);
  return `<span class="ops-source-info" title="Internal source: ${escapeHtml(technical)}" aria-label="Internal source: ${escapeHtml(technical)}"><i class="bi bi-info-circle"></i></span>`;
}

async function fetchAllAssets() {
  const all = [];
  for (let page = 1; page <= MAX_ASSET_PAGES; page += 1) {
    const payload = await readJson(`/assets?paginate=true&page=${page}&pageSize=${PAGE_SIZE}`);
    const items = Array.isArray(payload) ? payload : asArray(payload?.items);
    all.push(...items);
    const totalPages = numberValue(payload?.totalPages, 1);
    if (!items.length || page >= totalPages) break;
  }
  return all;
}

function isThisMonth(value) {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const now = new Date();
  return parsed.getFullYear() === now.getFullYear() && parsed.getMonth() === now.getMonth();
}

function countDuplicateValues(values) {
  const counts = new Map();
  values.forEach((value) => {
    const key = normalize(value);
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Array.from(counts.values()).filter((count) => count > 1).length;
}

function buildSummary() {
  const assets = state.assets;
  const board = state.board || {};
  const audit = state.audit || {};
  const executive = state.executive || {};
  const smartAlerts = state.smartAlerts || {};
  const alertRows = asArray(smartAlerts.alerts);
  const requests = asArray(board.requests);
  const recommendations = asArray(board.aiRecommendations);
  const priorities = board.priorities || {};
  const analytics = board.analytics || {};
  const statusCounts = board.statusCounts || {};
  const auditCounts = audit.counts || {};
  const highRiskAssets = asArray(priorities.highRiskAssets);
  const urgentReplacements = asArray(priorities.urgentReplacements);
  const lowStockItems = asArray(priorities.lowStockItems);
  const unreviewedRecommendations = recommendations.filter((row) => normalize(row.reviewStatus || 'new') === 'new');
  const openRequests = requests.filter((row) => !['received', 'closed', 'cancelled', 'rejected'].includes(normalize(row.status)));
  const pendingApprovals = numberValue(statusCounts.Submitted) + numberValue(statusCounts['Under Review']);
  const openPurchaseOrders = numberValue(analytics.openPurchaseOrders);
  const orderedOrTransit = requests.filter((row) => ['ordered', 'partiallyreceived'].includes(normalize(row.status))).length;
  const receivedThisMonth = requests.filter((row) => ['received', 'closed'].includes(normalize(row.status)) && isThisMonth(row.updatedAt || row.createdAt)).length;
  const missingDataRows = assets.map((asset) => ({ asset, missing: missingDataForAsset(asset) })).filter((row) => row.missing.length);
  const staleTelemetryRows = assets.filter((asset) => getTelemetryInfo(asset).stale);
  const nearEolRows = assets.filter((asset) => isNearEol(asset));
  const duplicateTags = countDuplicateValues(assets.map((asset) => asset.assetTag || asset.customId).filter(Boolean));
  const unlinkedRelated = assets.filter((asset) => {
    const category = assetCategory(asset);
    if (!['component', 'accessory', 'license'].includes(category)) return false;
    const specs = readSpecs(asset);
    return !hasValue(asset.parentAssetId) && !hasValue(asset.parentAssetTag) && !hasValue(specs.parentAssetTag) && !hasValue(asset.parentAsset?.customId);
  }).length;
  const financeTotals = analytics.finance?.totals || {};
  const budgetWarnings = numberValue(financeTotals.available) < 0 ? 1 : 0;
  const totalQualityChecks = Math.max(1, assets.length * 6);
  const missingQualityChecks = missingDataRows.reduce((sum, row) => sum + row.missing.length, 0) + duplicateTags + unlinkedRelated;
  const dataQualityScore = Math.max(0, Math.min(100, Math.round(100 - ((missingQualityChecks / totalQualityChecks) * 100))));

  return {
    totalAssets: assets.length,
    highRiskCount: numberValue(executive.highRisk, highRiskAssets.length),
    eolSoonCount: numberValue(executive.nearEol, urgentReplacements.length || nearEolRows.length),
    missingDataCount: missingDataRows.length,
    staleTelemetryCount: staleTelemetryRows.length,
    auditIssueCount: numberValue(auditCounts.needsVerification) + numberValue(auditCounts.missing) + numberValue(auditCounts.staleVerification) + numberValue(auditCounts.locationMismatch),
    lowStockCount: lowStockItems.length || numberValue(executive.lowStock),
    pendingApprovals,
    openPurchaseOrders,
    orderedOrTransit,
    receivedThisMonth,
    monthlySpend: numberValue(analytics.monthlySpendingEstimate, NaN),
    budgetWarnings,
    unreviewedRecommendationCount: unreviewedRecommendations.length,
    openRequests: openRequests.length,
    requests,
    recommendations,
    priorities,
    analytics,
    auditRows: asArray(audit.assetsNeedingAttention),
    smartAlerts: alertRows,
    openSmartAlertCount: alertRows.filter((row) => normalize(row.status || 'open') === 'open').length,
    smartAlertRules: asArray(state.alertRules?.rules),
    missingDataRows,
    staleTelemetryRows,
    nearEolRows,
    duplicateTags,
    unlinkedRelated,
    dataQualityScore,
    executive,
  };
}

function setLoading(loading, message = '') {
  const dot = document.getElementById('iccLoadDot');
  if (dot) {
    dot.classList.remove('ready', 'loading', 'error');
    dot.classList.add(loading ? 'loading' : 'ready');
  }
  if (loading) updateFreshnessStatus('refreshing', message || 'Loading Inventory Command Center...');
  else updateFreshnessStatus('ready', message);
}

function setError(message) {
  const dot = document.getElementById('iccLoadDot');
  if (dot) {
    dot.classList.remove('ready', 'loading');
    dot.classList.add('error');
  }
  updateFreshnessStatus('error', message || 'Command Center loaded with partial data.');
}

function emptyState(title, copy) {
  return `
    <div class="ops-empty-state-card">
      <div>
        <div class="ops-empty-state-title">${escapeHtml(title)}</div>
        <div class="ops-empty-state-copy">${escapeHtml(copy)}</div>
      </div>
    </div>
  `;
}

function evidencePanel({ title = 'Evidence used', source = 'Deterministic', confidence = 'Medium', evidence = [], missingData = [], action = '' } = {}) {
  const evidenceRows = asArray(evidence).filter(Boolean);
  const missingRows = asArray(missingData).filter(Boolean);
  const publicSource = sourceLabel({ source });
  return `
    <details class="icc-evidence-panel">
      <summary>
        <span>${escapeHtml(title)}</span>
        <span class="ops-attention-pill is-info">${escapeHtml(publicSource)}${sourceInfoIcon({ source })}</span>
      </summary>
      <div class="icc-evidence-body">
        <div class="icc-evidence-grid">
          <div>
            <strong>Source</strong>
            <span>${escapeHtml(publicSource)}${sourceInfoIcon({ source })}</span>
          </div>
          <div>
            <strong>Evidence confidence</strong>
            <span>${escapeHtml(confidence)}</span>
          </div>
        </div>
        ${evidenceRows.length ? `
          <ul class="icc-evidence-list">
            ${evidenceRows.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        ` : '<div class="icc-evidence-muted">No additional evidence text was available.</div>'}
        ${missingRows.length ? `
          <div class="icc-evidence-missing">
            <strong>Missing data</strong>
            <span>${escapeHtml(missingRows.join(', '))}</span>
          </div>
        ` : ''}
        ${action ? `<div class="icc-evidence-action">${escapeHtml(action)}</div>` : ''}
      </div>
    </details>
  `;
}

function renderSkeletons() {
  const skeletonGrid = '<div class="ops-skeleton-card"></div><div class="ops-skeleton-card"></div><div class="ops-skeleton-card"></div>';
  [
    'iccDailyBriefing',
    'iccTodaysMission',
    'iccPrioritiesGrid',
    'iccInventoryHealthGrid',
    'iccProcurementGrid',
    'iccStockIntelligence',
    'iccAiRecommendations',
    'iccAttentionCenter',
    'iccRiskHeatmap',
    'iccDataQuality',
    'iccRecentActivity',
    'iccBudgetPlanning',
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = skeletonGrid;
  });
}

function buildPriorityEvidence(summary) {
  const rows = [
    {
      id: 'low-stock',
      title: 'Low stock items',
      count: summary.lowStockCount,
      severity: summary.lowStockCount ? 'High' : 'Healthy',
      explanation: 'Items at or below reorder thresholds.',
      evidence: ['Procurement board low-stock priorities', `${summary.lowStockCount} low-stock item(s) detected`],
      missingData: summary.lowStockCount ? [] : ['No current shortage evidence'],
      action: 'Open Procurement',
      actionAttr: 'data-icc-action="procurement"',
      icon: 'bi-box-seam',
    },
    {
      id: 'eol-risk',
      title: 'EOL / high-risk assets',
      count: summary.eolSoonCount + summary.highRiskCount,
      severity: summary.eolSoonCount + summary.highRiskCount ? 'High' : 'Healthy',
      explanation: 'Assets needing lifecycle or replacement review.',
      evidence: [`${summary.eolSoonCount} near-EOL signal(s)`, `${summary.highRiskCount} high-risk asset(s)`],
      missingData: ['Replacement cost improves forecast precision'],
      action: 'Ask AI',
      actionAttr: 'data-icc-ai-prompt="Which assets are near EOL or high risk?"',
      icon: 'bi-shield-exclamation',
    },
    {
      id: 'pending-approvals',
      title: 'Pending approvals',
      count: summary.pendingApprovals,
      severity: summary.pendingApprovals ? 'Medium' : 'Healthy',
      explanation: 'Submitted or under-review procurement requests.',
      evidence: ['Procurement request status counts', `${summary.pendingApprovals} request(s) waiting for decision`],
      action: 'Open Procurement',
      actionAttr: 'data-icc-action="procurement"',
      icon: 'bi-person-check',
    },
    {
      id: 'open-orders',
      title: 'Open POs / in transit',
      count: summary.openPurchaseOrders + summary.orderedOrTransit,
      severity: summary.openPurchaseOrders + summary.orderedOrTransit ? 'Medium' : 'Info',
      explanation: 'Ordered or partially received procurement work.',
      evidence: [`${summary.openPurchaseOrders} open PO(s)`, `${summary.orderedOrTransit} ordered/partially received request(s)`],
      action: 'Open POs',
      actionAttr: 'data-icc-action="procurement"',
      icon: 'bi-truck',
    },
    {
      id: 'missing-data',
      title: 'Missing data',
      count: summary.missingDataCount,
      severity: summary.missingDataCount ? 'Medium' : 'Healthy',
      explanation: 'Records missing serial, department, location, purchase date, or warranty.',
      evidence: [`${summary.missingDataCount} asset record(s) missing key fields`, `Data quality score ${summary.dataQualityScore}%`],
      missingData: ['Serials', 'department/location', 'purchase date', 'warranty when absent'],
      action: 'Fix now',
      actionAttr: 'data-icc-quality-fix="all"',
      icon: 'bi-database-exclamation',
    },
    {
      id: 'stale-telemetry',
      title: 'Stale telemetry',
      count: summary.staleTelemetryCount,
      severity: summary.staleTelemetryCount ? 'Medium' : 'Healthy',
      explanation: 'Telemetry-enabled assets without recent evidence.',
      evidence: [`${summary.staleTelemetryCount} telemetry-capable asset(s) stale or unknown`],
      missingData: ['Fresh last-seen telemetry improves confidence'],
      action: 'Ask AI',
      actionAttr: 'data-icc-ai-prompt="Which telemetry assets are stale or unknown?"',
      icon: 'bi-wifi-off',
    },
    {
      id: 'ai-recommendations',
      title: 'Unreviewed AI recommendations',
      count: summary.unreviewedRecommendationCount,
      severity: summary.unreviewedRecommendationCount ? 'Medium' : 'Healthy',
      explanation: 'Procurement recommendations waiting for review.',
      evidence: [`${summary.unreviewedRecommendationCount} recommendation(s) with NEW review status`],
      action: 'Review',
      actionAttr: 'data-icc-action="procurement"',
      icon: 'bi-stars',
    },
  ];
  return rows;
}

function priorityControls(row = {}) {
  if (!isPriorityIssue(row)) return '';
  const id = priorityId(row);
  return `
    <div class="icc-priority-controls" aria-label="Priority handling controls">
      <button type="button" class="btn btn-sm btn-outline-success" data-icc-priority-done="${escapeHtml(id)}">
        <i class="bi bi-check2-circle me-1"></i>Done
      </button>
      <button type="button" class="btn btn-sm btn-outline-secondary" data-icc-priority-dismiss="${escapeHtml(id)}">
        <i class="bi bi-x-circle me-1"></i>Dismiss
      </button>
    </div>
  `;
}

function handledPriorityList(rows = []) {
  const handled = rows.filter((row) => isPriorityHandled(row));
  if (!handled.length) return '';
  return `
    <details class="icc-handled-priorities">
      <summary>
        <span>Handled today</span>
        <strong>${escapeHtml(String(handled.length))}</strong>
      </summary>
      <div class="icc-handled-list">
        ${handled.map((row) => {
          const record = priorityHandledRecord(row) || {};
          return `
            <article class="icc-handled-item">
              <div>
                <strong>${escapeHtml(row.title)}</strong>
                <span>${escapeHtml(readablePriorityReason(record.reason || record.status || 'handled'))}${record.note ? ` - ${escapeHtml(record.note)}` : ''}</span>
              </div>
              <button type="button" class="btn btn-sm btn-outline-secondary" data-icc-priority-restore="${escapeHtml(priorityId(row))}">Restore</button>
            </article>
          `;
        }).join('')}
      </div>
    </details>
  `;
}

function priorityCard({ id = '', title, count, severity, explanation, actionAttr, action, evidence = [], missingData = [], icon = 'bi-exclamation-circle' }) {
  const row = { id, title, count, severity, explanation, actionAttr, action, evidence, missingData, icon };
  return `
    <article class="icc-priority-card ${severityClass(severity)}">
      <div class="icc-card-icon"><i class="bi ${escapeHtml(icon)}"></i></div>
      <div class="icc-card-main">
        <div class="icc-card-title">${escapeHtml(title)}</div>
        <div class="icc-card-count">${escapeHtml(formatCount(count))}</div>
        <p>${escapeHtml(explanation)}</p>
      </div>
      ${evidencePanel({
        title: 'Why this matters',
        source: 'Deterministic evidence',
        confidence: count ? 'Medium' : 'High',
        evidence,
        missingData,
        action: explanation,
      })}
      ${actionAttr ? `<button type="button" class="btn btn-sm btn-outline-primary" ${actionAttr}>${escapeHtml(action || 'Open')}</button>` : ''}
      ${priorityControls(row)}
    </article>
  `;
}

function kpiCard(label, value, sub, severity = 'info', help = '') {
  return `
    <div class="icc-kpi-card ${severityClass(severity)}" ${help ? `title="${escapeHtml(help)}"` : ''}>
      <div class="icc-kpi-label">${escapeHtml(label)}</div>
      <div class="icc-kpi-value">${escapeHtml(String(value))}</div>
      <div class="icc-kpi-sub">${escapeHtml(sub)}</div>
    </div>
  `;
}

function renderPriorities(summary) {
  const rows = buildPriorityEvidence(summary);
  const activeRows = rows.filter((row) => !isPriorityHandled(row));
  document.getElementById('iccPrioritiesGrid').innerHTML = `
    ${activeRows.map(priorityCard).join('')}
    ${handledPriorityList(rows)}
  `;
}

function missionCard(row = {}) {
  const count = numberValue(row.count);
  const hasIssue = count > 0 || ['high', 'medium', 'critical', 'urgent'].includes(normalize(row.severity));
  return `
    <article class="icc-mission-card ${severityClass(row.severity)}">
      <div class="icc-mission-icon" aria-hidden="true"><i class="bi ${escapeHtml(row.icon || 'bi-bullseye')}"></i></div>
      <div class="icc-mission-body">
        <div class="icc-mission-kicker">${escapeHtml(hasIssue ? String(row.severity || 'Review') : 'Healthy')}</div>
        <h3>${escapeHtml(row.title || 'Inventory mission')}</h3>
        <p>${escapeHtml(row.explanation || 'Review the evidence before taking action.')}</p>
        <div class="icc-mission-evidence">${escapeHtml(asArray(row.evidence).filter(Boolean).slice(0, 2).join(' | ') || 'Evidence is loaded from Inventory and Procurement data.')}</div>
      </div>
      <div class="icc-mission-action">
        <strong>${escapeHtml(formatCount(row.count))}</strong>
        ${row.actionAttr ? `<button type="button" class="btn btn-sm btn-outline-primary" ${row.actionAttr}>${escapeHtml(row.action || 'Open')}</button>` : ''}
        ${priorityControls(row)}
      </div>
    </article>
  `;
}

function renderTodaysMission(summary) {
  const el = document.getElementById('iccTodaysMission');
  if (!el) return;
  const rows = buildPriorityEvidence(summary)
    .filter((row) => !isPriorityHandled(row))
    .filter((row) => numberValue(row.count) > 0 || ['high', 'medium'].includes(normalize(row.severity)))
    .sort((a, b) => {
      const weight = { high: 40, critical: 40, medium: 25, review: 20, info: 10, healthy: 0 };
      return (weight[normalize(b.severity)] || 0) - (weight[normalize(a.severity)] || 0)
        || numberValue(b.count) - numberValue(a.count);
    })
    .slice(0, 3);

  if (!rows.length) {
    el.innerHTML = `
      <article class="icc-mission-card is-healthy">
        <div class="icc-mission-icon" aria-hidden="true"><i class="bi bi-check2-circle"></i></div>
        <div class="icc-mission-body">
          <div class="icc-mission-kicker">Healthy</div>
          <h3>No urgent inventory mission right now</h3>
          <p>OpsMind did not detect critical low-stock, EOL, approval, audit, budget, or data-quality blockers from the loaded evidence.</p>
          <div class="icc-mission-evidence">Keep monitoring telemetry, imports, and procurement approvals.</div>
        </div>
        <div class="icc-mission-action">
          <strong>0</strong>
          <button type="button" class="btn btn-sm btn-outline-primary" data-icc-action="assets">Open Assets</button>
        </div>
      </article>
    `;
    return;
  }

  el.innerHTML = rows.map(missionCard).join('');
}

function buildBriefingEvidencePacket(summary) {
  const priorities = buildPriorityEvidence(summary)
    .filter((row) => numberValue(row.count) > 0 || ['High', 'Medium'].includes(String(row.severity || '')))
    .sort((a, b) => {
      const weight = { high: 3, medium: 2, healthy: 1, info: 1 };
      return (weight[normalize(a.severity)] || 1) - (weight[normalize(b.severity)] || 1);
    })
    .reverse()
    .slice(0, 5);
  const missingData = [];
  if (!Number.isFinite(summary.monthlySpend)) missingData.push('monthly spend estimate');
  if (!summary.analytics?.finance?.totals) missingData.push('finance allocation totals');
  if (summary.missingDataCount) missingData.push('complete asset serial/location/department/warranty fields');
  if (summary.staleTelemetryCount) missingData.push('fresh telemetry readings');
  return {
    generatedAt: new Date().toISOString(),
    sourceCounts: {
      totalAssets: summary.totalAssets,
      lowStock: summary.lowStockCount,
      highRisk: summary.highRiskCount,
      eolSoon: summary.eolSoonCount,
      missingData: summary.missingDataCount,
      staleTelemetry: summary.staleTelemetryCount,
      pendingApprovals: summary.pendingApprovals,
      openPurchaseOrders: summary.openPurchaseOrders,
      unreviewedRecommendations: summary.unreviewedRecommendationCount,
      auditIssues: summary.auditIssueCount,
      dataQualityScore: summary.dataQualityScore,
    },
    topPriorities: priorities.map((row) => ({
      title: row.title,
      count: row.count,
      severity: row.severity,
      evidence: row.evidence,
      action: row.action,
    })),
    missingData: Array.from(new Set(missingData)),
  };
}

function deterministicBriefingText(packet) {
  const priorities = asArray(packet.topPriorities);
  if (!priorities.length) {
    return 'Inventory and procurement look stable from the currently loaded evidence. Keep an eye on data quality, telemetry freshness, and any new procurement approvals that appear during the day.';
  }
  const lead = priorities.slice(0, 3).map((row) => `${row.count} ${row.title.toLowerCase()}`).join(', ');
  return `Here are the inventory/procurement issues that need attention today: ${lead}. Review the evidence below before taking action.`;
}

function renderDailyBriefingCard({ text, packet, source = 'Deterministic', fallbackReason = '', llmUsed = false } = {}) {
  const el = document.getElementById('iccDailyBriefing');
  const sourceEl = document.getElementById('iccDailyBriefingSource');
  if (!el) return;
  const topPriorities = asArray(packet?.topPriorities).slice(0, 5);
  const sourceText = sourceLabel({ source: llmUsed ? 'Gemma' : source, llmUsed });
  if (sourceEl) {
    sourceEl.innerHTML = `${escapeHtml(sourceText)}${sourceInfoIcon({ source: llmUsed ? 'Gemma' : source, llmUsed })}`;
    sourceEl.className = `ops-attention-pill ${llmUsed ? 'is-healthy' : (source === 'Fallback' ? 'is-review' : 'is-info')}`;
  }
  el.innerHTML = `
    <div class="icc-briefing-head">
      <div class="icc-briefing-mark" aria-hidden="true"><i class="bi bi-stars"></i></div>
      <div>
        <div class="icc-briefing-kicker">Daily operations briefing</div>
        <h3>${escapeHtml(llmUsed ? 'AI insight summarized today\'s inventory evidence' : 'System briefing from loaded evidence')}</h3>
      </div>
    </div>
    <p class="icc-briefing-copy">${escapeHtml(text || deterministicBriefingText(packet || {}))}</p>
    ${fallbackReason ? `<div class="icc-phase-note">${escapeHtml(fallbackReason)}</div>` : ''}
    <div class="icc-briefing-priority-list">
      ${topPriorities.length ? topPriorities.map((row) => `
        <article class="icc-briefing-priority ${severityClass(row.severity)}">
          <span class="ops-attention-pill ${severityClass(row.severity)}">${escapeHtml(row.severity || 'Info')}</span>
          <strong>${escapeHtml(row.title)}</strong>
          <span>${escapeHtml(formatCount(row.count))}</span>
          <small>${escapeHtml(asArray(row.evidence).join(' | ') || 'Inventory evidence')}</small>
        </article>
      `).join('') : emptyState('No urgent issues', 'No critical procurement, stock, telemetry, or EOL alerts are present in the loaded evidence.')}
    </div>
    ${evidencePanel({
      title: 'Briefing evidence',
      source: sourceText,
      confidence: packet?.missingData?.length ? 'Medium' : 'High',
      evidence: [
        `Assets scanned: ${packet?.sourceCounts?.totalAssets ?? 0}`,
        `Low stock: ${packet?.sourceCounts?.lowStock ?? 0}`,
        `High risk: ${packet?.sourceCounts?.highRisk ?? 0}`,
        `Pending approvals: ${packet?.sourceCounts?.pendingApprovals ?? 0}`,
        `Data quality score: ${packet?.sourceCounts?.dataQualityScore ?? '-'}%`,
      ],
      missingData: packet?.missingData || [],
      action: 'Use the linked actions to review details. OpsMind will not create or approve records without your confirmation.',
    })}
    <div class="icc-chip-row mt-3">
      <button type="button" class="btn btn-sm btn-primary" data-icc-action="procurement">Open Procurement</button>
      <button type="button" class="btn btn-sm btn-outline-primary" data-icc-ai-prompt="What needs attention today?">Ask Copilot</button>
      <button type="button" class="btn btn-sm btn-outline-secondary" data-icc-action="assets">Open Assets</button>
    </div>
  `;
}

function renderDailyBriefingLoading() {
  const el = document.getElementById('iccDailyBriefing');
  const sourceEl = document.getElementById('iccDailyBriefingSource');
  if (sourceEl) {
    sourceEl.textContent = 'Checking evidence';
    sourceEl.className = 'ops-attention-pill is-info';
  }
  if (el) {
    el.innerHTML = `
      <div class="icc-briefing-thinking">
        <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
        <div>
          <strong>AI insight is preparing your briefing...</strong>
          <span>First local-model response can take a little longer. Facts are already gathered from Inventory and Procurement data.</span>
        </div>
      </div>
    `;
  }
}

async function renderDailyBriefing(summary) {
  const requestId = state.briefingRequestId + 1;
  state.briefingRequestId = requestId;
  const packet = buildBriefingEvidencePacket(summary);
  renderDailyBriefingLoading();

  try {
    const result = await postJson('/inventory/ai/daily-brief', {
      source: 'inventory_command_center',
      evidencePacket: packet,
      query: 'Create a concise daily inventory/procurement briefing from this evidence. Do not invent facts.',
    });
    if (requestId !== state.briefingRequestId) return;
    const text = String(result?.summary || result?.briefing || result?.answer || '').trim();
    const llmUsed = Boolean(result?.llmUsed);
    renderDailyBriefingCard({
      text: text || deterministicBriefingText(packet),
      packet,
      source: result?.fallbackUsed ? 'Fallback' : (llmUsed ? 'Gemma' : 'Deterministic'),
      fallbackReason: result?.fallbackUsed ? `System data used: ${String(result?.fallbackReason || 'AI insight was unavailable for this request.').replace(/_/g, ' ')}` : '',
      llmUsed,
    });
  } catch (error) {
    if (requestId !== state.briefingRequestId) return;
    renderDailyBriefingCard({
      text: deterministicBriefingText(packet),
      packet,
      source: 'Fallback',
      fallbackReason: `System data used: ${error.message || 'Inventory AI briefing endpoint was unavailable.'}`,
      llmUsed: false,
    });
  }
}

function renderHealth(summary) {
  document.getElementById('iccInventoryHealthGrid').innerHTML = [
    kpiCard('Total assets', formatCount(summary.totalAssets), 'All loaded inventory records', 'info'),
    kpiCard('High-risk assets', formatCount(summary.highRiskCount), 'Risk score critical/high', summary.highRiskCount ? 'high' : 'healthy'),
    kpiCard('EOL soon', formatCount(summary.eolSoonCount), 'Lifecycle or warranty evidence', summary.eolSoonCount ? 'medium' : 'healthy'),
    kpiCard('Missing data', formatCount(summary.missingDataCount), 'Weakens CMDB and AI confidence', summary.missingDataCount ? 'medium' : 'healthy'),
    kpiCard('Stale/offline telemetry', formatCount(summary.staleTelemetryCount), 'No fresh telemetry evidence', summary.staleTelemetryCount ? 'medium' : 'healthy'),
    kpiCard('Audit issues', formatCount(summary.auditIssueCount), 'Missing, stale, or mismatch audit signals', summary.auditIssueCount ? 'high' : 'healthy'),
  ].join('');

  const warrantyBuckets = { 30: 0, 60: 0, 90: 0 };
  state.assets.forEach((asset) => {
    const end = getWarrantyEnd(asset);
    if (!end) return;
    const parsed = new Date(end);
    if (Number.isNaN(parsed.getTime())) return;
    const days = (parsed.getTime() - Date.now()) / 86400000;
    if (days >= 0 && days <= 30) warrantyBuckets[30] += 1;
    if (days >= 0 && days <= 60) warrantyBuckets[60] += 1;
    if (days >= 0 && days <= 90) warrantyBuckets[90] += 1;
  });
  const warrantySummary = document.getElementById('iccWarrantySummary');
  if (warrantySummary) {
    warrantySummary.innerHTML = `
      <span>Warranty expiry view from stored asset warranty dates. Contract renewal workflow remains Phase 2 unless stored contract data exists.</span>
      <span class="icc-warranty-buckets" aria-label="Warranty expiry windows">
        <strong>30d: ${escapeHtml(String(warrantyBuckets[30]))}</strong>
        <strong>60d: ${escapeHtml(String(warrantyBuckets[60]))}</strong>
        <strong>90d: ${escapeHtml(String(warrantyBuckets[90]))}</strong>
      </span>
    `;
  }
}

function renderProcurement(summary) {
  const financeAvailable = summary.analytics?.finance?.totals?.available;
  document.getElementById('iccProcurementGrid').innerHTML = [
    kpiCard('Pending approvals', formatCount(summary.pendingApprovals), 'Submitted or under review', summary.pendingApprovals ? 'medium' : 'healthy'),
    kpiCard('Open purchase orders', formatCount(summary.openPurchaseOrders), 'Issued or partially received', summary.openPurchaseOrders ? 'medium' : 'info'),
    kpiCard('Low-stock recommendations', formatCount(summary.lowStockCount), 'Driven by stock/reorder evidence', summary.lowStockCount ? 'high' : 'healthy'),
    kpiCard('Received this month', formatCount(summary.receivedThisMonth), 'Requests received or closed this month', 'info'),
    kpiCard('Estimated monthly spend', formatCurrency(summary.monthlySpend), 'From selected quotes, when present', Number.isFinite(summary.monthlySpend) && summary.monthlySpend > 0 ? 'info' : 'review'),
    kpiCard('Budget availability', Number.isFinite(Number(financeAvailable)) ? formatCurrency(financeAvailable) : 'Data missing', 'Finance foundation totals', Number(financeAvailable) < 0 ? 'high' : 'info'),
  ].join('');
}

function decisionCard(label, value, copy, severity = 'info') {
  return `
    <article class="icc-decision-card ${severityClass(severity)}">
      <div class="icc-decision-label">${escapeHtml(label)}</div>
      <div class="icc-decision-value">${escapeHtml(formatCount(value))}</div>
      <p>${escapeHtml(copy)}</p>
    </article>
  `;
}

function renderStock(summary) {
  const eoq = summary.analytics?.eoqMoq || {};
  const fifo = summary.analytics?.fifo || {};
  const abc = summary.analytics?.abc || {};
  const cards = [
    decisionCard('Low stock', summary.lowStockCount, 'Items at or below reorder point.', summary.lowStockCount ? 'urgent' : 'healthy'),
    decisionCard('FIFO warnings', numberValue(fifo.staleBatchCount), fifo.summary || 'No FIFO batch evidence yet.', fifo.staleBatchCount ? 'review' : 'info'),
    decisionCard('EOQ missing data', numberValue(eoq.missingDataItems), eoq.summary || 'EOQ requires annual demand, ordering cost, and holding cost.', eoq.missingDataItems ? 'review' : 'healthy'),
    decisionCard('A-class control', numberValue(abc.counts?.A), 'Strict control and procurement review for A-class items.', abc.counts?.A ? 'review' : 'info'),
  ];
  const fifoRows = asArray(fifo.oldestBatches).slice(0, 4).map((row, index) => `
    <li class="icc-fifo-row ${index === 0 ? 'is-first' : ''}">
      <span>${escapeHtml(row.itemName || 'Stock batch')}${index === 0 ? ' | Use First' : ''}</span>
      <strong>${escapeHtml(String(row.quantityAvailable ?? '-'))} available</strong>
      <small>${escapeHtml(row.receivedAt ? `Received ${formatDateTime(row.receivedAt)}` : 'No received date')} ${escapeHtml(row.sourcePurchaseOrderId || row.sourceRequestId ? `| Source ${row.sourcePurchaseOrderId || row.sourceRequestId}` : '')}</small>
    </li>
  `).join('');
  document.getElementById('iccStockIntelligence').innerHTML = `
    <div class="icc-decision-grid">${cards.join('')}</div>
    <div class="icc-mini-panel mt-3">
      <div class="icc-mini-title">FIFO queue preview</div>
      ${fifoRows ? `<ul class="icc-fifo-list">${fifoRows}</ul>` : emptyState('No FIFO batches yet', 'Receive stock to create FIFO batch history. Major serialized assets should remain serial-specific.')}
    </div>
  `;
}

function renderRecommendations(summary) {
  const recommendations = asArray(summary.recommendations).slice(0, 5);
  if (!recommendations.length) {
    document.getElementById('iccAiRecommendations').innerHTML = emptyState('No urgent AI recommendations', 'Inventory currently has no critical low-stock or EOL procurement alerts from the loaded board.');
    return;
  }
  document.getElementById('iccAiRecommendations').innerHTML = recommendations.map((row, index) => {
    const priority = row.priority || row.urgency || 'Review';
    const count = row.recommendedQuantity || row.quantity || 1;
    const affected = [
      ...asArray(row.affectedAssets).slice(0, 2),
      ...asArray(row.affectedDepartments).slice(0, 1),
      ...asArray(row.affectedBuildings).slice(0, 1),
    ].filter(Boolean);
    return `
      <article class="icc-ai-rec-card ${severityClass(priority)}">
        <div class="icc-ai-rec-head">
          <span class="ops-attention-pill ${severityClass(priority)}">${escapeHtml(priority)}</span>
          <span class="ops-attention-pill is-info">${escapeHtml(sourceLabel(row))}</span>
        </div>
        <h3>${escapeHtml(row.itemName || row.title || `Recommendation ${index + 1}`)}</h3>
        <p>${escapeHtml(row.reason || row.evidenceSummary || 'Recommendation is based on available inventory evidence.')}</p>
        <div class="icc-ai-rec-meta">
          <span>Qty: ${escapeHtml(String(count))}</span>
          <span>Evidence: ${escapeHtml(String(row.evidenceLevel || row.dataQuality || 'Available'))}</span>
          ${affected.length ? `<span>Affected: ${escapeHtml(affected.join(', '))}</span>` : ''}
        </div>
        ${evidencePanel({
          title: 'Recommendation evidence',
          source: sourceLabel(row),
          confidence: String(row.evidenceLevel || row.dataQuality || 'Medium'),
          evidence: [
            row.evidenceSummary || row.evidence || row.reason || 'Generated from procurement board signals',
            affected.length ? `Affected: ${affected.join(', ')}` : '',
            row.estimatedBudget ? `Estimated budget: ${formatCurrency(row.estimatedBudget)}` : '',
          ].filter(Boolean),
          missingData: row.estimatedBudget ? [] : ['budget estimate may be missing'],
          action: 'Convert to a request only after review in Procurement.',
        })}
        <div class="icc-chip-row">
          <button type="button" class="btn btn-sm btn-primary" data-icc-action="procurement">Create Request</button>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-icc-ai-prompt="Explain why ${escapeHtml(row.itemName || 'this item')} is recommended.">View Evidence</button>
        </div>
      </article>
    `;
  }).join('');
}

function alertItem(severity, reason, evidence, actionLabel, actionAttr) {
  return `
    <article class="icc-alert-item ${severityClass(severity)}">
      <div>
        <span class="ops-attention-pill ${severityClass(severity)}">${escapeHtml(severity)}</span>
        <h3>${escapeHtml(reason)}</h3>
        <p>Source: ${escapeHtml(evidence)}</p>
      </div>
      <button type="button" class="btn btn-sm btn-outline-primary" ${actionAttr}>${escapeHtml(actionLabel)}</button>
    </article>
  `;
}

function renderAttention(summary) {
  const alerts = [];
  const durableAlerts = asArray(summary.smartAlerts).slice(0, 8).map((alert) => alertItem(
      alert.severity || 'Medium',
      alert.title || 'Smart alert',
      `${alert.message || 'Generated by durable alert rule.'} Rule: ${alert.ruleKey || '-'}`,
      alert.entityType === 'procurement_request' ? 'Open Procurement' : (alert.entityType === 'asset' ? 'Open Assets' : 'View'),
      alert.entityType === 'procurement_request' ? 'data-icc-action="procurement"' : 'data-icc-action="assets"'
  ));
  if (summary.eolSoonCount) alerts.push(alertItem('High', `${summary.eolSoonCount} asset(s) near EOL`, 'Lifecycle/warranty evidence', 'Open Asset Review', 'data-icc-ai-prompt="Which assets are near EOL?"'));
  if (summary.pendingApprovals) alerts.push(alertItem('Medium', `${summary.pendingApprovals} procurement approval(s) pending`, 'Procurement status counts', 'Open Procurement', 'data-icc-action="procurement"'));
  if (summary.lowStockCount) alerts.push(alertItem('High', `${summary.lowStockCount} item(s) below reorder point`, 'Spare stock / consumable forecast', 'Create Request', 'data-icc-action="procurement"'));
  if (summary.openPurchaseOrders) alerts.push(alertItem('Medium', `${summary.openPurchaseOrders} open purchase order(s)`, 'Procurement board analytics', 'Open POs', 'data-icc-action="procurement"'));
  if (summary.staleTelemetryCount) alerts.push(alertItem('Medium', `${summary.staleTelemetryCount} stale telemetry device(s)`, 'Telemetry freshness evidence', 'View Evidence', 'data-icc-ai-prompt="Which devices have stale telemetry?"'));
  if (summary.missingDataCount) alerts.push(alertItem('Medium', `${summary.missingDataCount} record(s) missing key data`, 'CMDB completeness check', 'Ask AI', 'data-icc-ai-prompt="Show missing inventory data."'));
  if (summary.budgetWarnings) alerts.push(alertItem('High', 'Budget availability is below zero', 'Finance foundation totals', 'Open Finance', 'data-icc-action="procurement"'));
  if (numberValue(summary.analytics?.fifo?.staleBatchCount)) alerts.push(alertItem('Medium', 'FIFO stale batch review needed', 'FIFO batch age evidence', 'Open Procurement', 'data-icc-action="procurement"'));
  if (numberValue(summary.analytics?.eoqMoq?.missingDataItems)) alerts.push(alertItem('Medium', 'EOQ/MOQ inputs missing', 'EOQ decision-support data quality', 'Open Procurement', 'data-icc-action="procurement"'));
  const rules = asArray(summary.smartAlertRules);
  const ruleCards = rules.slice(0, 8).map((rule) => {
    const enabled = Boolean(rule.enabled);
    return `
      <article class="icc-alert-rule-card ${enabled ? 'is-enabled' : 'is-disabled'}">
        <div>
          <span class="ops-attention-pill ${enabled ? 'is-healthy' : 'is-muted'}">${enabled ? 'Enabled' : 'Disabled'}</span>
          <h3>${escapeHtml(rule.name || rule.ruleKey || 'Alert rule')}</h3>
          <p>${escapeHtml(rule.description || rule.alertType || 'Configured alert rule')}</p>
        </div>
        <small>Threshold: ${escapeHtml(typeof rule.threshold === 'object' ? JSON.stringify(rule.threshold) : String(rule.threshold || '-'))}</small>
      </article>
    `;
  }).join('');
  const derivedPanel = alerts.length ? `
    <div class="icc-alert-section">
      <div class="icc-alert-section-head">
        <strong>System-generated page signals</strong>
        <span>Derived from loaded inventory/procurement evidence; not custom user rules.</span>
      </div>
      ${alerts.join('')}
    </div>
  ` : '';
  const durablePanel = durableAlerts.length ? `
    <div class="icc-alert-section">
      <div class="icc-alert-section-head">
        <strong>Durable alert history</strong>
        <span>${escapeHtml(String(summary.openSmartAlertCount || 0))} open event(s) generated by alert rules.</span>
      </div>
      ${durableAlerts.join('')}
    </div>
  ` : '';
  const rulesPanel = ruleCards ? `
    <div class="icc-alert-section">
      <div class="icc-alert-section-head">
        <strong>User-configured rules</strong>
        <span>${escapeHtml(String(rules.length))} rule(s). Rule editing stays controlled by admin routes.</span>
      </div>
      <div class="icc-alert-rule-grid">${ruleCards}</div>
    </div>
  ` : '';
  document.getElementById('iccAttentionCenter').innerHTML = durableAlerts.length || alerts.length || ruleCards
    ? `
      <div class="icc-alert-toolbar">
        <div>
          <strong>Alerts and rules</strong>
          <span>System events, page-derived signals, and configured rule definitions are shown separately.</span>
        </div>
        <button type="button" class="btn btn-sm btn-outline-primary" data-icc-action="evaluate-alerts">
          <i class="bi bi-bell me-1"></i>Evaluate Rules
        </button>
      </div>
      ${durablePanel}
      ${derivedPanel}
      ${rulesPanel}
    `
    : emptyState('No critical attention items', 'Inventory and procurement have no high-priority alerts from the currently loaded data.');
}

function renderRiskHeatmap(summary) {
  const riskAssetIds = new Set([
    ...asArray(summary.priorities.highRiskAssets).map((row) => row.assetId),
    ...asArray(summary.priorities.urgentReplacements).map((row) => row.assetId),
  ].filter(Boolean).map(String));
  const auditAssetIds = new Set(summary.auditRows.map((row) => String(row.assetId || '')).filter(Boolean));
  const groups = new Map();

  state.assets.forEach((asset) => {
    const location = displayLocation(asset.location || readSpecs(asset).mapLocationHint);
    const department = displayDepartment(asset.department);
    const key = `${location} / ${department}`;
    if (!groups.has(key)) {
      groups.set(key, { label: key, total: 0, eol: 0, risk: 0, missing: 0, audit: 0, stale: 0, lowStock: 0, telemetryScoped: 0 });
    }
    const group = groups.get(key);
    const id = getAssetId(asset);
    const telemetry = getTelemetryInfo(asset);
    group.total += 1;
    if (isNearEol(asset)) group.eol += 1;
    if (riskAssetIds.has(id)) group.risk += 1;
    if (missingDataForAsset(asset).length) group.missing += 1;
    if (auditAssetIds.has(id)) group.audit += 1;
    if (isLowStockAsset(asset)) group.lowStock += 1;
    if (telemetry.configured) group.telemetryScoped += 1;
    if (telemetry.stale) group.stale += 1;
  });

  const rows = Array.from(groups.values())
    .map((group) => {
      const total = Math.max(1, group.total);
      const missingRate = group.missing / total;
      const eolRate = Math.max(group.eol, group.risk) / total;
      const lowStockRate = group.lowStock / total;
      const staleTelemetryRate = group.telemetryScoped ? group.stale / group.telemetryScoped : 0;
      const auditRate = group.audit / total;
      const score = Math.max(0, Math.min(100, Math.round(
        (missingRate * 25)
        + (eolRate * 25)
        + (lowStockRate * 20)
        + (staleTelemetryRate * 15)
        + (auditRate * 15)
      )));
      const missingInputs = [];
      if (!group.telemetryScoped) missingInputs.push('telemetry scope');
      if (!group.lowStock) missingInputs.push('low-stock thresholds');
      return {
        ...group,
        score,
        rates: { missingRate, eolRate, lowStockRate, staleTelemetryRate, auditRate },
        missingInputs,
      };
    })
    .sort((a, b) => b.score - a.score || b.total - a.total)
    .slice(0, 8);

  document.getElementById('iccRiskHeatmap').innerHTML = rows.length ? rows.map((row) => {
    const severity = row.score >= 70 ? 'high' : (row.score >= 35 ? 'medium' : 'healthy');
    const reasons = [
      row.eol ? `${row.eol} EOL signal(s)` : '',
      row.risk ? `${row.risk} high-risk asset(s)` : '',
      row.lowStock ? `${row.lowStock} low-stock item(s)` : '',
      row.missing ? `${row.missing} missing-data record(s)` : '',
      row.audit ? `${row.audit} audit issue(s)` : '',
      row.stale ? `${row.stale} stale telemetry signal(s)` : '',
    ].filter(Boolean);
    return `
      <article class="icc-risk-card ${severityClass(severity)}">
        <div class="icc-risk-card-head">
          <div>
            <div class="icc-risk-title">${escapeHtml(row.label)}</div>
            <div class="icc-risk-sub">${escapeHtml(String(row.total))} asset(s) scanned</div>
          </div>
          <div class="icc-risk-radar" aria-hidden="true"><span></span></div>
        </div>
        <div class="icc-risk-score">${escapeHtml(String(row.score))}<span>/100</span></div>
        <div class="icc-risk-level">Risk level: ${escapeHtml(toTitle(severity))}</div>
        <div class="icc-risk-reasons">
          <span>Missing ${escapeHtml(String(Math.round(row.rates.missingRate * 100)))}%</span>
          <span>EOL ${escapeHtml(String(Math.round(row.rates.eolRate * 100)))}%</span>
          <span>Low stock ${escapeHtml(String(Math.round(row.rates.lowStockRate * 100)))}%</span>
          <span>Telemetry ${escapeHtml(String(Math.round(row.rates.staleTelemetryRate * 100)))}%</span>
          <span>Audit ${escapeHtml(String(Math.round(row.rates.auditRate * 100)))}%</span>
        </div>
        <div class="icc-risk-reasons">
          <span>EOL ${escapeHtml(String(row.eol))}</span>
          <span>Risk ${escapeHtml(String(row.risk))}</span>
          <span>Low stock ${escapeHtml(String(row.lowStock))}</span>
          <span>Missing ${escapeHtml(String(row.missing))}</span>
          <span>Audit ${escapeHtml(String(row.audit))}</span>
          <span>Telemetry ${escapeHtml(String(row.stale))}</span>
        </div>
        ${evidencePanel({
          title: 'Risk evidence',
          source: 'Deterministic risk radar',
          confidence: row.missingInputs.length || row.missing || row.stale ? 'Medium' : 'High',
          evidence: [
            'Formula: missing data 25%, EOL/high risk 25%, low stock 20%, stale telemetry 15%, open audit issues 15%.',
            ...(reasons.length ? reasons : ['No major risk signals in this building/department group']),
          ],
          missingData: [
            ...(row.missing ? ['Complete missing asset fields to improve radar confidence'] : []),
            ...row.missingInputs,
          ],
          action: 'Use Asset Map or Inventory filters to inspect the affected location before procurement action.',
        })}
        <div class="icc-chip-row mt-2">
          <button type="button" class="btn btn-sm btn-outline-primary" data-icc-ai-prompt="Which building is highest risk and why?">Explain risk</button>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-icc-action="asset-map">Open Map</button>
        </div>
      </article>
    `;
  }).join('') : emptyState('No risk heatmap data', 'Load assets with building and department data to build risk cards.');
}

function qualityRow(label, count, fixField = '') {
  return `
    <div class="icc-quality-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(formatCount(count))}</strong>
      ${count && fixField ? `<button type="button" class="btn btn-sm btn-outline-primary" data-icc-quality-fix="${escapeHtml(fixField)}">Fix now</button>` : ''}
    </div>
  `;
}

function renderDataQuality(summary) {
  const missingSerials = state.assets.filter((asset) => missingDataForAsset(asset).includes('serial')).length;
  const missingDepartments = state.assets.filter((asset) => missingDataForAsset(asset).includes('department')).length;
  const missingLocations = state.assets.filter((asset) => missingDataForAsset(asset).includes('location')).length;
  const missingPurchaseDates = state.assets.filter((asset) => missingDataForAsset(asset).includes('purchase date')).length;
  const missingWarranty = state.assets.filter((asset) => missingDataForAsset(asset).includes('warranty')).length;
  const missingPurchaseCost = state.assets.filter((asset) => missingDataForAsset(asset).includes('purchase cost')).length;
  document.getElementById('iccDataQuality').innerHTML = `
    <div class="icc-score-card ${summary.dataQualityScore < 70 ? 'is-review' : 'is-healthy'}">
      <div class="icc-score-ring" aria-label="Data quality score ${escapeHtml(String(summary.dataQualityScore))} percent">
        <strong>${escapeHtml(String(summary.dataQualityScore))}%</strong>
        <span>Quality</span>
      </div>
      <div class="icc-score-copy">
        <h3>${summary.dataQualityScore < 70 ? 'Data needs cleanup' : 'Data quality is serviceable'}</h3>
        <p>This score is based on serial, department, location, purchase date, warranty, duplicate tag, and related-item linking checks.</p>
      </div>
    </div>
    <div class="icc-quality-list">
      ${qualityRow('Missing serials', missingSerials, 'serial')}
      ${qualityRow('Missing departments', missingDepartments, 'department')}
      ${qualityRow('Missing locations', missingLocations, 'location')}
      ${qualityRow('Missing purchase dates', missingPurchaseDates, 'purchaseDate')}
      ${qualityRow('Missing warranty', missingWarranty, 'warranty')}
      ${qualityRow('Missing purchase cost', missingPurchaseCost, 'purchaseCost')}
      ${qualityRow('Duplicate tags/IDs', summary.duplicateTags)}
      ${qualityRow('Unlinked related items', summary.unlinkedRelated)}
    </div>
    <div class="icc-chip-row mt-3">
      <button type="button" class="btn btn-sm btn-outline-primary" data-icc-action="assets">Open Assets</button>
      <button type="button" class="btn btn-sm btn-outline-primary" data-icc-quality-fix="all">View Missing Data</button>
      <button type="button" class="btn btn-sm btn-outline-primary" data-icc-ai-prompt="Show missing data and suggest fixes.">Ask AI to suggest fixes</button>
      <button type="button" class="btn btn-sm btn-outline-secondary" data-icc-action="import">Open import/match tools</button>
    </div>
  `;
}

function qualityFieldKeys(field = 'all') {
  const key = String(field || 'all').trim();
  if (key === 'all') return Object.keys(QUALITY_FIELD_CONFIG);
  return QUALITY_FIELD_CONFIG[key] ? [key] : [];
}

function assetQualityFieldValue(asset = {}, fieldKey = '') {
  const specs = readSpecs(asset);
  if (fieldKey === 'serial') return asset.serialNumber || specs.serialNumber || '';
  if (fieldKey === 'department') return displayDepartment(asset.department);
  if (fieldKey === 'location') return displayLocation(asset.location || specs.mapLocationHint);
  if (fieldKey === 'purchaseDate') return getPurchaseDate(asset) ? String(getPurchaseDate(asset)).slice(0, 10) : '';
  if (fieldKey === 'warranty') return getWarrantyEnd(asset) ? String(getWarrantyEnd(asset)).slice(0, 10) : '';
  if (fieldKey === 'purchaseCost') return hasValue(getPurchaseCost(asset)) ? String(getPurchaseCost(asset)) : '';
  return '';
}

function assetsForQualityFix(field = 'all') {
  const keys = qualityFieldKeys(field);
  return state.assets
    .map((asset) => ({ asset, missing: missingDataForAsset(asset) }))
    .filter((row) => row.missing.length && keys.some((key) => row.missing.includes(QUALITY_FIELD_CONFIG[key]?.missingKey)))
    .slice(0, 40);
}

function qualityInputHtml(asset = {}, fieldKey = '') {
  const config = QUALITY_FIELD_CONFIG[fieldKey];
  if (!config) return '';
  const value = assetQualityFieldValue(asset, fieldKey);
  const inputClass = config.inputType === 'number' ? 'form-control form-control-sm icc-quality-input is-numeric' : 'form-control form-control-sm icc-quality-input';
  return `
    <label class="icc-quality-input-label">
      <span>${escapeHtml(config.label)}</span>
      <input
        class="${inputClass}"
        type="${escapeHtml(config.inputType)}"
        data-quality-field="${escapeHtml(fieldKey)}"
        data-original-value="${escapeHtml(value)}"
        value="${escapeHtml(value)}"
        ${config.inputType === 'number' ? 'min="0" step="0.01"' : ''}
      >
    </label>
  `;
}

function showIccToast(message, type = 'info') {
  const fn = type === 'success' ? UI.success : (type === 'warning' ? UI.warning : (type === 'error' ? UI.error : UI.info));
  if (typeof fn === 'function') fn(message);
}

function openPriorityDismissModal(row = {}) {
  const modalId = 'iccPriorityDismissModal';
  const title = row.title || 'priority';
  let modalEl = document.getElementById(modalId);
  if (!modalEl) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal fade" id="${modalId}" tabindex="-1" aria-labelledby="${modalId}Title" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content icc-action-modal">
            <div class="modal-header">
              <div>
                <h5 class="modal-title" id="${modalId}Title">Dismiss priority</h5>
                <div class="modal-subtitle">This only marks the Command Center card as handled for your current session today.</div>
              </div>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close dismiss priority modal"></button>
            </div>
            <div class="modal-body">
              <div class="icc-action-summary" id="${modalId}Summary"></div>
              <div class="mb-3">
                <label class="form-label" for="${modalId}Reason">Reason</label>
                <select class="form-select" id="${modalId}Reason">
                  ${PRIORITY_REASONS.map((reason) => `<option value="${escapeHtml(reason)}">${escapeHtml(readablePriorityReason(reason))}</option>`).join('')}
                </select>
                <div class="form-text">High/critical priorities require a clear reason before they leave the active list.</div>
              </div>
              <div>
                <label class="form-label" for="${modalId}Note">Optional note</label>
                <textarea class="form-control" id="${modalId}Note" rows="2" placeholder="Add a short note for your own session..."></textarea>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="button" class="btn btn-primary" id="${modalId}SaveBtn">Dismiss for today</button>
            </div>
          </div>
        </div>
      </div>
    `);
    modalEl = document.getElementById(modalId);
  }
  document.getElementById(`${modalId}Summary`).innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(row.explanation || 'Review priority evidence before dismissing.')}</span>
  `;
  const reasonEl = document.getElementById(`${modalId}Reason`);
  const noteEl = document.getElementById(`${modalId}Note`);
  if (reasonEl) reasonEl.value = 'fixed';
  if (noteEl) noteEl.value = '';
  const saveBtn = document.getElementById(`${modalId}SaveBtn`);
  saveBtn.onclick = () => {
    const reason = String(reasonEl?.value || '').trim();
    const store = ensurePriorityState();
    store.handled[priorityId(row)] = {
      status: 'dismissed',
      reason,
      note: String(noteEl?.value || '').trim(),
      handledAt: new Date().toISOString(),
    };
    writePriorityState(store);
    bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    renderAll();
    showIccToast('Priority dismissed for today.', 'success');
  };
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function markPriorityDone(row = {}) {
  const store = ensurePriorityState();
  store.handled[priorityId(row)] = {
    status: 'done',
    reason: 'fixed',
    note: '',
    handledAt: new Date().toISOString(),
  };
  writePriorityState(store);
  renderAll();
  showIccToast('Priority marked handled for today.', 'success');
}

function restorePriority(id = '') {
  const store = ensurePriorityState();
  delete store.handled[String(id || '')];
  writePriorityState(store);
  renderAll();
}

function openDataQualityFixModal(field = 'all') {
  const rows = assetsForQualityFix(field);
  const keys = qualityFieldKeys(field);
  const modalId = 'iccDataQualityFixModal';
  let modalEl = document.getElementById(modalId);
  if (!modalEl) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal fade" id="${modalId}" tabindex="-1" aria-labelledby="${modalId}Title" aria-hidden="true">
        <div class="modal-dialog modal-xl modal-dialog-scrollable">
          <div class="modal-content icc-action-modal icc-quality-fix-modal">
            <div class="modal-header">
              <div>
                <h5 class="modal-title" id="${modalId}Title">Fix inventory data quality</h5>
                <div class="modal-subtitle">Edit missing CMDB fields. Saving writes through the normal asset details API and records history.</div>
              </div>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close data quality fix modal"></button>
            </div>
            <div class="modal-body" id="${modalId}Body"></div>
            <div class="modal-footer">
              <span class="icc-quality-save-status" id="${modalId}Status" aria-live="polite"></span>
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Close</button>
              <button type="button" class="btn btn-primary" id="${modalId}SaveBtn">Save changed rows</button>
            </div>
          </div>
        </div>
      </div>
    `);
    modalEl = document.getElementById(modalId);
  }
  const body = document.getElementById(`${modalId}Body`);
  const title = field === 'all' ? 'Missing data' : QUALITY_FIELD_CONFIG[field]?.label || 'Missing data';
  body.innerHTML = rows.length ? `
    <div class="icc-quality-fix-intro">
      <span class="ops-attention-pill is-info">${escapeHtml(title)}</span>
      <p>Showing up to 40 affected assets. Leave fields unchanged if you are not ready to update them.</p>
    </div>
    <div class="icc-quality-fix-table" role="table" aria-label="Editable missing inventory data">
      ${rows.map(({ asset, missing }) => `
        <article class="icc-quality-fix-row" data-quality-asset-id="${escapeHtml(getAssetId(asset))}">
          <div class="icc-quality-asset">
            <strong>${escapeHtml(assetName(asset))}</strong>
            <span>${escapeHtml(getAssetId(asset) || asset.assetTag || '-')}</span>
            <small>Missing: ${escapeHtml(missing.join(', '))}</small>
          </div>
          <div class="icc-quality-fields">
            ${keys.map((key) => qualityInputHtml(asset, key)).join('')}
          </div>
        </article>
      `).join('')}
    </div>
  ` : emptyState('No missing fields in this view', 'The selected data quality category has no matching assets in the loaded snapshot.');
  const saveBtn = document.getElementById(`${modalId}SaveBtn`);
  const statusEl = document.getElementById(`${modalId}Status`);
  saveBtn.disabled = !rows.length;
  saveBtn.onclick = async () => {
    const updates = [];
    const errors = [];
    Array.from(body.querySelectorAll('[data-quality-asset-id]')).forEach((rowEl) => {
      const assetId = String(rowEl.getAttribute('data-quality-asset-id') || '').trim();
      const payload = {};
      Array.from(rowEl.querySelectorAll('[data-quality-field]')).forEach((input) => {
        const fieldKey = String(input.getAttribute('data-quality-field') || '').trim();
        const config = QUALITY_FIELD_CONFIG[fieldKey];
        if (!config) return;
        const original = String(input.getAttribute('data-original-value') || '').trim();
        const value = String(input.value || '').trim();
        input.classList.remove('is-invalid');
        if (!value || value === original) return;
        if (config.inputType === 'date' && Number.isNaN(new Date(value).getTime())) {
          input.classList.add('is-invalid');
          errors.push(`${assetId}: ${config.label} is not a valid date.`);
          return;
        }
        if (config.inputType === 'number') {
          const numeric = Number(value);
          if (!Number.isFinite(numeric) || numeric < 0) {
            input.classList.add('is-invalid');
            errors.push(`${assetId}: ${config.label} must be a positive number.`);
            return;
          }
          payload[config.assetField] = numeric;
        } else {
          payload[config.assetField] = value;
        }
      });
      if (assetId && Object.keys(payload).length) {
        payload.admin = AuthService.getCurrentUser() || {};
        updates.push({ assetId, payload });
      }
    });
    if (errors.length) {
      if (statusEl) statusEl.textContent = errors[0];
      showIccToast(errors[0], 'warning');
      return;
    }
    if (!updates.length) {
      if (statusEl) statusEl.textContent = 'No changed rows to save.';
      showIccToast('No changed rows to save.', 'warning');
      return;
    }
    saveBtn.disabled = true;
    if (statusEl) statusEl.textContent = `Saving ${updates.length} row(s)...`;
    try {
      await Promise.all(updates.map(({ assetId, payload }) => sendJson(`/assets/${encodeURIComponent(assetId)}/details`, payload, 'PATCH')));
      if (statusEl) statusEl.textContent = `Saved ${updates.length} row(s). Refreshing evidence...`;
      showIccToast(`Saved ${updates.length} data quality update(s).`, 'success');
      bootstrap.Modal.getOrCreateInstance(modalEl).hide();
      await loadCommandCenter({ background: true });
    } catch (error) {
      saveBtn.disabled = false;
      if (statusEl) statusEl.textContent = error.message || 'Save failed.';
      showIccToast(error.message || 'Failed to save data quality updates.', 'error');
    }
  };
  if (statusEl) statusEl.textContent = '';
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function renderActivity(summary) {
  const feed = [];
  state.assets.slice(0, 6).forEach((asset) => {
    feed.push({ date: asset.createdAt || asset.updatedAt, title: `Asset created: ${assetName(asset)}`, source: 'Inventory' });
  });
  summary.requests.slice(0, 8).forEach((request) => {
    feed.push({ date: request.updatedAt || request.createdAt, title: `${request.status || 'Updated'}: ${request.requestId || request.title}`, source: 'Procurement' });
    asArray(request.receivingRecords).slice(0, 2).forEach((record) => {
      feed.push({ date: record.receivedAt || record.createdAt, title: `Stock received for ${request.requestId || request.title}`, source: 'Receiving' });
    });
    if (request.purchaseOrder) {
      feed.push({ date: request.purchaseOrder.createdAt || request.updatedAt, title: `PO created: ${request.purchaseOrder.poNumber || request.requestId}`, source: 'Purchase Order' });
    }
  });
  const rows = feed
    .filter((row) => row.date)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 10);

  document.getElementById('iccRecentActivity').innerHTML = rows.length
    ? rows.map((row) => `
      <article class="icc-feed-item">
        <span>${escapeHtml(row.source)}</span>
        <strong>${escapeHtml(row.title)}</strong>
        <small>${escapeHtml(formatDateTime(row.date))}</small>
      </article>
    `).join('')
    : emptyState('No recent activity endpoint yet', 'Recent asset/procurement events will appear when history data is available. Phase 2 can add a dedicated activity feed endpoint.');
}

function eolQuarterLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown quarter';
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return `Q${quarter} ${date.getFullYear()}`;
}

function eolAssetForRow(row = {}) {
  const rowId = String(row.assetId || row.customId || '').trim();
  return state.assets.find((asset) => getAssetId(asset) === rowId) || {};
}

function eolRowField(row = {}, field = '') {
  const asset = eolAssetForRow(row);
  if (field === 'department') return displayDepartment(row.department || asset.department || 'Unassigned');
  if (field === 'building') return displayLocation(row.location || row.building || asset.location || 'Unassigned');
  if (field === 'category') return toTitle(row.category || asset.category || 'asset');
  return '';
}

function eolFilterOptions(rows = [], field = '') {
  return Array.from(new Set(rows.map((row) => eolRowField(row, field)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function renderEolFilterSelect(id, label, field, rows) {
  const value = state.eolBudgetFilters[field] || 'all';
  const options = eolFilterOptions(rows, field);
  return `
    <label class="icc-eol-filter">
      <span>${escapeHtml(label)}</span>
      <select class="form-select form-select-sm" data-icc-eol-filter="${escapeHtml(field)}" id="${escapeHtml(id)}">
        <option value="all">All ${escapeHtml(label)}</option>
        ${options.map((option) => `<option value="${escapeHtml(option)}" ${option === value ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
      </select>
    </label>
  `;
}

function rowMatchesEolFilters(row = {}) {
  const filters = state.eolBudgetFilters || {};
  return ['department', 'building', 'category'].every((field) => {
    const value = filters[field] || 'all';
    return value === 'all' || eolRowField(row, field) === value;
  });
}

function renderEolDrilldown(groups = []) {
  const selected = state.eolBudgetSelectedQuarter || groups[0]?.label || '';
  const group = groups.find((entry) => entry.label === selected);
  if (!group) return '';
  const rows = asArray(group.assets).slice(0, 24);
  return `
    <aside class="icc-eol-drilldown" aria-label="Affected assets for ${escapeHtml(group.label)}">
      <div class="icc-eol-drilldown-head">
        <div>
          <strong>${escapeHtml(group.label)} affected assets</strong>
          <span>${escapeHtml(String(group.count))} asset(s), ${escapeHtml(group.missingCost ? `${group.missingCost} missing cost` : 'cost evidence available where stored')}</span>
        </div>
        <button type="button" class="btn btn-sm btn-outline-primary" data-icc-action="procurement">Open Procurement</button>
      </div>
      <div class="icc-eol-asset-list">
        ${rows.map((asset) => `
          <article class="icc-eol-asset-row">
            <div>
              <strong>${escapeHtml(asset.assetName || asset.assetId || 'Asset')}</strong>
              <span>${escapeHtml(eolRowField(asset, 'building'))} / ${escapeHtml(eolRowField(asset, 'department'))}</span>
            </div>
            <span class="ops-attention-pill ${severityClass(asset.riskLevel || 'medium')}">${escapeHtml(asset.riskLevel || 'Review')}</span>
            <small>${escapeHtml(asset.estimatedReplacementCost ? formatCurrency(asset.estimatedReplacementCost) : 'Cost missing')}</small>
          </article>
        `).join('') || emptyState('No affected assets listed', 'The selected quarter has summary data but no row-level assets.')}
      </div>
    </aside>
  `;
}

function renderEolBudgetTimeline() {
  const report = state.eolBudgetTimeline || {};
  const allRows = asArray(report.rows);
  const rows = allRows.filter(rowMatchesEolFilters);
  const groups = new Map();
  rows.forEach((row) => {
    const key = eolQuarterLabel(row.eolDate);
    if (!groups.has(key)) groups.set(key, { label: key, count: 0, budget: 0, missingCost: 0, assets: [] });
    const group = groups.get(key);
    group.count += 1;
    const cost = Number(row.estimatedReplacementCost || 0);
    if (Number.isFinite(cost) && cost > 0) group.budget += cost;
    else group.missingCost += 1;
    group.assets.push(row);
  });
  const horizon = Number(report?.totals?.monthsAhead || state.eolBudgetHorizon || 12);
  const totalBudget = Number(report?.totals?.estimatedBudget || 0);
  const timeline = Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
  return `
    <section class="icc-eol-timeline-card">
      <div class="icc-eol-timeline-head">
        <div>
          <div class="icc-budget-thermo-label">EOL budget forecast timeline</div>
          <strong>Next ${escapeHtml(String(horizon))} months: ${escapeHtml(totalBudget ? formatCurrency(totalBudget) : 'Cost data missing')}</strong>
          <p>${escapeHtml(report.summary || 'No EOL forecast data loaded yet.')}</p>
        </div>
        <div class="icc-eol-horizon-toggle" role="group" aria-label="EOL forecast horizon">
          ${[12, 24, 36].map((months) => `
            <button type="button" class="btn btn-sm ${horizon === months ? 'btn-primary' : 'btn-outline-primary'}" data-icc-eol-horizon="${months}">
              ${months}m
            </button>
          `).join('')}
        </div>
      </div>
      <div class="icc-eol-filter-row" aria-label="EOL forecast filters">
        ${renderEolFilterSelect('iccEolDeptFilter', 'Departments', 'department', allRows)}
        ${renderEolFilterSelect('iccEolBuildingFilter', 'Buildings', 'building', allRows)}
        ${renderEolFilterSelect('iccEolCategoryFilter', 'Categories', 'category', allRows)}
      </div>
      <div class="icc-eol-quarter-grid">
        ${timeline.length ? timeline.slice(0, 12).map((group) => `
          <article class="icc-eol-quarter-card ${state.eolBudgetSelectedQuarter === group.label ? 'is-selected' : ''}" role="button" tabindex="0" data-icc-eol-quarter="${escapeHtml(group.label)}">
            <span>${escapeHtml(group.label)}</span>
            <strong>${escapeHtml(formatCurrency(group.budget))}</strong>
            <p>${escapeHtml(String(group.count))} asset(s) counted${group.missingCost ? `, ${group.missingCost} missing cost` : ''}</p>
            <details class="ops-360-evidence">
              <summary>View affected assets</summary>
              <ul>${group.assets.slice(0, 20).map((asset) => `<li>${escapeHtml(asset.assetName || asset.assetId || '-')} - ${escapeHtml(asset.riskLevel || 'unknown risk')} - ${escapeHtml(asset.estimatedReplacementCost ? formatCurrency(asset.estimatedReplacementCost) : 'Cost missing')}</li>`).join('')}</ul>
            </details>
          </article>
        `).join('') : emptyState('No EOL assets in selected horizon', 'Add purchase/warranty data or adjust the horizon to improve forecast coverage.')}
      </div>
      ${renderEolDrilldown(timeline)}
      ${evidencePanel({
        title: 'Forecast evidence',
        source: 'Deterministic EOL budget report',
        confidence: report.confidence || (rows.length ? 'Medium' : 'Low'),
        evidence: [
          `Assets counted: ${numberValue(report?.totals?.matchedAssets)}`,
          `Cost source: stored purchase/replacement cost where available.`,
          `Missing cost assets: ${numberValue(report?.totals?.missingCostAssets)}`,
        ],
        missingData: asArray(report.missingData),
        action: 'Use this as planning evidence only; procurement requests still require review and confirmation.',
      })}
    </section>
  `;
}

async function setEolBudgetHorizon(months) {
  const horizon = Math.max(12, Math.min(36, Number(months) || 12));
  try {
    state.eolBudgetHorizon = horizon;
    const target = document.getElementById('iccBudgetPlanning');
    if (target) target.classList.add('is-refreshing');
    state.eolBudgetTimeline = await postJson('/inventory/eol-budget-report', { monthsAhead: horizon });
    renderBudget(buildSummary());
  } catch (error) {
    UI.error(error.message || 'Failed to load EOL budget timeline.');
  } finally {
    document.getElementById('iccBudgetPlanning')?.classList.remove('is-refreshing');
  }
}

function renderBudget(summary) {
  const forecast = summary.executive?.budgetForecastSummary || {};
  const financeTotals = summary.analytics?.finance?.totals || {};
  const forecastHasBudget = Number.isFinite(Number(forecast.estimatedBudget));
  const allocated = numberValue(financeTotals.allocated, 0);
  const reserved = numberValue(financeTotals.reserved, 0);
  const committed = numberValue(financeTotals.committed, 0);
  const spent = numberValue(financeTotals.spent, 0);
  const used = reserved + committed + spent;
  const pressurePercent = allocated > 0 ? Math.round((used / allocated) * 100) : null;
  const filledSegments = pressurePercent === null ? 0 : Math.max(0, Math.min(10, Math.ceil(pressurePercent / 10)));
  const pressureLevel = pressurePercent === null ? 'missing' : (pressurePercent >= 100 ? 'urgent' : (pressurePercent >= 75 ? 'review' : 'healthy'));
  const thermometer = `
    <div class="icc-budget-thermometer ${severityClass(pressureLevel)}">
      <div class="icc-budget-thermo-head">
        <div>
          <div class="icc-budget-thermo-label">Budget Thermometer</div>
          <strong>${pressurePercent === null ? 'Data missing' : `${escapeHtml(String(pressurePercent))}% used`}</strong>
        </div>
        <span class="ops-attention-pill ${severityClass(pressureLevel)}">${escapeHtml(pressurePercent === null ? 'Needs budget data' : (pressurePercent >= 100 ? 'Exceeded' : (pressurePercent >= 75 ? 'Pressure' : 'Healthy')))}</span>
      </div>
      <div class="icc-budget-segments" aria-label="Budget pressure ${escapeHtml(pressurePercent === null ? 'unknown' : `${pressurePercent}%`)}">
        ${Array.from({ length: 10 }).map((_, index) => `<span class="${index < filledSegments ? 'is-filled' : ''}"></span>`).join('')}
      </div>
      <div class="icc-budget-thermo-values">
        <span>Allocated: ${escapeHtml(allocated ? formatCurrency(allocated) : 'Missing')}</span>
        <span>Reserved: ${escapeHtml(formatCurrency(reserved))}</span>
        <span>Committed: ${escapeHtml(formatCurrency(committed))}</span>
        <span>Spent: ${escapeHtml(formatCurrency(spent))}</span>
      </div>
      ${evidencePanel({
        title: 'Budget impact evidence',
        source: 'Finance foundation totals',
        confidence: allocated ? 'Medium' : 'Low',
        evidence: [
          `Allocated ${allocated ? formatCurrency(allocated) : 'missing'}`,
          `Reserved ${formatCurrency(reserved)}`,
          `Committed ${formatCurrency(committed)}`,
          `Spent ${formatCurrency(spent)}`,
        ],
        missingData: allocated ? [] : ['budget allocation data'],
        action: 'Finance remains internal tracking only; no payment or accounting entry is created here.',
      })}
    </div>
  `;
  document.getElementById('iccBudgetPlanning').innerHTML = `
    ${thermometer}
    ${renderEolBudgetTimeline()}
    <div class="icc-budget-grid">
      ${kpiCard('Expected procurement cost', forecastHasBudget ? formatCurrency(forecast.estimatedBudget) : 'Data missing', forecast.summary || 'Requires EOL/risk and cost evidence.', forecastHasBudget ? 'info' : 'review')}
      ${kpiCard('EOL replacement forecast', formatCount(forecast.matchedAssets || summary.eolSoonCount), `${forecast.monthsAhead || 3}-month planning window`, summary.eolSoonCount ? 'medium' : 'healthy')}
      ${kpiCard('High-risk upcoming spend', formatCount(summary.highRiskCount), 'Cost estimate requires purchase/replacement values.', summary.highRiskCount ? 'medium' : 'healthy')}
      ${kpiCard('Department budget pressure', Number.isFinite(Number(financeTotals.available)) ? formatCurrency(financeTotals.available) : 'Data missing', 'Finance foundation availability', Number(financeTotals.available) < 0 ? 'high' : 'info')}
    </div>
    ${forecastHasBudget ? '' : '<div class="icc-phase-note mt-3"><strong>Missing data:</strong> add purchase cost, replacement cost, budget allocations, and selected quotes to improve budget forecasting.</div>'}
  `;
}

function renderWalkthrough() {
  const list = document.getElementById('iccDemoWalkthroughList');
  const status = document.getElementById('iccWalkthroughStatus');
  const items = Array.from(list?.querySelectorAll('[data-icc-demo-step]') || []);
  items.forEach((item) => {
    const step = Number(item.getAttribute('data-icc-demo-step'));
    item.classList.toggle('is-complete', state.walkthroughStep > step);
    item.classList.toggle('is-current', state.walkthroughStep === step);
  });
  if (status) {
    if (state.walkthroughStep < 0) {
      status.textContent = 'Ready to start. This guide only navigates and explains; it never changes data.';
    } else if (state.walkthroughStep >= items.length) {
      status.textContent = 'Walkthrough complete. You can restart anytime for another presentation run.';
    } else {
      const current = items[state.walkthroughStep]?.textContent?.trim() || `Step ${state.walkthroughStep + 1}`;
      status.textContent = `Current step ${state.walkthroughStep + 1} of ${items.length}: ${current}`;
    }
  }
}

function advanceWalkthrough(start = false) {
  const list = document.getElementById('iccDemoWalkthroughList');
  const count = list?.querySelectorAll('[data-icc-demo-step]')?.length || 0;
  if (!count) return;
  if (start || state.walkthroughStep < 0 || state.walkthroughStep >= count) {
    state.walkthroughStep = 0;
  } else {
    state.walkthroughStep += 1;
  }
  renderWalkthrough();
}

function renderMiniAnalyticsBars(rows = [], emptyTitle = 'No graph data') {
  if (!rows.length) {
    return `
      <div class="ops-empty-state-card">
        <div>
          <div class="ops-empty-state-title">${escapeHtml(emptyTitle)}</div>
          <div class="ops-empty-state-copy">Add or load inventory/procurement evidence to populate this visualization.</div>
        </div>
      </div>
    `;
  }
  const max = Math.max(1, ...rows.map((row) => numberValue(row.value)));
  return `
    <div class="icc-mini-chart-bars">
      ${rows.slice(0, 8).map((row) => {
        const value = numberValue(row.value);
        const bucket = Math.max(0, Math.min(100, Math.ceil((value / max) * 10) * 10));
        return `
          <div class="icc-mini-chart-row">
            <span>${escapeHtml(row.label)}</span>
            <div class="icc-mini-chart-track"><i class="progress-${escapeHtml(String(bucket))}"></i></div>
            <strong>${escapeHtml(row.display || String(value))}</strong>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderVisualAnalytics(summary = {}) {
  const el = document.getElementById('iccVisualAnalytics');
  if (!el) return;
  const assets = Array.isArray(state.assets) ? state.assets : [];
  const healthRows = [
    { label: 'Healthy', value: assets.filter((asset) => String(asset.healthSeverity || asset.riskLevel || '').toLowerCase().includes('healthy')).length },
    { label: 'Watch', value: assets.filter((asset) => ['medium', 'watch', 'amber'].includes(normalize(asset.healthSeverity || asset.riskLevel || ''))).length },
    { label: 'High Risk', value: numberValue(summary.highRiskCount) },
  ].filter((row) => row.value > 0);
  const missingFields = [
    { label: 'Serial', value: assets.filter((asset) => !String(asset.serialNumber || '').trim()).length },
    { label: 'Cost', value: assets.filter((asset) => !Number(asset.purchaseCost || 0)).length },
    { label: 'Warranty', value: assets.filter((asset) => !asset.warrantyEndDate).length },
    { label: 'Purchase Date', value: assets.filter((asset) => !asset.purchaseDate).length },
  ].filter((row) => row.value > 0);
  const eolTimelineRows = Array.isArray(state.eolBudgetTimeline?.rows) ? state.eolBudgetTimeline.rows : [];
  const eolRows = eolTimelineRows.length
    ? Object.entries(eolTimelineRows.reduce((acc, row) => {
        const key = eolQuarterLabel(row.eolDate || row.warrantyEndDate || row.targetDate);
        acc[key] = (acc[key] || 0) + numberValue(row.estimatedReplacementCost || row.replacementCost || row.cost);
        return acc;
      }, {})).map(([label, value]) => ({ label, value, display: formatCurrency(value) }))
    : [];
  const riskRows = [
    { label: 'Low stock', value: numberValue(summary.lowStockCount) },
    { label: 'EOL soon', value: numberValue(summary.eolSoonCount) },
    { label: 'Pending approvals', value: numberValue(summary.pendingApprovals) },
    { label: 'Open POs', value: numberValue(summary.openPurchaseOrders) },
    { label: 'Stale telemetry', value: numberValue(summary.staleTelemetryCount) },
  ].filter((row) => row.value > 0);

  el.innerHTML = `
    <article class="icc-analytics-card ops-3d-card">
      <div class="icc-analytics-card-head"><h3>Asset health distribution</h3><span class="ops-attention-pill is-info">Loaded assets</span></div>
      ${renderMiniAnalyticsBars(healthRows, 'No health distribution yet')}
    </article>
    <article class="icc-analytics-card ops-3d-card">
      <div class="icc-analytics-card-head"><h3>Missing data by field</h3><span class="ops-attention-pill is-review">Data quality</span></div>
      ${renderMiniAnalyticsBars(missingFields, 'No missing-data graph yet')}
    </article>
    <article class="icc-analytics-card ops-3d-card">
      <div class="icc-analytics-card-head"><h3>EOL replacement cost by quarter</h3><span class="ops-attention-pill is-info">EGP</span></div>
      ${renderMiniAnalyticsBars(eolRows, 'No EOL forecast graph yet')}
    </article>
    <article class="icc-analytics-card ops-3d-card">
      <div class="icc-analytics-card-head"><h3>Operations pressure</h3><span class="ops-attention-pill is-info">Command signals</span></div>
      ${renderMiniAnalyticsBars(riskRows, 'No pressure graph yet')}
    </article>
  `;
}

function renderDepartmentGrid(summary = {}) {
  const target = document.getElementById('iccDepartmentGrid');
  if (!target) return;
  const auditIds = new Set(asArray(summary.auditRows).map((row) => String(row.assetId || '')).filter(Boolean));
  const riskIds = new Set(asArray(summary.priorities?.highRiskAssets).map((row) => String(row.assetId || '')).filter(Boolean));
  const groups = new Map();
  state.assets.forEach((asset) => {
    const department = displayDepartment(asset.department);
    if (!groups.has(department)) {
      groups.set(department, {
        department,
        count: 0,
        healthTotal: 0,
        eol: 0,
        highRisk: 0,
        missing: 0,
        audit: 0,
      });
    }
    const group = groups.get(department);
    const assetId = getAssetId(asset);
    const missingCount = missingDataForAsset(asset).length;
    const eol = isNearEol(asset);
    const staleTelemetry = getTelemetryInfo(asset).stale;
    const highRisk = riskIds.has(assetId);
    const health = Math.max(0, Math.min(100, 100
      - (missingCount * 6)
      - (eol ? 18 : 0)
      - (staleTelemetry ? 10 : 0)
      - (highRisk ? 22 : 0)
      - (auditIds.has(assetId) ? 12 : 0)));
    group.count += 1;
    group.healthTotal += health;
    if (eol) group.eol += 1;
    if (highRisk) group.highRisk += 1;
    if (missingCount) group.missing += 1;
    if (auditIds.has(assetId)) group.audit += 1;
  });
  const rows = Array.from(groups.values())
    .map((row) => ({
      ...row,
      averageHealth: row.count ? Math.round(row.healthTotal / row.count) : 0,
      pressure: row.eol + row.highRisk + row.missing + row.audit,
    }))
    .sort((a, b) => b.pressure - a.pressure || b.count - a.count)
    .slice(0, 12);
  target.innerHTML = rows.length ? rows.map((row) => {
    const severity = row.pressure >= 8 || row.averageHealth < 55 ? 'high' : (row.pressure >= 3 || row.averageHealth < 75 ? 'medium' : 'healthy');
    return `
      <article class="icc-department-card ${severityClass(severity)}">
        <div class="icc-department-card-head">
          <div>
            <span class="icc-section-kicker">Department</span>
            <h3>${escapeHtml(row.department)}</h3>
          </div>
          <span class="ops-attention-pill ${severityClass(severity)}">${escapeHtml(toTitle(severity))}</span>
        </div>
        <div class="icc-department-score"><strong>${escapeHtml(String(row.averageHealth))}</strong><span>Avg health</span></div>
        <div class="icc-department-metrics">
          <span>${escapeHtml(String(row.count))} assets</span>
          <span>${escapeHtml(String(row.eol))} EOL/warranty</span>
          <span>${escapeHtml(String(row.highRisk))} high risk</span>
          <span>${escapeHtml(String(row.missing))} missing data</span>
          <span>${escapeHtml(String(row.audit))} audit issue(s)</span>
        </div>
        <div class="icc-chip-row">
          <button type="button" class="btn btn-sm btn-outline-primary" data-icc-ai-prompt="Summarize inventory health for ${escapeHtml(row.department)} department.">Ask AI</button>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-icc-action="assets">Open Assets</button>
        </div>
      </article>
    `;
  }).join('') : emptyState('No department data yet', 'Assets without department data will appear as Unassigned once loaded.');
}

function renderAll() {
  const summary = buildSummary();
  applyFocusMode();
  updateDemoModeVisibility();
  renderTodaysMission(summary);
  renderDailyBriefing(summary);
  renderPriorities(summary);
  renderHealth(summary);
  renderProcurement(summary);
  renderStock(summary);
  renderRecommendations(summary);
  renderAttention(summary);
  renderRiskHeatmap(summary);
  renderDataQuality(summary);
  renderVisualAnalytics(summary);
  renderDepartmentGrid(summary);
  renderActivity(summary);
  renderBudget(summary);
  renderWalkthrough();
}

function applyFocusMode() {
  document.body.classList.toggle('icc-focus-mode', Boolean(state.focusMode));
  const btn = document.getElementById('iccFocusModeBtn');
  if (btn) {
    btn.setAttribute('aria-pressed', state.focusMode ? 'true' : 'false');
    btn.classList.toggle('btn-primary', state.focusMode);
    btn.classList.toggle('btn-outline-secondary', !state.focusMode);
    btn.innerHTML = state.focusMode
      ? '<i class="bi bi-bullseye me-1"></i>Focus Mode On'
      : '<i class="bi bi-bullseye me-1"></i>Focus Mode';
  }
}

function setFocusMode(enabled) {
  state.focusMode = Boolean(enabled);
  localStorage.setItem('opsmind_inventory_focus_mode', state.focusMode ? 'true' : 'false');
  applyFocusMode();
}

function updateDemoModeVisibility() {
  const panel = document.getElementById('iccDemoPanel');
  if (!panel) return;
  panel.classList.remove('d-none');
}

function openGuidedTour() {
  const panel = document.getElementById('iccDemoPanel');
  panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  advanceWalkthrough(true);
}

function buildDashboardExplanationPrompt() {
  const summary = buildSummary();
  const packet = buildBriefingEvidencePacket(summary);
  const topPriorities = packet.topPriorities
    .map((row) => `${row.title}: ${row.count} (${row.severity})`)
    .join('; ') || 'No urgent priorities';
  return [
    'Explain this Inventory Command Center dashboard using these facts only.',
    `Total assets: ${summary.totalAssets}.`,
    `Low stock: ${summary.lowStockCount}. EOL/high risk: ${summary.eolSoonCount + summary.highRiskCount}.`,
    `Pending approvals: ${summary.pendingApprovals}. Open POs: ${summary.openPurchaseOrders}.`,
    `Missing data records: ${summary.missingDataCount}. Data quality score: ${summary.dataQualityScore}%.`,
    `Audit issues: ${summary.auditIssueCount}. Stale telemetry: ${summary.staleTelemetryCount}.`,
    `Top priorities: ${topPriorities}.`,
    'Give a concise operations explanation, then recommend safe next actions. Do not invent vendors, prices, assets, or approvals.',
  ].join(' ');
}

async function loadCommandCenter(options = {}) {
  const background = Boolean(options.background);
  if (state.refreshing) return;
  state.refreshing = true;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  if (background) updateFreshnessStatus('refreshing', 'Refreshing...');
  else setLoading(true, 'Loading Inventory Command Center...');
  if (!background) renderSkeletons();
  state.errors = [];

  try {
    const [assetsRes, boardRes, auditRes, executiveRes, alertsRes, alertRulesRes, eolTimelineRes] = await Promise.allSettled([
      fetchAllAssets(),
      readJson('/inventory/procurement/board?status=all'),
      readJson('/inventory/audit-board'),
      readJson('/inventory/executive-dashboard'),
      readJson('/inventory/alerts?status=open&limit=80'),
      readJson('/inventory/alerts/rules'),
      postJson('/inventory/eol-budget-report', { monthsAhead: state.eolBudgetHorizon || 12 }),
    ]);

    if (assetsRes.status === 'fulfilled') state.assets = assetsRes.value;
    else state.errors.push(`Assets: ${assetsRes.reason?.message || 'failed'}`);

    if (boardRes.status === 'fulfilled') state.board = boardRes.value;
    else state.errors.push(`Procurement: ${boardRes.reason?.message || 'failed'}`);

    if (auditRes.status === 'fulfilled') state.audit = auditRes.value;
    else state.errors.push(`Audit: ${auditRes.reason?.message || 'failed'}`);

    if (executiveRes.status === 'fulfilled') state.executive = executiveRes.value;
    else state.errors.push(`Executive dashboard: ${executiveRes.reason?.message || 'failed'}`);

    if (alertsRes.status === 'fulfilled') state.smartAlerts = alertsRes.value;
    else state.errors.push(`Smart alerts: ${alertsRes.reason?.message || 'failed'}`);

    if (alertRulesRes.status === 'fulfilled') state.alertRules = alertRulesRes.value;
    else state.errors.push(`Alert rules: ${alertRulesRes.reason?.message || 'failed'}`);

    if (eolTimelineRes.status === 'fulfilled') state.eolBudgetTimeline = eolTimelineRes.value;
    else state.errors.push(`EOL budget forecast: ${eolTimelineRes.reason?.message || 'failed'}`);

    state.loadedAt = new Date().toISOString();
    renderAll();

    if (state.errors.length) {
      setError(`Loaded with partial data. ${state.errors.join(' | ')}`);
      if (!background) UI.warning('Inventory Command Center loaded with partial data.');
    } else {
      setLoading(false);
    }
  } finally {
    state.refreshing = false;
    if (background) requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));
  }
}

function navigateToInventoryAction(action, prompt = '') {
  const safeAction = String(action || '').trim();
  if (safeAction) sessionStorage.setItem('inventory_command_action', safeAction);
  if (prompt) sessionStorage.setItem('inventory_copilot_prefill', prompt);
  window.location.href = '/pages/inventory.html';
}

function openCommandCenterCopilot(prompt = 'What needs attention today?') {
  if (typeof window.openInventoryAiChatWithPrompt === 'function') {
    window.openInventoryAiChatWithPrompt(prompt);
    return;
  }
  navigateToInventoryAction('ai', prompt);
}

async function evaluateSmartAlerts() {
  try {
    updateFreshnessStatus('refreshing', 'Evaluating durable smart-alert rules...');
    const result = await postJson('/inventory/alerts/evaluate', {});
    UI.success(`Smart alerts evaluated: ${formatCount(result.alertsCreatedOrUpdated || 0)} event(s) updated.`);
    await loadCommandCenter();
  } catch (error) {
    UI.error(error.message || 'Failed to evaluate smart alerts.');
    updateFreshnessStatus('error', 'Smart-alert evaluation failed.');
  }
}

function commandCenterCopilotContext() {
  const summary = buildSummary();
  return {
    page: 'inventory_command_center',
    dashboard: {
      totalAssets: summary.totalAssets,
      lowStockCount: summary.lowStockCount,
      highRiskCount: summary.highRiskCount,
      eolSoonCount: summary.eolSoonCount,
      pendingApprovals: summary.pendingApprovals,
      openPurchaseOrders: summary.openPurchaseOrders,
      missingDataCount: summary.missingDataCount,
      dataQualityScore: summary.dataQualityScore,
      auditIssueCount: summary.auditIssueCount,
      staleTelemetryCount: summary.staleTelemetryCount,
    },
    freshness: state.loadedAt,
    source: 'inventory_command_center_loaded_evidence',
  };
}

function handleAction(action) {
  const value = String(action || '').trim();
  if (value === 'explain-dashboard') {
    openCommandCenterCopilot(buildDashboardExplanationPrompt());
    return;
  }
  if (value === 'assets') {
    window.location.href = '/pages/inventory.html';
    return;
  }
  if (value === 'procurement') {
    window.location.href = '/pages/procurement.html';
    return;
  }
  if (value === 'evaluate-alerts') {
    evaluateSmartAlerts();
    return;
  }
  if (value === 'import') {
    navigateToInventoryAction('import');
    return;
  }
  if (value === 'create') {
    navigateToInventoryAction('create');
    return;
  }
  if (value === 'audit') {
    navigateToInventoryAction('audit');
    return;
  }
  if (value === 'asset-map') {
    navigateToInventoryAction('asset-map');
    return;
  }
  if (value === 'ai') {
    openCommandCenterCopilot('What needs attention today? Explain priorities from this Command Center page using real evidence only.');
  }
}

function findPriorityById(id = '') {
  const rows = buildPriorityEvidence(buildSummary());
  return rows.find((row) => priorityId(row) === String(id || '').trim()) || null;
}

function diagnosticsFeatureRows(aiReady, diagnostics = {}) {
  const source = aiReady ? 'AI insight ready' : 'System data available';
  const model = diagnostics?.llm_model || diagnostics?.model || 'local AI model';
  return [
    ['Inventory AI Daily Briefing', 'Yes', source, 'Creates a narrative from precomputed inventory/procurement evidence.'],
    ['Explain this dashboard', 'Estimated', source, 'Facts come from the Command Center; AI insight explains them.'],
    ['Inventory 360 explanation', 'Estimated', source, 'System metrics first, AI narrative second.'],
    ['Asset health summary', 'Yes', source, 'Uses compact CMDB evidence for one asset.'],
    ['Procurement recommendation explanation', 'Estimated', source, 'Recommendations are grounded in stock, EOL, audit, and request data.'],
    ['Vendor quote comparison explanation', 'Estimated', source, 'Quote facts stay system-calculated; AI insight explains tradeoffs.'],
    ['Budget impact explanation', 'Estimated', source, 'Budget math stays system-calculated; AI insight summarizes implications.'],
    ['FIFO explanation', 'Estimated', source, 'Batch order is system-calculated; AI insight explains the recommendation.'],
    ['EOQ/MOQ explanation', 'Estimated', source, 'EOQ/MOQ math is system-calculated; AI insight explains missing data/conflicts.'],
    ['Copilot prompt response', 'Yes/Estimated', source, `Routes through Inventory AI service when ${model} is available.`],
  ];
}

async function fetchGemmaDiagnostics() {
  const startedAt = performance.now();
  const [healthRes, diagnosticsRes, backendRes, testRes] = await Promise.allSettled([
    fetch(`${INVENTORY_AI_URL}/health`).then((response) => response.json()),
    fetch(`${INVENTORY_AI_URL}/ai/diagnostics`).then((response) => response.json()),
    readJson('/inventory/ai/diagnostics'),
    postJson('/inventory/ai/test-gemma', {}),
  ]);
  const health = healthRes.status === 'fulfilled' ? healthRes.value : { error: healthRes.reason?.message || 'Inventory AI health unavailable' };
  const diagnostics = diagnosticsRes.status === 'fulfilled' ? diagnosticsRes.value : { error: diagnosticsRes.reason?.message || 'Inventory AI diagnostics unavailable' };
  const backend = backendRes.status === 'fulfilled' ? backendRes.value : { error: backendRes.reason?.message || 'Backend diagnostics unavailable' };
  const test = testRes.status === 'fulfilled' ? testRes.value : { error: testRes.reason?.message || 'Backend AI test unavailable' };
  const latencyMs = Math.round(performance.now() - startedAt);
  return { health, diagnostics, backend, test, latencyMs };
}

function renderGemmaDiagnosticsBody(result) {
  const health = result?.health || {};
  const diagnostics = result?.diagnostics || {};
  const backend = result?.backend || {};
  const test = result?.test || {};
  const aiReady = String(health.llm_status || diagnostics.llm_status || '').toLowerCase() === 'ready'
    || Boolean(test.llmUsed || test.usedGemma || test.gemmaUsed);
  const model = health.llm_model || diagnostics.llm_model || diagnostics.model || test.model || 'Unknown';
  const provider = health.llm_provider || diagnostics.llm_provider || 'Unknown';
  const lastError = health.llm_last_error || diagnostics.llm_last_error || backend.error || test.error || '';
  const rows = diagnosticsFeatureRows(aiReady, diagnostics);
  return `
    <div class="ops-gemma-diagnostics">
      <div class="ops-gemma-summary ${aiReady ? 'is-ready' : 'is-fallback'}">
        <div>
          <div class="ops-gemma-kicker">Inventory AI diagnostics</div>
          <h3>${escapeHtml(aiReady ? 'AI insight is ready for inventory features' : 'AI insight readiness needs attention')}</h3>
          <p>${escapeHtml(aiReady ? 'Feature facts remain system-calculated; AI insight is available for explanation and summarization.' : 'OpsMind will keep system data available until AI insight responds successfully.')}</p>
        </div>
        <span class="ops-attention-pill ${aiReady ? 'is-healthy' : 'is-review'}">${escapeHtml(aiReady ? 'AI insight ready' : 'System data mode')}</span>
      </div>
      <div class="ops-gemma-metrics">
        <div><strong>Provider</strong><span>${escapeHtml(provider)}</span></div>
        <div><strong>Model</strong><span>${escapeHtml(model)}</span></div>
        <div><strong>Latency</strong><span>${escapeHtml(`${result?.latencyMs ?? '-'} ms`)}</span></div>
        <div><strong>Ollama tags</strong><span>${escapeHtml(String(diagnostics.ollama_tags_reachable ?? diagnostics.tagsReachable ?? 'Unknown'))}</span></div>
        <div><strong>Selected model</strong><span>${escapeHtml(String(diagnostics.selected_model_present ?? diagnostics.modelPresent ?? 'Unknown'))}</span></div>
        <div><strong>Backend bridge</strong><span>${escapeHtml(backend.error ? 'Unavailable' : 'Reachable')}</span></div>
      </div>
      ${lastError ? `<div class="ops-gemma-warning">Latest diagnostic note: ${escapeHtml(String(lastError).replace(/_/g, ' '))}</div>` : ''}
      <div class="table-responsive">
        <table class="table table-sm align-middle ops-gemma-table">
          <thead><tr><th>AI feature</th><th>Uses AI insight?</th><th>Readiness/source</th><th>Safe test note</th><th></th></tr></thead>
          <tbody>
            ${rows.map(([feature, requires, source, note]) => `
              <tr>
                <td>${escapeHtml(feature)}</td>
                <td>${escapeHtml(requires)}</td>
                <td><span class="ops-attention-pill ${aiReady ? 'is-healthy' : 'is-review'}">${escapeHtml(source)}</span></td>
                <td>${escapeHtml(note)}</td>
                <td class="text-end">
                  <button type="button" class="btn btn-sm btn-outline-secondary" data-icc-gemma-retest>Test</button>
                  <button type="button" class="btn btn-sm btn-outline-primary" data-icc-gemma-ask="${escapeHtml(feature)}">Ask AI</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function openGemmaDiagnostics() {
  const modalId = 'iccGemmaDiagnosticsModal';
  let modalEl = document.getElementById(modalId);
  if (!modalEl) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal fade" id="${modalId}" tabindex="-1" aria-labelledby="${modalId}Title" aria-hidden="true">
        <div class="modal-dialog modal-xl modal-dialog-scrollable">
          <div class="modal-content ops-diagnostics-modal">
            <div class="modal-header">
              <div>
                <h5 class="modal-title" id="${modalId}Title">AI diagnostics</h5>
                <div class="modal-subtitle">Read-only checks for Inventory AI routing, model readiness, and system-data safety.</div>
              </div>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close AI diagnostics"></button>
            </div>
            <div class="modal-body" id="${modalId}Body">
              <div class="ops-loading-stack">
                <span class="ops-skeleton-line lg"></span>
                <span class="ops-skeleton-line md"></span>
                <span class="ops-skeleton-card"></span>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Close</button>
              <button type="button" class="btn btn-primary" id="${modalId}RetestBtn">Retest AI</button>
            </div>
          </div>
        </div>
      </div>
    `);
    modalEl = document.getElementById(modalId);
    modalEl.addEventListener('click', (event) => {
      if (event.target?.closest('[data-icc-gemma-retest]')) openGemmaDiagnostics();
      const askBtn = event.target?.closest('[data-icc-gemma-ask]');
      if (askBtn) {
        const feature = askBtn.getAttribute('data-icc-gemma-ask') || 'Inventory AI';
        navigateToInventoryAction('ai', `Test AI insight for ${feature}. Use real inventory/procurement evidence only and state whether AI insight, estimated, or system data was used.`);
      }
    });
    document.getElementById(`${modalId}RetestBtn`)?.addEventListener('click', () => openGemmaDiagnostics());
  }
  const body = document.getElementById(`${modalId}Body`);
  if (body) {
    body.innerHTML = `
      <div class="ops-loading-stack">
        <span class="ops-skeleton-line lg"></span>
        <span class="ops-skeleton-line md"></span>
        <span class="ops-skeleton-card"></span>
      </div>
    `;
  }
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  try {
    const result = await fetchGemmaDiagnostics();
    if (body) body.innerHTML = renderGemmaDiagnosticsBody(result);
  } catch (error) {
    if (body) body.innerHTML = emptyState('Diagnostics unavailable', error.message || 'Could not complete read-only AI diagnostics.');
  }
}

function setupAutoRefresh() {
  if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
  state.autoRefreshTimer = setInterval(() => {
    if (!autoRefreshEnabled() || shouldPauseAutoRefresh()) {
      updateFreshnessStatus('ready');
      return;
    }
    loadCommandCenter({ background: true }).catch((error) => {
      console.warn('[InventoryCommandCenter] Auto refresh failed:', error?.message || error);
      updateFreshnessStatus('error', 'Failed to auto-refresh Command Center evidence.');
    });
  }, AUTO_REFRESH_INTERVAL_MS);
}

function bindActions() {
  const refreshBtn = document.getElementById('iccRefreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => loadCommandCenter());
  const focusBtn = document.getElementById('iccFocusModeBtn');
  if (focusBtn) focusBtn.addEventListener('click', () => setFocusMode(!state.focusMode));
  const explainBtn = document.getElementById('iccExplainDashboardBtn');
  if (explainBtn) explainBtn.addEventListener('click', () => handleAction('explain-dashboard'));
  const gemmaBtn = document.getElementById('iccGemmaDiagnosticsBtn');
  if (gemmaBtn) gemmaBtn.addEventListener('click', () => openGemmaDiagnostics());
  const guidedTourBtn = document.getElementById('iccGuidedTourBtn');
  if (guidedTourBtn) guidedTourBtn.addEventListener('click', () => openGuidedTour());
  const demoStartBtn = document.getElementById('iccDemoStartBtn');
  const demoNextBtn = document.getElementById('iccDemoNextBtn');
  if (demoStartBtn) demoStartBtn.addEventListener('click', () => advanceWalkthrough(true));
  if (demoNextBtn) demoNextBtn.addEventListener('click', () => advanceWalkthrough(false));

  document.addEventListener('click', (event) => {
    const actionBtn = event.target?.closest('[data-icc-action]');
    if (actionBtn) {
      handleAction(actionBtn.getAttribute('data-icc-action'));
      return;
    }
    const doneBtn = event.target?.closest('[data-icc-priority-done]');
    if (doneBtn) {
      const row = findPriorityById(doneBtn.getAttribute('data-icc-priority-done'));
      if (row) markPriorityDone(row);
      return;
    }
    const dismissBtn = event.target?.closest('[data-icc-priority-dismiss]');
    if (dismissBtn) {
      const row = findPriorityById(dismissBtn.getAttribute('data-icc-priority-dismiss'));
      if (row) openPriorityDismissModal(row);
      return;
    }
    const restoreBtn = event.target?.closest('[data-icc-priority-restore]');
    if (restoreBtn) {
      restorePriority(restoreBtn.getAttribute('data-icc-priority-restore'));
      return;
    }
    const qualityBtn = event.target?.closest('[data-icc-quality-fix]');
    if (qualityBtn) {
      openDataQualityFixModal(qualityBtn.getAttribute('data-icc-quality-fix') || 'all');
      return;
    }
    const horizonBtn = event.target?.closest('[data-icc-eol-horizon]');
    if (horizonBtn) {
      setEolBudgetHorizon(horizonBtn.getAttribute('data-icc-eol-horizon'));
      return;
    }
    const quarterBtn = event.target?.closest('[data-icc-eol-quarter]');
    if (quarterBtn) {
      state.eolBudgetSelectedQuarter = String(quarterBtn.getAttribute('data-icc-eol-quarter') || '');
      renderBudget(buildSummary());
      return;
    }
    const promptBtn = event.target?.closest('[data-icc-ai-prompt]');
    if (promptBtn) {
      const prompt = String(promptBtn.getAttribute('data-icc-ai-prompt') || '').trim();
      openCommandCenterCopilot(prompt || 'What needs attention today?');
    }
  });
  document.addEventListener('change', (event) => {
    const eolFilter = event.target?.closest('[data-icc-eol-filter]');
    if (eolFilter) {
      const key = String(eolFilter.getAttribute('data-icc-eol-filter') || '');
      if (['department', 'building', 'category'].includes(key)) {
        state.eolBudgetFilters[key] = eolFilter.value || 'all';
        state.eolBudgetSelectedQuarter = '';
        renderBudget(buildSummary());
      }
    }
  });
  applyFocusMode();
  updateDemoModeVisibility();
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!ensureAccess()) return;
  writePriorityState(readPriorityState());
  initInventoryAiCopilot({
    pageKey: 'inventory_command_center',
    pageLabel: 'Command Center',
    contextProvider: commandCenterCopilotContext,
    prompts: [
      { label: 'What needs attention?', prompt: 'What needs attention today on this Inventory Command Center?' },
      { label: 'Explain this page', prompt: 'Explain this Command Center using only loaded inventory and procurement evidence.' },
      { label: 'Cost risks', prompt: 'Show cost and budget risks from this Command Center.' },
      { label: 'Missing data', prompt: 'Which missing data weakens inventory confidence most?' },
    ],
    quickActions: [
      { label: 'Open Inventory 360', url: '/pages/inventory.html#inventory360' },
      { label: 'Open Procurement', url: '/pages/procurement.html' },
    ],
  });
  bindActions();
  setupAutoRefresh();
  await loadCommandCenter();
});
