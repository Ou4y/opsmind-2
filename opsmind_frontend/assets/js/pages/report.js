
/**
 * OpsMind - Reports Page Module
 *
 * Handles reports page functionality:
 * - Displaying reports table
 * - Add solution modal
 * - Download PDF functionality
 */

import UI from '/assets/js/ui.js';
import AuthService from '/services/authService.js';
import ReportService from '/services/reportService.js';

/**
 * Page state
 */
const state = {
    reports: [],
    isLoading: false
};

/**
 * Initialize the reports page
 */
export async function initReportsPage() {
    console.log('Starting reports page initialization...');

    // Wait for app to be ready
    await waitForApp();
    console.log('App is ready, proceeding with reports page setup...');

    // Setup event listeners
    setupEventListeners();
    console.log('Event listeners set up');

    // Load reports table
    await loadReports();
    console.log('Reports table rendered');

    console.log('Reports page initialized successfully');
}

/**
 * Wait for the main app to initialize
 */
function waitForApp() {
    return new Promise((resolve) => {
        if (document.querySelector('.navbar-main')) {
            console.log('Navbar found, app appears ready');
            resolve();
        } else {
            console.log('Waiting for app:ready event...');
            document.addEventListener('app:ready', () => {
                console.log('Received app:ready event');
                resolve();
            }, { once: true });
        }
    });
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    console.log('Setting up event listeners...');

    // Refresh button
    const refreshBtn = document.getElementById('refreshReports');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            console.log('Refresh button clicked');
            await loadReports();
        });
        console.log('Refresh button listener attached');
    } else {
        console.warn('Refresh button not found');
    }

    // Add solution buttons (delegated)
    document.addEventListener('click', handleAddSolutionClick);
    console.log('Add solution click listener attached');

    // Download PDF buttons (delegated)
    document.addEventListener('click', handleDownloadPDFClick);
    console.log('Download PDF click listener attached');

    // Submit solution form
    const submitBtn = document.getElementById('submitSolution');
    if (submitBtn) {
        submitBtn.addEventListener('click', handleSubmitSolution);
        console.log('Submit solution button listener attached');
    } else {
        console.warn('Submit solution button not found');
    }
}

/**
 * Load reports for the current technician
 */
async function loadReports() {
    console.log('Loading reports...');

    const currentUser = AuthService.getCurrentUser();
    const dashboardContext = AuthService.resolveUserDashboardContext(currentUser);
    const technicianId =
        dashboardContext?.workflowUserId ||
        currentUser?.workflowUserId ||
        currentUser?.workflow_user_id ||
        currentUser?.user_id ||
        currentUser?.technicianId;
    const isAdmin = AuthService.isAdmin();

    if (!isAdmin && !technicianId) {
        state.reports = [];
        renderReportsTable();
        UI.error("Failed to load reports");
        return;
    }

    state.isLoading = true;

    try {
        const reports = isAdmin
            ? await ReportService.getAllReports()
            : await ReportService.getMyTickets(technicianId);
        state.reports = Array.isArray(reports) ? reports.map(normalizeReport) : [];
        renderReportsTable();
        UI.success('Reports refreshed');          
        console.log('Reports loaded:', state.reports.length, 'reports');
    } catch (error) {
        console.error('Failed to load reports:', error);
        state.reports = [];
        renderReportsTable();
        UI.error(error.message || 'Failed to load reports');
    } finally {
        state.isLoading = false;
    }
}

/**
 * Keep existing UI field names while accepting backend ticket fields
 */
function normalizeReport(report) {
    return {
        ...report,
        ticketId: report.ticketId || report.id,
        technicianId: report.technicianId || report.assigned_to,
        title: report.title || 'Untitled Ticket'
    };
}

/**
 * Handle add solution button clicks
 */
