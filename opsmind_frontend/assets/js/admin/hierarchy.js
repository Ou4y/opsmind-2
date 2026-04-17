/**
 * OpsMind - Admin Hierarchy Management Module
 * 
 * Manages technician reporting relationships:
 * - Junior → Senior assignments
 * - Senior → Supervisor assignments
 * - View hierarchy tree
 * - Create, update, delete relationships
 */

import UI from '../ui.js';
import {
    getTechniciansByLevel,
    getHierarchyTree,
    getDirectReports,
    createHierarchyRelationship,
    updateHierarchyRelationship,
    deleteHierarchyRelationship
} from '../../services/workflowService.js';
import AuthService from '../../services/authService.js';

/**
 * Page state
 */
const state = {
    admins: [],
    supervisors: [],
    seniors: [],
    juniors: [],
    hierarchyTree: null,
    relationships: [],
    currentUser: null,
    modals: {}
};

/**
 * Initialize the hierarchy management page
 */
export async function initHierarchyManagement() {
    // Wait for app to be ready
    await waitForApp();
    
    // Get current user
    state.currentUser = AuthService.getCurrentUser();
    if (!state.currentUser) {
        window.location.href = '/index.html';
        return;
    }

    // Check if user is admin
    if (!AuthService.isAdmin()) {
        UI.showToast('Access denied. Admin privileges required.', 'error');
        setTimeout(() => window.location.href = '/dashboard.html', 2000);
        return;
    }

    // Initialize modals
    initializeModals();
    
    // Set up event listeners
    setupEventListeners();
    
    // Load initial data
    await loadAllData();
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
 * Initialize Bootstrap modals
 */
function initializeModals() {
    state.modals.create = new bootstrap.Modal(document.getElementById('createRelationshipModal'));
    state.modals.edit = new bootstrap.Modal(document.getElementById('editRelationshipModal'));
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
    // Refresh button
    document.getElementById('refreshBtn')?.addEventListener('click', async () => {
        UI.showToast('Refreshing data...', 'info');
        await loadAllData();
    });

    // Create relationship button
    document.getElementById('createRelationshipBtn')?.addEventListener('click', handleCreateRelationship);

    // Update relationship button
    document.getElementById('updateRelationshipBtn')?.addEventListener('click', handleUpdateRelationship);

    // Form change listeners for dynamic validation
    document.getElementById('createSubordinateId')?.addEventListener('change', updateManagerOptions);
    
    // Expand/Collapse all buttons
    document.getElementById('expandAllBtn')?.addEventListener('click', expandAllNodes);
    document.getElementById('collapseAllBtn')?.addEventListener('click', collapseAllNodes);
}

/**
 * Load all hierarchy data
 */
async function loadAllData() {
    showLoading();
    
    try {
        // Load technicians by level in parallel
        const [adminsRes, supervisorsRes, seniorsRes, juniorsRes, treeRes] = await Promise.all([
            getTechniciansByLevel('ADMIN'),
            getTechniciansByLevel('SUPERVISOR'),
            getTechniciansByLevel('SENIOR'),
            getTechniciansByLevel('JUNIOR'),
            getHierarchyTree()
        ]);

        // Store data
        state.admins = adminsRes.success ? (adminsRes.data || []) : [];
        state.supervisors = supervisorsRes.success ? (supervisorsRes.data || []) : [];
        state.seniors = seniorsRes.success ? (seniorsRes.data || []) : [];
        state.juniors = juniorsRes.success ? (juniorsRes.data || []) : [];
        state.hierarchyTree = treeRes.success ? (treeRes.data || []) : [];

        // Extract relationships from hierarchy tree
        extractRelationships();

        // Hide loading, show content
        hideLoading();

        // Render all sections
        renderTechniciansByLevel();
        renderHierarchyTree();
        renderRelationshipsTable();
        populateFormOptions();

    } catch (error) {
        console.error('Error loading hierarchy data:', error);
        showError(error.message || 'Failed to load hierarchy data');
    }
}

/**
 * Extract relationships from hierarchy tree for table display
 */
function extractRelationships() {
    state.relationships = [];
    let relationshipId = 1;

    if (!state.hierarchyTree || state.hierarchyTree.length === 0) {
        return;
    }

    // Get admin info if exists
    const admin = state.admins && state.admins.length > 0 ? state.admins[0] : null;

    // Process each supervisor
    state.hierarchyTree.forEach(supervisor => {
        // Add supervisor → admin relationship if admin exists
        if (admin) {
            state.relationships.push({
                id: supervisor.relationshipId || relationshipId++,
                subordinateId: supervisor.userId,
                subordinateName: supervisor.name || `Supervisor #${supervisor.userId}`,
                subordinateRole: 'SUPERVISOR',
                managerId: admin.userId || admin.id,
                managerName: admin.name || admin.username || `Admin #${admin.userId || admin.id}`,
                managerRole: 'ADMIN',
                createdAt: supervisor.createdAt || new Date().toISOString()
            });
        }
        
        if (supervisor.seniors && supervisor.seniors.length > 0) {
            supervisor.seniors.forEach(senior => {
                // Add senior → supervisor relationship
                state.relationships.push({
                    id: senior.relationshipId || relationshipId++,
                    subordinateId: senior.userId,
                    subordinateName: senior.name,
                    subordinateRole: 'SENIOR',
                    managerId: supervisor.userId,
                    managerName: supervisor.name,
                    managerRole: 'SUPERVISOR',
                    createdAt: senior.createdAt || new Date().toISOString()
                });

                // Process juniors under this senior
                if (senior.juniors && senior.juniors.length > 0) {
                    senior.juniors.forEach(junior => {
                        // Add junior → senior relationship
                        state.relationships.push({
                            id: junior.relationshipId || relationshipId++,
                            subordinateId: junior.userId,
                            subordinateName: junior.name,
                            subordinateRole: 'JUNIOR',
                            managerId: senior.userId,
                            managerName: senior.name,
                            managerRole: 'SENIOR',
                            createdAt: junior.createdAt || new Date().toISOString()
                        });
                    });
                }
            });
        }
    });
}

/**
 * Show loading state
 */
function showLoading() {
    document.getElementById('pageLoading')?.classList.remove('d-none');
    document.getElementById('pageContent')?.classList.add('d-none');
    document.getElementById('pageError')?.classList.add('d-none');
}

/**
 * Hide loading, show content
 */
function hideLoading() {
    document.getElementById('pageLoading')?.classList.add('d-none');
    document.getElementById('pageContent')?.classList.remove('d-none');
}

/**
 * Show error state
 */
function showError(message) {
    document.getElementById('pageLoading')?.classList.add('d-none');
    document.getElementById('pageContent')?.classList.add('d-none');
    document.getElementById('pageError')?.classList.remove('d-none');
    document.getElementById('errorMessage').textContent = message;
}

/**
 * Render technicians grouped by level
 */
function renderTechniciansByLevel() {
    // Render admins
    renderTechnicianList('admins', state.admins, 'danger');
    
    // Render supervisors
    renderTechnicianList('supervisors', state.supervisors, 'primary');
    
    // Render seniors
    renderTechnicianList('seniors', state.seniors, 'success');
    
    // Render juniors
    renderTechnicianList('juniors', state.juniors, 'info');
}

/**
 * Render a list of technicians
 */
function renderTechnicianList(level, technicians, color) {
    const loadingEl = document.getElementById(`${level}Loading`);
    const emptyEl = document.getElementById(`${level}Empty`);
    const listEl = document.getElementById(`${level}List`);

    if (loadingEl) loadingEl.classList.add('d-none');

    if (!technicians || technicians.length === 0) {
        if (emptyEl) emptyEl.classList.remove('d-none');
        if (listEl) listEl.innerHTML = '';
        return;
    }

    if (emptyEl) emptyEl.classList.add('d-none');
    if (!listEl) return;

    listEl.innerHTML = '';

    technicians.forEach(tech => {
        const item = document.createElement('div');
        item.className = 'list-group-item list-group-item-action';
        
        const name = tech.name || tech.username || `User #${tech.userId || tech.id}`;
        const email = tech.email || 'No email';
        
        item.innerHTML = `
            <div class="d-flex align-items-center">
                <div class="avatar-circle bg-${color} text-white me-2" style="width: 32px; height: 32px; font-size: 0.875rem;">
                    ${name.charAt(0).toUpperCase()}
                </div>
                <div class="flex-grow-1">
                    <div class="fw-semibold">${UI.escapeHTML(name)}</div>
                    <small class="text-muted">${UI.escapeHTML(email)}</small>
                </div>
                <span class="badge bg-${color}-subtle text-${color}">
                    ${level.slice(0, -1).toUpperCase()}
                </span>
            </div>
        `;

        listEl.appendChild(item);
    });
}

/**
 * Render hierarchy tree
 */
function renderHierarchyTree() {
    const loadingEl = document.getElementById('hierarchyTreeLoading');
    const emptyEl = document.getElementById('hierarchyTreeEmpty');
    const treeEl = document.getElementById('hierarchyTree');

    if (loadingEl) loadingEl.classList.add('d-none');

    // Check if we have any hierarchy data
    const hasData = state.hierarchyTree && state.hierarchyTree.length > 0;
    
    if (!hasData) {
        if (emptyEl) emptyEl.classList.remove('d-none');
        if (treeEl) treeEl.innerHTML = '';
        return;
    }

    if (emptyEl) emptyEl.classList.add('d-none');
    if (!treeEl) return;

    // Build the hierarchy tree HTML with Admin level
    let html = '<div class="hierarchy-container">';

    // Render Admin level (if exists)
    if (state.admins && state.admins.length > 0) {
        state.admins.forEach(admin => {
            const adminName = admin.name || admin.username || `Admin #${admin.userId || admin.id}`;
            const adminEmail = admin.email || '';
            
            // Count supervisors under this admin
            const supervisorCount = state.hierarchyTree.length;
            
            html += `
                <div class="tree-node admin-node">
                    <div class="node-card">
                        <div class="card-body p-4">
                            <div class="d-flex align-items-center">
                                <div class="avatar-circle text-white me-3">
                                    ${adminName.charAt(0).toUpperCase()}
                                </div>
                                <div class="flex-grow-1">
                                    <div class="d-flex align-items-center gap-2 mb-1">
                                        <h5 class="mb-0 fw-bold">${UI.escapeHTML(adminName)}</h5>
                                        <span class="role-badge role-badge-admin">ADMIN</span>
                                    </div>
                                    <div class="text-muted small">
                                        <i class="bi bi-envelope me-1"></i>${UI.escapeHTML(adminEmail)}
                                    </div>
                                </div>
                                <div class="text-end">
                                    <span class="stats-badge">
                                        <i class="bi bi-diagram-3"></i>
                                        <span>${supervisorCount} supervisor${supervisorCount !== 1 ? 's' : ''}</span>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
            `;

            // Render supervisors under admin
            if (supervisorCount > 0) {
                html += '<div class="tree-children">';
                html += renderSupervisors();
                html += '</div>';
            }

            html += '</div>'; // Close admin node
        });
    } else {
        // No admin, just render supervisors at root
        html += renderSupervisors();
    }

    html += '</div>'; // Close hierarchy container

    treeEl.innerHTML = html;
    
    // Auto-collapse senior nodes by default to keep juniors hidden initially
    // This keeps the view clean when there are many juniors
    setTimeout(() => {
        document.querySelectorAll('.senior-node').forEach(node => {
            if (node.querySelector('.tree-children')) {
                node.classList.add('collapsed');
                const icon = node.querySelector('.collapse-toggle i');
                if (icon) {
                    icon.classList.remove('bi-chevron-down');
                    icon.classList.add('bi-chevron-right');
                }
            }
        });
    }, 0);
}

/**
 * Render supervisors and their subordinates
 */
function renderSupervisors() {
    let html = '';
    
    state.hierarchyTree.forEach((supervisor, index) => {
        const supervisorName = supervisor.name || `Supervisor #${supervisor.userId}`;
        const supervisorEmail = supervisor.email || '';
        const seniorCount = supervisor.seniors?.length || 0;
        const isLast = index === state.hierarchyTree.length - 1;
        const supervisorId = `supervisor-${supervisor.userId}`;
        
        html += `
            <div class="tree-node supervisor-node" id="${supervisorId}">
                <div class="node-card">
                    <div class="card-body p-3">
                        <div class="d-flex align-items-center">
                            <div class="avatar-circle text-white me-3">
                                ${supervisorName.charAt(0).toUpperCase()}
                            </div>
                            <div class="flex-grow-1">
                                <div class="d-flex align-items-center gap-2 mb-1">
                                    <h6 class="mb-0 fw-semibold">${UI.escapeHTML(supervisorName)}</h6>
                                    <span class="role-badge role-badge-supervisor">SUPERVISOR</span>
                                </div>
                                <div class="text-muted small">
                                    ${supervisorEmail ? `<i class="bi bi-envelope me-1"></i>${UI.escapeHTML(supervisorEmail)}` : ''}
                                </div>
                            </div>
                            <div class="text-end d-flex align-items-center gap-2">
                                <span class="stats-badge">
                                    <i class="bi bi-people"></i>
                                    <span>${seniorCount} senior${seniorCount !== 1 ? 's' : ''}</span>
                                </span>
                                ${seniorCount > 0 ? `
                                    <span class="collapse-toggle" onclick="toggleTreeNode('${supervisorId}')" title="Expand/Collapse">
                                        <i class="bi bi-chevron-down"></i>
                                    </span>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                </div>
        `;

        // Render seniors under this supervisor
        if (supervisor.seniors && supervisor.seniors.length > 0) {
            html += '<div class="tree-children">';
            
            supervisor.seniors.forEach((senior, seniorIndex) => {
                const seniorName = senior.name || `Senior #${senior.userId}`;
                const seniorEmail = senior.email || '';
                const juniorCount = senior.juniors?.length || 0;
                const isSeniorLast = seniorIndex === supervisor.seniors.length - 1;
                const seniorId = `senior-${senior.userId}`;
                
                html += `
                    <div class="tree-node senior-node" id="${seniorId}">
                        <div class="node-card">
                            <div class="card-body p-3">
                                <div class="d-flex align-items-center">
                                    <div class="avatar-circle text-white me-2">
                                        ${seniorName.charAt(0).toUpperCase()}
                                    </div>
                                    <div class="flex-grow-1">
                                        <div class="d-flex align-items-center gap-2 mb-1">
                                            <div class="fw-semibold">${UI.escapeHTML(seniorName)}</div>
                                            <span class="role-badge role-badge-senior">SENIOR</span>
                                        </div>
                                        <div class="text-muted small">
                                            ${seniorEmail ? `<i class="bi bi-envelope me-1"></i>${UI.escapeHTML(seniorEmail)}` : ''}
                                        </div>
                                    </div>
                                    <div class="text-end d-flex align-items-center gap-2">
                                        <span class="stats-badge">
                                            <i class="bi bi-person-badge"></i>
                                            <span>${juniorCount} junior${juniorCount !== 1 ? 's' : ''}</span>
                                        </span>
                                        ${juniorCount > 0 ? `
                                            <span class="collapse-toggle" onclick="toggleTreeNode('${seniorId}')" title="Expand/Collapse">
                                                <i class="bi bi-chevron-down"></i>
                                            </span>
                                        ` : ''}
                                    </div>
                                </div>
                            </div>
                        </div>
                `;

                // Render juniors under this senior
                if (senior.juniors && senior.juniors.length > 0) {
                    html += '<div class="tree-children">';
                    
                    senior.juniors.forEach((junior, juniorIndex) => {
                        const juniorName = junior.name || `Junior #${junior.userId}`;
                        const juniorEmail = junior.email || '';
                        const isJuniorLast = juniorIndex === senior.juniors.length - 1;
                        
                        html += `
                            <div class="tree-node junior-node">
                                <div class="node-card">
                                    <div class="card-body p-2">
                                        <div class="d-flex align-items-center">
                                            <div class="avatar-circle text-white me-2">
                                                ${juniorName.charAt(0).toUpperCase()}
                                            </div>
                                            <div class="flex-grow-1">
                                                <div class="d-flex align-items-center gap-2">
                                                    <div class="small fw-medium">${UI.escapeHTML(juniorName)}</div>
                                                    <span class="role-badge role-badge-junior">JUNIOR</span>
                                                </div>
                                                ${juniorEmail ? `<div class="text-muted" style="font-size: 0.75rem;"><i class="bi bi-envelope me-1"></i>${UI.escapeHTML(juniorEmail)}</div>` : ''}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        `;
                    });
                    
                    html += '</div>'; // Close juniors children
                }

                html += '</div>'; // Close senior node
            });
            
            html += '</div>'; // Close seniors children
        }

        html += '</div>'; // Close supervisor node
    });
    
    return html;
}

