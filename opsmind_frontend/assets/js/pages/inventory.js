import { config } from '../config.js';

// Ensure this points to your Docker backend
const API_URL = 'http://localhost:5000/api'; 

document.addEventListener('DOMContentLoaded', () => {
    initializePage();

    // Handle Form Submit
    const form = document.getElementById('addAssetForm');
    if (form) {
        form.addEventListener('submit', handleAddAsset);
    }
});

async function initializePage() {
    await loadAssetTypes(); // Get allowed types from backend
    await loadAssets();     // Get current inventory
}

// --- 1. Load Asset Types (From Backend Config) ---
async function loadAssetTypes() {
    try {
        const response = await fetch(`${API_URL}/config`);
        if (!response.ok) return; // Fallback to HTML options if fails
        
        const data = await response.json();
        const typeSelect = document.getElementById('assetType');
        
        if (data.assetTypes && typeSelect) {
            typeSelect.innerHTML = data.assetTypes.map(t => 
                `<option value="${t.value}">${t.label}</option>`
            ).join('');
        }
    } catch (error) {
        console.warn('Could not load asset types from backend, using defaults.');
    }
}

// --- 2. Fetch & Display Assets ---
async function loadAssets() {
    const tableBody = document.getElementById('inventoryTableBody');
    
    try {
        const response = await fetch(`${API_URL}/assets`);
        if (!response.ok) throw new Error('Failed to fetch assets');
        
        const assets = await response.json();
        
        if (assets.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4">No assets found. Add one to get started!</td></tr>`;
            return;
        }

        tableBody.innerHTML = assets.map(asset => `
            <tr>
                <td>
                    <div class="d-flex align-items-center">
                        <div class="avatar-initial rounded bg-light text-primary me-3">
                            <i class="bi ${getIconForType(asset.type)}"></i>
                        </div>
                        <div>
                            <div class="fw-bold text-dark">${asset.name}</div>
                            <small class="text-muted">${asset.location || 'Unknown Location'}</small>
                        </div>
                    </div>
                </td>
                <td><span class="font-monospace">${asset.customId || 'N/A'}</span></td>
                <td><span class="badge bg-light text-dark border">${formatType(asset.type)}</span></td>
                <td>
                    <span class="badge ${getStatusBadgeClass(asset.status)}">
                        ${capitalize(asset.status || 'Available')}
                    </span>
                </td>
                <td>
                    ${asset.assignedUser ? 
                        `<div class="d-flex align-items-center">
                            <div class="avatar-xs me-2 bg-secondary text-white rounded-circle d-flex align-items-center justify-content-center" style="width:24px;height:24px;font-size:10px;">
                                <i class="bi bi-person-fill"></i>
                            </div>
                            <small>${asset.assignedUser}</small>
                        </div>` 
                        : '<span class="text-muted">-</span>'}
                </td>
                <td class="text-end">
                    <button class="btn btn-sm btn-light border" onclick="window.assignAsset('${asset.customId}')" title="Assign User">
                        <i class="bi bi-person-plus"></i>
                    </button>
                    <button class="btn btn-sm btn-light border text-danger" onclick="window.deleteAsset('${asset._id}')" title="Delete">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');

    } catch (error) {
        console.error('Error:', error);
        tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">Error loading assets. Is the backend running?</td></tr>`;
    }
}

// --- 3. Add New Asset ---
async function handleAddAsset(e) {
    e.preventDefault();
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving...';
    submitBtn.disabled = true;

    // We map the HTML inputs to the Backend Schema here
    const assetData = {
        name: document.getElementById('assetName').value,
        customId: document.getElementById('assetSerial').value, // Map Serial -> customId
        type: document.getElementById('assetType').value,
        location: document.getElementById('assetLocation')?.value || 'Central Warehouse',
        department: 'Unassigned', // Default
        quantity: 1,              // Default
        value: 0                  // Default
    };

    try {
        const response = await fetch(`${API_URL}/assets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(assetData)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || 'Failed to create asset');
        }

        // Close modal
        const modalEl = document.getElementById('addAssetModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        modal.hide();

        // Reset form & Reload list
        e.target.reset();
        loadAssets();

    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

// --- 4. Helper Functions ---

// Assign Asset (Using customId as per backend route)
window.assignAsset = async (customId) => {
    const userId = prompt("Enter User ID/Name to assign this asset to:");
    if (!userId) return;

    try {
        const response = await fetch(`${API_URL}/assets/${customId}/assign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userId })
        });
        
        if (response.ok) loadAssets();
        else alert("Failed to assign asset");
    } catch (error) {
        console.error(error);
    }
};

// Delete Asset
window.deleteAsset = async (id) => {
    if (!confirm('Are you sure you want to delete this asset?')) return;

    try {
        await fetch(`${API_URL}/assets/${id}`, { method: 'DELETE' });
        loadAssets();
    } catch (error) {
        console.error(error);
    }
};

function getStatusBadgeClass(status) {
    if (!status) return 'bg-secondary';
    switch (status.toLowerCase()) {
        case 'available': return 'bg-success-subtle text-success';
        case 'assigned': return 'bg-primary-subtle text-primary';
        case 'repair': return 'bg-warning-subtle text-warning';
        case 'broken': return 'bg-danger-subtle text-danger';
        default: return 'bg-secondary';
    }
}

function getIconForType(type) {
    if (!type) return 'bi-box-seam';
    const t = type.toLowerCase();
    if (t.includes('laptop')) return 'bi-laptop';
    if (t.includes('desktop') || t.includes('pc')) return 'bi-pc-display';
    if (t.includes('server')) return 'bi-hdd-network';
    if (t.includes('printer')) return 'bi-printer';
    if (t.includes('network') || t.includes('router')) return 'bi-router';
    return 'bi-box-seam';
}

function formatType(type) {
    return type.charAt(0).toUpperCase() + type.slice(1);
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