function handleAddSolutionClick(event) {
    if (event.target.closest('.add-solution-btn')) {
        event.preventDefault();
        const ticketId = event.target.closest('.add-solution-btn').dataset.ticketId;
        console.log('Add solution clicked for ticket:', ticketId);

        // Reset form
        const form = document.getElementById('addSolutionForm');
        if (form) {
            form.reset();
        }

        // Store ticket ID for later use
        const modal = document.getElementById('addSolutionModal');
        if (modal) {
            modal.dataset.ticketId = ticketId;

            // Show modal
            const bsModal = new bootstrap.Modal(modal);
            bsModal.show();
            console.log('Add solution modal shown');
        } else {
            console.error('Add solution modal not found');
        }
    }
}

/**
 * Handle download PDF button clicks
 */
async function handleDownloadPDFClick(event) {
    if (event.target.closest('.download-pdf-btn')) {
        event.preventDefault();
        const ticketId = event.target.closest('.download-pdf-btn').dataset.ticketId;
        console.log('Download PDF clicked for ticket:', ticketId);

        await downloadReportPDF(ticketId);
    }
}

/**
 * Handle submit solution
 */
async function handleSubmitSolution() {
    const solutionText = document.getElementById('solutionText').value.trim();
    const ticketId = document.getElementById('addSolutionModal').dataset.ticketId;

    if (!solutionText) {
        UI.error('Please enter a solution');
        return;
    }

    try {
        console.log(`Submitting solution for ticket ${ticketId}:`, solutionText);
        const updatedReport = await ReportService.addSolution(ticketId, solutionText);
        const reportIndex = state.reports.findIndex(report => report.ticketId === ticketId);

        if (reportIndex !== -1 && updatedReport) {
            state.reports[reportIndex] = normalizeReport(updatedReport);
        }

        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('addSolutionModal'));
        modal.hide();

        renderReportsTable();
        UI.success('Solution added successfully');
    } catch (error) {
        console.error('Failed to submit solution:', error);
        UI.error(error.message || 'Failed to add solution');
    }
}

/**
 * Render reports table
 */
function renderReportsTable() {
    console.log('Rendering reports table...');
    const tbody = document.getElementById('reportsTableBody');

    if (!tbody) {
        console.error('reportsTableBody element not found!');
        return;
    }

    console.log('Found table body, clearing existing content...');
    tbody.innerHTML = '';

    if (!state.reports || state.reports.length === 0) {
        console.warn('No reports data available');
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">No reports available</td></tr>';
        return;
    }

    // Check user role for UI customization
    const isAdmin = AuthService.isAdmin();
    const isTechnician = AuthService.isTechnician();
    console.log('User role check - isAdmin:', isAdmin, 'isTechnician:', isTechnician);

    console.log('Rendering', state.reports.length, 'reports...');

    state.reports.forEach((report, index) => {
        console.log(`Rendering report ${index + 1}:`, report.ticketId, report.title);
        const row = document.createElement('tr');

        // Build action buttons based on user role
        let actionButtons = '';

        // PDF download button (available to all users)
        actionButtons += `
            <button class="btn btn-sm btn-outline-secondary download-pdf-btn"
                    data-ticket-id="${report.ticketId}"
                    title="Download PDF">
                <i class="bi bi-file-earmark-pdf"></i>
            </button>`;

        // Add Solution button (only for technicians, hidden for admins)
        if (isTechnician && !isAdmin) {
            actionButtons = `
                <button class="btn btn-sm btn-outline-primary add-solution-btn"
                        data-ticket-id="${report.ticketId}"
                        title="Add Solution">
                    <i class="bi bi-plus-circle"></i>
                </button>` + actionButtons;
        }

        row.innerHTML = `
            <td>${report.ticketId}</td>
            <td>${report.title}</td>
            <td>
                <div class="btn-group" role="group">
                    ${actionButtons}
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });

    console.log('Reports table rendering complete');
}

/**
 * Download PDF report for a specific ticket
 */
async function downloadReportPDF(ticketId) {
    console.log(`Downloading PDF for ticket: ${ticketId}`);

    try {
        await ReportService.downloadPDF(ticketId);
        UI.success('PDF downloaded successfully');
        console.log(`PDF downloaded for ticket: ${ticketId}`);
    } catch (error) {
        console.error('Error downloading PDF:', error);
        UI.error(error.message || 'Failed to download PDF. Please try again.');
    }
}
