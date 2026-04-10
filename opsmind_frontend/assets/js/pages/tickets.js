/**
 * OpsMind - Tickets Page Module
 * 
 * Handles tickets page functionality:
 * - Listing tickets with pagination
 * - Filtering and searching
 * - Viewing ticket details
 * - Creating new tickets
 * - Updating ticket status
 * - Triggering workflows
 */

import UI from '/assets/js/ui.js';
import TicketService from '/services/ticketService.js';
import WorkflowService from '/services/workflowService.js';
import AIService from '/services/aiService.js';
import GeminiService from '/services/geminiService.js';
import Router from '/assets/js/router.js';
import AuthService from '/services/authService.js';

/**
 * Page state
 */
const state = {
    tickets: [],
    currentPage: 1,
    totalPages: 1,
    totalTickets: 0,
    pageSize: 10,
    filters: {
        search: '',
        status: '',
        priority: '',
        type_of_request: '',
        dateRange: ''
    },
    sortBy: 'created',
    sortOrder: 'desc',
    selectedTicket: null,
    isLoading: false,
    viewMode: 'table' // 'table' or 'card'
};

/**
 * Initialize the tickets page
 */
export async function initTicketsPage() {
    // Wait for app to be ready
    await waitForApp();
    
    // Check for URL parameters
    parseUrlParams();
    
    // Set up event listeners
    setupEventListeners();
    
    // Load initial data
    await loadTickets();
    
    // Load assignees for create form
    loadAssignees();
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
 * Parse URL parameters for deep linking
 */
function parseUrlParams() {
    const ticketId = Router.getQueryParam('id');
    const priority = Router.getQueryParam('priority');
    const status = Router.getQueryParam('status');

    if (priority) {
        state.filters.priority = priority;
        document.getElementById('priorityFilter').value = priority;
    }
    
    if (status) {
        state.filters.status = status;
        document.getElementById('statusFilter').value = status;
    }

    // If ticket ID is provided, open that ticket's modal after load
    if (ticketId) {
        state.selectedTicket = ticketId;
    }
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
    // Search input with debounce
    const searchInput = document.getElementById('searchInput');
    searchInput?.addEventListener('input', UI.debounce((e) => {
        state.filters.search = e.target.value;
        state.currentPage = 1;
        loadTickets();
    }, 300));

    // Filter selects
    const filterIds = ['statusFilter', 'priorityFilter', 'typeFilter', 'dateFilter'];
    filterIds.forEach(id => {
        const el = document.getElementById(id);
        el?.addEventListener('change', (e) => {
            const filterMap = {
                'statusFilter': 'status',
                'priorityFilter': 'priority',
                'typeFilter': 'type_of_request',
                'dateFilter': 'dateRange'
            };
            const filterKey = filterMap[id];
            state.filters[filterKey] = e.target.value;
            state.currentPage = 1;
            loadTickets();
        });
    });

    // Clear filters button
    document.getElementById('clearFilters')?.addEventListener('click', clearFilters);

    // Create ticket buttons
    document.getElementById('createTicketBtn')?.addEventListener('click', openCreateModal);
    document.getElementById('createFirstTicket')?.addEventListener('click', openCreateModal);

    // Create ticket form
    document.getElementById('createTicketForm')?.addEventListener('submit', handleCreateTicket);

    // AI Help button
    document.getElementById('aiHelpBtn')?.addEventListener('click', handleAIHelp);
    
    // Proceed with ticket creation from AI Help modal
    document.getElementById('proceedWithTicketBtn')?.addEventListener('click', () => {
        bootstrap.Modal.getInstance(document.getElementById('aiHelpModal'))?.hide();
        // Focus back on create modal
    });

    // View toggle buttons
    document.getElementById('tableViewBtn')?.addEventListener('click', () => setViewMode('table'));
    document.getElementById('cardViewBtn')?.addEventListener('click', () => setViewMode('card'));

    // Export button
    document.getElementById('exportBtn')?.addEventListener('click', () => {
        UI.info('Export feature coming soon!');
    });

    // Sortable columns
    document.querySelectorAll('.sortable').forEach(col => {
        col.addEventListener('click', () => {
            const sortBy = col.dataset.sort;
            if (state.sortBy === sortBy) {
                state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                state.sortBy = sortBy;
                state.sortOrder = 'desc';
            }
            updateSortIndicators();
            loadTickets();
        });
    });

    // Retry button
    document.getElementById('retryLoadTickets')?.addEventListener('click', loadTickets);

    // Ticket detail modal buttons
    document.getElementById('updateStatusBtn')?.addEventListener('click', handleStatusUpdate);
    document.getElementById('triggerWorkflowBtn')?.addEventListener('click', openWorkflowModal);

    // Pagination clicks
    document.getElementById('paginationList')?.addEventListener('click', handlePaginationClick);

    // Add event listener for update form
    if (document.getElementById('updateTicketForm')) {
        document.getElementById('updateTicketForm').addEventListener('submit', handleUpdateTicket);
    }
    // Add event listener for update ticket form to show confirmation modal only
    const updateForm = document.getElementById('updateTicketForm');
    if (updateForm) {
        updateForm.addEventListener('submit', function(e) {
            e.preventDefault(); // Prevent direct update
            // Show confirmation modal
            const confirmModal = document.getElementById('confirmUpdateTicketModal');
            if (!confirmModal) return;
            const confirmInstance = bootstrap.Modal.getOrCreateInstance(confirmModal);
            confirmInstance.show();
        });
    }
    // Only handle update after confirmation
    let confirmUpdateBtn = document.getElementById('confirmUpdateTicketBtn');
    if (confirmUpdateBtn) {
        confirmUpdateBtn.addEventListener('click', handleUpdateTicket);
    }

    // Add event listener for delete confirmation
    const deleteBtn = document.getElementById('confirmDeleteTicketBtn');
    deleteBtn?.addEventListener('click', handleDeleteTicket);
}

/**
 * Clear all filters
 */
function clearFilters() {
    state.filters = {
        search: '',
        status: '',
        priority: '',
        type_of_request: '',
        dateRange: ''
    };
    state.currentPage = 1;

    // Reset form inputs
    document.getElementById('searchInput').value = '';
    document.getElementById('statusFilter').value = '';
    document.getElementById('priorityFilter').value = '';
    document.getElementById('typeFilter').value = '';
    document.getElementById('dateFilter').value = '';

    // Update URL
    Router.updateQueryParams({ status: null, priority: null, type: null });

    loadTickets();
}

/**
 * Load tickets from API
 */
async function loadTickets() {
    if (state.isLoading) return;
    state.isLoading = true;

    const tableBody = document.getElementById('ticketsTableBody');
    const cardGrid = document.getElementById('ticketsCardGrid');
    const emptyState = document.getElementById('ticketsEmpty');
    const errorState = document.getElementById('ticketsError');
    const pagination = document.getElementById('ticketsPagination');

    // Show loading
    UI.toggle(emptyState, false);
    UI.toggle(errorState, false);
    
    if (tableBody) {
        tableBody.innerHTML = `
            <tr class="loading-row">
                <td colspan="8">
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
        
        // Get current user to determine which endpoint to use
        const currentUser = AuthService.getUser();
        const isAdmin = AuthService.isAdmin();
        
        let response;
        
        // Regular users: only fetch their own tickets
        // Admins: fetch all tickets
        if (!isAdmin && currentUser?.id) {
            // Use requester-specific endpoint for regular users
            response = await TicketService.getTicketsByRequester(currentUser.id, {
                limit: state.pageSize,
                offset,
                status: state.filters.status,
                priority: state.filters.priority
            });
        } else {
            // Use general endpoint for admins
            response = await TicketService.getTickets({
                limit: state.pageSize,
                offset,
                ...state.filters,
                sortBy: state.sortBy,
                sortOrder: state.sortOrder
            });
        }

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
        
        // Check if we need to open a specific ticket
        if (state.selectedTicket) {
            openTicketDetail(state.selectedTicket);
            state.selectedTicket = null;
        }
    } catch (error) {
        console.error('Failed to load tickets:', error);
        
        // Check if it's a network error
        if (error.message.includes('fetch') || error.message.includes('Network')) {
            // Use mock data for demo
            useMockTickets();
        } else {
            showError(error.message);
        }
    } finally {
        state.isLoading = false;
    }
}

/**
 * Render tickets in current view mode
 */
function renderTickets() {
    const tableBody = document.getElementById('ticketsTableBody');
    const cardGrid = document.getElementById('ticketsCardGrid');
    const emptyState = document.getElementById('ticketsEmpty');
    const ticketCount = document.getElementById('ticketCount');

    // Update count
    if (ticketCount) {
        ticketCount.textContent = `${state.totalTickets} Ticket${state.totalTickets !== 1 ? 's' : ''}`;
    }

    if (state.tickets.length === 0) {
        if (tableBody) tableBody.innerHTML = '';
        if (cardGrid) cardGrid.innerHTML = '';
        UI.toggle(emptyState, true);
        return;
    }

    UI.toggle(emptyState, false);

    if (state.viewMode === 'table') {
        renderTableView(tableBody);
    } else {
        renderCardView(cardGrid);
    }
}

/**
 * Render table view
 */
function renderTableView(tableBody) {
    if (!tableBody) return;

    let html = '';
    const currentUser = AuthService.getCurrentUser();

    state.tickets.forEach(ticket => {
        // Determine button visibility based on role
        const canTriggerWorkflow = AuthService.isTechnician() || AuthService.isSenior() || AuthService.isSupervisor() || AuthService.isAdmin();
        const canUpdate = AuthService.isAdmin() || 
                         AuthService.isSupervisor() || 
                         AuthService.isSenior() ||
                         (ticket.assignee === currentUser?.email);
        const canDelete = AuthService.isAdmin();

        html += `
            <tr data-ticket-id="${ticket.id}" class="ticket-row">
                <td><code class="text-primary">${UI.escapeHTML(ticket.id)}</code></td>
                <td>
                    <div class="text-truncate" style="max-width: 250px;" title="${UI.escapeHTML(ticket.title || ticket.subject || '')}">
                        ${UI.escapeHTML(ticket.title || ticket.subject || '')}
                    </div>
                </td>
                <td>
                    <span class="text-muted">-</span>
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
                    <span class="${ticket.assignee ? '' : 'text-muted'}">
                        ${ticket.assignee ? UI.escapeHTML(ticket.assignee) : 'Unassigned'}
                    </span>
                </td>
                <td>
                    <span class="text-muted">${UI.formatRelativeTime(ticket.createdAt)}</span>
                </td>
                <td class="text-end">
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-primary btn-sm" onclick="event.stopPropagation();" data-action="view" data-id="${ticket.id}" title="View Details">
                            <i class="bi bi-eye"></i>
                        </button>
                        ${canTriggerWorkflow ? `
                        <button class="btn btn-outline-secondary btn-sm" onclick="event.stopPropagation();" data-action="workflow" data-id="${ticket.id}" title="Trigger Workflow">
                            <i class="bi bi-play"></i>
                        </button>
                        ` : ''}
                        ${canUpdate ? `
                        <button class="btn btn-outline-info btn-sm" onclick="event.stopPropagation();" data-action="update" data-id="${ticket.id}" title="Update Ticket">
                            <i class="bi bi-pencil"></i>
                        </button>
                        ` : ''}
                        ${canDelete ? `
                        <button class="btn btn-outline-danger btn-sm" onclick="event.stopPropagation();" data-action="delete" data-id="${ticket.id}" title="Delete Ticket">
                            <i class="bi bi-trash"></i>
                        </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    });

    tableBody.innerHTML = html;

    // Add row click handlers
    tableBody.querySelectorAll('.ticket-row').forEach(row => {
        row.addEventListener('click', () => {
            openTicketDetail(row.dataset.ticketId);
        });
    });

    // Add action button handlers
    tableBody.querySelectorAll('[data-action="view"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openTicketDetail(btn.dataset.id);
        });
    });

    tableBody.querySelectorAll('[data-action="workflow"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            state.selectedTicket = btn.dataset.id;
            openWorkflowModal();
        });
    });

    tableBody.querySelectorAll('[data-action="update"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openUpdateModal(btn.dataset.id);
        });
    });

    tableBody.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            showDeleteConfirmation(btn.dataset.id);
        });
    });
}

/**
 * Render card view
 */
function renderCardView(cardGrid) {
    if (!cardGrid) return;

    let html = '';

    state.tickets.forEach(ticket => {
        html += `
            <div class="col-12 col-md-6 col-xl-4">
                <div class="card h-100 ticket-card" data-ticket-id="${ticket.id}">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <code class="text-primary">${UI.escapeHTML(ticket.id)}</code>
                            <span class="badge ${UI.getPriorityBadgeClass(ticket.priority)}">
                                ${formatPriority(ticket.priority)}
                            </span>
                        </div>
                        <h6 class="card-title text-truncate-2">${UI.escapeHTML(ticket.subject)}</h6>
                        <p class="card-text small text-muted text-truncate-2">${UI.escapeHTML(ticket.description || '')}</p>
                        <div class="d-flex justify-content-between align-items-center mt-3">
                            <span class="badge ${UI.getStatusBadgeClass(ticket.status)}">
                                ${formatStatus(ticket.status)}
                            </span>
                            <small class="text-muted">${UI.formatRelativeTime(ticket.createdAt)}</small>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });

    cardGrid.innerHTML = html;

    // Add click handlers
    cardGrid.querySelectorAll('.ticket-card').forEach(card => {
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => {
            openTicketDetail(card.dataset.ticketId);
        });
    });
}