/**
 * Toggle tree node collapse/expand (global function)
 */
window.toggleTreeNode = function(nodeId) {
    const node = document.getElementById(nodeId);
    if (!node) return;
    
    const isCollapsed = node.classList.contains('collapsed');
    
    if (isCollapsed) {
        // Expand
        node.classList.remove('collapsed');
        const icon = node.querySelector('.collapse-toggle i');
        if (icon) {
            icon.classList.remove('bi-chevron-right');
            icon.classList.add('bi-chevron-down');
        }
    } else {
        // Collapse
        node.classList.add('collapsed');
        const icon = node.querySelector('.collapse-toggle i');
        if (icon) {
            icon.classList.remove('bi-chevron-down');
            icon.classList.add('bi-chevron-right');
        }
    }
};

/**
 * Expand all tree nodes
 */
function expandAllNodes() {
    document.querySelectorAll('.tree-node.collapsed').forEach(node => {
        node.classList.remove('collapsed');
        const icon = node.querySelector('.collapse-toggle i');
        if (icon) {
            icon.classList.remove('bi-chevron-right');
            icon.classList.add('bi-chevron-down');
        }
    });
    UI.showToast('All nodes expanded', 'success');
}

/**
 * Collapse all tree nodes
 */
function collapseAllNodes() {
    document.querySelectorAll('.tree-node:not(.admin-node)').forEach(node => {
        if (node.querySelector('.tree-children')) {
            node.classList.add('collapsed');
            const icon = node.querySelector('.collapse-toggle i');
            if (icon) {
                icon.classList.remove('bi-chevron-down');
                icon.classList.add('bi-chevron-right');
            }
        }
    });
    UI.showToast('All nodes collapsed', 'success');
}

