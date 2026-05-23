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
import OllamaService from '/services/ollamaService.js';
import AgenticAiService from '/services/agenticAiService.js';
import Router from '/assets/js/router.js';
import AuthService from '/services/authService.js';
import createSmoothTextStreamer from '/assets/js/components/smoothTextStreamer.js';
import {
    renderAiPriorityInsight,
    hasAiMetadata,
    isRequesterRole,
    isOperationalRole,
    getAiButtonLabel,
    normalizeRole
} from '/assets/js/components/aiPriorityInsight.js';

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
    viewMode: 'table', // 'table' or 'card'
    map: null, // Leaflet map instance
    mapMarker: null // Map marker instance
};

const ticketAiDetailsCache = new Map();

const DEVICE_OPTION_MY_CURRENT = 'MY_CURRENT_DEVICE';
const DEVICE_OPTION_OTHER_NOT_LISTED = 'OTHER_NOT_LISTED';
const WEB_DEVICE_REGISTRATION_VERSION = 'web-registration-0.1.0';

const DEVICE_NAME_BY_SELECTION = {
    [DEVICE_OPTION_MY_CURRENT]: 'My current device',
    [DEVICE_OPTION_OTHER_NOT_LISTED]: 'Other / Not listed'
};

const ALLOWED_OS_TYPES = new Set(['WINDOWS', 'MACOS', 'LINUX', 'UNKNOWN']);
const ALLOWED_ISSUE_SCOPES = new Set([
    'MY_DEVICE',
    'ROOM_DEVICE',
    'MULTIPLE_DEVICES',
    'BUILDING_WIDE',
    'UNKNOWN'
]);

let createTicketEndpointDevices = [];
let createTicketDevicesLoading = false;
let pendingEndpointDeviceLoadOptions = null;
let ticketEndpointDeviceStatusRequestId = 0;
let selectedCreateTicketEndpointDeviceId = DEVICE_OPTION_OTHER_NOT_LISTED;
let selectedCreateTicketEndpointDevice = null;

