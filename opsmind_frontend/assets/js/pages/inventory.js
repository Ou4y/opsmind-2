import UI from '/assets/js/ui.js';

// Config is set as globals in config.js (loaded in HTML head)
const API_URL = window.OPSMIND_INVENTORY_API_URL || 'http://localhost:5000/api';

// Define configuration variables globally so the rest of the script can use them
let BUILDINGS = [];
let DEPARTMENTS = [];
let ASSET_TYPES = [];
let EOL_METRICS = {};

let selectedAssetCustomId = null;
let currentAssets = [];
const lifespanPredictionCache = new Map();

const TYPE_ALIASES = {
  LAPTOP: 'laptop',
  DESKTOP: 'desktop',
  TABLET: 'tablet',
  SERVER: 'server',
  MONITOR: 'monitor',
  PERIPHERAL: 'peripheral',
  KEYBOARD: 'keyboard',
  ELECTRONICS: 'electronics',
  PROJECTOR: 'projector',
  SMARTBOARD: 'smartboard',
  CAMERA: 'camera',
  SPEAKER: 'speaker',
  MICROPHONE: 'microphone',
  ROUTER: 'router',
  SWITCH: 'switch',
  ACCESS_POINT: 'access_point',
  FIREWALL: 'firewall',
  PRINTER: 'printer',
  SCANNER: 'scanner',
  DESK: 'desk',
  CHAIR: 'chair',
  WHITEBOARD: 'whiteboard',
  FILING_CABINET: 'filing_cabinet',
  FURNITURE: 'furniture',
  MICROSCOPE: 'microscope',
  CENTRIFUGE: 'centrifuge',
  OSCILLOSCOPE: 'oscilloscope',
  THREE_D_PRINTER: '3d_printer',
  LAB_BENCH: 'lab_bench',
  VEHICLE: 'vehicle',
  GENERATOR: 'generator',
  HVAC: 'hvac',
  MAINTENANCE_TOOL: 'maintenance_tool'
};

const LOCATION_ALIASES = {
  CENTRAL_WAREHOUSE: 'Central Warehouse',
  MAIN_BUILDING: 'Main Building',
  K_BUILDING: 'K Building',
  N_BUILDING: 'N Building',
  S_BUILDING: 'S Building',
  R_BUILDING: 'R Building',
  PHARMACY_BUILDING: 'Pharmacy Building'
};

const DEPARTMENT_ALIASES = {
  COMPUTER_SCIENCE: 'Computer Science',
  ENGINEERING: 'Engineering',
  ARCHITECTURE: 'Architecture',
  BUSINESS: 'Business',
  MASS_COMM: 'Mass Comm',
  ALSUN: 'Alsun',
  PHARMACY: 'Pharmacy',
  DENTISTRY: 'Dentistry',
  UNASSIGNED: 'Unassigned',
  GENERAL: 'General'
};

function normalizeValue(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function canonicalType(type) {
  const raw = String(type || '');
  return TYPE_ALIASES[raw.toUpperCase()] || raw.toLowerCase();
}

function displayLocation(location) {
  const raw = String(location || '');
  return LOCATION_ALIASES[raw.toUpperCase()] || raw || 'Unknown';
}

function displayDepartment(department) {
  const raw = String(department || '');
  return DEPARTMENT_ALIASES[raw.toUpperCase()] || raw || 'Unassigned';
}

function displayStatus(status) {
  const raw = String(status || 'active').toUpperCase();
  const map = {
    ACTIVE: 'Active',
    REPAIR: 'Repair',
    RETIRED: 'Retired',
    ASSIGNED: 'Assigned',
    MAINTENANCE: 'Maintenance'
  };
  return map[raw] || capitalize(String(status || 'Active'));
}

const TRACKABLE_ASSET_TYPES = new Set([
  'laptop', 'desktop', 'tablet', 'server', 'monitor', 'projector', 'smartboard',
  'camera', 'speaker', 'microphone', 'router', 'switch', 'access_point',
  'firewall', 'printer', 'scanner', 'microscope', 'centrifuge', 'oscilloscope',
  '3d_printer', 'vehicle', 'generator', 'hvac', 'maintenance_tool'
]);

const BRAND_LIFESPAN_FACTORS = {
  apple: 1.14,
  dell: 1.08,
  hp: 1.04,
  lenovo: 1.07,
  cisco: 1.16,
  ubiquiti: 1.06,
  epson: 1.05,
  canon: 1.04,
  samsung: 1.05,
  lg: 1.04,
  acer: 0.96,
  asus: 1.0,
  generic: 0.9
};

const QUALITY_LIFESPAN_FACTORS = {
  budget: 0.86,
  standard: 1,
  premium: 1.16,
  rugged: 1.22
};

const OPERATIONAL_STATE_RATES = {
  online_in_use: 1,
  online_idle: 0.2,
  offline: 0
};

const OPERATIONAL_STATE_LABELS = {
  online_in_use: 'Online - In use',
  online_idle: 'Online but idle',
  offline: 'Offline'
};

function parseSpecsText(specsText) {
  const specs = {};
  if (!specsText.trim()) return specs;

  specsText.split('\n').forEach(line => {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) return;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key && value) specs[key] = value;
  });

  return specs;
}

function getAssetSpecs(asset) {
  return (asset?.specifications && typeof asset.specifications === 'object') ? asset.specifications : {};
}

function toBoolean(value) {
  return value === true || value === 'true' || value === 'yes' || value === '1';
}