/**
 * Render relationships table
 */
function renderRelationshipsTable() {
    const emptyEl = document.getElementById('relationshipsEmpty');
    const tableBodyEl = document.getElementById('relationshipsTableBody');
    const countEl = document.getElementById('relationshipCount');

    if (countEl) {
        countEl.textContent = state.relationships.length;
    }

    if (state.relationships.length === 0) {
        if (emptyEl) emptyEl.classList.remove('d-none');
        if (tableBodyEl) tableBodyEl.innerHTML = '';
        return;
    }

    if (emptyEl) emptyEl.classList.add('d-none');
    if (!tableBodyEl) return;

    tableBodyEl.innerHTML = '';

    state.relationships.forEach(rel => {
        const row = document.createElement('tr');
        
        const roleColorMap = {
            'ADMIN': 'danger',
            'SUPERVISOR': 'primary',
            'SENIOR': 'success',
            'JUNIOR': 'info'
        };

        const subordinateColor = roleColorMap[rel.subordinateRole] || 'secondary';
        const managerColor = roleColorMap[rel.managerRole] || 'secondary';

        row.innerHTML = `
            <td>${rel.id}</td>
            <td>${UI.escapeHTML(rel.subordinateName)}</td>
            <td><span class="badge bg-${subordinateColor}">${rel.subordinateRole}</span></td>
            <td>${UI.escapeHTML(rel.managerName)}</td>
            <td><span class="badge bg-${managerColor}">${rel.managerRole}</span></td>
            <td>${UI.formatDate(rel.createdAt)}</td>
            <td>
                <button class="btn btn-sm btn-outline-primary me-1" 
                        onclick="window.editRelationship(${rel.id})"
                        title="Edit relationship">
                    <i class="bi bi-pencil"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" 
                        onclick="window.deleteRelationship(${rel.id})"
                        title="Delete relationship">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        `;

        tableBodyEl.appendChild(row);
    });
}

