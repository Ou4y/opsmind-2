import { config } from '../config.js';

// ✅ POINTING TO THE NEW INVENTORY SERVICE PORT
const API_URL = 'http://localhost:5000/api';

// Backend Constants
const BUILDINGS = [
  'Central Warehouse', 
  'Main Building', 
  'K Building', 
  'N Building', 
  'S Building', 
  'R Building', 
  'Pharmacy Building'
];

const DEPARTMENTS = [
  'Computer Science', 
  'Engineering', 
  'Architecture', 
  'Business', 
  'Mass Comm', 
  'Alsun', 
  'Pharmacy', 
  'Dentistry', 
  'Unassigned'
];

const ASSET_TYPES = [
  // IT & Computing
  { value: 'laptop', label: 'Laptop', category: 'IT & Computing' },
  { value: 'desktop', label: 'Desktop PC', category: 'IT & Computing' },
  { value: 'monitor', label: 'Monitor', category: 'IT & Computing' },
  { value: 'server', label: 'Server', category: 'IT & Computing' },
  { value: 'tablet', label: 'Tablet / iPad', category: 'IT & Computing' },
  { value: 'peripheral', label: 'Peripheral (Keyboard/Mouse)', category: 'IT & Computing' },
  
  // AV & Classroom
  { value: 'projector', label: 'Projector', category: 'AV & Classroom' },
  { value: 'smartboard', label: 'Smartboard', category: 'AV & Classroom' },
  { value: 'camera', label: 'Camera', category: 'AV & Classroom' },
  { value: 'microphone', label: 'Microphone', category: 'AV & Classroom' },
  { value: 'speaker', label: 'Speaker System', category: 'AV & Classroom' },

  // Networking
  { value: 'router', label: 'Router', category: 'Networking' },
  { value: 'switch', label: 'Network Switch', category: 'Networking' },
  { value: 'access_point', label: 'Access Point (WiFi)', category: 'Networking' },
  { value: 'firewall', label: 'Firewall Appliance', category: 'Networking' },

  // Office & Furniture
  { value: 'printer', label: 'Printer', category: 'Office & Furniture' },
  { value: 'scanner', label: 'Scanner', category: 'Office & Furniture' },
  { value: 'desk', label: 'Desk', category: 'Office & Furniture' },
  { value: 'chair', label: 'Chair', category: 'Office & Furniture' },
  { value: 'filing_cabinet', label: 'Filing Cabinet', category: 'Office & Furniture' },
  { value: 'whiteboard', label: 'Whiteboard', category: 'Office & Furniture' },

  // Lab & Research
  { value: 'microscope', label: 'Microscope', category: 'Lab & Research' },
  { value: 'centrifuge', label: 'Centrifuge', category: 'Lab & Research' },
  { value: 'oscilloscope', label: 'Oscilloscope', category: 'Lab & Research' },
  { value: '3d_printer', label: '3D Printer', category: 'Lab & Research' },

  // Facilities
  { value: 'vehicle', label: 'University Vehicle', category: 'Facilities' },
  { value: 'generator', label: 'Generator', category: 'Facilities' },
  { value: 'hvac', label: 'HVAC Unit', category: 'Facilities' },
  { value: 'maintenance_tool', label: 'Power Tool', category: 'Facilities' },
];

let selectedAssetCustomId = null;
let currentAssets = [];

document.addEventListener('DOMContentLoaded', () => {
  initializePage();

  const form = document.getElementById('addAssetForm');
  if (form) {
    form.addEventListener('submit', handleAddAsset);
  }

  const transferForm = document.getElementById('transferAssetForm');
  if (transferForm) {
    transferForm.addEventListener('submit', handleTransferAsset);
  }

  const exportBtn = document.getElementById('exportPdfBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportInventoryToPDF);
  }

  // --- Filter Event Listeners (All Synchronized) ---
  const buildingFilter = document.getElementById('filterBuilding');
  const deptFilter = document.getElementById('filterDept');
  const typeFilter = document.getElementById('filterType');

  if (buildingFilter) buildingFilter.addEventListener('change', syncFilters);
  if (deptFilter) deptFilter.addEventListener('change', syncFilters);
  if (typeFilter) typeFilter.addEventListener('change', syncFilters);
});

async function initializePage() {
  await loadAssetTypes();
  await loadAssets();
}

// --- 1. Load Asset Types ---
async function loadAssetTypes() {
  try {
    const response = await fetch(`${API_URL}/config`);
    if (!response.ok) return;

    const data = await response.json();
    const typeSelect = document.getElementById('assetType');

    if (data.assetTypes && typeSelect) {
      typeSelect.innerHTML = data.assetTypes.map(t =>
        `<option value="${t.value}">${t.label}</option>`
      ).join('');
    }
  } catch (error) {
    console.warn('Could not load asset types from backend.');
  }
}