let isAiHelpStreaming = false;
let isEnhancementStreaming = false;

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
    const priority = String(Router.getQueryParam('priority') || '').toUpperCase();
    const status = String(Router.getQueryParam('status') || '').toUpperCase();

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
    document.getElementById('enhanceDescriptionBtn')?.addEventListener('click', handleEnhanceDescription);
    
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

    // Location features
    document.getElementById('useLocationBtn')?.addEventListener('click', handleUseLocation);
    
    // Manual coordinate inputs
    document.getElementById('manualLatitude')?.addEventListener('input', handleManualCoordinates);
    document.getElementById('manualLongitude')?.addEventListener('input', handleManualCoordinates);

    document.getElementById('newTicketAffectedDevice')?.addEventListener('change', handleAffectedDeviceSelectionChange);
    document.getElementById('registerEndpointDeviceBtn')?.addEventListener('click', toggleRegisterEndpointDevicePanel);
    document.getElementById('registerEndpointDeviceSubmitBtn')?.addEventListener('click', handleRegisterEndpointDevice);
    document.getElementById('registerEndpointDeviceCancelBtn')?.addEventListener('click', hideRegisterEndpointDevicePanel);

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
        
        // Determine fetch strategy based on role:
        //   technicians / seniors / supervisors → tickets assigned to them
        //   regular users (students / doctors)  → tickets they submitted
        //   admins                              → all tickets
        const isTech = AuthService.isTechnician() || AuthService.isSenior() || AuthService.isSupervisor();

        if (!isAdmin && isTech) {
            // Technicians see tickets assigned to them
            const techId = String(
                currentUser?.id || currentUser?.userId ||
                currentUser?.user_id || currentUser?.technicianId || ''
            );
            if (techId) {
                const assigned = await TicketService.getAssignedTickets(techId);
                // Apply active filters client-side
                let filtered = assigned;
                if (state.filters.status) {
                    filtered = filtered.filter((t) =>
                        String(t.status || '').toUpperCase() === String(state.filters.status || '').toUpperCase()
                    );
                }
                if (state.filters.priority) {
                    filtered = filtered.filter((t) =>
                        normalizePriorityValue(t.priority) === normalizePriorityValue(state.filters.priority)
                    );
                }
                if (state.filters.search) {
                    const q = state.filters.search.toLowerCase();
                    filtered = filtered.filter(t =>
                        [t.id, t.title, t.description, t.type_of_request]
                            .filter(Boolean).join(' ').toLowerCase().includes(q)
                    );
                }
                response = filtered;
            } else {
                response = [];
            }
        } else {
            const requesterId = String(currentUser?.id || currentUser?.userId || currentUser?.user_id || '');
            if (!isAdmin && requesterId) {
                // Regular users (students / doctors): see their own submitted tickets
                response = await TicketService.getTicketsByRequester(requesterId, {
                    limit: state.pageSize,
                    offset,
                    status: state.filters.status,
                    priority: state.filters.priority
                });
            } else {
                // Admins see all tickets
                response = await TicketService.getTickets({
                    limit: state.pageSize,
                    offset,
                    ...state.filters,
                    sortBy: state.sortBy,
                    sortOrder: state.sortOrder
                });
            }
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
        showError(error?.message || 'Failed to load tickets from backend.');
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

function resolveTextValue(...values) {
    for (const value of values) {
        if (value === null || value === undefined) continue;
        const normalized = String(value).trim();
        if (normalized) {
            return normalized;
        }
    }
    return '';
}

function resolveRequesterDisplay(ticket) {
    return resolveTextValue(
        ticket?.requester_name,
        ticket?.requesterName,
        ticket?.requester,
        ticket?.requester_id,
        ticket?.requesterId
    );
}

function resolveAssigneeDisplay(ticket) {
    return resolveTextValue(
        ticket?.assigned_to_name,
        ticket?.assignedToName,
        ticket?.assignee_name,
        ticket?.assigneeName,
        ticket?.assigned_to,
        ticket?.assignedTo
    );
}

/**
 * Render table view
 */
function renderTableView(tableBody) {
    if (!tableBody) return;

    let html = '';
    const currentUser = AuthService.getCurrentUser();

    state.tickets.forEach(ticket => {
        const requesterDisplay = resolveRequesterDisplay(ticket);
        const assigneeDisplay = resolveAssigneeDisplay(ticket);

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
                    ${requesterDisplay
                        ? UI.escapeHTML(requesterDisplay)
                        : '<span class="text-muted">--</span>'
                    }
                </td>
                <td>
                    <span class="badge ${getPriorityBadgeClass(ticket.priority)}">
                        ${formatPriority(ticket.priority)}
                    </span>
                </td>
                <td>
                    <span class="badge ${UI.getStatusBadgeClass(ticket.status)}">
                        ${formatStatus(ticket.status)}
                    </span>
                </td>
                <td>
                    ${assigneeDisplay
                        ? `<span class="badge bg-info text-dark">${UI.escapeHTML(assigneeDisplay)}</span>`
                        : `<span class="text-muted">Not assigned</span>`
                    }
                </td>
                <td>
                    <span class="text-muted">${UI.formatRelativeTime(resolveTicketCreatedAt(ticket))}</span>
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
                            <span class="badge ${getPriorityBadgeClass(ticket.priority)}">
                                ${formatPriority(ticket.priority)}
                            </span>
                        </div>
                        <h6 class="card-title text-truncate-2">${UI.escapeHTML(ticket.title || ticket.subject || '')}</h6>
                        <p class="card-text small text-muted text-truncate-2">${UI.escapeHTML(ticket.description || '')}</p>
                        <div class="d-flex justify-content-between align-items-center mt-3">
                            <span class="badge ${UI.getStatusBadgeClass(ticket.status)}">
                                ${formatStatus(ticket.status)}
                            </span>
                            <small class="text-muted">${UI.formatRelativeTime(resolveTicketCreatedAt(ticket))}</small>
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
            const ticketResponse = await TicketService.getTicket(ticketId);
            ticket = ticketResponse?.data?.ticket || ticketResponse?.data || ticketResponse?.ticket || ticketResponse;
        }

        if (!ticket || typeof ticket !== 'object') {
            throw new Error('Ticket details unavailable');
        }

        // Store for later use
        state.selectedTicket = ticketId;

        // Populate modal
        populateTicketModal(ticket);
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
    priorityBadge.className = `badge ${getPriorityBadgeClass(ticket.priority)}`;
    priorityBadge.textContent = formatPriority(ticket.priority);

    // Type badge (replaces category)
    const typeBadge = document.getElementById('ticketCategoryBadge');
    typeBadge.textContent = formatType(ticket.type_of_request || ticket.type);

    // Details
    const requesterDisplay = resolveRequesterDisplay(ticket);
    document.getElementById('ticketRequester').textContent = requesterDisplay || '--';
    
    // Assigned To
    const assignedToEl = document.getElementById('ticketAssignedTo');
    const assigneeDisplay = resolveAssigneeDisplay(ticket);
    if (assigneeDisplay) {
        assignedToEl.innerHTML = `<span class="badge bg-info text-dark">${UI.escapeHTML(assigneeDisplay)}</span>`;
    } else {
        assignedToEl.innerHTML = `<span class="text-muted">Not assigned</span>`;
    }
    
    document.getElementById('ticketAssignedLevel').textContent =
        resolveTextValue(ticket.assigned_to_level, ticket.assignedToLevel) || '--';
    document.getElementById('ticketSupportLevel').textContent =
        resolveTextValue(ticket.support_level, ticket.supportLevel) || '--';
    const escalationCount = ticket.escalation_count ?? ticket.escalationCount;
    document.getElementById('ticketEscalationCount').textContent =
        escalationCount !== null && escalationCount !== undefined && String(escalationCount).trim() !== ''
            ? String(escalationCount)
            : '--';
    
    // Display location as coordinates
    const locationEl = document.getElementById('ticketLocation');
    if (locationEl) {
        if (ticket.latitude && ticket.longitude) {
            locationEl.innerHTML = `
                ${ticket.latitude}, ${ticket.longitude}
                <a href="https://www.google.com/maps?q=${ticket.latitude},${ticket.longitude}" 
                   target="_blank" 
                   class="btn btn-sm btn-outline-primary ms-2">
                    <i class="bi bi-map me-1"></i> Open in Maps
                </a>
            `;
        } else {
            locationEl.textContent = 'Not available';
        }
    }
    document.getElementById('ticketCreatedAt').textContent = UI.formatDateTime(ticket.created_at || ticket.createdAt);
    document.getElementById('ticketUpdatedAt').textContent = UI.formatDateTime(ticket.updated_at || ticket.updatedAt);
    document.getElementById('ticketDescription').textContent = ticket.description || 'No description provided.';
    renderTicketEndpointDeviceContext(ticket);
    renderTicketAiInsightControls(ticket);

    const statusChangeSection = document.querySelector('.status-change-section');
    const isRequesterView = isRequesterRole(normalizeRole(resolveCurrentUserRole()));
    if (statusChangeSection) {
        statusChangeSection.classList.toggle('d-none', isRequesterView);
    }

    // Legacy AI explanation section is replaced by on-demand insight details.
    const aiRecommendationsSection = document.getElementById('aiRecommendationsSection');
    if (aiRecommendationsSection) {
        UI.toggle(aiRecommendationsSection, false);
    }

    const newStatusSelect = document.getElementById('newStatusSelect');
    const resolutionContainer = document.getElementById('resolutionSummaryContainer');
    const resolutionTextarea = document.getElementById('resolutionSummary');
    if (isRequesterView || !newStatusSelect) {
        if (resolutionContainer) {
            resolutionContainer.style.display = 'none';
        }
        return;
    }

    // Set current status in dropdown
    newStatusSelect.value = ticket.status;
    
    // Show/hide resolution summary field based on status
    if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
        resolutionContainer.style.display = 'block';
        if (ticket.resolution_summary) {
            resolutionTextarea.value = ticket.resolution_summary;
        }
    } else {
        resolutionContainer.style.display = 'none';
    }
    
    // Listen for status changes to show/hide resolution field
    newStatusSelect.addEventListener('change', function(e) {
        if (e.target.value === 'RESOLVED' || e.target.value === 'CLOSED') {
            resolutionContainer.style.display = 'block';
        } else {
            resolutionContainer.style.display = 'none';
        }
    });
}

function renderTicketEndpointDeviceContext(ticket) {
    const affectedDeviceId = String(ticket?.affected_device_id || ticket?.affectedDeviceId || '').trim();
    const affectedDeviceName = String(ticket?.affected_device_name || ticket?.affectedDeviceName || '').trim();
    const osType = resolveTextValue(ticket?.os_type, ticket?.osType).toUpperCase();
    const issueScope = resolveTextValue(ticket?.issue_scope, ticket?.issueScope).toUpperCase();
    const remoteSupportConsentValue = ticket?.remote_support_consent ?? ticket?.remoteSupportConsent;
    const aiAgentEligibleValue = ticket?.ai_agent_eligible ?? ticket?.aiAgentEligible;
    const aiAgentEligibilityReason = String(
        ticket?.ai_agent_eligibility_reason || ticket?.aiAgentEligibilityReason || ''
    ).trim();

    const summaryEl = document.getElementById('ticketEndpointDeviceSummary');
    const affectedDeviceNameEl = document.getElementById('ticketAffectedDeviceName');
    const affectedDeviceIdEl = document.getElementById('ticketAffectedDeviceId');
    const osTypeEl = document.getElementById('ticketOsType');
    const issueScopeEl = document.getElementById('ticketIssueScope');
    const remoteSupportConsentEl = document.getElementById('ticketRemoteSupportConsent');
    const agentStatusEl = document.getElementById('ticketEndpointAgentStatus');
    const agentVersionEl = document.getElementById('ticketEndpointAgentVersion');
    const lastSeenEl = document.getElementById('ticketEndpointLastSeenAt');
    const enabledEl = document.getElementById('ticketEndpointEnabled');
    const aiEligibleEl = document.getElementById('ticketAiAgentEligible');
    const aiReasonEl = document.getElementById('ticketAiAgentEligibilityReason');
    const aiEligibleWrap = document.getElementById('ticketAiEligibilityWrap');
    const aiReasonWrap = document.getElementById('ticketAiEligibilityReasonWrap');

    if (summaryEl) {
        summaryEl.textContent = affectedDeviceId
            ? 'Registered endpoint device linked to this ticket.'
            : 'No registered endpoint device linked to this ticket.';
    }

    if (affectedDeviceNameEl) affectedDeviceNameEl.textContent = affectedDeviceName || '--';
    if (affectedDeviceIdEl) affectedDeviceIdEl.textContent = affectedDeviceId || '--';
    if (osTypeEl) osTypeEl.textContent = osType || '--';
    if (issueScopeEl) issueScopeEl.textContent = issueScope || '--';
    if (remoteSupportConsentEl) {
        remoteSupportConsentEl.textContent =
            remoteSupportConsentValue === true
                ? 'Yes'
                : remoteSupportConsentValue === false
                    ? 'No'
                    : '--';
    }
    if (agentStatusEl) agentStatusEl.textContent = '--';
    if (agentVersionEl) agentVersionEl.textContent = '--';
    if (lastSeenEl) lastSeenEl.textContent = '--';
    if (enabledEl) enabledEl.textContent = '--';
    if (aiEligibleEl) {
        aiEligibleEl.textContent =
            aiAgentEligibleValue === true
                ? 'Yes'
                : aiAgentEligibleValue === false
                    ? 'No'
                    : '--';
    }
    if (aiReasonEl) aiReasonEl.textContent = aiAgentEligibilityReason || '--';

    const currentUserRole = normalizeRole(resolveCurrentUserRole());
    const showDetailedAgenticContext = isOperationalRole(currentUserRole) && !isRequesterRole(currentUserRole);

    if (aiEligibleWrap) aiEligibleWrap.classList.toggle('d-none', !showDetailedAgenticContext);
    if (aiReasonWrap) aiReasonWrap.classList.toggle('d-none', !showDetailedAgenticContext);

    if (affectedDeviceId) {
        void loadLiveEndpointDeviceStatus(affectedDeviceId);
    }
}

async function loadLiveEndpointDeviceStatus(deviceId) {
    const normalizedDeviceId = String(deviceId || '').trim();
    if (!normalizedDeviceId) {
        return;
    }

    const requestId = ++ticketEndpointDeviceStatusRequestId;
    const agentStatusEl = document.getElementById('ticketEndpointAgentStatus');
    const agentVersionEl = document.getElementById('ticketEndpointAgentVersion');
    const lastSeenEl = document.getElementById('ticketEndpointLastSeenAt');
    const enabledEl = document.getElementById('ticketEndpointEnabled');

    if (agentStatusEl) agentStatusEl.textContent = 'Loading...';

    try {
        const response = await AgenticAiService.getEndpointDeviceById(normalizedDeviceId);
        if (requestId !== ticketEndpointDeviceStatusRequestId) {
            return;
        }

        const device = response?.device || response || {};
        const status = String(device.agent_status || device.agentStatus || '--').trim() || '--';
        const version = String(device.agent_version || device.agentVersion || '--').trim() || '--';
        const lastSeenValue = device.last_seen_at || device.lastSeenAt || null;
        const isEnabled = device.is_agent_enabled === true || device.isAgentEnabled === true;

        if (agentStatusEl) agentStatusEl.textContent = status;
        if (agentVersionEl) agentVersionEl.textContent = version;
        if (lastSeenEl) lastSeenEl.textContent = lastSeenValue ? UI.formatDateTime(lastSeenValue) : '--';
        if (enabledEl) enabledEl.textContent = isEnabled ? 'Yes' : 'No';
    } catch (_error) {
        if (requestId !== ticketEndpointDeviceStatusRequestId) {
            return;
        }

        if (agentStatusEl) agentStatusEl.textContent = 'Unavailable';
        if (agentVersionEl) agentVersionEl.textContent = '--';
        if (lastSeenEl) lastSeenEl.textContent = '--';
        if (enabledEl) enabledEl.textContent = '--';
    }
}

function resolveTicketId(ticket) {
    return String(ticket?.id || ticket?.ticketId || '').trim();
}

async function resolveFullTicketForAiDetails(ticket) {
    const ticketId = resolveTicketId(ticket);
    if (!ticketId) {
        return ticket || {};
    }

    if (hasAiMetadata(ticket)) {
        ticketAiDetailsCache.set(ticketId, ticket);
        return ticket;
    }

    if (ticketAiDetailsCache.has(ticketId)) {
        return {
            ...(ticket || {}),
            ...ticketAiDetailsCache.get(ticketId)
        };
    }

    const response = await TicketService.getTicketById(ticketId);
    const fetchedTicket = response?.data?.ticket || response?.data || response?.ticket || response;

    if (!fetchedTicket || typeof fetchedTicket !== 'object') {
        throw new Error('AI priority details could not be loaded right now.');
    }

    const mergedTicket = {
        ...(ticket || {}),
        ...fetchedTicket
    };

    ticketAiDetailsCache.set(ticketId, mergedTicket);
    return mergedTicket;
}

function hasPlanInput(ticket) {
    const title = String(ticket?.title || ticket?.subject || '').trim();
    const description = String(ticket?.description || ticket?.descriptionPreview || '').trim();
    return Boolean(title && description);
}

async function resolveFullTicketForAgenticPlan(ticket) {
    const baseTicket = ticket || {};

    if (hasPlanInput(baseTicket)) {
        return baseTicket;
    }

    const ticketId = resolveTicketId(baseTicket);
    if (!ticketId) {
        return baseTicket;
    }

    if (ticketAiDetailsCache.has(ticketId)) {
        const cachedTicket = {
            ...baseTicket,
            ...ticketAiDetailsCache.get(ticketId)
        };
        if (hasPlanInput(cachedTicket)) {
            return cachedTicket;
        }
    }

    const response = await TicketService.getTicketById(ticketId);
    const fetchedTicket = response?.data?.ticket || response?.data || response?.ticket || response;

    if (!fetchedTicket || typeof fetchedTicket !== 'object') {
        return baseTicket;
    }

    const mergedTicket = {
        ...baseTicket,
        ...fetchedTicket
    };
    ticketAiDetailsCache.set(ticketId, mergedTicket);
    return mergedTicket;
}

function formatBooleanText(value) {
    return value === true ? 'Yes' : 'No';
}

function safePlanText(value) {
    if (value === null || value === undefined || value === '') {
        return '--';
    }
    return UI.escapeHTML(String(value));
}

function hasManualReviewStep(steps) {
    const stepList = Array.isArray(steps) ? steps : [];
    return stepList.some((step) => {
        const actionKey = String(step?.actionKey || step?.action_key || '').trim().toUpperCase();
        return actionKey === 'MANUAL_REVIEW_REQUIRED';
    });
}

function resolveCurrentActor() {
    const currentUser = AuthService.getCurrentUser?.() || AuthService.getUser?.() || {};
    const userId =
        currentUser?.id ??
        currentUser?.userId ??
        currentUser?.user_id ??
        currentUser?.workflowUserId ??
        null;
    const role =
        currentUser?.technicianLevel ??
        currentUser?.level ??
        currentUser?.role ??
        (Array.isArray(currentUser?.roles) ? currentUser.roles[0] : null) ??
        null;

    return {
        userId: userId !== null && userId !== undefined ? String(userId) : null,
        role: role ? String(role).toUpperCase() : null
    };
}

function normalizePlanResponse(planPayload) {
    const rawPlan = planPayload?.rawPlan && typeof planPayload.rawPlan === 'object' ? planPayload.rawPlan : {};
    const safePlan = planPayload?.safePlan && typeof planPayload.safePlan === 'object' ? planPayload.safePlan : {};
    const planRecord = planPayload?.plan && typeof planPayload.plan === 'object' ? planPayload.plan : null;
    const persistedSafePlan = planRecord?.safe_plan && typeof planRecord.safe_plan === 'object'
        ? planRecord.safe_plan
        : {};
    const displayPlan = Object.keys(safePlan).length
        ? safePlan
        : (Object.keys(persistedSafePlan).length ? persistedSafePlan : rawPlan);
    const execution = planPayload?.execution && typeof planPayload.execution === 'object' ? planPayload.execution : null;
    const executions = Array.isArray(planPayload?.executions) ? planPayload.executions : [];
    const latestExecution = execution || executions[0] || null;
    const singleTask = planPayload?.task && typeof planPayload.task === 'object' ? planPayload.task : null;
    const tasks = Array.isArray(planPayload?.tasks) ? planPayload.tasks : [];
    const latestTask = singleTask || tasks[0] || null;

    return {
        rawPlan,
        safePlan,
        planRecord,
        displayPlan,
        latestExecution,
        latestTask,
        tasks
    };
}

function renderAgenticPlan(planPayload) {
    const { rawPlan, displayPlan, planRecord, latestExecution, latestTask, tasks } = normalizePlanResponse(planPayload);
    const plan = Object.keys(displayPlan).length ? displayPlan : rawPlan;
    const planId = planRecord?.id || '--';
    const planStatus = planRecord?.status || 'PENDING_APPROVAL';
    const normalizedPlanStatus = String(planStatus || '').toUpperCase();
    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    const executionAvailable = plan?.executionAvailable === true || planRecord?.execution_available === true;
    const resolvedDeviceId = String(
        plan?.affectedDeviceId ||
        plan?.affected_device_id ||
        planRecord?.safe_plan?.affectedDeviceId ||
        planRecord?.safe_plan?.affected_device_id ||
        plan?.ticketContext?.affectedDeviceId ||
        plan?.ticketContext?.affected_device_id ||
        planRecord?.safe_plan?.ticketContext?.affectedDeviceId ||
        planRecord?.safe_plan?.ticketContext?.affected_device_id ||
        ''
    ).trim();
    const hasLinkedDevice = Boolean(resolvedDeviceId);
    const hasManualReview = hasManualReviewStep(steps);
    const executionBlockedReason = plan?.executionBlockedReason || planRecord?.execution_blocked_reason || '--';
    const riskLevel = plan?.riskLevel || planRecord?.risk_level || '--';
    const requiresApproval = plan?.requiresApproval === true || planRecord?.requires_approval === true;
    const showPlanActions = normalizedPlanStatus === 'PENDING_APPROVAL' && planRecord?.id;
    const showMockExecutionAction = normalizedPlanStatus === 'APPROVED' && planRecord?.id;
    const showQueueTaskAction =
        normalizedPlanStatus === 'APPROVED' &&
        executionAvailable &&
        hasLinkedDevice &&
        !hasManualReview &&
        planRecord?.id;
    const executionSteps = Array.isArray(latestExecution?.steps) ? latestExecution.steps : [];
    const taskSteps = Array.isArray(latestTask?.steps) ? latestTask.steps : [];
    const executionStepsHtml = executionSteps.length
        ? executionSteps.map((step) => `
            <li class="list-group-item">
                <div class="d-flex justify-content-between flex-wrap gap-2">
                    <span class="fw-semibold">Step ${safePlanText(step?.step_order ?? step?.stepOrder ?? '--')}</span>
                    <span class="badge bg-primary-subtle text-primary">${safePlanText(step?.action_key ?? step?.actionKey ?? '--')}</span>
                </div>
                <div class="small mt-2 text-muted">Status: ${safePlanText(step?.status || '--')}</div>
                <div class="small mt-2">${safePlanText(step?.output || '--')}</div>
            </li>
        `).join('')
        : `<li class="list-group-item text-muted small">No mock execution steps are available.</li>`;

    const taskStepsHtml = taskSteps.length
        ? taskSteps.map((step) => `
            <li class="list-group-item">
                <div class="d-flex justify-content-between flex-wrap gap-2">
                    <span class="fw-semibold">Step ${safePlanText(step?.step_order ?? step?.stepOrder ?? '--')}</span>
                    <span class="badge bg-secondary-subtle text-secondary">${safePlanText(step?.action_key ?? step?.actionKey ?? '--')}</span>
                </div>
                <div class="small mt-2 text-muted">Status: ${safePlanText(step?.status || '--')}</div>
                <div class="small mt-2">${safePlanText(step?.description || '--')}</div>
            </li>
        `).join('')
        : `<li class="list-group-item text-muted small">No agent task steps are available.</li>`;

    const stepsHtml = steps.length
        ? steps.map((step) => {
            const params = step?.params && typeof step.params === 'object' ? step.params : {};
            const softwareName = params?.softwareName ? safePlanText(params.softwareName) : null;
            const softwareKey = params?.softwareKey ? safePlanText(params.softwareKey) : null;
            const softwareDetails = softwareName || softwareKey
                ? `<div class="small mt-1 text-muted">Software: ${softwareName || softwareKey}${softwareName && softwareKey ? ` (${softwareKey})` : ''}</div>`
                : '';

            return `
            <li class="list-group-item">
                <div class="d-flex justify-content-between flex-wrap gap-2">
                    <span class="fw-semibold">Step ${safePlanText(step?.stepOrder ?? '--')}</span>
                    <span class="badge bg-secondary-subtle text-secondary">${safePlanText(step?.actionKey || '--')}</span>
                </div>
                <div class="small mt-2">${safePlanText(step?.description || '--')}</div>
                ${softwareDetails}
            </li>
        `;
        }).join('')
        : `<li class="list-group-item text-muted small">No remediation steps were generated.</li>`;

    return `
        <div class="card border-success-subtle ai-plan-card">
            <div class="card-header bg-white">
                <h6 class="mb-0">AI Remediation Plan</h6>
            </div>
            <div class="card-body">
                <div class="row g-3 mb-3">
                    <div class="col-md-6">
                        <div class="text-muted small">Plan ID</div>
                        <div class="fw-semibold">${safePlanText(planId)}</div>
                    </div>
                    <div class="col-md-3">
                        <div class="text-muted small">Plan Status</div>
                        <div class="fw-semibold">${safePlanText(planStatus)}</div>
                    </div>
                    <div class="col-md-3">
                        <div class="text-muted small">Summary</div>
                        <div>${safePlanText(plan?.summary || '--')}</div>
                    </div>
                    <div class="col-md-3">
                        <div class="text-muted small">Risk Level</div>
                        <div class="fw-semibold">${safePlanText(riskLevel)}</div>
                    </div>
                    <div class="col-md-3">
                        <div class="text-muted small">Requires Approval</div>
                        <div class="fw-semibold">${safePlanText(formatBooleanText(requiresApproval))}</div>
                    </div>
                    <div class="col-md-6">
                        <div class="text-muted small">Execution Available</div>
                        <div class="fw-semibold">${safePlanText(formatBooleanText(executionAvailable))}</div>
                    </div>
                    ${executionAvailable ? '' : `
                        <div class="col-md-6">
                            <div class="text-muted small">Execution Blocked Reason</div>
                            <div>${safePlanText(executionBlockedReason)}</div>
                        </div>
                    `}
                </div>
                <div class="alert alert-warning small mb-3" role="alert">
                    This plan is generated for technician review only. No actions are executed in this phase.
                </div>
                <div class="text-muted small mb-2">Steps</div>
                <ul class="list-group list-group-flush border rounded">
                    ${stepsHtml}
                </ul>
                ${showPlanActions ? `
                    <div class="mt-3 d-flex gap-2 flex-wrap">
                        <button
                            type="button"
                            class="btn btn-sm ai-action-btn ai-action-btn-safe"
                            data-agentic-plan-approve="true"
                            data-plan-id="${UI.escapeHTML(String(planRecord.id))}"
                        >
                            <i class="bi bi-check2-circle me-1"></i>Approve AI Plan
                        </button>
                        <button
                            type="button"
                            class="btn btn-sm ai-action-btn ai-action-btn-danger"
                            data-agentic-plan-reject="true"
                            data-plan-id="${UI.escapeHTML(String(planRecord.id))}"
                        >
                            <i class="bi bi-x-octagon me-1"></i>Reject AI Plan
                        </button>
                    </div>
                ` : ''}
                ${showMockExecutionAction ? `
                    <div class="mt-3 d-flex gap-2 flex-wrap">
                        <button
                            type="button"
                            class="btn btn-sm ai-action-btn ai-action-btn-secondary"
                            data-agentic-plan-mock-execute="true"
                            data-plan-id="${UI.escapeHTML(String(planRecord.id))}"
                        >
                            <i class="bi bi-bezier2 me-1"></i>Run Mock Execution
                        </button>
                    </div>
                ` : ''}
                ${showQueueTaskAction ? `
                    <div class="mt-3 d-flex gap-2 flex-wrap">
                        <button
                            type="button"
                            class="btn btn-sm ai-action-btn ai-action-btn-operational"
                            data-agentic-plan-queue-task="true"
                            data-plan-id="${safePlanText(planRecord.id)}"
                        >
                            <i class="bi bi-cpu-fill me-1"></i>Queue Agent Task
                        </button>
                    </div>
                ` : ''}
                ${hasManualReview ? `
                    <div class="alert alert-secondary small mt-3 mb-0" role="alert">
                        This plan requires manual review and cannot be queued for endpoint execution.
                    </div>
                ` : ''}
                ${latestTask ? `
                    <div class="mt-3 ai-status-card">
                        <div class="text-muted small mb-2">Agent Task Queue</div>
                        <div class="row g-3 mb-3">
                            <div class="col-md-4">
                                <div class="text-muted small">Task ID</div>
                                <div class="fw-semibold">${safePlanText(latestTask?.id || '--')}</div>
                            </div>
                            <div class="col-md-4">
                                <div class="text-muted small">Device ID</div>
                                <div class="fw-semibold">${safePlanText(latestTask?.device_id || latestTask?.deviceId || resolvedDeviceId || '--')}</div>
                            </div>
                            <div class="col-md-4">
                                <div class="text-muted small">Task Status</div>
                                <div class="fw-semibold">${safePlanText(latestTask?.status || '--')}</div>
                            </div>
                        </div>
                        <ul class="list-group list-group-flush border rounded">
                            ${taskStepsHtml}
                        </ul>
                        <div class="alert alert-warning small mt-3 mb-0" role="alert">
                            Task queued for future Endpoint Agent. No real execution has been performed.
                        </div>
                    </div>
                ` : ''}
                ${tasks.length > 1 ? `
                    <div class="small text-muted mt-2">
                        Additional queued tasks for this plan: ${safePlanText(tasks.length - 1)}
                    </div>
                ` : ''}
                ${latestExecution ? `
                    <div class="mt-3 ai-execution-card">
                        <div class="text-muted small mb-2">Mock Execution</div>
                        <div class="row g-3 mb-3">
                            <div class="col-md-6">
                                <div class="text-muted small">Execution ID</div>
                                <div class="fw-semibold">${safePlanText(latestExecution?.id || '--')}</div>
                            </div>
                            <div class="col-md-3">
                                <div class="text-muted small">Execution Status</div>
                                <div class="fw-semibold">${safePlanText(latestExecution?.status || '--')}</div>
                            </div>
                            <div class="col-md-3">
                                <div class="text-muted small">Completed At</div>
                                <div class="fw-semibold">${safePlanText(formatDateTime(latestExecution?.completed_at || latestExecution?.completedAt))}</div>
                            </div>
                        </div>
                        <ul class="list-group list-group-flush border rounded">
                            ${executionStepsHtml}
                        </ul>
                        <div class="alert alert-info small mt-3 mb-0" role="alert">
                            Mock execution only. No real device actions were performed.
                        </div>
                    </div>
                ` : ''}
                <div class="mt-2" data-agentic-plan-action-message="true"></div>
            </div>
        </div>
    `;
}

function resolveAgenticPlanErrorMessage(error) {
    if (error?.code === 'AI_MODEL_UNAVAILABLE') {
        return 'AI model is unavailable. Please make sure Ollama and gemma3:4b are running.';
    }

    if (error?.code === 'AGENTIC_AI_SERVICE_UNAVAILABLE') {
        return 'Agentic AI Service is unavailable. Please make sure the service is running.';
    }

    if (error?.code === 'VALIDATION_ERROR') {
        return error.message || 'Ticket title and description are required to generate an AI fix plan.';
    }

    if (error?.code === 'INVALID_PLAN_STATUS_TRANSITION') {
        return error.message || 'This plan cannot be changed from its current status.';
    }

    if (error?.code === 'PLAN_NOT_FOUND') {
        return error.message || 'The selected remediation plan no longer exists.';
    }

    if (error?.code === 'PLAN_NOT_APPROVED' || error?.code === 'EXECUTION_CONFLICT') {
        return error.message || 'This plan cannot be mock-executed from its current status.';
    }

    if (
        error?.code === 'TASK_QUEUE_CONFLICT' ||
        error?.code === 'TASK_STATUS_CONFLICT' ||
        error?.code === 'PLAN_REQUIRES_MANUAL_REVIEW'
    ) {
        return error.message || 'This plan cannot be queued for endpoint task execution right now.';
    }

    if (error?.code === 'TASK_NOT_FOUND') {
        return error.message || 'The selected agent task was not found.';
    }

    return error?.message || 'Unable to generate AI fix plan right now.';
}

function bindAgenticPlanDecisionHandlers(container) {
    if (!container) return;

    const approveButton = container.querySelector('[data-agentic-plan-approve=\"true\"]');
    const rejectButton = container.querySelector('[data-agentic-plan-reject=\"true\"]');
    const mockExecuteButton = container.querySelector('[data-agentic-plan-mock-execute=\"true\"]');
    const queueTaskButton = container.querySelector('[data-agentic-plan-queue-task=\"true\"]');
    const messageContainer = container.querySelector('[data-agentic-plan-action-message=\"true\"]');
    const planId =
        approveButton?.dataset?.planId ||
        rejectButton?.dataset?.planId ||
        mockExecuteButton?.dataset?.planId ||
        queueTaskButton?.dataset?.planId ||
        null;

    if (!planId) return;

    const setButtonsState = (isLoading, loadingLabel) => {
        if (approveButton) {
            approveButton.disabled = isLoading;
            approveButton.innerHTML = isLoading && loadingLabel === 'approve'
                ? '<span class=\"spinner-border spinner-border-sm me-1\" role=\"status\"></span>Approving...'
                : '<i class=\"bi bi-check2-circle me-1\"></i>Approve AI Plan';
        }

        if (rejectButton) {
            rejectButton.disabled = isLoading;
            rejectButton.innerHTML = isLoading && loadingLabel === 'reject'
                ? '<span class=\"spinner-border spinner-border-sm me-1\" role=\"status\"></span>Rejecting...'
                : '<i class=\"bi bi-x-octagon me-1\"></i>Reject AI Plan';
        }

        if (mockExecuteButton) {
            mockExecuteButton.disabled = isLoading;
            mockExecuteButton.innerHTML = isLoading && loadingLabel === 'mock'
                ? '<span class=\"spinner-border spinner-border-sm me-1\" role=\"status\"></span>Running mock execution...'
                : '<i class=\"bi bi-bezier2 me-1\"></i>Run Mock Execution';
        }

        if (queueTaskButton) {
            queueTaskButton.disabled = isLoading;
            queueTaskButton.innerHTML = isLoading && loadingLabel === 'queue'
                ? '<span class=\"spinner-border spinner-border-sm me-1\" role=\"status\"></span>Queueing task...'
                : '<i class=\"bi bi-cpu-fill me-1\"></i>Queue Agent Task';
        }
    };

    if (approveButton) {
        approveButton.addEventListener('click', async () => {
            setButtonsState(true, 'approve');
            try {
                const responsePayload = await AgenticAiService.approveRemediationPlan(planId, resolveCurrentActor());
                container.innerHTML = renderAgenticPlan(responsePayload);
                bindAgenticPlanDecisionHandlers(container);
                UI.success(responsePayload?.message || 'Plan approved. Execution is not implemented yet.');
            } catch (error) {
                if (messageContainer) {
                    messageContainer.innerHTML = `
                        <div class=\"alert alert-danger py-2 px-3 mb-0\" role=\"alert\">
                            ${UI.escapeHTML(resolveAgenticPlanErrorMessage(error))}
                        </div>
                    `;
                }
            } finally {
                setButtonsState(false, '');
            }
        });
    }

    if (rejectButton) {
        rejectButton.addEventListener('click', async () => {
            const reasonInput = window.prompt('Optional rejection reason:', '');
            if (reasonInput === null) {
                return;
            }

            setButtonsState(true, 'reject');
            try {
                const responsePayload = await AgenticAiService.rejectRemediationPlan(
                    planId,
                    resolveCurrentActor(),
                    reasonInput
                );
                container.innerHTML = renderAgenticPlan(responsePayload);
                bindAgenticPlanDecisionHandlers(container);
                UI.success(responsePayload?.message || 'Plan rejected. Continue with the normal manual workflow.');
            } catch (error) {
                if (messageContainer) {
                    messageContainer.innerHTML = `
                        <div class=\"alert alert-danger py-2 px-3 mb-0\" role=\"alert\">
                            ${UI.escapeHTML(resolveAgenticPlanErrorMessage(error))}
                        </div>
                    `;
                }
            } finally {
                setButtonsState(false, '');
            }
        });
    }

    if (mockExecuteButton) {
        mockExecuteButton.addEventListener('click', async () => {
            setButtonsState(true, 'mock');
            try {
                const executionPayload = await AgenticAiService.startMockExecution(planId, resolveCurrentActor());
                const planPayload = await AgenticAiService.getRemediationPlanById(planId);
                const mergedPayload = {
                    ...planPayload,
                    execution: executionPayload?.execution || null
                };

                container.innerHTML = renderAgenticPlan(mergedPayload);
                bindAgenticPlanDecisionHandlers(container);
                UI.success(executionPayload?.message || 'Mock execution completed. No real machine actions were performed.');
            } catch (error) {
                if (messageContainer) {
                    messageContainer.innerHTML = `
                        <div class=\"alert alert-danger py-2 px-3 mb-0\" role=\"alert\">
                            ${UI.escapeHTML(resolveAgenticPlanErrorMessage(error))}
                        </div>
                    `;
                }
            } finally {
                setButtonsState(false, '');
            }
        });
    }

    if (queueTaskButton) {
        queueTaskButton.addEventListener('click', async () => {
            setButtonsState(true, 'queue');
            try {
                const queuePayload = await AgenticAiService.queueAgentTaskFromPlan(planId, resolveCurrentActor());
                const [planPayload, tasksPayload] = await Promise.all([
                    AgenticAiService.getRemediationPlanById(planId),
                    AgenticAiService.listAgentTasksByPlan(planId)
                ]);

                const mergedPayload = {
                    ...planPayload,
                    task: queuePayload?.task || null,
                    tasks: Array.isArray(tasksPayload?.tasks) ? tasksPayload.tasks : []
                };

                container.innerHTML = renderAgenticPlan(mergedPayload);
                bindAgenticPlanDecisionHandlers(container);
                UI.success(queuePayload?.message || 'Task queued for future Endpoint Agent. No real execution has been performed.');
            } catch (error) {
                if (messageContainer) {
                    messageContainer.innerHTML = `
                        <div class=\"alert alert-danger py-2 px-3 mb-0\" role=\"alert\">
                            ${UI.escapeHTML(resolveAgenticPlanErrorMessage(error))}
                        </div>
                    `;
                }
            } finally {
                setButtonsState(false, '');
            }
        });
    }
}

function renderTicketAiInsightControls(ticket) {
    const aiInsightContainer = document.getElementById('ticketAiPriorityInsight');
    if (!aiInsightContainer) return;

    const currentUserRole = normalizeRole(resolveCurrentUserRole());
    const buttonLabel = getAiButtonLabel(currentUserRole);

    if (isRequesterRole(currentUserRole) || !isOperationalRole(currentUserRole)) {
        aiInsightContainer.innerHTML = '';
        return;
    }

    aiInsightContainer.innerHTML = `
        <div class="card mb-3 border-0 bg-light ai-status-card">
            <div class="card-body">
                <button type="button" class="btn btn-sm ai-action-btn ai-action-btn-secondary" id="ticketAiInsightBtn">
                    <i class="bi bi-cpu me-1"></i>${UI.escapeHTML(buttonLabel)}
                </button>
                <div class="mt-3 d-none" id="ticketAiInsightDetails"></div>
            </div>
        </div>
        <div class="card mb-3 border-0 bg-light ai-status-card">
            <div class="card-body">
                <button type="button" class="btn btn-sm ai-action-btn ai-action-btn-primary" id="ticketAgenticPlanBtn">
                    <i class="bi bi-wrench-adjustable-circle me-1"></i>Generate AI Fix Plan
                </button>
                <div class="mt-3 d-none" id="ticketAgenticPlanDetails"></div>
            </div>
        </div>
    `;

    const aiInsightButton = document.getElementById('ticketAiInsightBtn');
    const aiInsightDetailsContainer = document.getElementById('ticketAiInsightDetails');
    if (!aiInsightButton || !aiInsightDetailsContainer) return;

    aiInsightButton.addEventListener('click', async () => {
        if (aiInsightDetailsContainer.dataset.loaded === 'true') {
            aiInsightDetailsContainer.classList.remove('d-none');
            return;
        }

        aiInsightButton.disabled = true;
        aiInsightButton.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status"></span>Loading...';

        try {
            const enrichedTicket = await resolveFullTicketForAiDetails(ticket);
            aiInsightDetailsContainer.innerHTML = renderAiPriorityInsight({
                ticket: enrichedTicket,
                currentUserRole
            });
            aiInsightDetailsContainer.dataset.loaded = 'true';
            aiInsightDetailsContainer.classList.remove('d-none');
        } catch (error) {
            console.error('[Tickets] Failed to load AI priority details:', error);
            aiInsightDetailsContainer.innerHTML = `
                <div class="alert alert-warning mb-0" role="alert">
                    AI priority details could not be loaded right now.
                </div>
            `;
            aiInsightDetailsContainer.classList.remove('d-none');
        } finally {
            aiInsightButton.disabled = false;
            aiInsightButton.innerHTML = `<i class="bi bi-cpu me-1"></i>${UI.escapeHTML(buttonLabel)}`;
        }
    });

    const agenticPlanButton = document.getElementById('ticketAgenticPlanBtn');
    const agenticPlanDetailsContainer = document.getElementById('ticketAgenticPlanDetails');
    if (!agenticPlanButton || !agenticPlanDetailsContainer) return;

    agenticPlanButton.addEventListener('click', async () => {
        if (agenticPlanDetailsContainer.dataset.loaded === 'true') {
            agenticPlanDetailsContainer.classList.remove('d-none');
            return;
        }

        agenticPlanButton.disabled = true;
        agenticPlanButton.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status"></span>Generating AI fix plan...';

        try {
            const enrichedTicket = await resolveFullTicketForAgenticPlan(ticket);
            if (!hasPlanInput(enrichedTicket)) {
                const validationError = new Error('Ticket title and description are required to generate an AI fix plan.');
                validationError.code = 'VALIDATION_ERROR';
                throw validationError;
            }

            const planPayload = await AgenticAiService.generateRemediationPlan(enrichedTicket, resolveCurrentActor());
            agenticPlanDetailsContainer.innerHTML = renderAgenticPlan(planPayload);
            bindAgenticPlanDecisionHandlers(agenticPlanDetailsContainer);
            agenticPlanDetailsContainer.dataset.loaded = 'true';
            agenticPlanDetailsContainer.classList.remove('d-none');
        } catch (error) {
            console.error('[Tickets] Failed to generate AI remediation plan:', error);
            agenticPlanDetailsContainer.innerHTML = `
                <div class="alert alert-danger mb-0" role="alert">
                    ${UI.escapeHTML(resolveAgenticPlanErrorMessage(error))}
                </div>
            `;
            agenticPlanDetailsContainer.classList.remove('d-none');
        } finally {
            agenticPlanButton.disabled = false;
            agenticPlanButton.innerHTML = '<i class="bi bi-wrench-adjustable-circle me-1"></i>Generate AI Fix Plan';
        }
    });
}

/**
 * Load AI recommendations for ticket
 */
async function loadAIRecommendations(ticketData, currentUserRole = 'REQUESTER') {
    const container = document.getElementById('aiRecommendationsList');
    const section = document.getElementById('aiRecommendationsSection');
    
    if (!container) return;

    const normalizedRole = String(currentUserRole || '').toUpperCase();
    if (normalizedRole === 'REQUESTER' || normalizedRole === 'STUDENT' || normalizedRole === 'DOCTOR') {
        UI.toggle(section, false);
        return;
    }

    const ticket = ticketData || {};
    const rawExplanation = ticket.ai_explanation ?? ticket.explanation ?? null;

    let explanations = [];
    if (Array.isArray(rawExplanation)) {
        explanations = rawExplanation.filter(Boolean).map((line) => String(line));
    } else if (typeof rawExplanation === 'string' && rawExplanation.trim()) {
        try {
            const parsed = JSON.parse(rawExplanation);
            if (Array.isArray(parsed)) {
                explanations = parsed.filter(Boolean).map((line) => String(line));
            } else {
                explanations = [rawExplanation.trim()];
            }
        } catch {
            explanations = [rawExplanation.trim()];
        }
    }

    if (explanations.length === 0) {
        UI.toggle(section, false);
        return;
    }

    UI.toggle(section, true);
    container.innerHTML = explanations
        .map((line) => `<li>${UI.escapeHTML(line)}</li>`)
        .join('');
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
        console.error('Failed to load workflows:', error);
        if (container) {
            container.innerHTML = `
                <div class="alert alert-danger mb-0" role="alert">
                    Unable to load workflows from backend right now.
                </div>
            `;
        }
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
    isAiHelpStreaming = false;
    isEnhancementStreaming = false;
    selectedCreateTicketEndpointDeviceId = DEVICE_OPTION_OTHER_NOT_LISTED;
    selectedCreateTicketEndpointDevice = null;

    const modal = document.getElementById('createTicketModal');
    const form = document.getElementById('createTicketForm');
    
    // Reset form
    UI.resetFormValidation(form);
    form?.reset();
    const affectedDeviceSelect = document.getElementById('newTicketAffectedDevice');
    if (affectedDeviceSelect) {
        affectedDeviceSelect.innerHTML = `
            <option value="${DEVICE_OPTION_MY_CURRENT}" selected>Loading your registered devices...</option>
            <option value="${DEVICE_OPTION_OTHER_NOT_LISTED}">Other / Not listed</option>
        `;
        affectedDeviceSelect.value = DEVICE_OPTION_MY_CURRENT;
        syncSelectedEndpointDeviceState(DEVICE_OPTION_MY_CURRENT);
    }
    const osTypeSelect = document.getElementById('newTicketOsType');
    if (osTypeSelect) osTypeSelect.value = 'WINDOWS';
    const issueScopeSelect = document.getElementById('newTicketIssueScope');
    if (issueScopeSelect) issueScopeSelect.value = 'MY_DEVICE';
    const remoteConsentCheckbox = document.getElementById('newTicketRemoteSupportConsent');
    if (remoteConsentCheckbox) remoteConsentCheckbox.checked = false;
    const mapPicker = document.getElementById('mapPicker');
    mapPicker?.classList.remove('d-none');
    const locationStatus = document.getElementById('locationStatus');
    locationStatus?.classList.add('d-none');
    const locationError = document.getElementById('locationError');
    if (locationError) locationError.style.display = 'none';
    const aiHelpOutput = document.getElementById('aiSuggestionsText');
    if (aiHelpOutput) {
        aiHelpOutput.textContent = '';
        aiHelpOutput.classList.add('ai-stream-output');
    }
    const aiHelpStatus = document.getElementById('aiHelpStreamStatus');
    if (aiHelpStatus) {
        aiHelpStatus.textContent = '';
    }
    document.getElementById('aiHelpError')?.classList.add('d-none');
    document.getElementById('aiHelpContent')?.classList.remove('d-none');
    const enhanceStatus = document.getElementById('enhanceDescriptionStatus');
    if (enhanceStatus) {
        enhanceStatus.textContent = '';
        enhanceStatus.classList.add('d-none');
        enhanceStatus.classList.remove('text-danger');
    }
    document.getElementById('enhancedDescriptionPreviewWrap')?.classList.add('d-none');
    const enhancedPreviewText = document.getElementById('enhancedDescriptionPreviewText');
    if (enhancedPreviewText) {
        enhancedPreviewText.textContent = '';
    }
    setCreateTicketDeviceLoadMessage('Loading your registered devices...', 'muted');
    setRegisterEndpointDeviceMessage('', 'muted');
    hideRegisterEndpointDevicePanel();
    prepareRegisterEndpointDevicePanelDefaults();
    void loadRegisteredEndpointDevices();
    
    const modalInstance = new bootstrap.Modal(modal);
    modalInstance.show();
    
    // Initialize map after modal is shown
    modal.addEventListener('shown.bs.modal', function() {
        initializeMap();
    }, { once: true });
}

/**
 * Initialize Leaflet map
 */
function initializeMap() {
    const mapContainer = document.getElementById('mapContainer');
    
    if (!mapContainer) return;
    
    // If map already exists, remove it
    if (state.map) {
        state.map.remove();
        state.map = null;
        state.mapMarker = null;
    }
    
    // Create map centered on a default location (Cairo, Egypt as example)
    state.map = L.map('mapContainer').setView([30.0444, 31.2357], 13);
    
    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(state.map);
    
    // Add click handler to map
    state.map.on('click', function(e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        updateLocationFromMap(lat, lng);
    });
    
    // Force map to resize properly
    setTimeout(() => {
        state.map.invalidateSize();
    }, 100);
}

/**
 * Update location from map click
 */
function updateLocationFromMap(lat, lng) {
    // Update hidden inputs
    document.getElementById('newTicketLatitude').value = lat;
    document.getElementById('newTicketLongitude').value = lng;
    
    // Update manual inputs
    document.getElementById('manualLatitude').value = lat.toFixed(6);
    document.getElementById('manualLongitude').value = lng.toFixed(6);
    
    // Update marker on map
    updateMapMarker(lat, lng);
    
    // Show success message
    const statusDiv = document.getElementById('locationStatus');
    const statusText = document.getElementById('locationStatusText');
    statusDiv.classList.remove('d-none', 'alert-danger', 'alert-info');
    statusDiv.classList.add('alert-success');
    statusText.innerHTML = `<strong>Location set!</strong> Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`;
}

/**
 * Update or create map marker
 */
function updateMapMarker(lat, lng) {
    if (!state.map) return;
    
    // Remove existing marker if present
    if (state.mapMarker) {
        state.map.removeLayer(state.mapMarker);
    }
    
    // Add new marker
    state.mapMarker = L.marker([lat, lng], {
        icon: L.icon({
            iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
            iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
            shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
        })
    }).addTo(state.map);
    
    // Center map on marker
    state.map.setView([lat, lng], 13);
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
    const resolutionInput = document.getElementById('updateResolutionSummary');
    
    if (titleInput) titleInput.value = ticket.title || '';
    if (descriptionInput) descriptionInput.value = ticket.description || '';
    if (typeInput) typeInput.value = ticket.type_of_request || ticket.type || 'INCIDENT';
    if (statusInput) statusInput.value = ticket.status || 'OPEN';
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
        console.error('Failed to load assignees:', error);
        select.innerHTML = '<option value="">Unassigned</option>';
    }
}