/**
 * Populate form select options
 */
function populateFormOptions() {
    // Populate create form
    const createSubordinateSelect = document.getElementById('createSubordinateId');
    const createManagerSelect = document.getElementById('createManagerId');

    if (createSubordinateSelect) {
        createSubordinateSelect.innerHTML = '<option value="">Select subordinate...</option>';
        
        // Add supervisors, seniors, and juniors as potential subordinates
        const subordinateGroup1 = document.createElement('optgroup');
        subordinateGroup1.label = 'Juniors';
        state.juniors.forEach(junior => {
            const option = document.createElement('option');
            option.value = junior.userId || junior.id;
            option.textContent = junior.name || junior.username || `User #${junior.userId || junior.id}`;
            option.dataset.role = 'JUNIOR';
            subordinateGroup1.appendChild(option);
        });
        if (state.juniors.length > 0) {
            createSubordinateSelect.appendChild(subordinateGroup1);
        }

        const subordinateGroup2 = document.createElement('optgroup');
        subordinateGroup2.label = 'Seniors';
        state.seniors.forEach(senior => {
            const option = document.createElement('option');
            option.value = senior.userId || senior.id;
            option.textContent = senior.name || senior.username || `User #${senior.userId || senior.id}`;
            option.dataset.role = 'SENIOR';
            subordinateGroup2.appendChild(option);
        });
        if (state.seniors.length > 0) {
            createSubordinateSelect.appendChild(subordinateGroup2);
        }

        const subordinateGroup3 = document.createElement('optgroup');
        subordinateGroup3.label = 'Supervisors';
        state.supervisors.forEach(supervisor => {
            const option = document.createElement('option');
            option.value = supervisor.userId || supervisor.id;
            option.textContent = supervisor.name || supervisor.username || `User #${supervisor.userId || supervisor.id}`;
            option.dataset.role = 'SUPERVISOR';
            subordinateGroup3.appendChild(option);
        });
        if (state.supervisors.length > 0) {
            createSubordinateSelect.appendChild(subordinateGroup3);
        }
    }

    if (createManagerSelect) {
        createManagerSelect.innerHTML = '<option value="">Select manager...</option>';
        
        // Add admins, seniors, and supervisors as potential managers
        const managerGroup1 = document.createElement('optgroup');
        managerGroup1.label = 'Seniors';
        state.seniors.forEach(senior => {
            const option = document.createElement('option');
            option.value = senior.userId || senior.id;
            option.textContent = senior.name || senior.username || `User #${senior.userId || senior.id}`;
            option.dataset.role = 'SENIOR';
            managerGroup1.appendChild(option);
        });
        if (state.seniors.length > 0) {
            createManagerSelect.appendChild(managerGroup1);
        }

        const managerGroup2 = document.createElement('optgroup');
        managerGroup2.label = 'Supervisors';
        state.supervisors.forEach(supervisor => {
            const option = document.createElement('option');
            option.value = supervisor.userId || supervisor.id;
            option.textContent = supervisor.name || supervisor.username || `User #${supervisor.userId || supervisor.id}`;
            option.dataset.role = 'SUPERVISOR';
            managerGroup2.appendChild(option);
        });
        if (state.supervisors.length > 0) {
            createManagerSelect.appendChild(managerGroup2);
        }

        const managerGroup3 = document.createElement('optgroup');
        managerGroup3.label = 'Admins';
        state.admins.forEach(admin => {
            const option = document.createElement('option');
            option.value = admin.userId || admin.id;
            option.textContent = admin.name || admin.username || `User #${admin.userId || admin.id}`;
            option.dataset.role = 'ADMIN';
            managerGroup3.appendChild(option);
        });
        if (state.admins.length > 0) {
            createManagerSelect.appendChild(managerGroup3);
        }
    }
}

