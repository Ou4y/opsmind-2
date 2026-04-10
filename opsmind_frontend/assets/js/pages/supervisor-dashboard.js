/**
 * OpsMind - Supervisor Dashboard Module
 * 
 * Handles supervisor functionality:
 * - Building-level overview and analytics
 * - SLA monitoring and compliance reporting
 * - Team performance metrics
 * - Support group management
 * - Workflow audit logs
 * - Advanced analytics and insights
 */

import UI from '/assets/js/ui.js';
import WorkflowService from '/services/workflowService.js';
import TicketService from '/services/ticketService.js';
import AuthService from '/services/authService.js';

/**
 * Page state
 */
const state = {
    metrics: null,
    slaReport: null,
    escalationStats: null,
    teamMetrics: null,
    supportGroups: [],
    auditLogs: [],
    currentUser: null,
    dateRange: 'week',
    isLoading: false,
    refreshInterval: null,
    modals: {},
    charts: {} // Store chart instances for proper cleanup
};

/**
 * Initialize the supervisor dashboard page
 */
export async function initSupervisorDashboard() {
    // Wait for app to be ready
    await waitForApp();
    
    // Get current user
    state.currentUser = AuthService.getCurrentUser();
    if (!state.currentUser) {
        window.location.href = '/index.html';
        return;
    }
    
    // Initialize modals
    state.modals.supportGroups = new bootstrap.Modal(document.getElementById('supportGroupsModal'));
    
    // Set up event listeners
    setupEventListeners();
    
    // Load initial data
    await loadDashboardData();
    
    // Set up auto-refresh every 60 seconds
    state.refreshInterval = setInterval(() => loadDashboardData(false), 60000);
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
    document.getElementById('refreshDashboard')?.addEventListener('click', async () => {
        UI.showToast('Refreshing dashboard...', 'info');
        await loadDashboardData();
    });

    // Date range filter
    document.getElementById('dateRangeFilter')?.addEventListener('change', async (e) => {
        state.dateRange = e.target.value;
        await loadDashboardData();
    });

    // Manage support groups button
    document.getElementById('manageSupportGroupsBtn')?.addEventListener('click', () => {
        loadSupportGroups();
        state.modals.supportGroups.show();
    });

    // Audit action filter
    document.getElementById('auditActionFilter')?.addEventListener('change', () => {
        renderAuditLogs();
    });

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (state.refreshInterval) {
            clearInterval(state.refreshInterval);
        }
    });
}

/**
 * Load all dashboard data
 */
async function loadDashboardData(showLoading = true) {
    if (state.isLoading) return;
    
    state.isLoading = true;
    
    try {
        const dateFilter = getDateRangeFilter();
        
        // Fetch all data in parallel
        const [metricsResp, slaResp, escalationResp] = await Promise.all([
            WorkflowService.getOverviewMetrics(dateFilter).catch(err => {
                console.error('Error loading metrics:', err);
                return null;
            }),
            WorkflowService.getSLAReport(dateFilter).catch(err => {
                console.error('Error loading SLA report:', err);
                return null;
            }),
            WorkflowService.getEscalationReport(dateFilter).catch(err => {
                console.error('Error loading escalation stats:', err);
                return null;
            })
        ]);
        
        state.metrics = metricsResp?.data || null;
        state.slaReport = slaResp?.data || null;
        state.escalationStats = escalationResp?.data || null;
        
        // Update all visualizations
        updateOverviewStats();
        renderOverviewCharts();
        renderSLAMonitoring();
        renderTeamPerformance();
        renderAnalytics();
        
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        if (showLoading) {
            UI.showToast('Failed to load dashboard data', 'error');
        }
    } finally {
        state.isLoading = false;
    }
}

/**
 * Get date range filter parameters
 */
