import UI from '/assets/js/ui.js';

const REQUESTER_ROLE_SET = new Set(['STUDENT', 'DOCTOR', 'REQUESTER', 'END_USER']);
const JUNIOR_ROLE_SET = new Set(['JUNIOR', 'TECHNICIAN', 'JUNIOR_TECHNICIAN', 'L1']);
const SENIOR_SUPERVISOR_ROLE_SET = new Set([
    'SENIOR',
    'SUPERVISOR',
    'SENIOR_TECHNICIAN',
    'BUILDING_MANAGER',
    'SENIOR_BUILDING_MANAGER',
    'L2',
    'L3'
]);
const ADMIN_ROLE_SET = new Set([
    'ADMIN',
    'SYSTEM_ADMIN',
    'HEAD_OF_IT',
    'IT_ADMIN',
    'ADMINISTRATOR',
    'L4'
]);

const OPERATIONAL_ROLE_SET = new Set([
    ...JUNIOR_ROLE_SET,
    ...SENIOR_SUPERVISOR_ROLE_SET,
    ...ADMIN_ROLE_SET
]);

const DECISION_SOURCE_LABELS = {
    RULE_AI_AGREEMENT: 'AI and rules agreed',
    AI_CONFIDENT: 'AI confidence accepted',
    RULE_FALLBACK: 'Rule-based fallback used',
    HUMAN_REVIEW_REQUIRED: 'Human review recommended'
};

const PREDICTION_STATUS_LABELS = {
    SUCCESS: 'Analyzed successfully',
    FAILED: 'Fallback priority used',
    SKIPPED: 'Not analyzed'
};

const EXPLANATION_REPLACEMENTS = [
    {
        pattern: /Failure-related signals were identified in the ticket text\.?/i,
        replacement: 'The request describes a service failure.'
    },
    {
        pattern: /Error\/failure keywords were detected in title or description\.?/i,
        replacement: 'The description includes words that indicate an error or outage.'
    },
    {
        pattern: /Hardware\/device-impact keywords were detected\.?/i,
        replacement: 'The issue appears related to a device or hardware.'
    },
    {
        pattern: /Ticket was created after business hours\.?/i,
        replacement: 'The ticket was submitted outside normal business hours.'
    },
    {
        pattern: /Derived service criticality level:\s*HIGH\.?/i,
        replacement: 'The affected service was assessed as high importance.'
    }
];

const EXPLANATION_SKIP_PATTERNS = [
    /Rule priority:/i,
    /AI priority:/i,
    /final priority:/i,
    /Decision source:/i,
    /confidence\s*[:=]\s*\d+(\.\d+)?/i,
    /model\s*(path|file)/i,
    /(\\|\/).+\.(pkl|joblib|pt|onnx|bin)/i
];

const AI_METADATA_FIELDS = [
    'ai_prediction_status',
    'rule_priority',
    'ai_priority',
    'ai_confidence',
    'ai_decision_source',
    'ai_explanation',
    'ai_model_name',
    'ai_model_version',
    'ai_predicted_at',
    'ai_priority_score',
    'aiPredictionStatus',
    'rulePriority',
    'aiPriority',
    'aiConfidence',
    'aiDecisionSource',
    'aiExplanation',
    'aiModelName',
    'aiModelVersion',
    'aiPredictedAt',
    'aiPriorityScore'
];

export function normalizeRole(roleValue) {
    return String(roleValue || '')
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, '_');
}

export function isRequesterRole(roleValue) {
    return REQUESTER_ROLE_SET.has(normalizeRole(roleValue));
}

export function isOperationalRole(roleValue) {
    return OPERATIONAL_ROLE_SET.has(normalizeRole(roleValue));
}

export function getAiButtonLabel(roleValue) {
    const role = normalizeRole(roleValue);

    if (ADMIN_ROLE_SET.has(role)) return 'View AI Priority Audit';
    if (SENIOR_SUPERVISOR_ROLE_SET.has(role)) return 'View AI Decision Details';
    if (JUNIOR_ROLE_SET.has(role)) return 'View AI Priority Insight';

    return 'View AI Priority Insight';
}