// --- 2. Fetch Assets (Refactored) ---
async function loadAssets() {
  try {
    const response = await fetch(`${API_URL}/assets`);
    if (!response.ok) throw new Error('Failed to fetch assets');

    const assets = await response.json();
    currentAssets = assets; // Store raw data

    // Populate the filter dropdowns dynamically based on data
    populateFilters();
    
    // Initial render
    renderTable();

  } catch (error) {
    console.error('Error:', error);
    const tableBody = document.getElementById('inventoryTableBody');
    if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">Error loading assets. Check port 5000.</td></tr>`;
    }
  }
}

// --- NEW: Populate Filters ---
function populateFilters() {
  const buildingSelect = document.getElementById('filterBuilding');
  const deptSelect = document.getElementById('filterDept');
  const typeSelect = document.getElementById('filterType');

  if (!buildingSelect || !deptSelect || !typeSelect) return;

  // Get unique values from current assets
  const buildings = [...new Set(currentAssets.map(a => a.location).filter(Boolean))].sort();
  const departments = [...new Set(currentAssets.map(a => a.department).filter(Boolean))].sort();
  const types = [...new Set(currentAssets.map(a => a.type).filter(Boolean))].sort();

  // Save current selections
  const currentBuilding = buildingSelect.value;
  const currentDept = deptSelect.value;
  const currentType = typeSelect.value;

  // Populate Buildings
  buildingSelect.innerHTML = '<option value="all">All Buildings</option>' + 
    buildings.map(b => `<option value="${b}">${b}</option>`).join('');
  
  // Populate Departments
  deptSelect.innerHTML = '<option value="all">All Departments</option>' + 
    departments.map(d => `<option value="${d}">${d}</option>`).join('');

  // Populate Asset Types
  typeSelect.innerHTML = '<option value="all">All Asset Types</option>' + 
    types.map(t => {
      const typeObj = ASSET_TYPES.find(at => at.value === t);
      return `<option value="${t}">${typeObj ? typeObj.label : formatType(t)}</option>`;
    }).join('');

  // Restore selections if they still exist
  if (buildings.includes(currentBuilding)) buildingSelect.value = currentBuilding;
  if (departments.includes(currentDept)) deptSelect.value = currentDept;
  if (types.includes(currentType)) typeSelect.value = currentType;
}

// --- NEW: Synchronized Filter Logic ---
function syncFilters() {
  renderTable();
}

// --- NEW: Reset Filters ---
function resetFilters() {
  document.getElementById('filterBuilding').value = 'all';
  document.getElementById('filterDept').value = 'all';
  document.getElementById('filterType').value = 'all';
  renderTable();
}

