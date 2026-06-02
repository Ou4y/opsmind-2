import UI from '/assets/js/ui.js';
import AuthService from '/services/authService.js';

const API_URL = window.OPSMIND_INVENTORY_API_URL || 'http://localhost:5000/api';
const PROCUREMENT_STATUSES = [
  'Draft',
  'Submitted',
  'Under Review',
  'Approved',
  'Rejected',
  'Ordered',
  'Partially Received',
  'Received',
  'Closed',
  'Cancelled',
];
const PROCUREMENT_LIFECYCLE_STAGES = [
  'Draft',
  'Submitted',
  'Under Review',
  'Approved',
  'Ordered',
  'Partially Received',
  'Received',
  'Closed',
];
const STANDARD_MIU_DEPARTMENTS = [
  'Computer Science',
  'Business',
  'Mass Communication',
  'Pharmacy',
  'Dentistry',
  'Engineering',
  'Architecture',
  'ALSUN',
  'Unassigned',
];
const KNOWN_LOCATIONS = [
  'Central Warehouse',
  'Main Building',
  'K Building',
  'N Building',
  'S Building',
  'R Building',
  'Pharmacy Building',
  'Copy Center',
  'Mosque',
  'Workshop',
];
const ALLOWED_LEVELS = new Set(['JUNIOR', 'SENIOR', 'SUPERVISOR']);

const state = {
  board: null,
  loading: false,
  statusFilter: 'all',
  recentlyUpdatedRequestId: null,
  abcAnalysis: null,
  eoqMoq: null,
  fifo: null,
  finance: null,
  suppliers: null,
  supplierCatalog: null,
  requestView: localStorage.getItem('opsmind_procurement_request_view') || 'table',
};

function ensureAccess() {
  const context = AuthService.resolveUserDashboardContext(AuthService.getCurrentUser());
  const level = String(context.technicianLevel || '').toUpperCase();
  if (!AuthService.isAuthenticated() || (context.roleCategory !== 'ADMIN' && !ALLOWED_LEVELS.has(level))) {
    sessionStorage.setItem('opsmind_error', 'Access denied: Procurement is available only to Admin and Technician levels (Junior/Senior/Supervisor).');
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
    throw new Error('You do not have permission to perform this procurement action.');
  }
  return response;
}