/**
 * Update manager options based on selected subordinate
 */
function updateManagerOptions() {
    const subordinateSelect = document.getElementById('createSubordinateId');
    const managerSelect = document.getElementById('createManagerId');

    if (!subordinateSelect || !managerSelect) return;

    const selectedOption = subordinateSelect.options[subordinateSelect.selectedIndex];
    const subordinateRole = selectedOption?.dataset.role;

    // Clear and rebuild manager options based on subordinate role
    managerSelect.innerHTML = '<option value="">Select manager...</option>';

    if (subordinateRole === 'JUNIOR') {
        // Juniors can only report to seniors
        const seniorGroup = document.createElement('optgroup');
        seniorGroup.label = 'Seniors';
        state.seniors.forEach(senior => {
            const option = document.createElement('option');
            option.value = senior.userId || senior.id;
            option.textContent = senior.name || senior.username || `User #${senior.userId || senior.id}`;
            option.dataset.role = 'SENIOR';
            seniorGroup.appendChild(option);
        });
        if (state.seniors.length > 0) {
            managerSelect.appendChild(seniorGroup);
        }
    } else if (subordinateRole === 'SENIOR') {
        // Seniors can only report to supervisors
        const supervisorGroup = document.createElement('optgroup');
        supervisorGroup.label = 'Supervisors';
        state.supervisors.forEach(supervisor => {
            const option = document.createElement('option');
            option.value = supervisor.userId || supervisor.id;
            option.textContent = supervisor.name || supervisor.username || `User #${supervisor.userId || supervisor.id}`;
            option.dataset.role = 'SUPERVISOR';
            supervisorGroup.appendChild(option);
        });
        if (state.supervisors.length > 0) {
            managerSelect.appendChild(supervisorGroup);
        }
    } else if (subordinateRole === 'SUPERVISOR') {
        // Supervisors can only report to admins
        const adminGroup = document.createElement('optgroup');
        adminGroup.label = 'Admins';
        state.admins.forEach(admin => {
            const option = document.createElement('option');
            option.value = admin.userId || admin.id;
            option.textContent = admin.name || admin.username || `User #${admin.userId || admin.id}`;
            option.dataset.role = 'ADMIN';
            adminGroup.appendChild(option);
        });
        if (state.admins.length > 0) {
            managerSelect.appendChild(adminGroup);
        }
    }
}

