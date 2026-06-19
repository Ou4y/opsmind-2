import UI from '/assets/js/ui.js';
import AuthService from '/services/authService.js';

const API_URL = window.OPSMIND_INVENTORY_API_URL || 'http://localhost:5000/api';
const LONG_WAIT_MS = 5000;

function escapeHtml(value) {
  return UI.escapeHTML(String(value ?? ''));
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

function authHeaders(extra = {}) {
  return {
    ...AuthService.getInventoryAuthHeaders(),
    ...extra,
  };
}

async function postJson(path, body = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body || {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || `Inventory AI request failed (${response.status})`);
  return payload;
}

function parseSseBlock(block = '') {
  const lines = String(block || '').split(/\r?\n/);
  let event = 'message';
  const dataLines = [];
  lines.forEach((line) => {
    if (line.startsWith('event:')) event = line.slice(6).trim() || 'message';
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  });
  if (!dataLines.length) return null;
  const dataText = dataLines.join('\n');
  try {
    return { event, data: JSON.parse(dataText) };
  } catch {
    return { event, data: { text: dataText } };
  }
}

async function postAssistantStream(path, body = {}, handlers = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body || {}),
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.message || `Inventory AI stream failed (${response.status})`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalPayload = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSseBlock(block);
      if (parsed?.event === 'metadata') handlers.onMetadata?.(parsed.data || {});
      if (parsed?.event === 'chunk') handlers.onChunk?.(String(parsed.data?.text || ''), parsed.data || {});
      if (parsed?.event === 'fallback') handlers.onFallback?.(parsed.data || {});
      if (parsed?.event === 'done') finalPayload = parsed.data || {};
      boundary = buffer.indexOf('\n\n');
    }
  }
  return finalPayload || {};
}

function technicalSourceLabel(entry = {}) {
  const raw = String(entry.sourceLabel || entry.llmStatus || '').toLowerCase();
  if (entry.fallbackUsed || raw.includes('fallback')) return 'Fallback';
  if (entry.llmUsed || raw.includes('gemma')) return 'Gemma';
  if (raw.includes('hybrid')) return 'Hybrid';
  return 'Deterministic';
}

function sourceLabel(entry = {}) {
  const technical = technicalSourceLabel(entry);
  if (technical === 'Gemma') return 'AI insight';
  if (technical === 'Hybrid') return 'Estimated';
  return 'System data';
}

function sourceInfoIcon(entry = {}) {
  const technical = technicalSourceLabel(entry);
  return `<span class="ops-source-info" title="Internal source: ${escapeHtml(technical)}" aria-label="Internal source: ${escapeHtml(technical)}"><i class="bi bi-info-circle"></i></span>`;
}

function statusModeFromResult(result = {}) {
  const label = technicalSourceLabel(result).toLowerCase();
  if (label.includes('fallback')) return 'fallback';
  if (label.includes('gemma')) return 'gemma';
  if (label.includes('hybrid')) return 'gemma';
  return 'deterministic';
}

function normalizeSuggestions(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6);
}

function renderPromptButtons(prompts = []) {
  return prompts.map((prompt) => `
    <button type="button" class="inventory-ai-prompt-card" data-inventory-copilot-prompt="${escapeHtml(prompt.prompt || prompt.label)}">
      <span>${escapeHtml(prompt.label || prompt.prompt)}</span>
    </button>
  `).join('');
}

function renderQuickActions(actions = []) {
  if (!actions.length) return '';
  return `
    <div class="inventory-ai-chat-actions">
      ${actions.map((action) => `
        <button type="button" class="btn btn-sm btn-outline-primary" data-inventory-copilot-url="${escapeHtml(action.url || '')}" data-inventory-copilot-prompt="${escapeHtml(action.prompt || '')}">
          ${escapeHtml(action.label || 'Open')}
        </button>
      `).join('')}
    </div>
  `;
}

