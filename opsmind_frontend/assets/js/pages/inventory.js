// Config is set as globals in config.js (loaded in HTML head)
const API_URL = 'http://localhost:5000/api';

// Define configuration variables globally so the rest of the script can use them
let BUILDINGS = [];
let DEPARTMENTS = [];
let ASSET_TYPES = [];
let EOL_METRICS = {};

let selectedAssetCustomId = null;
let currentAssets = [];

document.addEventListener('DOMContentLoaded', () => {
  initializePage();

  const form = document.getElementById('addAssetForm');
  if (form) form.addEventListener('submit', handleAddAsset);

  const transferForm = document.getElementById('transferAssetForm');
  if (transferForm) transferForm.addEventListener('submit', handleTransferAsset);

  const exportBtn = document.getElementById('exportPdfBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportAssetsToDetailedPDF);

  const locSelect = document.getElementById('assetLocation');
  const deptSelect = document.getElementById('assetDepartment');
  if (locSelect) locSelect.value = 'Central Warehouse';
  if (deptSelect) deptSelect.value = 'Unassigned';

  const buildingFilter = document.getElementById('filterBuilding');
  const deptFilter = document.getElementById('filterDept');
  const typeFilter = document.getElementById('filterType');

  if (buildingFilter) buildingFilter.addEventListener('change', syncFilters);
  if (deptFilter) deptFilter.addEventListener('change', syncFilters);
  if (typeFilter) typeFilter.addEventListener('change', syncFilters);
});

async function initializePage() {
  await loadConfig(); // 1. Fetch config from backend first!
  await loadAssets(); // 2. Then load assets and render
}

// 🚀 Fetches the single source of truth from your new backend route
async function loadConfig() {
  try {
    const response = await fetch(`${API_URL}/config`);
    if (!response.ok) throw new Error('Failed to fetch configuration');
    
    const configData = await response.json();
    
    // Assign the fetched data to our global variables
    BUILDINGS = configData.BUILDINGS || [];
    DEPARTMENTS = configData.DEPARTMENTS || [];
    ASSET_TYPES = configData.ASSET_TYPES || [];
    EOL_METRICS = configData.EOL_METRICS || {};
    
  } catch (error) {
    console.error('Error loading config:', error);
    alert("Could not load system configurations. Is the backend running?");
  }
}

async function loadAssets() {
  try {
    const response = await fetch(`${API_URL}/assets`);
    if (!response.ok) throw new Error('Failed to fetch assets');

    const assets = await response.json();
    currentAssets = assets; 

    populateFilters();
    renderTable();
    checkGlobalEOLAlerts(); 

  } catch (error) {
    console.error('Error:', error);
    const tableBody = document.getElementById('inventoryTableBody');
    if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">Error loading assets. Check port 5000.</td></tr>`;
    }
  }
}

// 🤖 AI Prediction Math Helper
function getEOLDetails(asset) {
  const now = new Date();
  let purchaseDate;
  
  if (asset.customId && asset.customId.includes('ASSET-')) {
      const timestamp = parseInt(asset.customId.split('-')[1]);
      purchaseDate = new Date(timestamp);
  } else {
      purchaseDate = new Date(now.getFullYear() - 3, now.getMonth() - 6, 1);
  }

  // Fallback to a default if metrics aren't loaded yet
  const defaultMetrics = { years: 5, cost: 500 };
  const metrics = EOL_METRICS[asset.type] || EOL_METRICS.default || defaultMetrics;
  
  const expiryDate = new Date(purchaseDate);
  expiryDate.setFullYear(expiryDate.getFullYear() + metrics.years);

  const msRemaining = expiryDate - now;
  const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
  
  let remainingText = '';
  let statusClass = 'bg-success'; 

  if (daysRemaining < 0) {
      remainingText = `Expired ${Math.abs(daysRemaining)} days ago`;
      statusClass = 'bg-danger';
  } else if (daysRemaining <= 180) { 
      remainingText = `⚠️ ${daysRemaining} days left`;
      statusClass = 'bg-warning text-dark';
  } else if (daysRemaining < 365) {
      const months = Math.floor(daysRemaining / 30);
      remainingText = `${months} month${months > 1 ? 's' : ''} left`;
      statusClass = 'bg-info text-dark';
  } else {
      const years = Math.floor(daysRemaining / 365);
      const months = Math.floor((daysRemaining % 365) / 30);
      remainingText = `${years}y ${months}m left`;
      statusClass = 'bg-success';
  }

  return { remainingText, statusClass, daysRemaining, metrics, expiryDate };
}