/**
 * Handle create relationship
 */
async function handleCreateRelationship() {
    const form = document.getElementById('createRelationshipForm');
    
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const subordinateId = parseInt(document.getElementById('createSubordinateId').value);
    const managerId = parseInt(document.getElementById('createManagerId').value);

    if (!subordinateId || !managerId) {
        UI.showToast('Please select both subordinate and manager', 'warning');
        return;
    }

    // Validation: prevent self-assignment
    if (subordinateId === managerId) {
        UI.showToast('A technician cannot report to themselves', 'error');
        return;
    }

    UI.showToast('Creating relationship...', 'info');

    try {
        const response = await createHierarchyRelationship({
            subordinate_id: subordinateId,
            manager_id: managerId
        });

        if (response.success) {
            UI.showToast('Relationship created successfully!', 'success');
            state.modals.create.hide();
            form.reset();
            await loadAllData();
        } else {
            throw new Error(response.message || 'Failed to create relationship');
        }
    } catch (error) {
        console.error('Error creating relationship:', error);
        UI.showToast(error.message || 'Failed to create relationship', 'error');
    }
}

/**
 * Edit relationship (global function)
 */
window.editRelationship = function(relationshipId) {
    const relationship = state.relationships.find(r => r.id === relationshipId);
    
    if (!relationship) {
        UI.showToast('Relationship not found', 'error');
        return;
    }

    // Populate edit form
    document.getElementById('editRelationshipId').value = relationshipId;
    document.getElementById('editCurrentSubordinate').value = 
        `${relationship.subordinateName} (${relationship.subordinateRole})`;

    // Populate manager options based on subordinate role
    const managerSelect = document.getElementById('editManagerId');
    managerSelect.innerHTML = '<option value="">Select new manager...</option>';

    if (relationship.subordinateRole === 'JUNIOR') {
        // Can reassign to different senior
        state.seniors.forEach(senior => {
            const option = document.createElement('option');
            option.value = senior.userId || senior.id;
            option.textContent = senior.name || senior.username || `User #${senior.userId || senior.id}`;
            if ((senior.userId || senior.id) === relationship.managerId) {
                option.selected = true;
            }
            managerSelect.appendChild(option);
        });
    } else if (relationship.subordinateRole === 'SENIOR') {
        // Can reassign to different supervisor
        state.supervisors.forEach(supervisor => {
            const option = document.createElement('option');
            option.value = supervisor.userId || supervisor.id;
            option.textContent = supervisor.name || supervisor.username || `User #${supervisor.userId || supervisor.id}`;
            if ((supervisor.userId || supervisor.id) === relationship.managerId) {
                option.selected = true;
            }
            managerSelect.appendChild(option);
        });
    } else if (relationship.subordinateRole === 'SUPERVISOR') {
        // Can reassign to different admin
        state.admins.forEach(admin => {
            const option = document.createElement('option');
            option.value = admin.userId || admin.id;
            option.textContent = admin.name || admin.username || `User #${admin.userId || admin.id}`;
            if ((admin.userId || admin.id) === relationship.managerId) {
                option.selected = true;
            }
            managerSelect.appendChild(option);
        });
    }

    state.modals.edit.show();
};