function normalizeEndpointDeviceRecord(device) {
    const source = device && typeof device === 'object' ? device : {};
    const id = String(source.id || '').trim();
    if (!id) return null;

    const deviceName = String(source.device_name || source.deviceName || 'Unnamed device').trim() || 'Unnamed device';
    const osTypeRaw = String(source.os_type || source.osType || 'UNKNOWN').trim().toUpperCase();
    const agentStatusRaw = String(source.agent_status || source.agentStatus || 'OFFLINE').trim().toUpperCase();

    return {
        id,
        deviceName,
        osType: ALLOWED_OS_TYPES.has(osTypeRaw) ? osTypeRaw : 'UNKNOWN',
        agentStatus: agentStatusRaw || 'OFFLINE'
    };
}

function inferOsTypeFromBrowser() {
    const platform = String(navigator.platform || '').toLowerCase();
    const userAgent = String(navigator.userAgent || '').toLowerCase();
    const fingerprint = `${platform} ${userAgent}`;

    if (fingerprint.includes('mac')) return 'MACOS';
    if (fingerprint.includes('win')) return 'WINDOWS';
    if (fingerprint.includes('linux')) return 'LINUX';
    return 'UNKNOWN';
}

function inferDeviceNameFromBrowser() {
    const platform = String(navigator.platform || '').trim();
    return platform ? `My ${platform} device` : 'My current device';
}

