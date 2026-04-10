/**
 * OpsMind - User Service
 * 
 * Handles all user management API calls including:
 * - Fetching users (with filters and pagination)
 * - Creating new users
 * - Updating existing users
 * - Deleting users
 * - User role management
 * 
 * Admin only operations - requires ADMIN role
 */

import AuthService from './authService.js';

// API base URL - should match authService
const API_BASE_URL = 'http://localhost:3002';

/**
 * UserService - User management operations
 */
const UserService = {
    /**
     * Get all users with optional filters
     * @param {Object} options - Query options
     * @param {number} options.limit - Number of users per page
     * @param {number} options.offset - Pagination offset
     * @param {string} options.search - Search query
     * @param {string} options.role - Filter by role
     * @param {boolean} options.isVerified - Filter by verification status
     * @param {string} options.sortBy - Sort field
     * @param {string} options.sortOrder - Sort order (asc/desc)
     * @returns {Promise<Object>} Users data with pagination info
     */
    async getUsers(options = {}) {
        try {
            // Transform frontend role filter to backend format
            let role = options.role;
            if (role && ['JUNIOR', 'SENIOR', 'SUPERVISOR'].includes(role.toUpperCase())) {
                // When filtering by technician levels, search for TECHNICIAN role
                role = 'TECHNICIAN';
            }
            
            // Build query params
            const params = new URLSearchParams();
            if (options.limit) params.append('limit', options.limit);
            if (options.offset) params.append('offset', options.offset);
            if (options.search) params.append('search', options.search);
            if (role) params.append('role', role);
            if (options.isVerified !== undefined) params.append('isVerified', options.isVerified);
            if (options.sortBy) params.append('sortBy', options.sortBy);
            if (options.sortOrder) params.append('sortOrder', options.sortOrder);

            const queryString = params.toString();
            const url = `${API_BASE_URL}/admin/users${queryString ? '?' + queryString : ''}`;

            const response = await fetch(url, {
                method: 'GET',
                headers: AuthService.getAuthHeaders()
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Failed to fetch users');
            }

            // Transform backend data to frontend format
            if (data.data && Array.isArray(data.data)) {
                data.data = data.data.map(user => {
                    // Convert TECHNICIAN + technicianLevel to frontend role
                    if (user.role === 'TECHNICIAN' && user.technicianLevel) {
                        return { ...user, role: user.technicianLevel };
                    }
                    return user;
                });
                
                // If filtering by specific technician level, filter the results
                if (options.role && ['JUNIOR', 'SENIOR', 'SUPERVISOR'].includes(options.role.toUpperCase())) {
                    data.data = data.data.filter(user => user.role === options.role.toUpperCase());
                }
            }

            return data;
        } catch (error) {
            console.error('Failed to fetch users:', error);
            throw error;
        }
    },

    /**
     * Get a single user by ID
     * @param {string} userId - User ID
     * @returns {Promise<Object>} User data
     */
    async getUserById(userId) {
        try {
            const response = await fetch(`${API_BASE_URL}/admin/users/${userId}`, {
                method: 'GET',
                headers: AuthService.getAuthHeaders()
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Failed to fetch user');
            }

            // Transform backend data to frontend format
            if (data.data && data.data.role === 'TECHNICIAN' && data.data.technicianLevel) {
                data.data.role = data.data.technicianLevel;
            }

            return data;
        } catch (error) {
            console.error('Failed to fetch user:', error);
            throw error;
        }
    },

    /**
     * Create a new user
     * @param {Object} userData - User data
     * @param {string} userData.firstName - First name
     * @param {string} userData.lastName - Last name
     * @param {string} userData.email - Email address
     * @param {string} userData.password - Password
     * @param {string} userData.role - User role (ADMIN, DOCTOR, JUNIOR, SENIOR, SUPERVISOR, STUDENT)
     * @returns {Promise<Object>} Created user data
     */
    async createUser(userData) {
        try {
            // Transform frontend roles to backend format
            const backendData = { ...userData };
            
            // Map JUNIOR/SENIOR/SUPERVISOR to TECHNICIAN with level
            if (['JUNIOR', 'SENIOR', 'SUPERVISOR'].includes(userData.role?.toUpperCase())) {
                backendData.role = 'TECHNICIAN';
                backendData.technicianLevel = userData.role.toUpperCase();
            }
            
            console.log('[UserService] Creating user - Frontend data:', userData);
            console.log('[UserService] Creating user - Backend data:', backendData);
            
            const response = await fetch(`${API_BASE_URL}/admin/users`, {
                method: 'POST',
                headers: AuthService.getAuthHeaders(),
                body: JSON.stringify(backendData)
            });

            const data = await response.json();

            if (!response.ok) {
                // Check if endpoint exists
                if (response.status === 404) {
                    throw new Error('❌ Backend endpoint not implemented: POST /admin/users. Please ask the backend team to implement this endpoint.');
                }
                throw new Error(data.message || 'Failed to create user');
            }

            return data;
        } catch (error) {
            // Handle network errors
            if (error.message.includes('Failed to fetch')) {
                throw new Error('❌ Cannot connect to backend server. Make sure the backend is running on http://localhost:3002');
            }
            console.error('Failed to create user:', error);
            throw error;
        }
    },

    /**
     * Update an existing user
     * @param {string} userId - User ID
     * @param {Object} updates - Fields to update
     * @returns {Promise<Object>} Updated user data
     */
    async updateUser(userId, updates) {
        try {
            // Transform frontend roles to backend format
            const backendData = { ...updates };
            
            // Map JUNIOR/SENIOR/SUPERVISOR to TECHNICIAN with level
            if (updates.role && ['JUNIOR', 'SENIOR', 'SUPERVISOR'].includes(updates.role.toUpperCase())) {
                backendData.role = 'TECHNICIAN';
                backendData.technicianLevel = updates.role.toUpperCase();
            }
            
            console.log('[UserService] Updating user - Frontend data:', updates);
            console.log('[UserService] Updating user - Backend data:', backendData);
            
            const response = await fetch(`${API_BASE_URL}/admin/users/${userId}`, {
                method: 'PUT',
                headers: AuthService.getAuthHeaders(),
                body: JSON.stringify(backendData)
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Failed to update user');
            }

            return data;
        } catch (error) {
            console.error('Failed to update user:', error);
            throw error;
        }
    },

    /**
     * Delete a user
     * @param {string} userId - User ID
     * @returns {Promise<Object>} Deletion confirmation
     */
    async deleteUser(userId) {
        try {
            const response = await fetch(`${API_BASE_URL}/admin/users/${userId}`, {
                method: 'DELETE',
                headers: AuthService.getAuthHeaders()
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Failed to delete user');
            }

            return data;
        } catch (error) {
            console.error('Failed to delete user:', error);
            throw error;
        }
    },

    /**
     * Update user role
     * @param {string} userId - User ID
     * @param {string} role - New role (ADMIN, DOCTOR, STUDENT)
     * @returns {Promise<Object>} Updated user data
     */
    async updateUserRole(userId, role) {
        return this.updateUser(userId, { role });
    },

    /**
     * Toggle user verification status
     * @param {string} userId - User ID
     * @param {boolean} isVerified - Verification status
     * @returns {Promise<Object>} Updated user data
     */
    async updateVerificationStatus(userId, isVerified) {
        return this.updateUser(userId, { isVerified });
    },

    /**
     * Get user statistics
     * @returns {Promise<Object>} User statistics
     */
    async getUserStats() {
        try {
            const response = await fetch(`${API_BASE_URL}/admin/users/stats`, {
                method: 'GET',
                headers: AuthService.getAuthHeaders()
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Failed to fetch user statistics');
            }

            return data;
        } catch (error) {
            console.error('Failed to fetch user statistics:', error);
            // Return mock stats if endpoint doesn't exist
            return {
                total: 0,
                active: 0,
                students: 0,
                professors: 0,
                admins: 0
            };
        }
    },

    /**
     * Validate user data
     * @param {Object} userData - User data to validate
     * @param {boolean} isUpdate - Whether this is an update operation
     * @returns {Object} { valid: boolean, errors: string[] }
     */
    validateUserData(userData, isUpdate = false) {
        const errors = [];
        
        console.log('[validateUserData] Starting validation:', { userData, isUpdate });

        // First name
        if (!isUpdate || userData.firstName !== undefined) {
            if (!userData.firstName || userData.firstName.trim().length === 0) {
                errors.push('First name is required');
                console.log('[validateUserData] First name validation failed');
            }
        }

        // Last name
        if (!isUpdate || userData.lastName !== undefined) {
            if (!userData.lastName || userData.lastName.trim().length === 0) {
                errors.push('Last name is required');
                console.log('[validateUserData] Last name validation failed');
            }
        }

        // Email
        if (!isUpdate || userData.email !== undefined) {
            const emailValid = AuthService.validateMIUEmail(userData.email);
            console.log('[validateUserData] Email validation:', { email: userData.email, valid: emailValid });
            if (!userData.email || !emailValid) {
                errors.push('Valid MIU email is required (@miuegypt.edu.eg)');
                console.log('[validateUserData] Email validation failed');
            }
        }

        // Password (only required for create)
        if (!isUpdate) {
            if (!userData.password || userData.password.trim().length === 0) {
                errors.push('Password is required');
                console.log('[validateUserData] Password is missing');
            } else {
                const passwordValidation = AuthService.validatePassword(userData.password);
                console.log('[validateUserData] Password validation:', passwordValidation);
                if (!passwordValidation.valid) {
                    errors.push(...passwordValidation.errors);
                    console.log('[validateUserData] Password validation failed');
                }
            }
        }

        // Role
        if (!isUpdate || userData.role !== undefined) {
            const validRoles = ['ADMIN', 'DOCTOR', 'JUNIOR', 'SENIOR', 'SUPERVISOR', 'STUDENT'];
            const roleValid = userData.role && validRoles.includes(userData.role.toUpperCase());
            console.log('[validateUserData] Role validation:', { role: userData.role, valid: roleValid });
            if (!roleValid) {
                errors.push('Valid role is required (ADMIN, DOCTOR, JUNIOR, SENIOR, SUPERVISOR, or STUDENT)');
                console.log('[validateUserData] Role validation failed');
            }
        }

        console.log('[validateUserData] Validation complete:', { valid: errors.length === 0, errors });

        return {
            valid: errors.length === 0,
            errors
        };
    },

    /**
     * Format role for display
     * @param {string} role - Role string
     * @returns {string} Formatted role
     */
    formatRole(role) {
        const roleMap = {
            'ADMIN': 'Administrator',
            'DOCTOR': 'Professor',
            'JUNIOR': 'Junior Technician',
            'SENIOR': 'Senior Technician',
            'SUPERVISOR': 'Supervisor',
            'STUDENT': 'Student'
        };
        return roleMap[role?.toUpperCase()] || role;
    },

    /**
     * Get role badge class
     * @param {string} role - Role string
     * @returns {string} Bootstrap badge class
     */
    getRoleBadgeClass(role) {
        const badgeMap = {
            'ADMIN': 'bg-danger',
            'DOCTOR': 'bg-warning text-dark',
            'JUNIOR': 'bg-success',
            'SENIOR': 'bg-primary',
            'SUPERVISOR': 'bg-dark',
            'STUDENT': 'bg-info'
        };
        return badgeMap[role?.toUpperCase()] || 'bg-secondary';
    }
};

// Freeze the service to prevent modifications
Object.freeze(UserService);

export default UserService;