function getDateRangeFilter() {
    const now = new Date();
    let startDate;
    
    switch (state.dateRange) {
        case 'today':
            startDate = new Date(now);
            startDate.setHours(0, 0, 0, 0);
            break;
        case 'week':
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 7);
            break;
        case 'month':
            startDate = new Date(now);
            startDate.setMonth(now.getMonth() - 1);
            break;
        case 'quarter':
            startDate = new Date(now);
            startDate.setMonth(now.getMonth() - 3);
            break;
        default:
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 7);
    }
    
    return {
        start_date: startDate.toISOString(),
        end_date: now.toISOString()
    };
}

/**
 * Update overview statistics cards
 */
function updateOverviewStats() {
    if (!state.metrics) return;
    
    const metrics = state.metrics;
    
    // Total tickets
    document.getElementById('totalTicketsCount').textContent = metrics.total_tickets || 0;
    document.getElementById('totalTicketsTrend').textContent = `${metrics.total_tickets_trend || 0}%`;
    
    // Resolved tickets
    document.getElementById('resolvedCount').textContent = metrics.resolved_tickets || 0;
    document.getElementById('resolvedTrend').textContent = `${metrics.resolved_trend || 0}%`;
    
    // SLA metrics
    if (state.slaReport) {
        document.getElementById('slaBreachedCount').textContent = state.slaReport.breached || 0;
        const complianceRate = state.slaReport.compliance_rate || 0;
        document.getElementById('slaComplianceRate').textContent = `${complianceRate}% Compliance`;
    }
    
    // Escalation metrics
    if (state.escalationStats) {
        document.getElementById('escalationsCount').textContent = state.escalationStats.total || 0;
        const escalationRate = state.escalationStats.rate || 0;
        document.getElementById('escalationRate').textContent = `${escalationRate}% of tickets`;
    }
}

/**
 * Render overview charts
 */
function renderOverviewCharts() {
    renderTicketTrendChart();
    renderPriorityDistribution();
    renderFloorBreakdown();
    renderStatusDistribution();
}

/**
 * Render ticket trend chart using Chart.js
 */
function renderTicketTrendChart() {
    const container = document.getElementById('ticketTrendChart');
    
    if (!state.metrics || !state.metrics.ticket_trend) {
        container.innerHTML = '<p class="text-muted text-center py-5">No trend data available</p>';
        return;
    }
    
    // Destroy existing chart if any
    if (state.charts.ticketTrend) {
        state.charts.ticketTrend.destroy();
    }
    
    // Clear container and create canvas
    container.innerHTML = '<canvas id="ticketTrendCanvas"></canvas>';
    const canvas = document.getElementById('ticketTrendCanvas');
    const ctx = canvas.getContext('2d');
    
    const trend = state.metrics.ticket_trend;
    
    state.charts.ticketTrend = new Chart(ctx, {
        type: 'line',
        data: {
            labels: trend.map(d => formatChartDate(d.date)),
            datasets: [{
                label: 'Tickets',
                data: trend.map(d => d.count),
                borderColor: '#4361ee',
                backgroundColor: 'rgba(67, 97, 238, 0.1)',
                tension: 0.4,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0
                    }
                }
            }
        }
    });
}

/**
 * Render priority distribution using Chart.js
 */
