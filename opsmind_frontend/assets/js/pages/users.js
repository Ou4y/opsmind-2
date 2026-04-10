/**
 * OpsMind - Users Page Module
 * 
 * Handles user management functionality:
 * - Listing users with pagination
 * - Filtering and searching users
 * - Creating new users
 * - Updating existing users
 * - Deleting users
 * - User statistics display
 */

import UserService from '/services/userService.js';
import AuthService from '/services/authService.js';
import UI from '/assets/js/ui.js';
import Router from '/assets/js/router.js';

/**
 * Page state
 */
const state = {
    users: [],
    currentPage: 1,
    totalPages: 1,
    totalUsers: 0,
    pageSize: 10,
    filters: {
        search: '',
        role: '',
        isVerified: ''
    },
    sortBy: 'created',
    sortOrder: 'desc',
    selectedUser: null,
    isLoading: false,
    stats: {
        total: 0,
        active: 0,
        students: 0,
        professors: 0
    }
};

/**
 * Initialize the users page
 */
export async function initUsersPage() {
    console.log('[Users Page] Initializing...');
    
    // Triple-check admin access (defense in depth)
    const user = AuthService.getUser();
    const isAdmin = AuthService.isAdmin();
    
    console.log('[Users Page] Access check:', {
        user: user?.email,
        role: user?.role,
        roles: user?.roles,
        isAdmin: isAdmin
    });
    
    if (!isAdmin) {
        console.error('[Users Page] UNAUTHORIZED ACCESS BLOCKED');
        console.error('[Users Page] User attempted to access admin page:', user);
        
        UI.error('⚠️ Access Denied: Administrator privileges required.');
        sessionStorage.setItem('opsmind_error', '⚠️ Access Denied: This page requires administrator privileges.');
        
        setTimeout(() => {
            window.location.href = 'dashboard.html';
        }, 2000);
        return;
        return;
    }

    // Wait for app to be ready
    await waitForApp();
    
    // Set up event listeners
    setupEventListeners();
    
    // Load initial data
    await Promise.all([
        loadUsers(),
        loadStats()
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
 * Set up event listeners
 */
function setupEventListeners() {
    console.log('[setupEventListeners] Setting up event listeners...');
    
    // Test if userForm exists
    const userForm = document.getElementById('userForm');
    console.log('[setupEventListeners] userForm element:', userForm);
    
    // Search input with debounce
    const searchInput = document.getElementById('searchInput');
    searchInput?.addEventListener('input', UI.debounce((e) => {
        state.filters.search = e.target.value;
        state.currentPage = 1;
        loadUsers();
    }, 300));

    // Filter selects
    document.getElementById('roleFilter')?.addEventListener('change', (e) => {
        state.filters.role = e.target.value;
        state.currentPage = 1;
        loadUsers();
    });

    document.getElementById('statusFilter')?.addEventListener('change', (e) => {
        state.filters.isVerified = e.target.value;
        state.currentPage = 1;
        loadUsers();
    });

    // Clear filters
    document.getElementById('clearFilters')?.addEventListener('click', clearFilters);

    // Create user buttons
    document.getElementById('createUserBtn')?.addEventListener('click', () => openUserModal());
    document.getElementById('createFirstUser')?.addEventListener('click', () => openUserModal());

    // User form submission
    const formElement = document.getElementById('userForm');
    console.log('[setupEventListeners] Attaching submit handler to form:', formElement);
    if (formElement) {
        formElement.addEventListener('submit', handleSaveUser);
        console.log('[setupEventListeners] Submit handler attached successfully');
    } else {
        console.error('[setupEventListeners] userForm element not found!');
    }

    // Delete confirmation
    document.getElementById('confirmDeleteUserBtn')?.addEventListener('click', handleDeleteUser);

    // Export button
    document.getElementById('exportUsersBtn')?.addEventListener('click', handleExportUsers);

    // Retry button
    document.getElementById('retryLoadUsers')?.addEventListener('click', loadUsers);

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
            loadUsers();
        });
    });

    // Pagination
    document.getElementById('paginationList')?.addEventListener('click', handlePaginationClick);
}

/**
 * Load users from API
 */