function resolveRoleTier(roleValue) {
    const role = normalizeRole(roleValue);

    if (isRequesterRole(role)) return 'requester';
    if (ADMIN_ROLE_SET.has(role)) return 'admin';
    if (SENIOR_SUPERVISOR_ROLE_SET.has(role)) return 'senior_supervisor';
    if (JUNIOR_ROLE_SET.has(role)) return 'junior';

    return 'requester';
}

function normalizePriority(value) {
    const normalized = String(value || '').trim().toUpperCase();
    return ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(normalized) ? normalized : null;
}

function formatPriority(value) {
    return normalizePriority(value) || 'N/A';
}

function getField(ticket, ...keys) {
    for (const key of keys) {
        if (ticket?.[key] !== undefined && ticket?.[key] !== null) {
            return ticket[key];
        }
    }
    return null;
}

function parseExplanation(explanation) {
    if (!explanation) return [];

    if (Array.isArray(explanation)) {
        return explanation.map((line) => String(line || '').trim()).filter(Boolean);
    }

    if (typeof explanation === 'string') {
        const trimmed = explanation.trim();
        if (!trimmed) return [];

        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.map((line) => String(line || '').trim()).filter(Boolean);
            }
        } catch {
            // Keep non-JSON explanation as plain text.
        }

        return [trimmed];
    }

    return [];
}

function sanitizeExplanationLine(line) {
    let cleaned = String(line || '').replace(/^[-*•\s]+/, '').trim();
    if (!cleaned) return null;

    if (EXPLANATION_SKIP_PATTERNS.some((pattern) => pattern.test(cleaned))) {
        return null;
    }

    EXPLANATION_REPLACEMENTS.forEach(({ pattern, replacement }) => {
        if (pattern.test(cleaned)) {
            cleaned = replacement;
        }
    });

    return cleaned;
}

function sanitizeExplanations(lines) {
    const sanitized = lines
        .map(sanitizeExplanationLine)
        .filter(Boolean);

    return Array.from(new Set(sanitized));
}

function parseConfidencePercent(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;

    const percent = numeric <= 1 ? numeric * 100 : numeric;
    return Math.max(0, Math.min(100, percent));
}

function getConfidenceLabel(percent) {
    if (percent === null || percent === undefined) return null;
    if (percent >= 75) return 'High confidence';
    if (percent >= 45) return 'Moderate confidence';
    return 'Low confidence';
}

function formatConfidenceForRole(value, roleTier) {
    const percent = parseConfidencePercent(value);
    const label = getConfidenceLabel(percent);

    if (label === null || percent === null) return null;

    if (roleTier === 'junior') {
        return label;
    }

    return `${label} (${percent.toFixed(0)}%)`;
}

function formatDecisionSource(value) {
    const normalized = normalizeRole(value);
    if (!normalized) return 'Not available';
    return DECISION_SOURCE_LABELS[normalized] || normalized.replace(/_/g, ' ');
}

function formatPredictionStatus(value) {
    const normalized = normalizeRole(value);
    if (!normalized) return 'Not available';
    return PREDICTION_STATUS_LABELS[normalized] || normalized.replace(/_/g, ' ');
}

function formatDateTime(value) {
    if (!value) return 'Not available';
    return UI.formatDateTime(value);
}

function formatPriorityScore(value) {
    if (value === null || value === undefined || value === '') return 'Not available';
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return String(value);
    return numeric.toFixed(2);
}

function hasMeaningfulValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
}

export function hasAiMetadata(ticket) {
    const sourceTicket = ticket || {};
    return AI_METADATA_FIELDS.some((field) => hasMeaningfulValue(sourceTicket[field]));
}

function renderPriorityBadge(priorityValue) {
    const priority = formatPriority(priorityValue);
    if (priority === 'N/A') {
        return '<span class="badge bg-secondary">N/A</span>';
    }

    return `<span class="badge ${UI.getPriorityBadgeClass(priority)}">${UI.escapeHTML(priority)}</span>`;
}

function renderExplanationList(explanations) {
    if (!explanations.length) {
        return '<p class="text-muted small mb-0">No AI explanation details are available.</p>';
    }

    const items = explanations
        .map((line) => `<li>${UI.escapeHTML(line)}</li>`)
        .join('');

    return `<ul class="mb-0 small">${items}</ul>`;
}

