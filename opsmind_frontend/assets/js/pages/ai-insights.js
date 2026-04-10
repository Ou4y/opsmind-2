/**
 * OpsMind - AI Insights Page Module
 * 
 * Handles AI insights page functionality:
 * - Listing tickets for AI analysis
 * - Getting SLA breach predictions
 * - Collecting user feedback on AI accuracy
 */

import UI from '/assets/js/ui.js';
import TicketService from '/services/ticketService.js';
import AIService from '/services/aiService.js';

/**
 * Page state
 */
const state = {
    tickets: [],
    currentPage: 1,
    totalPages: 1,
    totalTickets: 0,
    pageSize: 10,
    isLoading: false,
    selectedTicket: null,
    currentAnalysis: null,
    initialized: false
};

/**
 * Initialize the AI Insights page
 */
export async function initAIInsightsPage() {
    // Prevent double initialization
    if (state.initialized) {
        console.log('[AI Insights] Already initialized, skipping...');
        return;
    }
    
    console.log('[AI Insights] Initializing page...');
    state.initialized = true;
    
    // Mark page as initialized
    document.body.classList.add('ai-insights-page-initialized');
    // Wait for app to be ready
    await waitForApp();
    
    // Set up event listeners
    setupEventListeners();
    
    // Load initial data
    await loadTickets();
}

/**
 * Wait for the main app to initialize
 */
function waitForApp() {
    return new Promise((resolve) => {
        if (document.querySelector('.navbar-main')) {
            resolve();
        } else {
            document.addEventListener('app:ready', resolve, { once: true });
        }
    });
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
    // Refresh button
    document.getElementById('refreshBtn')?.addEventListener('click', loadTickets);
    
    // Retry button
    document.getElementById('retryLoadTickets')?.addEventListener('click', loadTickets);
    
    // Pagination clicks
    document.getElementById('paginationList')?.addEventListener('click', handlePaginationClick);
    
    // Feedback radio buttons
    document.querySelectorAll('input[name="feedbackAccuracy"]').forEach(radio => {
        radio.addEventListener('change', handleFeedbackChange);
    });
    
    // Submit feedback button
    document.getElementById('submitFeedbackBtn')?.addEventListener('click', handleSubmitFeedback);
    
    // Reset modal state when closed
    document.getElementById('aiAnalysisModal')?.addEventListener('hidden.bs.modal', resetModalState);
}

/**
 * Load tickets from API
 */
