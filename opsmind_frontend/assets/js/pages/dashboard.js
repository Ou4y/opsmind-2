/**
 * OpsMind - Dashboard Page Module
 * 
 * Handles dashboard-specific functionality:
 * - Loading and displaying statistics
 * - Rendering charts
 * - Recent activity feed
 * - High priority tickets table
 * - Active workflows table
 */

import UI from '/assets/js/ui.js';
import TicketService from '/services/ticketService.js';
import WorkflowService from '/services/workflowService.js';
import AIService from '/services/aiService.js';
import AuthService from '/services/authService.js';

/**
 * Dashboard state
 */
const state = {
    chartPeriod: 30,
    isLoading: false,
    userRole: null
};

/**
 * Initialize the dashboard page
 */
export async function initDashboard() {
    // Wait for app to be ready
    await waitForApp();
    
    // Get current user role
    const user = AuthService.getCurrentUser();
    state.userRole = user?.role?.toUpperCase();
    
    // Customize dashboard header based on role
    customizeDashboardHeader();
    
    // Set up event listeners
    setupEventListeners();
    
    // Load all dashboard data
    await loadDashboardData();
}

/**
 * Customize dashboard header based on user role
 */
function customizeDashboardHeader() {
    const pageTitle = document.querySelector('.page-title');
    const pageSubtitle = document.querySelector('.page-subtitle');
    
    if (!pageTitle || !pageSubtitle) return;
    
    switch(state.userRole) {
        case 'STUDENT':
            pageTitle.textContent = 'Student Dashboard';
            pageSubtitle.textContent = 'View and manage your support tickets.';
            break;
        case 'DOCTOR':
            pageTitle.textContent = 'Doctor Dashboard';
            pageSubtitle.textContent = 'Track your IT support requests and service tickets.';
            break;
        default:
            pageTitle.textContent = 'Dashboard';
            pageSubtitle.textContent = 'Welcome back! Here\'s your IT operations overview.';
    }
}

/**
 * Wait for the main app to initialize
 */
function waitForApp() {
    return new Promise((resolve) => {
        // Since navbar/sidebar are now inline, just check if app is ready or wait briefly
        if (document.querySelector('.navbar-main')) {
            // App elements already in DOM, resolve after a short delay for JS to init
            setTimeout(resolve, 100);
        } else {
            document.addEventListener('app:ready', resolve, { once: true });
        }
    });
}

/**
 * Set up dashboard event listeners
 */
function setupEventListeners() {
    // Refresh button
    const refreshBtn = document.getElementById('refreshDashboard');
    refreshBtn?.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Refreshing...';
        
        await loadDashboardData();
        
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = '<i class="bi bi-arrow-clockwise me-1"></i> Refresh';
        UI.success('Dashboard refreshed');
    });

    // Chart period selector
    const chartPeriod = document.getElementById('chartPeriod');
    chartPeriod?.addEventListener('change', async (e) => {
        state.chartPeriod = parseInt(e.target.value, 10);
        await loadChartData();
    });
}

/**
 * Load all dashboard data
 */
async function loadDashboardData() {
    if (state.isLoading) return;
    state.isLoading = true;

    try {
        // Load data in parallel where possible
        await Promise.allSettled([
            loadStatistics(),
            loadChartData(),
            loadRecentActivity(),
            loadHighPriorityTickets(),
            loadActiveWorkflows()
        ]);
    } catch (error) {
        console.error('Dashboard load error:', error);
        UI.error('Failed to load some dashboard data');
    } finally {
        state.isLoading = false;
    }
}

/**
 * Load and display statistics cards
 */