/**
 * Set view mode
 */
function setViewMode(mode) {
    state.viewMode = mode;
    
    const tableView = document.getElementById('tableView');
    const cardView = document.getElementById('cardView');
    const tableBtn = document.getElementById('tableViewBtn');
    const cardBtn = document.getElementById('cardViewBtn');

    if (mode === 'table') {
        UI.toggle(tableView, true);
        UI.toggle(cardView, false);
        tableBtn?.classList.add('active');
        cardBtn?.classList.remove('active');
    } else {
        UI.toggle(tableView, false);
        UI.toggle(cardView, true);
        tableBtn?.classList.remove('active');
        cardBtn?.classList.add('active');
    }

    renderTickets();
}

/**
 * Update sort indicators in table headers
 */
function updateSortIndicators() {
    document.querySelectorAll('.sortable').forEach(col => {
        col.classList.remove('asc', 'desc');
        if (col.dataset.sort === state.sortBy) {
            col.classList.add(state.sortOrder);
        }
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
 * Open ticket detail modal
 */
async function openTicketDetail(ticketId) {
    const modal = document.getElementById('ticketDetailModal');
    const modalInstance = new bootstrap.Modal(modal);
    
    // Show loading state
    UI.toggle(document.getElementById('ticketDetailLoading'), true);
    UI.toggle(document.getElementById('ticketDetailInfo'), false);
    
    document.getElementById('ticketModalId').textContent = ticketId;
    
    modalInstance.show();

    try {
        // Find ticket in current list or fetch from API
        let ticket = state.tickets.find(t => t.id === ticketId);
        
        if (!ticket) {
            ticket = await TicketService.getTicket(ticketId);
        }

        // Store for later use
        state.selectedTicket = ticketId;

        // Populate modal
        populateTicketModal(ticket);

        // Load AI recommendations
        loadAIRecommendations(ticketId);
    } catch (error) {
        console.error('Failed to load ticket:', error);
        UI.error('Failed to load ticket details');
        modalInstance.hide();
    }
}

/**
 * Populate ticket detail modal
 */
function populateTicketModal(ticket) {
    UI.toggle(document.getElementById('ticketDetailLoading'), false);
    UI.toggle(document.getElementById('ticketDetailInfo'), true);

    // Use backend ticket title for subject field
    document.getElementById('ticketSubject').textContent = ticket.title || ticket.subject || '';
    
    // Status badge
    const statusBadge = document.getElementById('ticketStatusBadge');
    statusBadge.className = `badge ${UI.getStatusBadgeClass(ticket.status)}`;
    statusBadge.textContent = formatStatus(ticket.status);

    // Priority badge
    const priorityBadge = document.getElementById('ticketPriorityBadge');
    priorityBadge.className = `badge ${UI.getPriorityBadgeClass(ticket.priority)}`;
    priorityBadge.textContent = formatPriority(ticket.priority);

    // Type badge (replaces category)
    const typeBadge = document.getElementById('ticketCategoryBadge');
    typeBadge.textContent = formatType(ticket.type_of_request || ticket.type);

    // Details
    document.getElementById('ticketRequester').textContent = ticket.requester_id || ticket.requesterName || ticket.requester || 'Unknown';
    document.getElementById('ticketAssignedLevel').textContent = ticket.assigned_to_level || 'L1';
    document.getElementById('ticketSupportLevel').textContent = ticket.support_level || 'L1';
    document.getElementById('ticketEscalationCount').textContent = ticket.escalation_count || 0;
    document.getElementById('ticketBuilding').textContent = ticket.building || 'N/A';
    document.getElementById('ticketRoom').textContent = ticket.room || 'N/A';
    document.getElementById('ticketCreatedAt').textContent = UI.formatDateTime(ticket.created_at || ticket.createdAt);
    document.getElementById('ticketUpdatedAt').textContent = UI.formatDateTime(ticket.updated_at || ticket.updatedAt);
    document.getElementById('ticketDescription').textContent = ticket.description || 'No description provided.';

    // Set current status in dropdown
    document.getElementById('newStatusSelect').value = ticket.status;
    
    // Show/hide resolution summary field based on status
    const resolutionContainer = document.getElementById('resolutionSummaryContainer');
    const resolutionTextarea = document.getElementById('resolutionSummary');
    if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
        resolutionContainer.style.display = 'block';
        if (ticket.resolution_summary) {
            resolutionTextarea.value = ticket.resolution_summary;
        }
    } else {
        resolutionContainer.style.display = 'none';
    }
    
    // Listen for status changes to show/hide resolution field
    document.getElementById('newStatusSelect').addEventListener('change', function(e) {
        if (e.target.value === 'RESOLVED' || e.target.value === 'CLOSED') {
            resolutionContainer.style.display = 'block';
        } else {
            resolutionContainer.style.display = 'none';
        }
    });
}

/**
 * Load AI recommendations for ticket
 */
async function loadAIRecommendations(ticketId) {
    const container = document.getElementById('aiRecommendationsList');
    const section = document.getElementById('aiRecommendationsSection');
    
    if (!container) return;

    try {
        const recommendations = await AIService.getRecommendations(ticketId);
        
        if (!recommendations || recommendations.length === 0) {
            UI.toggle(section, false);
            return;
        }

        UI.toggle(section, true);
        
        let html = '';
        recommendations.forEach(rec => {
            html += `<li>${UI.escapeHTML(rec.text || rec.message || rec)}</li>`;
        });
        
        container.innerHTML = html;
    } catch (error) {
        // Use mock recommendations for demo
        UI.toggle(section, true);
        container.innerHTML = `
            <li>Consider escalating to network team based on similar resolved tickets</li>
            <li>Similar issue resolved by restarting the VPN service</li>
            <li>Knowledge base article KB-2341 may be relevant</li>
        `;
    }
}

/**
 * Handle status update
 */
async function handleStatusUpdate() {
    const newStatus = document.getElementById('newStatusSelect').value;
    const resolutionSummary = document.getElementById('resolutionSummary')?.value || '';
    const ticketId = state.selectedTicket;

    if (!newStatus || !ticketId) {
        UI.warning('Please select a status');
        return;
    }

    // Validate state transition
    const ticket = state.tickets.find(t => t.id === ticketId);
    if (ticket) {
        const validTransitions = {
            'OPEN': ['IN_PROGRESS'],
            'IN_PROGRESS': ['RESOLVED'],
            'RESOLVED': ['CLOSED']
        };
        
        const allowedStates = validTransitions[ticket.status];
        if (allowedStates && !allowedStates.includes(newStatus)) {
            UI.warning(`Invalid transition. From ${ticket.status} you can only go to: ${allowedStates.join(', ')}`);
            return;
        }
    }

    const btn = document.getElementById('updateStatusBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Updating...';

    try {
        await TicketService.updateStatus(ticketId, newStatus, resolutionSummary);
        
        UI.success('Ticket status updated');
        
        // Update local data
        if (ticket) {
            ticket.status = newStatus;
            ticket.updated_at = new Date();
            if (resolutionSummary) {
                ticket.resolution_summary = resolutionSummary;
            }
        }
        
        // Update modal display
        const statusBadge = document.getElementById('ticketStatusBadge');
        statusBadge.className = `badge ${UI.getStatusBadgeClass(newStatus)}`;
        statusBadge.textContent = formatStatus(newStatus);
        
        // Refresh table
        renderTickets();
    } catch (error) {
        console.error('Failed to update status:', error);
        UI.error(error.message || 'Failed to update ticket status');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-lg me-1"></i> Update Status';
    }
}

/**
 * Open workflow trigger modal
 */
async function openWorkflowModal() {
    const modal = document.getElementById('triggerWorkflowModal');
    const modalInstance = new bootstrap.Modal(modal);
    const container = document.getElementById('workflowsList');
    const loading = document.getElementById('workflowsLoading');

    UI.toggle(loading, true);
    modalInstance.show();

    try {
        const workflows = await WorkflowService.getWorkflowsForTicket(state.selectedTicket);
        renderWorkflowOptions(container, workflows);
    } catch (error) {
        // Use mock workflows
        renderWorkflowOptions(container, [
            { id: 'wf-1', name: 'Auto-Assignment', description: 'Automatically assign to available technician' },
            { id: 'wf-2', name: 'Escalation', description: 'Escalate to senior support' },
            { id: 'wf-3', name: 'Notification', description: 'Send notification to stakeholders' }
        ]);
    } finally {
        UI.toggle(loading, false);
    }
}

/**
 * Render workflow options
 */
function renderWorkflowOptions(container, workflows) {
    if (!workflows || workflows.length === 0) {
        container.innerHTML = '<p class="text-muted">No workflows available for this ticket.</p>';
        return;
    }

    let html = '<div class="list-group">';
    
    workflows.forEach(wf => {
        html += `
            <button type="button" class="list-group-item list-group-item-action" data-workflow-id="${wf.id}">
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <strong>${UI.escapeHTML(wf.name)}</strong>
                        <p class="mb-0 small text-muted">${UI.escapeHTML(wf.description || '')}</p>
                    </div>
                    <i class="bi bi-play-fill text-primary"></i>
                </div>
            </button>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;

    // Add click handlers
    container.querySelectorAll('[data-workflow-id]').forEach(btn => {
        btn.addEventListener('click', () => triggerWorkflow(btn.dataset.workflowId));
    });
}

/**
 * Trigger a workflow
 */
async function triggerWorkflow(workflowId) {
    const loading = UI.showLoading('Triggering workflow...');

    try {
        await WorkflowService.triggerExecution(workflowId, { ticketId: state.selectedTicket });
        
        loading.hide();
        UI.success('Workflow triggered successfully');
        
        // Close modals
        bootstrap.Modal.getInstance(document.getElementById('triggerWorkflowModal'))?.hide();
        bootstrap.Modal.getInstance(document.getElementById('ticketDetailModal'))?.hide();
    } catch (error) {
        loading.hide();
        UI.error('Failed to trigger workflow');
    }
}

/**
 * Open create ticket modal
 */
function openCreateModal() {
    const modal = document.getElementById('createTicketModal');
    const form = document.getElementById('createTicketForm');
    
    // Reset form
    UI.resetFormValidation(form);
    
    const modalInstance = new bootstrap.Modal(modal);
    modalInstance.show();
}

/**
 * Open update ticket modal
 */
function openUpdateModal(ticketId) {
    const ticket = state.tickets.find(t => t.id === ticketId);
    if (!ticket) return;
    
    state.selectedTicket = ticketId;
    
    // Fill update modal fields with ticket values (matching backend schema)
    const titleInput = document.getElementById('updateTicketTitle');
    const descriptionInput = document.getElementById('updateTicketDescription');
    const typeInput = document.getElementById('updateTicketType');
    const statusInput = document.getElementById('updateTicketStatus');
    const buildingInput = document.getElementById('updateTicketBuilding');
    const roomInput = document.getElementById('updateTicketRoom');
    const resolutionInput = document.getElementById('updateResolutionSummary');
    
    if (titleInput) titleInput.value = ticket.title || '';
    if (descriptionInput) descriptionInput.value = ticket.description || '';
    if (typeInput) typeInput.value = ticket.type_of_request || ticket.type || 'INCIDENT';
    if (statusInput) statusInput.value = ticket.status || 'OPEN';
    if (buildingInput) buildingInput.value = ticket.building || '';
    if (roomInput) roomInput.value = ticket.room || '';
    if (resolutionInput && ticket.resolution_summary) {
        resolutionInput.value = ticket.resolution_summary;
    }
    
    // Show/hide resolution summary based on status
    const resolutionContainer = document.getElementById('updateResolutionSummaryContainer');
    if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
        resolutionContainer.style.display = 'block';
    } else {
        resolutionContainer.style.display = 'none';
    }
    
    // Add event listener for status change
    if (statusInput) {
        statusInput.addEventListener('change', function(e) {
            if (e.target.value === 'RESOLVED' || e.target.value === 'CLOSED') {
                resolutionContainer.style.display = 'block';
            } else {
                resolutionContainer.style.display = 'none';
            }
        });
    }
    
    // Show update modal
    const modal = document.getElementById('updateTicketModal');
    if (!modal) return;
    const modalInstance = bootstrap.Modal.getOrCreateInstance(modal);
    modalInstance.show();
}

/**
 * Load assignees for create form
 */
async function loadAssignees() {
    const select = document.getElementById('newTicketAssignee');
    if (!select) return;

    try {
        const assignees = await TicketService.getAssignees();
        
        let html = '<option value="">Unassigned</option>';
        assignees.forEach(user => {
            html += `<option value="${user.id}">${UI.escapeHTML(user.name)}</option>`;
        });
        
        select.innerHTML = html;
    } catch (error) {
        // Use mock data
        select.innerHTML = `
            <option value="">Unassigned</option>
            <option value="1">John Smith</option>
            <option value="2">Sarah Wilson</option>
            <option value="3">Mike Johnson</option>
            <option value="4">Lisa Chen</option>
        `;
    }
}

/**
 * Handle create ticket form submission
 */
async function handleCreateTicket(e) {
    e.preventDefault();
    const form = e.target;
    if (!UI.validateForm(form)) return;
    const submitBtn = document.getElementById('submitTicketBtn');
    UI.setButtonLoading(submitBtn, true);

    // Collect form values exactly as backend expects
    const title = document.getElementById('newTicketSubject').value.trim();
    const description = document.getElementById('newTicketDescription').value.trim();
    const type_of_request = document.getElementById('newTicketType')?.value || 'INCIDENT';
    const building = document.getElementById('newTicketBuilding')?.value.trim();
    const room = document.getElementById('newTicketRoom')?.value.trim();
    
    // Get current user ID as requester_id
    const currentUser = AuthService.getUser?.();
    const requester_id = currentUser?.id || currentUser?.userId || currentUser?.email || '';

    // Guard: backend requires title, description, type_of_request, building, room, requester_id
    if (!title || !description || !type_of_request || !building || !room || !requester_id) {
        UI.setButtonLoading(submitBtn, false);
        UI.error('All required fields must be filled');
        return;
    }

    // Build ticketData exactly as backend expects
    const ticketData = {
        title,
        description,
        type_of_request,
        building,
        room,
        requester_id
    };

    try {
        await TicketService.createTicket(ticketData);
        UI.success('Ticket created successfully');
        bootstrap.Modal.getInstance(document.getElementById('createTicketModal'))?.hide();
        form.reset();
        UI.resetFormValidation(form);
        state.currentPage = 1;
        await loadTickets();
    } catch (error) {
        console.error('Failed to create ticket:', error);
        UI.error(error.message || 'Failed to create ticket');
    } finally {
        UI.setButtonLoading(submitBtn, false);
    }
}

/**
 * Handle AI Help button click
 */
async function handleAIHelp() {
    // Collect current form values
    const title = document.getElementById('newTicketSubject')?.value.trim() || '';
    const description = document.getElementById('newTicketDescription')?.value.trim() || '';
    const type = document.getElementById('newTicketType')?.value || '';
    const building = document.getElementById('newTicketBuilding')?.value || '';
    const room = document.getElementById('newTicketRoom')?.value || '';
    
    // Check if user has filled in at least title and description
    if (!title || !description) {
        UI.warning('Please fill in at least the Title and Description fields to get AI suggestions.');
        return;
    }
    
    // Show AI Help modal
    const aiHelpModal = new bootstrap.Modal(document.getElementById('aiHelpModal'));
    aiHelpModal.show();
    
    // Show loading state
    document.getElementById('aiHelpLoading').classList.remove('d-none');
    document.getElementById('aiHelpContent').classList.add('d-none');
    document.getElementById('aiHelpError').classList.add('d-none');
    
    // Show loading on button
    const aiHelpBtn = document.getElementById('aiHelpBtn');
    UI.setButtonLoading(aiHelpBtn, true);
    
    try {
        // Build detailed prompt for AI
        const prompt = `I am creating an IT support ticket with the following details:

**Ticket Title:** ${title}

**Description:** ${description}

${type ? `**Type:** ${type}` : ''}
${building ? `**Building:** ${building}` : ''}
${room ? `**Room:** ${room}` : ''}

As an IT support expert, please provide:
1. A brief analysis of the issue
2. Detailed troubleshooting steps the user can try before submitting the ticket
3. What information they should gather if the issue persists
4. Estimated urgency/priority of this issue

Format your response with clear headings and numbered steps. Be specific and actionable.`;

        // Call Gemini AI
        const aiResponse = await GeminiService.generateResponse(prompt, []);
        
        // Hide loading, show content
        document.getElementById('aiHelpLoading').classList.add('d-none');
        document.getElementById('aiHelpContent').classList.remove('d-none');
        
        // Format and display the AI response
        const formattedResponse = formatAIResponse(aiResponse);
        document.getElementById('aiSuggestionsText').innerHTML = formattedResponse;
        
    } catch (error) {
        console.error('[AI Help] Error:', error);
        
        // Show error state
        document.getElementById('aiHelpLoading').classList.add('d-none');
        document.getElementById('aiHelpError').classList.remove('d-none');
        document.getElementById('aiHelpErrorMessage').textContent = 
            error.message || 'An error occurred while generating suggestions. Please try again.';
    } finally {
        UI.setButtonLoading(aiHelpBtn, false);
    }
}

/**
 * Format AI response with proper HTML
 */
function formatAIResponse(text) {
    // Convert markdown-style formatting to HTML
    let formatted = text
        // Headers (##)
        .replace(/##\s+(.+)/g, '<h6>$1</h6>')
        // Bold (**text**)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        // Italic (*text*)
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // Code (`code`)
        .replace(/`(.+?)`/g, '<code>$1</code>')
        // Line breaks
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>');
    
    // Wrap in paragraph
    formatted = '<p>' + formatted + '</p>';
    
    // Convert numbered lists (1. 2. 3.)
    formatted = formatted.replace(/(\d+)\.\s+(.+?)(?=<br>|<\/p>)/g, '<li>$2</li>');
    formatted = formatted.replace(/(<li>.*<\/li>)/s, '<ol>$1</ol>');
    
    // Convert bullet lists (- or *)
    formatted = formatted.replace(/[-*]\s+(.+?)(?=<br>|<\/p>)/g, '<li>$1</li>');
    
    return formatted;
}

/**
 * Handle update ticket form submission
 */
async function handleUpdateTicket(e) {
    if (e) e.preventDefault();
    
    const form = document.getElementById('updateTicketForm');
    if (!UI.validateForm(form)) return;
    
    const submitBtn = document.getElementById('submitUpdateTicketBtn');
    UI.setButtonLoading(submitBtn, true);

    const ticketId = state.selectedTicket;
    if (!ticketId) {
        UI.error('No ticket selected');
        UI.setButtonLoading(submitBtn, false);
        return;
    }

    // Collect form values exactly as backend expects (PATCH /tickets/{id})
    const title = document.getElementById('updateTicketTitle')?.value.trim();
    const description = document.getElementById('updateTicketDescription')?.value.trim();
    const type_of_request = document.getElementById('updateTicketType')?.value;
    const status = document.getElementById('updateTicketStatus')?.value;
    const building = document.getElementById('updateTicketBuilding')?.value.trim();
    const room = document.getElementById('updateTicketRoom')?.value.trim();
    const resolution_summary = document.getElementById('updateResolutionSummary')?.value.trim();

    // Validate required fields
    if (!title || !description || !type_of_request || !building || !room) {
        UI.setButtonLoading(submitBtn, false);
        UI.error('All required fields must be filled');
        return;
    }

    // Validate status transitions
    const ticket = state.tickets.find(t => t.id === ticketId);
    if (ticket && status && status !== ticket.status) {
        const validTransitions = {
            'OPEN': ['IN_PROGRESS'],
            'IN_PROGRESS': ['RESOLVED'],
            'RESOLVED': ['CLOSED']
        };
        
        const allowedStates = validTransitions[ticket.status];
        if (allowedStates && !allowedStates.includes(status)) {
            UI.setButtonLoading(submitBtn, false);
            UI.error(`Invalid transition. From ${ticket.status} you can only go to: ${allowedStates.join(', ')}`);
            return;
        }
    }

    // Build update data - only include fields that backend accepts
    const updateData = {
        title,
        description,
        type_of_request,
        building,
        room
    };

    // Only include status if it's changed
    if (status && status !== ticket?.status) {
        updateData.status = status;
    }

    // Include resolution_summary if status is RESOLVED or CLOSED
    if (resolution_summary && (status === 'RESOLVED' || status === 'CLOSED')) {
        updateData.resolution_summary = resolution_summary;
    }

    try {
        await TicketService.updateTicket(ticketId, updateData);
        UI.success('Ticket updated successfully');
        
        // Close modals
        bootstrap.Modal.getInstance(document.getElementById('updateTicketModal'))?.hide();
        bootstrap.Modal.getInstance(document.getElementById('confirmUpdateTicketModal'))?.hide();
        
        // Reset form
        form.reset();
        UI.resetFormValidation(form);
        
        // Reload tickets
        await loadTickets();
    } catch (error) {
        console.error('Failed to update ticket:', error);
        UI.error(error.message || 'Failed to update ticket');
    } finally {
        UI.setButtonLoading(submitBtn, false);
    }
}

/**
 * Handle ticket deletion
 */
async function handleDeleteTicket() {
    const ticketId = state.selectedTicket;
    if (!ticketId) return;
    const deleteBtn = document.getElementById('confirmDeleteTicketBtn');
    UI.setButtonLoading(deleteBtn, true);
    try {
        await TicketService.deleteTicket(ticketId);
        UI.success('Ticket deleted successfully');
        bootstrap.Modal.getInstance(document.getElementById('deleteTicketModal'))?.hide();
        state.selectedTicket = null;
        await loadTickets();
    } catch (error) {
        UI.error(error.message || 'Failed to delete ticket');
    } finally {
        UI.setButtonLoading(deleteBtn, false);
    }
}

/**
 * Show delete confirmation modal
 */
function showDeleteConfirmation(ticketId) {
    state.selectedTicket = ticketId;
    const modal = document.getElementById('deleteTicketModal');
    if (!modal) return;
    const modalInstance = new bootstrap.Modal(modal);
    modalInstance.show();
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

/**
 * Format type for display
 */
function formatType(type) {
    if (!type) return 'Incident';
    // Convert SERVICE_REQUEST to Service Request, MAINTENANCE to Maintenance, etc.
    return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Format category for display (deprecated, use formatType)
 */
function formatCategory(category) {
    if (!category) return 'Other';
    return category.charAt(0).toUpperCase() + category.slice(1);
}