async function loadTickets() {
    if (state.isLoading) return;
    state.isLoading = true;

    const tableBody = document.getElementById('ticketsTableBody');
    const emptyState = document.getElementById('ticketsEmpty');
    const errorState = document.getElementById('ticketsError');

    // Show loading
    UI.toggle(emptyState, false);
    UI.toggle(errorState, false);
    
    if (tableBody) {
        tableBody.innerHTML = `
            <tr class="loading-row">
                <td colspan="6">
                    <div class="d-flex justify-content-center py-4">
                        <div class="spinner-border text-primary" role="status">
                            <span class="visually-hidden">Loading tickets...</span>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }

    try {
        // Calculate offset for backend pagination
        const offset = (state.currentPage - 1) * state.pageSize;
        const response = await TicketService.getTickets({
            limit: state.pageSize,
            offset
        });

        // Handle response: support array or object
        let ticketsArr = [];
        let total = 0;
        if (Array.isArray(response)) {
            ticketsArr = response;
            total = response.length;
        } else if (response.tickets) {
            ticketsArr = response.tickets;
            total = response.total || ticketsArr.length;
        } else if (response.items) {
            ticketsArr = response.items;
            total = response.total || ticketsArr.length;
        } else if (response.data) {
            ticketsArr = response.data;
            total = response.total || ticketsArr.length;
        }

        state.tickets = ticketsArr;
        state.totalTickets = total;
        state.totalPages = Math.max(1, Math.ceil(total / state.pageSize));

        renderTickets();
        renderPagination();
    } catch (error) {
        console.error('Failed to load tickets:', error);
        
        // Check if it's a network error - use mock data
        if (error.message.includes('fetch') || error.message.includes('Network')) {
            useMockTickets();
        } else {
            showError(error.message);
        }
    } finally {
        state.isLoading = false;
    }
}

/**
 * Use mock tickets for demo
 */
function useMockTickets() {
    state.tickets = [
        { id: 'TKT-001', title: 'VPN Connection Issues', priority: 'HIGH', status: 'open', createdAt: new Date(Date.now() - 3600000), description: 'Unable to connect to corporate VPN from home office', type: 'INCIDENT' },
        { id: 'TKT-002', title: 'Email Not Syncing', priority: 'MEDIUM', status: 'in_progress', createdAt: new Date(Date.now() - 7200000), description: 'Outlook emails are not syncing on mobile device', type: 'INCIDENT' },
        { id: 'TKT-003', title: 'New Laptop Request', priority: 'LOW', status: 'pending', createdAt: new Date(Date.now() - 86400000), description: 'Request for new development laptop', type: 'REQUEST' },
        { id: 'TKT-004', title: 'Server Performance Degradation', priority: 'CRITICAL', status: 'open', createdAt: new Date(Date.now() - 1800000), description: 'Production server experiencing high CPU usage', type: 'INCIDENT' },
        { id: 'TKT-005', title: 'Password Reset Request', priority: 'MEDIUM', status: 'resolved', createdAt: new Date(Date.now() - 172800000), description: 'User forgot password and needs reset', type: 'REQUEST' },
    ];
    state.totalTickets = state.tickets.length;
    state.totalPages = 1;
    
    renderTickets();
    renderPagination();
}

/**
 * Render tickets table
 */
function renderTickets() {
    const tableBody = document.getElementById('ticketsTableBody');
    const emptyState = document.getElementById('ticketsEmpty');
    const ticketCount = document.getElementById('ticketCount');

    // Update count
    if (ticketCount) {
        ticketCount.textContent = `${state.totalTickets} Ticket${state.totalTickets !== 1 ? 's' : ''}`;
    }

    if (state.tickets.length === 0) {
        if (tableBody) tableBody.innerHTML = '';
        UI.toggle(emptyState, true);
        return;
    }

    UI.toggle(emptyState, false);

    if (!tableBody) return;

    let html = '';

    state.tickets.forEach(ticket => {
        html += `
            <tr data-ticket-id="${ticket.id}">
                <td><code class="text-primary">${UI.escapeHTML(ticket.id)}</code></td>
                <td>
                    <div class="text-truncate" style="max-width: 300px;" title="${UI.escapeHTML(ticket.title || ticket.subject || '')}">
                        ${UI.escapeHTML(ticket.title || ticket.subject || '')}
                    </div>
                </td>
                <td>
                    <span class="badge ${UI.getPriorityBadgeClass(ticket.priority)}">
                        ${formatPriority(ticket.priority)}
                    </span>
                </td>
                <td>
                    <span class="badge ${UI.getStatusBadgeClass(ticket.status)}">
                        ${formatStatus(ticket.status)}
                    </span>
                </td>
                <td>
                    <span class="text-muted">${UI.formatRelativeTime(ticket.createdAt)}</span>
                </td>
                <td class="text-end">
                    <button class="btn btn-primary btn-sm" data-action="analyze" data-id="${ticket.id}" title="Analyze with AI">
                        <i class="bi bi-robot me-1"></i> Analyze
                    </button>
                </td>
            </tr>
        `;
    });

    tableBody.innerHTML = html;

    // Add analyze button handlers
    tableBody.querySelectorAll('[data-action="analyze"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            analyzeTicket(btn.dataset.id);
        });
    });
}

/**
 * Render pagination
 */
function renderPagination() {
    const paginationList = document.getElementById('paginationList');
    const showingFrom = document.getElementById('showingFrom');
    const showingTo = document.getElementById('showingTo');
    const totalTickets = document.getElementById('totalTickets');

    // Update showing info
    const from = ((state.currentPage - 1) * state.pageSize) + 1;
    const to = Math.min(state.currentPage * state.pageSize, state.totalTickets);
    
    if (showingFrom) showingFrom.textContent = state.totalTickets > 0 ? from : 0;
    if (showingTo) showingTo.textContent = to;
    if (totalTickets) totalTickets.textContent = state.totalTickets;

    // Render pagination links
    if (paginationList) {
        paginationList.innerHTML = UI.renderPagination({
            currentPage: state.currentPage,
            totalPages: state.totalPages
        });
    }
}

/**
 * Handle pagination click
 */
function handlePaginationClick(e) {
    const link = e.target.closest('[data-page]');
    if (!link) return;
    
    e.preventDefault();
    
    const page = parseInt(link.dataset.page, 10);
    if (page >= 1 && page <= state.totalPages && page !== state.currentPage) {
        state.currentPage = page;
        loadTickets();
        
        // Scroll to top of table
        document.querySelector('.card')?.scrollIntoView({ behavior: 'smooth' });
    }
}

/**
 * Analyze a ticket with AI
 */
async function analyzeTicket(ticketId) {
    // Find ticket in list
    const ticket = state.tickets.find(t => t.id === ticketId);
    if (!ticket) return;
    
    state.selectedTicket = ticket;
    
    // Show modal with loading state
    const modal = document.getElementById('aiAnalysisModal');
    const modalInstance = bootstrap.Modal.getOrCreateInstance(modal);
    
    // Reset and show loading
    UI.toggle(document.getElementById('analysisLoading'), true);
    UI.toggle(document.getElementById('analysisResult'), false);
    UI.toggle(document.getElementById('analysisError'), false);
    UI.toggle(document.getElementById('submitFeedbackBtn'), false);
    
    modalInstance.show();
    
    try {
        // Call AI service for SLA breach prediction
        // Send data in format expected by backend
        const analysisResult = await AIService.getSLABreachPrediction({
            support_level: ticket.type || 'INCIDENT',
            priority: ticket.priority || 'MEDIUM',
            createdAt: ticket.createdAt,
            assigned_team: ticket.assignee || 'General Support'
        });
        
        // Parse response - backend returns breach probability
        const parsedResult = parseBackendResponse(analysisResult, ticket);
        state.currentAnalysis = parsedResult;
        
        // Display result
        displayAnalysisResult(ticket, parsedResult);
    } catch (error) {
        console.error('Failed to analyze ticket:', error);
        
        // Show error state in modal
        UI.toggle(document.getElementById('analysisLoading'), false);
        UI.toggle(document.getElementById('analysisError'), true);
        document.getElementById('analysisErrorMessage').textContent = error.message || 'Unable to analyze this ticket. Please try again.';
    }
}

/**
 * Parse backend response to display format
 */
function parseBackendResponse(response, ticket) {
    console.log('Parsing backend response:', response);
    
    // Backend may return probability as decimal (0-1) or percentage (0-100)
    // or in a specific field like 'sla_breach_probability', 'probability', 'prediction', etc.
    let breachProbability = 0;
    
    if (typeof response === 'number') {
        breachProbability = response > 1 ? response : response * 100;
    } else if (response.sla_breach_probability !== undefined) {
        breachProbability = response.sla_breach_probability > 1 ? response.sla_breach_probability : response.sla_breach_probability * 100;
    } else if (response.probability !== undefined) {
        breachProbability = response.probability > 1 ? response.probability : response.probability * 100;
    } else if (response.prediction !== undefined) {
        breachProbability = response.prediction > 1 ? response.prediction : response.prediction * 100;
    } else if (response.breach_probability !== undefined) {
        breachProbability = response.breach_probability > 1 ? response.breach_probability : response.breach_probability * 100;
    }
    
    // Round to integer
    breachProbability = Math.round(breachProbability);
    
    console.log('Parsed breach probability:', breachProbability);
    
    // Generate analysis text based on probability
    let analysis;
    if (breachProbability >= 60) {
        analysis = 'Based on the ticket priority, current workload, and historical patterns, this ticket has a high probability of breaching its SLA. Consider prioritizing this ticket immediately.';
    } else if (breachProbability >= 40) {
        analysis = 'This ticket shows moderate SLA breach risk. Monitor progress closely and allocate resources as needed to prevent breach.';
    } else if (breachProbability >= 20) {
        analysis = 'The SLA breach risk is relatively low, but continued monitoring is recommended. Similar tickets have typically been resolved within SLA targets.';
    } else {
        analysis = 'Based on similar tickets and current workload, this ticket has a low probability of breaching its SLA. The team has sufficient capacity to handle this request.';
    }
    
    return {
        breachProbability,
        analysis,
        rawResponse: response
    };
}

/**
 * Display analysis result in modal
 */
function displayAnalysisResult(ticket, result) {
    // Hide loading, show result
    UI.toggle(document.getElementById('analysisLoading'), false);
    UI.toggle(document.getElementById('analysisResult'), true);
    UI.toggle(document.getElementById('analysisError'), false);
    
    // Populate ticket info
    document.getElementById('analysisTicketId').textContent = ticket.id;
    document.getElementById('analysisTicketSubject').textContent = ticket.title || ticket.subject || '';
    
    // Update SLA gauge
    const percentage = result.breachProbability || 0;
    document.getElementById('slaPercentage').textContent = percentage;
    
    // Calculate stroke offset for gauge (339.292 is the circumference)
    const circumference = 339.292;
    const offset = circumference - (percentage / 100) * circumference;
    const gaugeCircle = document.getElementById('slaGaugeCircle');
    
    // Set color based on percentage
    let color;
    let riskLabel;
    let riskClass;
    
    if (percentage >= 60) {
        color = '#dc3545'; // danger red
        riskLabel = 'High Risk';
        riskClass = 'bg-danger';
    } else if (percentage >= 40) {
        color = '#fd7e14'; // warning orange
        riskLabel = 'Medium Risk';
        riskClass = 'bg-warning text-dark';
    } else if (percentage >= 20) {
        color = '#ffc107'; // caution yellow
        riskLabel = 'Low-Medium Risk';
        riskClass = 'bg-warning text-dark';
    } else {
        color = '#28a745'; // success green
        riskLabel = 'Low Risk';
        riskClass = 'bg-success';
    }
    
    gaugeCircle.style.stroke = color;
    gaugeCircle.style.strokeDashoffset = offset;
    
    // Update risk level badge
    document.getElementById('slaRiskLevel').innerHTML = `<span class="badge ${riskClass}">${riskLabel}</span>`;
    
    // Update analysis details
    document.getElementById('analysisDetails').textContent = result.analysis || 'Analysis completed.';
    
    // Reset feedback state
    document.querySelectorAll('input[name="feedbackAccuracy"]').forEach(radio => {
        radio.checked = false;
    });
    UI.toggle(document.getElementById('feedbackSubmitted'), false);
    UI.toggle(document.getElementById('feedbackOptions'), true);
    UI.toggle(document.getElementById('submitFeedbackBtn'), false);
}

/**
 * Handle feedback radio change
 */
function handleFeedbackChange() {
    const submitBtn = document.getElementById('submitFeedbackBtn');
    const selectedValue = document.querySelector('input[name="feedbackAccuracy"]:checked')?.value;
    
    if (selectedValue) {
        UI.toggle(submitBtn, true);
    }
}

/**
 * Handle feedback submission
 */
async function handleSubmitFeedback() {
    const selectedValue = document.querySelector('input[name="feedbackAccuracy"]:checked')?.value;
    if (!selectedValue || !state.selectedTicket || !state.currentAnalysis) {
        console.error('Missing required data for feedback:', {
            selectedValue,
            selectedTicket: state.selectedTicket,
            currentAnalysis: state.currentAnalysis
        });
        UI.error('Missing required data for feedback submission');
        return;
    }
    
    const submitBtn = document.getElementById('submitFeedbackBtn');
    UI.setButtonLoading(submitBtn, true);
    
    // Backend expects: ticket_id, ai_probability (0-100), admin_decision (0 or 1), final_outcome (0 or 1)
    const adminDecision = selectedValue === 'yes' ? 1 : 0;
    const aiProbability = state.currentAnalysis.breachProbability || 0;
    const ticketId = state.selectedTicket.id;
    
    // For now, we assume final_outcome matches admin_decision
    // In a real scenario, this would be determined after the ticket is resolved
    const finalOutcome = adminDecision;
    
    console.log('Submitting feedback:', {
        ticket_id: ticketId,
        ai_probability: aiProbability,
        admin_decision: adminDecision,
        final_outcome: finalOutcome
    });
    
    try {
        await AIService.submitFeedback(
            ticketId,
            aiProbability,
            adminDecision,
            finalOutcome
        );
        
        // Show success message
        UI.toggle(document.getElementById('feedbackOptions'), false);
        UI.toggle(document.getElementById('feedbackSubmitted'), true);
        UI.toggle(submitBtn, false);
        
        UI.success('Feedback submitted successfully');
    } catch (error) {
        console.error('Failed to submit feedback:', error);
        UI.error(`Failed to submit feedback: ${error.message}`);
    } finally {
        UI.setButtonLoading(submitBtn, false);
    }
}

/**
 * Reset modal state when closed
 */
function resetModalState() {
    state.selectedTicket = null;
    state.currentAnalysis = null;
    
    // Reset gauge
    const gaugeCircle = document.getElementById('slaGaugeCircle');
    if (gaugeCircle) {
        gaugeCircle.style.strokeDashoffset = '339.292';
    }
    
    // Reset feedback
    document.querySelectorAll('input[name="feedbackAccuracy"]').forEach(radio => {
        radio.checked = false;
    });
}

/**
 * Show error state
 */
function showError(message) {
    const tableBody = document.getElementById('ticketsTableBody');
    const errorState = document.getElementById('ticketsError');
    const errorMessage = document.getElementById('ticketsErrorMessage');

    if (tableBody) tableBody.innerHTML = '';
    if (errorMessage) errorMessage.textContent = message;
    UI.toggle(errorState, true);
}

/**
 * Format status for display
 */
function formatStatus(status) {
    if (!status) return 'Unknown';
    return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Format priority for display
 */
function formatPriority(priority) {
    if (!priority) return 'Unknown';
    return priority.charAt(0).toUpperCase() + priority.slice(1).toLowerCase();
}