function renderMissingAiState({ roleTier, finalPriority }) {
    const finalPriorityBadge = renderPriorityBadge(finalPriority);

    if (roleTier === 'admin') {
        return `
            <div class="card border-0 bg-light mb-0">
                <div class="card-body">
                    <h6 class="mb-2"><i class="bi bi-shield-exclamation me-2 text-warning"></i>AI audit is not available for this ticket.</h6>
                    <ul class="small mb-2">
                        <li>Ticket was created before AI priority analysis was enabled.</li>
                        <li>AI analysis was skipped.</li>
                        <li>AI Service was unavailable during creation.</li>
                    </ul>
                    <div class="small text-muted">Final saved priority</div>
                    <div class="d-flex align-items-center gap-2 mt-1">
                        ${finalPriorityBadge}
                        <span class="fw-semibold">${UI.escapeHTML(formatPriority(finalPriority))}</span>
                    </div>
                </div>
            </div>
        `;
    }

    return `
        <div class="card border-0 bg-light mb-0">
            <div class="card-body">
                <h6 class="mb-2"><i class="bi bi-info-circle me-2 text-secondary"></i>AI insight is not available for this ticket.</h6>
                <p class="small text-muted mb-0">This ticket may have been created before AI analysis was enabled.</p>
            </div>
        </div>
    `;
}