// --- NEW: Render Table with Filters ---
function renderTable() {
  const tableBody = document.getElementById('inventoryTableBody');
  if (!tableBody) return;

  const buildingFilter = document.getElementById('filterBuilding')?.value;
  const deptFilter = document.getElementById('filterDept')?.value;
  const typeFilter = document.getElementById('filterType')?.value;

  // Filter the assets locally based on all three criteria
  const filteredAssets = currentAssets.filter(asset => {
    const matchBuilding = !buildingFilter || buildingFilter === 'all' || asset.location === buildingFilter;
    const matchDept = !deptFilter || deptFilter === 'all' || asset.department === deptFilter;
    const matchType = !typeFilter || typeFilter === 'all' || asset.type === typeFilter;
    return matchBuilding && matchDept && matchType;
  });

  if (!filteredAssets || filteredAssets.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4">No assets found matching filters.</td></tr>`;
    return;
  }

  tableBody.innerHTML = filteredAssets.map(asset => `
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
      <td><span class="badge bg-light text-dark border">${formatType(asset.type || 'unknown')}</span></td>
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
        <button class="btn btn-sm btn-light border" onclick="window.transferAsset('${asset.customId}')" title="Transfer">
          <i class="bi bi-arrow-left-right"></i>
        </button>
        <button class="btn btn-sm btn-light border" onclick="window.viewHistory('${asset.customId}')" title="View History">
          <i class="bi bi-clock-history"></i>
        </button>
        <button class="btn btn-sm btn-light border text-danger" onclick="window.deleteAsset('${asset._id}')" title="Delete">
          <i class="bi bi-trash"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

// --- 3. Add New Asset ---
async function handleAddAsset(e) {
  e.preventDefault();

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.innerHTML;
  submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving...';
  submitBtn.disabled = true;

  const name = document.getElementById('assetName').value;
  const quantity = parseInt(document.getElementById('assetQuantity').value, 10);
  const type = document.getElementById('assetType').value;
  const location = document.getElementById('assetLocation')?.value || 'Central Warehouse';

  function generateBarcode(id) {
    return `BC-${id}-${Math.floor(Math.random() * 100000)}`;
  }

  function generateCustomId() {
    return `ASSET-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  }

  try {
    for (let i = 0; i < quantity; i++) {
      const customId = generateCustomId();
      const barcode = generateBarcode(customId);

      const assetData = {
        name,
        customId,
        barcode,
        type,
        location,
        department: 'Unassigned',
        status: 'Available',
        quantity: 1,
      };

      const response = await fetch(`${API_URL}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assetData),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Failed to create asset');
    }

    const modalEl = document.getElementById('addAssetModal');
    if (modalEl) {
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();
    }

    e.target.reset();
    await loadAssets();

  } catch (error) {
    alert('Error: ' + error.message);
  } finally {
    submitBtn.innerHTML = originalText;
    submitBtn.disabled = false;
  }
}

// --- 4. Transfer Asset ---
window.transferAsset = (customId) => {
  selectedAssetCustomId = customId;
  const modalEl = document.getElementById('transferAssetModal');
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl); 
  modal.show();
};

async function handleTransferAsset(e) {
  e.preventDefault();
  const building = document.getElementById('transferBuilding').value;
  const department = document.getElementById('transferDepartment').value;

  try {
    const response = await fetch(`${API_URL}/assets/${selectedAssetCustomId}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ building, department }),
    });
    if (!response.ok) throw new Error('Transfer failed');
    
    const modalEl = document.getElementById('transferAssetModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if(modal) modal.hide();

    await loadAssets();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// --- 5. Assign Asset ---
window.assignAsset = async (customId) => {
  const userId = prompt("Enter User ID/Name to assign this asset to:");
  if (!userId) return;
  try {
    const response = await fetch(`${API_URL}/assets/${customId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (response.ok) loadAssets();
  } catch (error) {
    console.error(error);
  }
};

// --- 6. Delete Asset ---
window.deleteAsset = async (id) => {
  if (!confirm('Are you sure you want to delete this asset?')) return;
  try {
    const response = await fetch(`${API_URL}/assets/${id}`, { method: 'DELETE' });
    if (response.ok) loadAssets();
  } catch (error) {
    console.error(error);
  }
};

// --- 7. View History ---
window.viewHistory = async (customId) => {
  try {
    const response = await fetch(`${API_URL}/assets/${customId}/history`);
    if (!response.ok) throw new Error('Failed to fetch history');

    const history = await response.json();
    if (!Array.isArray(history)) throw new Error('Invalid history format');

    alert(`History for ${customId}:\n\n${history.map(h => `- ${h}`).join('\n')}`);
  } catch (err) {
    alert('Failed to load history.');
    console.error(err);
  }
};


// --- 8. Export to PDF ---
function exportInventoryToPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF || !window.jspdf.autoTable) {
    alert('jsPDF library is not loaded. Please check your imports.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const tableData = currentAssets.map(asset => [
    asset.name,
    asset.customId || 'N/A',
    asset.barcode || 'N/A',
    asset.type || 'N/A',
    asset.location || 'Central Warehouse',
    asset.department || 'Unassigned',
    asset.status || 'Available',
    asset.assignedUser || '-',
  ]);

  doc.text('University Asset Inventory', 14, 16);
  doc.autoTable({
    head: [['Name', 'ID', 'Barcode', 'Type', 'Location', 'Department', 'Status', 'Assigned To']],
    body: tableData,
    startY: 20,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [41, 128, 185] },
  });

  doc.save('inventory.pdf');
}

// --- 9. UI Helper Functions ---
function getIconForType(type) {
  const icons = {
    'laptop': 'bi-laptop',
    'desktop': 'bi-pc-display',
    'monitor': 'bi-display',
    'printer': 'bi-printer',
    'furniture': 'bi-chair',
    'lab_equipment': 'bi-funnel',
    'network': 'bi-router',
    'projector': 'bi-projector',
    'tablet': 'bi-tablet'
  };
  return icons[type] || 'bi-box-seam';
}

function formatType(type) {
  if (!type) return 'Unknown';
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getStatusBadgeClass(status) {
  const map = {
    'Available': 'bg-success',
    'In Use': 'bg-primary',
    'Maintenance': 'bg-warning text-dark',
    'Retired': 'bg-danger',
    'Lost': 'bg-secondary'
  };
  return map[status] || 'bg-light text-dark';
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