async function loadStatistics() {
    try {
        // For STUDENT/DOCTOR: Show only their own ticket stats
        if (state.userRole === 'STUDENT' || state.userRole === 'DOCTOR') {
            await loadUserTicketStatistics();
            return;
        }
        
        // For other roles: Show system-wide stats
        // Try to get real data from API
        const [ticketStats, aiStats] = await Promise.allSettled([
            TicketService.getStatistics(),
            AIService.getRecommendationCount()
        ]);

        // Handle ticket stats
        if (ticketStats.status === 'fulfilled') {
            const stats = ticketStats.value;
            updateStatCard('openTicketsCount', stats.open || 0);
            updateStatCard('inProgressCount', stats.inProgress || 0);
            updateStatCard('slaViolationsCount', stats.slaViolations || 0);
            
            // Update change indicators
            updateChangeIndicator('openTicketsChange', stats.openChange, true);
            updateChangeIndicator('inProgressChange', stats.inProgressChange, false);
            updateChangeIndicator('slaViolationsChange', stats.slaChange, true);
        } else {
            // Use mock data for demo
            useMockStatistics();
        }

        // Handle AI stats
        if (aiStats.status === 'fulfilled') {
            updateStatCard('aiRecommendationsCount', aiStats.value.count || 0);
            updateChangeIndicator('aiRecommendationsChange', aiStats.value.pending || 0, false, true);
        } else {
            updateStatCard('aiRecommendationsCount', 12);
            updateChangeIndicator('aiRecommendationsChange', 5, false, true);
        }
    } catch (error) {
        console.error('Failed to load statistics:', error);
        useMockStatistics();
    }
}

/**
 * Load user-specific ticket statistics for STUDENT/DOCTOR
 */
async function loadUserTicketStatistics() {
    try {
        const user = AuthService.getCurrentUser();
        
        // Fetch only user's tickets
        const response = await TicketService.getTickets({
            requester: user.email,
            page: 1,
            pageSize: 100  // Get more tickets to calculate stats
        });
        
        if (response && response.tickets) {
            const tickets = response.tickets;
            
            // Calculate user's ticket stats
            const myOpen = tickets.filter(t => ['UNASSIGNED', 'ASSIGNED'].includes(t.status)).length;
            const myInProgress = tickets.filter(t => t.status === 'IN_PROGRESS').length;
            const myResolved = tickets.filter(t => t.status === 'RESOLVED').length;
            const myTotal = tickets.length;
            
            // Update stat cards with user-specific labels
            updateStatCard('openTicketsCount', myOpen);
            document.querySelector('#openTicketsCount').closest('.stat-card').querySelector('.stat-label').textContent = 'My Open Tickets';
            
            updateStatCard('inProgressCount', myInProgress);
            document.querySelector('#inProgressCount').closest('.stat-card').querySelector('.stat-label').textContent = 'In Progress';
            
            updateStatCard('slaViolationsCount', myResolved);
            document.querySelector('#slaViolationsCount').closest('.stat-card').querySelector('.stat-label').textContent = 'Resolved';
            document.querySelector('#slaViolationsCount').closest('.stat-card').classList.remove('stat-card-danger');
            document.querySelector('#slaViolationsCount').closest('.stat-card').classList.add('stat-card-success');
            
            updateStatCard('aiRecommendationsCount', myTotal);
            document.querySelector('#aiRecommendationsCount').closest('.stat-card').querySelector('.stat-label').textContent = 'Total Tickets';
            
            // Hide change indicators for user dashboard
            document.querySelectorAll('.stat-change').forEach(el => el.style.display = 'none');
        } else {
            // No tickets yet
            updateStatCard('openTicketsCount', 0);
            updateStatCard('inProgressCount', 0);
            updateStatCard('slaViolationsCount', 0);
            updateStatCard('aiRecommendationsCount', 0);
        }
    } catch (error) {
        console.error('Failed to load user ticket statistics:', error);
        // Show zeros on error
        updateStatCard('openTicketsCount', 0);
        updateStatCard('inProgressCount', 0);
        updateStatCard('slaViolationsCount', 0);
        updateStatCard('aiRecommendationsCount', 0);
    }
}

/**
 * Use mock statistics for demo purposes
 */
function useMockStatistics() {
    updateStatCard('openTicketsCount', 24);
    updateStatCard('inProgressCount', 18);
    updateStatCard('slaViolationsCount', 3);
    updateStatCard('aiRecommendationsCount', 12);
    
    updateChangeIndicator('openTicketsChange', '12%', true);
    updateChangeIndicator('inProgressChange', '0%', false);
    updateChangeIndicator('slaViolationsChange', '2', true);
    updateChangeIndicator('aiRecommendationsChange', '5', false, true);
}

/**
 * Update a stat card value
 */
function updateStatCard(elementId, value) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = typeof value === 'number' ? value.toLocaleString() : value;
    }
}

