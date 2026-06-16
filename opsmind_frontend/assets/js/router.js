/**
 * OpsMind - Router Module
 * 
 * Handles client-side routing and navigation:
 * - Page protection (auth required)
 * - Active link highlighting
 * - URL parameter parsing
 */

import AuthService from '/services/authService.js';

const SUPPORT_ACCESS_ROLES = new Set([
    'ADMIN',
    'SUPERVISOR',
    'TECHNICIAN',
    'JUNIOR_TECHNICIAN',
    'SENIOR_TECHNICIAN',
    'L1_TECHNICIAN',
    'L2_TECHNICIAN',
    'L3_TECHNICIAN',
    'L4_TECHNICIAN',
    'L1',
    'L2',
    'L3',
    'L4',
    'JUNIOR',
    'SENIOR',
    'SYSTEM_ADMIN',
    'ADMINISTRATOR',
    'HEAD_OF_IT',
    'IT_ADMIN',
    'BUILDING_MANAGER',
    'SENIOR_BUILDING_MANAGER'
]);

function normalizeRole(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, '_');
}

function resolveUserRoleSet(user, context) {
    const roleSet = new Set();
    const addRole = (role) => {
        const normalized = normalizeRole(role);
        if (normalized) {
            roleSet.add(normalized);
        }
    };

    addRole(user?.role);
    if (Array.isArray(user?.roles)) {
        user.roles.forEach(addRole);
    }

    addRole(user?.technicianLevel);
    addRole(user?.technician_level);
    addRole(user?.level);
    addRole(user?.supportLevel);
    addRole(user?.support_level);
    addRole(context?.technicianLevel);

    if (context?.roleCategory === 'ADMIN') {
        addRole('ADMIN');
    }
    if (context?.roleCategory === 'TECHNICIAN') {
        addRole('TECHNICIAN');
    }

    return roleSet;
}

function hasSupportAccess(context, user) {
    const roleSet = resolveUserRoleSet(user, context);
    return Array.from(roleSet).some((role) => SUPPORT_ACCESS_ROLES.has(role));
}

/**
 * Router - Simple client-side router for multi-page app
 */