function normalizeTicketCategoryForSubmission(category) {
    const raw = String(category || '').trim();
    if (!raw) return 'OTHER';

    const normalized = raw.toUpperCase().replace(/[\s-]+/g, '_');

    if (
        normalized === 'SOFTWARE' ||
        normalized === 'SOFTWARE_APPLICATION' ||
        normalized === 'APPLICATION' ||
        normalized === 'APP'
    ) {
        return 'SOFTWARE';
    }

    if (
        normalized.includes('SOFTWARE') ||
        normalized.includes('APPLICATION') ||
        normalized.includes('APP')
    ) {
        return 'SOFTWARE';
    }

    return normalized;
}

function getRegisteredEndpointDeviceById(deviceId) {
    const normalizedDeviceId = String(deviceId || '').trim();
    if (!normalizedDeviceId) return null;
    return createTicketEndpointDevices.find((device) => device.id === normalizedDeviceId) || null;
}

function getSelectedEndpointDevice() {
    const selectedValue = document.getElementById('newTicketAffectedDevice')?.value || '';
    return getRegisteredEndpointDeviceById(selectedValue);
}

function syncSelectedEndpointDeviceState(selectedValue = null) {
    const resolvedValue = String(
        selectedValue ?? document.getElementById('newTicketAffectedDevice')?.value ?? DEVICE_OPTION_OTHER_NOT_LISTED
    ).trim();

    selectedCreateTicketEndpointDeviceId = resolvedValue || DEVICE_OPTION_OTHER_NOT_LISTED;
    selectedCreateTicketEndpointDevice = getRegisteredEndpointDeviceById(selectedCreateTicketEndpointDeviceId);
}

