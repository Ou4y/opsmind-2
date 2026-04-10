/**
 * OpsMind - Main Application Module
 * 
 * This is the entry point for authenticated pages.
 * It handles:
 * - Loading shared components (navbar, sidebar)
 * - Initializing common functionality
 * - Setting up global event listeners
 * - User session management
 */

import Router from './router.js';
import UI from './ui.js';
import AuthService from '../../services/authService.js';
import NotificationService from '../../services/notificationService.js';


/**
 * App - Main application controller
 */
const App = {
    // Initialization flag
    initialized: false,

    /**
     * Initialize the application
     */
    async init() {
        if (this.initialized) return;
        
        console.log('[App] Initializing...');
        
        // Check authentication and redirect if needed
        if (!Router.init()) {
            console.log('[App] Router redirecting, stopping init');
            return; // Redirecting, don't continue
        }
        
        console.log('[App] Auth check passed, initializing UI...');
        
        // Load navbar and sidebar components first
        await this.loadComponents();
        
        // Check for error message from redirect
        this.checkForErrorMessage();
        
        // Initialize common functionality
        this.initNavbar();
        this.initSidebar();
        this.initGlobalListeners();
        
        this.initialized = true;
        
        console.log('[App] Initialization complete');
        
        // Dispatch event for page-specific scripts
        document.dispatchEvent(new CustomEvent('app:ready'));
    },


    async loadNotifications() {
    try {
        const notifications = await NotificationService.getUserNotifications();

        console.log("Loaded notifications:", notifications);

        const unreadCount = notifications.filter(n => !n.read).length;

        const badge = document.getElementById('notificationBadge');

        // Badge Logic
        if (badge) {
            if (unreadCount > 0) {
                badge.style.display = 'inline-block';
                badge.textContent = unreadCount;
            } else {
                badge.style.display = 'none';
                badge.textContent = '';
            }
        }

        const container = document.getElementById('notificationDropdownList');

        if (container) {

            if (notifications.length === 0) {
                container.innerHTML = `
                    <div class="notification-empty">
                        No notifications
                    </div>
                `;
                return;
            }

            container.innerHTML = notifications.map(n => `
                <div 
                    class="notification-item ${!n.read ? 'unread' : ''}" 
                    data-id="${n._id}"
                >
                    <div class="notification-message">
                        ${n.message}
                    </div>
                    <span class="notification-time">
                        ${new Date(n.createdAt).toLocaleString()}
                    </span>
                </div>
            `).join('');
        }

    } catch (error) {
        console.error('Failed to load notifications:', error);
    }
   },




    /**
     * Check for error message from redirect
     */
    checkForErrorMessage() {
        const errorMessage = sessionStorage.getItem('opsmind_error');
        if (errorMessage) {
            sessionStorage.removeItem('opsmind_error');
            // Show error after a brief delay to ensure UI is ready
            setTimeout(() => {
                UI.error(errorMessage);
            }, 500);
        }
    },

    /**
     * Load navbar and sidebar components
     */
    async loadComponents() {
        const navbarContainer = document.getElementById('navbar-container');
        const sidebarContainer = document.getElementById('sidebar-container');

        try {
            // Load navbar
            if (navbarContainer) {
                const navbarResponse = await fetch('/components/navbar.html');
                if (navbarResponse.ok) {
                    navbarContainer.innerHTML = await navbarResponse.text();
                }
            }

            // Load sidebar
            if (sidebarContainer) {
                const sidebarResponse = await fetch('/components/sidebar.html');
                if (sidebarResponse.ok) {
                    sidebarContainer.innerHTML = await sidebarResponse.text();
                }
            }

            // Wait a tick for DOM to update
            await new Promise(resolve => setTimeout(resolve, 0));
            
            console.log('[App] Components loaded, checking admin section...');
            
            // Show admin section if user is admin
            if (AuthService.isAdmin()) {
                const adminSection = document.getElementById('adminSection');
                console.log('[App] User is admin, adminSection element:', adminSection);
                if (adminSection) {
                    adminSection.style.display = 'block';
                    console.log('[App] Admin section shown');
                } else {
                    console.error('[App] Admin section not found in DOM');
                }
            } else {
                console.log('[App] User is not admin');
            }
            
            // Handle role-based visibility for sidebar items
            this.applyRoleBasedVisibility();
        } catch (error) {
            console.error('Failed to load components:', error);
        }
    },

    /**
     * Apply role-based visibility to sidebar items with data-roles attribute
     */
    applyRoleBasedVisibility() {
        const user = AuthService.getUser();
        if (!user || !user.role) {
            console.log('[App] No user role found, skipping role-based visibility');
            return;
        }
        
        const userRole = user.role.toUpperCase();
        console.log('[App] Applying role-based visibility for role:', userRole);
        
        // Find all elements with data-roles attribute
        const roleElements = document.querySelectorAll('[data-roles]');
        
        roleElements.forEach(element => {
            const allowedRoles = element.getAttribute('data-roles').split(',').map(r => r.trim().toUpperCase());
            
            if (allowedRoles.includes(userRole)) {
                element.style.display = '';
                console.log('[App] Showing element for role:', userRole, element);
            } else {
                element.style.display = 'none';
                console.log('[App] Hiding element for role:', userRole, element);
            }
        });
    },

    /**
     * Initialize navbar functionality
     */
    initNavbar() {
        const user = AuthService.getUser();
        

        
        // Set user info in navbar
        this.updateUserDisplay(user);

        // Logout functionality (use delegation so it works even if navbar is injected later)
        if (!this._logoutDelegationBound) {
            console.log('[App] Binding logout click handler');

            document.addEventListener('click', async (e) => {
                const logoutLink = e.target.closest('#logoutBtn');
                if (!logoutLink) return;

                console.log('[App] Logout clicked');

                e.preventDefault();

                const confirmed = await UI.confirm({
                    title: 'Sign Out',
                    message: 'Are you sure you want to sign out?',
                    confirmText: 'Sign Out',
                    confirmClass: 'btn-danger'
                });

                if (!confirmed) return;

                AuthService.clearAuth();
                Router.redirectToLogin();
            });

            this._logoutDelegationBound = true;
        }

        // Notifications button 
        this.loadNotifications();

          if (!this._notificationInterval) {
              this._notificationInterval = setInterval(() => {
              this.loadNotifications();
            }, 5000);
          }

          const notificationsBtn = document.getElementById('notificationsBtn');

          notificationsBtn?.addEventListener('click', async () => {
             const dropdown = document.getElementById('notificationDropdown');
             dropdown?.classList.toggle('show');

           if (dropdown?.classList.contains('show')) {
               await NotificationService.markAllAsRead();
               await this.loadNotifications();
            }
           });

        // Global search (placeholder)
        const globalSearch = document.getElementById('globalSearch');
        globalSearch?.addEventListener('click', () => {
            UI.info('Global search coming soon!');
        });

        // Help button (placeholder)
        const helpBtn = document.getElementById('helpBtn');
        helpBtn?.addEventListener('click', () => {
            UI.info('Help documentation coming soon!');
        });
    },

    /**
     * Update user display in navbar
     */
/**
 * Update user display in navbar
 */
updateUserDisplay(user) {
    if (!user) return;

    // Create full name from firstName and lastName if name doesn't exist
    const fullName = user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;
    const displayRole = this.formatRole(user.role);

    // Avatar initials
    const avatar = document.getElementById('userAvatar');
    if (avatar) {
        const initials = this.getInitials(fullName);
        avatar.textContent = initials;
    }

    // User name and role
    const nameEl = document.getElementById('userName');
    const roleEl = document.getElementById('userRole');
    const dropdownName = document.getElementById('dropdownUserName');
    const dropdownEmail = document.getElementById('dropdownUserEmail');

    if (nameEl) nameEl.textContent = fullName;
    if (roleEl) roleEl.textContent = displayRole;
    if (dropdownName) dropdownName.textContent = fullName;
    if (dropdownEmail) dropdownEmail.textContent = user.email || '';
},

/**
 * Format role for display
 */
formatRole(role) {
    if (!role) return 'User';
    
    const roleMap = {
        'ADMIN': 'Administrator',
        'DOCTOR': 'Professor',
        'STUDENT': 'Student',
        'TECHNICIAN': 'IT Technician',
        'MANAGER': 'IT Manager',
        'USER': 'User'
    };
    
    // Handle both uppercase and lowercase
    return roleMap[role.toUpperCase()] || role;
},

    /**
     * Get initials from a name
     */
    getInitials(name) {
        if (!name) return '?';
        
        const parts = name.split(' ').filter(p => p.length > 0);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    },

   

    /**
     * Initialize sidebar functionality
     */
    initSidebar() {
        // Mobile sidebar toggle
        const sidebarToggle = document.getElementById('sidebarToggle');
        const sidebar = document.getElementById('sidebar');
        const sidebarBackdrop = document.getElementById('sidebarBackdrop');

        console.log('[App] Sidebar toggle:', sidebarToggle, 'Sidebar:', sidebar);

        sidebarToggle?.addEventListener('click', () => {
            console.log('[App] Sidebar toggle clicked');
            sidebar?.classList.toggle('show');
            sidebarBackdrop?.classList.toggle('show');
        });

        // Close sidebar on backdrop click
        sidebarBackdrop?.addEventListener('click', () => {
            sidebar?.classList.remove('show');
            sidebarBackdrop?.classList.remove('show');
        });

        // Close sidebar on link click (mobile)
        sidebar?.querySelectorAll('.sidebar-link').forEach(link => {
            link.addEventListener('click', () => {
                if (window.innerWidth < 992) {
                    sidebar.classList.remove('show');
                    sidebarBackdrop?.classList.remove('show');
                }
            });
        });

        // Update active link
        Router.setActiveLink();
    },

    /**
     * Initialize global event listeners
     */
    initGlobalListeners() {
        // Handle 401 errors globally (session expired)
        window.addEventListener('unhandledrejection', (event) => {
            if (event.reason?.message?.includes('401') || 
                event.reason?.message?.includes('Session expired')) {
                UI.error('Your session has expired. Please sign in again.');
                setTimeout(() => Router.redirectToLogin(), 2000);
            }
        });

        // Handle window resize for responsive adjustments
        window.addEventListener('resize', UI.debounce(() => {
            // Close mobile sidebar on resize to desktop
            if (window.innerWidth >= 992) {
                const sidebar = document.getElementById('sidebar');
                const backdrop = document.getElementById('sidebarBackdrop');
                sidebar?.classList.remove('show');
                backdrop?.classList.remove('show');
            }
        }, 250));

        // Handle keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Escape key closes modals and mobile sidebar
            if (e.key === 'Escape') {
                const sidebar = document.getElementById('sidebar');
                const backdrop = document.getElementById('sidebarBackdrop');
                if (sidebar?.classList.contains('show')) {
                    sidebar.classList.remove('show');
                    backdrop?.classList.remove('show');
                }
            }
        });
    }
};

// Auto-initialize when DOM is ready (single registration)
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

// Export for use by page-specific scripts
export default App;