function renderPriorityDistribution() {
    const container = document.getElementById('priorityDistribution');
    
    if (!state.metrics || !state.metrics.by_priority) {
        container.innerHTML = '<p class="text-muted text-center">No data available</p>';
        return;
    }
    
    // Destroy existing chart if any
    if (state.charts.priority) {
        state.charts.priority.destroy();
    }
    
    // Clear container and create canvas
    container.innerHTML = '<canvas id="priorityCanvas"></canvas>';
    const canvas = document.getElementById('priorityCanvas');
    const ctx = canvas.getContext('2d');
    
    const priorities = state.metrics.by_priority;
    const priorityOrder = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
    const colors = {
        'CRITICAL': '#dc2626',
        'HIGH': '#f59e0b',
        'MEDIUM': '#3b82f6',
        'LOW': '#10b981'
    };
    
    const data = priorityOrder.map(p => priorities[p] || 0);
    
    state.charts.priority = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: priorityOrder,
            datasets: [{
                data: data,
                backgroundColor: priorityOrder.map(p => colors[p]),
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 15,
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Render floor breakdown
 */
function renderFloorBreakdown() {
    const container = document.getElementById('floorBreakdown');
    
    if (!state.metrics || !state.metrics.by_floor) {
        container.innerHTML = '<p class="text-muted text-center">No data available</p>';
        return;
    }
    
    const floors = state.metrics.by_floor;
    const maxCount = Math.max(...Object.values(floors), 1);
    
    let html = '<div class="table-responsive"><table class="table table-sm">';
    html += '<thead><tr><th>Floor</th><th>Tickets</th><th>Distribution</th></tr></thead><tbody>';
    
    Object.entries(floors).sort((a, b) => b[1] - a[1]).forEach(([floor, count]) => {
        const percentage = (count / maxCount) * 100;
        
        html += `
            <tr>
                <td><strong>Floor ${floor}</strong></td>
                <td><span class="badge bg-primary">${count}</span></td>
                <td>
                    <div class="progress" style="height: 20px;">
                        <div class="progress-bar" role="progressbar" 
                             style="width: ${percentage}%">${count}</div>
                    </div>
                </td>
            </tr>
        `;
    });
    
    html += '</tbody></table></div>';
    container.innerHTML = html;
}

/**
 * Render status distribution using Chart.js
 */
function renderStatusDistribution() {
    const container = document.getElementById('statusDistribution');
    
    if (!state.metrics || !state.metrics.by_status) {
        container.innerHTML = '<p class="text-muted text-center">No data available</p>';
        return;
    }
    
    // Destroy existing chart if any
    if (state.charts.status) {
        state.charts.status.destroy();
    }
    
    // Clear container and create canvas
    container.innerHTML = '<canvas id="statusCanvas"></canvas>';
    const canvas = document.getElementById('statusCanvas');
    const ctx = canvas.getContext('2d');
    
    const statuses = state.metrics.by_status;
    const statusOrder = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
    const colors = {
        'OPEN': '#6c757d',
        'IN_PROGRESS': '#0dcaf0',
        'RESOLVED': '#198754',
        'CLOSED': '#212529'
    };
    
    const data = statusOrder.map(s => statuses[s] || 0);
    
    state.charts.status = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: statusOrder,
            datasets: [{
                data: data,
                backgroundColor: statusOrder.map(s => colors[s]),
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 15,
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Render SLA monitoring
 */
function renderSLAMonitoring() {
    if (!state.slaReport) return;
    
    const sla = state.slaReport;
    
    // Update SLA summary cards
    document.getElementById('slaOnTrack').textContent = sla.on_track || 0;
    document.getElementById('slaAtRisk').textContent = sla.at_risk || 0;
    document.getElementById('slaBreached').textContent = sla.breached || 0;
    document.getElementById('avgResolutionTime').textContent = formatTime(sla.avg_resolution_time || 0);
    
    // Render SLA tickets list
    const container = document.getElementById('slaTicketsList');
    
    if (!sla.critical_tickets || sla.critical_tickets.length === 0) {
        container.innerHTML = '<p class="text-muted text-center py-3">No tickets approaching SLA deadline</p>';
        return;
    }
    
    let html = '<div class="list-group">';
    
    sla.critical_tickets.slice(0, 10).forEach(ticket => {
        const urgencyClass = ticket.sla_breached ? 'border-danger' : 
                            ticket.at_risk ? 'border-warning' : 'border-success';
        
        html += `
            <div class="list-group-item ${urgencyClass}">
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <h6 class="mb-1">Ticket #${UI.escapeHTML(ticket.id)}</h6>
                        <p class="mb-1 small">${UI.escapeHTML(ticket.title)}</p>
                        <small class="text-muted">
                            ${ticket.building} - Floor ${ticket.floor} | 
                            Time Remaining: ${ticket.time_remaining || 'N/A'}
                        </small>
                    </div>
                    <span class="badge ${ticket.sla_breached ? 'bg-danger' : ticket.at_risk ? 'bg-warning text-dark' : 'bg-success'}">
                        ${ticket.sla_breached ? 'BREACHED' : ticket.at_risk ? 'AT RISK' : 'OK'}
                    </span>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

/**
 * Render team performance
 */
function renderTeamPerformance() {
    renderTeamPerformanceList();
    renderTopPerformers();
    renderWorkloadBalance();
}

/**
 * Render team performance list
 */
function renderTeamPerformanceList() {
    const container = document.getElementById('teamPerformanceList');
    
    if (!state.metrics || !state.metrics.team_performance) {
        container.innerHTML = '<p class="text-muted text-center py-3">No team performance data available</p>';
        return;
    }
    
    const teams = state.metrics.team_performance;
    
    let html = '<div class="table-responsive"><table class="table">';
    html += '<thead><tr><th>Support Group</th><th>Floor</th><th>Active</th><th>Resolved</th><th>Avg Time</th><th>SLA %</th></tr></thead><tbody>';
    
    teams.forEach(team => {
        html += `
            <tr>
                <td><strong>${UI.escapeHTML(team.name)}</strong></td>
                <td>Floor ${team.floor}</td>
                <td><span class="badge bg-primary">${team.active_tickets}</span></td>
                <td><span class="badge bg-success">${team.resolved_tickets}</span></td>
                <td>${formatTime(team.avg_resolution_time)}</td>
                <td>
                    <div class="d-flex align-items-center gap-2">
                        <span class="${team.sla_compliance >= 90 ? 'text-success' : team.sla_compliance >= 75 ? 'text-warning' : 'text-danger'}"}>
                            ${team.sla_compliance}%
                        </span>
                    </div>
                </td>
            </tr>
        `;
    });
    
    html += '</tbody></table></div>';
    container.innerHTML = html;
}

/**
 * Render top performers
 */
function renderTopPerformers() {
    const container = document.getElementById('topPerformers');
    
    if (!state.metrics || !state.metrics.top_performers) {
        container.innerHTML = '<p class="text-muted text-center">No data available</p>';
        return;
    }
    
    const performers = state.metrics.top_performers.slice(0, 5);
    
    let html = '<div class="list-group list-group-flush">';
    
    performers.forEach((performer, index) => {
        const medalClass = index === 0 ? 'text-warning' : index === 1 ? 'text-secondary' : index === 2 ? 'text-danger' : '';
        const medal = index < 3 ? `<i class="bi bi-trophy${index === 0 ? '-fill' : ''} ${medalClass} me-2"></i>` : '';
        
        html += `
            <div class="list-group-item">
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        ${medal}
                        <strong>${UI.escapeHTML(performer.name)}</strong>
                        <span class="badge bg-light text-dark ms-2">${performer.role}</span>
                    </div>
                    <div class="text-end">
                        <div><strong>${performer.resolved_count}</strong> resolved</div>
                        <small class="text-muted">${formatTime(performer.avg_time)} avg</small>
                    </div>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

/**
 * Render workload balance
 */
function renderWorkloadBalance() {
    const container = document.getElementById('workloadBalance');
    
    if (!state.metrics || !state.metrics.workload_balance) {
        container.innerHTML = '<p class="text-muted text-center">No data available</p>';
        return;
    }
    
    const balance = state.metrics.workload_balance;
    const avgLoad = balance.average_load || 0;
    
    let html = `
        <div class="mb-3">
            <strong>Average Load:</strong> ${avgLoad.toFixed(1)} tickets per technician
        </div>
        <div class="progress mb-2" style="height: 25px;">
            <div class="progress-bar bg-danger" style="width: ${balance.overloaded_percent || 0}%" 
                 title="Overloaded: ${balance.overloaded || 0}">
                ${balance.overloaded || 0}
            </div>
            <div class="progress-bar bg-success" style="width: ${balance.balanced_percent || 0}%" 
                 title="Balanced: ${balance.balanced || 0}">
                ${balance.balanced || 0}
            </div>
            <div class="progress-bar bg-warning" style="width: ${balance.underutilized_percent || 0}%" 
                 title="Underutilized: ${balance.underutilized || 0}">
                ${balance.underutilized || 0}
            </div>
        </div>
        <div class="d-flex justify-content-between small text-muted">
            <span>🔴 Overloaded: ${balance.overloaded || 0}</span>
            <span>🟢 Balanced: ${balance.balanced || 0}</span>
            <span>🟡 Underutilized: ${balance.underutilized || 0}</span>
        </div>
    `;
    
    container.innerHTML = html;
}

/**
 * Render analytics
 */
function renderAnalytics() {
    renderEscalationStats();
    renderResolutionTimeChart();
    renderEfficiencyMetrics();
}

/**
 * Render escalation statistics
 */
function renderEscalationStats() {
    const container = document.getElementById('escalationStats');
    
    if (!state.escalationStats) {
        container.innerHTML = '<p class="text-muted text-center">No escalation data available</p>';
        return;
    }
    
    const stats = state.escalationStats;
    
    const html = `
        <div class="row g-3 mb-3">
            <div class="col-md-6">
                <div class="card bg-light">
                    <div class="card-body text-center">
                        <h3 class="text-danger">${stats.total || 0}</h3>
                        <p class="mb-0">Total Escalations</p>
                    </div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="card bg-light">
                    <div class="card-body text-center">
                        <h3 class="text-warning">${stats.rate || 0}%</h3>
                        <p class="mb-0">Escalation Rate</p>
                    </div>
                </div>
            </div>
        </div>
        <div class="list-group list-group-flush">
            ${stats.by_reason ? Object.entries(stats.by_reason).map(([reason, count]) => `
                <div class="list-group-item">
                    <div class="d-flex justify-content-between align-items-center">
                        <span>${UI.escapeHTML(reason)}</span>
                        <span class="badge bg-primary">${count}</span>
                    </div>
                </div>
            `).join('') : '<p class="text-muted text-center">No detailed data</p>'}
        </div>
    `;
    
    container.innerHTML = html;
}

/**
 * Render resolution time chart using Chart.js
 */
function renderResolutionTimeChart() {
    const container = document.getElementById('resolutionTimeChart');
    
    if (!state.metrics || !state.metrics.resolution_times) {
        container.innerHTML = '<p class="text-muted text-center">No resolution time data available</p>';
        return;
    }
    
    // Destroy existing chart if any
    if (state.charts.resolutionTime) {
        state.charts.resolutionTime.destroy();
    }
    
    // Clear container and create canvas
    container.innerHTML = '<canvas id="resolutionTimeCanvas"></canvas>';
    const canvas = document.getElementById('resolutionTimeCanvas');
    const ctx = canvas.getContext('2d');
    
    const times = state.metrics.resolution_times;
    const priorityOrder = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
    const colors = {
        'CRITICAL': '#dc2626',
        'HIGH': '#f59e0b',
        'MEDIUM': '#3b82f6',
        'LOW': '#10b981'
    };
    
    const data = priorityOrder.map(p => times[p] || 0);
    
    state.charts.resolutionTime = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: priorityOrder,
            datasets: [{
                label: 'Avg Resolution Time (hours)',
                data: data,
                backgroundColor: priorityOrder.map(p => colors[p]),
                borderWidth: 0,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${formatTime(context.parsed.y)}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return value + 'h';
                        }
                    }
                }
            }
        }
    });
}

/**
 * Render efficiency metrics
 */
function renderEfficiencyMetrics() {
    const container = document.getElementById('efficiencyMetrics');
    
    if (!state.metrics || !state.metrics.efficiency) {
        container.innerHTML = '<p class="text-muted text-center">No efficiency data available</p>';
        return;
    }
    
    const efficiency = state.metrics.efficiency;
    
    const html = `
        <div class="row g-3">
            <div class="col-md-3">
                <div class="text-center p-3 border rounded">
                    <h4 class="text-primary">${efficiency.first_response_time || 0}h</h4>
                    <small class="text-muted">Avg First Response</small>
                </div>
            </div>
            <div class="col-md-3">
                <div class="text-center p-3 border rounded">
                    <h4 class="text-success">${efficiency.resolution_rate || 0}%</h4>
                    <small class="text-muted">Resolution Rate</small>
                </div>
            </div>
            <div class="col-md-3">
                <div class="text-center p-3 border rounded">
                    <h4 class="text-warning">${efficiency.reopen_rate || 0}%</h4>
                    <small class="text-muted">Reopen Rate</small>
                </div>
            </div>
            <div class="col-md-3">
                <div class="text-center p-3 border rounded">
                    <h4 class="text-info">${efficiency.customer_satisfaction || 0}%</h4>
                    <small class="text-muted">Satisfaction</small>
                </div>
            </div>
        </div>
    `;
    
    container.innerHTML = html;
}

/**
 * Load support groups
 */
async function loadSupportGroups() {
    try {
        const groupsResponse = await WorkflowService.getAllSupportGroups();
        state.supportGroups = groupsResponse.data || [];
        renderSupportGroups();
    } catch (error) {
        console.error('Error loading support groups:', error);
        UI.showToast('Failed to load support groups', 'error');
    }
}

/**
 * Render support groups
 */
function renderSupportGroups() {
    const container = document.getElementById('supportGroupsList');
    
    if (state.supportGroups.length === 0) {
        container.innerHTML = '<p class="text-muted text-center py-3">No support groups found</p>';
        return;
    }
    
    let html = '<div class="list-group">';
    
    state.supportGroups.forEach(group => {
        html += `
            <div class="list-group-item">
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <h6 class="mb-1">${UI.escapeHTML(group.name)}</h6>
                        <small class="text-muted">
                            ${UI.escapeHTML(group.building)} - Floor ${group.floor} | 
                            ${group.member_count || 0} members | 
                            Status: ${group.is_active ? '<span class="badge bg-success">Active</span>' : '<span class="badge bg-secondary">Inactive</span>'}
                        </small>
                    </div>
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-primary" onclick="window.editSupportGroup(${group.id})">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="btn btn-outline-danger" onclick="window.deleteSupportGroup(${group.id})">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

/**
 * Helper functions
 */
function formatTime(hours) {
    if (!hours || hours === 0) return '0h';
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    if (hours < 24) return `${hours.toFixed(1)}h`;
    return `${Math.round(hours / 24)}d`;
}

function formatChartDate(dateString) {
    const date = new Date(dateString);
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

function getPriorityColorClass(priority) {
    switch (priority?.toUpperCase()) {
        case 'CRITICAL': return 'bg-danger';
        case 'HIGH': return 'bg-orange';
        case 'MEDIUM': return 'bg-warning text-dark';
        case 'LOW': return 'bg-success';
        default: return 'bg-secondary';
    }
}

function getStatusColorClass(status) {
    switch (status?.toUpperCase()) {
        case 'OPEN': return 'bg-info';
        case 'IN_PROGRESS': return 'bg-purple';
        case 'RESOLVED': return 'bg-success';
        case 'CLOSED': return 'bg-secondary';
        case 'ESCALATED': return 'bg-danger';
        default: return 'bg-secondary';
    }
}

// Placeholder functions for support group management
window.editSupportGroup = function(groupId) {
    UI.showToast('Edit support group - to be implemented', 'info');
};

window.deleteSupportGroup = async function(groupId) {
    if (!confirm('Are you sure you want to delete this support group?')) {
        return;
    }
    
    try {
        await WorkflowService.deleteSupportGroup(groupId);
        UI.showToast('Support group deleted successfully', 'success');
        await loadSupportGroups();
    } catch (error) {
        console.error('Error deleting support group:', error);
        UI.showToast(error.message || 'Failed to delete support group', 'error');
    }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSupervisorDashboard);
} else {
    initSupervisorDashboard();
}

// Export for use in other modules
export default {
    initSupervisorDashboard,
    loadDashboardData
};
