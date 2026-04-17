
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

/**
 * Page state
 */
const state = {
    reports: [],
    isLoading: false
};

/**
 * Mock reports data
 */
const mockReports = [
    {
        ticketId: 'TICK-001',
        title: 'Network connectivity issue',
        description: 'User unable to connect to the corporate network from their workstation. Error message indicates DNS resolution failure.',
        technicianId: 'TECH-003',
        technician_solution: 'Restarted the DNS client service and flushed DNS cache. Updated network adapter settings and verified connectivity.'
    },
    {
        ticketId: 'TICK-002',
        title: 'Software installation request',
        description: 'Request to install Microsoft Office suite on user\'s laptop for new project requirements.',
        technicianId: 'TECH-005',
        technician_solution: 'Downloaded and installed Microsoft Office 365 ProPlus. Activated license and configured user profile settings.'
    },
    {
        ticketId: 'TICK-003',
        title: 'Hardware malfunction',
        description: 'Printer is producing distorted output and making unusual noises during operation.',
        technicianId: 'TECH-003',
        technician_solution: 'Replaced toner cartridge and cleaned print heads. Calibrated printer alignment and tested functionality.'
    },
    {
        ticketId: 'TICK-004',
        title: 'Password reset',
        description: 'User forgot their login password and needs immediate access to their account.',
        technicianId: 'TECH-007',
        technician_solution: 'Reset user password through Active Directory. Provided temporary password and guided user through password change process.'
    },
    {
        ticketId: 'TICK-005',
        title: 'Email configuration',
        description: 'New employee needs email account configured on their workstation and mobile device.',
        technicianId: 'TECH-005',
        technician_solution: 'Created email account in Exchange. Configured Outlook client and mobile device synchronization settings.'
    }
];

/**
 * Initialize the reports page
 */
export async function initReportsPage() {
    console.log('Starting reports page initialization...');

    // Wait for app to be ready
    await waitForApp();
    console.log('App is ready, proceeding with reports page setup...');

    // Initialize state
    state.reports = mockReports;
    console.log('Mock reports loaded:', state.reports.length, 'reports');

    // Setup event listeners
    setupEventListeners();
    console.log('Event listeners set up');

    // Render reports table
    renderReportsTable();
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
        refreshBtn.addEventListener('click', () => {
            console.log('Refresh button clicked');
            renderReportsTable();
            UI.showAlert('Reports refreshed', 'success');
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
function handleDownloadPDFClick(event) {
    if (event.target.closest('.download-pdf-btn')) {
        event.preventDefault();
        const ticketId = event.target.closest('.download-pdf-btn').dataset.ticketId;
        console.log('Download PDF clicked for ticket:', ticketId);

        // Placeholder for PDF download
        downloadReportPDF(ticketId);
    }
}

/**
 * Handle submit solution
 */
function handleSubmitSolution() {
    const solutionText = document.getElementById('solutionText').value.trim();
    const ticketId = document.getElementById('addSolutionModal').dataset.ticketId;

    if (!solutionText) {
        UI.showAlert('Please enter a solution', 'warning');
        return;
    }

    // Placeholder for submitting solution
    console.log(`Submitting solution for ticket ${ticketId}:`, solutionText);

    // Close modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('addSolutionModal'));
    modal.hide();

    // Show success message
    UI.showAlert('Solution added successfully', 'success');
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
function downloadReportPDF(ticketId) {
    console.log(`Generating PDF for ticket: ${ticketId}`);

    // Find the report data
    const report = state.reports.find(r => r.ticketId === ticketId);
    if (!report) {
        UI.showAlert('Report data not found', 'error');
        return;
    }

    try {
        // Create new jsPDF instance
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Set up document properties
        doc.setProperties({
            title: `Ticket Report - ${ticketId}`,
            subject: 'IT Service Management Report',
            author: 'OpsMind System',
            keywords: 'ticket, report, IT, support',
            creator: 'OpsMind'
        });

        // Add header
        doc.setFontSize(20);
        doc.setFont('helvetica', 'bold');
        doc.text('OpsMind Ticket Report', 20, 30);

        // Add ticket ID
        doc.setFontSize(14);
        doc.setFont('helvetica', 'normal');
        doc.text(`Ticket ID: ${report.ticketId}`, 20, 50);

        // Add title
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('Title:', 20, 70);
        doc.setFont('helvetica', 'normal');
        const titleLines = doc.splitTextToSize(report.title, 170);
        doc.text(titleLines, 20, 80);

        // Calculate Y position after title
        let yPos = 80 + (titleLines.length * 5) + 10;

        // Add description
        doc.setFont('helvetica', 'bold');
        doc.text('Description:', 20, yPos);
        doc.setFont('helvetica', 'normal');
        const descLines = doc.splitTextToSize(report.description, 170);
        doc.text(descLines, 20, yPos + 10);

        // Calculate Y position after description
        yPos = yPos + 10 + (descLines.length * 5) + 10;

        // Add technician ID
        doc.setFont('helvetica', 'bold');
        doc.text('Technician ID:', 20, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(report.technicianId, 20, yPos + 10);

        // Calculate Y position after technician ID
        yPos = yPos + 20;

        // Add solution
        doc.setFont('helvetica', 'bold');
        doc.text('Solution:', 20, yPos);
        doc.setFont('helvetica', 'normal');
        const solutionLines = doc.splitTextToSize(report.technician_solution, 170);
        doc.text(solutionLines, 20, yPos + 10);

        // Add footer
        const pageHeight = doc.internal.pageSize.height;
        doc.setFontSize(8);
        doc.setFont('helvetica', 'italic');
        doc.text('Generated by OpsMind IT Service Management System', 20, pageHeight - 20);
        doc.text(`Generated on: ${new Date().toLocaleString()}`, 20, pageHeight - 10);

        // Save the PDF
        const fileName = `ticket-report-${ticketId.replace('TICK-', '')}.pdf`;
        doc.save(fileName);

        UI.showAlert(`PDF downloaded: ${fileName}`, 'success');
        console.log(`PDF generated and downloaded: ${fileName}`);

    } catch (error) {
        console.error('Error generating PDF:', error);
        UI.showAlert('Failed to generate PDF. Please try again.', 'error');
    }
}