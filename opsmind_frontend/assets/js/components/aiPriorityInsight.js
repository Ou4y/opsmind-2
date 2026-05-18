import UI from '/assets/js/ui.js';

const DECISION_SOURCE_LABELS = {
    RULE_AI_AGREEMENT: 'AI and rules agreed',
    AI_CONFIDENT: 'AI confidence accepted',
    RULE_FALLBACK: 'Rule fallback used',
    HUMAN_REVIEW_REQUIRED: 'Human review recommended'
};

const PREDICTION_STATUS_LABELS = {
    SUCCESS: 'Success',
    FAILED: 'Fallback used',
    SKIPPED: 'Not evaluated'
};

function normalizeRole(roleValue) {
    return String(roleValue || '').trim().toUpperCase();
}

function resolveRoleTier(currentUserRole) {
    const role = normalizeRole(currentUserRole);

    if (!role) return 'requester';
    if (
        role === 'ADMIN' ||
        role === 'HEAD_OF_IT' ||
        role === 'IT_ADMIN' ||
        role === 'ADMINISTRATOR' ||
        role === 'L4'
    ) return 'admin';
    if (role === 'SUPERVISOR' || role === 'SENIOR' || role === 'L2' || role === 'L3') return 'senior_supervisor';
    if (role === 'JUNIOR' || role === 'TECHNICIAN' || role === 'L1') return 'junior';
    if (role === 'STUDENT' || role === 'DOCTOR' || role === 'REQUESTER') return 'requester';

    return 'requester';
}

function normalizePriority(value) {
    const normalized = String(value || '').trim().toUpperCase();
    if (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(normalized)) {
        return normalized;
    }
    return null;
}

function formatPriority(value) {
    const priority = normalizePriority(value);
    return priority || 'N/A';
}

function formatConfidence(value) {
    if (value === null || value === undefined || value === '') return 'N/A';
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 'N/A';
    const percentage = numeric <= 1 ? numeric * 100 : numeric;
    return `${Math.max(0, Math.min(100, percentage)).toFixed(0)}%`;
}

function renderConfidenceBadge(confidence) {
    if (!confidence || confidence === 'N/A') return '';

    const rawValue = Number(confidence.replace('%', ''));
    const badgeClass = Number.isFinite(rawValue)
        ? (rawValue >= 80 ? 'bg-success-subtle text-success' : rawValue >= 60 ? 'bg-warning-subtle text-warning' : 'bg-danger-subtle text-danger')
        : 'bg-secondary-subtle text-secondary';

    return `<span class="badge ${badgeClass}">AI confidence: ${UI.escapeHTML(confidence)}</span>`;
}

function formatDecisionSource(value) {
    const normalized = String(value || '').trim().toUpperCase();
    if (!normalized) return 'N/A';
    return DECISION_SOURCE_LABELS[normalized] || normalized.replace(/_/g, ' ');
}

function formatPredictionStatus(value) {
    const normalized = String(value || '').trim().toUpperCase();
    if (!normalized) return 'Not evaluated';
    return PREDICTION_STATUS_LABELS[normalized] || normalized.replace(/_/g, ' ');
}

function parseExplanation(explanation) {
    if (!explanation) return [];
    if (Array.isArray(explanation)) {
        return explanation.map((item) => String(item || '').trim()).filter(Boolean);
    }

    if (typeof explanation === 'string') {
        const trimmed = explanation.trim();
        if (!trimmed) return [];

        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item || '').trim()).filter(Boolean);
            }
        } catch {
            // Treat non-JSON strings as a plain explanation text.
        }

        return [trimmed];
    }

    return [];
}

function formatDateTime(value) {
    if (!value) return 'N/A';
    return UI.formatDateTime(value);
}

function getField(ticket, ...keys) {
    for (const key of keys) {
        if (ticket?.[key] !== undefined && ticket?.[key] !== null) {
            return ticket[key];
        }
    }
    return null;
}

function renderPriorityBadge(priority) {
    const normalized = formatPriority(priority);
    if (normalized === 'N/A') {
        return '<span class="badge bg-secondary">N/A</span>';
    }
    return `<span class="badge ${UI.getPriorityBadgeClass(normalized)}">${UI.escapeHTML(normalized)}</span>`;
}

function renderExplanationList(explanation) {
    if (!explanation.length) {
        return '<p class="text-muted small mb-0">No AI explanation available.</p>';
    }

    const items = explanation
        .map((line) => `<li>${UI.escapeHTML(line)}</li>`)
        .join('');

    return `<ul class="mb-0 small">${items}</ul>`;
}

function renderFieldRow(label, value) {
    return `
        <div class="col-12 col-md-6">
            <div class="text-muted small">${UI.escapeHTML(label)}</div>
            <div>${UI.escapeHTML(String(value ?? 'N/A'))}</div>
        </div>
    `;
}