function resolveSelectedDeviceLabel() {
    const selectedValue = document.getElementById('newTicketAffectedDevice')?.value || DEVICE_OPTION_OTHER_NOT_LISTED;
    const selectedRegisteredDevice = getRegisteredEndpointDeviceById(selectedValue);

    if (selectedRegisteredDevice) {
        return selectedRegisteredDevice.deviceName;
    }

    return DEVICE_NAME_BY_SELECTION[selectedValue] || 'Unknown';
}

function setCreateTicketDeviceLoadMessage(message, tone = 'muted') {
    const loadMessage = document.getElementById('newTicketDeviceLoadMessage');
    if (!loadMessage) return;

    loadMessage.textContent = message || '';
    loadMessage.classList.remove('text-muted', 'text-danger', 'text-success');

    if (tone === 'danger') {
        loadMessage.classList.add('text-danger');
    } else if (tone === 'success') {
        loadMessage.classList.add('text-success');
    } else {
        loadMessage.classList.add('text-muted');
    }
}

function setRegisterEndpointDeviceMessage(message, tone = 'muted') {
    const messageEl = document.getElementById('registerEndpointDeviceMessage');
    if (!messageEl) return;

    messageEl.textContent = message || '';
    messageEl.classList.remove('text-muted', 'text-danger', 'text-success');

    if (tone === 'danger') {
        messageEl.classList.add('text-danger');
    } else if (tone === 'success') {
        messageEl.classList.add('text-success');
    } else {
        messageEl.classList.add('text-muted');
    }
}

