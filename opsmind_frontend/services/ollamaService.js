/**
 * OpsMind - AI Orchestration Service
 *
 * Frontend wrapper around Ticket Service AI endpoints.
 * Gemma/Ollama runs on backend only.
 */

import AuthService from '/services/authService.js';

const API_BASE_URL = window.OPSMIND_TICKET_URL || 'http://localhost:3001';

function buildAiUrl(path) {
    const base = String(API_BASE_URL).replace(/\/+$/, '');
    const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${path}`;
    return `${base}${normalizedPath}`;
}

function buildHeaders(extra = {}) {
    return {
        'Content-Type': 'application/json',
        ...AuthService.getAuthHeaders(),
        ...extra
    };
}

async function handleJsonResponse(response) {
    if (response.status === 401) {
        AuthService.clearAuth();
        window.location.href = '/index.html';
        throw new Error('Session expired');
    }

    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload?.success === false) {
        const message = payload.error || payload.message || payload.details || `Request failed: ${response.status}`;
        throw new Error(message);
    }

    return payload;
}

function parseSseEventBlock(block) {
    const lines = String(block || '').split('\n');
    let event = 'message';
    const dataLines = [];

    lines.forEach((line) => {
        if (line.startsWith('event:')) {
            event = line.slice(6).trim() || 'message';
            return;
        }

        if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
        }
    });

    let data = null;
    const joinedData = dataLines.join('\n');
    if (joinedData) {
        data = JSON.parse(joinedData);
    }

    return { event, data };
}

async function streamPlainTextResponse(response, handlers = {}) {
    if (response.status === 401) {
        AuthService.clearAuth();
        window.location.href = '/index.html';
        throw new Error('Session expired');
    }

    if (!response.ok) {
        let message = `Request failed: ${response.status}`;
        try {
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const payload = await response.json();
                message = payload?.error || payload?.message || payload?.details || message;
            } else {
                const text = await response.text();
                message = text || message;
            }
        } catch (_error) {
            // Keep fallback message.
        }

        throw new Error(message);
    }

    if (!response.body) {
        throw new Error('AI stream unavailable from backend');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;

        fullText += chunk;
        handlers.onChunk?.(chunk);
    }

    const trailing = decoder.decode();
    if (trailing) {
        fullText += trailing;
        handlers.onChunk?.(trailing);
    }

    handlers.onComplete?.(fullText);
    return fullText;
}

const OllamaService = {
    async getUserAiHelp(ticketPayload = {}) {
        const response = await fetch(buildAiUrl('/ai/help'), {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify({ ticket: ticketPayload })
        });

        const payload = await handleJsonResponse(response);
        return payload.data;
    },

    async streamUserAiHelp(ticketPayload = {}, handlers = {}) {
        const response = await fetch(buildAiUrl('/ai/help/stream'), {
            method: 'POST',
            headers: buildHeaders({ Accept: 'text/plain' }),
            body: JSON.stringify(ticketPayload)
        });

        return streamPlainTextResponse(response, handlers);
    },

    async getTechnicianAnalysis(ticketPayload = {}) {
        const response = await fetch(buildAiUrl('/ai/technician/analysis'), {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify({ ticket: ticketPayload })
        });

        const payload = await handleJsonResponse(response);
        return payload.data;
    },

    async streamTechnicianAnalysis(ticketPayload = {}, handlers = {}) {
        const response = await fetch(buildAiUrl('/ai/technician/analysis/stream'), {
            method: 'POST',
            headers: buildHeaders({ Accept: 'text/event-stream' }),
            body: JSON.stringify({ ticket: ticketPayload })
        });

        if (!response.ok) {
            let message = `AI stream request failed: ${response.status}`;
            try {
                const body = await response.json();
                message = body.error || body.message || body.details || message;
            } catch (_error) {
                // Ignore parse errors and use status message.
            }
            throw new Error(message);
        }

        if (!response.body) {
            throw new Error('AI stream unavailable from backend');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let buffer = '';
        let finalResult = null;
        let streamError = null;

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split('\n\n');
            buffer = blocks.pop() || '';

            blocks.forEach((block) => {
                if (!block.trim()) return;

                try {
                    const { event, data } = parseSseEventBlock(block);
                    if (event === 'result') {
                        finalResult = data;
                    }

                    if (event === 'error') {
                        streamError = data?.message || 'AI stream failed';
                    }

                    handlers.onEvent?.(event, data);
                } catch (error) {
                    console.warn('[OllamaService] Failed to parse SSE block', error);
                }
            });
        }

        if (buffer.trim()) {
            try {
                const { event, data } = parseSseEventBlock(buffer);
                if (event === 'result') {
                    finalResult = data;
                }
                if (event === 'error') {
                    streamError = data?.message || 'AI stream failed';
                }
                handlers.onEvent?.(event, data);
            } catch (error) {
                console.warn('[OllamaService] Failed to parse trailing SSE block', error);
            }
        }

        if (finalResult) {
            return finalResult;
        }

        if (streamError) {
            throw new Error(streamError);
        }

        throw new Error('AI stream completed without result');
    },

    // Backward-compatible aliases.
    async analyzeDirectSteps(ticketPayload = {}) {
        return this.getUserAiHelp(ticketPayload);
    },

    async streamDirectSteps(ticketPayload = {}, handlers = {}) {
        return this.streamTechnicianAnalysis(ticketPayload, handlers);
    },

    async generateResponse(message, conversationHistory = []) {
        const response = await fetch(buildAiUrl('/ai/chatbot'), {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify({
                message,
                conversationHistory
            })
        });

        const payload = await handleJsonResponse(response);
        return payload?.data?.reply || '';
    },

    async enhanceDescription(input = {}) {
        const response = await fetch(buildAiUrl('/ai/enhance-description'), {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify(input)
        });

        const payload = await handleJsonResponse(response);
        return payload?.data?.enhancedDescription || '';
    },

    async streamDescriptionEnhancement(input = {}, handlers = {}) {
        const response = await fetch(buildAiUrl('/ai/description-enhancement/stream'), {
            method: 'POST',
            headers: buildHeaders({ Accept: 'text/plain' }),
            body: JSON.stringify(input)
        });

        return streamPlainTextResponse(response, handlers);
    },

    async classify(input = {}) {
        const response = await fetch(buildAiUrl('/ai/classification'), {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify(input)
        });

        const payload = await handleJsonResponse(response);
        return payload?.data?.result;
    }
};

export default OllamaService;