function checkGlobalEOLAlerts() {
  const expiringCount = currentAssets.filter(a => {
      const eol = getEOLDetails(a);
      return eol.daysRemaining >= 0 && eol.daysRemaining <= 180;
  }).length;

  const expiredCount = currentAssets.filter(a => getEOLDetails(a).daysRemaining < 0).length;
  const banner = document.getElementById('eolAlertBanner');
  
  if (banner && (expiringCount > 0 || expiredCount > 0)) {
      let html = `
      <div class="alert alert-danger d-flex justify-content-between align-items-center shadow-sm mb-4" style="border-left: 5px solid #dc3545;">
          <div>
            <h5 class="mb-1 fw-bold"><i class="bi bi-exclamation-triangle-fill me-2"></i> EOL Action Required</h5>
            <span class="text-dark">OpsMind detected <b>${expiringCount}</b> asset(s) expiring within 6 months, and <b>${expiredCount}</b> expired asset(s) active in the field.</span>
          </div>
          <button class="btn btn-dark" onclick="generateEOLReport()">Download Budget Report</button>
      </div>`;
      banner.innerHTML = html;
      banner.style.display = 'block';
  } else if (banner) {
      banner.style.display = 'none';
  }
}

function populateFilters() {
  const buildingSelect = document.getElementById('filterBuilding');
  const deptSelect = document.getElementById('filterDept');
  const typeSelect = document.getElementById('filterType');

  if (!buildingSelect || !deptSelect || !typeSelect) return;

  const currentBuilding = buildingSelect.value;
  const currentDept = deptSelect.value;
  const currentType = typeSelect.value;

  buildingSelect.innerHTML = '<option value="all">All Buildings</option>' + BUILDINGS.map(b => `<option value="${b}">${b}</option>`).join('');
  deptSelect.innerHTML = '<option value="all">All Departments</option>' + DEPARTMENTS.map(d => `<option value="${d}">${d}</option>`).join('');
  typeSelect.innerHTML = '<option value="all">All Asset Types</option>' + ASSET_TYPES.map(at => `<option value="${at.value}">${at.label}</option>`).join('');

  if (BUILDINGS.includes(currentBuilding)) buildingSelect.value = currentBuilding;
  if (DEPARTMENTS.includes(currentDept)) deptSelect.value = currentDept;
  if (ASSET_TYPES.map(a => a.value).includes(currentType)) typeSelect.value = currentType;
}

function syncFilters() { renderTable(); }
function resetFilters() {
  document.getElementById('filterBuilding').value = 'all';
  document.getElementById('filterDept').value = 'all';
  document.getElementById('filterType').value = 'all';
  renderTable();
}

function filterGroupTable() {
  const searchTerm = document.getElementById('searchInput')?.value.toLowerCase() || '';
  const tableBody = document.getElementById('inventoryTableBody');
  if (!tableBody) return;

  const rows = tableBody.querySelectorAll('tr');
  rows.forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(searchTerm) ? '' : 'none';
  });
}

function handleSearchKeyPress(event) {
  if (event.key === 'Enter') filterGroupTable();
}