async function loadUsers() {
    if (state.isLoading) return;
    state.isLoading = true;

    const tableBody = document.getElementById('usersTableBody');
    const tableContainer = document.getElementById('usersTableContainer');
    const emptyState = document.getElementById('usersEmpty');
    const errorState = document.getElementById('usersError');
    const pagination = document.getElementById('usersPagination');
    const loadingState = document.getElementById('usersLoading');

    // Show loading
    UI.toggle(loadingState, true);
    UI.toggle(tableContainer, false);
    UI.toggle(emptyState, false);
    UI.toggle(errorState, false);
    UI.toggle(pagination, false);

    try {
        const offset = (state.currentPage - 1) * state.pageSize;
        const response = await UserService.getUsers({
            limit: state.pageSize,
            offset,
            ...state.filters,
            sortBy: state.sortBy,
            sortOrder: state.sortOrder
        });

        // Handle response format
        let users = [];
        let total = 0;

        if (response.data) {
            if (Array.isArray(response.data)) {
                users = response.data;
                total = response.total || users.length;
            } else if (response.data.users) {
                users = response.data.users;
                total = response.data.total || users.length;
            }
        } else if (Array.isArray(response)) {
            users = response;
            total = users.length;
        }

        state.users = users;
        state.totalUsers = total;
        state.totalPages = Math.ceil(total / state.pageSize);

        // Update UI
        if (users.length === 0) {
            UI.toggle(emptyState, true);
        } else {
            renderUsers();
            UI.toggle(tableContainer, true);
            if (state.totalPages > 1) {
                renderPagination();
                UI.toggle(pagination, true);
            }
        }
    } catch (error) {
        console.error('Failed to load users:', error);
        UI.toggle(errorState, true);
        document.getElementById('usersErrorMessage').textContent = error.message;
    } finally {
        UI.toggle(loadingState, false);
        state.isLoading = false;
    }
}

/**
 * Load user statistics
 */