function renderMatchedItems(items = []) {
  const rows = items.slice(0, 3).map((item) => {
    const assetId = item.assetId || item.customId || item.id || '';
    return `
      <div class="inventory-ai-chat-match">
        <div class="fw-semibold">${escapeHtml(item.name || assetId || 'Matched asset')}</div>
        <div class="small text-muted">${escapeHtml(assetId || item.assetTag || '-')} - ${escapeHtml(item.location || item.department || item.type || 'Inventory record')}</div>
        ${assetId ? `
          <div class="inventory-ai-chat-actions mt-2">
            <button type="button" class="btn btn-sm btn-outline-primary" data-inventory-copilot-url="/pages/inventory.html?asset=${escapeHtml(encodeURIComponent(assetId))}">Open Asset</button>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
  return rows ? `<div class="inventory-ai-chat-match-list">${rows}</div>` : '';
}

function createCopilotMarkup(options = {}) {
  const prompts = options.prompts || [];
  const pageLabel = options.pageLabel || 'Inventory';
  return `
    <button type="button" id="inventoryAiChatLauncher" class="inventory-ai-chat-launcher inventory-ai-chat-launcher--robot" title="Inventory AI" aria-label="Open Inventory AI Copilot">
      <span class="ai-floating-button__pulse" aria-hidden="true"></span>
      <span class="ai-floating-button__icon"><i class="bi bi-robot"></i></span>
      <span class="inventory-ai-chat-launcher-label">Inventory AI</span>
    </button>

    <section id="inventoryAiChatPanel" class="inventory-ai-chat-panel inventory-ai-chat-panel--shared" aria-label="Inventory AI Copilot" role="dialog" aria-hidden="true">
      <div class="inventory-ai-chat-header">
        <div>
          <div class="inventory-ai-chat-title"><span class="ai-chat-header__icon"><i class="bi bi-robot"></i></span>Inventory AI Copilot <span class="inventory-ai-chat-title-badge">AI insight</span></div>
          <div class="inventory-ai-chat-subtitle">Ask about inventory health, costs, stock, procurement, vendors, EOL, or next actions.</div>
          <div class="inventory-ai-chat-context-row">
            <span class="inventory-ai-chat-context-chip">${escapeHtml(pageLabel)} context</span>
            <span class="inventory-ai-chat-status" id="inventoryAiChatStatusBadge" title="LLM assistant status">
              <span class="inventory-ai-chat-status-label">Status</span>
              <span id="inventoryAiChatStatusDot" class="inventory-ai-status-dot"></span>
              <span id="inventoryAiChatStatusText">AI ready</span>
            </span>
          </div>
        </div>
        <div class="d-flex gap-1">
          <button type="button" class="btn btn-sm btn-outline-secondary" id="inventoryAiChatMinimizeBtn" aria-label="Minimize Inventory AI Copilot">
            <i class="bi bi-dash-lg"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-secondary" id="inventoryAiChatCloseBtn" aria-label="Close Inventory AI Copilot">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
      </div>
      <div class="inventory-ai-quick-prompts" id="inventoryAiQuickPrompts" data-collapsed="false">
        <div class="inventory-ai-prompt-header">
          <div class="inventory-ai-prompt-group-title mb-0">Fast questions</div>
          <button type="button" class="btn btn-outline-secondary btn-sm inventory-ai-prompt-toggle" id="inventoryAiPromptToggleBtn">Collapse</button>
        </div>
        <div class="inventory-ai-prompt-cards w-100">${renderPromptButtons(prompts)}</div>
      </div>
      <div class="inventory-ai-chat-body" id="inventoryAiChatMessages"></div>
      <div class="inventory-ai-chat-input">
        <div class="input-group input-group-sm">
          <textarea id="inventoryAiChatInput" class="form-control" rows="2" placeholder="Ask Inventory AI..." aria-label="Inventory AI Copilot message"></textarea>
          <button type="button" class="btn btn-primary" id="inventoryAiChatSendBtn" aria-label="Send message to Inventory AI Copilot">
            <i class="bi bi-send"></i>
          </button>
        </div>
        <div class="small text-muted mt-1">Press Enter to send. Shift+Enter for a new line. Answers appear after evidence checks complete.</div>
      </div>
    </section>
  `;
}

export function initInventoryAiCopilot(options = {}) {
  if (document.getElementById('inventoryAiChatPanel')) return null;

  const state = {
    open: false,
    loading: false,
    loadingSince: null,
    messages: [],
    typingTimer: null,
    options,
  };

  document.body.insertAdjacentHTML('beforeend', createCopilotMarkup(options));

  const panel = document.getElementById('inventoryAiChatPanel');
  const launcher = document.getElementById('inventoryAiChatLauncher');
  const input = document.getElementById('inventoryAiChatInput');
  const sendBtn = document.getElementById('inventoryAiChatSendBtn');
  const prompts = document.getElementById('inventoryAiQuickPrompts');
  const promptToggle = document.getElementById('inventoryAiPromptToggleBtn');

  function setStatus(mode = 'gemma') {
    const statusEl = document.getElementById('inventoryAiChatStatusBadge');
    const dot = document.getElementById('inventoryAiChatStatusDot');
    const text = document.getElementById('inventoryAiChatStatusText');
    const normalized = String(mode || 'gemma').toLowerCase();
    const isFallback = normalized.includes('fallback');
    const isError = normalized.includes('error') || normalized.includes('offline');
    const isLoading = normalized.includes('loading');
    if (statusEl) statusEl.dataset.mode = isError ? 'offline' : (isFallback ? 'fallback' : (isLoading ? 'loading' : 'gemma'));
    if (dot) {
      dot.classList.toggle('warning', isFallback || isLoading);
      dot.classList.toggle('error', isError);
    }
    if (text) {
      text.textContent = isError
        ? 'Offline'
        : isFallback
          ? 'System data mode'
          : isLoading
            ? 'Checking evidence'
            : 'AI ready';
    }
  }

  function finishTyping() {
    if (state.typingTimer) clearInterval(state.typingTimer);
    state.typingTimer = null;
    state.messages.forEach((message) => {
      if (message.typing) {
        message.text = message.fullText || message.text || '';
        message.typing = false;
      }
    });
  }

  function render() {
    const container = document.getElementById('inventoryAiChatMessages');
    if (!container) return;
    panel?.classList.toggle('has-messages', state.messages.length > 0);
    const emptyState = `
      <div class="inventory-ai-chat-empty">
        <div class="inventory-ai-chat-empty-title">Inventory AI Copilot</div>
        <div class="inventory-ai-chat-empty-sub">Ask about inventory health, costs, missing data, procurement, stock, EOL, vendors, or next actions.</div>
      </div>
    `;
    const messagesHtml = state.messages.map((message) => {
      const role = message.role === 'user' ? 'user' : 'assistant';
      const isAssistant = role === 'assistant';
      const badges = isAssistant ? [
        `<span class="inventory-ai-chat-pill is-success">${escapeHtml(sourceLabel(message))}${sourceInfoIcon(message)}</span>`,
        message.confidence ? `<span class="inventory-ai-chat-pill is-info">Evidence: ${escapeHtml(String(message.confidence).toUpperCase())}</span>` : '',
        message.dataScope ? `<span class="inventory-ai-chat-pill">${escapeHtml(message.dataScope)}</span>` : '',
      ].filter(Boolean).join('') : '';
      const suggestions = isAssistant && message.suggestedActions?.length
        ? `<div class="mt-2"><strong>Suggested actions</strong><div class="mt-1">${message.suggestedActions.map((item) => `<span class="inventory-ai-chat-pill">${escapeHtml(item)}</span>`).join('')}</div></div>`
        : '';
      const fallback = isAssistant && message.fallbackUsed
        ? `<div class="inventory-ai-chat-fallback mt-2"><strong>System data used</strong><div class="small">Reason: ${escapeHtml(message.fallbackReason || 'AI insight was unavailable for this request.')}</div></div>`
        : '';
      return `
        <div class="inventory-ai-chat-msg ${role} ${message.justAdded ? 'ops-ai-response-fade' : ''}">
          <div class="inventory-ai-msg-head"><i class="bi ${isAssistant ? 'bi-robot' : 'bi-person-circle'}"></i><span>${isAssistant ? 'Inventory AI' : 'You'}</span></div>
          <div class="inventory-ai-chat-answer">${isAssistant ? '<strong>Answer:</strong> ' : ''}${escapeHtml(message.text || '')}${message.typing ? '<span class="inventory-ai-typing-caret" aria-hidden="true"></span>' : ''}</div>
          ${isAssistant && !message.typing ? `<div class="inventory-ai-chat-meta">${badges}${suggestions}${fallback}${renderMatchedItems(message.matchedItems)}${renderQuickActions(options.quickActions || [])}</div>` : ''}
        </div>
      `;
    }).join('');
    const elapsed = state.loadingSince ? Date.now() - state.loadingSince : 0;
    const hasStreamingAssistant = state.messages.some((message) => message.role === 'assistant' && message.typing);
    const loading = state.loading && !hasStreamingAssistant
      ? `<div class="inventory-ai-chat-msg assistant inventory-ai-chat-loading"><span class="inventory-ai-thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>${escapeHtml(elapsed >= LONG_WAIT_MS ? 'Local AI may take longer on first response.' : 'Checking inventory evidence...')}</span></div>`
      : '';
    container.innerHTML = (messagesHtml || emptyState) + loading;
    container.scrollTop = container.scrollHeight;
    if (sendBtn) sendBtn.disabled = state.loading;
    if (input) input.disabled = state.loading;
  }

  function revealMessage(index) {
    const message = state.messages[index];
    if (!message || message.role !== 'assistant' || !message.typing) return;
    if (state.typingTimer) clearInterval(state.typingTimer);
    state.typingTimer = null;
    message.text = message.fullText || message.text || '';
    message.typing = false;
    message.justAdded = true;
    render();
  }

  function addAssistantMessage(entry = {}) {
    const fullText = String(entry.text || entry.answer || 'Completed.');
    const shouldType = false;
    const message = {
      ...entry,
      role: 'assistant',
      fullText,
      text: shouldType ? '' : fullText,
      typing: shouldType,
      justAdded: true,
      createdAt: Date.now(),
    };
    state.messages.push(message);
    const index = state.messages.length - 1;
    render();
    if (shouldType) revealMessage(index);
  }

  function addStreamingAssistantMessage(entry = {}) {
    const message = {
      ...entry,
      role: 'assistant',
      fullText: '',
      text: '',
      typing: true,
      justAdded: true,
      createdAt: Date.now(),
    };
    state.messages.push(message);
    render();
    return state.messages.length - 1;
  }

  function updateAssistantMessage(index, patch = {}) {
    const message = state.messages[index];
    if (!message || message.role !== 'assistant') return;
    Object.assign(message, patch);
    render();
  }

  function open(force = null) {
    state.open = typeof force === 'boolean' ? force : !state.open;
    panel?.classList.toggle('is-open', state.open);
    panel?.setAttribute('aria-hidden', state.open ? 'false' : 'true');
    launcher?.classList.toggle('d-none', state.open);
    if (state.open && input) input.focus();
    render();
  }

  async function send(messageOverride = '') {
    if (state.loading) return;
    finishTyping();
    const value = String(messageOverride || input?.value || '').trim();
    if (!value) return;
    state.messages.push({ role: 'user', text: value, createdAt: Date.now() });
    if (input) input.value = '';
    state.loading = true;
    state.loadingSince = Date.now();
    setStatus('loading');
    render();
    try {
      const context = typeof options.contextProvider === 'function' ? options.contextProvider() : {};
      const requestBody = {
        query: value,
        message: value,
        context: {
          ...context,
          pageContext: options.pageKey || options.pageLabel || 'inventory',
        },
        currentView: options.pageKey || 'inventory',
        recentMessages: state.messages
          .filter((message) => message.role === 'user' || message.role === 'assistant')
          .slice(-8)
          .map((message) => ({ role: message.role, text: message.text })),
      };
      let streamIndex = null;
      let streamedText = '';
      let result = await postAssistantStream('/inventory/ai/assistant/stream', requestBody, {
        onMetadata: (meta) => {
          setStatus(meta?.deterministicOnly ? 'deterministic' : 'loading');
        },
        onChunk: (chunk) => {
          if (!chunk) return;
          if (streamIndex === null) streamIndex = addStreamingAssistantMessage({
            sourceLabel: 'gemma_generated',
            llmUsed: true,
          });
          streamedText += chunk;
          updateAssistantMessage(streamIndex, {
            text: streamedText,
            fullText: streamedText,
            typing: true,
            sourceLabel: 'gemma_generated',
            llmUsed: true,
          });
        },
        onFallback: () => {
          setStatus('fallback');
        },
      }).catch(async (streamError) => {
        console.warn('[InventoryAI] stream failed; using JSON assistant fallback', streamError);
        return postJson('/inventory/ai/assistant', requestBody);
      });
      const finalText = streamedText || String(result?.answer || 'No assistant answer returned.');
      const finalEntry = {
        text: finalText,
        confidence: String(result?.confidence || result?.evidenceConfidence || 'medium'),
        fallbackUsed: Boolean(result?.fallbackUsed),
        fallbackReason: String(result?.fallbackReason || ''),
        sourceLabel: String(result?.sourceLabel || ''),
        llmStatus: String(result?.llmStatus || ''),
        llmUsed: Boolean(result?.llmUsed),
        dataScope: String(result?.dataScope || ''),
        matchedItems: Array.isArray(result?.matchedItems) ? result.matchedItems : [],
        suggestedActions: normalizeSuggestions(result?.suggestedActions),
      };
      if (streamIndex !== null) {
        updateAssistantMessage(streamIndex, {
          ...finalEntry,
          text: finalText,
          fullText: finalText,
          typing: false,
          justAdded: true,
        });
      } else {
        addAssistantMessage(finalEntry);
      }
      setStatus(statusModeFromResult(result));
    } catch (error) {
      addAssistantMessage({
        text: 'I could not reach Inventory AI right now. System data is still available; try again in a moment.',
        fallbackUsed: true,
        fallbackReason: error.message || 'request_failed',
        confidence: 'low',
        sourceLabel: 'Fallback',
      });
      setStatus('error');
    } finally {
      state.loading = false;
      state.loadingSince = null;
      render();
    }
  }

  launcher?.addEventListener('click', () => open(true));
  document.getElementById('inventoryAiChatCloseBtn')?.addEventListener('click', () => open(false));
  document.getElementById('inventoryAiChatMinimizeBtn')?.addEventListener('click', () => open(false));
  sendBtn?.addEventListener('click', () => send());
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });
  promptToggle?.addEventListener('click', () => {
    const collapsed = prompts?.getAttribute('data-collapsed') === 'true';
    prompts?.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
    promptToggle.textContent = collapsed ? 'Collapse' : 'Expand';
  });
  document.addEventListener('click', (event) => {
    const promptBtn = event.target?.closest('[data-inventory-copilot-prompt]');
    if (promptBtn) {
      const prompt = promptBtn.getAttribute('data-inventory-copilot-prompt') || '';
      const url = promptBtn.getAttribute('data-inventory-copilot-url') || '';
      if (url) {
        window.location.href = url;
        return;
      }
      open(true);
      send(prompt);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.open) open(false);
  });

  window.openInventoryAiChatWithPrompt = async (prompt) => {
    open(true);
    await send(prompt);
  };
  window.openInventoryCopilotWithPrompt = window.openInventoryAiChatWithPrompt;

  setStatus('gemma');
  render();
  return { open, send };
}