export function AiPriorityInsight({ ticket, currentUserRole } = {}) {
    const sourceTicket = ticket || {};
    const roleTier = resolveRoleTier(currentUserRole);

    const finalPriority = formatPriority(getField(sourceTicket, 'priority', 'finalPriority', 'final_priority'));
    const rulePriority = formatPriority(getField(sourceTicket, 'rule_priority', 'rulePriority'));
    const aiPriority = formatPriority(getField(sourceTicket, 'ai_priority', 'aiPriority'));
    const confidence = formatConfidence(getField(sourceTicket, 'ai_confidence', 'confidence'));
    const decisionSource = formatDecisionSource(getField(sourceTicket, 'ai_decision_source', 'decisionSource'));
    const predictionStatus = formatPredictionStatus(getField(sourceTicket, 'ai_prediction_status', 'aiPredictionStatus'));
    const priorityScore = getField(sourceTicket, 'ai_priority_score', 'priorityScore');
    const modelName = getField(sourceTicket, 'ai_model_name', 'modelName');
    const modelVersion = getField(sourceTicket, 'ai_model_version', 'modelVersion');
    const predictedAt = formatDateTime(getField(sourceTicket, 'ai_predicted_at', 'aiPredictedAt'));
    const explanation = parseExplanation(getField(sourceTicket, 'ai_explanation', 'explanation'));

    if (roleTier === 'requester') {
        return `
            <div class="card mb-3 border-0 bg-light">
                <div class="card-body">
                    <div class="d-flex align-items-center justify-content-between">
                        <div>
                            <div class="text-muted small">Final Priority</div>
                            <div class="fw-semibold">${UI.escapeHTML(finalPriority)}</div>
                        </div>
                        ${renderPriorityBadge(finalPriority)}
                    </div>
                    <p class="small text-muted mb-0 mt-2">Priority was automatically assigned by OpsMind.</p>
                </div>
            </div>
        `;
    }

    if (roleTier === 'junior') {
        const confidenceBadge = renderConfidenceBadge(confidence);
        const hasExplanation = explanation.length > 0;
        return `
            <div class="card mb-3 border-0 bg-light">
                <div class="card-header bg-transparent">
                    <h6 class="mb-0"><i class="bi bi-cpu me-2 text-primary"></i>Priority Insight</h6>
                </div>
                <div class="card-body">
                    <div class="d-flex align-items-center justify-content-between mb-2">
                        <div>
                            <div class="text-muted small">Final Priority</div>
                            <div class="fw-semibold">${UI.escapeHTML(finalPriority)}</div>
                        </div>
                        ${renderPriorityBadge(finalPriority)}
                    </div>
                    ${confidenceBadge ? `<div class="mb-2">${confidenceBadge}</div>` : ''}
                    ${hasExplanation ? `
                    <div class="small text-muted mb-1">Explanation</div>
                    ${renderExplanationList(explanation)}
                    ` : '<p class="text-muted small mb-0">No AI explanation available.</p>'}
                </div>
            </div>
        `;
    }

    if (roleTier === 'senior_supervisor') {
        return `
            <div class="card mb-3 border-0 bg-light">
                <div class="card-header bg-transparent">
                    <h6 class="mb-0"><i class="bi bi-cpu me-2 text-primary"></i>Priority Decision</h6>
                </div>
                <div class="card-body">
                    <div class="row g-3 mb-3">
                        ${renderFieldRow('Final Priority', finalPriority)}
                        ${renderFieldRow('Rule Priority', rulePriority)}
                        ${renderFieldRow('AI Priority', aiPriority)}
                        ${renderFieldRow('Confidence', confidence)}
                        ${renderFieldRow('Decision Source', decisionSource)}
                    </div>
                    <div class="small text-muted mb-1">Explanation</div>
                    ${renderExplanationList(explanation)}
                </div>
            </div>
        `;
    }

    return `
        <div class="card mb-3 border-0 bg-light">
            <div class="card-header bg-transparent">
                <h6 class="mb-0"><i class="bi bi-cpu me-2 text-primary"></i>AI Priority Audit</h6>
            </div>
            <div class="card-body">
                <div class="row g-3 mb-3">
                    ${renderFieldRow('AI Prediction Status', predictionStatus)}
                    ${renderFieldRow('Final Priority', finalPriority)}
                    ${renderFieldRow('Rule Priority', rulePriority)}
                    ${renderFieldRow('AI Priority', aiPriority)}
                    ${renderFieldRow('Confidence', confidence)}
                    ${renderFieldRow('Decision Source', decisionSource)}
                    ${renderFieldRow('Priority Score', priorityScore ?? 'N/A')}
                    ${renderFieldRow('Model Name', modelName || 'N/A')}
                    ${renderFieldRow('Model Version', modelVersion || 'N/A')}
                    ${renderFieldRow('Predicted At', predictedAt)}
                </div>
                <div class="small text-muted mb-1">Explanation</div>
                ${renderExplanationList(explanation)}
            </div>
        </div>
    `;
}

export function renderAiPriorityInsight({ ticket, currentUserRole } = {}) {
    return AiPriorityInsight({ ticket, currentUserRole });
}

export function formatAiDecisionSource(value) {
    return formatDecisionSource(value);
}

export function formatAiPredictionStatus(value) {
    return formatPredictionStatus(value);
}

export function formatAiConfidence(value) {
    return formatConfidence(value);
}