function renderEndpointDeviceOptions(selectedDeviceId = null) {
    const select = document.getElementById('newTicketAffectedDevice');
    if (!select) return;

    select.innerHTML = '';

    if (createTicketEndpointDevices.length === 0) {
        const noDevicesOption = document.createElement('option');
        noDevicesOption.value = DEVICE_OPTION_OTHER_NOT_LISTED;
        noDevicesOption.textContent = 'Other / Not listed';
        select.appendChild(noDevicesOption);
        select.value = DEVICE_OPTION_OTHER_NOT_LISTED;
        syncSelectedEndpointDeviceState(DEVICE_OPTION_OTHER_NOT_LISTED);
        return;
    }

    createTicketEndpointDevices.forEach((device) => {
        const option = document.createElement('option');
        option.value = device.id;
        option.textContent = `${device.deviceName} - ${device.osType} - ${device.agentStatus}`;
        select.appendChild(option);
    });

    const otherOption = document.createElement('option');
    otherOption.value = DEVICE_OPTION_OTHER_NOT_LISTED;
    otherOption.textContent = 'Other / Not listed';
    select.appendChild(otherOption);

    const preferredId = selectedDeviceId && getRegisteredEndpointDeviceById(selectedDeviceId)
        ? selectedDeviceId
        : createTicketEndpointDevices[0]?.id;

    select.value = preferredId || DEVICE_OPTION_OTHER_NOT_LISTED;
    syncSelectedEndpointDeviceState(select.value);
}

function prepareRegisterEndpointDevicePanelDefaults() {
    const osTypeInput = document.getElementById('registerEndpointDeviceOsType');
    const deviceNameInput = document.getElementById('registerEndpointDeviceName');
    if (osTypeInput) osTypeInput.value = inferOsTypeFromBrowser();
    if (deviceNameInput) deviceNameInput.value = inferDeviceNameFromBrowser();
}

function hideRegisterEndpointDevicePanel() {
    const panel = document.getElementById('registerEndpointDevicePanel');
    if (!panel) return;
    panel.classList.add('d-none');
}

function toggleRegisterEndpointDevicePanel() {
    const panel = document.getElementById('registerEndpointDevicePanel');
    if (!panel) return;

    const shouldShow = panel.classList.contains('d-none');
    if (shouldShow) {
        prepareRegisterEndpointDevicePanelDefaults();
        setRegisterEndpointDeviceMessage('', 'muted');
        panel.classList.remove('d-none');
    } else {
        panel.classList.add('d-none');
    }
}

function applySelectedDeviceDefaults() {
    const selectedDevice = selectedCreateTicketEndpointDevice || getSelectedEndpointDevice();
    if (!selectedDevice) {
        return;
    }

    const osTypeSelect = document.getElementById('newTicketOsType');
    const issueScopeSelect = document.getElementById('newTicketIssueScope');

    if (osTypeSelect) {
        osTypeSelect.value = ALLOWED_OS_TYPES.has(selectedDevice.osType) ? selectedDevice.osType : 'UNKNOWN';
    }

    if (issueScopeSelect) {
        issueScopeSelect.value = 'MY_DEVICE';
    }
}

function handleAffectedDeviceSelectionChange() {
    syncSelectedEndpointDeviceState();
    applySelectedDeviceDefaults();
}

