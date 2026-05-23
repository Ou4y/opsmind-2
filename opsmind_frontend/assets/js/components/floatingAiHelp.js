import UI from '/assets/js/ui.js';
import AuthService from '/services/authService.js';
import OllamaService from '/services/ollamaService.js';

const FALLBACK_HELP_MESSAGE = 'Global AI Help is not connected yet. Please use the AI Help tools available inside ticket creation or AI ticket actions.';

const QUICK_ACTIONS = [
    'Help me create a ticket',
    'Explain ticket priority',
    'What can Agentic AI do?',
    'How does escalation work?'
];

let initialized = false;
let isSending = false;
let conversationHistory = [];

function getRoot() {
    return document.getElementById('aiFloatingAssistant');
}

function getPanel() {
    return document.getElementById('aiFloatingHelpPanel');
}

function getButton() {
    return document.getElementById('aiFloatingHelpButton');
}

function getInput() {
    return document.getElementById('aiFloatingHelpInput');
}

function getSendButton() {
    return document.getElementById('aiFloatingHelpSend');
}

function getMessagesContainer() {
    return document.getElementById('aiFloatingHelpMessages');
}

function isPanelOpen() {
    return getPanel()?.classList.contains('open') === true;
}

function formatMessage(text) {
    return UI.escapeHTML(String(text || '')).replace(/\n/g, '<br>');
}

function formatClockTime() {
    return new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function scrollMessagesToBottom() {
    const container = getMessagesContainer();
    if (!container) return;
    container.scrollTop = container.scrollHeight;
}

function appendMessage(role, text) {
    const container = getMessagesContainer();
    if (!container) return;

    const message = document.createElement('div');
    message.className = `ai-chat-message ai-chat-message--${role}`;
    message.innerHTML = `
        <div class="ai-chat-message__text">${formatMessage(text)}</div>
        <div class="ai-chat-message__time">${formatClockTime()}</div>
    `;

    container.appendChild(message);
    scrollMessagesToBottom();
}

function showTypingIndicator() {
    const container = getMessagesContainer();
    if (!container || container.querySelector('[data-ai-help-typing="true"]')) return;

    const message = document.createElement('div');
    message.className = 'ai-chat-message ai-chat-message--assistant';
    message.dataset.aiHelpTyping = 'true';
    message.innerHTML = `
        <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
        Thinking...
    `;

    container.appendChild(message);
    scrollMessagesToBottom();
}

function hideTypingIndicator() {
    getMessagesContainer()
        ?.querySelector('[data-ai-help-typing="true"]')
        ?.remove();
}

function setComposerState(disabled) {
    const input = getInput();
    const sendButton = getSendButton();

    if (input) input.disabled = disabled;
    if (sendButton) sendButton.disabled = disabled;
}

function openPanel() {
    const panel = getPanel();
    const button = getButton();
    const input = getInput();
    if (!panel || !button) return;

    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    button.setAttribute('aria-expanded', 'true');
    input?.focus();
}

function closePanel() {
    const panel = getPanel();
    const button = getButton();
    if (!panel || !button) return;

    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    button.setAttribute('aria-expanded', 'false');
    button.focus();
}

async function sendMessage(messageText) {
    const trimmed = String(messageText || '').trim();
    if (!trimmed || isSending) return;

    const input = getInput();
    if (input) {
        input.value = '';
    }

    appendMessage('user', trimmed);
    conversationHistory.push({ sender: 'user', text: trimmed });

    isSending = true;
    setComposerState(true);
    showTypingIndicator();

    try {
        const reply = await OllamaService.generateResponse(trimmed, conversationHistory);
        const safeReply = String(reply || '').trim();

        hideTypingIndicator();

        if (!safeReply) {
            appendMessage('assistant', FALLBACK_HELP_MESSAGE);
            conversationHistory.push({ sender: 'bot', text: FALLBACK_HELP_MESSAGE });
        } else {
            appendMessage('assistant', safeReply);
            conversationHistory.push({ sender: 'bot', text: safeReply });
        }
    } catch (_error) {
        hideTypingIndicator();
        appendMessage('assistant', FALLBACK_HELP_MESSAGE);
        conversationHistory.push({ sender: 'bot', text: FALLBACK_HELP_MESSAGE });
    } finally {
        isSending = false;
        setComposerState(false);
        getInput()?.focus();
    }
}

function bindEvents() {
    const root = getRoot();
    const button = getButton();
    const panel = getPanel();
    const closeButton = document.getElementById('aiFloatingHelpClose');
    const input = getInput();
    const sendButton = getSendButton();

    if (!root || !button || !panel || !closeButton || !input || !sendButton) return;

    button.addEventListener('click', () => {
        if (isPanelOpen()) {
            closePanel();
            return;
        }
        openPanel();
    });

    closeButton.addEventListener('click', () => {
        closePanel();
    });

    sendButton.addEventListener('click', () => {
        void sendMessage(input.value);
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void sendMessage(input.value);
        }
    });

    root.querySelectorAll('[data-ai-help-quick-action]').forEach((chip) => {
        chip.addEventListener('click', () => {
            const message = chip.getAttribute('data-ai-help-quick-action');
            if (!message) return;
            void sendMessage(message);
        });
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && isPanelOpen()) {
            closePanel();
        }
    });

    document.addEventListener('click', (event) => {
        if (!isPanelOpen()) return;
        if (!root.contains(event.target)) {
            closePanel();
        }
    });
}

