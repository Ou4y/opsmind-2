import UI from '/assets/js/ui.js';
import AuthService from '/services/authService.js';

const API_URL = window.OPSMIND_INVENTORY_API_URL || 'http://localhost:5000/api';
const INVENTORY_AI_URL = window.OPSMIND_INVENTORY_AI_API_URL || 'http://localhost:8002';
const ALLOWED_LEVELS = new Set(['JUNIOR', 'SENIOR', 'SUPERVISOR']);
const PAGE_SIZE = 500;
const MAX_ASSET_PAGES = 12;
const AUTO_REFRESH_INTERVAL_MS = 60 * 1000;
const AUTO_REFRESH_PREF_KEY = 'opsmind_auto_refresh_enabled';

const state = {
  assets: [],
  board: null,
  audit: null,
  executive: null,
  loadedAt: null,
  errors: [],
  briefingRequestId: 0,
  autoRefreshTimer: null,
  refreshing: false,
  walkthroughStep: -1,
  focusMode: String(localStorage.getItem('opsmind_inventory_focus_mode') || '').toLowerCase() === 'true',
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
    text.textContent = message || 'Refreshing Command Center evidence...';
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

function getWarrantyEnd(asset = {}) {
  const specs = readSpecs(asset);
  return asset.warrantyEndDate || specs.warrantyEndDate || specs.warrantyEnd || null;
}

function getPurchaseDate(asset = {}) {
  const specs = readSpecs(asset);
  return asset.purchaseDate || specs.purchaseDate || specs.acquiredAt || null;
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

function missingDataForAsset(asset = {}) {
  const missing = [];
  if (!hasValue(asset.serialNumber) && !hasValue(readSpecs(asset).serialNumber)) missing.push('serial');
  if (!hasValue(asset.department) || displayDepartment(asset.department) === 'Unassigned') missing.push('department');
  if (!hasValue(asset.location) || displayLocation(asset.location) === 'Unassigned') missing.push('location');
  if (!hasValue(getPurchaseDate(asset))) missing.push('purchase date');
  if (!hasValue(getWarrantyEnd(asset))) missing.push('warranty');
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

function sourceLabel(row = {}) {
  const raw = row.sourceLabel || row.source || row.aiSource || row.recommendationSource || '';
  const key = normalize(raw);
  if (key.includes('gemma')) return 'Gemma';
  if (key.includes('hybrid')) return 'Hybrid';
  if (key.includes('fallback')) return 'Fallback';
  if ((key.includes('ai') || key.includes('plus')) && key.includes('deterministic')) return 'Hybrid';
  if (key.includes('deterministic') || key.includes('rule')) return 'Deterministic';
  return raw ? toTitle(raw) : 'Deterministic';
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
  const totalQualityChecks = Math.max(1, assets.length * 5);
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
  return `
    <details class="icc-evidence-panel">
      <summary>
        <span>${escapeHtml(title)}</span>
        <span class="ops-attention-pill is-info">${escapeHtml(source)}</span>
      </summary>
      <div class="icc-evidence-body">
        <div class="icc-evidence-grid">
          <div>
            <strong>Source</strong>
            <span>${escapeHtml(source)}</span>
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
      title: 'Missing data',
      count: summary.missingDataCount,
      severity: summary.missingDataCount ? 'Medium' : 'Healthy',
      explanation: 'Records missing serial, department, location, purchase date, or warranty.',
      evidence: [`${summary.missingDataCount} asset record(s) missing key fields`, `Data quality score ${summary.dataQualityScore}%`],
      missingData: ['Serials', 'department/location', 'purchase date', 'warranty when absent'],
      action: 'Ask AI',
      actionAttr: 'data-icc-ai-prompt="Show missing data and suggest fixes."',
      icon: 'bi-database-exclamation',
    },
    {
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

function priorityCard({ title, count, severity, explanation, actionAttr, action, evidence = [], missingData = [], icon = 'bi-exclamation-circle' }) {
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
  document.getElementById('iccPrioritiesGrid').innerHTML = rows.map(priorityCard).join('');
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
      </div>
    </article>
  `;
}

function renderTodaysMission(summary) {
  const el = document.getElementById('iccTodaysMission');
  if (!el) return;
  const rows = buildPriorityEvidence(summary)
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
  const sourceText = llmUsed ? 'Gemma-generated' : source;
  if (sourceEl) {
    sourceEl.textContent = sourceText;
    sourceEl.className = `ops-attention-pill ${llmUsed ? 'is-healthy' : (source === 'Fallback' ? 'is-review' : 'is-info')}`;
  }
  el.innerHTML = `
    <div class="icc-briefing-head">
      <div class="icc-briefing-mark" aria-hidden="true"><i class="bi bi-stars"></i></div>
      <div>
        <div class="icc-briefing-kicker">Daily operations briefing</div>
        <h3>${escapeHtml(llmUsed ? 'Gemma summarized today\'s inventory evidence' : 'Deterministic briefing from loaded evidence')}</h3>
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
    sourceEl.textContent = 'Gemma thinking';
    sourceEl.className = 'ops-attention-pill is-info';
  }
  if (el) {
    el.innerHTML = `
      <div class="icc-briefing-thinking">
        <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
        <div>
          <strong>Gemma is preparing your briefing...</strong>
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
      source: result?.fallbackUsed ? 'Fallback' : (llmUsed ? 'Gemma-generated' : 'Deterministic'),
      fallbackReason: result?.fallbackUsed ? `Fallback used: ${String(result?.fallbackReason || 'Gemma was unavailable for this request.').replace(/_/g, ' ')}` : '',
      llmUsed,
    });
  } catch (error) {
    if (requestId !== state.briefingRequestId) return;
    renderDailyBriefingCard({
      text: deterministicBriefingText(packet),
      packet,
      source: 'Fallback',
      fallbackReason: `Fallback used: ${error.message || 'Inventory AI briefing endpoint was unavailable.'}`,
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

  const warrantyExpiring = state.assets.filter((asset) => {
    const end = getWarrantyEnd(asset);
    if (!end) return false;
    const parsed = new Date(end);
    if (Number.isNaN(parsed.getTime())) return false;
    const days = (parsed.getTime() - Date.now()) / 86400000;
    return days >= 0 && days <= 90;
  }).length;
  const warrantySummary = document.getElementById('iccWarrantySummary');
  if (warrantySummary) {
    warrantySummary.textContent = warrantyExpiring
      ? `${warrantyExpiring} asset(s) have warranty dates expiring within 90 days. Contract workflow remains Phase 2 unless stored contract data exists.`
      : 'Warranty coverage appears when asset fields are present. Contract renewal workflow is Phase 2 unless backed by stored contract data.';
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
  if (summary.eolSoonCount) alerts.push(alertItem('High', `${summary.eolSoonCount} asset(s) near EOL`, 'Lifecycle/warranty evidence', 'Open Asset Review', 'data-icc-ai-prompt="Which assets are near EOL?"'));
  if (summary.pendingApprovals) alerts.push(alertItem('Medium', `${summary.pendingApprovals} procurement approval(s) pending`, 'Procurement status counts', 'Open Procurement', 'data-icc-action="procurement"'));
  if (summary.lowStockCount) alerts.push(alertItem('High', `${summary.lowStockCount} item(s) below reorder point`, 'Spare stock / consumable forecast', 'Create Request', 'data-icc-action="procurement"'));
  if (summary.openPurchaseOrders) alerts.push(alertItem('Medium', `${summary.openPurchaseOrders} open purchase order(s)`, 'Procurement board analytics', 'Open POs', 'data-icc-action="procurement"'));
  if (summary.staleTelemetryCount) alerts.push(alertItem('Medium', `${summary.staleTelemetryCount} stale telemetry device(s)`, 'Telemetry freshness evidence', 'View Evidence', 'data-icc-ai-prompt="Which devices have stale telemetry?"'));
  if (summary.missingDataCount) alerts.push(alertItem('Medium', `${summary.missingDataCount} record(s) missing key data`, 'CMDB completeness check', 'Ask AI', 'data-icc-ai-prompt="Show missing inventory data."'));
  if (summary.budgetWarnings) alerts.push(alertItem('High', 'Budget availability is below zero', 'Finance foundation totals', 'Open Finance', 'data-icc-action="procurement"'));
  if (numberValue(summary.analytics?.fifo?.staleBatchCount)) alerts.push(alertItem('Medium', 'FIFO stale batch review needed', 'FIFO batch age evidence', 'Open Procurement', 'data-icc-action="procurement"'));
  if (numberValue(summary.analytics?.eoqMoq?.missingDataItems)) alerts.push(alertItem('Medium', 'EOQ/MOQ inputs missing', 'EOQ decision-support data quality', 'Open Procurement', 'data-icc-action="procurement"'));
  document.getElementById('iccAttentionCenter').innerHTML = alerts.length
    ? alerts.join('')
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
      groups.set(key, { label: key, total: 0, eol: 0, risk: 0, missing: 0, audit: 0, stale: 0 });
    }
    const group = groups.get(key);
    const id = getAssetId(asset);
    group.total += 1;
    if (isNearEol(asset)) group.eol += 1;
    if (riskAssetIds.has(id)) group.risk += 1;
    if (missingDataForAsset(asset).length) group.missing += 1;
    if (auditAssetIds.has(id)) group.audit += 1;
    if (getTelemetryInfo(asset).stale) group.stale += 1;
  });

  const rows = Array.from(groups.values())
    .map((group) => ({ ...group, score: group.eol * 3 + group.risk * 4 + group.audit * 3 + group.stale * 2 + group.missing }))
    .sort((a, b) => b.score - a.score || b.total - a.total)
    .slice(0, 8);

  document.getElementById('iccRiskHeatmap').innerHTML = rows.length ? rows.map((row) => {
    const severity = row.score >= 8 ? 'high' : (row.score >= 3 ? 'medium' : 'healthy');
    const reasons = [
      row.eol ? `${row.eol} EOL signal(s)` : '',
      row.risk ? `${row.risk} high-risk asset(s)` : '',
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
        <div class="icc-risk-score">${escapeHtml(String(row.score))}</div>
        <div class="icc-risk-level">Risk level: ${escapeHtml(toTitle(severity))}</div>
        <div class="icc-risk-reasons">
          <span>EOL ${escapeHtml(String(row.eol))}</span>
          <span>Risk ${escapeHtml(String(row.risk))}</span>
          <span>Missing ${escapeHtml(String(row.missing))}</span>
          <span>Audit ${escapeHtml(String(row.audit))}</span>
          <span>Telemetry ${escapeHtml(String(row.stale))}</span>
        </div>
        ${evidencePanel({
          title: 'Risk evidence',
          source: 'Deterministic risk radar',
          confidence: row.missing || row.stale ? 'Medium' : 'High',
          evidence: reasons.length ? reasons : ['No major risk signals in this building/department group'],
          missingData: row.missing ? ['Complete missing asset fields to improve radar confidence'] : [],
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

function qualityRow(label, count) {
  return `
    <div class="icc-quality-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(formatCount(count))}</strong>
    </div>
  `;
}

function renderDataQuality(summary) {
  const missingSerials = state.assets.filter((asset) => missingDataForAsset(asset).includes('serial')).length;
  const missingDepartments = state.assets.filter((asset) => missingDataForAsset(asset).includes('department')).length;
  const missingLocations = state.assets.filter((asset) => missingDataForAsset(asset).includes('location')).length;
  const missingPurchaseDates = state.assets.filter((asset) => missingDataForAsset(asset).includes('purchase date')).length;
  const missingWarranty = state.assets.filter((asset) => missingDataForAsset(asset).includes('warranty')).length;
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
      ${qualityRow('Missing serials', missingSerials)}
      ${qualityRow('Missing departments', missingDepartments)}
      ${qualityRow('Missing locations', missingLocations)}
      ${qualityRow('Missing purchase dates', missingPurchaseDates)}
      ${qualityRow('Missing warranty', missingWarranty)}
      ${qualityRow('Duplicate tags/IDs', summary.duplicateTags)}
      ${qualityRow('Unlinked related items', summary.unlinkedRelated)}
    </div>
    <div class="icc-chip-row mt-3">
      <button type="button" class="btn btn-sm btn-outline-primary" data-icc-action="assets">Open Assets</button>
      <button type="button" class="btn btn-sm btn-outline-primary" data-icc-ai-prompt="Show missing inventory data and list the highest priority cleanup actions.">View Missing Data</button>
      <button type="button" class="btn btn-sm btn-outline-primary" data-icc-ai-prompt="Show missing data and suggest fixes.">Ask AI to suggest fixes</button>
      <button type="button" class="btn btn-sm btn-outline-secondary" data-icc-action="import">Open import/match tools</button>
    </div>
  `;
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

function isDemoModeEnabled() {
  return String(localStorage.getItem('opsmind_demo_mode') || '').trim().toLowerCase() === 'true';
}

function updateDemoModeVisibility() {
  const panel = document.getElementById('iccDemoPanel');
  if (!panel) return;
  panel.classList.toggle('d-none', !isDemoModeEnabled());
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
  setLoading(true, background ? 'Refreshing Command Center evidence...' : 'Loading Inventory Command Center...');
  if (!background) renderSkeletons();
  state.errors = [];

  try {
    const [assetsRes, boardRes, auditRes, executiveRes] = await Promise.allSettled([
      fetchAllAssets(),
      readJson('/inventory/procurement/board?status=all'),
      readJson('/inventory/audit-board'),
      readJson('/inventory/executive-dashboard'),
    ]);

    if (assetsRes.status === 'fulfilled') state.assets = assetsRes.value;
    else state.errors.push(`Assets: ${assetsRes.reason?.message || 'failed'}`);

    if (boardRes.status === 'fulfilled') state.board = boardRes.value;
    else state.errors.push(`Procurement: ${boardRes.reason?.message || 'failed'}`);

    if (auditRes.status === 'fulfilled') state.audit = auditRes.value;
    else state.errors.push(`Audit: ${auditRes.reason?.message || 'failed'}`);

    if (executiveRes.status === 'fulfilled') state.executive = executiveRes.value;
    else state.errors.push(`Executive dashboard: ${executiveRes.reason?.message || 'failed'}`);

    state.loadedAt = new Date().toISOString();
    renderAll();

    if (state.errors.length) {
      setError(`Loaded with partial data. ${state.errors.join(' | ')}`);
      UI.warning('Inventory Command Center loaded with partial data.');
    } else {
      setLoading(false);
    }
  } finally {
    state.refreshing = false;
  }
}

function navigateToInventoryAction(action, prompt = '') {
  const safeAction = String(action || '').trim();
  if (safeAction) sessionStorage.setItem('inventory_command_action', safeAction);
  if (prompt) sessionStorage.setItem('inventory_copilot_prefill', prompt);
  window.location.href = '/pages/inventory.html';
}

function handleAction(action) {
  const value = String(action || '').trim();
  if (value === 'explain-dashboard') {
    navigateToInventoryAction('ai', buildDashboardExplanationPrompt());
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
    navigateToInventoryAction('ai', 'What needs attention today?');
  }
}

function diagnosticsFeatureRows(aiReady, diagnostics = {}) {
  const source = aiReady ? 'Gemma ready' : 'Fallback available';
  const model = diagnostics?.llm_model || diagnostics?.model || 'Gemma model';
  return [
    ['Inventory AI Daily Briefing', 'Yes', source, 'Creates a narrative from precomputed inventory/procurement evidence.'],
    ['Explain this dashboard', 'Hybrid', source, 'Facts come from the Command Center; Gemma explains them.'],
    ['Inventory 360 explanation', 'Hybrid', source, 'Deterministic metrics first, Gemma narrative second.'],
    ['Asset health summary', 'Yes', source, 'Uses compact CMDB evidence for one asset.'],
    ['Procurement recommendation explanation', 'Hybrid', source, 'Recommendations are grounded in stock, EOL, audit, and request data.'],
    ['Vendor quote comparison explanation', 'Hybrid', source, 'Quote facts remain deterministic; Gemma explains tradeoffs.'],
    ['Budget impact explanation', 'Hybrid', source, 'Budget math is deterministic; Gemma summarizes implications.'],
    ['FIFO explanation', 'Hybrid', source, 'Batch order is deterministic; Gemma explains the recommendation.'],
    ['EOQ/MOQ explanation', 'Hybrid', source, 'EOQ/MOQ math is deterministic; Gemma explains missing data/conflicts.'],
    ['Copilot prompt response', 'Yes/Hybrid', source, `Routes through Inventory AI service when ${model} is available.`],
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
  const test = testRes.status === 'fulfilled' ? testRes.value : { error: testRes.reason?.message || 'Backend Gemma test unavailable' };
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
          <h3>${escapeHtml(aiReady ? 'Gemma is ready for inventory AI features' : 'Gemma readiness needs attention')}</h3>
          <p>${escapeHtml(aiReady ? 'Feature facts remain deterministic; Gemma is available for explanation and summarization.' : 'OpsMind will keep deterministic fallback available until Gemma responds successfully.')}</p>
        </div>
        <span class="ops-attention-pill ${aiReady ? 'is-healthy' : 'is-review'}">${escapeHtml(aiReady ? 'Gemma ready' : 'Fallback mode')}</span>
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
          <thead><tr><th>AI feature</th><th>Requires Gemma</th><th>Source returned</th><th>Safe test note</th><th></th></tr></thead>
          <tbody>
            ${rows.map(([feature, requires, source, note]) => `
              <tr>
                <td>${escapeHtml(feature)}</td>
                <td>${escapeHtml(requires)}</td>
                <td><span class="ops-attention-pill ${aiReady ? 'is-healthy' : 'is-review'}">${escapeHtml(source)}</span></td>
                <td>${escapeHtml(note)}</td>
                <td class="text-end">
                  <button type="button" class="btn btn-sm btn-outline-secondary" data-icc-gemma-retest>Test</button>
                  <button type="button" class="btn btn-sm btn-outline-primary" data-icc-gemma-ask="${escapeHtml(feature)}">Ask Gemma</button>
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
                <h5 class="modal-title" id="${modalId}Title">Gemma diagnostics</h5>
                <div class="modal-subtitle">Read-only checks for Inventory AI routing, model readiness, and fallback honesty.</div>
              </div>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close Gemma diagnostics"></button>
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
              <button type="button" class="btn btn-primary" id="${modalId}RetestBtn">Retest Gemma</button>
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
        navigateToInventoryAction('ai', `Test Gemma for ${feature}. Use real inventory/procurement evidence only and state whether Gemma or fallback was used.`);
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
    if (body) body.innerHTML = emptyState('Diagnostics unavailable', error.message || 'Could not complete read-only Gemma diagnostics.');
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
    const promptBtn = event.target?.closest('[data-icc-ai-prompt]');
    if (promptBtn) {
      const prompt = String(promptBtn.getAttribute('data-icc-ai-prompt') || '').trim();
      navigateToInventoryAction('ai', prompt || 'What needs attention today?');
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'opsmind_demo_mode') updateDemoModeVisibility();
  });
  applyFocusMode();
  updateDemoModeVisibility();
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!ensureAccess()) return;
  bindActions();
  setupAutoRefresh();
  await loadCommandCenter();
});
