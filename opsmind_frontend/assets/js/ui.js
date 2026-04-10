/**
 * OpsMind - UI Utility Module
 * 
 * Provides reusable UI utilities including:
 * - Toast notifications
 * - Modal helpers
 * - Loading states
 * - Form validation helpers
 * - Date formatting
 * - Component loading
 */

/**
 * UI Namespace - Contains all UI utility functions
 */
const UI = {
    /**
     * Show a toast notification
     * @param {string} message - Toast message
     * @param {string} type - Toast type (success, error, warning, info)
     * @param {number} duration - Duration in ms (default: 4000)
     */
    showToast(message, type = 'info', duration = 4000) {
        const container = document.getElementById('toastContainer');
        if (!container) {
            console.warn('Toast container not found');
            return;
        }

        const toastId = 'toast-' + Date.now();
        const iconMap = {
            success: 'bi-check-circle-fill',
            error: 'bi-exclamation-circle-fill',
            warning: 'bi-exclamation-triangle-fill',
            info: 'bi-info-circle-fill'
        };

        const toastHTML = `
            <div id="${toastId}" class="toast toast-${type}" role="alert" aria-live="assertive" aria-atomic="true">
                <div class="toast-body d-flex align-items-center gap-2">
                    <i class="bi ${iconMap[type] || iconMap.info}"></i>
                    <span>${this.escapeHTML(message)}</span>
                    <button type="button" class="btn-close btn-close-white ms-auto" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
            </div>
        `;

        container.insertAdjacentHTML('beforeend', toastHTML);
        
        const toastElement = document.getElementById(toastId);
        const toast = new bootstrap.Toast(toastElement, { delay: duration });
        
        // Clean up element after hidden
        toastElement.addEventListener('hidden.bs.toast', () => {
            toastElement.remove();
        });
        
        toast.show();
    },

    /**
     * Show success toast
     */
    success(message) {
        this.showToast(message, 'success');
    },

    /**
     * Show error toast
     */
    error(message) {
        this.showToast(message, 'error', 6000);
    },

    /**
     * Show warning toast
     */
    warning(message) {
        this.showToast(message, 'warning', 5000);
    },

    /**
     * Show info toast
     */
    info(message) {
        this.showToast(message, 'info');
    },

    /**
     * Show a confirmation modal
     * @param {Object} options - Modal options
     * @param {string} options.title - Modal title
     * @param {string} options.message - Confirmation message
     * @param {string} options.confirmText - Confirm button text
     * @param {string} options.confirmClass - Confirm button class
     * @returns {Promise<boolean>} Resolves to true if confirmed
     */
    confirm(options = {}) {
        return new Promise((resolve) => {
            const {
                title = 'Confirm Action',
                message = 'Are you sure you want to proceed?',
                confirmText = 'Confirm',
                confirmClass = 'btn-primary'
            } = options;

            const modalId = 'confirmModal-' + Date.now();
            const modalHTML = `
                <div class="modal fade" id="${modalId}" tabindex="-1" aria-hidden="true">
                    <div class="modal-dialog modal-dialog-centered">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">${this.escapeHTML(title)}</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                            </div>
                            <div class="modal-body">
                                <p>${this.escapeHTML(message)}</p>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                                <button type="button" class="btn ${confirmClass}" id="${modalId}-confirm">${this.escapeHTML(confirmText)}</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            document.body.insertAdjacentHTML('beforeend', modalHTML);
            
            const modalElement = document.getElementById(modalId);
            const modal = new bootstrap.Modal(modalElement);
            
            // Handle confirm
            document.getElementById(`${modalId}-confirm`).addEventListener('click', () => {
                modal.hide();
                resolve(true);
            });

            // Handle dismiss
            modalElement.addEventListener('hidden.bs.modal', () => {
                modalElement.remove();
                resolve(false);
            });

            modal.show();
        });
    },

    /**
     * Show a loading modal
     * @param {string} message - Loading message
     * @returns {Object} Object with hide() method
     */
    showLoading(message = 'Please wait...') {
        const modalId = 'loadingModal-' + Date.now();
        const modalHTML = `
            <div class="modal fade" id="${modalId}" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered modal-sm">
                    <div class="modal-content">
                        <div class="modal-body text-center py-4">
                            <div class="spinner-border text-primary mb-3" role="status">
                                <span class="visually-hidden">Loading...</span>
                            </div>
                            <p class="mb-0">${this.escapeHTML(message)}</p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        const modalElement = document.getElementById(modalId);
        const modal = new bootstrap.Modal(modalElement);
        modal.show();

        return {
            hide: () => {
                modal.hide();
                modalElement.addEventListener('hidden.bs.modal', () => {
                    modalElement.remove();
                }, { once: true });
            },
            updateMessage: (newMessage) => {
                const msgEl = modalElement.querySelector('.modal-body p');
                if (msgEl) msgEl.textContent = newMessage;
            }
        };
    },

    /**
     * Set loading state on a button
     * @param {HTMLElement} button - Button element
     * @param {boolean} loading - Loading state
     */
    setButtonLoading(button, loading) {
        if (!button) return;
        
        const textEl = button.querySelector('.btn-text');
        const loaderEl = button.querySelector('.btn-loader');
        
        if (loading) {
            button.disabled = true;
            if (textEl) textEl.classList.add('d-none');
            if (loaderEl) loaderEl.classList.remove('d-none');
        } else {
            button.disabled = false;
            if (textEl) textEl.classList.remove('d-none');
            if (loaderEl) loaderEl.classList.add('d-none');
        }
    },

    /**
     * Show/hide element with class toggle
     * @param {HTMLElement|string} element - Element or selector
     * @param {boolean} show - Whether to show
     */
    toggle(element, show) {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return;
        
        if (show) {
            el.classList.remove('d-none');
        } else {
            el.classList.add('d-none');
        }
    },

    /**
     * Validate a form and show validation feedback
     * @param {HTMLFormElement} form - Form element
     * @returns {boolean} True if valid
     */
    validateForm(form) {
        if (!form) return false;
        
        // Add Bootstrap validation class
        form.classList.add('was-validated');
        
        // Check HTML5 validity
        return form.checkValidity();
    },

    /**
     * Reset form validation state
     * @param {HTMLFormElement} form - Form element
     */
    resetFormValidation(form) {
        if (!form) return;
        form.classList.remove('was-validated');
        form.reset();
    },

    /**
     * Format a date for display
     * @param {string|Date} date - Date to format
     * @param {Object} options - Intl.DateTimeFormat options
     * @returns {string} Formatted date string
     */
    formatDate(date, options = {}) {
        if (!date) return '--';
        
        try {
            const d = new Date(date);
            const defaultOptions = {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                ...options
            };
            return d.toLocaleDateString('en-US', defaultOptions);
        } catch {
            return '--';
        }
    },

    /**
     * Format a date with time
     * @param {string|Date} date - Date to format
     * @returns {string} Formatted date and time string
     */
    formatDateTime(date) {
        if (!date) return '--';
        
        try {
            const d = new Date(date);
            return d.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return '--';
        }
    },

    /**
     * Format a relative time (e.g., "2 hours ago")
     * @param {string|Date} date - Date to format
     * @returns {string} Relative time string
     */
    formatRelativeTime(date) {
        if (!date) return '--';
        
        try {
            const d = new Date(date);
            const now = new Date();
            const diffMs = now - d;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);

            if (diffMins < 1) return 'Just now';
            if (diffMins < 60) return `${diffMins}m ago`;
            if (diffHours < 24) return `${diffHours}h ago`;
            if (diffDays < 7) return `${diffDays}d ago`;
            
            return this.formatDate(date);
        } catch {
            return '--';
        }
    },

    /**
     * Format duration in human readable format
     * @param {number} ms - Duration in milliseconds
     * @returns {string} Formatted duration
     */
    formatDuration(ms) {
        if (!ms || ms < 0) return '--';
        
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        }
        if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        }
        return `${seconds}s`;
    },

    /**
     * Escape HTML to prevent XSS
     * @param {string} str - String to escape
     * @returns {string} Escaped string
     */
    escapeHTML(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    /**
     * Create safe text node (alternative to innerHTML)
     * @param {string} text - Text content
     * @returns {Text} Text node
     */
    createTextNode(text) {
        return document.createTextNode(text || '');
    },

    /**
     * Load an HTML component into an element
     * @param {string} containerId - Container element ID
     * @param {string} componentPath - Path to HTML component
     * @returns {Promise<void>}
     */
    async loadComponent(containerId, componentPath) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.warn(`Container ${containerId} not found`);
            return;
        }

        try {
            const response = await fetch(componentPath);
            if (!response.ok) throw new Error(`Failed to load ${componentPath}`);
            
            const html = await response.text();
            container.innerHTML = html;
        } catch (error) {
            console.error(`Error loading component: ${error.message}`);
        }
    },

    /**
     * Get status badge class based on status value
     * @param {string} status - Status value
     * @returns {string} CSS class
     */
    getStatusBadgeClass(status) {
        const statusLower = (status || '').toLowerCase().replace(/\s+/g, '_');
        return `badge-status-${statusLower}`;
    },

    /**
     * Get priority badge class based on priority value
     * @param {string} priority - Priority value
     * @returns {string} CSS class
     */
    getPriorityBadgeClass(priority) {
        const priorityLower = (priority || '').toLowerCase();
        return `badge-priority-${priorityLower}`;
    },

    /**
     * Debounce function calls
     * @param {Function} func - Function to debounce
     * @param {number} wait - Wait time in ms
     * @returns {Function} Debounced function
     */
    debounce(func, wait = 300) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    /**
     * Throttle function calls
     * @param {Function} func - Function to throttle
     * @param {number} limit - Time limit in ms
     * @returns {Function} Throttled function
     */
    throttle(func, limit = 300) {
        let inThrottle;
        return function executedFunction(...args) {
            if (!inThrottle) {
                func(...args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },

    /**
     * Generate pagination HTML
     * @param {Object} pagination - Pagination info
     * @param {number} pagination.currentPage - Current page
     * @param {number} pagination.totalPages - Total pages
     * @param {Function} onPageChange - Page change callback
     * @returns {string} Pagination HTML
     */
    renderPagination(pagination, onPageChange) {
        const { currentPage, totalPages } = pagination;
        
        if (totalPages <= 1) return '';

        let html = '';
        
        // Previous button
        html += `
            <li class="page-item ${currentPage <= 1 ? 'disabled' : ''}">
                <a class="page-link" href="#" data-page="${currentPage - 1}" aria-label="Previous">
                    <i class="bi bi-chevron-left"></i>
                </a>
            </li>
        `;

        // Page numbers
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(totalPages, startPage + 4);

        if (startPage > 1) {
            html += `<li class="page-item"><a class="page-link" href="#" data-page="1">1</a></li>`;
            if (startPage > 2) {
                html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
            }
        }

        for (let i = startPage; i <= endPage; i++) {
            html += `
                <li class="page-item ${i === currentPage ? 'active' : ''}">
                    <a class="page-link" href="#" data-page="${i}">${i}</a>
                </li>
            `;
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
            }
            html += `<li class="page-item"><a class="page-link" href="#" data-page="${totalPages}">${totalPages}</a></li>`;
        }

        // Next button
        html += `
            <li class="page-item ${currentPage >= totalPages ? 'disabled' : ''}">
                <a class="page-link" href="#" data-page="${currentPage + 1}" aria-label="Next">
                    <i class="bi bi-chevron-right"></i>
                </a>
            </li>
        `;

        return html;
    }
};

// Freeze to prevent modifications
Object.freeze(UI);

export default UI;