function getSpecNumber(specs, keys, fallback = 0) {
  for (const key of keys) {
    const matchKey = Object.keys(specs).find(k => normalizeValue(k) === normalizeValue(key));
    if (!matchKey) continue;

    const raw = String(specs[matchKey] ?? '');
    const parsed = Number(raw.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function inferAssetQuality({ brand = '', version = '', specs = {}, type = '' } = {}) {
  const brandKey = normalizeValue(brand);
  const modelKey = normalizeValue(version);
  const typeKey = canonicalType(type);
  const ramGb = getSpecNumber(specs, ['RAM', 'Memory'], 0);
  const storageGb = getSpecNumber(specs, ['Storage', 'SSD', 'Disk'], 0);

  let score = 50;

  if (['apple', 'cisco'].includes(brandKey)) score += 20;
  else if (['dell', 'lenovo', 'hp', 'samsung', 'lg'].includes(brandKey)) score += 12;
  else if (['acer', 'generic'].includes(brandKey)) score -= 8;

  if (/pro|max|precision|thinkpad|latitude|elitebook|zbook|xps|server|enterprise|rugged|ultra/.test(modelKey)) score += 18;
  if (/inspiron|pavilion|ideapad|aspire|basic|entry|mini/.test(modelKey)) score -= 12;
  if (/rugged|toughbook|industrial/.test(modelKey)) score += 24;

  if (ramGb >= 32) score += 10;
  else if (ramGb >= 16) score += 5;
  else if (ramGb > 0 && ramGb < 8) score -= 8;

  if (storageGb >= 1000) score += 6;
  else if (storageGb > 0 && storageGb < 256) score -= 5;

  if (['server', 'firewall', 'switch'].includes(typeKey)) score += 8;

  if (score >= 82 || /rugged|toughbook|industrial/.test(modelKey)) return 'rugged';
  if (score >= 66) return 'premium';
  if (score <= 42) return 'budget';
  return 'standard';
}

function getOperationalState(specs) {
  const state = String(specs.operationalState || 'offline');
  return OPERATIONAL_STATE_RATES[state] !== undefined ? state : 'offline';
}

function getEffectiveWorkingHours(specs) {
  const storedHours = Math.max(0, getSpecNumber(specs, ['workingHours', 'Working Hours'], 0));
  const state = getOperationalState(specs);
  const stateUpdatedAt = specs.operationalStateUpdatedAt ? new Date(specs.operationalStateUpdatedAt) : null;

  if (!stateUpdatedAt || Number.isNaN(stateUpdatedAt.getTime())) return storedHours;

  const elapsedHours = Math.max(0, (Date.now() - stateUpdatedAt.getTime()) / 36e5);
  return storedHours + (elapsedHours * OPERATIONAL_STATE_RATES[state]);
}

function getAssetProfile(asset) {
  const specs = getAssetSpecs(asset);
  const brand = String(specs.brand || specs.Brand || '').trim();
  const version = String(specs.version || specs.Version || specs.model || specs.Model || '').trim();
  const quality = String(specs.inferredQuality || specs.quality || inferAssetQuality({ brand, version, specs, type: asset?.type })).toLowerCase();
  const workingHours = Math.max(0, getEffectiveWorkingHours(specs));
  const trackWorkingHours = toBoolean(specs.trackWorkingHours) && TRACKABLE_ASSET_TYPES.has(canonicalType(asset?.type));
  const operationalState = getOperationalState(specs);

  return { specs, brand, quality, version, workingHours, trackWorkingHours, operationalState };
}

function estimateSpecFactor(asset) {
  const { specs } = getAssetProfile(asset);
  const ramGb = getSpecNumber(specs, ['RAM', 'Memory'], 0);
  const storageGb = getSpecNumber(specs, ['Storage', 'SSD', 'Disk'], 0);

  let factor = 1;
  if (ramGb >= 32) factor += 0.08;
  else if (ramGb >= 16) factor += 0.04;
  else if (ramGb > 0 && ramGb < 8) factor -= 0.06;

  if (storageGb >= 1000) factor += 0.04;
  else if (storageGb > 0 && storageGb < 256) factor -= 0.04;

  return factor;
}

function estimateVersionFactor(version) {
  const yearMatch = String(version || '').match(/\b(20\d{2}|19\d{2})\b/);
  if (!yearMatch) return 1;

  const age = new Date().getFullYear() - Number(yearMatch[1]);
  if (age <= 1) return 1.08;
  if (age <= 3) return 1.03;
  if (age >= 7) return 0.88;
  return 1;
}

function predictAssetLifespan(asset, metrics) {
  const profile = getAssetProfile(asset);
  const brandFactor = BRAND_LIFESPAN_FACTORS[normalizeValue(profile.brand)] || 1;
  const qualityFactor = QUALITY_LIFESPAN_FACTORS[profile.quality] || 1;
  const versionFactor = estimateVersionFactor(profile.version);
  const specFactor = estimateSpecFactor(asset);
  const baseYears = metrics.years || 5;
  let predictedYears = baseYears * brandFactor * qualityFactor * versionFactor * specFactor;

  if (profile.trackWorkingHours && profile.workingHours > 0) {
    const expectedLifetimeHours = baseYears * 365 * 8;
    const usageRatio = profile.workingHours / expectedLifetimeHours;
    const stateStress = profile.operationalState === 'online_in_use' ? 0.94 : profile.operationalState === 'online_idle' ? 0.99 : 1.03;
    const usageFactor = Math.max(0.5, 1 - Math.max(0, usageRatio - 0.25) * 0.42);
    predictedYears *= usageFactor * stateStress;
  }

  return {
    years: Math.max(1, Number(predictedYears.toFixed(1))),
    source: profile.trackWorkingHours ? 'profile + working hours' : 'profile',
    profile
  };
}

function buildAssetLifespanPayload(asset, baseMetrics) {
  const profile = getAssetProfile(asset);
  return {
    assetId: asset.customId,
    type: canonicalType(asset.type),
    brand: profile.brand,
    model: profile.version,
    specifications: profile.specs,
    baseLifespanYears: baseMetrics.years || 5,
    workingHours: Math.round(profile.workingHours),
    operationalState: profile.operationalState
  };
}

async function loadAssetLifespanPredictions() {
  lifespanPredictionCache.clear();
  if (!currentAssets.length) return;

  await Promise.all(currentAssets.map(async (asset) => {
    const baseMetrics = EOL_METRICS[canonicalType(asset.type)] || EOL_METRICS.default || { years: 5, cost: 500 };
    try {
      const response = await fetch(`${API_URL}/assets/${encodeURIComponent(asset.customId)}/lifespan-prediction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseLifespanYears: baseMetrics.years || 5 })
      });
      if (!response.ok) throw new Error('AI lifespan prediction unavailable');

      const prediction = await response.json();
      lifespanPredictionCache.set(asset.customId, {
        years: Number(prediction.predicted_lifespan_years) || baseMetrics.years,
        source: prediction.model_version || 'ai-service',
        failureRisk: Number(prediction.failure_risk || 0),
        profile: {
          ...getAssetProfile(asset),
          quality: prediction.quality_tier || getAssetProfile(asset).quality
        },
        explanation: prediction.explanation || ''
      });
    } catch (error) {
      lifespanPredictionCache.set(asset.customId, predictAssetLifespan(asset, baseMetrics));
    }
  }));
}

function showInventoryInsight(options = {}) {
  return new Promise((resolve) => {
    const {
      title = 'OPSMIND UPDATE',
      message = 'Done.',
      type = 'success',
      confirmText = 'Done',
      cancelText = '',
      confirmClass = 'inventory-insight-primary'
    } = options;

    const modalId = `inventoryInsight-${Date.now()}`;
    const iconMap = {
      success: 'bi-check2-circle',
      info: 'bi-stars',
      warning: 'bi-exclamation-triangle',
      error: 'bi-x-circle',
      danger: 'bi-trash3'
    };

    const modalHTML = `
      <div class="modal fade inventory-insight-modal inventory-modal-stack-high" id="${modalId}" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content border-0 shadow-lg inventory-insight-content inventory-insight-tone-${type}">
            <button type="button" class="btn-close inventory-insight-close" data-bs-dismiss="modal" aria-label="Close"></button>
            <div class="modal-body text-center">
              <div class="inventory-insight-icon">
                <i class="bi ${iconMap[type] || iconMap.info}"></i>
              </div>
              <h4 class="inventory-insight-title">${UI.escapeHTML(title)}</h4>
              <p class="inventory-insight-message">${UI.escapeHTML(message)}</p>
              <div class="inventory-insight-actions">
                ${cancelText ? `<button type="button" class="btn btn-light border inventory-insight-secondary" data-bs-dismiss="modal">${UI.escapeHTML(cancelText)}</button>` : ''}
                <button type="button" class="btn ${confirmClass}" id="${modalId}-confirm">${UI.escapeHTML(confirmText)}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const modalElement = document.getElementById(modalId);
    const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
    let settled = false;

    document.getElementById(`${modalId}-confirm`).addEventListener('click', () => {
      settled = true;
      modal.hide();
      resolve(true);
    });

    modalElement.addEventListener('hidden.bs.modal', () => {
      modalElement.remove();
      if (!settled) resolve(false);
    }, { once: true });

    modal.show();
  });
}

function confirmInventoryAction(options = {}) {
  return showInventoryInsight({
    title: options.title || 'CONFIRM ACTION',
    message: options.message || 'Are you sure you want to continue?',
    type: options.type || 'danger',
    confirmText: options.confirmText || 'Confirm',
    cancelText: options.cancelText || 'Cancel',
    confirmClass: options.confirmClass || 'inventory-insight-danger'
  });
}

function showMessage(message, type = 'info') {
  if (['success', 'info'].includes(type) && window.bootstrap) {
    showInventoryInsight({
      title: type === 'success' ? 'OPSMIND UPDATE' : 'OPSMIND INSIGHT',
      message,
      type,
      confirmText: 'Got it'
    });
  } else if (document.getElementById('toastContainer')) {
    UI.showToast(message, type);
  } else {
    console[type === 'error' ? 'error' : 'log'](message);
  }
}

function toValidDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getLifecycleSnapshot(asset) {
  const specs = getAssetSpecs(asset);
  const lifecycle = (specs.lifecycle && typeof specs.lifecycle === 'object') ? specs.lifecycle : {};
  const purchaseDate = toValidDate(lifecycle.purchaseDate || specs.purchaseDate || specs.acquiredAt || asset.createdAt);
  const commissionedAt = toValidDate(lifecycle.commissionedAt || specs.commissionedAt) || purchaseDate;
  const failureDate = toValidDate(lifecycle.failureDate || specs.failureDate);
  const replacementDate = toValidDate(lifecycle.replacementDate || specs.replacementDate);
  const retiredAt = toValidDate(lifecycle.retiredAt || specs.retiredAt);
  const actualLifespanYears = Number(lifecycle.actualLifespanYears ?? specs.actualLifespanYears ?? specs.lifespanYears);
  const replacementCost = Number(lifecycle.replacementCost ?? specs.replacementCost ?? 0);
  const statusKey = String(asset?.status || '').toLowerCase();
  const finalOutcome = String(lifecycle.finalOutcome || specs.finalOutcome || '').toLowerCase() || (statusKey === 'retired' ? 'retired' : 'active');

  return {
    purchaseDate,
    commissionedAt,
    failureDate,
    replacementDate,
    retiredAt,
    actualLifespanYears: Number.isFinite(actualLifespanYears) && actualLifespanYears > 0 ? actualLifespanYears : null,
    replacementCost: Number.isFinite(replacementCost) && replacementCost > 0 ? replacementCost : null,
    finalOutcome
  };
}

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
  const assetTypeSelect = document.getElementById('assetType');
  const brandInput = document.getElementById('assetBrand');
  const versionInput = document.getElementById('assetVersion');
  const specsInput = document.getElementById('assetSpecs');
  if (locSelect) locSelect.value = 'Central Warehouse';
  if (deptSelect) deptSelect.value = 'Unassigned';
  if (assetTypeSelect) assetTypeSelect.addEventListener('change', () => {
    updateWorkingHoursAvailability();
    updateInferredQualityPreview();
  });
  [brandInput, versionInput, specsInput].forEach(input => {
    if (input) input.addEventListener('input', updateInferredQualityPreview);
  });

  const buildingFilter = document.getElementById('filterBuilding');
  const deptFilter = document.getElementById('filterDept');
  const typeFilter = document.getElementById('filterType');

  if (buildingFilter) buildingFilter.addEventListener('change', syncFilters);
  if (deptFilter) deptFilter.addEventListener('change', syncFilters);
  if (typeFilter) typeFilter.addEventListener('change', syncFilters);

  updateWorkingHoursAvailability();
  updateInferredQualityPreview();
});

async function initializePage() {
  await loadConfig(); // 1. Fetch config from backend first!
  await loadAssets(); // 2. Then load assets and render
}

// ðŸš€ Fetches the single source of truth from your new backend route
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
    showMessage('Could not load inventory configuration. Is the backend running?', 'error');
  }
}

async function loadAssets() {
  try {
    const response = await fetch(`${API_URL}/assets`);
    if (!response.ok) throw new Error('Failed to fetch assets');

    const assets = await response.json();
    currentAssets = assets; 
    await loadAssetLifespanPredictions();

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

// ðŸ¤– AI Prediction Math Helper
function getEOLDetails(asset) {
  const now = new Date();
  const lifecycle = getLifecycleSnapshot(asset);
  const startDate = lifecycle.commissionedAt || lifecycle.purchaseDate || toValidDate(asset.createdAt) || now;
  const outcomeDate = lifecycle.replacementDate || lifecycle.retiredAt || lifecycle.failureDate;

  const defaultMetrics = { years: 5, cost: 500 };
  const baseMetrics = EOL_METRICS[canonicalType(asset.type)] || EOL_METRICS.default || defaultMetrics;
  const prediction = lifespanPredictionCache.get(asset.customId) || predictAssetLifespan(asset, baseMetrics);
  const predictedYears = lifecycle.actualLifespanYears || prediction.years || baseMetrics.years || defaultMetrics.years;
  const metrics = {
    ...baseMetrics,
    years: Math.max(0.5, Number(predictedYears) || defaultMetrics.years),
    cost: lifecycle.replacementCost || baseMetrics.cost,
    prediction
  };

  const expiryDate = outcomeDate ? new Date(outcomeDate) : new Date(startDate);
  if (!outcomeDate) expiryDate.setDate(expiryDate.getDate() + Math.round(metrics.years * 365));

  const msRemaining = expiryDate - now;
  const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
  const closedOutcome = ['retired', 'replaced', 'failed'].includes(lifecycle.finalOutcome) || String(asset.status || '').toLowerCase() === 'retired';
  const failureRisk = Number(prediction.failureRisk || 0);

  let remainingText = '';
  let statusClass = 'bg-success';

  if (closedOutcome && outcomeDate) {
    remainingText = `${capitalize(lifecycle.finalOutcome || 'retired')} on ${outcomeDate.toLocaleDateString()}`;
    statusClass = 'bg-secondary';
  } else if (daysRemaining < 0) {
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

  if (!closedOutcome && failureRisk >= 0.9) {
    statusClass = 'bg-danger';
    remainingText = `High failure risk (${Math.round(failureRisk * 100)}%)`;
  } else if (!closedOutcome && failureRisk >= 0.75 && daysRemaining > 180) {
    statusClass = 'bg-warning text-dark';
    remainingText = `Elevated risk (${Math.round(failureRisk * 100)}%)`;
  }

  return { remainingText, statusClass, daysRemaining, metrics, expiryDate, failureRisk, isClosedLifecycle: closedOutcome };
}

function checkGlobalEOLAlerts() {
  const activeAssets = currentAssets.filter((asset) => !getEOLDetails(asset).isClosedLifecycle);
  const expiringCount = activeAssets.filter(a => {
    const eol = getEOLDetails(a);
    return eol.daysRemaining >= 0 && eol.daysRemaining <= 180;
  }).length;

  const expiredCount = activeAssets.filter(a => getEOLDetails(a).daysRemaining < 0).length;
  const banner = document.getElementById('eolAlertBanner');
  
  if (banner && (expiringCount > 0 || expiredCount > 0)) {
      let html = `
      <div class="alert alert-danger d-flex justify-content-between align-items-center shadow-sm mb-4">
          <div>
            <h5 class="mb-1 fw-bold"><i class="bi bi-exclamation-triangle-fill me-2"></i> EOL Action Required</h5>
            <span class="text-dark">OpsMind detected <b>${expiringCount}</b> asset(s) expiring within 6 months, and <b>${expiredCount}</b> expired asset(s) active in the field.</span>
          </div>
          <button class="btn btn-dark" onclick="generateEOLReport()">Download Budget Report</button>
      </div>`;
      banner.innerHTML = html;
      banner.classList.remove('d-none');
  } else if (banner) {
      banner.classList.add('d-none');
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

  if (BUILDINGS.includes(currentBuilding) || currentBuilding === 'all') buildingSelect.value = currentBuilding;
  if (DEPARTMENTS.includes(currentDept) || currentDept === 'all') deptSelect.value = currentDept;
  if (ASSET_TYPES.map(a => a.value).includes(currentType) || currentType === 'all') typeSelect.value = currentType;
}

function syncFilters() {
  renderTable();
  filterGroupTable();
}
function resetFilters() {
  document.getElementById('filterBuilding').value = 'all';
  document.getElementById('filterDept').value = 'all';
  document.getElementById('filterType').value = 'all';
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';
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
    const matchBuilding = !buildingFilter || buildingFilter === 'all' || normalizeValue(displayLocation(asset.location)) === normalizeValue(buildingFilter);
    const matchDept = !deptFilter || deptFilter === 'all' || normalizeValue(displayDepartment(asset.department)) === normalizeValue(deptFilter);
    const matchType = !typeFilter || typeFilter === 'all' || normalizeValue(canonicalType(asset.type)) === normalizeValue(typeFilter);
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
    const typeObj = ASSET_TYPES.find(t => normalizeValue(t.value) === normalizeValue(canonicalType(firstAsset.type)));
    const typeLabel = typeObj ? typeObj.label : formatType(firstAsset.type);
    
    const locationsSet = new Set(assetGroup.map(a => displayLocation(a.location)).filter(Boolean));
    const departmentsSet = new Set(assetGroup.map(a => displayDepartment(a.department)).filter(Boolean));
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
  const brand = document.getElementById('assetBrand')?.value.trim() || '';
  const version = document.getElementById('assetVersion')?.value.trim() || '';
  const trackWorkingHours = Boolean(document.getElementById('assetTrackHours')?.checked);
  const manualSpecs = parseSpecsText(document.getElementById('assetSpecs')?.value || '');
  const inferredQuality = inferAssetQuality({ brand, version, specs: manualSpecs, type });
  const specifications = {
    ...manualSpecs,
    brand,
    version,
    inferredQuality,
    trackWorkingHours,
    workingHours: 0,
    operationalState: trackWorkingHours ? 'offline' : undefined,
    operationalStateUpdatedAt: trackWorkingHours ? new Date().toISOString() : undefined
  };

  const idleAssets = currentAssets.filter(a =>
    normalizeValue(canonicalType(a.type)) === normalizeValue(type) &&
    (
      normalizeValue(displayLocation(a.location)) === normalizeValue('Central Warehouse') ||
      normalizeValue(displayDepartment(a.department)) === normalizeValue('Unassigned') ||
      ['ACTIVE', 'AVAILABLE'].includes(String(a.status || '').toUpperCase())
    )
  );
  
  if (idleAssets.length > 0 && location !== 'Central Warehouse') {
      const aiMessage = `
        You are requesting <strong class="text-dark">${quantity}</strong> new <strong class="text-dark">${formatType(type)}</strong>(s) for <strong>${department}</strong>.<br><br>
        Wait! OpsMind found <span class="badge rounded-pill fs-6 inventory-ai-count-badge">${idleAssets.length} idle</span> ${formatType(type)}(s) currently sitting in the Central Warehouse.<br><br>
        Would you like to cancel this new purchase and transfer the existing assets instead?
      `;

      const proceed = await showAIModal(aiMessage);
      
      if (proceed) {
          const modalEl = document.getElementById('receiveOrderModal');
          if (modalEl) bootstrap.Modal.getInstance(modalEl).hide();
          
          document.getElementById('filterType').value = type;
          document.getElementById('filterBuilding').value = 'Central Warehouse';
          syncFilters();
          setTimeout(() => showMessage('Existing stock is now filtered and ready for transfer.', 'info'), 250);
          return; 
      }
  }

  submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving...';
  submitBtn.disabled = true;

  function generateCustomId() { return `ASSET-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

  try {
    for (let i = 0; i < quantity; i++) {
      const customId = generateCustomId();
      const assetData = { name, customId, type, location, department, status: 'active', quantity: 1, specifications };

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
    updateWorkingHoursAvailability();
    updateInferredQualityPreview();

    await loadAssets();
    showMessage(`Created ${quantity} asset${quantity === 1 ? '' : 's'} successfully.`, 'success');

  } catch (error) {
    console.error('Error:', error);
    showMessage(error.message || 'Failed to create asset.', 'error');
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

      modalInstance.show();
  });
}

// --- View Asset Group Details ---
window.viewAssetDetails = (assetName) => {
  const groupAssets = currentAssets.filter(a => a.name === assetName);
  
  if (!groupAssets.length) {
    showMessage('Asset group not found.', 'error');
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
    aiBanner.className = 'alert w-100 d-flex align-items-center mb-3 mt-2 ai-summary-banner';
    
    const failingCount = groupAssets.filter(a => { const eol = getEOLDetails(a); return !eol.isClosedLifecycle && eol.daysRemaining <= 180; }).length;
    let aiText = `<strong>AI Prediction:</strong> Profile-based lifespan for a <strong>${formatType(sampleAsset.type)}</strong> is <strong>${eolData.metrics.years} years</strong>. `;
    
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
    const profile = eol.metrics.prediction.profile;
    const isDeployed = normalizeValue(displayLocation(asset.location)) !== normalizeValue('Central Warehouse');
    const trackingLabel = profile.trackWorkingHours
      ? `${OPERATIONAL_STATE_LABELS[profile.operationalState]} - ${Math.round(profile.workingHours).toLocaleString()}h`
      : 'Hours not tracked';
    return `
    <tr>
      <td class="ps-4">
        <span class="font-monospace fw-bold">${asset.customId}</span>
        <div class="text-muted pred-lifespan-text">${profile.brand || 'Unknown brand'}${profile.version ? ` - ${profile.version}` : ''}</div>
        <div class="text-muted pred-lifespan-text">Detected quality: ${capitalize(profile.quality)}</div>
      </td>
      <td>
        <span class="badge ${getStatusBadgeClass(asset.status)}">
          ${displayStatus(asset.status)}
        </span>
      </td>
      <td>${displayLocation(asset.location)}</td>
      <td>${displayDepartment(asset.department)}</td>
      <td>
        <div class="mb-1">
          <span class="badge ${eol.statusClass}">${eol.remainingText}</span>
        </div>
        <div class="text-muted pred-lifespan-text">
          <i class="bi bi-magic inventory-ai-inline-icon"></i> AI Lifespan: ${eol.metrics.years}y
        </div>
        <div class="text-muted pred-lifespan-text">
          <i class="bi bi-shield-exclamation inventory-ai-inline-icon"></i> Failure risk: ${Math.round((eol.failureRisk || 0) * 100)}%
        </div>
        <div class="text-muted pred-lifespan-text">
          <i class="bi bi-clock-history inventory-ai-inline-icon"></i> ${trackingLabel}
        </div>
      </td>
      <td class="text-end pe-4">
        ${profile.trackWorkingHours && isDeployed ? `
        <button class="btn btn-sm btn-outline-dark" onclick="window.viewOperationalTelemetry('${asset.customId}')" title="Auto-detected Device State">
          <i class="bi bi-activity"></i>
        </button>` : ''}
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
        <button class="btn btn-sm btn-danger" onclick="window.deleteIndividual('${asset.customId}')" title="Delete">
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
  document.getElementById('buildingSelect').classList.add('d-none');
  document.getElementById('deptSelect').classList.add('d-none');
  
  populateTransferSelects();
  
  const transferModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('transferModal'));
  transferModal.show();
};

window.deleteIndividual = async (customId) => {
  const assetToDelete = currentAssets.find(a => a.customId === customId);
  const confirmed = await confirmInventoryAction({
    title: 'Delete Asset',
    message: `Delete ${assetToDelete?.name || 'this asset'} (${customId})? This cannot be undone.`,
    confirmText: 'Delete',
    confirmClass: 'inventory-insight-danger'
  });
  if (!confirmed) return;

  try {
    const response = await fetch(`${API_URL}/assets/${encodeURIComponent(customId)}`, { method: 'DELETE' });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to delete asset');
    }

    const groupName = assetToDelete?.name;
    await loadAssets();

    if (groupName && currentAssets.some(a => a.name === groupName)) {
      window.viewAssetDetails(groupName);
    } else {
      const detailsModal = bootstrap.Modal.getInstance(document.getElementById('detailsModal'));
      if (detailsModal) detailsModal.hide();
    }

    showMessage(`Deleted ${customId}.`, 'success');
  } catch (error) {
    console.error(error);
    showMessage(error.message || 'Failed to delete asset.', 'error');
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
  document.getElementById('buildingSelect').classList.add('d-none');
  document.getElementById('deptSelect').classList.add('d-none');
  
  populateTransferSelects();
  
  const transferModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('transferModal'));
  transferModal.show();
};

window.bulkDeleteGroup = async (assetName) => {
  const groupAssets = currentAssets.filter(a => a.name === assetName);
  if (!groupAssets.length) return;

  const confirmed = await confirmInventoryAction({
    title: 'Delete Asset Group',
    message: `Delete all ${groupAssets.length} items of "${assetName}"? This cannot be undone.`,
    confirmText: 'Delete Group',
    confirmClass: 'inventory-insight-danger'
  });
  if (!confirmed) return;

  try {
    for (const asset of groupAssets) {
      const response = await fetch(`${API_URL}/assets/${encodeURIComponent(asset.customId)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`Failed to delete ${asset.customId}`);
    }

    const detailsModal = bootstrap.Modal.getInstance(document.getElementById('detailsModal'));
    if (detailsModal) detailsModal.hide();

    await loadAssets();
    showMessage(`Deleted all ${groupAssets.length} items of "${assetName}".`, 'success');
  } catch (error) {
    console.error(error);
    showMessage(error.message || 'Failed to delete asset group.', 'error');
  }
};

window.viewTransferHistory = async (customId) => {
  const historyContent = document.getElementById('historyContent');
  const historyTitle = document.querySelector('#historyModal .modal-title');

  if (historyTitle) historyTitle.textContent = `Audit Trail - ${customId}`;
  if (historyContent) {
    historyContent.innerHTML = `
      <div class="text-center py-4">
        <div class="spinner-border text-primary" role="status"></div>
        <p class="text-muted small mt-3 mb-0">Loading asset history...</p>
      </div>
    `;
  }

  const historyModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('historyModal'));
  historyModal.show();

  try {
    const response = await fetch(`${API_URL}/assets/${encodeURIComponent(customId)}/history`);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to load asset history');
    }

    const entries = await response.json();

    if (!Array.isArray(entries) || entries.length === 0) {
      historyContent.innerHTML = `
        <div class="empty-state py-4">
          <i class="bi bi-clock-history"></i>
          <h5>No history yet</h5>
          <p>This asset does not have recorded actions yet.</p>
        </div>
      `;
      return;
    }

    historyContent.innerHTML = entries.map(entry => `
      <div class="timeline-item">
        <div class="d-flex justify-content-between gap-3">
          <strong>${UI.escapeHTML(entry.event || 'Asset update')}</strong>
          <small class="text-muted">${UI.formatDateTime(entry.date)}</small>
        </div>
        <div class="text-muted small mt-1">${UI.escapeHTML(entry.details || '')}</div>
      </div>
    `).join('');
  } catch (error) {
    console.error(error);
    historyContent.innerHTML = `
      <div class="error-state py-4">
        <i class="bi bi-exclamation-triangle"></i>
        <h5>Could not load history</h5>
        <p>${UI.escapeHTML(error.message || 'Please try again.')}</p>
      </div>
    `;
    showMessage(error.message || 'Failed to load asset history.', 'error');
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
  buildingSelect.classList.toggle('d-none', !checkBuilding);
  if (checkBuilding) buildingSelect.value = '';
};

window.toggleDeptSelect = function() {
  const checkDept = document.getElementById('checkDept').checked;
  const deptSelect = document.getElementById('deptSelect');
  deptSelect.classList.toggle('d-none', !checkDept);
  if (checkDept) deptSelect.value = '';
};

window.toggleWorkingHoursInput = function() {
  updateWorkingHoursAvailability();
};

function updateWorkingHoursAvailability() {
  const type = canonicalType(document.getElementById('assetType')?.value || '');
  const checkbox = document.getElementById('assetTrackHours');
  if (!checkbox) return;

  const canTrack = TRACKABLE_ASSET_TYPES.has(type);
  checkbox.disabled = Boolean(type) && !canTrack;
  if (!canTrack) {
    checkbox.checked = false;
  }
}

function updateInferredQualityPreview() {
  const preview = document.getElementById('assetQualityPreview');
  if (!preview) return;

  const type = document.getElementById('assetType')?.value || '';
  const brand = document.getElementById('assetBrand')?.value.trim() || '';
  const version = document.getElementById('assetVersion')?.value.trim() || '';
  const specs = parseSpecsText(document.getElementById('assetSpecs')?.value || '');
  const quality = inferAssetQuality({ brand, version, specs, type });

  preview.textContent = `AI detected quality tier: ${capitalize(quality)}. This will be used for lifespan prediction.`;
}

window.submitTransfer = async () => {
  const buildingChecked = document.getElementById('checkBuilding').checked;
  const deptChecked = document.getElementById('checkDept').checked;
  const buildingValue = document.getElementById('buildingSelect').value;
  const deptValue = document.getElementById('deptSelect').value;
  const quantity = parseInt(document.getElementById('transferQty').value, 10) || 1;
  const confirmBtn = document.getElementById('confirmTransferBtn');
  const originalBtnText = confirmBtn.innerHTML;

  if (!buildingChecked && !deptChecked) {
    showMessage('Please select at least one destination type.', 'warning');
    return;
  }
  if (buildingChecked && !buildingValue) {
    showMessage('Please select a building.', 'warning');
    return;
  }
  if (deptChecked && !deptValue) {
    showMessage('Please select a department.', 'warning');
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
    showMessage('Transfer completed successfully.', 'success');
  } catch (error) {
    console.error(error);
    showMessage(error.message || 'Transfer failed.', 'error');
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = originalBtnText;
  }
};

window.viewOperationalTelemetry = async (customId) => {
  const asset = currentAssets.find(a => a.customId === customId);
  if (!asset) return;

  const profile = getAssetProfile(asset);
  const modalId = `operationalStateModal-${Date.now()}`;
  const modalHTML = `
    <div class="modal fade inventory-modal-stack-high" id="${modalId}" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content border-0 shadow-lg inventory-insight-content">
          <div class="modal-header">
            <h5 class="modal-title fw-bold"><i class="bi bi-activity me-2"></i>Device State</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <p class="text-muted small mb-3">This state is auto-detected from device heartbeat and activity telemetry for <strong>${UI.escapeHTML(customId)}</strong>.</p>
            <div class="inventory-ai-quality-preview mb-3">
              Detected state: ${OPERATIONAL_STATE_LABELS[profile.operationalState]}
            </div>
            <div class="inventory-ai-quality-preview mt-3">
              Current consumption-adjusted hours: ${Math.round(profile.workingHours).toLocaleString()}
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn inventory-insight-primary" data-bs-dismiss="modal">Got it</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);
  const modalElement = document.getElementById(modalId);
  const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
  modalElement.addEventListener('hidden.bs.modal', () => modalElement.remove(), { once: true });
  modal.show();
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
    showMessage('Asset not found.', 'error');
    return;
  }

  const specsText = targetAssets[0].specifications 
    ? Object.entries(targetAssets[0].specifications).map(([k, v]) => `${k}: ${v}`).join('\n')
    : '';

  document.getElementById('editSpecTextArea').value = specsText;
  document.getElementById('editSpecTargetId').value = isGroupEdit ? assetNameOrId : targetAssets[0].customId;

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

  const specs = parseSpecsText(specsText);

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
    showMessage('Specifications updated successfully.', 'success');
  } catch (error) {
    console.error(error);
    showMessage(error.message || 'Failed to update specifications.', 'error');
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
  qrContainer.className = 'inventory-qr-preview';
  
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

  if (Array.isArray(assetNameOrIdList)) {
    assetsToPrint = assetNameOrIdList;
  } else if (isGroup) {
    assetsToPrint = currentAssets.filter(a => a.name === assetNameOrIdList);
  } else {
    const asset = currentAssets.find(a => a.customId === assetNameOrIdList);
    if (asset) assetsToPrint = [asset];
  }

  if (!assetsToPrint.length) {
    showMessage('No assets to print.', 'warning');
    return;
  }

  const printWindow = window.open('', '', 'width=900,height=700');
  if (!printWindow) {
    showMessage('Please allow popups to print labels.', 'warning');
    return;
  }

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>QR Code Labels</title>
        <link href="/assets/css/main.css" rel="stylesheet">
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
  showMessage(`Opened print labels for ${assetsToPrint.length} asset${assetsToPrint.length === 1 ? '' : 's'}.`, 'success');
};

window.printSelectedLabels = () => {
  if (!currentAssets.length) {
    showMessage('No assets available to print.', 'warning');
    return;
  }

  const filteredRows = Array.from(document.querySelectorAll('#inventoryTableBody tr'))
    .filter(row => row.style.display !== 'none');
  const visibleNames = filteredRows
    .map(row => row.querySelector('.fw-bold.text-dark')?.textContent?.trim())
    .filter(Boolean);

  const assetsToPrint = visibleNames.length
    ? currentAssets.filter(asset => visibleNames.includes(asset.name))
    : currentAssets;

  if (!assetsToPrint.length) {
    showMessage('No visible assets match the current filters.', 'warning');
    return;
  }

  window.printQRLabels(assetsToPrint);
};

window.exportAssetsToDetailedPDF = function() {
  if (currentAssets.length === 0) {
    showMessage('No assets to export.', 'warning');
    return;
  }

  // ðŸ› FIX: Dynamically maps the global jsPDF regardless of ES6 module restrictions
  const jsPDF = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;

  if (!jsPDF) {
    showMessage('jsPDF is not loaded. Please check your network or ad blocker.', 'error');
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
    const eol = getEOLDetails(asset);
    const profile = eol.metrics.prediction.profile;

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
      `Type: ${formatType(asset.type)}`,
      `Location: ${displayLocation(asset.location)}`,
      `Department: ${displayDepartment(asset.department)}`,
      `Status: ${displayStatus(asset.status)}`,
      `Brand: ${profile.brand || 'N/A'}`,
      `Version: ${profile.version || 'N/A'}`,
      `Detected Quality: ${capitalize(profile.quality)}`,
      `Device State: ${profile.trackWorkingHours ? OPERATIONAL_STATE_LABELS[profile.operationalState] : 'Not tracked'}`,
      `AI Predicted Lifespan: ${eol.metrics.years} years`,
      `Consumption Hours: ${profile.trackWorkingHours ? Math.round(profile.workingHours).toLocaleString() : 'Not tracked'}`,
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
        const specText = `â€¢ ${key}: ${value}`;
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
  showMessage('Inventory PDF exported successfully.', 'success');
};

window.generateEOLReport = function() {
  if (currentAssets.length === 0) {
    showMessage('No assets available to analyze.', 'warning');
    return;
  }

  // ðŸ› FIX: Dynamically maps the global jsPDF regardless of ES6 module restrictions
  const jsPDF = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;

  if (!jsPDF) {
    showMessage('jsPDF is not loaded. Please check your network or ad blocker.', 'error');
    return;
  }

  const doc = new jsPDF();
  
  if (typeof doc.autoTable !== 'function') {
    showMessage('jsPDF autoTable is not loaded correctly.', 'error');
    return;
  }

  const reportData = [];
  let totalEstimatedBudget = 0;

  currentAssets.forEach(asset => {
    const eol = getEOLDetails(asset);

    if (!eol.isClosedLifecycle && eol.daysRemaining <= 365) {
      totalEstimatedBudget += eol.metrics.cost;

      reportData.push([
        asset.name, 
        displayDepartment(asset.department),
        formatType(asset.type),
        `${eol.metrics.years} years`,
        `${Math.round((eol.failureRisk || 0) * 100)}%`,
        eol.expiryDate.toLocaleDateString(),
        eol.daysRemaining < 0 ? 'âš ï¸ EXPIRED' : `${Math.ceil(eol.daysRemaining / 30)} Months`,
        `$${eol.metrics.cost.toLocaleString()}`
      ]);
    }
  });

  if (reportData.length === 0) {
    showMessage('Great news: no assets are reaching End-of-Life within the next 12 months.', 'success');
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
    head: [['Asset Name', 'Department', 'Type', 'AI Lifespan', 'Failure Risk', 'Est. Expiry Date', 'Time Remaining', 'Est. Replacement Cost']],
    body: reportData,
    startY: 45,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [220, 53, 69] },
    alternateRowStyles: { fillColor: [250, 240, 240] }
  });

  doc.save('OpsMind_Predictive_EOL_Budget.pdf');
  showMessage('Predictive EOL budget report exported successfully.', 'success');
};

// --- UI Helper Functions ---
function getIconForType(type) {
  const key = canonicalType(type);
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
  return icons[key] || 'bi-box-seam';
}

function formatType(type) {
  if (!type) return 'Unknown';
  const key = canonicalType(type);
  const typeObj = ASSET_TYPES.find(t => normalizeValue(t.value) === normalizeValue(key));
  if (typeObj) return typeObj.label;
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getStatusBadgeClass(status) {
  const key = String(status || '').toUpperCase();
  const map = {
    ACTIVE: 'bg-success',
    AVAILABLE: 'bg-success',
    ASSIGNED: 'bg-primary',
    REPAIR: 'bg-warning text-dark',
    MAINTENANCE: 'bg-warning text-dark',
    RETIRED: 'bg-danger',
    LOST: 'bg-secondary'
  };
  return map[key] || 'bg-light text-dark';
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Ensure functions are exposed to the window object for HTML inline handlers
window.resetFilters = resetFilters;
window.syncFilters = syncFilters;
window.filterGroupTable = filterGroupTable;
window.handleSearchKeyPress = handleSearchKeyPress;
window.filterDetailsTable = filterDetailsTable;

