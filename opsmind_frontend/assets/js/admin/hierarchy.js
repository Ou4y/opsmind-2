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
}

/**
 * Load all hierarchy data
 */
async function loadAllData() {
    showLoading();
    
    try {
        // Load technicians by level in parallel
        const [supervisorsRes, seniorsRes, juniorsRes, treeRes] = await Promise.all([
            getTechniciansByLevel('SUPERVISOR'),
            getTechniciansByLevel('SENIOR'),
            getTechniciansByLevel('JUNIOR'),
            getHierarchyTree()
        ]);

        // Store data
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

    // Process each supervisor
    state.hierarchyTree.forEach(supervisor => {
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

    if (!state.hierarchyTree || state.hierarchyTree.length === 0) {
        if (emptyEl) emptyEl.classList.remove('d-none');
        if (treeEl) treeEl.innerHTML = '';
        return;
    }

    if (emptyEl) emptyEl.classList.add('d-none');
    if (!treeEl) return;

    let html = '<div class="hierarchy-container">';

    state.hierarchyTree.forEach(supervisor => {
        const supervisorName = supervisor.name || `Supervisor #${supervisor.userId}`;
        const seniorCount = supervisor.seniors?.length || 0;
        
        html += `
            <div class="hierarchy-node supervisor-node mb-4">
                <div class="node-card card border-primary">
                    <div class="card-body">
                        <div class="d-flex align-items-center">
                            <div class="avatar-circle bg-primary text-white me-3">
                                ${supervisorName.charAt(0).toUpperCase()}
                            </div>
                            <div>
                                <h6 class="mb-0">${UI.escapeHTML(supervisorName)}</h6>
                                <small class="text-muted">
                                    <i class="bi bi-diagram-3 me-1"></i>
                                    ${seniorCount} senior${seniorCount !== 1 ? 's' : ''}
                                </small>
                            </div>
                        </div>
                    </div>
                </div>
        `;

        // Render seniors under this supervisor
        if (supervisor.seniors && supervisor.seniors.length > 0) {
            html += '<div class="hierarchy-children ms-4 mt-3">';
            
            supervisor.seniors.forEach(senior => {
                const seniorName = senior.name || `Senior #${senior.userId}`;
                const juniorCount = senior.juniors?.length || 0;
                
                html += `
                    <div class="hierarchy-node senior-node mb-3">
                        <div class="node-card card border-success">
                            <div class="card-body p-3">
                                <div class="d-flex align-items-center">
                                    <div class="avatar-circle bg-success text-white me-2" style="width: 32px; height: 32px; font-size: 0.875rem;">
                                        ${seniorName.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <div class="fw-semibold">${UI.escapeHTML(seniorName)}</div>
                                        <small class="text-muted">
                                            <i class="bi bi-people me-1"></i>
                                            ${juniorCount} junior${juniorCount !== 1 ? 's' : ''}
                                        </small>
                                    </div>
                                </div>
                            </div>
                        </div>
                `;

                // Render juniors under this senior
                if (senior.juniors && senior.juniors.length > 0) {
                    html += '<div class="hierarchy-children ms-4 mt-2">';
                    
                    senior.juniors.forEach(junior => {
                        const juniorName = junior.name || `Junior #${junior.userId}`;
                        
                        html += `
                            <div class="hierarchy-node junior-node mb-2">
                                <div class="node-card card border-info">
                                    <div class="card-body p-2">
                                        <div class="d-flex align-items-center">
                                            <div class="avatar-circle bg-info text-white me-2" style="width: 28px; height: 28px; font-size: 0.75rem;">
                                                ${juniorName.charAt(0).toUpperCase()}
                                            </div>
                                            <div class="small">${UI.escapeHTML(juniorName)}</div>
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

    html += '</div>'; // Close hierarchy container

    treeEl.innerHTML = html;
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
            'JUNIOR': 'info',
            'SENIOR': 'success',
            'SUPERVISOR': 'primary'
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
        
        // Add juniors and seniors as potential subordinates
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
    }

    if (createManagerSelect) {
        createManagerSelect.innerHTML = '<option value="">Select manager...</option>';
        
        // Add seniors and supervisors as potential managers
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
