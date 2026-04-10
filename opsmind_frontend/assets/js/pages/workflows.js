/**
 * OpsMind - Workflows Page Module
 * 
 * Handles workflows page functionality:
 * - Listing workflows
 * - Viewing workflow details and steps
 * - Creating workflows
 * - Triggering manual execution
 * - Viewing execution history
 */

import UI from '/assets/js/ui.js';
import WorkflowService from '/services/workflowService.js';
import Router from '/assets/js/router.js';

/**
 * Page state
 */
const state = {
    workflows: [],
    executions: [],
    selectedWorkflow: null,
    selectedExecution: null,
    filters: {
        status: '',
        trigger: '',
        search: ''
    },
    executionFilters: {
        workflowId: '',
        status: '',
        dateRange: 'week'
    },
    currentTab: 'workflows',
    isLoading: false
};

/**
 * Initialize the workflows page
 */
export async function initWorkflowsPage() {
    // Wait for app to be ready
    await waitForApp();
    
    // Check for URL parameters
    parseUrlParams();
    
    // Set up event listeners
    setupEventListeners();
    
    // Load initial data
    await Promise.all([
        loadWorkflows(),
        loadStatistics()
    ]);
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
    const workflowId = Router.getQueryParam('id');
    const tab = Router.getQueryParam('tab');

    if (tab === 'executions') {
        // Switch to executions tab
        const executionsTab = document.getElementById('executions-tab');
        if (executionsTab) {
            new bootstrap.Tab(executionsTab).show();
            state.currentTab = 'executions';
        }
    }

    if (workflowId) {
        state.selectedWorkflow = workflowId;
    }
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
    // Refresh button
    document.getElementById('refreshWorkflows')?.addEventListener('click', async () => {
        const btn = document.getElementById('refreshWorkflows');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Refreshing...';
        
        if (state.currentTab === 'workflows') {
            await loadWorkflows();
        } else {
            await loadExecutions();
        }
        
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-arrow-clockwise me-1"></i> Refresh';
        UI.success('Data refreshed');
    });

    // Create workflow buttons
    document.getElementById('createWorkflowBtn')?.addEventListener('click', openCreateModal);
    document.getElementById('createFirstWorkflow')?.addEventListener('click', openCreateModal);

    // Create workflow form
    document.getElementById('createWorkflowForm')?.addEventListener('submit', handleCreateWorkflow);

    // Workflow filters
    document.getElementById('workflowSearch')?.addEventListener('input', UI.debounce((e) => {
        state.filters.search = e.target.value;
        filterWorkflows();
    }, 300));

    document.getElementById('workflowStatusFilter')?.addEventListener('change', (e) => {
        state.filters.status = e.target.value;
        filterWorkflows();
    });

    document.getElementById('workflowTriggerFilter')?.addEventListener('change', (e) => {
        state.filters.trigger = e.target.value;
        filterWorkflows();
    });

    // Execution filters
    document.getElementById('executionWorkflowFilter')?.addEventListener('change', (e) => {
        state.executionFilters.workflowId = e.target.value;
        loadExecutions();
    });

    document.getElementById('executionStatusFilter')?.addEventListener('change', (e) => {
        state.executionFilters.status = e.target.value;
        loadExecutions();
    });

    document.getElementById('executionDateFilter')?.addEventListener('change', (e) => {
        state.executionFilters.dateRange = e.target.value;
        loadExecutions();
    });

    // Tab change handlers
    document.getElementById('executions-tab')?.addEventListener('shown.bs.tab', () => {
        state.currentTab = 'executions';
        if (state.executions.length === 0) {
            loadExecutions();
        }
    });

    document.getElementById('workflows-tab')?.addEventListener('shown.bs.tab', () => {
        state.currentTab = 'workflows';
    });

    // Retry buttons
    document.getElementById('retryLoadWorkflows')?.addEventListener('click', loadWorkflows);

    // Workflow detail modal buttons
    document.getElementById('executeWorkflowBtn')?.addEventListener('click', handleExecuteWorkflow);
    document.getElementById('toggleWorkflowStatusBtn')?.addEventListener('click', handleToggleStatus);

    // Cancel execution button
    document.getElementById('cancelExecutionBtn')?.addEventListener('click', handleCancelExecution);
}

/**
 * Load workflow statistics
 */