const Router = {
    // Pages that don't require authentication
    publicPages: ['index.html','/', ''],
    
    // Pages that require admin role
    adminPages: [
        'users.html',
        'settings.html',
        'admin-dashboard.html',
        'system-logs.html',
        'admin-reports.html',
        'domains.html'
    ],
    
    // Pages restricted to STUDENT or DOCTOR only
    studentDoctorPages: [
        'dashboard.html',  // Personal dashboard
    ],
    
    // Pages for TECHNICIAN role (includes claim/routing features)
    technicianPages: [
        'junior-dashboard.html',
        'tickets.html',  // Technicians can see and claim tickets
        'report.html',  // Technicians can view reports
        'endpoint-devices.html' // Endpoint registry operations
    ],
    
    // Pages for SENIOR role (building managers)
    seniorPages: [
        'senior-dashboard.html',
        'workflows.html',  // Can manage workflows
        'sla.html'         // SLA tracking
    ],
    
    // Pages for SUPERVISOR role (global view)
    supervisorPages: [
        'supervisor-dashboard.html',
        'ai-insights.html', // Advanced analytics
        'sla.html'          // SLA tracking
    ],
    
    // Current page name
    currentPage: '',

    /**
     * Initialize the router
     * Checks auth status and redirects if needed
     */
    init() {
        this.currentPage = this.getCurrentPageName();
        
        // Check if current page requires authentication
        if (!this.isPublicPage() && !AuthService.isAuthenticated()) {
            this.redirectToLogin();
            return false;
        }

        // If on login page and already authenticated, redirect to dashboard
        if (this.isPublicPage() && AuthService.isAuthenticated()) {
            this.redirectToDashboard();
            return false;
        }

        // Check role-based access
        if (!this.checkRoleAccess()) {
            this.redirectToUnauthorized();
            return false;
        }

        // Highlight active sidebar link
        this.setActiveLink();
        
        return true;
    },

    /**
     * Check if user has access to current page based on role
     * @returns {boolean} True if user has access
     */
    checkRoleAccess() {
        // Public pages - everyone can access
        if (this.isPublicPage()) return true;

        const currentUser = AuthService.getCurrentUser();
        const context = AuthService.resolveUserDashboardContext(currentUser);

        if (this.currentPage === 'admin-dashboard.html') {
            return context.dashboardType === 'admin';
        }

        if (this.currentPage === 'junior-dashboard.html') {
            return context.dashboardType === 'junior';
        }

        if (this.currentPage === 'senior-dashboard.html') {
            return context.dashboardType === 'senior';
        }

        if (this.currentPage === 'supervisor-dashboard.html') {
            return context.dashboardType === 'supervisor';
        }

        if (this.currentPage === 'inventory-command-center.html') {
            return this.canAccessInventoryWithContext(context);
        }

        if (this.currentPage === 'inventory.html') {
            return this.canAccessInventoryWithContext(context);
        }

        if (this.currentPage === 'procurement.html') {
            return this.canAccessInventoryWithContext(context);
        }

        if (this.currentPage === 'endpoint-devices.html') {
            return hasSupportAccess(context, currentUser);
        }
        
        // Admin pages - only admins
        if (this.isAdminPage()) return context.roleCategory === 'ADMIN';
        
        // Student/Doctor only pages
        if (this.isStudentDoctorPage()) {
            // Only STUDENT or DOCTOR can access
            return context.dashboardType === 'requester';
        }
        
        // Technician pages
        if (this.isTechnicianPage()) {
            // TECHNICIAN, SENIOR, SUPERVISOR, or ADMIN can access
            return context.roleCategory === 'TECHNICIAN' || context.roleCategory === 'ADMIN';
        }
        
        // Senior pages
        if (this.isSeniorPage()) {
            // SENIOR, SUPERVISOR, or ADMIN can access
            return ['senior', 'supervisor', 'admin'].includes(context.dashboardType);
        }
        
        // Supervisor pages
        if (this.isSupervisorPage()) {
            // SUPERVISOR or ADMIN can access
            return ['supervisor', 'admin'].includes(context.dashboardType);
        }
        
        // Default: allow access to non-restricted pages
        return true;
    },

    canAccessInventoryWithContext(context) {
        const level = String(context?.technicianLevel || '').toUpperCase();
        if (context?.roleCategory === 'ADMIN') return true;
        return ['JUNIOR', 'SENIOR', 'SUPERVISOR'].includes(level);
    },

    /**
     * Get the current page name from URL
     * @returns {string} Page name
     */
    getCurrentPageName() {
        const path = window.location.pathname;
        const pageName = path.split('/').pop() || 'index.html';
        return pageName;
    },

    /**
     * Check if current page is public (no auth required)
     * @returns {boolean}
     */
    isPublicPage() {
        return this.publicPages.includes(this.currentPage);
    },

    /**
     * Check if current page requires admin role
     * @returns {boolean}
     */
    isAdminPage() {
        return this.adminPages.includes(this.currentPage);
    },
    
    /**
     * Check if current page is a student/doctor only page
     * @returns {boolean}
     */
    isStudentDoctorPage() {
        return this.studentDoctorPages.includes(this.currentPage);
    },
    
    /**
     * Check if current page is a technician page
     * @returns {boolean}
     */
    isTechnicianPage() {
        return this.technicianPages.includes(this.currentPage);
    },
    
    /**
     * Check if current page is a senior page
     * @returns {boolean}
     */
    isSeniorPage() {
        return this.seniorPages.includes(this.currentPage);
    },
    
    /**
     * Check if current page is a supervisor page
     * @returns {boolean}
     */
    isSupervisorPage() {
        return this.supervisorPages.includes(this.currentPage);
    },

    /**
     * Check if user has permission to access a specific page
     * @param {string} pageName - Page name to check
     * @returns {boolean}
     */
    canAccessPage(pageName) {
        // Public pages - everyone can access
        if (this.publicPages.includes(pageName)) {
            return true;
        }
        
        // Must be authenticated
        if (!AuthService.isAuthenticated()) {
            return false;
        }
        
        // Admin pages - only admins can access
        if (this.adminPages.includes(pageName)) {
            return AuthService.isAdmin();
        }

        if (pageName === 'inventory-command-center.html') {
            const context = AuthService.resolveUserDashboardContext(AuthService.getCurrentUser());
            return this.canAccessInventoryWithContext(context);
        }

        if (pageName === 'inventory.html') {
            const context = AuthService.resolveUserDashboardContext(AuthService.getCurrentUser());
            return this.canAccessInventoryWithContext(context);
        }

        if (pageName === 'procurement.html') {
            const context = AuthService.resolveUserDashboardContext(AuthService.getCurrentUser());
            return this.canAccessInventoryWithContext(context);
        }

        if (pageName === 'endpoint-devices.html') {
            const currentUser = AuthService.getCurrentUser();
            const context = AuthService.resolveUserDashboardContext(currentUser);
            return hasSupportAccess(context, currentUser);
        }
        
        // All other pages - authenticated users can access
        return true;
    },

    /**
     * Redirect to login page
     */
    redirectToLogin() {
        // Store intended destination for redirect after login
        const currentUrl = window.location.href;
        if (!this.isPublicPage()) {
            sessionStorage.setItem('opsmind_redirect', currentUrl);
        }
        window.location.href = '/index.html';
    },

    /**
     * Get role-based dashboard URL
     * @returns {string} Dashboard URL based on user role
     */
    getRoleBasedDashboard() {
        const context = AuthService.resolveUserDashboardContext(AuthService.getCurrentUser());
        if (context.dashboardType === 'unknown') {
            sessionStorage.setItem('opsmind_error', 'Technician profile not found. Please contact admin.');
            AuthService.clearAuth();
            return '/index.html';
        }
        return context.dashboardPath;
    },

    /**
     * Redirect to dashboard
     */
    redirectToDashboard() {
        // Check for stored redirect URL
        const redirectUrl = sessionStorage.getItem('opsmind_redirect');
        sessionStorage.removeItem('opsmind_redirect');
        
        if (redirectUrl && !redirectUrl.includes('index.html')) {
            window.location.href = redirectUrl;
        } else {
            // Redirect to role-specific dashboard
            const dashboardUrl = this.getRoleBasedDashboard();
            window.location.href = dashboardUrl;
        }
    },

    /**
     * Redirect to dashboard with unauthorized message
     */
    redirectToUnauthorized() {
        const user = AuthService.getUser();
        console.error('[Router] Unauthorized access attempt:', {
            page: this.currentPage,
            user: user?.email,
            role: user?.role,
            roles: user?.roles,
            isAdmin: AuthService.isAdmin()
        });
        
        // Store error message in session
        sessionStorage.setItem('opsmind_error', 'Access denied: You do not have permission to view that page.');

        const fallbackUrl = this.getRoleBasedDashboard();
        // Avoid redirecting to the same page endlessly.
        if (window.location.pathname === fallbackUrl) {
            window.location.href = '/index.html';
            return;
        }

        window.location.href = fallbackUrl;
    },

    /**
     * Navigate to a specific page
     * @param {string} page - Page URL
     * @param {Object} params - Query parameters
     */
    navigateTo(page, params = {}) {
        let url = page;
        
        if (Object.keys(params).length > 0) {
            const queryString = new URLSearchParams(params).toString();
            url += '?' + queryString;
        }
        
        window.location.href = url;
    },

    /**
     * Get URL query parameters
     * @returns {URLSearchParams} Query parameters
     */
    getQueryParams() {
        return new URLSearchParams(window.location.search);
    },

    /**
     * Get a specific query parameter
     * @param {string} name - Parameter name
     * @returns {string|null} Parameter value
     */
    getQueryParam(name) {
        return this.getQueryParams().get(name);
    },

    /**
     * Update URL query parameters without reload
     * @param {Object} params - Parameters to set
     */
    updateQueryParams(params) {
        const url = new URL(window.location);
        
        Object.entries(params).forEach(([key, value]) => {
            if (value === null || value === undefined || value === '') {
                url.searchParams.delete(key);
            } else {
                url.searchParams.set(key, value);
            }
        });
        
        window.history.replaceState({}, '', url);
    },

    /**
     * Set active state on sidebar navigation links
     */
    setActiveLink() {
        // Wait for sidebar to be loaded
        const checkSidebar = setInterval(() => {
            const sidebar = document.getElementById('sidebar');
            if (!sidebar) return;
            
            clearInterval(checkSidebar);
            
            // Get current page without extension
            const pageName = this.currentPage.replace('.html', '');
            
            // Find matching link and set active
            const links = sidebar.querySelectorAll('.sidebar-link');
            links.forEach(link => {
                const linkPage = link.getAttribute('data-page');
                if (linkPage === pageName) {
                    link.classList.add('active');
                } else {
                    link.classList.remove('active');
                }
            });
        }, 100);

        // Clear interval after 5 seconds to prevent infinite loop
        setTimeout(() => clearInterval(checkSidebar), 5000);
    },

    /**
     * Handle logout
     */
    async handleLogout() {
        try {
            await AuthService.logout();
        } finally {
            this.redirectToLogin();
        }
    }
};



export default Router;