/**
 * Update change indicator
 */
function updateChangeIndicator(elementId, value, invertColors = false, isPending = false) {
    const el = document.getElementById(elementId);
    if (!el) return;
    
    el.textContent = value;
    
    if (!isPending) {
        const parent = el.closest('.stat-change');
        if (parent) {
            const isPositive = String(value).includes('-') || value === 0 || value === '0%';
            parent.className = 'stat-change ' + (invertColors ? (isPositive ? 'positive' : 'negative') : (isPositive ? 'negative' : 'positive'));
        }
    }
}

/**
 * Load and render chart data
 */
async function loadChartData() {
    const chartContainer = document.getElementById('barChart');
    const chartCard = chartContainer?.closest('.card');
    
    if (!chartContainer) return;
    
    // Hide chart for STUDENT/DOCTOR - they don't need system-wide trends
    if (state.userRole === 'STUDENT' || state.userRole === 'DOCTOR') {
        if (chartCard) {
            chartCard.closest('.col-12').style.display = 'none';
        }
        return;
    }

    try {
        const trendData = await TicketService.getTrends(state.chartPeriod);
        renderChart(chartContainer, trendData);
    } catch (error) {
        console.error('Failed to load chart data:', error);
        // Use mock data
        renderChart(chartContainer, generateMockChartData());
    }
}

/**
 * Generate mock chart data
 */
function generateMockChartData() {
    const days = state.chartPeriod === 7 ? 7 : state.chartPeriod === 90 ? 12 : 8;
    const labels = [];
    const created = [];
    const resolved = [];
    
    for (let i = 0; i < days; i++) {
        const date = new Date();
        date.setDate(date.getDate() - (days - 1 - i) * (state.chartPeriod / days));
        labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        created.push(Math.floor(Math.random() * 15) + 5);
        resolved.push(Math.floor(Math.random() * 12) + 3);
    }
    
    return { labels, created, resolved };
}

/**
 * Render simple bar chart
 */
function renderChart(container, data) {
    const { labels, created, resolved } = data;
    const maxValue = Math.max(...created, ...resolved);
    
    let html = '';
    
    for (let i = 0; i < labels.length; i++) {
        const createdHeight = (created[i] / maxValue) * 150;
        const resolvedHeight = (resolved[i] / maxValue) * 150;
        
        html += `
            <div class="bar-column">
                <div class="bar-group">
                    <div class="bar bar-created" style="height: ${createdHeight}px" title="Created: ${created[i]}"></div>
                    <div class="bar bar-resolved" style="height: ${resolvedHeight}px" title="Resolved: ${resolved[i]}"></div>
                </div>
                <div class="bar-label">${labels[i]}</div>
            </div>
        `;
    }
    
    container.innerHTML = html;
    
    // Add CSS for bar columns if not present
    if (!document.getElementById('chartStyles')) {
        const style = document.createElement('style');
        style.id = 'chartStyles';
        style.textContent = `
            .bar-column {
                display: flex;
                flex-direction: column;
                align-items: center;
                flex: 1;
            }
            .bar-group {
                display: flex;
                gap: 2px;
                align-items: flex-end;
                height: 150px;
            }
            .bar {
                width: 16px;
                min-height: 4px;
                border-radius: 2px 2px 0 0;
                transition: height 0.3s ease;
            }
            .bar:hover {
                opacity: 0.8;
            }
            .bar-label {
                font-size: 10px;
                color: var(--color-gray-500);
                margin-top: 8px;
                text-align: center;
            }
            #barChart {
                display: flex;
                justify-content: space-around;
                align-items: flex-end;
                padding: 20px 10px;
            }
        `;
        document.head.appendChild(style);
    }
}

/**
 * Load recent activity feed
 */
async function loadRecentActivity() {
    const container = document.getElementById('recentActivity');
    const activityCard = container?.closest('.card');
    const cardTitle = activityCard?.querySelector('.card-title');
    
    if (!container) return;
    
    // Customize activity title for STUDENT/DOCTOR
    if ((state.userRole === 'STUDENT' || state.userRole === 'DOCTOR') && cardTitle) {
        cardTitle.innerHTML = '<i class="bi bi-clock-history me-2"></i>My Ticket Activity';
    }

    try {
        const activities = await TicketService.getRecentActivity(8);
        renderActivityList(container, activities);
    } catch (error) {
        console.error('Failed to load activity:', error);
        // Use mock data
        renderActivityList(container, generateMockActivities());
    }
}