export function AiPriorityInsight({ ticket, currentUserRole } = {}) {
    const sourceTicket = ticket || {};
    const roleTier = resolveRoleTier(currentUserRole);

    if (roleTier === 'requester') {
        return '';
    }

    const finalPriority = formatPriority(getField(sourceTicket, 'priority', 'finalPriority', 'final_priority'));

    if (!hasAiMetadata(sourceTicket)) {
        return renderMissingAiState({ roleTier, finalPriority });
    }

    const rulePriority = formatPriority(getField(sourceTicket, 'rule_priority', 'rulePriority'));
    const aiPriority = formatPriority(getField(sourceTicket, 'ai_priority', 'aiPriority'));
    const decisionLabel = formatDecisionSource(getField(sourceTicket, 'ai_decision_source', 'aiDecisionSource'));
    const confidence = formatConfidenceForRole(getField(sourceTicket, 'ai_confidence', 'aiConfidence', 'confidence'), roleTier);
    const explanations = sanitizeExplanations(
        parseExplanation(getField(sourceTicket, 'ai_explanation', 'aiExplanation', 'explanation'))
    );

    if (roleTier === 'junior') {
        return `
            <div class="card border-0 bg-light mb-0">
                <div class="card-header bg-transparent">
                    <h6 class="mb-0"><i class="bi bi-cpu me-2 text-primary"></i>AI Priority Insight</h6>
                </div>
                <div class="card-body">
                    <div class="d-flex align-items-center justify-content-between mb-2">
                        <div>
                            <div class="small text-muted">Final Priority</div>
                            <div class="fw-semibold">${UI.escapeHTML(finalPriority)}</div>
                        </div>
                        ${renderPriorityBadge(finalPriority)}
                    </div>
                    ${confidence ? `<div class="small mb-2"><span class="text-muted">Confidence:</span> ${UI.escapeHTML(confidence)}</div>` : ''}
                    <div class="small text-muted mb-1">Explanation</div>
                    ${renderExplanationList(explanations)}
                </div>
            </div>
        `;
    }

    if (roleTier === 'senior_supervisor') {
        return `
            <div class="card border-0 bg-light mb-0">
                <div class="card-header bg-transparent">
                    <h6 class="mb-0"><i class="bi bi-cpu me-2 text-primary"></i>AI Decision Details</h6>
                </div>
                <div class="card-body">
                    <div class="row g-3 mb-3">
                        <div class="col-12 col-md-6">
                            <div class="small text-muted">Final Priority</div>
                            <div class="fw-semibold">${UI.escapeHTML(finalPriority)}</div>
                        </div>
                        <div class="col-12 col-md-6">
                            <div class="small text-muted">AI Recommendation</div>
                            <div>${UI.escapeHTML(aiPriority)}</div>
                        </div>
                        <div class="col-12 col-md-6">
                            <div class="small text-muted">Rule Check</div>
                            <div>${UI.escapeHTML(rulePriority)}</div>
                        </div>
                        <div class="col-12 col-md-6">
                            <div class="small text-muted">Confidence</div>
                            <div>${UI.escapeHTML(confidence || 'Not available')}</div>
                        </div>
                        <div class="col-12">
                            <div class="small text-muted">Decision</div>
                            <div>${UI.escapeHTML(decisionLabel)}</div>
                        </div>
                    </div>
                    <div class="small text-muted mb-1">Explanation</div>
                    ${renderExplanationList(explanations)}
                </div>
            </div>
        `;
    }

    const predictionStatus = formatPredictionStatus(getField(sourceTicket, 'ai_prediction_status', 'aiPredictionStatus'));
    const priorityScore = formatPriorityScore(getField(sourceTicket, 'ai_priority_score', 'aiPriorityScore'));
    const modelName = getField(sourceTicket, 'ai_model_name', 'aiModelName') || 'Not available';
    const modelVersion = getField(sourceTicket, 'ai_model_version', 'aiModelVersion') || 'Not available';
    const predictedAt = formatDateTime(getField(sourceTicket, 'ai_predicted_at', 'aiPredictedAt'));

    return `
        <div class="card border-0 bg-light mb-0">
            <div class="card-header bg-transparent">
                <h6 class="mb-0"><i class="bi bi-cpu me-2 text-primary"></i>AI Priority Audit</h6>
            </div>
            <div class="card-body">
                <h6 class="small text-uppercase text-muted mb-2">AI Priority Summary</h6>
                <div class="row g-3 mb-3">
                    <div class="col-12 col-md-6">
                        <div class="small text-muted">Final Priority</div>
                        <div class="fw-semibold">${UI.escapeHTML(finalPriority)}</div>
                    </div>
                    <div class="col-12 col-md-6">
                        <div class="small text-muted">AI Recommendation</div>
                        <div>${UI.escapeHTML(aiPriority)}</div>
                    </div>
                    <div class="col-12 col-md-6">
                        <div class="small text-muted">Rule Priority</div>
                        <div>${UI.escapeHTML(rulePriority)}</div>
                    </div>
                    <div class="col-12 col-md-6">
                        <div class="small text-muted">Confidence</div>
                        <div>${UI.escapeHTML(confidence || 'Not available')}</div>
                    </div>
                    <div class="col-12">
                        <div class="small text-muted">Decision</div>
                        <div>${UI.escapeHTML(decisionLabel)}</div>
                    </div>
                </div>
                <div class="small text-muted mb-1">Explanation</div>
                ${renderExplanationList(explanations)}

                <details class="mt-3">
                    <summary class="fw-semibold">Advanced Audit</summary>
                    <div class="row g-3 mt-1">
                        <div class="col-12 col-md-6">
                            <div class="small text-muted">Prediction Status</div>
                            <div>${UI.escapeHTML(predictionStatus)}</div>
                        </div>
                        <div class="col-12 col-md-6">
                            <div class="small text-muted">Priority Score</div>
                            <div>${UI.escapeHTML(priorityScore)}</div>
                        </div>
                        <div class="col-12 col-md-6">
                            <div class="small text-muted">Model Name</div>
                            <div>${UI.escapeHTML(String(modelName))}</div>
                        </div>
                        <div class="col-12 col-md-6">
                            <div class="small text-muted">Model Version</div>
                            <div>${UI.escapeHTML(String(modelVersion))}</div>
                        </div>
                        <div class="col-12">
                            <div class="small text-muted">Predicted At</div>
                            <div>${UI.escapeHTML(predictedAt)}</div>
                        </div>
                    </div>
                </details>
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

export function formatAiConfidence(value, roleValue = 'SENIOR') {
    return formatConfidenceForRole(value, resolveRoleTier(roleValue));
}

export function renderFinalPriorityBadge(priorityValue) {
    return renderPriorityBadge(priorityValue);
}