/**
 * Handle update relationship
 */
async function handleUpdateRelationship() {
    const form = document.getElementById('editRelationshipForm');
    
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const relationshipId = parseInt(document.getElementById('editRelationshipId').value);
    const newManagerId = parseInt(document.getElementById('editManagerId').value);

    if (!relationshipId || !newManagerId) {
        UI.showToast('Invalid relationship or manager selection', 'warning');
        return;
    }

    UI.showToast('Updating relationship...', 'info');

    try {
        const response = await updateHierarchyRelationship(relationshipId, {
            manager_id: newManagerId
        });

        if (response.success) {
            UI.showToast('Relationship updated successfully!', 'success');
            state.modals.edit.hide();
            form.reset();
            await loadAllData();
        } else {
            throw new Error(response.message || 'Failed to update relationship');
        }
    } catch (error) {
        console.error('Error updating relationship:', error);
        UI.showToast(error.message || 'Failed to update relationship', 'error');
    }
}

/**
 * Delete relationship (global function)
 */
window.deleteRelationship = async function(relationshipId) {
    const relationship = state.relationships.find(r => r.id === relationshipId);
    
    if (!relationship) {
        UI.showToast('Relationship not found', 'error');
        return;
    }

    const confirmMsg = `Are you sure you want to remove the relationship:\n\n` +
                      `${relationship.subordinateName} (${relationship.subordinateRole}) → ` +
                      `${relationship.managerName} (${relationship.managerRole})\n\n` +
                      `This action cannot be undone.`;

    if (!confirm(confirmMsg)) {
        return;
    }

    UI.showToast('Deleting relationship...', 'info');

    try {
        const response = await deleteHierarchyRelationship(relationshipId);

        if (response.success) {
            UI.showToast('Relationship deleted successfully!', 'success');
            await loadAllData();
        } else {
            throw new Error(response.message || 'Failed to delete relationship');
        }
    } catch (error) {
        console.error('Error deleting relationship:', error);
        UI.showToast(error.message || 'Failed to delete relationship', 'error');
    }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHierarchyManagement);
} else {
    initHierarchyManagement();
}