async function loadStatistics() {
    try {
        const stats = await WorkflowService.getStatistics();
        
        document.getElementById('totalWorkflows').textContent = stats.total || 0;
        document.getElementById('activeWorkflows').textContent = stats.active || 0;
        document.getElementById('runningWorkflows').textContent = stats.running || 0;
        document.getElementById('executionsToday').textContent = stats.executionsToday || 0;
    } catch (error) {
        // Use mock data
        document.getElementById('totalWorkflows').textContent = '12';
        document.getElementById('activeWorkflows').textContent = '8';
        document.getElementById('runningWorkflows').textContent = '2';
        document.getElementById('executionsToday').textContent = '15';
    }
}

/**
 * Load workflows
 */
async function loadWorkflows() {
    if (state.isLoading) return;
    state.isLoading = true;

    const grid = document.getElementById('workflowsGrid');
    const loading = document.getElementById('workflowsLoading');
    const emptyState = document.getElementById('workflowsEmpty');
    const errorState = document.getElementById('workflowsError');

    UI.toggle(emptyState, false);
    UI.toggle(errorState, false);
    UI.toggle(loading, true);

    try {
        const workflows = await WorkflowService.getWorkflows();
        state.workflows = workflows.workflows || workflows;
        
        UI.toggle(loading, false);
        renderWorkflows();
        populateWorkflowFilter();

        // Check if we need to open a specific workflow
        if (state.selectedWorkflow) {
            openWorkflowDetail(state.selectedWorkflow);
            state.selectedWorkflow = null;
        }
    } catch (error) {
        console.error('Failed to load workflows:', error);
        
        // Use mock data
        state.workflows = generateMockWorkflows();
        UI.toggle(loading, false);
        renderWorkflows();
        populateWorkflowFilter();
        
        if (state.selectedWorkflow) {
            openWorkflowDetail(state.selectedWorkflow);
            state.selectedWorkflow = null;
        }
    } finally {
        state.isLoading = false;
    }
}

/**
 * Generate mock workflows
 */
function generateMockWorkflows() {
    return [
        {
            id: 'wf-001',
            name: 'Auto-Assignment',
            description: 'Automatically assigns new tickets to available technicians based on workload and expertise.',
            trigger: 'ticket_created',
            status: 'active',
            createdAt: new Date(Date.now() - 86400000 * 30),
            lastExecuted: new Date(Date.now() - 1800000),
            totalRuns: 245,
            steps: [
                { id: 1, name: 'Check ticket category', type: 'condition' },
                { id: 2, name: 'Find available technician', type: 'action' },
                { id: 3, name: 'Assign ticket', type: 'action' },
                { id: 4, name: 'Send notification', type: 'action' }
            ]
        },
        {
            id: 'wf-002',
            name: 'SLA Escalation',
            description: 'Escalates tickets that are approaching SLA breach to senior support staff.',
            trigger: 'sla_breach',
            status: 'active',
            createdAt: new Date(Date.now() - 86400000 * 45),
            lastExecuted: new Date(Date.now() - 7200000),
            totalRuns: 89,
            steps: [
                { id: 1, name: 'Check SLA status', type: 'condition' },
                { id: 2, name: 'Update priority', type: 'action' },
                { id: 3, name: 'Escalate to manager', type: 'action' },
                { id: 4, name: 'Send alert', type: 'notification' }
            ]
        },
        {
            id: 'wf-003',
            name: 'Password Reset Automation',
            description: 'Automates password reset requests with security verification.',
            trigger: 'ticket_created',
            status: 'active',
            createdAt: new Date(Date.now() - 86400000 * 20),
            lastExecuted: new Date(Date.now() - 3600000),
            totalRuns: 512,
            steps: [
                { id: 1, name: 'Verify user identity', type: 'condition' },
                { id: 2, name: 'Reset password', type: 'action' },
                { id: 3, name: 'Send credentials', type: 'notification' },
                { id: 4, name: 'Close ticket', type: 'action' }
            ]
        },
        {
            id: 'wf-004',
            name: 'Hardware Request Approval',
            description: 'Routes hardware requests through the approval chain.',
            trigger: 'manual',
            status: 'active',
            createdAt: new Date(Date.now() - 86400000 * 60),
            lastExecuted: new Date(Date.now() - 86400000 * 2),
            totalRuns: 34,
            steps: [
                { id: 1, name: 'Check budget', type: 'condition' },
                { id: 2, name: 'Request manager approval', type: 'action' },
                { id: 3, name: 'Process order', type: 'action' },
                { id: 4, name: 'Notify requester', type: 'notification' }
            ]
        },
        {
            id: 'wf-005',
            name: 'Daily Report Generator',
            description: 'Generates and sends daily IT operations report.',
            trigger: 'scheduled',
            status: 'inactive',
            createdAt: new Date(Date.now() - 86400000 * 90),
            lastExecuted: new Date(Date.now() - 86400000 * 7),
            totalRuns: 156,
            steps: [
                { id: 1, name: 'Collect metrics', type: 'action' },
                { id: 2, name: 'Generate report', type: 'action' },
                { id: 3, name: 'Send to stakeholders', type: 'notification' }
            ]
        },
        {
            id: 'wf-006',
            name: 'New Employee Onboarding',
            description: 'Automates IT setup for new employees.',
            trigger: 'manual',
            status: 'draft',
            createdAt: new Date(Date.now() - 86400000 * 5),
            lastExecuted: null,
            totalRuns: 0,
            steps: [
                { id: 1, name: 'Create user account', type: 'action' },
                { id: 2, name: 'Setup email', type: 'action' },
                { id: 3, name: 'Assign licenses', type: 'action' },
                { id: 4, name: 'Configure workstation', type: 'action' },
                { id: 5, name: 'Send welcome email', type: 'notification' }
            ]
        }
    ];
}