async function loadStats() {
    try {
        // Try to get stats from API or calculate from users
        const response = await UserService.getUsers({ limit: 1000 }); // Get all users for stats
        
        let users = [];
        if (response.data) {
            users = Array.isArray(response.data) ? response.data : (response.data.users || []);
        } else if (Array.isArray(response)) {
            users = response;
        }

        // Calculate stats
        const stats = {
            total: users.length,
            active: users.filter(u => u.isVerified).length,
            students: users.filter(u => u.role === 'STUDENT').length,
            professors: users.filter(u => u.role === 'DOCTOR').length
        };

        state.stats = stats;
        updateStatsDisplay();
    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

/**
 * Update statistics display
 */
function updateStatsDisplay() {
    document.getElementById('totalUsers').textContent = state.stats.total;
    document.getElementById('activeUsers').textContent = state.stats.active;
    document.getElementById('studentCount').textContent = state.stats.students;
    document.getElementById('professorCount').textContent = state.stats.professors;
}

/**
 * Render users in table
 */
function renderUsers() {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    tbody.innerHTML = state.users.map(user => {
        const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;
        const roleBadgeClass = UserService.getRoleBadgeClass(user.role);
        const roleDisplay = UserService.formatRole(user.role);
        const statusBadge = user.isVerified 
            ? '<span class="badge bg-success"><i class="bi bi-check-circle me-1"></i>Verified</span>'
            : '<span class="badge bg-warning text-dark"><i class="bi bi-clock me-1"></i>Pending</span>';
        
        const createdDate = new Date(user.createdAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });

        return `
            <tr data-user-id="${user.id}">
                <td>
                    <div class="d-flex align-items-center">
                        <div class="user-avatar me-2">${getInitials(fullName)}</div>
                        <div>
                            <div class="fw-semibold">${UI.escapeHTML(fullName)}</div>
                        </div>
                    </div>
                </td>
                <td>${UI.escapeHTML(user.email)}</td>
                <td><span class="badge ${roleBadgeClass}">${roleDisplay}</span></td>
                <td>${statusBadge}</td>
                <td>${createdDate}</td>
                <td class="text-end">
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-primary btn-edit" data-user-id="${user.id}" title="Edit">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="btn btn-outline-danger btn-delete" data-user-id="${user.id}" title="Delete">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Add event listeners to action buttons
    tbody.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const userId = e.currentTarget.dataset.userId;
            const user = state.users.find(u => u.id === userId);
            if (user) openUserModal(user);
        });
    });

    tbody.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const userId = e.currentTarget.dataset.userId;
            const user = state.users.find(u => u.id === userId);
            if (user) openDeleteModal(user);
        });
    });
}

/**
 * Get initials from name
 */
function getInitials(name) {
    if (!name) return '?';
    const parts = name.split(' ').filter(p => p.length > 0);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
}

/**
 * Open user modal for create/edit
 */
function openUserModal(user = null) {
    const modal = new bootstrap.Modal(document.getElementById('userModal'));
    const form = document.getElementById('userForm');
    const title = document.getElementById('userModalTitle');
    const saveBtn = document.getElementById('saveUserBtnText');
    const passwordGroup = document.getElementById('passwordGroup');
    const verifiedGroup = document.getElementById('verifiedGroup');

    // Reset form
    form.reset();
    form.classList.remove('was-validated');

    if (user) {
        // Edit mode
        title.textContent = 'Edit User';
        saveBtn.textContent = 'Update User';
        document.getElementById('userId').value = user.id;
        document.getElementById('userFirstName').value = user.firstName || '';
        document.getElementById('userLastName').value = user.lastName || '';
        document.getElementById('userEmail').value = user.email || '';
        document.getElementById('userRoleSelect').value = user.role || '';
        document.getElementById('userVerified').checked = user.isVerified || false;
        
        // Hide password, show verified status
        UI.toggle(passwordGroup, false);
        UI.toggle(verifiedGroup, true);
        document.getElementById('userPassword').removeAttribute('required');
    } else {
        // Create mode
        title.textContent = 'Add New User';
        saveBtn.textContent = 'Create User';
        document.getElementById('userId').value = '';
        
        // Show password, hide verified status
        UI.toggle(passwordGroup, true);
        UI.toggle(verifiedGroup, false);
        document.getElementById('userPassword').setAttribute('required', 'required');
    }

    modal.show();
}

/**
 * Handle save user (create/update)
 */
async function handleSaveUser(e) {
    e.preventDefault();
    
    console.log('[handleSaveUser] Form submitted');
    
    const form = e.target;
    
    // Check role selection first before HTML5 validation
    const roleElement = document.getElementById('userRoleSelect');
    console.log('[handleSaveUser] Role element found:', roleElement);
    console.log('[handleSaveUser] Role element value:', roleElement?.value);
    console.log('[handleSaveUser] Role element selected index:', roleElement?.selectedIndex);
    
    if (roleElement && roleElement.options && roleElement.selectedIndex >= 0) {
        console.log('[handleSaveUser] Role element selected option:', roleElement.options[roleElement.selectedIndex]);
    }
    
    if (!roleElement) {
        console.error('[handleSaveUser] Role element not found!');
        UI.error('⚠️ Form error: Role field not found');
        return;
    }
    
    if (!roleElement.value || roleElement.value === '') {
        console.error('[handleSaveUser] No role selected - value is empty');
        UI.error('⚠️ Please select a role for the user');
        roleElement.focus();
        form.classList.add('was-validated');
        return;
    }
    
    if (!form.checkValidity()) {
        console.log('[handleSaveUser] Form validation failed - HTML5 validation');
        form.classList.add('was-validated');
        return;
    }

    const userId = document.getElementById('userId').value;
    const isUpdate = !!userId;
    
    const userData = {
        firstName: document.getElementById('userFirstName').value.trim(),
        lastName: document.getElementById('userLastName').value.trim(),
        email: document.getElementById('userEmail').value.trim(),
        role: roleElement.value
    };
    
    console.log('[handleSaveUser] Raw role value from dropdown:', userData.role);
    console.log('[handleSaveUser] Role element:', roleElement);
    if (roleElement && roleElement.options) {
        console.log('[handleSaveUser] Role options:', Array.from(roleElement.options).map(o => ({ value: o.value, text: o.text, selected: o.selected })));
    }

    if (!isUpdate) {
        userData.password = document.getElementById('userPassword').value;
    } else {
        userData.isVerified = document.getElementById('userVerified').checked;
    }

    console.log('[handleSaveUser] User data collected:', {
        ...userData,
        password: userData.password ? '***' : undefined
    });

    // Validate
    const validation = UserService.validateUserData(userData, isUpdate);
    console.log('[handleSaveUser] Validation result:', validation);
    
    if (!validation.valid) {
        console.error('[handleSaveUser] Validation failed:', validation.errors);
        UI.error(validation.errors.join('<br>'));
        return;
    }
    
    console.log('[handleSaveUser] Validation passed, proceeding with API call');

    // Show loading
    const saveBtn = document.getElementById('saveUserBtn');
    const originalText = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving...';

    try {
        if (isUpdate) {
            await UserService.updateUser(userId, userData);
            UI.success('User updated successfully');
        } else {
            console.log('Creating user with data:', userData);
            const result = await UserService.createUser(userData);
            console.log('User created successfully:', result);
            UI.success('User created successfully');
        }

        // Close modal and reload
        bootstrap.Modal.getInstance(document.getElementById('userModal')).hide();
        await Promise.all([loadUsers(), loadStats()]);
    } catch (error) {
        console.error('Failed to save user:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            userData: userData
        });
        UI.error(error.message || 'Failed to save user');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalText;
    }
}

/**
 * Open delete confirmation modal
 */
function openDeleteModal(user) {
    const modal = new bootstrap.Modal(document.getElementById('deleteUserModal'));
    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;
    
    document.getElementById('deleteUserName').textContent = fullName;
    document.getElementById('deleteUserId').value = user.id;
    
    modal.show();
}

/**
 * Handle delete user
 */
async function handleDeleteUser() {
    const userId = document.getElementById('deleteUserId').value;
    if (!userId) return;

    const btn = document.getElementById('confirmDeleteUserBtn');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Deleting...';

    try {
        await UserService.deleteUser(userId);
        UI.success('User deleted successfully');
        
        // Close modal and reload
        bootstrap.Modal.getInstance(document.getElementById('deleteUserModal')).hide();
        await Promise.all([loadUsers(), loadStats()]);
    } catch (error) {
        console.error('Failed to delete user:', error);
        UI.error(error.message || 'Failed to delete user');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

/**
 * Clear all filters
 */
function clearFilters() {
    state.filters = {
        search: '',
        role: '',
        isVerified: ''
    };
    state.currentPage = 1;

    document.getElementById('searchInput').value = '';
    document.getElementById('roleFilter').value = '';
    document.getElementById('statusFilter').value = '';

    loadUsers();
}

/**
 * Handle export users
 */
function handleExportUsers() {
    try {
        // Create CSV content
        const headers = ['First Name', 'Last Name', 'Email', 'Role', 'Status', 'Created'];
        const rows = state.users.map(user => [
            user.firstName || '',
            user.lastName || '',
            user.email || '',
            UserService.formatRole(user.role),
            user.isVerified ? 'Verified' : 'Pending',
            new Date(user.createdAt).toLocaleDateString()
        ]);

        const csv = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        // Download file
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `users_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);

        UI.success('Users exported successfully');
    } catch (error) {
        console.error('Failed to export users:', error);
        UI.error('Failed to export users');
    }
}

/**
 * Update sort indicators
 */
function updateSortIndicators() {
    document.querySelectorAll('.sortable').forEach(col => {
        const icon = col.querySelector('i');
        if (col.dataset.sort === state.sortBy) {
            icon.className = state.sortOrder === 'asc' ? 'bi bi-chevron-up' : 'bi bi-chevron-down';
        } else {
            icon.className = 'bi bi-chevron-expand';
        }
    });
}

/**
 * Render pagination
 */
function renderPagination() {
    const container = document.getElementById('paginationList');
    if (!container) return;

    const pages = [];
    const maxVisible = 5;
    let startPage = Math.max(1, state.currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(state.totalPages, startPage + maxVisible - 1);

    if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }

    // Previous button
    pages.push(`
        <li class="page-item ${state.currentPage === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" data-page="${state.currentPage - 1}">Previous</a>
        </li>
    `);

    // First page
    if (startPage > 1) {
        pages.push(`<li class="page-item"><a class="page-link" href="#" data-page="1">1</a></li>`);
        if (startPage > 2) {
            pages.push(`<li class="page-item disabled"><span class="page-link">...</span></li>`);
        }
    }

    // Page numbers
    for (let i = startPage; i <= endPage; i++) {
        pages.push(`
            <li class="page-item ${i === state.currentPage ? 'active' : ''}">
                <a class="page-link" href="#" data-page="${i}">${i}</a>
            </li>
        `);
    }

    // Last page
    if (endPage < state.totalPages) {
        if (endPage < state.totalPages - 1) {
            pages.push(`<li class="page-item disabled"><span class="page-link">...</span></li>`);
        }
        pages.push(`
            <li class="page-item">
                <a class="page-link" href="#" data-page="${state.totalPages}">${state.totalPages}</a>
            </li>
        `);
    }

    // Next button
    pages.push(`
        <li class="page-item ${state.currentPage === state.totalPages ? 'disabled' : ''}">
            <a class="page-link" href="#" data-page="${state.currentPage + 1}">Next</a>
        </li>
    `);

    container.innerHTML = pages.join('');
}

/**
 * Handle pagination click
 */
function handlePaginationClick(e) {
    e.preventDefault();
    const target = e.target.closest('a');
    if (!target) return;

    const page = parseInt(target.dataset.page);
    if (page && page !== state.currentPage && page >= 1 && page <= state.totalPages) {
        state.currentPage = page;
        loadUsers();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}