function renderTable() {
  const tableBody = document.getElementById('inventoryTableBody');
  if (!tableBody) return;

  const buildingFilter = document.getElementById('filterBuilding')?.value;
  const deptFilter = document.getElementById('filterDept')?.value;
  const typeFilter = document.getElementById('filterType')?.value;

  const filteredAssets = currentAssets.filter(asset => {
    const matchBuilding = !buildingFilter || buildingFilter === 'all' || asset.location === buildingFilter;
    const matchDept = !deptFilter || deptFilter === 'all' || asset.department === deptFilter;
    const matchType = !typeFilter || typeFilter === 'all' || asset.type === typeFilter;
    return matchBuilding && matchDept && matchType;
  });

  if (!filteredAssets || filteredAssets.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4">No assets found matching filters.</td></tr>`;
    return;
  }

  const groupedByName = {};
  filteredAssets.forEach(asset => {
    if (!groupedByName[asset.name]) groupedByName[asset.name] = [];
    groupedByName[asset.name].push(asset);
  });

  tableBody.innerHTML = Object.entries(groupedByName).map(([assetName, assetGroup]) => {
    const totalQty = assetGroup.length;
    const firstAsset = assetGroup[0];
    const typeObj = ASSET_TYPES.find(t => t.value === firstAsset.type);
    const typeLabel = typeObj ? typeObj.label : formatType(firstAsset.type);
    
    const locationsSet = new Set(assetGroup.map(a => a.location).filter(Boolean));
    const departmentsSet = new Set(assetGroup.map(a => a.department).filter(Boolean));
    const locationsFound = Array.from(locationsSet).join(', ') || 'Unknown';
    const departmentsFound = Array.from(departmentsSet).join(', ') || 'Unassigned';

    return `
      <tr>
        <td>
          <div class="d-flex align-items-center">
            <div class="avatar-initial rounded bg-light text-primary me-3">
              <i class="bi ${getIconForType(firstAsset.type)}"></i>
            </div>
            <div>
              <div class="fw-bold text-dark">${assetName}</div>
              <small class="text-muted">${departmentsFound}</small>
            </div>
          </div>
        </td>
        <td><span class="badge bg-light text-dark border">${typeLabel}</span></td>
        <td class="text-center"><span class="badge bg-primary qty-badge">${totalQty}</span></td>
        <td><small class="text-muted">${locationsFound}</small></td>
        <td class="text-end">
          <button class="btn btn-sm btn-primary" onclick="window.viewAssetDetails('${assetName}')" title="View & Manage Items">
            <i class="bi bi-eye me-1"></i> View (${totalQty})
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

async function handleAddAsset(e) {
  e.preventDefault();

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.innerHTML;
  
  const name = document.getElementById('assetName').value;
  const quantity = parseInt(document.getElementById('assetQuantity').value, 10);
  const type = document.getElementById('assetType').value;
  const location = document.getElementById('assetLocation').value || 'Central Warehouse';
  const department = document.getElementById('assetDepartment').value || 'Unassigned';

  const idleAssets = currentAssets.filter(a => a.type === type && (a.location === 'Central Warehouse' || a.department === 'Unassigned' || a.status === 'Available' || a.status === 'active'));
  
  if (idleAssets.length > 0 && location !== 'Central Warehouse') {
      const aiMessage = `
        You are requesting <strong class="text-dark">${quantity}</strong> new <strong class="text-dark">${formatType(type)}</strong>(s) for <strong>${department}</strong>.<br><br>
        Wait! OpsMind found <span class="badge rounded-pill fs-6" style="background-color: #8a2be2;">${idleAssets.length} idle</span> ${formatType(type)}(s) currently sitting in the Central Warehouse.<br><br>
        Would you like to cancel this new purchase and transfer the existing assets instead?
      `;

      const proceed = await showAIModal(aiMessage);
      
      if (proceed) {
          const modalEl = document.getElementById('receiveOrderModal');
          if (modalEl) bootstrap.Modal.getInstance(modalEl).hide();
          
          document.getElementById('filterType').value = type;
          document.getElementById('filterBuilding').value = 'Central Warehouse';
          syncFilters();
          return; 
      }
  }

  submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving...';
  submitBtn.disabled = true;

  function generateCustomId() { return `ASSET-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

  try {
    for (let i = 0; i < quantity; i++) {
      const customId = generateCustomId();
      const assetData = { name, customId, type, location, department, status: 'active', quantity: 1 };

      const response = await fetch(`${API_URL}/assets`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(assetData),
      });

      if (!response.ok) throw new Error((await response.json()).message || 'Failed to create asset');
    }

    const modalEl = document.getElementById('receiveOrderModal');
    if (modalEl) bootstrap.Modal.getInstance(modalEl).hide();

    e.target.reset();
    document.getElementById('assetLocation').value = 'Central Warehouse';
    document.getElementById('assetDepartment').value = 'Unassigned';

    await loadAssets();

  } catch (error) {
    console.error('Error:', error);
    alert('Error: ' + error.message);
  } finally {
    submitBtn.innerHTML = originalText;
    submitBtn.disabled = false;
  }
}

function showAIModal(messageHtml) {
  return new Promise((resolve) => {
      const modalEl = document.getElementById('aiTechExchangeModal');
      document.getElementById('aiModalMessage').innerHTML = messageHtml;
      
      const modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
      const acceptBtn = document.getElementById('aiBtnAccept');
      const ignoreBtn = document.getElementById('aiBtnIgnore');

      const cleanup = () => {
          acceptBtn.replaceWith(acceptBtn.cloneNode(true));
          ignoreBtn.replaceWith(ignoreBtn.cloneNode(true));
          modalInstance.hide();
      };

      document.getElementById('aiBtnAccept').addEventListener('click', () => { cleanup(); resolve(true); });
      document.getElementById('aiBtnIgnore').addEventListener('click', () => { cleanup(); resolve(false); });

      modalEl.addEventListener('hidden.bs.modal', function onHidden() {
          modalEl.removeEventListener('hidden.bs.modal', onHidden);
          resolve(false);
      }, { once: true });

      modalEl.style.zIndex = "1060"; 
      modalInstance.show();
  });
}

// --- View Asset Group Details ---
window.viewAssetDetails = (assetName) => {
  const groupAssets = currentAssets.filter(a => a.name === assetName);
  
  if (!groupAssets.length) {
    alert('Asset group not found');
    return;
  }

  document.getElementById('detailModalTitle').textContent = `${assetName} - ${groupAssets.length} Item(s)`;
  document.getElementById('innerSearchInput').value = '';

  const detailsBody = document.getElementById('detailsTableBody');
  const sampleAsset = groupAssets[0];
  const eolData = getEOLDetails(sampleAsset);
  
  const headerDiv = document.querySelector('.bulk-header');
  if (headerDiv) {
    const existingAiBanner = document.getElementById('aiSummaryBanner');
    if (existingAiBanner) existingAiBanner.remove();

    const aiBanner = document.createElement('div');
    aiBanner.id = 'aiSummaryBanner';
    aiBanner.className = 'alert w-100 d-flex align-items-center mb-3 mt-2';
    aiBanner.style = "background: #f3e8ff; border: 1px solid #d8b4fe; border-left: 4px solid #8a2be2;";
    
    const failingCount = groupAssets.filter(a => getEOLDetails(a).daysRemaining <= 180).length;
    let aiText = `<strong>🤖 AI Prediction:</strong> The industry average lifespan for a <strong>${formatType(sampleAsset.type)}</strong> is <strong>${eolData.metrics.years} years</strong>. `;
    
    if (failingCount > 0) {
        aiText += `<span class="text-danger">Based on usage, <b>${failingCount} item(s)</b> in this group need replacement soon.</span>`;
    } else {
        aiText += `<span class="text-success">All items in this group currently have a healthy lifespan.</span>`;
    }

    aiBanner.innerHTML = aiText;
    headerDiv.insertBefore(aiBanner, headerDiv.firstChild);
  }

  detailsBody.innerHTML = groupAssets.map(asset => {
    const eol = getEOLDetails(asset);
    return `
    <tr>
      <td class="ps-4">
        <span class="font-monospace fw-bold">${asset.customId}</span>
      </td>
      <td>
        <span class="badge ${getStatusBadgeClass(asset.status)}">
          ${capitalize(asset.status || 'Available')}
        </span>
      </td>
      <td>${asset.location || '-'}</td>
      <td>${asset.department || '-'}</td>
      <td>
        <div class="mb-1">
          <span class="badge ${eol.statusClass}">${eol.remainingText}</span>
        </div>
        <div class="text-muted" style="font-size: 0.75rem;">
          <i class="bi bi-robot" style="color: #8a2be2;"></i> Pred. Lifespan: ${eol.metrics.years}y
        </div>
      </td>
      <td class="text-end pe-4">
        <button class="btn btn-sm btn-outline-info" onclick="window.viewQRCode('${asset.customId}')" title="View QR">
          <i class="bi bi-qr-code"></i>
        </button>
        <button class="btn btn-sm btn-outline-secondary" onclick="window.editSpecs('${asset.customId}', false)" title="Edit Specs">
          <i class="bi bi-pencil"></i>
        </button>
        <button class="btn btn-sm btn-outline-primary" onclick="window.viewTransferHistory('${asset.customId}')" title="History">
          <i class="bi bi-clock-history"></i>
        </button>
        <button class="btn btn-sm btn-info text-white" onclick="window.transferIndividual('${asset.customId}')" title="Transfer">
          <i class="bi bi-arrow-left-right"></i>
        </button>
        <button class="btn btn-sm btn-danger" onclick="window.deleteIndividual('${asset._id}')" title="Delete">
          <i class="bi bi-trash"></i>
        </button>
      </td>
    </tr>
  `}).join('');

  const bulkTransferBtn = document.getElementById('bulkTransferBtn');
  const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');

  if (bulkTransferBtn) bulkTransferBtn.onclick = () => window.bulkTransferGroup(assetName);
  if (bulkDeleteBtn) bulkDeleteBtn.onclick = () => window.bulkDeleteGroup(assetName);

  if (headerDiv) {
    const groupActionsDiv = document.createElement('div');
    groupActionsDiv.className = 'd-flex gap-2 ms-auto';
    groupActionsDiv.innerHTML = `
      <button class="btn btn-sm btn-outline-info" onclick="window.printQRLabels('${assetName}', true)" title="Print QR Labels">
        <i class="bi bi-printer"></i> Print Labels
      </button>
      <button class="btn btn-sm btn-outline-secondary" onclick="window.editSpecs('${assetName}', true)" title="Edit Group Specs">
        <i class="bi bi-pencil"></i> Edit Specs
      </button>
    `;
    
    let groupActionsContainer = headerDiv.querySelector('.group-actions');
    if (!groupActionsContainer) {
      groupActionsContainer = document.createElement('div');
      groupActionsContainer.className = 'group-actions w-100 d-flex justify-content-end mt-2';
      headerDiv.appendChild(groupActionsContainer);
    }
    groupActionsContainer.innerHTML = groupActionsDiv.innerHTML;
  }

  const detailsModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('detailsModal'));
  detailsModal.show();
};