/**
 * Filter workflows based on current filters
 */
function filterWorkflows() {
    renderWorkflows();
}

/**
 * Render workflows grid
 */
function renderWorkflows() {
    const grid = document.getElementById('workflowsGrid');
    const emptyState = document.getElementById('workflowsEmpty');
    const loading = document.getElementById('workflowsLoading');

    if (!grid) return;

    // Apply filters
    let filtered = state.workflows.filter(wf => {
        if (state.filters.status && wf.status !== state.filters.status) return false;
        if (state.filters.trigger && wf.trigger !== state.filters.trigger) return false;
        if (state.filters.search) {
            const search = state.filters.search.toLowerCase();
            if (!wf.name.toLowerCase().includes(search) && 
                !wf.description?.toLowerCase().includes(search)) {
                return false;
            }
        }
        return true;
    });

    UI.toggle(loading, false);

    if (filtered.length === 0) {
        grid.innerHTML = '';
        UI.toggle(emptyState, true);
        return;
    }

    UI.toggle(emptyState, false);

    let html = '';
    
    filtered.forEach(workflow => {
        html += `
            <div class="col-12 col-md-6 col-xl-4">
                <div class="workflow-card" data-workflow-id="${workflow.id}">
                    <div class="workflow-card-header">
                        <div>
                            <h5 class="workflow-card-title">${UI.escapeHTML(workflow.name)}</h5>
                            <p class="workflow-card-desc">${UI.escapeHTML(workflow.description || 'No description')}</p>
                        </div>
                        <span class="badge badge-workflow-${workflow.status}">${formatStatus(workflow.status)}</span>
                    </div>
                    <div class="workflow-card-footer">
                        <span class="workflow-trigger">
                            <i class="bi ${getTriggerIcon(workflow.trigger)}"></i>
                            ${formatTrigger(workflow.trigger)}
                        </span>
                        <div class="workflow-stats">
                            <span class="workflow-stat">
                                <strong>${workflow.totalRuns || 0}</strong> runs
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });

    grid.innerHTML = html;

    // Add click handlers
    grid.querySelectorAll('.workflow-card').forEach(card => {
        card.addEventListener('click', () => {
            openWorkflowDetail(card.dataset.workflowId);
        });
    });
}

/**
 * Populate workflow filter dropdown in executions tab
 */
function populateWorkflowFilter() {
    const select = document.getElementById('executionWorkflowFilter');
    if (!select) return;

    let html = '<option value="">All Workflows</option>';
    
    state.workflows.forEach(wf => {
        html += `<option value="${wf.id}">${UI.escapeHTML(wf.name)}</option>`;
    });
    
    select.innerHTML = html;
}

/**
 * Open workflow detail modal
 */
async function openWorkflowDetail(workflowId) {
    const modal = document.getElementById('workflowDetailModal');
    const modalInstance = new bootstrap.Modal(modal);
    
    UI.toggle(document.getElementById('workflowDetailLoading'), true);
    UI.toggle(document.getElementById('workflowDetailContent'), false);
    
    modalInstance.show();

    try {
        // Find in current list or fetch
        let workflow = state.workflows.find(w => w.id === workflowId);
        
        if (!workflow) {
            workflow = await WorkflowService.getWorkflow(workflowId);
        }

        state.selectedWorkflow = workflowId;
        populateWorkflowModal(workflow);
    } catch (error) {
        console.error('Failed to load workflow:', error);
        UI.error('Failed to load workflow details');
        modalInstance.hide();
    }
}

/**
 * Populate workflow detail modal
 */
function populateWorkflowModal(workflow) {
    UI.toggle(document.getElementById('workflowDetailLoading'), false);
    UI.toggle(document.getElementById('workflowDetailContent'), true);

    document.getElementById('workflowDetailTitle').textContent = workflow.name;
    
    const statusBadge = document.getElementById('workflowDetailStatus');
    statusBadge.className = `badge badge-workflow-${workflow.status}`;
    statusBadge.textContent = formatStatus(workflow.status);

    document.getElementById('workflowDetailDescription').textContent = workflow.description || 'No description provided.';
    document.getElementById('workflowDetailTrigger').textContent = formatTrigger(workflow.trigger);
    document.getElementById('workflowDetailCreated').textContent = UI.formatDate(workflow.createdAt);
    document.getElementById('workflowDetailLastRun').textContent = workflow.lastExecuted ? UI.formatRelativeTime(workflow.lastExecuted) : 'Never';
    document.getElementById('workflowDetailTotalRuns').textContent = workflow.totalRuns || 0;

    // Render steps
    renderWorkflowSteps(workflow.steps || []);

    // Update toggle button text
    const toggleText = document.getElementById('toggleStatusText');
    if (toggleText) {
        toggleText.textContent = workflow.status === 'active' ? 'Deactivate' : 'Activate';
    }

    // Show/hide execute button based on status
    const executeBtn = document.getElementById('executeWorkflowBtn');
    if (executeBtn) {
        executeBtn.disabled = workflow.status !== 'active';
    }
}

/**
 * Render workflow steps
 */
function renderWorkflowSteps(steps) {
    const container = document.getElementById('workflowStepsList');
    if (!container) return;

    if (!steps || steps.length === 0) {
        container.innerHTML = '<p class="text-muted">No steps defined.</p>';
        return;
    }

    let html = '';
    
    steps.forEach((step, index) => {
        html += `
            <div class="workflow-step">
                <h6 class="step-title">
                    <span class="badge bg-secondary me-2">${index + 1}</span>
                    ${UI.escapeHTML(step.name)}
                </h6>
                <p class="step-description">Type: ${UI.escapeHTML(step.type || 'action')}</p>
            </div>
        `;
    });

    container.innerHTML = html;
}

/**
 * Handle execute workflow button
 */
async function handleExecuteWorkflow() {
    const workflowId = state.selectedWorkflow;
    if (!workflowId) return;

    const confirmed = await UI.confirm({
        title: 'Execute Workflow',
        message: 'Are you sure you want to execute this workflow now?',
        confirmText: 'Execute',
        confirmClass: 'btn-success'
    });

    if (!confirmed) return;

    const loading = UI.showLoading('Triggering workflow execution...');

    try {
        await WorkflowService.triggerExecution(workflowId);
        
        loading.hide();
        UI.success('Workflow execution started');
        
        // Close modal and switch to executions tab
        bootstrap.Modal.getInstance(document.getElementById('workflowDetailModal'))?.hide();
        
        // Refresh stats
        loadStatistics();
    } catch (error) {
        loading.hide();
        UI.error('Failed to execute workflow');
    }
}

/**
 * Handle toggle workflow status
 */
async function handleToggleStatus() {
    const workflowId = state.selectedWorkflow;
    if (!workflowId) return;

    const workflow = state.workflows.find(w => w.id === workflowId);
    if (!workflow) return;

    const newStatus = workflow.status === 'active' ? 'inactive' : 'active';
    const action = newStatus === 'active' ? 'activate' : 'deactivate';

    const confirmed = await UI.confirm({
        title: `${action.charAt(0).toUpperCase() + action.slice(1)} Workflow`,
        message: `Are you sure you want to ${action} this workflow?`,
        confirmText: action.charAt(0).toUpperCase() + action.slice(1),
        confirmClass: newStatus === 'active' ? 'btn-success' : 'btn-warning'
    });

    if (!confirmed) return;

    try {
        await WorkflowService.toggleStatus(workflowId, newStatus);
        
        UI.success(`Workflow ${action}d successfully`);
        
        // Update local data
        workflow.status = newStatus;
        
        // Update modal
        const statusBadge = document.getElementById('workflowDetailStatus');
        statusBadge.className = `badge badge-workflow-${newStatus}`;
        statusBadge.textContent = formatStatus(newStatus);
        
        document.getElementById('toggleStatusText').textContent = newStatus === 'active' ? 'Deactivate' : 'Activate';
        document.getElementById('executeWorkflowBtn').disabled = newStatus !== 'active';
        
        // Refresh grid
        renderWorkflows();
        loadStatistics();
    } catch (error) {
        UI.error(`Failed to ${action} workflow`);
    }
}

/**
 * Load executions
 */
async function loadExecutions() {
    const tableBody = document.getElementById('executionsTableBody');
    const loading = document.getElementById('executionsLoading');
    const emptyState = document.getElementById('executionsEmpty');

    UI.toggle(loading, true);
    UI.toggle(emptyState, false);

    try {
        const response = await WorkflowService.getExecutions(state.executionFilters);
        state.executions = response.executions || response;
        
        UI.toggle(loading, false);
        renderExecutions();
    } catch (error) {
        console.error('Failed to load executions:', error);
        
        // Use mock data
        state.executions = generateMockExecutions();
        UI.toggle(loading, false);
        renderExecutions();
    }
}

/**
 * Generate mock executions
 */
function generateMockExecutions() {
    return [
        {
            id: 'exec-001',
            workflowId: 'wf-001',
            workflowName: 'Auto-Assignment',
            trigger: 'Ticket Created',
            status: 'completed',
            startedAt: new Date(Date.now() - 1800000),
            duration: 3200,
            triggeredBy: 'System'
        },
        {
            id: 'exec-002',
            workflowId: 'wf-003',
            workflowName: 'Password Reset Automation',
            trigger: 'Ticket Created',
            status: 'running',
            startedAt: new Date(Date.now() - 300000),
            duration: null,
            triggeredBy: 'System'
        },
        {
            id: 'exec-003',
            workflowId: 'wf-002',
            workflowName: 'SLA Escalation',
            trigger: 'SLA Breach',
            status: 'completed',
            startedAt: new Date(Date.now() - 7200000),
            duration: 5600,
            triggeredBy: 'System'
        },
        {
            id: 'exec-004',
            workflowId: 'wf-001',
            workflowName: 'Auto-Assignment',
            trigger: 'Ticket Created',
            status: 'failed',
            startedAt: new Date(Date.now() - 14400000),
            duration: 1200,
            triggeredBy: 'System',
            error: 'No available technicians found'
        },
        {
            id: 'exec-005',
            workflowId: 'wf-004',
            workflowName: 'Hardware Request Approval',
            trigger: 'Manual',
            status: 'completed',
            startedAt: new Date(Date.now() - 86400000),
            duration: 86400000,
            triggeredBy: 'John Smith'
        }
    ];
}

/**
 * Render executions table
 */
function renderExecutions() {
    const tableBody = document.getElementById('executionsTableBody');
    const emptyState = document.getElementById('executionsEmpty');
    const info = document.getElementById('executionsInfo');

    if (!tableBody) return;

    if (state.executions.length === 0) {
        tableBody.innerHTML = '';
        UI.toggle(emptyState, true);
        if (info) info.textContent = 'Showing 0 executions';
        return;
    }

    UI.toggle(emptyState, false);
    if (info) info.textContent = `Showing ${state.executions.length} executions`;

    let html = '';
    
    state.executions.forEach(exec => {
        html += `
            <tr class="cursor-pointer" data-execution-id="${exec.id}">
                <td><code>${UI.escapeHTML(exec.id)}</code></td>
                <td>${UI.escapeHTML(exec.workflowName)}</td>
                <td><span class="text-muted">${UI.escapeHTML(exec.trigger)}</span></td>
                <td>
                    <span class="badge badge-execution-${exec.status}">
                        ${exec.status === 'running' ? '<span class="spinner-border spinner-border-sm me-1"></span>' : ''}
                        ${formatStatus(exec.status)}
                    </span>
                </td>
                <td>${UI.formatRelativeTime(exec.startedAt)}</td>
                <td>${exec.duration ? UI.formatDuration(exec.duration) : '--'}</td>
                <td class="text-end">
                    <button class="btn btn-outline-primary btn-sm" data-action="view">
                        <i class="bi bi-eye"></i>
                    </button>
                </td>
            </tr>
        `;
    });

    tableBody.innerHTML = html;

    // Add row click handlers
    tableBody.querySelectorAll('tr[data-execution-id]').forEach(row => {
        row.addEventListener('click', () => {
            openExecutionDetail(row.dataset.executionId);
        });
    });
}

/**
 * Open execution detail modal
 */
async function openExecutionDetail(executionId) {
    const modal = document.getElementById('executionDetailModal');
    const modalInstance = new bootstrap.Modal(modal);
    
    UI.toggle(document.getElementById('executionDetailLoading'), true);
    UI.toggle(document.getElementById('executionDetailContent'), false);
    
    document.getElementById('executionDetailId').textContent = executionId;
    
    modalInstance.show();

    try {
        let execution = state.executions.find(e => e.id === executionId);
        
        if (!execution) {
            execution = await WorkflowService.getExecution(executionId);
        }

        state.selectedExecution = executionId;
        populateExecutionModal(execution);
    } catch (error) {
        console.error('Failed to load execution:', error);
        // Use mock data
        const mockExec = state.executions.find(e => e.id === executionId) || generateMockExecutionDetail();
        populateExecutionModal(mockExec);
    }
}

/**
 * Generate mock execution detail
 */
function generateMockExecutionDetail() {
    return {
        id: 'exec-001',
        workflowName: 'Auto-Assignment',
        trigger: 'Ticket Created',
        triggeredBy: 'System',
        status: 'completed',
        startedAt: new Date(Date.now() - 1800000),
        duration: 3200,
        steps: [
            { name: 'Check ticket category', status: 'completed', startedAt: new Date(Date.now() - 1800000), message: 'Category: Software' },
            { name: 'Find available technician', status: 'completed', startedAt: new Date(Date.now() - 1798000), message: 'Found: John Smith' },
            { name: 'Assign ticket', status: 'completed', startedAt: new Date(Date.now() - 1796000), message: 'Ticket assigned successfully' },
            { name: 'Send notification', status: 'completed', startedAt: new Date(Date.now() - 1794000), message: 'Email sent to john@company.com' }
        ]
    };
}

/**
 * Populate execution detail modal
 */
function populateExecutionModal(execution) {
    UI.toggle(document.getElementById('executionDetailLoading'), false);
    UI.toggle(document.getElementById('executionDetailContent'), true);

    // Status banner
    const banner = document.getElementById('executionStatusBanner');
    const statusIcon = document.getElementById('executionStatusIcon');
    const statusText = document.getElementById('executionStatusText');
    const statusMessage = document.getElementById('executionStatusMessage');

    const statusConfig = {
        running: { class: 'alert-info', icon: 'bi-play-circle-fill', text: 'Running', message: 'Execution in progress...' },
        completed: { class: 'alert-success', icon: 'bi-check-circle-fill', text: 'Completed', message: 'Execution completed successfully.' },
        failed: { class: 'alert-danger', icon: 'bi-x-circle-fill', text: 'Failed', message: execution.error || 'Execution failed.' },
        cancelled: { class: 'alert-warning', icon: 'bi-slash-circle-fill', text: 'Cancelled', message: 'Execution was cancelled.' }
    };

    const config = statusConfig[execution.status] || statusConfig.running;
    banner.className = `alert ${config.class} mb-4`;
    statusIcon.className = `bi ${config.icon} fs-4`;
    statusText.textContent = config.text;
    statusMessage.textContent = config.message;

    // Details
    document.getElementById('executionWorkflowName').textContent = execution.workflowName;
    document.getElementById('executionTriggeredBy').textContent = execution.triggeredBy;
    document.getElementById('executionStarted').textContent = UI.formatDateTime(execution.startedAt);
    document.getElementById('executionDuration').textContent = execution.duration ? UI.formatDuration(execution.duration) : 'In progress...';

    // Render steps
    renderExecutionSteps(execution.steps || generateMockExecutionDetail().steps);

    // Show/hide cancel button
    const cancelBtn = document.getElementById('cancelExecutionBtn');
    if (cancelBtn) {
        UI.toggle(cancelBtn, execution.status === 'running');
    }
}

/**
 * Render execution steps
 */
function renderExecutionSteps(steps) {
    const container = document.getElementById('executionStepsList');
    if (!container) return;

    if (!steps || steps.length === 0) {
        container.innerHTML = '<p class="text-muted">No step data available.</p>';
        return;
    }

    let html = '';
    
    steps.forEach(step => {
        html += `
            <div class="execution-step ${step.status}">
                <div class="execution-step-header">
                    <h6 class="execution-step-title">${UI.escapeHTML(step.name)}</h6>
                    <span class="execution-step-time">${UI.formatRelativeTime(step.startedAt)}</span>
                </div>
                ${step.message ? `<p class="execution-step-message">${UI.escapeHTML(step.message)}</p>` : ''}
            </div>
        `;
    });

    container.innerHTML = html;
}

/**
 * Handle cancel execution
 */
async function handleCancelExecution() {
    const executionId = state.selectedExecution;
    if (!executionId) return;

    const confirmed = await UI.confirm({
        title: 'Cancel Execution',
        message: 'Are you sure you want to cancel this execution?',
        confirmText: 'Cancel Execution',
        confirmClass: 'btn-danger'
    });

    if (!confirmed) return;

    try {
        await WorkflowService.cancelExecution(executionId);
        
        UI.success('Execution cancelled');
        
        // Close modal and refresh
        bootstrap.Modal.getInstance(document.getElementById('executionDetailModal'))?.hide();
        loadExecutions();
        loadStatistics();
    } catch (error) {
        UI.error('Failed to cancel execution');
    }
}

/**
 * Open create workflow modal
 */
function openCreateModal() {
    const modal = document.getElementById('createWorkflowModal');
    const form = document.getElementById('createWorkflowForm');
    
    UI.resetFormValidation(form);
    
    const modalInstance = new bootstrap.Modal(modal);
    modalInstance.show();
}

/**
 * Handle create workflow form submission
 */
async function handleCreateWorkflow(e) {
    e.preventDefault();

    const form = e.target;
    if (!UI.validateForm(form)) return;

    const submitBtn = document.getElementById('submitWorkflowBtn');
    UI.setButtonLoading(submitBtn, true);

    const workflowData = {
        name: document.getElementById('newWorkflowName').value.trim(),
        description: document.getElementById('newWorkflowDescription').value.trim(),
        trigger: document.getElementById('newWorkflowTrigger').value,
        status: document.getElementById('newWorkflowStatus').value,
        steps: [] // Would be populated by a step builder in a full implementation
    };

    try {
        await WorkflowService.createWorkflow(workflowData);
        
        UI.success('Workflow created successfully');
        
        // Close modal
        bootstrap.Modal.getInstance(document.getElementById('createWorkflowModal'))?.hide();
        
        // Reset form
        UI.resetFormValidation(form);
        
        // Reload workflows
        await loadWorkflows();
        loadStatistics();
    } catch (error) {
        console.error('Failed to create workflow:', error);
        UI.error(error.message || 'Failed to create workflow');
    } finally {
        UI.setButtonLoading(submitBtn, false);
    }
}

/**
 * Format status for display
 */
function formatStatus(status) {
    if (!status) return 'Unknown';
    return status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * Format trigger type for display
 */
function formatTrigger(trigger) {
    const triggerMap = {
        manual: 'Manual',
        ticket_created: 'Ticket Created',
        ticket_updated: 'Ticket Updated',
        sla_breach: 'SLA Breach',
        scheduled: 'Scheduled'
    };
    return triggerMap[trigger] || trigger;
}

/**
 * Get trigger icon
 */
function getTriggerIcon(trigger) {
    const iconMap = {
        manual: 'bi-hand-index',
        ticket_created: 'bi-ticket-detailed',
        ticket_updated: 'bi-pencil-square',
        sla_breach: 'bi-exclamation-triangle',
        scheduled: 'bi-clock'
    };
    return iconMap[trigger] || 'bi-lightning';
}