async function loadRegisteredEndpointDevices(options = {}) {
    if (createTicketDevicesLoading) {
        pendingEndpointDeviceLoadOptions = {
            ...(pendingEndpointDeviceLoadOptions || {}),
            ...(options || {})
        };
        return;
    }

    const { autoSelectDeviceId = null } = options;
    pendingEndpointDeviceLoadOptions = null;
    createTicketDevicesLoading = true;
    setCreateTicketDeviceLoadMessage('Loading your registered devices...', 'muted');

    try {
        const devices = await AgenticAiService.listMyEndpointDevices();
        createTicketEndpointDevices = devices
            .map(normalizeEndpointDeviceRecord)
            .filter((device) => Boolean(device));

        renderEndpointDeviceOptions(autoSelectDeviceId);
        applySelectedDeviceDefaults();

        if (createTicketEndpointDevices.length > 0) {
            setCreateTicketDeviceLoadMessage('', 'muted');
        } else {
            setCreateTicketDeviceLoadMessage('No registered devices found. You can still create a normal ticket.', 'muted');
        }
    } catch (error) {
        console.error('[Tickets] Failed to load endpoint devices:', error);
        createTicketEndpointDevices = [];
        renderEndpointDeviceOptions();
        setCreateTicketDeviceLoadMessage(
            'Could not load registered devices. You can still create a normal ticket.',
            'danger'
        );
    } finally {
        createTicketDevicesLoading = false;
        if (pendingEndpointDeviceLoadOptions) {
            const queuedOptions = pendingEndpointDeviceLoadOptions;
            pendingEndpointDeviceLoadOptions = null;
            void loadRegisteredEndpointDevices(queuedOptions);
        }
    }
}

async function handleRegisterEndpointDevice() {
    const nameInput = document.getElementById('registerEndpointDeviceName');
    const osTypeInput = document.getElementById('registerEndpointDeviceOsType');
    const submitBtn = document.getElementById('registerEndpointDeviceSubmitBtn');

    const deviceName = String(nameInput?.value || '').trim();
    const osTypeRaw = String(osTypeInput?.value || 'UNKNOWN').trim().toUpperCase();
    const osType = ALLOWED_OS_TYPES.has(osTypeRaw) ? osTypeRaw : 'UNKNOWN';

    if (!deviceName) {
        setRegisterEndpointDeviceMessage('Device name is required.', 'danger');
        return;
    }

    UI.setButtonLoading(submitBtn, true);
    setRegisterEndpointDeviceMessage('Registering device...', 'muted');

    try {
        const response = await AgenticAiService.registerEndpointDevice({
            deviceName,
            osType,
            agentVersion: WEB_DEVICE_REGISTRATION_VERSION
        });

        const createdDevice = normalizeEndpointDeviceRecord(response?.device || response);
        await loadRegisteredEndpointDevices({
            autoSelectDeviceId: createdDevice?.id || null
        });

        setRegisterEndpointDeviceMessage('Device registered successfully.', 'success');
        hideRegisterEndpointDevicePanel();
        UI.success('Device registered successfully.');
    } catch (error) {
        console.error('[Tickets] Device registration failed:', error);
        setRegisterEndpointDeviceMessage(error?.message || 'Could not register device right now.', 'danger');
    } finally {
        UI.setButtonLoading(submitBtn, false);
    }
}

/**
 * Handle create ticket form submission
 */
async function handleCreateTicket(e) {
    e.preventDefault();
    const form = e.target;
    
    // Custom validation for location
    const latitude = document.getElementById('newTicketLatitude').value;
    const longitude = document.getElementById('newTicketLongitude').value;
    const locationError = document.getElementById('locationError');
    
    if (!latitude || !longitude) {
        locationError.style.display = 'block';
        UI.error('Please provide a location');
        return;
    }
    
    locationError.style.display = 'none';
    
    if (!UI.validateForm(form)) return;
    
    const submitBtn = document.getElementById('submitTicketBtn');
    UI.setButtonLoading(submitBtn, true);

    // Collect form values exactly as backend expects
    const title = document.getElementById('newTicketSubject').value.trim();
    const description = document.getElementById('newTicketDescription').value.trim();
    const type_of_request = document.getElementById('newTicketType')?.value || 'INCIDENT';
    const category = normalizeTicketCategoryForSubmission(document.getElementById('newTicketCategory')?.value || 'OTHER');
    const selectedEndpointDeviceId = String(
        document.getElementById('newTicketAffectedDevice')?.value || DEVICE_OPTION_OTHER_NOT_LISTED
    ).trim();
    syncSelectedEndpointDeviceState(selectedEndpointDeviceId);
    const selectedEndpointDevice =
        selectedCreateTicketEndpointDevice &&
        selectedCreateTicketEndpointDevice.id === selectedEndpointDeviceId
            ? selectedCreateTicketEndpointDevice
            : getRegisteredEndpointDeviceById(selectedEndpointDeviceId);
    let affectedDeviceId = null;
    let affectedDeviceName = null;
    const osTypeRaw = String(document.getElementById('newTicketOsType')?.value || 'UNKNOWN').toUpperCase();
    const issueScopeRaw = String(document.getElementById('newTicketIssueScope')?.value || 'UNKNOWN').toUpperCase();
    let osType = ALLOWED_OS_TYPES.has(osTypeRaw) ? osTypeRaw : 'UNKNOWN';
    let issueScope = ALLOWED_ISSUE_SCOPES.has(issueScopeRaw) ? issueScopeRaw : 'MY_DEVICE';
    const remoteSupportConsent = document.getElementById('newTicketRemoteSupportConsent')?.checked === true;

    if (selectedEndpointDevice) {
        affectedDeviceId = selectedEndpointDevice.id;
        affectedDeviceName = selectedEndpointDevice.deviceName;
        osType = selectedEndpointDevice.osType;
        if (!ALLOWED_ISSUE_SCOPES.has(issueScope) || issueScope === 'UNKNOWN') {
            issueScope = 'MY_DEVICE';
        }
    } else if (selectedEndpointDeviceId === DEVICE_OPTION_OTHER_NOT_LISTED) {
        affectedDeviceId = null;
        affectedDeviceName = 'Other / Not listed';
    } else {
        affectedDeviceId = null;
        affectedDeviceName = DEVICE_NAME_BY_SELECTION[selectedEndpointDeviceId] || null;
    }

    console.log('[TicketCreate] Selected endpoint device state', {
        selectedEndpointDeviceId,
        selectedEndpointDevice,
        affectedDeviceId,
        affectedDeviceName,
        osType,
        issueScope,
        remoteSupportConsent
    });
    
    // Location data (required)
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    
    // Get current user ID as requester_id — must be a UUID, never fall back to email
    const currentUser = AuthService.getUser?.();
    const requester_id = currentUser?.id || currentUser?.userId || currentUser?.user_id || '';
    const requester_role = resolveRequesterRole(currentUser);

    // Guard: backend requires title, description, type_of_request, latitude, longitude, requester_id
    if (!title || !description || !type_of_request || !category || isNaN(lat) || isNaN(lng) || !requester_id) {
        UI.setButtonLoading(submitBtn, false);
        UI.error('All required fields must be filled. Make sure you are logged in and location is captured.');
        return;
    }

    // Build ticketData with location coordinates only
    const ticketData = {
        title,
        description,
        type_of_request,
        product_group: category,
        category,
        latitude: lat,
        longitude: lng,
        requester_id,
        affectedDeviceId,
        affectedDeviceName,
        osType,
        issueScope,
        remoteSupportConsent
    };

    const payload = ticketData;
    console.log('[TicketCreate] Final create ticket payload', payload);

    if (requester_role) {
        ticketData.requester_role = requester_role;
    } else {
        console.info('[Tickets] requester_role unavailable in auth context; omitting requester_role from POST /tickets payload.');
    }

    try {
        const createResponse = await TicketService.createTicket(payload);
        const createdTicket = createResponse?.data?.ticket || createResponse?.data || createResponse;
        const finalPriority = String(createdTicket?.priority || 'MEDIUM').toUpperCase();

        UI.success(`Ticket created successfully. Priority: ${finalPriority}.`);
        bootstrap.Modal.getInstance(document.getElementById('createTicketModal'))?.hide();
        form.reset();
        UI.resetFormValidation(form);
        // Reset location fields
        document.getElementById('newTicketLatitude').value = '';
        document.getElementById('newTicketLongitude').value = '';
        document.getElementById('locationStatus').classList.add('d-none');
        document.getElementById('mapPicker').classList.add('d-none');
        state.currentPage = 1;
        await loadTickets();
    } catch (error) {
        console.error('Failed to create ticket:', error);
        UI.error(error.message || 'Failed to create ticket');
    } finally {
        UI.setButtonLoading(submitBtn, false);
    }
}

function resolveRequesterRole(user) {
    const roleCandidates = [
        user?.role,
        ...(Array.isArray(user?.roles) ? user.roles : []),
        user?.technicianLevel,
        user?.level
    ];

    const supportedRoles = new Set([
        'REQUESTER',
        'STUDENT',
        'DOCTOR',
        'ADMIN',
        'HEAD_OF_IT',
        'TECHNICIAN',
        'JUNIOR',
        'SENIOR',
        'SUPERVISOR'
    ]);

    for (const candidate of roleCandidates) {
        const normalized = String(candidate || '').trim().toUpperCase();
        if (!normalized) continue;

        if (supportedRoles.has(normalized)) return normalized;
    }

    return null;
}

/**
 * Handle "Use My Location" button click
 */