window.filterDetailsTable = () => {
  const searchTerm = document.getElementById('innerSearchInput')?.value.toLowerCase() || '';
  const detailsBody = document.getElementById('detailsTableBody');
  if (!detailsBody) return;

  const rows = detailsBody.querySelectorAll('tr');
  rows.forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(searchTerm) ? '' : 'none';
  });
};

window.transferIndividual = (customId) => {
  const asset = currentAssets.find(a => a.customId === customId);
  if (!asset) return;

  selectedAssetCustomId = customId;
  document.getElementById('transferAssetId').textContent = customId;
  document.getElementById('maxTransferQty').textContent = '1';
  document.getElementById('transferQty').value = '1';
  document.getElementById('transferQty').max = 1;

  document.getElementById('checkBuilding').checked = false;
  document.getElementById('checkDept').checked = false;
  document.getElementById('buildingSelect').style.display = 'none';
  document.getElementById('deptSelect').style.display = 'none';
  
  populateTransferSelects();
  
  const transferModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('transferModal'));
  transferModal.show();
};

window.deleteIndividual = async (id) => {
  if (!confirm('Delete this individual asset?')) return;
  try {
    const response = await fetch(`${API_URL}/assets/${id}`, { method: 'DELETE' });
    if (response.ok) {
      await loadAssets();
      const asset = currentAssets.find(a => a._id === id);
      if (asset) {
        window.viewAssetDetails(asset.name);
      } else {
        const detailsModal = bootstrap.Modal.getInstance(document.getElementById('detailsModal'));
        if (detailsModal) detailsModal.hide();
      }
    }
  } catch (error) {
    console.error(error);
    alert('Failed to delete asset');
  }
};