function renderFloatingAssistant() {
    if (getRoot()) return;

    const chipsHtml = QUICK_ACTIONS.map((label) => `
        <button type="button" class="ai-chat-chip" data-ai-help-quick-action="${UI.escapeHTML(label)}">
            ${UI.escapeHTML(label)}
        </button>
    `).join('');

    document.body.insertAdjacentHTML('beforeend', `
        <div class="ai-floating-assistant" id="aiFloatingAssistant">
            <section class="ai-chat-panel" id="aiFloatingHelpPanel" aria-hidden="true" role="dialog" aria-label="OpsMind AI Help">
                <div class="ai-chat-header">
                    <div class="ai-chat-header__title">
                        <span class="ai-chat-header__icon"><i class="bi bi-robot"></i></span>
                        <div>
                            <h6>OpsMind AI Help</h6>
                            <p>Ask for guidance about tickets, workflows, and AI actions.</p>
                        </div>
                    </div>
                    <button type="button" class="ai-chat-close" id="aiFloatingHelpClose" aria-label="Close OpsMind AI Help">
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>
                <div class="ai-chat-body" id="aiFloatingHelpMessages">
                    <div class="ai-chat-message ai-chat-message--assistant">
                        <div class="ai-chat-message__text">Welcome to OpsMind AI Help. Ask about ticketing workflows, escalation, or AI-assisted actions.</div>
                        <div class="ai-chat-message__time">Now</div>
                    </div>
                    <div class="ai-chat-chips">${chipsHtml}</div>
                </div>
                <div class="ai-chat-footer">
                    <label class="visually-hidden" for="aiFloatingHelpInput">Ask OpsMind AI Help</label>
                    <div class="ai-chat-footer__composer">
                        <input
                            type="text"
                            class="ai-chat-input"
                            id="aiFloatingHelpInput"
                            aria-label="Ask OpsMind AI Help"
                            placeholder="Ask OpsMind AI Help..."
                            maxlength="1000"
                        >
                        <button type="button" class="btn ai-action-btn ai-action-btn-primary ai-chat-send-btn" id="aiFloatingHelpSend">
                            <i class="bi bi-send-fill"></i>
                            Send
                        </button>
                    </div>
                </div>
            </section>
            <button
                type="button"
                class="ai-floating-button"
                id="aiFloatingHelpButton"
                aria-label="Open OpsMind AI Help"
                aria-controls="aiFloatingHelpPanel"
                aria-expanded="false"
            >
                <span class="ai-floating-button__pulse" aria-hidden="true"></span>
                <span class="ai-floating-button__icon"><i class="bi bi-robot"></i></span>
                <span class="ai-floating-button__tooltip">AI Help</span>
            </button>
        </div>
    `);
}

export function initFloatingAiHelp() {
    if (initialized || !AuthService.isAuthenticated()) return;

    renderFloatingAssistant();
    bindEvents();
    initialized = true;
}

export function openFloatingAiHelp() {
    if (!initialized) {
        initFloatingAiHelp();
    }
    openPanel();
}