async function readJson(path) {
  const response = await request(path);
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

function notify(message, type = 'info') {
  const safeType = String(type || 'info').toLowerCase();
  if (safeType === 'success') UI.success(message);
  else if (safeType === 'warning') UI.warning(message);
  else if (safeType === 'error') UI.error(message);
  else UI.info(message);
}

function escapeHtml(value) {
  return UI.escapeHTML(String(value ?? ''));
}

function normalizeValue(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function formatDate(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString();
}

function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '-';
  return amount.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function statusBadgeClass(status) {
  const normalized = normalizeValue(status);
  if (normalized === 'approved' || normalized === 'received' || normalized === 'closed') return 'bg-success';
  if (normalized === 'ordered' || normalized === 'partiallyreceived' || normalized === 'underreview' || normalized === 'submitted') return 'bg-warning text-dark';
  if (normalized === 'rejected' || normalized === 'cancelled') return 'bg-danger';
  return 'bg-secondary';
}

function urgencyClass(value) {
  const normalized = normalizeValue(value);
  if (['critical', 'urgent', 'high', 'overdue', 'a'].includes(normalized)) return 'is-urgent';
  if (['medium', 'warning', 'review', 'b'].includes(normalized)) return 'is-review';
  if (['low', 'healthy', 'good', 'c'].includes(normalized)) return 'is-healthy';
  return 'is-info';
}

function sourceLabel(row = {}) {
  const raw = row.sourceLabel || row.source || row.aiSource || row.recommendationSource || '';
  const normalized = normalizeValue(raw);
  if (normalized.includes('gemma')) return 'Gemma';
  if (normalized.includes('hybrid')) return 'Hybrid';
  if (normalized.includes('fallback')) return 'Fallback';
  if (normalized.includes('deterministic') || normalized.includes('rule')) return 'Deterministic';
  return raw ? String(raw).replace(/_/g, ' ') : 'Deterministic';
}

function buildLifecycleStepper(status) {
  const normalized = normalizeValue(status);
  const isTerminalException = normalized === 'rejected' || normalized === 'cancelled';
  if (isTerminalException) {
    return `
      <div class="proc-lifecycle-stepper is-exception" aria-label="Procurement lifecycle status">
        <span class="proc-lifecycle-exception">${escapeHtml(String(status || 'Stopped'))}</span>
      </div>
    `;
  }
  const currentIndex = Math.max(0, PROCUREMENT_LIFECYCLE_STAGES.findIndex((stage) => normalizeValue(stage) === normalized));
  return `
    <div class="proc-lifecycle-stepper" aria-label="Procurement lifecycle status">
      ${PROCUREMENT_LIFECYCLE_STAGES.map((stage, index) => {
        const stateClass = index < currentIndex ? 'is-complete' : (index === currentIndex ? 'is-current' : 'is-pending');
        return `
          <span class="proc-lifecycle-step ${stateClass}" title="${escapeHtml(stage)}">
            <span class="proc-lifecycle-dot" aria-hidden="true"></span>
            <span class="proc-lifecycle-label">${escapeHtml(stage)}</span>
          </span>
        `;
      }).join('')}
    </div>
  `;
}

function emptyStateRow(colspan, title, message, actionHtml = '') {
  return `
    <tr class="proc-empty-row">
      <td colspan="${Math.max(1, Number(colspan || 1))}">
        <div class="ops-empty-state-card">
          <div>
            <div class="ops-empty-state-title">${escapeHtml(title)}</div>
            <div class="ops-empty-state-copy">${escapeHtml(message)}</div>
          </div>
          ${actionHtml ? `<div class="ops-empty-state-actions">${actionHtml}</div>` : ''}
        </div>
      </td>
    </tr>
  `;
}

function markProcurementUpdated(requestId) {
  state.recentlyUpdatedRequestId = String(requestId || '').trim() || null;
  if (!state.recentlyUpdatedRequestId) return;
  window.setTimeout(() => {
    state.recentlyUpdatedRequestId = null;
    document.querySelectorAll('.proc-row-updated').forEach((row) => row.classList.remove('proc-row-updated'));
  }, 1800);
}

function setKpiValue(element, value) {
  if (!element) return;
  const next = Number(value || 0);
  element.textContent = String(next);
  element.classList.toggle('has-attention', next > 0 && element.id === 'procSummaryApprovals');
}

function buildTableSkeletonRow(colspan = 6, lines = 3) {
  const safeColspan = Math.max(1, Number(colspan || 1));
  const rows = Array.from({ length: Math.max(1, Number(lines || 2)) }).map((_, index) => {
    const sizeClass = index === 0 ? 'lg' : (index === 1 ? 'md' : 'sm');
    return `<span class="ops-skeleton-line ${sizeClass}"></span>`;
  }).join('');
  return `
    <tr class="ops-loading-row">
      <td colspan="${safeColspan}">
        <div class="ops-skeleton-table-stack">${rows}</div>
      </td>
    </tr>
  `;
}

function setProcurementSkeletonState() {
  const tableSkeletonMap = [
    ['procPriorityTableBody', 4],
    ['procRecommendationsTableBody', 7],
    ['procRequestsTableBody', 6],
    ['procQuotesTableBody', 8],
    ['procPurchaseOrdersTableBody', 6],
    ['procReceivingTableBody', 6],
    ['procAbcTableBody', 6],
    ['procEoqTableBody', 7],
    ['procFifoTableBody', 6],
    ['procFinanceTableBody', 7],
    ['procSuppliersTableBody', 5],
    ['procCatalogTableBody', 5],
  ];
  tableSkeletonMap.forEach(([id, colspan]) => {
    const bodyEl = document.getElementById(id);
    if (!bodyEl) return;
    bodyEl.innerHTML = buildTableSkeletonRow(colspan, 3);
  });
}

function setLoadingState(loading, message) {
  const dot = document.getElementById('procLoadDot');
  const text = document.getElementById('procLoadStatusText');
  state.loading = Boolean(loading);
  if (dot) {
    dot.classList.remove('ready', 'loading', 'error');
    dot.classList.add(loading ? 'loading' : 'ready');
  }
  if (text) text.textContent = message || (loading ? 'Loading procurement board...' : 'Ready.');
}

function setLoadError(message) {
  const dot = document.getElementById('procLoadDot');
  const text = document.getElementById('procLoadStatusText');
  if (dot) {
    dot.classList.remove('ready', 'loading');
    dot.classList.add('error');
  }
  if (text) text.textContent = message || 'Failed to load procurement board.';
}

function formatOptions(options = []) {
  return (Array.isArray(options) ? options : []).map((option) => {
    if (option && typeof option === 'object') {
      const value = String(option.value ?? '').trim();
      const label = String(option.label ?? value).trim() || value;
      return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    }
    const value = String(option ?? '').trim();
    return `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`;
  }).join('');
}

function normalizeFieldValue(field, value) {
  const type = String(field?.type || 'text').toLowerCase();
  if (type === 'checkbox') return Boolean(value);
  if (type === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const raw = String(value ?? '');
  return field?.trim === false ? raw : raw.trim();
}

function showFormModal(options = {}) {
  return new Promise((resolve) => {
    const fields = Array.isArray(options.fields) ? options.fields : [];
    const modalId = `procFormModal-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const title = String(options.title || 'Procurement Action');
    const message = String(options.message || '').trim();
    const messageHtml = String(options.messageHtml || '').trim();
    const confirmText = String(options.confirmText || 'Save');
    const cancelText = String(options.cancelText || 'Cancel');
    const confirmClass = String(options.confirmClass || 'btn-primary');
    const dialogClass = String(options.dialogClass || 'modal-lg');

    const fieldsHtml = fields.map((field, index) => {
      const name = String(field?.name || `field_${index}`).trim();
      const type = String(field?.type || 'text').toLowerCase();
      const id = `${modalId}-field-${index}`;
      const label = String(field?.label || name || `Field ${index + 1}`);
      const placeholder = String(field?.placeholder || '');
      const required = Boolean(field?.required);
      const helpText = String(field?.helpText || '');
      const colClass = String(field?.colClass || 'col-12');
      const rawValue = field?.value;
      const safeValue = rawValue === null || typeof rawValue === 'undefined' ? '' : String(rawValue);
      const requiredFlag = required ? 'required' : '';
      let inputHtml = '';

      if (type === 'textarea') {
        const rows = Math.max(2, Number(field?.rows || 3));
        inputHtml = `<textarea class="form-control form-control-sm" id="${id}" data-field-index="${index}" rows="${rows}" placeholder="${escapeHtml(placeholder)}" ${requiredFlag}>${escapeHtml(safeValue)}</textarea>`;
      } else if (type === 'select') {
        const includeBlank = !required || placeholder;
        inputHtml = `
          <select class="form-select form-select-sm" id="${id}" data-field-index="${index}" ${requiredFlag}>
            ${includeBlank ? `<option value="">${escapeHtml(placeholder || 'Select...')}</option>` : ''}
            ${formatOptions(field?.options || [])}
          </select>
        `;
      } else if (type === 'checkbox') {
        const checked = Boolean(rawValue) ? 'checked' : '';
        inputHtml = `
          <div class="form-check mt-1">
            <input class="form-check-input" type="checkbox" id="${id}" data-field-index="${index}" ${checked}>
            <label class="form-check-label small" for="${id}">${escapeHtml(label)}</label>
          </div>
        `;
      } else {
        inputHtml = `
          <input
            type="${escapeHtml(type || 'text')}"
            class="form-control form-control-sm"
            id="${id}"
            data-field-index="${index}"
            value="${escapeHtml(safeValue)}"
            placeholder="${escapeHtml(placeholder)}"
            ${field?.min !== undefined ? `min="${escapeHtml(String(field.min))}"` : ''}
            ${field?.max !== undefined ? `max="${escapeHtml(String(field.max))}"` : ''}
            ${field?.step !== undefined ? `step="${escapeHtml(String(field.step))}"` : ''}
            ${requiredFlag}
          >
        `;
      }

      return `
        <div class="${escapeHtml(colClass)}" data-field-wrapper="${index}">
          ${type === 'checkbox' ? '' : `<label class="form-label form-label-sm mb-1 fw-semibold" for="${id}">${escapeHtml(label)}${required ? ' *' : ''}</label>`}
          ${inputHtml}
          ${helpText ? `<div class="form-text small">${escapeHtml(helpText)}</div>` : ''}
          <div class="invalid-feedback" id="${id}-feedback"></div>
        </div>
      `;
    }).join('');

    const html = `
      <div class="modal fade" id="${modalId}" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered ${escapeHtml(dialogClass)}">
          <div class="modal-content border-0 shadow proc-workflow-modal">
            <div class="modal-header">
              <div>
                <h5 class="modal-title fw-bold">${escapeHtml(title)}</h5>
                ${message ? `<div class="proc-modal-subtitle">${escapeHtml(message)}</div>` : ''}
              </div>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
              ${messageHtml ? `<div class="proc-modal-guidance">${messageHtml}</div>` : ''}
              <form id="${modalId}-form" novalidate>
                <div class="row g-2">${fieldsHtml}</div>
              </form>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">${escapeHtml(cancelText)}</button>
              <button type="button" class="btn ${escapeHtml(confirmClass)}" id="${modalId}-confirm">${escapeHtml(confirmText)}</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    const modalEl = document.getElementById(modalId);
    const formEl = document.getElementById(`${modalId}-form`);
    const confirmBtn = document.getElementById(`${modalId}-confirm`);
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    let settled = false;

    const setError = (index, messageText) => {
      const input = formEl?.querySelector(`[data-field-index="${index}"]`);
      if (!input) return;
      input.classList.add('is-invalid');
      const feedback = modalEl?.querySelector(`#${input.id}-feedback`);
      if (feedback) feedback.textContent = String(messageText || 'Required field.');
    };

    const clearError = (index) => {
      const input = formEl?.querySelector(`[data-field-index="${index}"]`);
      if (!input) return;
      input.classList.remove('is-invalid');
      const feedback = modalEl?.querySelector(`#${input.id}-feedback`);
      if (feedback) feedback.textContent = '';
    };

    confirmBtn?.addEventListener('click', () => {
      const values = {};
      let hasError = false;
      fields.forEach((_, idx) => clearError(idx));

      for (let index = 0; index < fields.length; index += 1) {
        const field = fields[index];
        const name = String(field?.name || `field_${index}`).trim();
        const type = String(field?.type || 'text').toLowerCase();
        const input = formEl?.querySelector(`[data-field-index="${index}"]`);
        if (!input) continue;

        const rawValue = type === 'checkbox' ? Boolean(input.checked) : input.value;
        const normalized = normalizeFieldValue(field, rawValue);
        values[name] = normalized;

        if (field?.required) {
          const missing = type === 'checkbox' ? !Boolean(normalized) : !String(normalized ?? '').trim();
          if (missing) {
            setError(index, `${field?.label || name} is required.`);
            if (!hasError) input.focus();
            hasError = true;
            continue;
          }
        }

        if (typeof field?.validate === 'function') {
          const errorText = field.validate(normalized, values);
          if (errorText) {
            setError(index, errorText);
            if (!hasError) input.focus();
            hasError = true;
          }
        }
      }

      if (hasError) return;
      settled = true;
      modal.hide();
      resolve({ confirmed: true, values });
    });

    modalEl?.addEventListener('hidden.bs.modal', () => {
      modalEl.remove();
      if (!settled) resolve({ confirmed: false, values: {} });
    }, { once: true });

    modal.show();
    setTimeout(() => {
      fields.forEach((field, index) => {
        if (String(field?.type || '').toLowerCase() !== 'select') return;
        const select = formEl?.querySelector(`[data-field-index="${index}"]`);
        const value = field?.value;
        if (!select || value === null || typeof value === 'undefined') return;
        select.value = String(value);
      });
      const first = modalEl?.querySelector('input,select,textarea');
      if (first && typeof first.focus === 'function') first.focus();
    }, 20);
  });
}

function getRequestById(requestId) {
  const rows = Array.isArray(state.board?.requests) ? state.board.requests : [];
  return rows.find((row) => String(row.requestId || '') === String(requestId || '')) || null;
}

function getBoardRequests() {
  return Array.isArray(state.board?.requests) ? state.board.requests : [];
}

function getBoardRecommendations() {
  return Array.isArray(state.board?.aiRecommendations) ? state.board.aiRecommendations : [];
}

function numericOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requestDisplayCost(row = {}) {
  const selectedQuote = Array.isArray(row.vendorQuotes) ? row.vendorQuotes.find((quote) => quote.selected) : null;
  return numericOrNull(selectedQuote?.totalPrice)
    ?? numericOrNull(row.actualCost)
    ?? numericOrNull(row.estimatedBudget)
    ?? null;
}

function quoteScore(quote = {}, allQuotes = []) {
  const prices = allQuotes.map((row) => numericOrNull(row.totalPrice)).filter((value) => value !== null && value > 0);
  const minPrice = prices.length ? Math.min(...prices) : null;
  const price = numericOrNull(quote.totalPrice);
  const warranty = numericOrNull(quote.warrantyMonths) || 0;
  const delivery = numericOrNull(quote.deliveryDays ?? quote.leadTimeDays) || 999;
  const reliability = numericOrNull(quote.reliabilityScore) || 0;
  const priceScore = minPrice && price ? Math.max(0, 40 - ((price - minPrice) / Math.max(minPrice, 1)) * 40) : 18;
  const warrantyScore = Math.min(20, warranty / 2);
  const deliveryScore = Math.max(0, 20 - Math.min(20, delivery / 2));
  const reliabilityScore = Math.min(20, reliability * 2);
  const selectedBonus = quote.selected ? 8 : 0;
  return Number((priceScore + warrantyScore + deliveryScore + reliabilityScore + selectedBonus).toFixed(2));
}

function quoteTradeoffText(quote = {}, isBest = false) {
  const parts = [];
  const price = numericOrNull(quote.totalPrice);
  const delivery = numericOrNull(quote.deliveryDays ?? quote.leadTimeDays);
  const warranty = numericOrNull(quote.warrantyMonths);
  const moq = numericOrNull(quote.minimumOrderQuantity);
  if (isBest) parts.push('Best value based on available price, delivery, warranty, reliability, and selection evidence.');
  if (price !== null) parts.push(`Total price ${formatCurrency(price)}`);
  if (delivery !== null) parts.push(`Delivery ${delivery} day(s)`);
  if (warranty !== null) parts.push(`Warranty ${warranty} month(s)`);
  if (moq !== null) parts.push(`MOQ ${moq}`);
  if (!parts.length) parts.push('Add price, warranty, delivery, MOQ, and reliability data to compare this quote properly.');
  return parts.join(' | ');
}

function renderKanbanBoard(requests = []) {
  const el = document.getElementById('procKanbanBoard');
  if (!el) return;
  if (!requests.length) {
    el.innerHTML = `
      <div class="ops-empty-state-card">
        <div>
          <div class="ops-empty-state-title">No requests on the board yet</div>
          <div class="ops-empty-state-copy">Create a procurement request from manual need, AI recommendation, low stock, EOL, audit, or maintenance evidence.</div>
        </div>
        <div class="ops-empty-state-actions">
          <button type="button" class="btn btn-sm btn-primary" id="procCreateKanbanEmptyBtn">Create Request</button>
        </div>
      </div>
    `;
    return;
  }
  const kanbanStages = [...PROCUREMENT_LIFECYCLE_STAGES, 'Stopped'];
  const columns = kanbanStages.map((status) => {
    const rows = status === 'Stopped'
      ? requests.filter((row) => ['rejected', 'cancelled'].includes(normalizeValue(row.status || '')))
      : requests.filter((row) => normalizeValue(row.status || 'Draft') === normalizeValue(status));
    return `
      <section class="proc-kanban-column" aria-label="${escapeHtml(status)} requests">
        <div class="proc-kanban-column-head">
          <span>${escapeHtml(status)}</span>
          <strong>${escapeHtml(String(rows.length))}</strong>
        </div>
        <div class="proc-kanban-cards">
          ${rows.slice(0, 5).map((row) => {
            const cost = requestDisplayCost(row);
            return `
              <article class="proc-kanban-card ${urgencyClass(row.priority || row.status)} ${String(row.requestId || '') === state.recentlyUpdatedRequestId ? 'proc-row-updated' : ''}">
                <div class="proc-kanban-card-top">
                  <span class="ops-attention-pill ${urgencyClass(row.priority || row.status)}">${escapeHtml(row.priority || 'Medium')}</span>
                  <span class="proc-kanban-id">${escapeHtml(row.requestId || '-')}</span>
                </div>
                <h6>${escapeHtml(row.title || row.itemType || 'Procurement request')}</h6>
                <p>${escapeHtml(row.reason || row.itemCategory || 'Review request details.')}</p>
                <div class="proc-kanban-meta">
                  <span>${escapeHtml(row.linkedDepartment || 'Unassigned')}</span>
                  <span>${escapeHtml(row.linkedLocation || '-')}</span>
                  <span>${cost !== null ? escapeHtml(formatCurrency(cost)) : 'Budget TBD'}</span>
                </div>
                <div class="proc-kanban-actions">
                  <button type="button" class="btn btn-sm btn-outline-primary" data-proc-view-request="${escapeHtml(row.requestId || '')}">Details</button>
                  <button type="button" class="btn btn-sm btn-outline-primary" data-proc-update-status="${escapeHtml(row.requestId || '')}">Status</button>
                  <button type="button" class="btn btn-sm btn-outline-secondary" data-proc-add-quote="${escapeHtml(row.requestId || '')}">Quote</button>
                </div>
              </article>
            `;
          }).join('') || '<div class="proc-kanban-empty">No requests in this stage.</div>'}
          ${rows.length > 5 ? `<div class="proc-kanban-more">${escapeHtml(String(rows.length - 5))} more in table</div>` : ''}
        </div>
      </section>
    `;
  }).join('');
  el.innerHTML = columns;
}

function renderRequestPriorityBoard(requests = []) {
  const el = document.getElementById('procRequestPriorityBoard');
  if (!el) return;
  if (!requests.length) {
    el.innerHTML = `
      <div class="ops-empty-state-card">
        <div>
          <div class="ops-empty-state-title">No requests to prioritize</div>
          <div class="ops-empty-state-copy">Create requests from low stock, EOL, audit, maintenance, AI recommendations, or manual demand.</div>
        </div>
      </div>
    `;
    return;
  }
  const lanes = [
    { key: 'critical', label: 'Critical / High', matcher: (row) => ['critical', 'high', 'urgent'].includes(normalizeValue(row.priority || row.urgency || '')) },
    { key: 'approval', label: 'Needs Approval', matcher: (row) => ['submitted', 'underreview'].includes(normalizeValue(row.status || '')) },
    { key: 'ordered', label: 'Ordered / Receiving', matcher: (row) => ['ordered', 'partiallyreceived'].includes(normalizeValue(row.status || '')) },
    { key: 'ai', label: 'AI / Evidence-led', matcher: (row) => normalizeValue(row.source || '').includes('ai') || normalizeValue(row.source || '').includes('eol') || normalizeValue(row.source || '').includes('lowstock') },
  ];
  el.innerHTML = lanes.map((lane) => {
    const rows = requests.filter(lane.matcher);
    return `
      <section class="proc-priority-lane ${urgencyClass(lane.key)}" aria-label="${escapeHtml(lane.label)}">
        <div class="proc-priority-lane-head">
          <span>${escapeHtml(lane.label)}</span>
          <strong>${escapeHtml(String(rows.length))}</strong>
        </div>
        <div class="proc-priority-lane-body">
          ${rows.slice(0, 6).map((row) => `
            <article class="proc-priority-request-card ${urgencyClass(row.priority || row.status)}">
              <div class="proc-priority-request-top">
                <span class="ops-attention-pill ${urgencyClass(row.priority || row.status)}">${escapeHtml(row.priority || 'Medium')}</span>
                <span>${escapeHtml(row.requestId || '-')}</span>
              </div>
              <h6>${escapeHtml(row.title || row.itemType || 'Procurement request')}</h6>
              <p>${escapeHtml(row.reason || 'Review the request evidence before action.')}</p>
              <div class="proc-priority-request-actions">
                <button type="button" class="btn btn-sm btn-outline-primary" data-proc-view-request="${escapeHtml(row.requestId || '')}">Details</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" data-proc-update-status="${escapeHtml(row.requestId || '')}">Status</button>
              </div>
            </article>
          `).join('') || '<div class="proc-kanban-empty">No matching requests.</div>'}
        </div>
      </section>
    `;
  }).join('');
}

function applyRequestViewMode() {
  const view = ['table', 'kanban', 'priority'].includes(state.requestView) ? state.requestView : 'table';
  state.requestView = view;
  const tablePanel = document.getElementById('procRequestsTablePanel');
  const kanbanPanel = document.getElementById('procKanbanPanel');
  const priorityPanel = document.getElementById('procRequestPriorityPanel');
  tablePanel?.classList.toggle('d-none', view !== 'table');
  kanbanPanel?.classList.toggle('d-none', view !== 'kanban');
  priorityPanel?.classList.toggle('d-none', view !== 'priority');
  document.querySelectorAll('[data-proc-request-view]').forEach((button) => {
    const active = button.getAttribute('data-proc-request-view') === view;
    button.classList.toggle('btn-primary', active);
    button.classList.toggle('btn-outline-primary', !active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function setRequestViewMode(view = 'table') {
  state.requestView = ['table', 'kanban', 'priority'].includes(view) ? view : 'table';
  localStorage.setItem('opsmind_procurement_request_view', state.requestView);
  applyRequestViewMode();
}

function renderVendorBattleCards(requests = []) {
  const el = document.getElementById('procVendorBattleCards');
  if (!el) return;
  const groups = [];
  requests.forEach((request) => {
    const quotes = Array.isArray(request.vendorQuotes) ? request.vendorQuotes : [];
    if (quotes.length) groups.push({ request, quotes });
  });
  if (!groups.length) {
    el.innerHTML = `
      <div class="ops-empty-state-card">
        <div>
          <div class="ops-empty-state-title">No vendor quotes yet</div>
          <div class="ops-empty-state-copy">Add quotes to compare price, warranty, delivery, MOQ, and reliability before selecting best value.</div>
        </div>
      </div>
    `;
    return;
  }
  el.innerHTML = groups.slice(0, 6).map(({ request, quotes }) => {
    const scored = quotes
      .map((quote) => ({ quote, score: quoteScore(quote, quotes) }))
      .sort((a, b) => b.score - a.score);
    const bestQuoteId = scored[0]?.quote?.quoteId || '';
    return `
      <article class="proc-vendor-battle-card">
        <div class="proc-vendor-battle-head">
          <div>
            <div class="proc-vendor-battle-kicker">${escapeHtml(request.requestId || '-')}</div>
            <h6>${escapeHtml(request.title || request.itemType || 'Vendor quote comparison')}</h6>
          </div>
          <span class="ops-attention-pill is-info">${escapeHtml(String(quotes.length))} quote(s)</span>
        </div>
        <div class="proc-vendor-card-row">
          ${scored.slice(0, 4).map(({ quote, score }) => {
            const isBest = String(quote.quoteId || '') === String(bestQuoteId || '');
            return `
              <div class="proc-vendor-mini-card ${isBest ? 'is-best-value' : ''}">
                <div class="proc-vendor-mini-head">
                  <strong>${escapeHtml(quote.vendorName || 'Vendor')}</strong>
                  ${isBest ? '<span class="ops-attention-pill is-healthy">Best Value</span>' : `<span class="ops-attention-pill is-info">Score ${escapeHtml(String(score))}</span>`}
                </div>
                <div class="proc-vendor-mini-metrics">
                  <span>Price ${escapeHtml(formatCurrency(quote.totalPrice))}</span>
                  <span>Delivery ${escapeHtml(String(quote.deliveryDays ?? quote.leadTimeDays ?? '-'))}d</span>
                  <span>Warranty ${escapeHtml(String(quote.warrantyMonths ?? '-'))}m</span>
                  <span>MOQ ${escapeHtml(String(quote.minimumOrderQuantity ?? '-'))}</span>
                </div>
                <details class="proc-ai-rec-evidence">
                  <summary>Why this value?</summary>
                  <div>${escapeHtml(quoteTradeoffText(quote, isBest))}</div>
                </details>
                <div class="proc-vendor-mini-actions">
                  <button type="button" class="btn btn-sm btn-outline-success" data-proc-quote-select="${escapeHtml(request.requestId || '')}" data-proc-quote-id="${escapeHtml(quote.quoteId || '')}">Select</button>
                  <button type="button" class="btn btn-sm btn-outline-danger" data-proc-quote-reject="${escapeHtml(request.requestId || '')}" data-proc-quote-id="${escapeHtml(quote.quoteId || '')}">Reject</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </article>
    `;
  }).join('');
}

function procurement360Evidence(title, evidence = [], missingData = []) {
  const evidenceRows = (Array.isArray(evidence) ? evidence : []).filter(Boolean);
  const missingRows = (Array.isArray(missingData) ? missingData : []).filter(Boolean);
  return `
    <details class="ops-360-evidence">
      <summary>View Evidence</summary>
      <div class="ops-360-evidence-body">
        <strong>${escapeHtml(title || 'Evidence')}</strong>
        ${evidenceRows.length ? `<ul>${evidenceRows.map((row) => `<li>${escapeHtml(row)}</li>`).join('')}</ul>` : '<p>No extra evidence rows.</p>'}
        ${missingRows.length ? `<p><strong>Missing data:</strong> ${escapeHtml(missingRows.join(', '))}</p>` : ''}
      </div>
    </details>
  `;
}

function procurement360Card({ title, value, subtitle, severity = 'info', source = 'Deterministic', evidence = [], missingData = [], actions = [] } = {}) {
  return `
    <article class="ops-360-card ${urgencyClass(severity)}">
      <div class="ops-360-card-head">
        <div>
          <div class="ops-360-card-kicker">${escapeHtml(source)}</div>
          <h3>${escapeHtml(title || 'Procurement insight')}</h3>
        </div>
        <span class="ops-attention-pill ${urgencyClass(severity)}">${escapeHtml(String(severity || 'Info'))}</span>
      </div>
      <div class="ops-360-card-value">${escapeHtml(String(value ?? '-'))}</div>
      <p>${escapeHtml(subtitle || '')}</p>
      ${procurement360Evidence(title, evidence, missingData)}
      ${actions.length ? `<div class="ops-360-actions">${actions.map((action, index) => `
        <button type="button" class="btn btn-sm ${index === 0 ? 'btn-primary' : 'btn-outline-primary'}" data-proc-360-action="${escapeHtml(action.action || '')}">
          ${escapeHtml(action.label || 'Open')}
        </button>
      `).join('')}</div>` : ''}
    </article>
  `;
}

function getRequestQuotes(request = {}) {
  return Array.isArray(request.vendorQuotes) ? request.vendorQuotes : [];
}

function getRequestPurchaseOrders(request = {}) {
  return Array.isArray(request.purchaseOrders)
    ? request.purchaseOrders
    : (request.purchaseOrder ? [request.purchaseOrder] : []);
}

function getRequestReceivingRecords(request = {}) {
  return Array.isArray(request.receivingRecords)
    ? request.receivingRecords
    : (Array.isArray(request.receipts) ? request.receipts : []);
}

function buildProcurement360Summary() {
  const board = state.board || {};
  const requests = getBoardRequests();
  const recommendations = getBoardRecommendations();
  const analytics = board.analytics || {};
  const statusCounts = board.statusCounts || {};
  const priorities = board.priorities || {};
  const quotes = [];
  const purchaseOrders = [];
  const receivingRecords = [];
  requests.forEach((request) => {
    getRequestQuotes(request).forEach((quote) => quotes.push({ request, quote }));
    getRequestPurchaseOrders(request).forEach((po) => purchaseOrders.push({ request, po }));
    getRequestReceivingRecords(request).forEach((record) => receivingRecords.push({ request, record }));
  });
  const openRequests = requests.filter((row) => !['received', 'closed', 'cancelled', 'rejected'].includes(normalizeValue(row.status))).length;
  const pendingApprovals = requests.filter((row) => ['submitted', 'underreview'].includes(normalizeValue(row.status))).length;
  const orderedTransit = requests.filter((row) => ['ordered', 'partiallyreceived'].includes(normalizeValue(row.status))).length;
  const partiallyReceived = requests.filter((row) => normalizeValue(row.status) === 'partiallyreceived').length;
  const receivedClosed = requests.filter((row) => ['received', 'closed'].includes(normalizeValue(row.status))).length;
  const approvedNoPo = requests.filter((row) => normalizeValue(row.status) === 'approved' && !getRequestPurchaseOrders(row).length).length;
  const missingQuotes = requests.filter((row) => ['submitted', 'underreview', 'approved'].includes(normalizeValue(row.status)) && !getRequestQuotes(row).length).length;
  const quotesNeedReview = quotes.filter(({ quote }) => !quote.selected && !['rejected', 'selected'].includes(normalizeValue(quote.status || ''))).length;
  const selectedQuotes = quotes.filter(({ quote }) => quote.selected).length;
  const moqConflicts = Number(state.eoqMoq?.summary?.moqConflictItems ?? analytics?.eoqMoq?.moqConflictItems ?? 0) || 0;
  const estimatedSpend = requests.reduce((sum, row) => sum + (numericOrNull(row.estimatedBudget) || 0), 0);
  const selectedQuoteSpend = quotes.reduce((sum, row) => sum + (row.quote?.selected ? (numericOrNull(row.quote.totalPrice) || 0) : 0), 0);
  const actualSpend = requests.reduce((sum, row) => sum + (numericOrNull(row.actualCost) || 0), 0);
  const orderedAmount = purchaseOrders.reduce((sum, row) => sum + (numericOrNull(row.po.totalPrice ?? row.po.amount ?? row.po.estimatedTotal) || 0), 0);
  const invoiceActual = Number(analytics.invoiceActualAmount ?? analytics.actualInvoiceAmount ?? 0) || 0;
  const financeTotals = state.finance?.totals || analytics.finance?.totals || {};
  const availableBudget = numericOrNull(financeTotals.available);
  const budgetPressure = availableBudget !== null && availableBudget < 0 ? Math.abs(availableBudget) : 0;
  const missingCostData = requests.filter((row) => numericOrNull(row.estimatedBudget) === null && requestDisplayCost(row) === null).length;
  const receivingPending = Number(analytics.receivedVsPending?.pending ?? orderedTransit) || 0;
  const stockUpdatesWaiting = receivingRecords.filter(({ record }) => record.applyTarget === 'spare_stock' && !record.confirmInventoryImpact).length;
  const fifoBatches = Array.isArray(state.fifo?.batches) ? state.fifo.batches.length : Number(analytics?.fifo?.batchCount || 0);
  const agingRequests = Number(analytics.agingApprovedRequests || 0);

  return {
    requests,
    recommendations,
    priorities,
    openRequests,
    pendingApprovals,
    orderedTransit,
    partiallyReceived,
    receivedClosed,
    approvedNoPo,
    missingQuotes,
    quotesNeedReview,
    selectedQuotes,
    moqConflicts,
    estimatedSpend,
    selectedQuoteSpend,
    actualSpend,
    orderedAmount,
    invoiceActual,
    budgetPressure,
    availableBudget,
    missingCostData,
    receivingPending,
    stockUpdatesWaiting,
    fifoBatches,
    agingRequests,
    lowStockRecommendations: (Array.isArray(priorities.lowStockItems) ? priorities.lowStockItems.length : 0),
    eolRecommendations: (Array.isArray(priorities.urgentReplacements) ? priorities.urgentReplacements.length : 0),
    auditRecommendations: (Array.isArray(priorities.auditNeeds) ? priorities.auditNeeds.length : 0),
    maintenanceRecommendations: (Array.isArray(priorities.maintenanceNeeds) ? priorities.maintenanceNeeds.length : 0),
    statusCounts,
  };
}

function getNextProcurementAction(summary = buildProcurement360Summary()) {
  const requests = summary.requests || [];
  const approval = requests.find((row) => ['submitted', 'underreview'].includes(normalizeValue(row.status)));
  if (approval) return { type: 'status', requestId: approval.requestId, title: 'Approve or reject request', reason: `${approval.requestId} is waiting for a decision.` };
  const needsQuote = requests.find((row) => normalizeValue(row.status) === 'approved' && !getRequestQuotes(row).length);
  if (needsQuote) return { type: 'quote', requestId: needsQuote.requestId, title: 'Add vendor quote', reason: `${needsQuote.requestId} is approved but has no quote.` };
  const needsPo = requests.find((row) => normalizeValue(row.status) === 'approved' && getRequestQuotes(row).some((quote) => quote.selected) && !getRequestPurchaseOrders(row).length);
  if (needsPo) return { type: 'po', requestId: needsPo.requestId, title: 'Create purchase order', reason: `${needsPo.requestId} has an approved selected quote.` };
  const needsReceive = requests.find((row) => ['ordered', 'partiallyreceived'].includes(normalizeValue(row.status)));
  if (needsReceive) return { type: 'receive', requestId: needsReceive.requestId, title: 'Receive stock', reason: `${needsReceive.requestId} is ordered or partially received.` };
  const draft = requests.find((row) => normalizeValue(row.status) === 'draft');
  if (draft) return { type: 'status', requestId: draft.requestId, title: 'Submit draft request', reason: `${draft.requestId} is still in Draft.` };
  return null;
}

function renderProcurement360() {
  const grid = document.getElementById('procurement360Grid');
  if (!grid) return;
  const summary = buildProcurement360Summary();
  const knownCostTotal = summary.estimatedSpend + summary.selectedQuoteSpend + summary.orderedAmount + summary.actualSpend + summary.invoiceActual;
  const vendorIssues = summary.quotesNeedReview + summary.missingQuotes + summary.moqConflicts;
  const receivingIssues = summary.receivingPending + summary.partiallyReceived + summary.stockUpdatesWaiting;
  const nextAction = getNextProcurementAction(summary);

  grid.innerHTML = [
    procurement360Card({
      title: 'Procurement Health',
      value: summary.openRequests,
      subtitle: `${summary.pendingApprovals} pending approval | ${summary.orderedTransit} ordered/in transit | ${summary.receivedClosed} received/closed`,
      severity: summary.pendingApprovals || summary.agingRequests ? 'Medium' : 'Healthy',
      evidence: [`Open requests: ${summary.openRequests}`, `Partially received: ${summary.partiallyReceived}`, `Aging requests: ${summary.agingRequests}`, `Status counts loaded: ${Object.keys(summary.statusCounts || {}).length}`],
      actions: [{ label: 'Continue Workflow', action: 'continue' }, { label: 'Requests', action: 'requests' }],
    }),
    procurement360Card({
      title: 'Cost & Budget',
      value: knownCostTotal > 0 ? formatCurrency(knownCostTotal) : 'Cost data missing',
      subtitle: knownCostTotal > 0
        ? `${formatCurrency(summary.estimatedSpend)} estimated | ${formatCurrency(summary.selectedQuoteSpend)} selected quotes`
        : 'Add estimates, quotes, POs, invoices, or budget allocations to improve cost analytics.',
      severity: summary.budgetPressure || summary.missingCostData ? 'Medium' : 'Healthy',
      evidence: [`Estimated spend: ${formatCurrency(summary.estimatedSpend)}`, `Selected quotes: ${formatCurrency(summary.selectedQuoteSpend)}`, `Ordered amount: ${formatCurrency(summary.orderedAmount)}`, `Actual/invoice amount: ${formatCurrency(summary.actualSpend + summary.invoiceActual)}`, `Available budget: ${summary.availableBudget === null ? 'Missing' : formatCurrency(summary.availableBudget)}`],
      missingData: summary.missingCostData ? [`${summary.missingCostData} request(s) missing cost evidence`] : [],
      actions: [{ label: 'Finance', action: 'finance' }, { label: 'Explain Cost', action: 'explain-cost' }],
    }),
    procurement360Card({
      title: 'Vendor Intelligence',
      value: vendorIssues,
      subtitle: `${summary.quotesNeedReview} quote(s) need review | ${summary.selectedQuotes} selected quote(s) | ${summary.moqConflicts} MOQ conflict(s)`,
      severity: vendorIssues ? 'Medium' : 'Healthy',
      evidence: [`Missing quotes: ${summary.missingQuotes}`, `Quotes needing review: ${summary.quotesNeedReview}`, `Selected/best-value quotes: ${summary.selectedQuotes}`, `MOQ conflicts: ${summary.moqConflicts}`],
      missingData: summary.missingQuotes ? ['vendor quote data'] : [],
      actions: [{ label: 'Vendor Quotes', action: 'quotes' }, { label: 'Suppliers', action: 'suppliers' }],
    }),
    procurement360Card({
      title: 'Receiving Impact',
      value: receivingIssues,
      subtitle: `${summary.receivingPending} pending | ${summary.partiallyReceived} partial | ${summary.fifoBatches} FIFO batch signal(s)`,
      severity: receivingIssues ? 'Medium' : 'Healthy',
      evidence: [`Pending receiving: ${summary.receivingPending}`, `Partial receiving: ${summary.partiallyReceived}`, `Stock updates waiting: ${summary.stockUpdatesWaiting}`, `FIFO batch records/signals: ${summary.fifoBatches}`],
      actions: [{ label: 'Receiving', action: 'receiving' }],
    }),
    procurement360Card({
      title: 'AI Recommendations',
      value: summary.recommendations.length,
      subtitle: `${summary.lowStockRecommendations} low stock | ${summary.eolRecommendations} EOL | ${summary.auditRecommendations} audit-driven`,
      severity: summary.recommendations.length ? 'Medium' : 'Healthy',
      source: 'Hybrid evidence',
      evidence: [`AI recommendations: ${summary.recommendations.length}`, `Low-stock priorities: ${summary.lowStockRecommendations}`, `EOL replacements: ${summary.eolRecommendations}`, `Maintenance-driven signals: ${summary.maintenanceRecommendations}`],
      actions: [{ label: 'AI Recommendations', action: 'recommendations' }],
    }),
    procurement360Card({
      title: 'Next Best Action',
      value: nextAction ? '1' : 'Clear',
      subtitle: nextAction ? `${nextAction.title}: ${nextAction.reason}` : 'No immediate workflow blocker from loaded procurement evidence.',
      severity: nextAction ? 'Medium' : 'Healthy',
      evidence: nextAction ? [nextAction.reason] : ['No pending approval, quote, PO, or receiving blocker detected.'],
      actions: [{ label: nextAction ? nextAction.title : 'Create Request', action: nextAction ? 'continue' : 'create' }, { label: 'Explain', action: 'explain' }],
    }),
  ].join('');
}

function renderBoard() {
  const board = state.board;
  const summaryEl = document.getElementById('procBoardSummary');
  if (!board) {
    if (summaryEl) summaryEl.textContent = 'Procurement board data is unavailable.';
    return;
  }

  const requests = getBoardRequests();
  const recommendations = getBoardRecommendations();
  const statusCounts = board.statusCounts && typeof board.statusCounts === 'object' ? board.statusCounts : {};
  const analytics = board.analytics || {};
  const priorities = board.priorities || {};

  if (summaryEl) summaryEl.textContent = String(board.summary || 'Procurement board loaded.');
  renderProcurement360();
  renderKanbanBoard(requests);
  renderRequestPriorityBoard(requests);
  renderVendorBattleCards(requests);
  applyRequestViewMode();

  const openCount = requests.filter((row) => ['Draft', 'Submitted', 'Under Review'].includes(String(row.status || ''))).length;
  const pendingApprovals = requests.filter((row) => ['Submitted', 'Under Review'].includes(String(row.status || ''))).length;
  const orderedCount = requests.filter((row) => ['Ordered', 'Partially Received'].includes(String(row.status || ''))).length;
  const summaryOpen = document.getElementById('procSummaryOpen');
  const summaryApprovals = document.getElementById('procSummaryApprovals');
  const summaryOrdered = document.getElementById('procSummaryOrdered');
  const summaryRecs = document.getElementById('procSummaryRecommendations');
  setKpiValue(summaryOpen, openCount);
  setKpiValue(summaryApprovals, pendingApprovals);
  setKpiValue(summaryOrdered, orderedCount);
  setKpiValue(summaryRecs, recommendations.length);

  const badgesEl = document.getElementById('procStatusBadges');
  if (badgesEl) {
    badgesEl.innerHTML = PROCUREMENT_STATUSES.map((status) => {
      const count = Number(statusCounts[status] || 0);
      return `<span class="badge ${statusBadgeClass(status)}">${escapeHtml(status)}: ${escapeHtml(String(count))}</span>`;
    }).join('');
  }

  const quickSummary = document.getElementById('procAnalyticsQuickSummary');
  if (quickSummary) {
    quickSummary.textContent = [
      `Monthly spend: ${formatCurrency(analytics.monthlySpendingEstimate || 0)}`,
      `Open POs: ${Number(analytics.openPurchaseOrders || 0)}`,
      `Aging requests: ${Number(analytics.agingApprovedRequests || 0)}`,
      `EOL-driven: ${Number(analytics.eolDrivenCandidates || 0)}`,
    ].join(' | ');
  }

  const priorityRows = [];
  (Array.isArray(priorities.urgentReplacements) ? priorities.urgentReplacements.slice(0, 8) : []).forEach((row) => {
    priorityRows.push({
      stream: 'Urgent Replacements',
      item: row.assetName || row.assetId || '-',
      need: `Window: ${row.procurementWindowMonths ?? '-'} month(s)`,
      reason: row.reason || row.status || '-',
    });
  });
  (Array.isArray(priorities.highRiskAssets) ? priorities.highRiskAssets.slice(0, 8) : []).forEach((row) => {
    priorityRows.push({
      stream: 'High Risk',
      item: row.assetName || row.assetId || '-',
      need: `${String(row.riskLevel || '-').toUpperCase()} (${row.riskScore ?? '-'})`,
      reason: row.reason || '-',
    });
  });
  (Array.isArray(priorities.lowStockItems) ? priorities.lowStockItems.slice(0, 8) : []).forEach((row) => {
    priorityRows.push({
      stream: 'Low Stock',
      item: row.itemName || '-',
      need: `Current ${row.currentQuantity ?? '-'} / Reorder ${row.reorderPoint ?? '-'}`,
      reason: row.reason || '-',
    });
  });
  (Array.isArray(priorities.auditNeeds) ? priorities.auditNeeds.slice(0, 8) : []).forEach((row) => {
    priorityRows.push({
      stream: 'Audit Needs',
      item: row.assetName || row.assetId || '-',
      need: String(row.eventType || '-').replace(/_/g, ' '),
      reason: row.reason || '-',
    });
  });
  const priorityBody = document.getElementById('procPriorityTableBody');
  if (priorityBody) {
    priorityBody.innerHTML = priorityRows.map((row) => `
      <tr>
        <td><span class="ops-attention-pill ${urgencyClass(row.stream)}">${escapeHtml(row.stream)}</span></td>
        <td>${escapeHtml(row.item)}</td>
        <td>${escapeHtml(row.need)}</td>
        <td>${escapeHtml(row.reason)}</td>
      </tr>
    `).join('') || emptyStateRow(4, 'No urgent procurement priorities', 'Inventory currently has no critical low-stock, audit, or EOL procurement alerts.');
  }

  const recBody = document.getElementById('procRecommendationsTableBody');
  if (recBody) {
    recBody.innerHTML = recommendations.map((row, index) => {
      const priority = String(row.priority || row.urgency || 'medium');
      const affectedAssets = Array.isArray(row.affectedAssets) ? row.affectedAssets : [];
      const affectedDepartments = Array.isArray(row.affectedDepartments) ? row.affectedDepartments : [];
      const affectedBuildings = Array.isArray(row.affectedBuildings) ? row.affectedBuildings : [];
      const evidenceText = row.evidenceSummary || row.evidence || row.reason || 'Evidence is generated from inventory signals.';
      return `
      <tr class="proc-ai-rec-row">
        <td colspan="7">
          <div class="proc-ai-rec-card ${urgencyClass(priority)}">
            <div class="proc-ai-rec-main">
              <div class="proc-ai-rec-kicker">
                <span class="ops-attention-pill ${urgencyClass(priority)}">${escapeHtml(priority.toUpperCase())}</span>
                <span class="ops-attention-pill is-info">Source: ${escapeHtml(sourceLabel(row))}</span>
                ${row.evidenceLevel || row.dataQuality ? `<span class="ops-attention-pill is-review">Evidence: ${escapeHtml(String(row.evidenceLevel || row.dataQuality))}</span>` : ''}
              </div>
              <div class="proc-ai-rec-title">${escapeHtml(row.itemName || row.title || 'Procurement recommendation')}</div>
              <div class="proc-ai-rec-meta">
                <span>${escapeHtml(row.type || row.category || 'Inventory need')}</span>
                <span>Qty ${escapeHtml(String(row.recommendedQuantity ?? row.quantity ?? '-'))}</span>
                ${row.estimatedBudget ? `<span>${escapeHtml(formatCurrency(row.estimatedBudget))}</span>` : ''}
              </div>
              <div class="proc-ai-rec-reason">${escapeHtml(row.reason || 'Review this recommendation against inventory evidence.')}</div>
              <details class="proc-ai-rec-evidence">
                <summary>View evidence</summary>
                <div>${escapeHtml(String(evidenceText))}</div>
                ${affectedAssets.length ? `<div>Affected assets: ${escapeHtml(affectedAssets.slice(0, 6).join(', '))}</div>` : ''}
                ${affectedDepartments.length ? `<div>Departments: ${escapeHtml(affectedDepartments.slice(0, 6).join(', '))}</div>` : ''}
                ${affectedBuildings.length ? `<div>Buildings: ${escapeHtml(affectedBuildings.slice(0, 6).join(', '))}</div>` : ''}
              </details>
            </div>
            <div class="proc-ai-rec-actions">
              <button type="button" class="btn btn-sm btn-primary" data-proc-create-from-rec="${escapeHtml(String(index))}">Create Request</button>
              <button type="button" class="btn btn-sm btn-outline-secondary" data-proc-view-rec="${escapeHtml(String(index))}">View Evidence</button>
              <button type="button" class="btn btn-sm btn-outline-secondary" data-proc-review-rec="${escapeHtml(String(index))}">Reviewed</button>
              <button type="button" class="btn btn-sm btn-outline-danger" data-proc-ignore-rec="${escapeHtml(String(index))}">Ignore</button>
            </div>
          </div>
        </td>
      </tr>
    `;
    }).join('') || emptyStateRow(7, 'No urgent AI recommendations', 'Inventory currently has no critical low-stock or EOL procurement alerts.', '<button type="button" class="btn btn-sm btn-outline-primary" id="procRefreshRecommendationsEmptyBtn">Refresh</button>');
  }

  const requestsBody = document.getElementById('procRequestsTableBody');
  if (requestsBody) {
    requestsBody.innerHTML = requests.map((row) => {
      const selectedQuote = Array.isArray(row.vendorQuotes) ? row.vendorQuotes.find((quote) => quote.selected) : null;
      return `
        <tr class="${String(row.requestId || '') === state.recentlyUpdatedRequestId ? 'proc-row-updated' : ''}">
          <td>
            <div class="fw-semibold">${escapeHtml(row.requestId || '-')}</div>
            <div class="small text-muted">${escapeHtml(row.title || '-')}</div>
          </td>
          <td>
            <div>${escapeHtml(String(row.quantity || 1))} x ${escapeHtml(row.itemType || '-')}</div>
            <div class="small text-muted">${escapeHtml(row.reason || '-')}</div>
          </td>
          <td>
            <div>${escapeHtml(row.requestedBy || '-')}</div>
            <div class="small text-muted">${escapeHtml(row.linkedDepartment || 'Unassigned')} | ${escapeHtml(row.linkedLocation || '-')}</div>
            ${selectedQuote ? `<div class="small text-muted">Selected quote: ${escapeHtml(selectedQuote.vendorName || '-')} (${formatCurrency(selectedQuote.totalPrice)})</div>` : ''}
          </td>
          <td>
            <span class="badge ${statusBadgeClass(row.status)}">${escapeHtml(row.status || '-')}</span>
            ${buildLifecycleStepper(row.status)}
          </td>
          <td>${escapeHtml(formatDate(row.updatedAt))}</td>
          <td class="text-end">
            <div class="d-flex flex-wrap justify-content-end gap-1">
              <button type="button" class="btn btn-sm btn-primary" data-proc-continue-request="${escapeHtml(row.requestId || '')}" data-role-required="procurement">Continue</button>
              <button type="button" class="btn btn-sm btn-outline-primary" data-proc-view-request="${escapeHtml(row.requestId || '')}">Details</button>
              <div class="dropdown">
                <button type="button" class="btn btn-sm btn-outline-secondary dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false">More</button>
                <div class="dropdown-menu dropdown-menu-end">
                  <button type="button" class="dropdown-item" data-proc-update-status="${escapeHtml(row.requestId || '')}">Status</button>
                  <button type="button" class="dropdown-item" data-proc-add-quote="${escapeHtml(row.requestId || '')}">Add Quote</button>
                  <button type="button" class="dropdown-item" data-proc-create-po="${escapeHtml(row.requestId || '')}">Create PO</button>
                  <button type="button" class="dropdown-item" data-proc-receive="${escapeHtml(row.requestId || '')}">Receive</button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      `;
    }).join('') || emptyStateRow(6, 'No procurement requests yet', 'Create a request from a low-stock, EOL, audit, maintenance, or manual procurement need.', '<button type="button" class="btn btn-sm btn-primary" id="procCreateRequestEmptyBtn">Create Request</button>');
  }

  const quotes = [];
  requests.forEach((request) => {
    (Array.isArray(request.vendorQuotes) ? request.vendorQuotes : []).forEach((quote) => {
      quotes.push({ request, quote });
    });
  });
  const quotesBody = document.getElementById('procQuotesTableBody');
  if (quotesBody) {
    quotesBody.innerHTML = quotes.map(({ request, quote }) => `
      <tr>
        <td>
          <div class="fw-semibold">${escapeHtml(request.requestId || '-')}</div>
          <div class="small text-muted">${escapeHtml(request.title || '-')}</div>
        </td>
        <td>${escapeHtml(quote.vendorName || '-')}</td>
        <td>${escapeHtml(quote.quotedItem || '-')}</td>
        <td>${escapeHtml(formatCurrency(quote.totalPrice))}</td>
        <td>${escapeHtml(String(quote.warrantyMonths ?? '-'))}</td>
        <td>${escapeHtml(String(quote.deliveryDays ?? '-'))}</td>
        <td>
          <span class="badge ${statusBadgeClass(quote.status || (quote.selected ? 'selected' : 'pending'))}">${escapeHtml(String(quote.status || (quote.selected ? 'selected' : 'pending')).replace(/_/g, ' '))}</span>
          ${quote.selected ? '<span class="badge bg-success-subtle text-success-emphasis border ms-1">Best Value</span>' : ''}
        </td>
        <td class="text-end">
          <div class="d-flex justify-content-end gap-1">
            <button type="button" class="btn btn-sm btn-outline-success" data-proc-quote-select="${escapeHtml(request.requestId || '')}" data-proc-quote-id="${escapeHtml(quote.quoteId || '')}">Select</button>
            <button type="button" class="btn btn-sm btn-outline-danger" data-proc-quote-reject="${escapeHtml(request.requestId || '')}" data-proc-quote-id="${escapeHtml(quote.quoteId || '')}">Reject</button>
          </div>
        </td>
      </tr>
    `).join('') || emptyStateRow(8, 'No vendor quotes yet', 'Add quotes to approved or submitted requests so price, warranty, delivery, and reliability can be compared.');
  }

  const poRows = [];
  requests.forEach((request) => {
    const purchaseOrders = Array.isArray(request.purchaseOrders)
      ? request.purchaseOrders
      : (request.purchaseOrder ? [request.purchaseOrder] : []);
    purchaseOrders.forEach((po) => poRows.push({ request, po }));
  });
  const poBody = document.getElementById('procPurchaseOrdersTableBody');
  if (poBody) {
    poBody.innerHTML = poRows.map(({ request, po }) => `
      <tr>
        <td>${escapeHtml(po.poNumber || '-')}</td>
        <td>${escapeHtml(request.requestId || '-')}</td>
        <td>${escapeHtml(po.vendorName || '-')}</td>
        <td><span class="badge ${statusBadgeClass(po.status || '-')}">${escapeHtml(String(po.status || '-').replace(/_/g, ' '))}</span></td>
        <td>${escapeHtml(formatDate(po.expectedDelivery))}</td>
        <td>${escapeHtml(formatDate(po.updatedAt || po.createdAt))}</td>
      </tr>
    `).join('') || emptyStateRow(6, 'No purchase orders yet', 'Create a PO from an approved request after vendor quote review.');
  }

  const receivingRows = [];
  requests.forEach((request) => {
    const records = Array.isArray(request.receivingRecords)
      ? request.receivingRecords
      : (Array.isArray(request.receipts) ? request.receipts : []);
    records.forEach((record) => receivingRows.push({ request, record }));
  });
  const receivingBody = document.getElementById('procReceivingTableBody');
  if (receivingBody) {
    receivingBody.innerHTML = receivingRows.map(({ request, record }) => {
      const impact = record.applyTarget === 'spare_stock'
        ? `Spare stock updated (${record.spareStockItemId || 'n/a'})`
        : 'Recorded only';
      return `
        <tr>
          <td>${escapeHtml(request.requestId || '-')}</td>
          <td>${escapeHtml(record.receivedBy || '-')}</td>
          <td>${escapeHtml(formatDateTime(record.receivedAt))}</td>
          <td>${escapeHtml(String(record.receivedQuantity || 0))}</td>
          <td>${escapeHtml(String(record.condition || 'good').replace(/_/g, ' '))}</td>
          <td>${escapeHtml(impact)}</td>
        </tr>
      `;
    }).join('') || emptyStateRow(6, 'No receiving records yet', 'Receiving history appears after a request or purchase order is reviewed and confirmed.');
  }

  const spend = document.getElementById('procAnalyticsSpend');
  const openPo = document.getElementById('procAnalyticsOpenPo');
  const aging = document.getElementById('procAnalyticsAging');
  const topItems = document.getElementById('procTopItemsList');
  if (spend) spend.textContent = formatCurrency(analytics.monthlySpendingEstimate || 0);
  if (openPo) openPo.textContent = String(Number(analytics.openPurchaseOrders || 0));
  if (aging) aging.textContent = String(Number(analytics.agingApprovedRequests || 0));
  if (topItems) {
    const rows = Array.isArray(analytics.topRequestedItems) ? analytics.topRequestedItems : [];
    topItems.innerHTML = rows.length
      ? rows.map((row) => `<span class="badge text-bg-light me-1 mb-1">${escapeHtml(row.item || '-')}: ${escapeHtml(String(row.count || 0))}</span>`).join('')
      : 'No analytics data yet.';
  }
}

function renderAbcPanel() {
  const summaryEl = document.getElementById('procAbcSummary');
  const tbody = document.getElementById('procAbcTableBody');
  const filterEl = document.getElementById('procAbcClassFilter');
  const payload = state.abcAnalysis;
  if (!summaryEl || !tbody) return;
  if (!payload) {
    summaryEl.textContent = 'ABC analysis unavailable.';
    tbody.innerHTML = '<tr><td colspan="6" class="text-muted">No data.</td></tr>';
    return;
  }
  const filter = String(filterEl?.value || 'ALL').toUpperCase();
  const rows = (Array.isArray(payload.rows) ? payload.rows : [])
    .filter((row) => (['A', 'B', 'C'].includes(filter) ? String(row.abcClass || '').toUpperCase() === filter : true));
  const allRows = Array.isArray(payload.rows) ? payload.rows : [];
  const classCounts = ['A', 'B', 'C'].reduce((acc, klass) => {
    acc[klass] = allRows.filter((row) => String(row.abcClass || '').toUpperCase() === klass).length;
    return acc;
  }, {});
  summaryEl.innerHTML = `
    <div class="proc-decision-card-grid">
      <div class="proc-decision-card is-urgent">
        <div class="proc-decision-label">Class A</div>
        <div class="proc-decision-value">${escapeHtml(String(classCounts.A || 0))}</div>
        <div class="proc-decision-copy">Strict control, high value or high service impact.</div>
      </div>
      <div class="proc-decision-card is-review">
        <div class="proc-decision-label">Class B</div>
        <div class="proc-decision-value">${escapeHtml(String(classCounts.B || 0))}</div>
        <div class="proc-decision-copy">Moderate control with periodic review.</div>
      </div>
      <div class="proc-decision-card is-healthy">
        <div class="proc-decision-label">Class C</div>
        <div class="proc-decision-value">${escapeHtml(String(classCounts.C || 0))}</div>
        <div class="proc-decision-copy">Simple control, bulk reorder where appropriate.</div>
      </div>
    </div>
    <div class="small text-muted mt-2">${escapeHtml(payload.summary || 'ABC analysis loaded.')} Showing ${escapeHtml(String(rows.length))} row(s).</div>
  `;
  tbody.innerHTML = rows.slice(0, 240).map((row) => `
    <tr>
      <td><div class="fw-semibold">${escapeHtml(row.itemName || '-')}</div><div class="small text-muted">${escapeHtml(row.itemId || '-')}</div></td>
      <td>${escapeHtml(row.category || '-')}</td>
      <td><span class="badge ${row.abcClass === 'A' ? 'bg-danger' : (row.abcClass === 'B' ? 'bg-warning text-dark' : 'bg-secondary')}">${escapeHtml(row.abcClass || '-')}</span></td>
      <td>${escapeHtml(String(row.score ?? '-'))}</td>
      <td class="small">${escapeHtml(row.reason || '-')}</td>
      <td class="small">${escapeHtml(row.recommendedControlLevel || '-')}</td>
    </tr>
  `).join('') || emptyStateRow(6, 'No ABC rows for this class', 'Add cost, risk, maintenance, usage, or shortage evidence to improve ABC classification.');
}

function renderEoqPanel() {
  const summaryEl = document.getElementById('procEoqSummary');
  const tbody = document.getElementById('procEoqTableBody');
  const payload = state.eoqMoq;
  if (!summaryEl || !tbody) return;
  if (!payload) {
    summaryEl.textContent = 'EOQ/MOQ insights unavailable.';
    tbody.innerHTML = '<tr><td colspan="7" class="text-muted">No data.</td></tr>';
    return;
  }
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const calculable = rows.filter((row) => row.eoq !== null && typeof row.eoq !== 'undefined').length;
  const missing = Math.max(0, rows.length - calculable);
  const overstockWarnings = rows.filter((row) => String(row.warning || '').toLowerCase().includes('overstock')).length;
  summaryEl.innerHTML = `
    <div class="proc-decision-card-grid">
      <div class="proc-decision-card is-info">
        <div class="proc-decision-label">Calculable EOQ</div>
        <div class="proc-decision-value">${escapeHtml(String(calculable))}</div>
        <div class="proc-decision-copy">Items with enough demand and cost evidence.</div>
      </div>
      <div class="proc-decision-card is-review">
        <div class="proc-decision-label">Missing data</div>
        <div class="proc-decision-value">${escapeHtml(String(missing))}</div>
        <div class="proc-decision-copy">Annual demand, ordering cost, or holding cost needed.</div>
      </div>
      <div class="proc-decision-card ${overstockWarnings ? 'is-urgent' : 'is-healthy'}">
        <div class="proc-decision-label">MOQ risk</div>
        <div class="proc-decision-value">${escapeHtml(String(overstockWarnings))}</div>
        <div class="proc-decision-copy">Rows warning about overstock or ordering mismatch.</div>
      </div>
    </div>
    <div class="small text-muted mt-2">${escapeHtml(payload.summary || `Loaded ${rows.length} EOQ/MOQ row(s).`)}</div>
  `;
  tbody.innerHTML = rows.slice(0, 240).map((row) => `
    <tr>
      <td><div class="fw-semibold">${escapeHtml(row.itemName || '-')}</div><div class="small text-muted">${escapeHtml(row.componentType || '-')}</div></td>
      <td class="small">${escapeHtml(String(row.annualDemand ?? '-'))} / ${escapeHtml(String(row.orderingCost ?? '-'))} / ${escapeHtml(String(row.holdingCost ?? '-'))}</td>
      <td>${escapeHtml(row.eoq === null ? '-' : String(row.eoq))}</td>
      <td>${escapeHtml(row.moq === null ? '-' : String(row.moq))}</td>
      <td>${escapeHtml(row.recommendedOrderQuantity === null ? '-' : String(row.recommendedOrderQuantity))}</td>
      <td><span class="badge ${row.dataQuality === 'high' ? 'bg-success' : (row.dataQuality === 'medium' ? 'bg-warning text-dark' : 'bg-secondary')}">${escapeHtml(String(row.dataQuality || '-'))}</span></td>
      <td class="small">${escapeHtml(row.warning || '-')}</td>
    </tr>
  `).join('') || emptyStateRow(7, 'No EOQ/MOQ rows yet', 'Add annual demand, ordering cost, holding cost, MOQ, pack size, and lead time to calculate order guidance.');
}

function renderFifoPanel() {
  const summaryEl = document.getElementById('procFifoSummary');
  const cardsEl = document.getElementById('procFifoQueueCards');
  const tbody = document.getElementById('procFifoTableBody');
  const payload = state.fifo;
  if (!summaryEl || !tbody) return;
  if (!payload) {
    summaryEl.textContent = 'FIFO data unavailable.';
    if (cardsEl) cardsEl.innerHTML = '';
    tbody.innerHTML = '<tr><td colspan="6" class="text-muted">No data.</td></tr>';
    return;
  }
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const oldest = rows
    .filter((row) => row?.receivedAt)
    .slice()
    .sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime())[0];
  summaryEl.innerHTML = `
    <div class="proc-decision-card-grid">
      <div class="proc-decision-card is-info">
        <div class="proc-decision-label">FIFO batches</div>
        <div class="proc-decision-value">${escapeHtml(String(rows.length))}</div>
        <div class="proc-decision-copy">Oldest available batch should be issued first.</div>
      </div>
      <div class="proc-decision-card is-healthy">
        <div class="proc-decision-label">Use first</div>
        <div class="proc-decision-value">${escapeHtml(oldest?.batchCode || oldest?.itemName || '-')}</div>
        <div class="proc-decision-copy">${escapeHtml(oldest?.receivedAt ? `Received ${formatDate(oldest.receivedAt)}` : 'Receive stock to create FIFO batches.')}</div>
      </div>
      <div class="proc-decision-card is-review">
        <div class="proc-decision-label">Override rule</div>
        <div class="proc-decision-value">Reason</div>
        <div class="proc-decision-copy">Use a newer batch only with a recorded reason.</div>
      </div>
    </div>
  `;
  if (cardsEl) {
    const sorted = rows
      .filter((row) => Number(row?.quantityAvailable ?? 0) > 0)
      .slice()
      .sort((a, b) => new Date(a.receivedAt || 0).getTime() - new Date(b.receivedAt || 0).getTime())
      .slice(0, 6);
    cardsEl.innerHTML = sorted.length ? sorted.map((row, index) => {
      const ageDays = row?.receivedAt ? Math.max(0, Math.floor((Date.now() - new Date(row.receivedAt).getTime()) / (1000 * 60 * 60 * 24))) : null;
      return `
        <article class="proc-fifo-queue-card ${index === 0 ? 'is-use-first' : ''}">
          <div class="proc-fifo-queue-head">
            <span class="ops-attention-pill ${index === 0 ? 'is-healthy' : 'is-info'}">${index === 0 ? 'Use First' : `Batch ${index + 1}`}</span>
            <strong>${escapeHtml(row.batchCode || row.id || 'FIFO batch')}</strong>
          </div>
          <div class="proc-fifo-queue-item">${escapeHtml(row.itemName || '-')}</div>
          <div class="proc-fifo-queue-meta">
            <span>Received ${escapeHtml(formatDate(row.receivedAt))}</span>
            <span>Age ${escapeHtml(ageDays === null ? '-' : `${ageDays}d`)}</span>
            <span>${escapeHtml(String(row.quantityAvailable ?? '-'))} available</span>
            <span>Source ${escapeHtml(row.sourcePurchaseOrderId || row.sourceRequestId || '-')}</span>
          </div>
          <div class="proc-fifo-queue-note">${index === 0 ? 'Oldest available stock should be issued first unless an override reason is recorded.' : 'Use after older available batches are consumed.'}</div>
        </article>
      `;
    }).join('') : `
      <div class="ops-empty-state-card">
        <div>
          <div class="ops-empty-state-title">No FIFO batches yet</div>
          <div class="ops-empty-state-copy">Receive spare stock or consumables to create FIFO batches, then OpsMind will suggest oldest stock first.</div>
        </div>
      </div>
    `;
  }
  tbody.innerHTML = rows.slice(0, 240).map((row) => {
    const ageDays = row?.receivedAt ? Math.max(0, Math.floor((Date.now() - new Date(row.receivedAt).getTime()) / (1000 * 60 * 60 * 24))) : null;
    return `
      <tr>
        <td><div class="fw-semibold">${escapeHtml(row.batchCode || row.id || '-')}</div><div class="small text-muted">${escapeHtml(row.id || '-')}</div></td>
        <td>${escapeHtml(row.itemName || '-')}${oldest && (row.id === oldest.id || row.batchCode === oldest.batchCode) ? ' <span class="badge bg-success-subtle text-success-emphasis border ms-1">Use First</span>' : ''}</td>
        <td>${escapeHtml(formatDate(row.receivedAt))}</td>
        <td>${escapeHtml(ageDays === null ? '-' : `${ageDays}d`)}</td>
        <td>${escapeHtml(String(row.quantityAvailable ?? '-'))}</td>
        <td class="small">${escapeHtml(row.sourcePurchaseOrderId || row.sourceRequestId || '-')}</td>
      </tr>
    `;
  }).join('') || emptyStateRow(6, 'No FIFO batches yet', 'Receive spare stock or consumables to create FIFO batches and issue oldest stock first.');
}

function renderBudgetThermometer(totals = {}) {
  const el = document.getElementById('procBudgetThermometer');
  if (!el) return;
  const allocated = Number(totals.allocated || 0);
  const reserved = Number(totals.reserved || 0);
  const committed = Number(totals.committed || 0);
  const spent = Number(totals.spent || 0);
  const available = Number(totals.available || 0);
  const used = reserved + committed + spent;
  const hasAllocation = Number.isFinite(allocated) && allocated > 0;
  const percent = hasAllocation ? Math.round((used / allocated) * 100) : null;
  const filled = percent === null ? 0 : Math.max(0, Math.min(10, Math.ceil(percent / 10)));
  const level = percent === null ? 'is-info' : (percent >= 100 || available < 0 ? 'is-urgent' : (percent >= 75 ? 'is-review' : 'is-healthy'));
  el.innerHTML = `
    <div class="proc-budget-thermometer ${level}">
      <div class="proc-budget-thermo-copy">
        <div class="proc-budget-thermo-kicker">Budget pressure</div>
        <h6>${percent === null ? 'Budget allocation missing' : `${escapeHtml(String(percent))}% allocated budget used`}</h6>
        <p>${percent === null ? 'Add budget allocations to preview finance impact before approvals and purchase orders.' : 'Reserved, committed, and spent values are combined for pressure visibility.'}</p>
      </div>
      <div class="proc-budget-thermo-meter" aria-label="Budget pressure ${escapeHtml(percent === null ? 'unknown' : `${percent}%`)}">
        ${Array.from({ length: 10 }).map((_, index) => `<span class="${index < filled ? 'is-filled' : ''}"></span>`).join('')}
      </div>
      <div class="proc-budget-thermo-values">
        <span>Allocated ${escapeHtml(formatCurrency(allocated))}</span>
        <span>Reserved ${escapeHtml(formatCurrency(reserved))}</span>
        <span>Committed ${escapeHtml(formatCurrency(committed))}</span>
        <span>Spent ${escapeHtml(formatCurrency(spent))}</span>
        <span>Available ${escapeHtml(formatCurrency(available))}</span>
      </div>
    </div>
  `;
}

function renderFinancePanel() {
  const summaryEl = document.getElementById('procFinanceSummary');
  const totalsEl = document.getElementById('procFinanceTotals');
  const tbody = document.getElementById('procFinanceTableBody');
  const payload = state.finance;
  if (!summaryEl || !totalsEl || !tbody) return;
  if (!payload) {
    summaryEl.textContent = 'Finance summary unavailable.';
    totalsEl.textContent = '';
    renderBudgetThermometer({});
    tbody.innerHTML = '<tr><td colspan="7" class="text-muted">No finance data.</td></tr>';
    return;
  }
  const totals = payload.totals || {};
  summaryEl.textContent = payload.summary || 'Finance summary loaded.';
  renderBudgetThermometer(totals);
  totalsEl.innerHTML = `
    <span class="badge text-bg-light me-1 mb-1">Allocated: ${escapeHtml(formatCurrency(totals.allocated || 0))}</span>
    <span class="badge text-bg-light me-1 mb-1">Reserved: ${escapeHtml(formatCurrency(totals.reserved || 0))}</span>
    <span class="badge text-bg-light me-1 mb-1">Committed: ${escapeHtml(formatCurrency(totals.committed || 0))}</span>
    <span class="badge text-bg-light me-1 mb-1">Spent: ${escapeHtml(formatCurrency(totals.spent || 0))}</span>
    <span class="badge text-bg-light me-1 mb-1">Available: ${escapeHtml(formatCurrency(totals.available || 0))}</span>
  `;
  const rows = Array.isArray(payload.allocations) ? payload.allocations : [];
  tbody.innerHTML = rows.slice(0, 200).map((row) => `
    <tr>
      <td><div class="fw-semibold">${escapeHtml(row.costCenter || '-')}</div><div class="small text-muted">${escapeHtml(row.period || '-')}</div></td>
      <td>${escapeHtml(`${row.department || 'Unassigned'} / ${row.building || '-'}`)}</td>
      <td>${escapeHtml(formatCurrency(row.allocatedAmount || 0))}</td>
      <td>${escapeHtml(formatCurrency(row.reservedAmount || 0))}</td>
      <td>${escapeHtml(formatCurrency(row.committedAmount || 0))}</td>
      <td>${escapeHtml(formatCurrency(row.spentAmount || 0))}</td>
      <td>${escapeHtml(formatCurrency(row.availableAmount || 0))}</td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="text-muted">No budget allocations yet.</td></tr>';
}

function renderSuppliersPanel() {
  const summaryEl = document.getElementById('procSuppliersSummary');
  const suppliersBody = document.getElementById('procSuppliersTableBody');
  const catalogBody = document.getElementById('procCatalogTableBody');
  const suppliers = Array.isArray(state.suppliers?.suppliers) ? state.suppliers.suppliers : [];
  const catalog = Array.isArray(state.supplierCatalog?.items) ? state.supplierCatalog.items : [];
  if (!summaryEl || !suppliersBody || !catalogBody) return;
  summaryEl.textContent = `Loaded ${suppliers.length} supplier(s) and ${catalog.length} catalog item(s).`;
  suppliersBody.innerHTML = suppliers.slice(0, 180).map((row) => `
    <tr>
      <td><div class="fw-semibold">${escapeHtml(row.name || '-')}</div><div class="small text-muted">${escapeHtml(row.id || '-')}</div></td>
      <td>${escapeHtml(row.reliabilityScore === null || typeof row.reliabilityScore === 'undefined' ? '-' : String(row.reliabilityScore))}</td>
      <td>${escapeHtml(row.leadTimeAverageDays === null || typeof row.leadTimeAverageDays === 'undefined' ? '-' : `${row.leadTimeAverageDays}d`)}</td>
      <td><span class="badge ${row.active ? 'bg-success' : 'bg-secondary'}">${row.active ? 'Active' : 'Inactive'}</span></td>
      <td class="small">${escapeHtml(row.contactName || row.email || row.phone || '-')}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="text-muted">No suppliers yet.</td></tr>';
  catalogBody.innerHTML = catalog.slice(0, 220).map((row) => `
    <tr>
      <td><div class="fw-semibold">${escapeHtml(row.itemName || '-')}</div><div class="small text-muted">${escapeHtml(row.category || '-')}</div></td>
      <td>${escapeHtml(row.vendor?.name || row.vendorName || '-')}</td>
      <td>${escapeHtml(row.unitPrice === null || typeof row.unitPrice === 'undefined' ? '-' : formatCurrency(row.unitPrice))}</td>
      <td>${escapeHtml(`${row.minimumOrderQuantity || '-'} / ${row.packSize || '-'}`)}</td>
      <td>${escapeHtml(`${row.leadTimeDays || '-'}d / ${row.warrantyMonths || '-'}m`)}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="text-muted">No supplier catalog items yet.</td></tr>';
}

async function loadBoard() {
  const statusFilterEl = document.getElementById('procStatusFilter');
  state.statusFilter = String(statusFilterEl?.value || 'all').trim() || 'all';
  setLoadingState(true, 'Loading procurement board...');
  setProcurementSkeletonState();
  try {
    state.board = await readJson(`/inventory/procurement/board?status=${encodeURIComponent(state.statusFilter)}`);
    renderBoard();
    await loadErpFoundationPanels();
    setLoadingState(false, 'Ready.');
  } catch (error) {
    console.error(error);
    setLoadError(error.message || 'Failed to load board');
    notify(error.message || 'Failed to load procurement board.', 'error');
  } finally {
    state.loading = false;
  }
}

async function loadErpFoundationPanels() {
  const abcClassFilter = String(document.getElementById('procAbcClassFilter')?.value || 'ALL').toUpperCase();
  const abcPath = abcClassFilter === 'ALL'
    ? '/inventory/procurement/abc-analysis'
    : `/inventory/procurement/abc-analysis?class=${encodeURIComponent(abcClassFilter)}`;

  const [abcRes, eoqRes, fifoRes, financeRes, suppliersRes, catalogRes] = await Promise.allSettled([
    readJson(abcPath),
    readJson('/inventory/procurement/eoq-moq'),
    readJson('/inventory/procurement/fifo/batches?itemKind=spare_stock'),
    readJson('/inventory/procurement/finance/summary'),
    readJson('/inventory/procurement/suppliers'),
    readJson('/inventory/procurement/suppliers/catalog'),
  ]);

  state.abcAnalysis = abcRes.status === 'fulfilled' ? abcRes.value : null;
  state.eoqMoq = eoqRes.status === 'fulfilled' ? eoqRes.value : null;
  state.fifo = fifoRes.status === 'fulfilled' ? fifoRes.value : null;
  state.finance = financeRes.status === 'fulfilled' ? financeRes.value : null;
  state.suppliers = suppliersRes.status === 'fulfilled' ? suppliersRes.value : null;
  state.supplierCatalog = catalogRes.status === 'fulfilled' ? catalogRes.value : null;

  renderAbcPanel();
  renderEoqPanel();
  renderFifoPanel();
  renderFinancePanel();
  renderSuppliersPanel();
  renderProcurement360();
}

async function createManualRequest() {
  const costCenterOptions = Array.isArray(state.finance?.costCenters)
    ? state.finance.costCenters.map((row) => ({ value: row.id, label: `${row.code} - ${row.name}` }))
    : [];
  const allocationOptions = Array.isArray(state.finance?.allocations)
    ? state.finance.allocations.map((row) => ({ value: row.id, label: `${row.costCenter} / ${row.period}` }))
    : [];
  const form = await showFormModal({
    title: 'Create Procurement Request',
    message: 'Create a request linked to stock, EOL, audit, maintenance, or replacement need.',
    confirmText: 'Create Request',
    confirmClass: 'btn-primary',
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'itemCategory', label: 'Request Type', type: 'select', required: true, options: ['replacement', 'spare_stock', 'consumable', 'license', 'new_asset', 'maintenance_related', 'audit_related', 'other'], value: 'replacement' },
      { name: 'itemType', label: 'Item / Type', type: 'text', required: true },
      { name: 'quantity', label: 'Quantity', type: 'number', min: 1, value: 1, required: true },
      { name: 'priority', label: 'Priority', type: 'select', options: ['low', 'medium', 'high', 'critical'], value: 'medium', required: true },
      { name: 'reason', label: 'Reason', type: 'textarea', rows: 3, required: true },
      { name: 'linkedDepartment', label: 'Department', type: 'select', options: STANDARD_MIU_DEPARTMENTS, value: 'Unassigned' },
      { name: 'linkedLocation', label: 'Building/Location', type: 'select', options: KNOWN_LOCATIONS, required: false },
      { name: 'room', label: 'Room', type: 'text', placeholder: 'Rooms will be configured later' },
      { name: 'linkedAssetIds', label: 'Linked Asset Tags/IDs (comma separated)', type: 'text', required: false },
      { name: 'requestedBy', label: 'Requested By', type: 'text', value: 'Inventory Team', required: true },
      { name: 'requiredDate', label: 'Needed By Date', type: 'date' },
      { name: 'estimatedBudget', label: 'Estimated Budget', type: 'number', min: 0, step: 0.01 },
      { name: 'costCenterId', label: 'Cost Center (optional)', type: 'select', options: costCenterOptions, placeholder: 'Select cost center...' },
      { name: 'budgetAllocationId', label: 'Budget Allocation (optional)', type: 'select', options: allocationOptions, placeholder: 'Select budget allocation...' },
      { name: 'financeStatus', label: 'Finance Status', type: 'select', options: ['not_submitted', 'pending_budget_review', 'budget_approved', 'budget_rejected', 'invoiced', 'payment_pending', 'paid', 'cancelled'], value: 'not_submitted' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
    ],
  });
  if (!form?.confirmed) return;

  const linkedAssetIds = String(form.values.linkedAssetIds || '')
    .split(',')
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  try {
    const created = await sendJson('/inventory/procurement/requests', {
      title: form.values.title,
      itemCategory: form.values.itemCategory,
      itemType: form.values.itemType,
      quantity: Number(form.values.quantity || 1),
      priority: form.values.priority,
      reason: form.values.reason,
      linkedAssetIds,
      linkedDepartment: form.values.linkedDepartment || null,
      linkedLocation: form.values.linkedLocation || null,
      room: form.values.room || null,
      requestedBy: form.values.requestedBy || 'Inventory Team',
      requiredDate: form.values.requiredDate || null,
      estimatedBudget: form.values.estimatedBudget,
      costCenterId: form.values.costCenterId || null,
      budgetAllocationId: form.values.budgetAllocationId || null,
      financeStatus: form.values.financeStatus || 'not_submitted',
      notes: form.values.notes || '',
      source: 'manual_request',
    });
    markProcurementUpdated(created?.requestId || created?.request?.requestId || '');
    notify('Procurement request created.', 'success');
    await loadBoard();
  } catch (error) {
    notify(error.message || 'Failed to create request.', 'error');
  }
}

async function createCostCenter() {
  const form = await showFormModal({
    title: 'Create Cost Center',
    confirmText: 'Create',
    confirmClass: 'btn-primary',
    dialogClass: 'modal-md',
    fields: [
      { name: 'code', label: 'Code', type: 'text', required: true, placeholder: 'IT-CS-LABS' },
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Computer Science Labs' },
      { name: 'department', label: 'Department', type: 'select', options: STANDARD_MIU_DEPARTMENTS, value: 'Computer Science' },
      { name: 'owner', label: 'Owner', type: 'text', placeholder: 'Department Admin' },
      { name: 'annualBudget', label: 'Annual Budget', type: 'number', min: 0, step: 0.01 },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
    ],
  });
  if (!form?.confirmed) return;
  try {
    await sendJson('/inventory/procurement/finance/cost-centers', form.values);
    notify('Cost center created.', 'success');
    await loadErpFoundationPanels();
  } catch (error) {
    notify(error.message || 'Failed to create cost center.', 'error');
  }
}

async function createSupplier() {
  const form = await showFormModal({
    title: 'Create Supplier',
    confirmText: 'Create Supplier',
    confirmClass: 'btn-primary',
    dialogClass: 'modal-lg',
    fields: [
      { name: 'name', label: 'Supplier Name', type: 'text', required: true },
      { name: 'contactName', label: 'Contact Name', type: 'text' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'phone', label: 'Phone', type: 'text' },
      { name: 'leadTimeAverageDays', label: 'Avg Lead Time (days)', type: 'number', min: 0 },
      { name: 'reliabilityScore', label: 'Reliability Score (0-10)', type: 'number', min: 0, max: 10, step: 0.1 },
      { name: 'warrantyQualityScore', label: 'Warranty Quality (0-10)', type: 'number', min: 0, max: 10, step: 0.1 },
      { name: 'categoriesSupplied', label: 'Categories Supplied (comma separated)', type: 'text', placeholder: 'spare_stock,consumable,license' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
    ],
  });
  if (!form?.confirmed) return;
  try {
    const payload = {
      ...form.values,
      categoriesSupplied: String(form.values.categoriesSupplied || '')
        .split(',')
        .map((row) => String(row || '').trim())
        .filter(Boolean),
    };
    await sendJson('/inventory/procurement/suppliers', payload);
    notify('Supplier created.', 'success');
    await loadErpFoundationPanels();
  } catch (error) {
    notify(error.message || 'Failed to create supplier.', 'error');
  }
}

async function createSupplierCatalogItem() {
  const suppliers = Array.isArray(state.suppliers?.suppliers) ? state.suppliers.suppliers : [];
  if (!suppliers.length) {
    notify('Create a supplier first.', 'warning');
    return;
  }
  const form = await showFormModal({
    title: 'Create Supplier Catalog Item',
    confirmText: 'Create Item',
    confirmClass: 'btn-primary',
    dialogClass: 'modal-lg',
    fields: [
      { name: 'vendorId', label: 'Supplier', type: 'select', required: true, options: suppliers.map((row) => ({ value: row.id, label: row.name })) },
      { name: 'itemName', label: 'Item Name', type: 'text', required: true },
      { name: 'category', label: 'Category', type: 'select', options: ['spare_stock', 'consumable', 'license', 'replacement', 'other'], value: 'spare_stock' },
      { name: 'assetType', label: 'Asset/Component Type', type: 'text' },
      { name: 'unitPrice', label: 'Unit Price', type: 'number', min: 0, step: 0.01 },
      { name: 'minimumOrderQuantity', label: 'MOQ', type: 'number', min: 1 },
      { name: 'packSize', label: 'Pack Size', type: 'number', min: 1 },
      { name: 'leadTimeDays', label: 'Lead Time (days)', type: 'number', min: 0 },
      { name: 'warrantyMonths', label: 'Warranty (months)', type: 'number', min: 0 },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
    ],
  });
  if (!form?.confirmed) return;
  try {
    await sendJson('/inventory/procurement/suppliers/catalog', form.values);
    notify('Supplier catalog item created.', 'success');
    await loadErpFoundationPanels();
  } catch (error) {
    notify(error.message || 'Failed to create supplier catalog item.', 'error');
  }
}

async function createRequestFromRecommendation(index) {
  const recs = getBoardRecommendations();
  const row = recs[index];
  if (!row) {
    notify('Recommendation not found.', 'warning');
    return;
  }

  const form = await showFormModal({
    title: 'Create Request From AI Recommendation',
    message: 'Review details before creating the request.',
    confirmText: 'Create Request',
    confirmClass: 'btn-primary',
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true, value: `Procure ${row.itemName || 'item'}` },
      { name: 'itemCategory', label: 'Request Type', type: 'select', required: true, options: ['replacement', 'spare_stock', 'consumable', 'license', 'new_asset', 'maintenance_related', 'audit_related', 'other'], value: row.type || row.category || 'spare_stock' },
      { name: 'itemType', label: 'Item / Type', type: 'text', required: true, value: row.itemName || row.type || '' },
      { name: 'quantity', label: 'Quantity', type: 'number', min: 1, required: true, value: row.recommendedQuantity || 1 },
      { name: 'priority', label: 'Priority', type: 'select', options: ['low', 'medium', 'high', 'critical'], value: String(row.priority || 'medium').toLowerCase(), required: true },
      { name: 'reason', label: 'Reason', type: 'textarea', rows: 3, required: true, value: row.reason || '' },
      { name: 'requestedBy', label: 'Requested By', type: 'text', value: 'Inventory AI Copilot', required: true },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, value: 'Generated from AI procurement recommendation. Review before approval.', required: false },
    ],
  });
  if (!form?.confirmed) return;

  try {
    const created = await sendJson('/inventory/procurement/requests', {
      title: form.values.title,
      itemCategory: form.values.itemCategory,
      itemType: form.values.itemType,
      quantity: Number(form.values.quantity || 1),
      priority: form.values.priority,
      reason: form.values.reason,
      requestedBy: form.values.requestedBy || 'Inventory AI Copilot',
      notes: form.values.notes || '',
      source: 'ai_recommendation',
      aiRecommendationId: row.recommendationKey || null,
      metadata: {
        recommendationKey: row.recommendationKey || null,
        recommendationSource: row.source || null,
        recommendationEvidence: row.evidence || null,
      },
      aiContext: {
        llmUsed: true,
        sourceLabel: String(row.sourceLabel || row.source || 'gemma_generated'),
        confidence: String(row.confidence || row.priority || 'medium').toLowerCase(),
      },
    });
    markProcurementUpdated(created?.requestId || created?.request?.requestId || '');
    if (row.recommendationKey) {
      await sendJson(`/inventory/procurement/recommendations/${encodeURIComponent(row.recommendationKey)}/status`, {
        status: 'converted',
        reviewedBy: 'Inventory AI Copilot',
        itemName: row.itemName || row.type || 'Recommended item',
        source: row.source || 'ai_recommendation',
        priority: row.priority || 'medium',
        evidence: row.evidence || null,
      }, 'PATCH');
    }
    notify('Procurement request created from AI recommendation.', 'success');
    await loadBoard();
  } catch (error) {
    notify(error.message || 'Failed to create request from AI recommendation.', 'error');
  }
}

async function markRecommendation(index, status) {
  const recs = getBoardRecommendations();
  const row = recs[index];
  if (!row || !row.recommendationKey) {
    notify('Recommendation not found.', 'warning');
    return;
  }
  try {
    await sendJson(`/inventory/procurement/recommendations/${encodeURIComponent(row.recommendationKey)}/status`, {
      status,
      reviewedBy: 'Inventory Team',
      itemName: row.itemName || row.type || 'Recommended item',
      source: row.source || 'ai_recommendation',
      priority: row.priority || 'medium',
      reviewNote: status === 'ignored' ? 'Ignored after review.' : 'Reviewed by team.',
      evidence: row.evidence || null,
    }, 'PATCH');
    notify(`Recommendation marked as ${status}.`, 'success');
    await loadBoard();
  } catch (error) {
    notify(error.message || 'Failed to update recommendation status.', 'error');
  }
}

function renderMiniList(rows = [], renderRow, emptyCopy = 'No records yet.') {
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) return `<div class="proc-detail-empty">${escapeHtml(emptyCopy)}</div>`;
  return `<div class="proc-detail-list">${items.map(renderRow).join('')}</div>`;
}

async function openRequestDetails(requestId) {
  const request = getRequestById(requestId);
  if (!request) {
    notify('Request not found.', 'warning');
    return;
  }
  const quotes = Array.isArray(request.vendorQuotes) ? request.vendorQuotes : [];
  const purchaseOrders = Array.isArray(request.purchaseOrders)
    ? request.purchaseOrders
    : (request.purchaseOrder ? [request.purchaseOrder] : []);
  const receivingRecords = Array.isArray(request.receivingRecords)
    ? request.receivingRecords
    : (Array.isArray(request.receipts) ? request.receipts : []);
  const approvals = Array.isArray(request.approvals)
    ? request.approvals
    : (Array.isArray(request.approvalHistory) ? request.approvalHistory : []);
  const linkedAssets = Array.isArray(request.linkedAssetIds)
    ? request.linkedAssetIds.map((row) => (row && typeof row === 'object' ? (row.assetTag || row.assetId || row.id) : row)).filter(Boolean)
    : (Array.isArray(request.linkedAssets) ? request.linkedAssets.map((row) => row.assetTag || row.assetId || row.id).filter(Boolean) : []);
  const selectedQuote = quotes.find((quote) => quote.selected);
  const cost = requestDisplayCost(request);
  const estimate = numericOrNull(request.estimatedBudget);
  const actualOrQuote = numericOrNull(request.actualCost) ?? numericOrNull(selectedQuote?.totalPrice);
  const budgetVariance = estimate !== null && actualOrQuote !== null ? actualOrQuote - estimate : null;
  const nextStep = getNextProcurementAction({ requests: [request] });
  const aiEvidence = request.aiContext || request.metadata?.aiContext || request.metadata || {};

  await showFormModal({
    title: `Request 360 - ${request.requestId || ''}`.trim(),
    messageHtml: `
      <div class="proc-detail-drawer">
        <header class="proc-detail-hero">
          <div>
            <div class="proc-detail-kicker">Request 360 | ${escapeHtml(request.source || 'Manual / Inventory')}</div>
            <h3>${escapeHtml(request.title || request.itemType || 'Procurement request')}</h3>
            <p>${escapeHtml(request.reason || 'No reason recorded.')}</p>
          </div>
          <div class="proc-detail-badge-stack">
            <span class="badge ${statusBadgeClass(request.status)}">${escapeHtml(request.status || 'Draft')}</span>
            <span class="ops-attention-pill ${urgencyClass(request.priority)}">${escapeHtml(request.priority || 'Medium')}</span>
            <span class="ops-attention-pill is-info">${cost !== null ? escapeHtml(formatCurrency(cost)) : 'Budget TBD'}</span>
          </div>
        </header>
        <section class="proc-detail-section">
          <h4>Lifecycle</h4>
          ${buildLifecycleStepper(request.status || 'Draft')}
        </section>
        <section class="proc-detail-grid">
          <div class="proc-detail-section">
            <h4>Need & Scope</h4>
            <dl class="proc-detail-definition-list">
              <div><dt>Item</dt><dd>${escapeHtml(request.itemType || '-')}</dd></div>
              <div><dt>Quantity</dt><dd>${escapeHtml(String(request.quantity ?? 1))}</dd></div>
              <div><dt>Department</dt><dd>${escapeHtml(request.linkedDepartment || 'Unassigned')}</dd></div>
              <div><dt>Building</dt><dd>${escapeHtml(request.linkedLocation || '-')}</dd></div>
              <div><dt>Requested by</dt><dd>${escapeHtml(request.requestedBy || '-')}</dd></div>
              <div><dt>Needed by</dt><dd>${escapeHtml(formatDate(request.requiredDate || request.neededByDate))}</dd></div>
            </dl>
          </div>
          <div class="proc-detail-section">
            <h4>Linked Evidence</h4>
            ${renderMiniList(linkedAssets, (asset) => `<div class="proc-detail-list-row"><span>Asset</span><strong>${escapeHtml(asset)}</strong></div>`, 'No linked asset tags were provided.')}
          </div>
        </section>
        <section class="proc-detail-grid">
          <div class="proc-detail-section">
            <h4>Vendor Quotes</h4>
            ${renderMiniList(quotes, (quote) => `
              <div class="proc-detail-list-row">
                <span>${escapeHtml(quote.vendorName || 'Vendor')}</span>
                <strong>${escapeHtml(formatCurrency(quote.totalPrice))}</strong>
                <small>${quote.selected ? 'Selected quote' : escapeHtml(String(quote.status || 'pending'))}</small>
              </div>
            `, 'No vendor quotes yet.')}
          </div>
          <div class="proc-detail-section">
            <h4>Purchase Orders</h4>
            ${renderMiniList(purchaseOrders, (po) => `
              <div class="proc-detail-list-row">
                <span>${escapeHtml(po.poNumber || 'PO')}</span>
                <strong>${escapeHtml(po.vendorName || selectedQuote?.vendorName || '-')}</strong>
                <small>${escapeHtml(String(po.status || '-').replace(/_/g, ' '))}</small>
              </div>
            `, 'No purchase order created yet.')}
          </div>
        </section>
        <section class="proc-detail-grid">
          <div class="proc-detail-section">
            <h4>Receiving</h4>
            ${renderMiniList(receivingRecords, (record) => `
              <div class="proc-detail-list-row">
                <span>${escapeHtml(formatDateTime(record.receivedAt || record.createdAt))}</span>
                <strong>${escapeHtml(String(record.receivedQuantity || 0))} received</strong>
                <small>${escapeHtml(String(record.condition || 'good').replace(/_/g, ' '))}</small>
              </div>
            `, 'No receiving records yet.')}
          </div>
          <div class="proc-detail-section">
            <h4>Approvals / Decisions</h4>
            ${renderMiniList(approvals, (approval) => `
              <div class="proc-detail-list-row">
                <span>${escapeHtml(approval.decision || approval.toStatus || 'Decision')}</span>
                <strong>${escapeHtml(approval.decidedBy || approval.approver || '-')}</strong>
                <small>${escapeHtml(formatDateTime(approval.createdAt || approval.date))}</small>
              </div>
            `, 'Status decisions appear here when approval history is returned by the API.')}
          </div>
        </section>
        <section class="proc-detail-section">
          <h4>Finance / Budget</h4>
          <div class="proc-budget-mini">
            <span>Estimated</span><strong>${escapeHtml(formatCurrency(request.estimatedBudget))}</strong>
            <span>Actual</span><strong>${escapeHtml(formatCurrency(request.actualCost))}</strong>
            <span>Selected Quote</span><strong>${escapeHtml(formatCurrency(selectedQuote?.totalPrice))}</strong>
            <span>Variance</span><strong>${budgetVariance === null ? 'Missing' : escapeHtml(formatCurrency(budgetVariance))}</strong>
            <span>Finance</span><strong>${escapeHtml(String(request.financeStatus || 'not submitted').replace(/_/g, ' '))}</strong>
          </div>
        </section>
        <section class="proc-detail-grid">
          <div class="proc-detail-section">
            <h4>Next Best Action</h4>
            <div class="proc-detail-next-action">
              <strong>${escapeHtml(nextStep?.title || 'No immediate blocker')}</strong>
              <p>${escapeHtml(nextStep?.reason || 'No pending approval, quote, PO, or receiving blocker was detected from this request status.')}</p>
            </div>
          </div>
          <div class="proc-detail-section">
            <h4>AI / Evidence</h4>
            <div class="proc-detail-next-action">
              <strong>${escapeHtml(sourceLabel(aiEvidence))}</strong>
              <p>${escapeHtml(String(aiEvidence.recommendationEvidence || aiEvidence.evidence || aiEvidence.reason || 'No AI evidence metadata was returned for this request.'))}</p>
            </div>
          </div>
        </section>
      </div>
    `,
    confirmText: 'Close',
    cancelText: 'Dismiss',
    confirmClass: 'btn-primary',
    dialogClass: 'modal-xl',
    fields: [],
  });
}

async function updateRequestStatus(requestId) {
  const request = getRequestById(requestId);
  if (!request) {
    notify('Request not found.', 'warning');
    return;
  }
  const form = await showFormModal({
    title: `Update Status - ${requestId}`,
    message: request.title || '',
    messageHtml: `
      <div class="proc-status-review-card">
        <div class="proc-status-review-title">Current lifecycle</div>
        ${buildLifecycleStepper(request.status || 'Draft')}
      </div>
    `,
    confirmText: 'Update',
    confirmClass: 'btn-outline-primary',
    dialogClass: 'modal-md',
    fields: [
      { name: 'status', label: 'Status', type: 'select', options: PROCUREMENT_STATUSES, value: request.status || 'Draft', required: true },
      { name: 'decision', label: 'Decision', type: 'select', options: ['update', 'submit', 'approve', 'reject', 'order', 'receive', 'close', 'cancel'], value: 'update', required: true },
      { name: 'approver', label: 'Approver', type: 'text', value: 'Inventory Team', required: true },
      { name: 'reason', label: 'Reason', type: 'textarea', rows: 3, required: false },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, required: false },
    ],
  });
  if (!form?.confirmed) return;
  const currentStatus = normalizeValue(request.status || '');
  const nextStatus = normalizeValue(form.values.status || '');
  if (['rejected', 'cancelled'].includes(currentStatus) && !['draft', 'submitted', 'underreview'].includes(nextStatus)) {
    notify('Rejected or cancelled requests must be reopened to Draft, Submitted, or Under Review before later lifecycle actions.', 'warning');
    return;
  }

  try {
    await sendJson(`/inventory/procurement/requests/${encodeURIComponent(requestId)}/status`, {
      status: form.values.status,
      decision: form.values.decision,
      approver: form.values.approver,
      reason: form.values.reason || '',
      notes: form.values.notes || '',
    }, 'PATCH');
    markProcurementUpdated(requestId);
    notify('Request status updated.', 'success');
    await loadBoard();
  } catch (error) {
    notify(error.message || 'Failed to update status.', 'error');
  }
}

async function viewRecommendationEvidence(index) {
  const recs = getBoardRecommendations();
  const row = recs[index];
  if (!row) {
    notify('Recommendation not found.', 'warning');
    return;
  }
  const affectedAssets = Array.isArray(row.affectedAssets) ? row.affectedAssets : [];
  const affectedDepartments = Array.isArray(row.affectedDepartments) ? row.affectedDepartments : [];
  const affectedBuildings = Array.isArray(row.affectedBuildings) ? row.affectedBuildings : [];
  await showFormModal({
    title: 'Recommendation Evidence',
    messageHtml: `
      <div class="proc-evidence-card">
        <div class="proc-evidence-title">${escapeHtml(row.itemName || 'Recommended item')}</div>
        <div class="proc-evidence-grid">
          <div><strong>Priority</strong><span>${escapeHtml(String(row.priority || row.urgency || '-'))}</span></div>
          <div><strong>Quantity</strong><span>${escapeHtml(String(row.recommendedQuantity ?? row.quantity ?? '-'))}</span></div>
          <div><strong>Source</strong><span>${escapeHtml(sourceLabel(row))}</span></div>
          <div><strong>Evidence</strong><span>${escapeHtml(String(row.evidenceLevel || row.dataQuality || '-'))}</span></div>
        </div>
        <div class="proc-evidence-copy">${escapeHtml(String(row.evidenceSummary || row.evidence || row.reason || 'No additional evidence text was provided.'))}</div>
        ${affectedAssets.length ? `<div class="proc-evidence-copy"><strong>Affected assets:</strong> ${escapeHtml(affectedAssets.slice(0, 10).join(', '))}</div>` : ''}
        ${affectedDepartments.length ? `<div class="proc-evidence-copy"><strong>Departments:</strong> ${escapeHtml(affectedDepartments.slice(0, 10).join(', '))}</div>` : ''}
        ${affectedBuildings.length ? `<div class="proc-evidence-copy"><strong>Buildings:</strong> ${escapeHtml(affectedBuildings.slice(0, 10).join(', '))}</div>` : ''}
      </div>
    `,
    confirmText: 'Close',
    cancelText: 'Dismiss',
    confirmClass: 'btn-primary',
    dialogClass: 'modal-lg',
    fields: [],
  });
}

async function addVendorQuote(requestId) {
  const request = getRequestById(requestId);
  if (!request) {
    notify('Request not found.', 'warning');
    return;
  }
  const form = await showFormModal({
    title: `Add Vendor Quote - ${requestId}`,
    message: request.title || '',
    confirmText: 'Save Quote',
    confirmClass: 'btn-outline-primary',
    dialogClass: 'modal-lg',
    fields: [
      { name: 'vendorName', label: 'Vendor Name', type: 'text', required: true },
      { name: 'quotedItem', label: 'Quoted Item', type: 'text', value: request.itemType || request.title || '', required: true },
      { name: 'unitPrice', label: 'Unit Price', type: 'number', min: 0, step: 0.01 },
      { name: 'quantity', label: 'Quantity', type: 'number', value: request.quantity || 1, required: true, min: 1 },
      { name: 'minimumOrderQuantity', label: 'MOQ', type: 'number', min: 1 },
      { name: 'minimumOrderValue', label: 'Minimum Order Value', type: 'number', min: 0, step: 0.01 },
      { name: 'packSize', label: 'Pack Size', type: 'number', min: 1 },
      { name: 'leadTimeDays', label: 'Lead Time (days)', type: 'number', min: 0 },
      { name: 'bulkDiscountAvailable', label: 'Bulk discount available', type: 'checkbox', value: false },
      { name: 'warrantyMonths', label: 'Warranty (months)', type: 'number', min: 0 },
      { name: 'deliveryDays', label: 'Delivery Time (days)', type: 'number', min: 0 },
      { name: 'selected', label: 'Select this quote', type: 'checkbox', value: true },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
    ],
  });
  if (!form?.confirmed) return;

  try {
    await sendJson(`/inventory/procurement/requests/${encodeURIComponent(requestId)}/vendor-quotes`, {
      vendorName: form.values.vendorName,
      quotedItem: form.values.quotedItem,
      unitPrice: form.values.unitPrice !== null ? Number(form.values.unitPrice) : null,
      quantity: Number(form.values.quantity || request.quantity || 1),
      minimumOrderQuantity: form.values.minimumOrderQuantity !== null ? Number(form.values.minimumOrderQuantity) : null,
      minimumOrderValue: form.values.minimumOrderValue !== null ? Number(form.values.minimumOrderValue) : null,
      packSize: form.values.packSize !== null ? Number(form.values.packSize) : null,
      leadTimeDays: form.values.leadTimeDays !== null ? Number(form.values.leadTimeDays) : null,
      bulkDiscountAvailable: Boolean(form.values.bulkDiscountAvailable),
      warrantyMonths: form.values.warrantyMonths !== null ? Number(form.values.warrantyMonths) : null,
      deliveryDays: form.values.deliveryDays !== null ? Number(form.values.deliveryDays) : null,
      selected: Boolean(form.values.selected),
      notes: form.values.notes || '',
    });
    markProcurementUpdated(requestId);
    notify('Vendor quote added.', 'success');
    await loadBoard();
  } catch (error) {
    notify(error.message || 'Failed to add vendor quote.', 'error');
  }
}

async function updateQuoteStatus(requestId, quoteId, action) {
  if (!requestId || !quoteId) return;
  const request = getRequestById(requestId);
  const quote = Array.isArray(request?.vendorQuotes)
    ? request.vendorQuotes.find((row) => String(row.quoteId || '') === String(quoteId || ''))
    : null;
  if (action === 'select' && (!quote || !quote.vendorName || !Number.isFinite(Number(quote.totalPrice)))) {
    notify('Add vendor name and total price before selecting a quote.', 'warning');
    return;
  }
  const isReject = action === 'reject';
  let rejectionReason = '';
  if (isReject) {
    const form = await showFormModal({
      title: 'Reject Vendor Quote',
      message: 'Provide a reason for rejecting this quote.',
      confirmText: 'Reject Quote',
      confirmClass: 'btn-danger',
      dialogClass: 'modal-md',
      fields: [
        { name: 'reason', label: 'Rejection Reason', type: 'textarea', rows: 3, required: true },
      ],
    });
    if (!form?.confirmed) return;
    rejectionReason = String(form.values.reason || '').trim();
  } else {
    const confirmed = await UI.confirm({
      title: 'Select Vendor Quote',
      message: 'Set this quote as selected for the request?',
      confirmText: 'Select Quote',
      confirmClass: 'btn-success',
    });
    if (!confirmed) return;
  }

  try {
    await sendJson(`/inventory/procurement/requests/${encodeURIComponent(requestId)}/vendor-quotes/${encodeURIComponent(quoteId)}`, {
      action,
      selected: action === 'select',
      rejectionReason: rejectionReason || null,
      approver: 'Inventory Team',
    }, 'PATCH');
    markProcurementUpdated(requestId);
    notify(`Quote ${action === 'select' ? 'selected' : 'rejected'}.`, 'success');
    await loadBoard();
  } catch (error) {
    notify(error.message || 'Failed to update quote.', 'error');
  }
}

async function createPurchaseOrder(requestId) {
  const request = getRequestById(requestId);
  if (!request) {
    notify('Request not found.', 'warning');
    return;
  }
  if (normalizeValue(request.status || '') !== 'approved') {
    notify('Purchase orders can be created only after the request is Approved.', 'warning');
    return;
  }
  const selectedVendor = Array.isArray(request.vendorQuotes)
    ? (request.vendorQuotes.find((row) => row.selected)?.vendorName || '')
    : '';
  const form = await showFormModal({
    title: `Create Purchase Order - ${requestId}`,
    message: request.title || '',
    confirmText: 'Create PO',
    confirmClass: 'btn-outline-primary',
    dialogClass: 'modal-md',
    fields: [
      { name: 'poNumber', label: 'PO Number', type: 'text', value: `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(requestId).slice(-4)}`, required: true },
      { name: 'vendorName', label: 'Vendor', type: 'text', value: selectedVendor, required: true },
      { name: 'expectedDelivery', label: 'Expected Delivery', type: 'date' },
      { name: 'status', label: 'PO Status', type: 'select', options: ['ordered', 'processing', 'partial_delivery'], value: 'ordered', required: true },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
    ],
  });
  if (!form?.confirmed) return;

  try {
    await sendJson(`/inventory/procurement/requests/${encodeURIComponent(requestId)}/purchase-order`, {
      poNumber: form.values.poNumber,
      vendorName: form.values.vendorName,
      expectedDelivery: form.values.expectedDelivery || null,
      status: form.values.status,
      notes: form.values.notes || '',
    });
    markProcurementUpdated(requestId);
    notify('Purchase order created.', 'success');
    await loadBoard();
  } catch (error) {
    notify(error.message || 'Failed to create purchase order.', 'error');
  }
}

async function receiveRequest(requestId) {
  const request = getRequestById(requestId);
  if (!request) {
    notify('Request not found.', 'warning');
    return;
  }
  if (!['ordered', 'partiallyreceived'].includes(normalizeValue(request.status || ''))) {
    notify('Receiving is available only for Ordered or Partially Received requests.', 'warning');
    return;
  }
  const alreadyReceived = Number(request.quantityReceived || request.receivedQuantity || 0);
  const orderedQty = Number(request.quantityOrdered || request.quantity || 0);
  const remainingQty = orderedQty > 0 ? Math.max(0, orderedQty - alreadyReceived) : Number(request.quantity || 1);
  const form = await showFormModal({
    title: `Receive Request - ${requestId}`,
    message: request.title || '',
    confirmText: 'Preview Impact',
    confirmClass: 'btn-success',
    dialogClass: 'modal-lg',
    fields: [
      { name: 'receivedQuantity', label: 'Received Quantity', type: 'number', value: remainingQty || 1, required: true, min: 1, max: remainingQty || undefined },
      { name: 'receivedBy', label: 'Received By', type: 'text', value: 'inventory-receiving', required: true },
      { name: 'condition', label: 'Condition', type: 'select', options: ['good', 'partial', 'damaged', 'needs_inspection'], value: 'good', required: true },
      { name: 'applyTarget', label: 'Apply Receiving To', type: 'select', options: [{ value: 'none', label: 'Record only (no stock update)' }, { value: 'spare_stock', label: 'Spare stock quantity update' }], value: 'none', required: true },
      { name: 'spareStockItemId', label: 'Spare Stock Item ID', type: 'text', placeholder: 'Required if apply target is spare stock' },
      { name: 'notes', label: 'Receiving Notes', type: 'textarea', rows: 2 },
    ],
  });
  if (!form?.confirmed) return;
  const receiveQty = Number(form.values.receivedQuantity || 0);
  if (!Number.isFinite(receiveQty) || receiveQty <= 0) {
    notify('Enter a valid received quantity before continuing.', 'warning');
    return;
  }
  if (remainingQty && receiveQty > remainingQty) {
    notify(`Received quantity cannot exceed the remaining ordered quantity (${remainingQty}).`, 'warning');
    return;
  }
  if (String(form.values.applyTarget || '') === 'spare_stock' && !String(form.values.spareStockItemId || '').trim()) {
    notify('Spare stock item ID is required when apply target is spare stock.', 'warning');
    return;
  }

  const payload = {
    receivedQuantity: Number(form.values.receivedQuantity || 1),
    receivedBy: form.values.receivedBy || 'inventory-receiving',
    condition: form.values.condition || 'good',
    applyTarget: form.values.applyTarget || 'none',
    spareStockItemId: form.values.spareStockItemId || null,
    notes: form.values.notes || '',
  };

  try {
    const preview = await sendJson(`/inventory/procurement/requests/${encodeURIComponent(requestId)}/receive`, {
      ...payload,
      previewOnly: true,
    });
    const impact = preview?.impactPreview || {};
    const confirmMessageHtml = `
      <div class="proc-receiving-impact-card ${impact.applyTarget === 'spare_stock' ? 'has-inventory-impact' : ''}">
        <div class="proc-receiving-impact-label">Preview before confirmation</div>
        <div class="proc-receiving-impact-title">${escapeHtml(impact.itemName || request.itemType || 'Receiving impact')}</div>
        <ul class="proc-impact-list">
          <li><span>Request</span><strong>${escapeHtml(impact.requestId || requestId)}</strong></li>
          <li><span>Quantity</span><strong>${escapeHtml(String(impact.receivedQuantity || payload.receivedQuantity))}</strong></li>
          <li><span>Target</span><strong>${escapeHtml(String(impact.applyTarget || payload.applyTarget).replace(/_/g, ' '))}</strong></li>
          ${impact.applyTarget === 'spare_stock' ? `<li><span>Spare stock</span><strong>${escapeHtml(String(impact.spareStockBefore ?? '-'))} -> ${escapeHtml(String(impact.spareStockAfter ?? '-'))}</strong></li>` : ''}
          <li><span>History</span><strong>Procurement receiving event</strong></li>
        </ul>
        <div class="proc-impact-note">${escapeHtml(impact.summary || 'Review receiving impact before applying.')}</div>
      </div>
    `;
    const confirmForm = await showFormModal({
      title: 'Confirm Receiving Impact',
      messageHtml: confirmMessageHtml,
      confirmText: 'Apply Receiving',
      confirmClass: 'btn-success',
      dialogClass: 'modal-md',
      fields: [
        {
          name: 'confirmImpact',
          label: 'I reviewed and approve this receiving impact',
          type: 'checkbox',
          value: false,
          required: true,
          validate: (value) => (value ? '' : 'You must confirm inventory impact to continue.'),
        },
      ],
    });
    if (!confirmForm?.confirmed) return;

    const result = await sendJson(`/inventory/procurement/requests/${encodeURIComponent(requestId)}/receive`, {
      ...payload,
      confirmInventoryImpact: true,
      previewOnly: false,
    });
    markProcurementUpdated(requestId);
    notify(result?.followUp || 'Receiving recorded.', 'success');
    await loadBoard();
  } catch (error) {
    notify(error.message || 'Failed to record receiving.', 'error');
  }
}

function openProcurementCopilot(prompt = '') {
  if (prompt) sessionStorage.setItem('inventory_copilot_prefill', prompt);
  window.location.href = '/pages/inventory.html?ai=copilot&focus=procurement';
}

function showProcurementTab(tabName = 'dashboard') {
  const map = {
    dashboard: 'proc-dashboard-tab',
    requests: 'proc-requests-tab',
    recommendations: 'proc-recommendations-tab',
    quotes: 'proc-quotes-tab',
    orders: 'proc-po-tab',
    receiving: 'proc-receiving-tab',
    finance: 'proc-finance-tab',
    suppliers: 'proc-suppliers-tab',
  };
  const btn = document.getElementById(map[tabName] || map.dashboard);
  if (btn && window.bootstrap?.Tab) bootstrap.Tab.getOrCreateInstance(btn).show();
}

function applyInitialProcurementHash() {
  const hash = String(window.location.hash || '').replace('#', '').trim().toLowerCase();
  if (!hash) return;
  const aliases = {
    dashboard: 'dashboard',
    requests: 'requests',
    recommendations: 'recommendations',
    'ai-recommendations': 'recommendations',
    ai: 'recommendations',
    quotes: 'quotes',
    'vendor-quotes': 'quotes',
    vendors: 'quotes',
    orders: 'orders',
    'purchase-orders': 'orders',
    po: 'orders',
    receiving: 'receiving',
    finance: 'finance',
    budgets: 'finance',
    suppliers: 'suppliers',
    supplier: 'suppliers',
    rfq: 'suppliers',
  };
  const tabName = aliases[hash];
  if (tabName) showProcurementTab(tabName);
}

function continueProcurementWorkflow() {
  const next = getNextProcurementAction();
  if (!next) {
    notify('No urgent procurement workflow blocker was found. You can create a new request or review recommendations.', 'info');
    showProcurementTab('recommendations');
    return;
  }
  if (next.type === 'status') updateRequestStatus(next.requestId);
  else if (next.type === 'quote') addVendorQuote(next.requestId);
  else if (next.type === 'po') createPurchaseOrder(next.requestId);
  else if (next.type === 'receive') receiveRequest(next.requestId);
}

function continueRequestWorkflow(requestId) {
  const request = getRequestById(requestId);
  if (!request) {
    notify('Request not found.', 'warning');
    return;
  }
  const next = getNextProcurementAction({ requests: [request] });
  if (!next) {
    openRequestDetails(requestId);
    return;
  }
  if (next.type === 'status') updateRequestStatus(requestId);
  else if (next.type === 'quote') addVendorQuote(requestId);
  else if (next.type === 'po') createPurchaseOrder(requestId);
  else if (next.type === 'receive') receiveRequest(requestId);
}

function handleProcurement360Action(action = '') {
  const value = String(action || '').trim();
  if (value === 'continue') {
    continueProcurementWorkflow();
    return;
  }
  if (value === 'create') {
    createManualRequest();
    return;
  }
  if (value === 'requests') showProcurementTab('requests');
  else if (value === 'recommendations') showProcurementTab('recommendations');
  else if (value === 'quotes') showProcurementTab('quotes');
  else if (value === 'orders') showProcurementTab('orders');
  else if (value === 'receiving') showProcurementTab('receiving');
  else if (value === 'finance') showProcurementTab('finance');
  else if (value === 'suppliers') showProcurementTab('suppliers');
  else if (value === 'explain-cost') openProcurementCopilot('Explain Procurement 360 cost and budget impact using real procurement evidence only. Do not invent costs, prices, invoices, vendors, or budgets.');
  else if (value === 'explain') openProcurementCopilot('Explain Procurement 360 and what I should do next using real request, quote, PO, receiving, finance, and recommendation evidence only.');
}

function bindActions() {
  const refreshBtn = document.getElementById('procRefreshBtn');
  const createBtn = document.getElementById('procCreateRequestBtn');
  const statusFilter = document.getElementById('procStatusFilter');
  const abcRefreshBtn = document.getElementById('procAbcRefreshBtn');
  const abcClassFilter = document.getElementById('procAbcClassFilter');
  const eoqRefreshBtn = document.getElementById('procEoqRefreshBtn');
  const fifoRefreshBtn = document.getElementById('procFifoRefreshBtn');
  const financeRefreshBtn = document.getElementById('procFinanceRefreshBtn');
  const financeCreateCenterBtn = document.getElementById('procFinanceCreateCenterBtn');
  const suppliersRefreshBtn = document.getElementById('procSuppliersRefreshBtn');
  const supplierCreateBtn = document.getElementById('procSupplierCreateBtn');
  const catalogCreateBtn = document.getElementById('procCatalogCreateBtn');
  const openInventoryBtn = document.getElementById('procOpenInventoryBtn');
  const askCopilotBtn = document.getElementById('procAskCopilotBtn');
  const kanbanBoard = document.getElementById('procKanbanBoard');
  const priorityBoard = document.getElementById('procRequestPriorityBoard');
  const vendorBattleCards = document.getElementById('procVendorBattleCards');
  const requestViewButtons = Array.from(document.querySelectorAll('[data-proc-request-view]'));

  if (refreshBtn) refreshBtn.addEventListener('click', () => loadBoard());
  if (createBtn) createBtn.addEventListener('click', () => createManualRequest());
  if (statusFilter) statusFilter.addEventListener('change', () => loadBoard());
  if (abcRefreshBtn) abcRefreshBtn.addEventListener('click', () => loadErpFoundationPanels());
  if (abcClassFilter) abcClassFilter.addEventListener('change', () => renderAbcPanel());
  if (eoqRefreshBtn) eoqRefreshBtn.addEventListener('click', () => loadErpFoundationPanels());
  if (fifoRefreshBtn) fifoRefreshBtn.addEventListener('click', () => loadErpFoundationPanels());
  if (financeRefreshBtn) financeRefreshBtn.addEventListener('click', () => loadErpFoundationPanels());
  if (financeCreateCenterBtn) financeCreateCenterBtn.addEventListener('click', () => createCostCenter());
  if (suppliersRefreshBtn) suppliersRefreshBtn.addEventListener('click', () => loadErpFoundationPanels());
  if (supplierCreateBtn) supplierCreateBtn.addEventListener('click', () => createSupplier());
  if (catalogCreateBtn) catalogCreateBtn.addEventListener('click', () => createSupplierCatalogItem());
  if (openInventoryBtn) openInventoryBtn.addEventListener('click', () => { window.location.href = '/pages/inventory.html'; });
  if (askCopilotBtn) {
    askCopilotBtn.addEventListener('click', () => {
      sessionStorage.setItem('inventory_copilot_prefill', 'What should we buy next?');
      window.location.href = '/pages/inventory.html?ai=copilot&focus=procurement';
    });
  }
  window.addEventListener('hashchange', applyInitialProcurementHash);
  requestViewButtons.forEach((button) => {
    button.addEventListener('click', () => setRequestViewMode(button.getAttribute('data-proc-request-view') || 'table'));
  });
  document.addEventListener('click', (event) => {
    const actionBtn = event.target?.closest('[data-proc-360-action]');
    if (actionBtn) handleProcurement360Action(actionBtn.getAttribute('data-proc-360-action'));
  });
  applyRequestViewMode();

  const recBody = document.getElementById('procRecommendationsTableBody');
  if (recBody) {
    recBody.addEventListener('click', (event) => {
      const createBtnEl = event.target?.closest('[data-proc-create-from-rec]');
      if (createBtnEl) {
        const index = Number(createBtnEl.getAttribute('data-proc-create-from-rec'));
        if (Number.isFinite(index)) createRequestFromRecommendation(index);
        return;
      }
      const viewBtn = event.target?.closest('[data-proc-view-rec]');
      if (viewBtn) {
        const index = Number(viewBtn.getAttribute('data-proc-view-rec'));
        if (Number.isFinite(index)) viewRecommendationEvidence(index);
        return;
      }
      const reviewBtn = event.target?.closest('[data-proc-review-rec]');
      if (reviewBtn) {
        const index = Number(reviewBtn.getAttribute('data-proc-review-rec'));
        if (Number.isFinite(index)) markRecommendation(index, 'reviewed');
        return;
      }
      const ignoreBtn = event.target?.closest('[data-proc-ignore-rec]');
      if (ignoreBtn) {
        const index = Number(ignoreBtn.getAttribute('data-proc-ignore-rec'));
        if (Number.isFinite(index)) markRecommendation(index, 'ignored');
        return;
      }
      const refreshEmptyBtn = event.target?.closest('#procRefreshRecommendationsEmptyBtn');
      if (refreshEmptyBtn) {
        loadBoard();
      }
    });
  }

  if (kanbanBoard) {
    kanbanBoard.addEventListener('click', (event) => {
      const detailBtn = event.target?.closest('[data-proc-view-request]');
      if (detailBtn) {
        const requestId = String(detailBtn.getAttribute('data-proc-view-request') || '').trim();
        if (requestId) openRequestDetails(requestId);
        return;
      }
      const statusBtn = event.target?.closest('[data-proc-update-status]');
      if (statusBtn) {
        const requestId = String(statusBtn.getAttribute('data-proc-update-status') || '').trim();
        if (requestId) updateRequestStatus(requestId);
        return;
      }
      const quoteBtn = event.target?.closest('[data-proc-add-quote]');
      if (quoteBtn) {
        const requestId = String(quoteBtn.getAttribute('data-proc-add-quote') || '').trim();
        if (requestId) addVendorQuote(requestId);
        return;
      }
      if (event.target?.closest('#procCreateKanbanEmptyBtn')) {
        createManualRequest();
      }
    });
  }

  if (priorityBoard) {
    priorityBoard.addEventListener('click', (event) => {
      const detailBtn = event.target?.closest('[data-proc-view-request]');
      if (detailBtn) {
        const requestId = String(detailBtn.getAttribute('data-proc-view-request') || '').trim();
        if (requestId) openRequestDetails(requestId);
        return;
      }
      const statusBtn = event.target?.closest('[data-proc-update-status]');
      if (statusBtn) {
        const requestId = String(statusBtn.getAttribute('data-proc-update-status') || '').trim();
        if (requestId) updateRequestStatus(requestId);
      }
    });
  }

  const requestsBody = document.getElementById('procRequestsTableBody');
  if (requestsBody) {
    requestsBody.addEventListener('click', (event) => {
      const continueBtn = event.target?.closest('[data-proc-continue-request]');
      if (continueBtn) {
        const requestId = String(continueBtn.getAttribute('data-proc-continue-request') || '').trim();
        if (requestId) continueRequestWorkflow(requestId);
        return;
      }
      const detailBtn = event.target?.closest('[data-proc-view-request]');
      if (detailBtn) {
        const requestId = String(detailBtn.getAttribute('data-proc-view-request') || '').trim();
        if (requestId) openRequestDetails(requestId);
        return;
      }
      const statusBtn = event.target?.closest('[data-proc-update-status]');
      if (statusBtn) {
        const requestId = String(statusBtn.getAttribute('data-proc-update-status') || '').trim();
        if (requestId) updateRequestStatus(requestId);
        return;
      }
      const quoteBtn = event.target?.closest('[data-proc-add-quote]');
      if (quoteBtn) {
        const requestId = String(quoteBtn.getAttribute('data-proc-add-quote') || '').trim();
        if (requestId) addVendorQuote(requestId);
        return;
      }
      const poBtn = event.target?.closest('[data-proc-create-po]');
      if (poBtn) {
        const requestId = String(poBtn.getAttribute('data-proc-create-po') || '').trim();
        if (requestId) createPurchaseOrder(requestId);
        return;
      }
      const receiveBtn = event.target?.closest('[data-proc-receive]');
      if (receiveBtn) {
        const requestId = String(receiveBtn.getAttribute('data-proc-receive') || '').trim();
        if (requestId) receiveRequest(requestId);
        return;
      }
      const createEmptyBtn = event.target?.closest('#procCreateRequestEmptyBtn');
      if (createEmptyBtn) {
        createManualRequest();
      }
    });
  }

  const quotesBody = document.getElementById('procQuotesTableBody');
  if (quotesBody) {
    quotesBody.addEventListener('click', (event) => {
      const selectBtn = event.target?.closest('[data-proc-quote-select]');
      if (selectBtn) {
        const requestId = String(selectBtn.getAttribute('data-proc-quote-select') || '').trim();
        const quoteId = String(selectBtn.getAttribute('data-proc-quote-id') || '').trim();
        if (requestId && quoteId) updateQuoteStatus(requestId, quoteId, 'select');
        return;
      }
      const rejectBtn = event.target?.closest('[data-proc-quote-reject]');
      if (rejectBtn) {
        const requestId = String(rejectBtn.getAttribute('data-proc-quote-reject') || '').trim();
        const quoteId = String(rejectBtn.getAttribute('data-proc-quote-id') || '').trim();
        if (requestId && quoteId) updateQuoteStatus(requestId, quoteId, 'reject');
      }
    });
  }

  if (vendorBattleCards) {
    vendorBattleCards.addEventListener('click', (event) => {
      const selectBtn = event.target?.closest('[data-proc-quote-select]');
      if (selectBtn) {
        const requestId = String(selectBtn.getAttribute('data-proc-quote-select') || '').trim();
        const quoteId = String(selectBtn.getAttribute('data-proc-quote-id') || '').trim();
        if (requestId && quoteId) updateQuoteStatus(requestId, quoteId, 'select');
        return;
      }
      const rejectBtn = event.target?.closest('[data-proc-quote-reject]');
      if (rejectBtn) {
        const requestId = String(rejectBtn.getAttribute('data-proc-quote-reject') || '').trim();
        const quoteId = String(rejectBtn.getAttribute('data-proc-quote-id') || '').trim();
        if (requestId && quoteId) updateQuoteStatus(requestId, quoteId, 'reject');
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!ensureAccess()) return;
  bindActions();
  await loadBoard();
  applyInitialProcurementHash();
});