window.bulkTransferGroup = (assetName) => {
  const groupAssets = currentAssets.filter(a => a.name === assetName);
  if (!groupAssets.length) return;

  selectedAssetCustomId = assetName; 
  document.getElementById('transferAssetId').textContent = `${assetName} (${groupAssets.length} items)`;
  document.getElementById('maxTransferQty').textContent = groupAssets.length;
  document.getElementById('transferQty').value = groupAssets.length;
  document.getElementById('transferQty').max = groupAssets.length;

  document.getElementById('checkBuilding').checked = false;
  document.getElementById('checkDept').checked = false;
  document.getElementById('buildingSelect').style.display = 'none';
  document.getElementById('deptSelect').style.display = 'none';
  
  populateTransferSelects();
  
  const transferModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('transferModal'));
  transferModal.show();
};

window.bulkDeleteGroup = async (assetName) => {
  const groupAssets = currentAssets.filter(a => a.name === assetName);
  if (!groupAssets.length) return;

  if (!confirm(`Delete ALL ${groupAssets.length} items of "${assetName}"? This cannot be undone.`)) return;

  try {
    for (const asset of groupAssets) {
      const response = await fetch(`${API_URL}/assets/${asset._id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`Failed to delete ${asset.customId}`);
    }

    const detailsModal = bootstrap.Modal.getInstance(document.getElementById('detailsModal'));
    if (detailsModal) detailsModal.hide();

    await loadAssets();
    alert(`Successfully deleted all ${groupAssets.length} items of "${assetName}"`);
  } catch (error) {
    console.error(error);
    alert('Error: ' + error.message);
  }
};

window.updateLocationOptions = function() {
  const destType = document.querySelector('input[name="destType"]:checked')?.value;
  const locationSelect = document.getElementById('locationSelect');
  if (!locationSelect) return;

  if (destType === 'building') {
    locationSelect.innerHTML = `<option value="">Select Building</option>` + 
      BUILDINGS.map(b => `<option value="${b}">${b}</option>`).join('');
  } else if (destType === 'department') {
    locationSelect.innerHTML = `<option value="">Select Department</option>` + 
      DEPARTMENTS.map(d => `<option value="${d}">${d}</option>`).join('');
  }
};

window.populateTransferSelects = function() {
  const buildingSelect = document.getElementById('buildingSelect');
  const deptSelect = document.getElementById('deptSelect');
  
  if (buildingSelect) {
    buildingSelect.innerHTML = `<option value="">Select Building</option>` + 
      BUILDINGS.map(b => `<option value="${b}">${b}</option>`).join('');
  }
  
  if (deptSelect) {
    deptSelect.innerHTML = `<option value="">Select Department</option>` + 
      DEPARTMENTS.map(d => `<option value="${d}">${d}</option>`).join('');
  }
};

window.toggleBuildingSelect = function() {
  const checkBuilding = document.getElementById('checkBuilding').checked;
  const buildingSelect = document.getElementById('buildingSelect');
  buildingSelect.style.display = checkBuilding ? 'block' : 'none';
  if (checkBuilding) buildingSelect.value = '';
};

window.toggleDeptSelect = function() {
  const checkDept = document.getElementById('checkDept').checked;
  const deptSelect = document.getElementById('deptSelect');
  deptSelect.style.display = checkDept ? 'block' : 'none';
  if (checkDept) deptSelect.value = '';
};

window.submitTransfer = async () => {
  const buildingChecked = document.getElementById('checkBuilding').checked;
  const deptChecked = document.getElementById('checkDept').checked;
  const buildingValue = document.getElementById('buildingSelect').value;
  const deptValue = document.getElementById('deptSelect').value;
  const quantity = parseInt(document.getElementById('transferQty').value, 10) || 1;
  const confirmBtn = document.getElementById('confirmTransferBtn');
  const originalBtnText = confirmBtn.innerHTML;

  if (!buildingChecked && !deptChecked) {
    alert('Please select at least one destination type');
    return;
  }
  if (buildingChecked && !buildingValue) {
    alert('Please select a building');
    return;
  }
  if (deptChecked && !deptValue) {
    alert('Please select a department');
    return;
  }

  try {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Transferring...';

    const isBulk = currentAssets.some(a => a.name === selectedAssetCustomId);

    if (!isBulk) {
      if (buildingChecked) {
        const transferData = { destType: 'building', destination: buildingValue, quantityToMove: quantity };
        const response = await fetch(`${API_URL}/assets/${selectedAssetCustomId}/transfer`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(transferData),
        });
        if (!response.ok) throw new Error((await response.json()).message || 'Building transfer failed');
      }

      if (deptChecked) {
        const transferData = { destType: 'department', destination: deptValue, quantityToMove: quantity };
        const response = await fetch(`${API_URL}/assets/${selectedAssetCustomId}/transfer`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(transferData),
        });
        if (!response.ok) throw new Error((await response.json()).message || 'Department transfer failed');
      }
    } else {
      const groupAssets = currentAssets.filter(a => a.name === selectedAssetCustomId);
      const assetsToTransfer = groupAssets.slice(0, quantity);

      for (const asset of assetsToTransfer) {
        if (buildingChecked) {
          const transferData = { destType: 'building', destination: buildingValue, quantityToMove: 1 };
          const response = await fetch(`${API_URL}/assets/${asset.customId}/transfer`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(transferData),
          });
          if (!response.ok) throw new Error((await response.json()).message || `Building transfer failed for ${asset.customId}`);
        }

        if (deptChecked) {
          const transferData = { destType: 'department', destination: deptValue, quantityToMove: 1 };
          const response = await fetch(`${API_URL}/assets/${asset.customId}/transfer`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(transferData),
          });
          if (!response.ok) throw new Error((await response.json()).message || `Department transfer failed for ${asset.customId}`);
        }
      }
    }

    const transferModal = bootstrap.Modal.getInstance(document.getElementById('transferModal'));
    if (transferModal) transferModal.hide();

    const detailsModal = bootstrap.Modal.getInstance(document.getElementById('detailsModal'));
    if (detailsModal) detailsModal.hide();

    await loadAssets();
    alert('Transfer completed successfully!');
  } catch (error) {
    console.error(error);
    alert('Error: ' + error.message);
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = originalBtnText;
  }
};

window.editSpecs = (assetNameOrId, isGroupEdit = false) => {
  let targetAssets = [];

  if (isGroupEdit) {
    targetAssets = currentAssets.filter(a => a.name === assetNameOrId);
    document.getElementById('editSpecAssetId').textContent = `${assetNameOrId} (${targetAssets.length} items)`;
  } else {
    const asset = currentAssets.find(a => a.customId === assetNameOrId);
    if (asset) {
      targetAssets = [asset];
      document.getElementById('editSpecAssetId').textContent = assetNameOrId;
    }
  }

  if (!targetAssets.length) {
    alert('Asset not found');
    return;
  }

  const specsText = targetAssets[0].specifications 
    ? Object.entries(targetAssets[0].specifications).map(([k, v]) => `${k}: ${v}`).join('\n')
    : '';

  document.getElementById('editSpecTextArea').value = specsText;
  document.getElementById('editSpecTargetId').value = isGroupEdit ? assetNameOrId : targetAssets[0]._id;

  window._editingGroup = isGroupEdit;
  window._editingAssets = targetAssets;

  const editModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('editSpecsModal'));
  editModal.show();
};

window.saveUpdatedSpecs = async () => {
  const textArea = document.getElementById('editSpecTextArea');
  const specsText = textArea.value;
  const saveBtn = document.getElementById('saveSpecsBtn');
  const originalText = saveBtn.innerHTML;

  const specs = {};
  if (specsText.trim()) {
    specsText.split('\n').forEach(line => {
      const [key, value] = line.split(':').map(s => s.trim());
      if (key && value) specs[key] = value;
    });
  }

  try {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving...';

    const assetsToUpdate = window._editingAssets || [];
    for (const asset of assetsToUpdate) {
      const response = await fetch(`${API_URL}/assets/${asset.customId}/details`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specifications: specs }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || `Failed to update specs for ${asset.customId}`);
      }
    }

    const editModal = bootstrap.Modal.getInstance(document.getElementById('editSpecsModal'));
    if (editModal) editModal.hide();

    await loadAssets();
    alert('Specs updated successfully!');
  } catch (error) {
    console.error(error);
    alert('Error: ' + error.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = originalText;
  }
};

window.viewQRCode = (customId) => {
  const specContent = document.getElementById('specContent');
  specContent.innerHTML = '';

  const qrContainer = document.createElement('div');
  qrContainer.id = 'qrcode-temp';
  qrContainer.style.textAlign = 'center';
  qrContainer.style.margin = '20px 0';
  
  specContent.appendChild(qrContainer);

  new QRCode(qrContainer, {
    text: customId,
    width: 250,
    height: 250,
    colorDark: '#000000',
    colorLight: '#ffffff',
  });

  const infoDiv = document.createElement('div');
  infoDiv.className = 'mt-3 text-center';
  infoDiv.innerHTML = `<strong>${customId}</strong>`;
  specContent.appendChild(infoDiv);

  document.getElementById('specTargetHeader').innerHTML = `
    <strong>QR Code for Asset</strong>
  `;

  const specModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('specModal'));
  specModal.show();
};

window.printQRLabels = (assetNameOrIdList, isGroup = false) => {
  let assetsToPrint = [];

  if (isGroup) {
    assetsToPrint = currentAssets.filter(a => a.name === assetNameOrIdList);
  } else {
    const asset = currentAssets.find(a => a.customId === assetNameOrIdList);
    if (asset) assetsToPrint = [asset];
  }

  if (!assetsToPrint.length) {
    alert('No assets to print');
    return;
  }

  const printWindow = window.open('', '', 'width=900,height=700');
  if (!printWindow) {
    alert('Please allow popups to print labels');
    return;
  }

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>QR Code Labels</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 10px; background: white; }
          .labels-grid { display: flex; flex-wrap: wrap; gap: 12px; }
          .label { 
            width: 200px; 
            min-height: 260px; 
            border: 2px solid #333; 
            padding: 10px; 
            text-align: center;
            background: white;
            page-break-inside: avoid;
          }
          .qr-container { margin: 10px auto; width: 120px; height: 120px; }
          .label-info { font-size: 10px; font-weight: bold; word-break: break-word; margin-top: 8px; }
          .label-title { font-size: 12px; margin-bottom: 8px; font-weight: 700; }
          @media print {
            body { padding: 0; }
            .label { border-width: 1px; }
          }
        </style>
      </head>
      <body>
        <div class="labels-grid">
          ${assetsToPrint.map(asset => `
            <div class="label">
              <div class="label-title">${asset.name}</div>
              <img class="qr-container" src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(asset.customId || '')}" alt="QR Code" />
              <div class="label-info">${asset.customId}</div>
            </div>
          `).join('')}
        </div>
        <script>
          window.onload = () => setTimeout(() => window.print(), 200);
        <\/script>
      </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
};

window.exportAssetsToDetailedPDF = function() {
  if (currentAssets.length === 0) {
    alert('No assets to export');
    return;
  }

  // 🐛 FIX: Dynamically maps the global jsPDF regardless of ES6 module restrictions
  const jsPDF = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;

  if (!jsPDF) {
    alert('jsPDF library is not loaded. Please check your network or adblocker.');
    return;
  }

  const doc = new jsPDF('p', 'mm', 'a4');
  let yPosition = 15;
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 10;
  const contentWidth = pageWidth - (2 * margin);

  doc.setFontSize(16);
  doc.text('Asset Inventory Report with QR Codes', margin, yPosition);
  yPosition += 12;

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, yPosition);
  doc.setTextColor(0);
  yPosition += 8;

  currentAssets.forEach((asset, index) => {
    if (yPosition > pageHeight - 50) {
      doc.addPage();
      yPosition = 15;
    }

    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text(`${index + 1}. ${asset.name}`, margin, yPosition);
    yPosition += 7;

    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    const assetDetails = [
      `ID: ${asset.customId || 'N/A'}`,
      `Type: ${asset.type || 'N/A'}`,
      `Location: ${asset.location || 'Central Warehouse'}`,
      `Department: ${asset.department || 'Unassigned'}`,
      `Status: ${asset.status || 'Available'}`,
      `Barcode: ${asset.barcode || 'N/A'}`,
    ];

    assetDetails.forEach(detail => {
      doc.text(detail, margin + 2, yPosition);
      yPosition += 5;
    });

    if (asset.specifications && Object.keys(asset.specifications).length > 0) {
      doc.setFont(undefined, 'bold');
      doc.text('Specifications:', margin + 2, yPosition);
      yPosition += 5;
      doc.setFont(undefined, 'normal');

      Object.entries(asset.specifications).forEach(([key, value]) => {
        const specText = `• ${key}: ${value}`;
        const splitText = doc.splitTextToSize(specText, contentWidth - 4);
        splitText.forEach(line => {
          doc.text(line, margin + 4, yPosition);
          yPosition += 4;
        });
      });
    }

    doc.setFont(undefined, 'bold');
    doc.text('QR Code:', margin + 2, yPosition);
    yPosition += 5;
    doc.setFont(undefined, 'normal');
    doc.text(asset.customId || 'N/A', margin + 4, yPosition);
    yPosition += 8;

    doc.setDrawColor(200);
    doc.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 5;
  });

  doc.save('asset_inventory_with_specs.pdf');
  alert('PDF exported successfully!');
};

window.generateEOLReport = function() {
  if (currentAssets.length === 0) {
    alert('No assets available to analyze.');
    return;
  }

  // 🐛 FIX: Dynamically maps the global jsPDF regardless of ES6 module restrictions
  const jsPDF = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;

  if (!jsPDF) {
    alert('jsPDF library is not loaded. Please check your network or adblocker.');
    return;
  }

  const doc = new jsPDF();
  
  if (typeof doc.autoTable !== 'function') {
    alert('jsPDF autoTable library failed to attach. Ensure it is loaded correctly in HTML.');
    return;
  }

  const reportData = [];
  let totalEstimatedBudget = 0;

  currentAssets.forEach(asset => {
    const eol = getEOLDetails(asset);

    if (eol.daysRemaining <= 365) {
      totalEstimatedBudget += eol.metrics.cost;

      reportData.push([
        asset.name, 
        asset.department || 'Unassigned',
        asset.type.toUpperCase(),
        eol.expiryDate.toLocaleDateString(),
        eol.daysRemaining < 0 ? '⚠️ EXPIRED' : `${Math.ceil(eol.daysRemaining / 30)} Months`,
        `$${eol.metrics.cost.toLocaleString()}`
      ]);
    }
  });

  if (reportData.length === 0) {
    alert('Great news! No assets are reaching End-of-Life within the next 12 months.');
    return;
  }

  doc.setFontSize(18);
  doc.setTextColor(220, 53, 69);
  doc.text('Predictive End-of-Life (EOL) Budget Report', 14, 20);
  
  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 28);
  
  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.text(`Estimated Replacement Funding Needed (Next 12 Months): $${totalEstimatedBudget.toLocaleString()}`, 14, 38);

  doc.autoTable({
    head: [['Asset Name', 'Department', 'Type', 'Est. Expiry Date', 'Time Remaining', 'Est. Replacement Cost']],
    body: reportData,
    startY: 45,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [220, 53, 69] },
    alternateRowStyles: { fillColor: [250, 240, 240] }
  });

  doc.save('OpsMind_Predictive_EOL_Budget.pdf');
};

// --- UI Helper Functions ---
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

// Ensure functions are exposed to the window object for HTML inline handlers
window.resetFilters = resetFilters;
window.filterGroupTable = filterGroupTable;
window.handleSearchKeyPress = handleSearchKeyPress;
window.filterDetailsTable = filterDetailsTable;