async function handleUseLocation() {
    const btn = document.getElementById('useLocationBtn');
    const statusDiv = document.getElementById('locationStatus');
    const statusText = document.getElementById('locationStatusText');
    const latInput = document.getElementById('newTicketLatitude');
    const lngInput = document.getElementById('newTicketLongitude');
    const mapPicker = document.getElementById('mapPicker');
    
    // Check if geolocation is supported
    if (!navigator.geolocation) {
        UI.error('Geolocation is not supported by your browser');
        return;
    }
    
    // Show loading state
    btn.disabled = true;
    btn.innerHTML = '<span class=\"spinner-border spinner-border-sm me-2\"></span>Getting location...';
    statusDiv.classList.remove('d-none', 'alert-success', 'alert-danger', 'alert-info');
    statusDiv.classList.add('alert-info');
    statusText.textContent = 'Requesting location permission...';
    
    navigator.geolocation.getCurrentPosition(
        (position) => {
            // Success
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            
            latInput.value = lat;
            lngInput.value = lng;
            
            // Update manual inputs
            document.getElementById('manualLatitude').value = lat.toFixed(6);
            document.getElementById('manualLongitude').value = lng.toFixed(6);
            
            // Show success message
            statusDiv.classList.remove('alert-info');
            statusDiv.classList.add('alert-success');
            statusText.innerHTML = `<strong>Location captured!</strong> Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`;
            
            // Show map picker
            mapPicker.classList.remove('d-none');
            updateMapDisplay(lat, lng);
            
            // Reset button
            btn.disabled = false;
            btn.innerHTML = '<i class=\"bi bi-geo-alt-fill me-2\"></i>Use My Current Location';
        },
        (error) => {
            // Error
            let errorMessage = 'Unable to get location';
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    errorMessage = 'Location permission denied. Please enable location access in your browser settings.';
                    break;
                case error.POSITION_UNAVAILABLE:
                    errorMessage = 'Location information unavailable.';
                    break;
                case error.TIMEOUT:
                    errorMessage = 'Location request timed out.';
                    break;
            }
            
            statusDiv.classList.remove('alert-info');
            statusDiv.classList.add('alert-danger');
            statusText.innerHTML = `<i class="bi bi-exclamation-triangle-fill me-2"></i><strong>Error:</strong> ${errorMessage}`;
            
            // Reset button
            btn.disabled = false;
            btn.innerHTML = '<i class=\"bi bi-geo-alt-fill me-2\"></i>Use My Current Location';
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

/**
 * Handle manual coordinate input
 */
function handleManualCoordinates() {
    const manualLat = document.getElementById('manualLatitude').value;
    const manualLng = document.getElementById('manualLongitude').value;
    const latInput = document.getElementById('newTicketLatitude');
    const lngInput = document.getElementById('newTicketLongitude');
    const statusDiv = document.getElementById('locationStatus');
    const statusText = document.getElementById('locationStatusText');
    const mapPicker = document.getElementById('mapPicker');
    
    if (manualLat && manualLng) {
        const lat = parseFloat(manualLat);
        const lng = parseFloat(manualLng);
        
        if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
            latInput.value = lat;
            lngInput.value = lng;
            
            // Show success message
            statusDiv.classList.remove('d-none', 'alert-danger', 'alert-info');
            statusDiv.classList.add('alert-success');
            statusText.innerHTML = `<i class="bi bi-check-circle-fill me-2"></i><strong>Location set!</strong> Coordinates: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
            
            // Update map marker
            updateMapMarker(lat, lng);
        } else {
            statusDiv.classList.remove('d-none', 'alert-success', 'alert-info');
            statusDiv.classList.add('alert-danger');
            statusText.innerHTML = '<i class="bi bi-exclamation-triangle-fill me-2"></i><strong>Invalid coordinates.</strong> Latitude must be between -90 and 90, Longitude between -180 and 180.';
        }
    }
}

/**
 * Update map display with coordinates
 */
function updateMapDisplay(lat, lng) {
    // This function is now handled by updateMapMarker
    updateMapMarker(lat, lng);
}

/**
 * Handle AI Help button click
 */
async function handleAIHelp() {
    if (isAiHelpStreaming) {
        return;
    }

    // Collect current form values
    const title = document.getElementById('newTicketSubject')?.value.trim() || '';
    const description = document.getElementById('newTicketDescription')?.value.trim() || '';
    const category = document.getElementById('newTicketCategory')?.value || '';
    const osType = document.getElementById('newTicketOsType')?.value || '';
    const deviceType = resolveSelectedDeviceLabel();
    
    // Check if user has enough data for AI help
    if (!title || !description || !category) {
        UI.warning('Please fill in Title, Description, and Category to get AI help.');
        return;
    }
    
    // Show AI Help modal
    const aiHelpModal = new bootstrap.Modal(document.getElementById('aiHelpModal'));
    aiHelpModal.show();

    const aiHelpContent = document.getElementById('aiHelpContent');
    const aiHelpError = document.getElementById('aiHelpError');
    const aiHelpOutput = document.getElementById('aiSuggestionsText');
    const aiHelpStatus = document.getElementById('aiHelpStreamStatus');

    aiHelpContent?.classList.remove('d-none');
    aiHelpError?.classList.add('d-none');

    const aiHelpBtn = document.getElementById('aiHelpBtn');
    isAiHelpStreaming = true;
    UI.setButtonLoading(aiHelpBtn, true);
    setAiHelpButtonLoaderText('AI is writing steps...');

    let streamer = null;
    if (aiHelpOutput) {
        streamer = createSmoothTextStreamer(aiHelpOutput, {
            statusElement: aiHelpStatus,
            scrollContainer: aiHelpOutput
        });
        streamer.reset('AI is writing steps...');
    }

    const payload = {
        title,
        description,
        category,
        osType,
        deviceType
    };

    try {
        const streamedText = await OllamaService.streamUserAiHelp(payload, {
            onChunk: (chunk) => streamer?.push(chunk)
        });

        if (!String(streamedText || '').trim()) {
            throw new Error('AI Help returned empty output.');
        }

        streamer?.finish();
    } catch (error) {
        console.error('[AI Help] Error:', error);
        const fallbackMessage = 'AI Help could not generate steps right now. You can still submit the ticket normally.';
        if (aiHelpOutput) {
            aiHelpOutput.textContent = fallbackMessage;
            aiHelpOutput.classList.add('ai-stream-output');
        }
        streamer?.error('');
        if (aiHelpStatus) {
            aiHelpStatus.textContent = '';
        }
    } finally {
        setAiHelpButtonLoaderText('AI is writing steps...');
        UI.setButtonLoading(aiHelpBtn, false);
        isAiHelpStreaming = false;
    }
}

function normalizeEnhancedDescription(rawText) {
    if (!rawText) return '';

    const cleaned = String(rawText)
        .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ''))
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !/^#{1,6}\s/.test(line))
        .map((line) => line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

    return cleaned;
}

function applyEnhancedDescription(textarea, text) {
    return new Promise((resolve) => {
        const targetText = String(text || '');
        textarea.classList.add('description-enhancing');
        textarea.value = targetText;
        textarea.scrollTop = textarea.scrollHeight;

        setTimeout(() => {
            textarea.classList.remove('description-enhancing');
            resolve();
        }, 180);
    });
}

async function handleEnhanceDescription() {
    if (isEnhancementStreaming) {
        return;
    }

    const descriptionInput = document.getElementById('newTicketDescription');
    const title = document.getElementById('newTicketSubject')?.value.trim() || '';
    const description = descriptionInput?.value || '';
    const category = document.getElementById('newTicketCategory')?.value || '';
    const statusEl = document.getElementById('enhanceDescriptionStatus');
    const previewWrap = document.getElementById('enhancedDescriptionPreviewWrap');
    const previewText = document.getElementById('enhancedDescriptionPreviewText');

    if (!descriptionInput) return;

    if (!description.trim()) {
        UI.warning('Please enter a description before enhancing.');
        return;
    }

    if (statusEl) {
        statusEl.classList.remove('d-none', 'text-danger');
        statusEl.classList.add('text-muted');
        statusEl.textContent = 'AI is improving the description...';
    }

    const enhanceBtn = document.getElementById('enhanceDescriptionBtn');
    const originalDescription = descriptionInput.value;
    let streamer = null;

    isEnhancementStreaming = true;
    UI.setButtonLoading(enhanceBtn, true);
    setEnhanceButtonLoaderText('AI is improving...');

    if (previewWrap) {
        previewWrap.classList.remove('d-none');
    }

    if (previewText) {
        streamer = createSmoothTextStreamer(previewText, {
            statusElement: statusEl,
            scrollContainer: previewText
        });
        streamer.reset('AI is improving the description...');
    }

    try {
        const enhancedByAi = await OllamaService.streamDescriptionEnhancement({
            title,
            description,
            category
        }, {
            onChunk: (chunk) => streamer?.push(chunk)
        });

        const enhancedText = normalizeEnhancedDescription(enhancedByAi);
        if (!enhancedText) {
            throw new Error('Description enhancement returned empty output.');
        }

        await applyEnhancedDescription(descriptionInput, enhancedText);
        streamer?.finish();
        if (statusEl) {
            statusEl.textContent = '';
            statusEl.classList.add('d-none');
            statusEl.classList.remove('text-danger');
        }
        UI.success('Description enhanced. Please review before creating the ticket.');
    } catch (error) {
        console.error('[Enhance Description] Error:', error);
        descriptionInput.value = originalDescription;
        streamer?.error('AI could not improve the description right now.');
        if (statusEl) {
            statusEl.textContent = 'AI could not improve the description right now.';
            statusEl.classList.remove('d-none');
            statusEl.classList.add('text-danger');
        }
    } finally {
        setEnhanceButtonLoaderText('AI is improving...');
        UI.setButtonLoading(enhanceBtn, false);
        isEnhancementStreaming = false;
    }
}

function setAiHelpButtonLoaderText(text) {
    const aiHelpBtn = document.getElementById('aiHelpBtn');
    const loader = aiHelpBtn?.querySelector('.btn-loader');
    if (!loader) return;
    loader.innerHTML = `
        <span class="spinner-border spinner-border-sm me-1" role="status"></span>
        ${UI.escapeHTML(String(text || 'AI is writing steps...'))}
    `;
}

function setEnhanceButtonLoaderText(text) {
    const enhanceBtn = document.getElementById('enhanceDescriptionBtn');
    const loader = enhanceBtn?.querySelector('.btn-loader');
    if (!loader) return;
    loader.innerHTML = `
        <span class="spinner-border spinner-border-sm me-1" role="status"></span>
        ${UI.escapeHTML(String(text || 'AI is improving...'))}
    `;
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

function resolveCurrentUserRole() {
    const currentUser = AuthService.getCurrentUser?.() || AuthService.getUser?.() || null;
    return String(
        currentUser?.technicianLevel ||
        currentUser?.level ||
        currentUser?.role ||
        (Array.isArray(currentUser?.roles) ? currentUser.roles[0] : null) ||
        'REQUESTER'
    ).toUpperCase();
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
    const normalized = normalizePriorityValue(priority);
    if (!normalized) return 'UNKNOWN';
    return normalized;
}

function getPriorityBadgeClass(priority) {
    const normalized = normalizePriorityValue(priority);
    if (!normalized) return 'bg-secondary';
    return UI.getPriorityBadgeClass(normalized);
}

function normalizePriorityValue(value) {
    const normalized = String(value || '').trim().toUpperCase();
    return ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(normalized) ? normalized : '';
}

function resolveTicketCreatedAt(ticket) {
    return ticket?.createdAt || ticket?.created_at || ticket?.updatedAt || ticket?.updated_at || null;
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