/**
 * Generate mock activity data
 */
function generateMockActivities() {
    return [
        { type: 'ticket_created', message: 'New ticket created: "Email not syncing"', user: 'John Smith', time: new Date(Date.now() - 300000) },
        { type: 'ticket_resolved', message: 'Ticket #1234 resolved', user: 'Sarah Wilson', time: new Date(Date.now() - 900000) },
        { type: 'workflow_triggered', message: 'Auto-assignment workflow executed', user: 'System', time: new Date(Date.now() - 1800000) },
        { type: 'sla_warning', message: 'SLA warning: Ticket #1198 approaching deadline', user: 'System', time: new Date(Date.now() - 3600000) },
        { type: 'ticket_created', message: 'New ticket: "VPN connection issues"', user: 'Mike Johnson', time: new Date(Date.now() - 7200000) },
        { type: 'ticket_resolved', message: 'Ticket #1230 marked as resolved', user: 'Lisa Chen', time: new Date(Date.now() - 14400000) }
    ];
}

/**
 * Render activity list
 */
function renderActivityList(container, activities) {
    if (!activities || activities.length === 0) {
        container.innerHTML = `
            <div class="empty-state py-4">
                <i class="bi bi-activity"></i>
                <p>No recent activity</p>
            </div>
        `;
        return;
    }

    const iconMap = {
        ticket_created: { icon: 'bi-ticket-detailed', class: 'ticket-created' },
        ticket_resolved: { icon: 'bi-check-circle', class: 'ticket-resolved' },
        workflow_triggered: { icon: 'bi-play-circle', class: 'workflow-triggered' },
        sla_warning: { icon: 'bi-exclamation-triangle', class: 'sla-warning' }
    };

    let html = '';
    
    activities.forEach(activity => {
        const iconInfo = iconMap[activity.type] || { icon: 'bi-circle', class: '' };
        
        html += `
            <div class="activity-item">
                <div class="activity-icon ${iconInfo.class}">
                    <i class="bi ${iconInfo.icon}"></i>
                </div>
                <div class="activity-content">
                    <p class="activity-text">${UI.escapeHTML(activity.message)}</p>
                    <span class="activity-time">${UI.formatRelativeTime(activity.time)}</span>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

/**
 * Load high priority tickets
 */
async function loadHighPriorityTickets() {
    const tableBody = document.getElementById('priorityTicketsTable');
    const emptyState = document.getElementById('priorityTicketsEmpty');
    const cardHeader = document.querySelector('#priorityTicketsTable')?.closest('.card')?.querySelector('.card-header h5');
    
    if (!tableBody) return;

    try {
        let tickets;
        
        // For STUDENT/DOCTOR: Show their own tickets (not just high priority)
        if (state.userRole === 'STUDENT' || state.userRole === 'DOCTOR') {
            const user = AuthService.getCurrentUser();
            const response = await TicketService.getTickets({
                requester: user.email,
                page: 1,
                pageSize: 5
            });
            tickets = response.tickets || response;
            
            // Update card title
            if (cardHeader) {
                cardHeader.innerHTML = '<i class="bi bi-ticket-detailed me-2 text-primary"></i>My Recent Tickets';
            }
        } else {
            // For other roles: Show high priority tickets
            const response = await TicketService.getHighPriority(5);
            tickets = response.tickets || response;
        }
        
        renderPriorityTickets(tableBody, emptyState, tickets);
    } catch (error) {
        console.error('Failed to load priority tickets:', error);
        // Use mock data
        renderPriorityTickets(tableBody, emptyState, generateMockPriorityTickets());
    }
}

/**
 * Generate mock priority tickets
 */
function generateMockPriorityTickets() {
    return [
        { id: 'TKT-1247', subject: 'Server outage in Building A', status: 'open', priority: 'critical', createdAt: new Date(Date.now() - 3600000) },
        { id: 'TKT-1245', subject: 'Network connectivity issues', status: 'in_progress', priority: 'high', createdAt: new Date(Date.now() - 7200000) },
        { id: 'TKT-1242', subject: 'Email server not responding', status: 'open', priority: 'high', createdAt: new Date(Date.now() - 18000000) },
        { id: 'TKT-1238', subject: 'Security certificate expiring', status: 'pending', priority: 'high', createdAt: new Date(Date.now() - 86400000) }
    ];
}

/**
 * Render priority tickets table
 */
function renderPriorityTickets(tableBody, emptyState, tickets) {
    if (!tickets || tickets.length === 0) {
        tableBody.innerHTML = '';
        emptyState?.classList.remove('d-none');
        return;
    }

    emptyState?.classList.add('d-none');
    
    let html = '';
    
    tickets.forEach(ticket => {
        const age = getTicketAge(ticket.createdAt);
        
        html += `
            <tr class="cursor-pointer" onclick="window.location.href='tickets.html?id=${ticket.id}'">
                <td><code>${UI.escapeHTML(ticket.id)}</code></td>
                <td class="text-truncate" style="max-width: 200px;">${UI.escapeHTML(ticket.subject)}</td>
                <td><span class="badge ${UI.getStatusBadgeClass(ticket.status)}">${formatStatus(ticket.status)}</span></td>
                <td><span class="text-muted">${age}</span></td>
            </tr>
        `;
    });

    tableBody.innerHTML = html;
}

/**
 * Calculate ticket age
 */
function getTicketAge(createdAt) {
    if (!createdAt) return '--';
    
    const now = new Date();
    const created = new Date(createdAt);
    const diffMs = now - created;
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffDays > 0) return `${diffDays}d`;
    if (diffHours > 0) return `${diffHours}h`;
    return '<1h';
}

/**
 * Format status for display
 */
function formatStatus(status) {
    if (!status) return 'Unknown';
    return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Load active workflows
 */
async function loadActiveWorkflows() {
    const tableBody = document.getElementById('activeWorkflowsTable');
    const emptyState = document.getElementById('activeWorkflowsEmpty');
    const workflowCard = document.querySelector('#activeWorkflowsTable')?.closest('.card');
    
    if (!tableBody) return;
    
    // Hide workflows section for STUDENT/DOCTOR
    if (state.userRole === 'STUDENT' || state.userRole === 'DOCTOR') {
        if (workflowCard) {
            workflowCard.closest('.col-12').style.display = 'none';
        }
        return;
    }

    try {
        const workflows = await WorkflowService.getActiveWorkflows(5);
        renderActiveWorkflows(tableBody, emptyState, workflows);
    } catch (error) {
        console.error('Failed to load workflows:', error);
        // Use mock data
        renderActiveWorkflows(tableBody, emptyState, generateMockActiveWorkflows());
    }
}

/**
 * Generate mock active workflows
 */
function generateMockActiveWorkflows() {
    return [
        { id: 'WF-001', name: 'Auto-Assignment', trigger: 'Ticket Created', status: 'running', progress: 65 },
        { id: 'WF-003', name: 'SLA Escalation', trigger: 'SLA Breach', status: 'running', progress: 30 },
        { id: 'WF-007', name: 'Priority Update', trigger: 'Manual', status: 'running', progress: 90 }
    ];
}

/**
 * Render active workflows table
 */
function renderActiveWorkflows(tableBody, emptyState, workflows) {
    if (!workflows || workflows.length === 0) {
        tableBody.innerHTML = '';
        emptyState?.classList.remove('d-none');
        return;
    }

    emptyState?.classList.add('d-none');
    
    let html = '';
    
    workflows.forEach(workflow => {
        html += `
            <tr class="cursor-pointer" onclick="window.location.href='workflows.html?id=${workflow.id}'">
                <td>${UI.escapeHTML(workflow.name)}</td>
                <td><span class="text-muted">${UI.escapeHTML(workflow.trigger)}</span></td>
                <td><span class="badge badge-execution-${workflow.status}">${formatStatus(workflow.status)}</span></td>
                <td>
                    <div class="progress progress-mini">
                        <div class="progress-bar bg-primary" style="width: ${workflow.progress}%"></div>
                    </div>
                </td>
            </tr>
        `;
    });

    tableBody.innerHTML = html;
}
