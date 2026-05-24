import UI from '/assets/js/ui.js';
import AuthService from '/services/authService.js';

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
const eolAssessmentCache = new Map();
const aiJobStatusCache = new Map();
const PAGELOAD_AI_CONCURRENCY = 4;
let loadAssetsInFlightPromise = null;
let specPreviewRequestNonce = 0;
let specPreviewInFlight = false;
let specPreviewIsWriting = false;
let specPreviewUserIntervened = false;
let specPreviewActiveMode = 'idle';
let lastSpecPreviewMeta = {
  sourceType: '',
  evidenceStatus: '',
  confidence: 0,
  requiresReview: true,
};
let specVerificationSnapshot = {
  pendingCount: 0,
  metrics: null
};
let activeDetailsGroupName = null;
let bulkSpecReviewContext = null;
let bulkSpecActionInFlight = false;
let spareStockItemsCache = [];
let spareStockLowOnly = false;
const CMDB_MODAL_ID = 'inventoryCmdbModal';
let cmdbState = {
  assetId: null,
  activeTab: 'components',
};
let importPreviewCache = null;

const INVENTORY_ALLOWED_TECHNICIAN_LEVELS = new Set(['JUNIOR', 'SENIOR', 'SUPERVISOR']);

function resolveInventoryAccess() {
  const context = AuthService.resolveUserDashboardContext(AuthService.getCurrentUser());
  const technicianLevel = String(context.technicianLevel || '').toUpperCase();
  const isAdmin = context.roleCategory === 'ADMIN' || technicianLevel === 'ADMIN';
  const isSenior = technicianLevel === 'SENIOR';
  const canAccess = isAdmin || INVENTORY_ALLOWED_TECHNICIAN_LEVELS.has(technicianLevel);

  return {
    context,
    technicianLevel,
    canAccess,
    canCreateAsset: isAdmin,
    canDeleteAsset: isAdmin,
    canTransferAsset: isAdmin || isSenior,
    canEditSpecs: isAdmin || isSenior,
  };
}

const INVENTORY_ACCESS = resolveInventoryAccess();

function getInventoryFallbackPath() {
  return INVENTORY_ACCESS.context?.dashboardPath || '/pages/dashboard.html';
}

function ensureInventoryAccess() {
  if (!AuthService.isAuthenticated() || !INVENTORY_ACCESS.canAccess) {
    sessionStorage.setItem(
      'opsmind_error',
      'Access denied: Inventory is available only to Admin and Technician levels (Junior/Senior/Supervisor).'
    );
    window.location.href = getInventoryFallbackPath();
    return false;
  }
  return true;
}

function getAuthHeaders(extraHeaders = {}) {
  return {
    ...AuthService.getAuthHeaders(),
    ...extraHeaders,
  };
}

async function inventoryRequest(path, options = {}) {
  const requestOptions = { ...options };
  const headers = getAuthHeaders(requestOptions.headers || {});
  requestOptions.headers = headers;

  const response = await fetch(`${API_URL}${path}`, requestOptions);

  if (response.status === 401) {
    AuthService.clearAuth();
    window.location.href = '/index.html';
    throw new Error('Session expired. Please sign in again.');
  }

  if (response.status === 403) {
    throw new Error('You do not have permission to perform this inventory action.');
  }

  return response;
}

function applyInventoryRoleUI() {
  const createButton = document.querySelector('.inventory-create-btn');
  if (createButton) {
    createButton.style.display = INVENTORY_ACCESS.canCreateAsset ? '' : 'none';
  }
}

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

function normalizeLifecycleStatus(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function displayLifecycleStatus(value) {
  const normalized = normalizeLifecycleStatus(value);
  const labels = {
    in_stock: 'In Stock',
    assigned: 'Assigned',
    in_use: 'In Use',
    under_maintenance: 'Under Maintenance',
    pending_repair: 'Pending Repair',
    in_transit: 'In Transit',
    reserved: 'Reserved',
    retired: 'Retired',
    disposed: 'Disposed',
    lost_stolen: 'Lost/Stolen',
    eol_expired: 'EOL / Expired'
  };
  return labels[normalized] || (normalized ? normalized.replace(/_/g, ' ') : 'In Stock');
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
  offline: 0,
  not_monitored: 0,
  insufficient_data: 0,
  unknown: 0
};

const OPERATIONAL_STATE_LABELS = {
  online_in_use: 'Online - In use',
  online_idle: 'Online but idle',
  offline: 'Offline',
  not_monitored: 'Not monitored',
  insufficient_data: 'Monitoring enabled · Waiting for signal',
  unknown: 'Unknown'
};

const SPEC_PREVIEW_TEMPLATES = {
  laptop: { OS: 'Unknown - verify exact installed OS', 'Processor/Chip': 'Unknown - verify exact configuration', Memory: 'Unknown - verify exact configuration', Storage: 'Unknown - verify exact configuration', Display: 'Unknown - verify exact model/year', 'Serial Number': 'Pending', Condition: 'Pending inspection' },
  desktop: { OS: 'Unknown - verify exact installed OS', Processor: 'Unknown - verify exact configuration', Memory: 'Unknown - verify exact configuration', Storage: 'Unknown - verify exact configuration', GPU: 'Unknown - verify exact configuration', 'Serial Number': 'Pending', Condition: 'Pending inspection' },
  server: { OS: 'Unknown - verify exact installed OS', CPU: 'Unknown - verify exact configuration', Memory: 'Unknown - verify exact configuration', Storage: 'Unknown - verify exact configuration', RAID: 'Unknown - verify exact configuration', 'Serial Number': 'Pending', Condition: 'Pending inspection' },
  tablet: { OS: 'Unknown - verify exact installed OS', 'Processor/Chip': 'Unknown - verify exact configuration', Memory: 'Unknown - verify exact configuration', Storage: 'Unknown - verify exact configuration', Display: 'Unknown - verify exact model/year', 'Serial Number': 'Pending', Condition: 'Pending inspection' },
  printer: { 'Print Technology': 'Unknown - verify exact model', Duplex: 'Unknown - verify exact model', Connectivity: 'Unknown - verify exact model', 'Page Count': 'Unknown - read device counter', 'Toner/Ink Type': 'Unknown - verify exact model', 'Serial Number': 'Pending', Condition: 'Pending inspection' },
  scanner: { 'Scan Technology': 'Unknown - verify exact model', Resolution: 'Unknown - verify exact model', Connectivity: 'Unknown - verify exact model', 'Scan Count': 'Unknown - verify counter', 'Serial Number': 'Pending', Condition: 'Pending inspection' },
  router: { Ports: 'Unknown - verify exact model', Throughput: 'Unknown - verify exact model', 'Firmware Version': 'Unknown - verify exact version', 'PoE Support': 'Unknown - verify exact model', 'Serial Number': 'Pending', Condition: 'Pending inspection' },
  switch: { Ports: 'Unknown - verify exact model', Throughput: 'Unknown - verify exact model', 'Firmware Version': 'Unknown - verify exact version', 'PoE Support': 'Unknown - verify exact model', 'Serial Number': 'Pending', Condition: 'Pending inspection' },
  access_point: { 'WiFi Standard': 'Unknown - verify exact model', Band: 'Unknown - verify exact model', Throughput: 'Unknown - verify exact model', 'Firmware Version': 'Unknown - verify exact version', 'Serial Number': 'Pending', Condition: 'Pending inspection' },
  firewall: { Throughput: 'Unknown - verify exact model', 'VPN Support': 'Unknown - verify exact model', 'Firmware Version': 'Unknown - verify exact version', Ports: 'Unknown - verify exact model', 'Serial Number': 'Pending', Condition: 'Pending inspection' },
  projector: { Resolution: 'Unknown - verify exact model', Brightness: 'Unknown - verify exact model', 'Lamp Hours': 'Unknown - verify exact count', 'Input Ports': 'Unknown - verify exact ports', 'Serial Number': 'Pending', Condition: 'Pending inspection' },
  smartboard: { 'Display Size': 'Unknown - verify exact model', Resolution: 'Unknown - verify exact model', 'Touch Points': 'Unknown - verify exact model', 'Input Ports': 'Unknown - verify exact model', 'Serial Number': 'Pending', Condition: 'Pending inspection' },
  camera: { Resolution: 'Unknown - verify exact model', 'Lens Type': 'Unknown - verify exact model', Connectivity: 'Unknown - verify exact model', 'Storage Media': 'Unknown - verify exact model', 'Serial Number': 'Pending', Condition: 'Pending inspection' },
  microphone: { Type: 'Unknown - verify exact model', 'Frequency Response': 'Unknown - verify exact model', Connectivity: 'Unknown - verify exact model', 'Serial Number': 'Pending', Condition: 'Pending inspection' },
  speaker: { 'Output Power': 'Unknown - verify exact model', Connectivity: 'Unknown - verify exact model', 'Frequency Range': 'Unknown - verify exact model', 'Serial Number': 'Pending', Condition: 'Pending inspection' },
  desk: { Material: 'Unknown - verify exact material', 'Frame Type': 'Unknown - verify exact frame type', Dimensions: 'Unknown - verify exact dimensions', Condition: 'Pending inspection', 'Inspection Date': 'Pending' },
  chair: { Material: 'Unknown - verify exact material', 'Frame Type': 'Unknown - verify exact frame type', 'Seat Condition': 'Pending inspection', 'Back Support': 'Unknown - verify exact support type', Dimensions: 'Unknown - verify exact dimensions', 'Weight Capacity': 'Unknown - verify exact capacity', Condition: 'Pending inspection' },
  filing_cabinet: { Material: 'Unknown - verify exact material', 'Drawer Count': 'Unknown - verify exact count', 'Lock Type': 'Unknown - verify exact type', Dimensions: 'Unknown - verify exact dimensions', Condition: 'Pending inspection' },
  whiteboard: { 'Surface Type': 'Unknown - verify exact type', Dimensions: 'Unknown - verify exact dimensions', 'Mount Type': 'Unknown - verify exact type', Condition: 'Pending inspection' },
  microscope: { Magnification: 'Unknown - verify exact model', 'Lighting Type': 'Unknown - verify exact model', 'Calibration Status': 'Unknown - verify latest calibration', 'Serial Number': 'Pending', Condition: 'Pending inspection' },
  centrifuge: { 'Max RPM': 'Unknown - verify exact model', Capacity: 'Unknown - verify exact model', 'Rotor Type': 'Unknown - verify exact model', 'Calibration Status': 'Unknown - verify latest calibration', 'Serial Number': 'Pending', Condition: 'Pending inspection' },
  oscilloscope: { Bandwidth: 'Unknown - verify exact model', Channels: 'Unknown - verify exact model', 'Sample Rate': 'Unknown - verify exact model', 'Calibration Status': 'Unknown - verify latest calibration', 'Serial Number': 'Pending', Condition: 'Pending inspection' },
  '3d_printer': { 'Build Volume': 'Unknown - verify exact model', 'Nozzle Size': 'Unknown - verify exact model', 'Supported Materials': 'Unknown - verify exact model', 'Print Hours': 'Unknown - verify current count', 'Serial Number': 'Pending', Condition: 'Pending inspection' },
  vehicle: { Odometer: 'Unknown - verify current reading', 'Engine Hours': 'Unknown - verify current reading', 'Fuel Type': 'Unknown - verify exact type', 'Service Interval': 'Unknown - verify manufacturer guideline', 'VIN/Serial Number': 'Pending', Condition: 'Pending inspection' },
  generator: { Capacity: 'Unknown - verify exact model', 'Runtime Hours': 'Unknown - verify current reading', 'Fuel Type': 'Unknown - verify exact type', 'Service Interval': 'Unknown - verify manufacturer guideline', 'Serial Number': 'Pending', Condition: 'Pending inspection' },
  hvac: { Capacity: 'Unknown - verify exact model', 'Runtime Hours': 'Unknown - verify current reading', 'Refrigerant Type': 'Unknown - verify exact type', 'Service Interval': 'Unknown - verify manufacturer guideline', 'Serial Number': 'Pending', Condition: 'Pending inspection' },
  maintenance_tool: { 'Tool Type': 'Unknown - verify exact type', 'Power Source': 'Unknown - verify exact source', 'Runtime Hours': 'Unknown - verify current reading', 'Inspection Date': 'Pending', 'Serial Number': 'Pending', Condition: 'Pending inspection' },
  default: { Condition: 'Unknown', Notes: 'Add model-specific technical details' }
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

function parseMultilineValues(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return [];
  return raw
    .split(/\r?\n|,/)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function formatSpecsObject(specs = {}) {
  const entries = Object.entries(specs || {})
    .filter(([key, value]) => String(key || '').trim() && String(value ?? '').trim())
    .map(([key, value]) => `${key}: ${value}`);
  return entries.length ? entries.join('\n') : '';
}

function getSpecTemplateForType(type) {
  const key = canonicalType(type);
  return SPEC_PREVIEW_TEMPLATES[key] || SPEC_PREVIEW_TEMPLATES.default;
}

function isSpecsPlaceholderLike(text = '', placeholder = '') {
  const compact = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!compact) return true;
  const placeholderCompact = String(placeholder || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (placeholderCompact && compact === placeholderCompact) return true;
  return compact.includes('unknown - verify');
}

function setSpecPreviewStatus(message = '', tone = 'muted') {
  const statusEl = document.getElementById('assetSpecsAiStatus');
  if (!statusEl) return;
  const toneClass = tone === 'danger'
    ? 'text-danger'
    : tone === 'warning'
      ? 'text-warning'
      : tone === 'success'
        ? 'text-success'
        : 'text-muted';
  statusEl.className = `form-text small ${toneClass}`;
  statusEl.textContent = message || 'Approve/Edit before Create.';
}

async function runWithConcurrency(items, limit, worker) {
  if (!Array.isArray(items) || items.length === 0) return;
  const safeLimit = Math.max(1, Number(limit) || 1);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(safeLimit, items.length) }, async () => {
    while (cursor < items.length) {
      const itemIndex = cursor++;
      await worker(items[itemIndex], itemIndex);
    }
  });

  await Promise.all(runners);
}

function getAssetSpecs(asset) {
  return (asset?.specifications && typeof asset.specifications === 'object') ? asset.specifications : {};
}

function getDisplaySerial(asset) {
  const specs = getAssetSpecs(asset);
  return String(
    asset?.serialNumber
    || asset?.serial_number
    || specs['Serial Number']
    || specs.serialNumber
    || specs.serial_number
    || specs['VIN/Serial Number']
    || ''
  ).trim();
}

function getDisplayAssetTag(asset) {
  return String(asset?.assetTag || asset?.asset_tag || '').trim();
}

function getAssetQuantity(asset) {
  const quantity = Number(asset?.quantity);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function getAssetsTotalQuantity(assets = []) {
  return assets.reduce((total, asset) => total + getAssetQuantity(asset), 0);
}

function getAssetUnitRows(assets = []) {
  return assets.flatMap(asset => {
    const quantity = getAssetQuantity(asset);
    return Array.from({ length: quantity }, (_, index) => ({
      asset,
      unitIndex: index + 1,
      unitCount: quantity,
      unitLabel: quantity > 1 ? `${asset.customId} #${index + 1}` : asset.customId,
      isVirtualUnit: quantity > 1
    }));
  });
}

function updateSerialInputMode() {
  const quantity = Number(document.getElementById('assetQuantity')?.value || 1);
  const singleSerialInput = document.getElementById('assetSerialNumber');
  const bulkSerialInput = document.getElementById('assetSerialNumbers');
  if (!singleSerialInput || !bulkSerialInput) return;

  if (Number.isFinite(quantity) && quantity > 1) {
    singleSerialInput.disabled = true;
    singleSerialInput.placeholder = 'Disabled for bulk create. Use multi-serial field below.';
    bulkSerialInput.disabled = false;
  } else {
    singleSerialInput.disabled = false;
    singleSerialInput.placeholder = 'Manufacturer serial number';
    bulkSerialInput.disabled = true;
    bulkSerialInput.value = '';
  }
}

function toBoolean(value) {
  return value === true || value === 'true' || value === 'yes' || value === '1';
}

function normalizeOperationalState(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/-/g, '_');
  if (OPERATIONAL_STATE_RATES[normalized] !== undefined) return normalized;
  return 'unknown';
}

function getOperationalStateLabel(state) {
  return OPERATIONAL_STATE_LABELS[state] || OPERATIONAL_STATE_LABELS.unknown;
}

function getTelemetryStatusMeta(specs = {}) {
  const trackWorkingHours = toBoolean(specs.trackWorkingHours);
  const hasTelemetryTimestamp = Boolean(specs.lastTelemetryAt || specs.operationalStateUpdatedAt);
  const hasTelemetryHours = Number(specs.workingHours || 0) > 0 && String(specs.workingHoursSource || '').toLowerCase() === 'telemetry';
  const hasTelemetry = hasTelemetryTimestamp || hasTelemetryHours;
  const requestedState = normalizeOperationalState(specs.operationalState);

  if (!trackWorkingHours && !hasTelemetry) {
    return {
      state: 'not_monitored',
      confidence: 'low',
      reason: 'Telemetry not connected',
      hasTelemetry: false
    };
  }

  if (trackWorkingHours && !hasTelemetry) {
    return {
      state: 'insufficient_data',
      confidence: 'low',
      reason: 'Telemetry monitoring enabled, but no live signal has been received yet.',
      hasTelemetry: false
    };
  }

  if (['online_in_use', 'online_idle', 'offline'].includes(requestedState)) {
    return {
      state: requestedState,
      confidence: 'high',
      reason: 'Derived from telemetry heartbeat/activity',
      hasTelemetry: true
    };
  }

  if (requestedState === 'not_monitored' || requestedState === 'insufficient_data') {
    return {
      state: requestedState,
      confidence: 'low',
      reason: 'Telemetry incomplete for reliable classification',
      hasTelemetry
    };
  }

  return {
    state: 'unknown',
    confidence: 'low',
    reason: hasTelemetry ? 'Telemetry signals do not map to a supported live status' : 'Telemetry not connected',
    hasTelemetry
  };
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
  return getTelemetryStatusMeta(specs).state;
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
  const telemetry = getTelemetryStatusMeta(specs);
  const workingHours = Math.max(0, getEffectiveWorkingHours(specs));
  const trackWorkingHours = toBoolean(specs.trackWorkingHours) && TRACKABLE_ASSET_TYPES.has(canonicalType(asset?.type));
  const operationalState = telemetry.state;

  return {
    specs,
    brand,
    quality,
    version,
    workingHours,
    trackWorkingHours,
    operationalState,
    telemetryStatus: telemetry.state,
    telemetryConfidence: telemetry.confidence,
    telemetryReason: telemetry.reason,
    hasTelemetry: telemetry.hasTelemetry
  };
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

async function loadAssetAiJobStatuses() {
  aiJobStatusCache.clear();
  if (!currentAssets.length) return;

  const assetIds = currentAssets
    .map((asset) => String(asset?.customId || '').trim())
    .filter(Boolean);
  if (!assetIds.length) return;

  try {
    const response = await inventoryRequest(`/assets/ai-jobs/status?assetIds=${encodeURIComponent(assetIds.join(','))}`);
    if (!response.ok) throw new Error('AI job status endpoint unavailable');
    const payload = await response.json();
    const summaries = (payload?.summaries && typeof payload.summaries === 'object')
      ? payload.summaries
      : {};

    Object.entries(summaries).forEach(([assetId, summary]) => {
      aiJobStatusCache.set(assetId, summary);
    });
  } catch (error) {
    console.warn('Failed to load background AI job statuses:', error?.message || error);
  }
}

async function loadAssetLifespanPredictions() {
  lifespanPredictionCache.clear();
  if (!currentAssets.length) return;

  await runWithConcurrency(currentAssets, PAGELOAD_AI_CONCURRENCY, async (asset) => {
    const jobSummary = aiJobStatusCache.get(asset.customId);
    if (jobSummary?.hasActiveJobs) {
      const fallbackMetrics = EOL_METRICS[canonicalType(asset.type)] || EOL_METRICS.default || { years: 5, cost: 500 };
      const fallbackPrediction = predictAssetLifespan(asset, fallbackMetrics);
      lifespanPredictionCache.set(asset.customId, {
        ...fallbackPrediction,
        source: 'background_processing'
      });
      return;
    }
    const baseMetrics = EOL_METRICS[canonicalType(asset.type)] || EOL_METRICS.default || { years: 5, cost: 500 };
    try {
      const response = await inventoryRequest(`/assets/${encodeURIComponent(asset.customId)}/lifespan-prediction?persist=false`, {
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
  });
}

async function loadAssetEolAssessments() {
  eolAssessmentCache.clear();
  if (!currentAssets.length) return;

  await runWithConcurrency(currentAssets, PAGELOAD_AI_CONCURRENCY, async (asset) => {
    const jobSummary = aiJobStatusCache.get(asset.customId);
    if (jobSummary?.hasActiveJobs) return;
    try {
      const response = await inventoryRequest(`/assets/${encodeURIComponent(asset.customId)}/eol-assessment`);
      if (!response.ok) throw new Error('EOL assessment unavailable');
      const payload = await response.json();
      eolAssessmentCache.set(asset.customId, payload);
    } catch (error) {
      // Keep graceful fallback to client-side estimation when backend assessment fails.
      console.warn(`EOL assessment fetch failed for ${asset.customId}:`, error?.message || error);
    }
  });
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
  if (!ensureInventoryAccess()) return;
  applyInventoryRoleUI();
  initializePage();

  const form = document.getElementById('addAssetForm');
  if (form) form.addEventListener('submit', handleAddAsset);

  const transferForm = document.getElementById('transferForm');
  if (transferForm) {
    transferForm.addEventListener('submit', (event) => {
      event.preventDefault();
      window.submitTransfer();
    });
  }

  const exportBtn = document.getElementById('exportPdfBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportAssetsToDetailedPDF);
  const specRefreshBtn = document.getElementById('specVerificationRefreshBtn');
  if (specRefreshBtn) specRefreshBtn.addEventListener('click', refreshSpecVerificationSnapshot);

  const specApproveBtn = document.getElementById('specApproveBtn');
  const specCorrectBtn = document.getElementById('specCorrectBtn');
  const specRejectBtn = document.getElementById('specRejectBtn');
  const bulkSpecApproveBtn = document.getElementById('bulkSpecApproveBtn');
  const bulkSpecCorrectBtn = document.getElementById('bulkSpecCorrectBtn');
  const bulkSpecRejectBtn = document.getElementById('bulkSpecRejectBtn');
  if (specApproveBtn) specApproveBtn.addEventListener('click', () => submitSpecVerificationAction('approve'));
  if (specCorrectBtn) specCorrectBtn.addEventListener('click', () => submitSpecVerificationAction('correct'));
  if (specRejectBtn) specRejectBtn.addEventListener('click', () => submitSpecVerificationAction('reject'));
  if (bulkSpecApproveBtn) bulkSpecApproveBtn.addEventListener('click', () => submitBulkSpecVerificationAction('approve'));
  if (bulkSpecCorrectBtn) bulkSpecCorrectBtn.addEventListener('click', () => submitBulkSpecVerificationAction('correct'));
  if (bulkSpecRejectBtn) bulkSpecRejectBtn.addEventListener('click', () => submitBulkSpecVerificationAction('reject'));

  const locSelect = document.getElementById('assetLocation');
  const deptSelect = document.getElementById('assetDepartment');
  const assetTypeSelect = document.getElementById('assetType');
  const brandInput = document.getElementById('assetBrand');
  const versionInput = document.getElementById('assetVersion');
  const nameInput = document.getElementById('assetName');
  const specsInput = document.getElementById('assetSpecs');
  const quantityInput = document.getElementById('assetQuantity');
  const generateSpecsBtn = document.getElementById('assetGenerateSpecsBtn');
  const searchTrustedSourcesBtn = document.getElementById('assetSearchTrustedSourcesBtn');
  if (locSelect) locSelect.value = 'Central Warehouse';
  if (deptSelect) deptSelect.value = 'Unassigned';
  if (assetTypeSelect) assetTypeSelect.addEventListener('change', () => {
    invalidateSpecPreviewRequest();
    updateWorkingHoursAvailability();
    updateSerialInputMode();
    applyAssetTypeSpecTemplate();
    updateInferredQualityPreview();
  });
  [brandInput, versionInput, nameInput, specsInput].forEach(input => {
    if (input) input.addEventListener('input', updateInferredQualityPreview);
  });
  [brandInput, versionInput, nameInput].forEach(input => {
    if (input) input.addEventListener('input', invalidateSpecPreviewRequest);
  });
  if (specsInput) {
    specsInput.addEventListener('input', () => {
      if (specPreviewInFlight || specPreviewIsWriting) {
        specPreviewUserIntervened = true;
        invalidateSpecPreviewRequest();
      }
    });
  }
  if (generateSpecsBtn) generateSpecsBtn.addEventListener('click', handleGenerateSpecsPreview);
  if (searchTrustedSourcesBtn) searchTrustedSourcesBtn.addEventListener('click', handleSearchTrustedSourcesPreview);
  if (quantityInput) quantityInput.addEventListener('input', updateSerialInputMode);
  updateSerialInputMode();

  const buildingFilter = document.getElementById('filterBuilding');
  const deptFilter = document.getElementById('filterDept');
  const typeFilter = document.getElementById('filterType');
  const lifecycleFilter = document.getElementById('filterLifecycle');

  if (buildingFilter) buildingFilter.addEventListener('change', syncFilters);
  if (deptFilter) deptFilter.addEventListener('change', syncFilters);
  if (typeFilter) typeFilter.addEventListener('change', syncFilters);
  if (lifecycleFilter) lifecycleFilter.addEventListener('change', syncFilters);
  const openSpareStockBtn = document.getElementById('openSpareStockBtn');
  const spareStockRefreshBtn = document.getElementById('spareStockRefreshBtn');
  const spareStockLowOnlyBtn = document.getElementById('spareStockLowOnlyBtn');
  const spareStockAddBtn = document.getElementById('spareStockAddBtn');
  const spareStockSearchInput = document.getElementById('spareStockSearchInput');
  if (openSpareStockBtn) openSpareStockBtn.addEventListener('click', () => window.openSpareStockModal());
  if (spareStockRefreshBtn) spareStockRefreshBtn.addEventListener('click', () => window.loadSpareStock());
  if (spareStockLowOnlyBtn) spareStockLowOnlyBtn.addEventListener('click', () => {
    spareStockLowOnly = !spareStockLowOnly;
    spareStockLowOnlyBtn.classList.toggle('btn-warning', spareStockLowOnly);
    spareStockLowOnlyBtn.classList.toggle('btn-outline-warning', !spareStockLowOnly);
    window.renderSpareStockTable();
  });
  if (spareStockAddBtn) spareStockAddBtn.addEventListener('click', () => window.addSpareStockItem());
  if (spareStockSearchInput) spareStockSearchInput.addEventListener('input', () => window.renderSpareStockTable());
  const openImportAssetsBtn = document.getElementById('openImportAssetsBtn');
  const previewImportBtn = document.getElementById('previewImportBtn');
  const commitImportBtn = document.getElementById('commitImportBtn');
  const downloadImportTemplateBtn = document.getElementById('downloadImportTemplateBtn');
  if (openImportAssetsBtn) openImportAssetsBtn.addEventListener('click', () => window.openImportAssetsModal());
  if (previewImportBtn) previewImportBtn.addEventListener('click', () => window.previewImportAssets());
  if (commitImportBtn) commitImportBtn.addEventListener('click', () => window.commitImportAssets());
  if (downloadImportTemplateBtn) downloadImportTemplateBtn.addEventListener('click', () => window.copyImportTemplateCsv());

  updateWorkingHoursAvailability();
  applyAssetTypeSpecTemplate();
  updateSpecPreviewButtonState();
  setSpecPreviewStatus('Approve/Edit before Create.', 'muted');
  updateInferredQualityPreview();

  const detailsModalElement = document.getElementById('detailsModal');
  if (detailsModalElement) {
    detailsModalElement.addEventListener('hidden.bs.modal', () => {
      activeDetailsGroupName = null;
      bulkSpecReviewContext = null;
    });
  }
});

async function initializePage() {
  await loadConfig(); // 1. Fetch config from backend first!
  await loadAssets(); // 2. Then load assets and render
}

// ðŸš€ Fetches the single source of truth from your new backend route
async function loadConfig() {
  try {
    const response = await inventoryRequest('/config');
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
  if (loadAssetsInFlightPromise) return loadAssetsInFlightPromise;

  loadAssetsInFlightPromise = (async () => {
    try {
      const response = await inventoryRequest('/assets');
      if (!response.ok) throw new Error('Failed to fetch assets');

      const assets = await response.json();
      console.debug('[AssetCreateDebug] /api/assets response length:', Array.isArray(assets) ? assets.length : 0);
      currentAssets = assets;
      await loadAssetAiJobStatuses();
      await loadAssetLifespanPredictions();
      await loadAssetEolAssessments();

      populateFilters();
      renderTable();
      updateDeleteAllAssetsButton();
      checkGlobalEOLAlerts();
      await refreshSpecVerificationSnapshot();
    } catch (error) {
      console.error('Error:', error);
      const tableBody = document.getElementById('inventoryTableBody');
      if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">Error loading assets. Check port 5000.</td></tr>`;
      }
    }
  })();

  try {
    await loadAssetsInFlightPromise;
  } finally {
    loadAssetsInFlightPromise = null;
  }
}

// ðŸ¤– AI Prediction Math Helper
function getEOLDetails(asset) {
  const now = new Date();
  const lifecycle = getLifecycleSnapshot(asset);
  const startDate = lifecycle.commissionedAt || lifecycle.purchaseDate || toValidDate(asset.createdAt) || now;
  const outcomeDate = lifecycle.replacementDate || lifecycle.retiredAt || lifecycle.failureDate;
  const backendAssessment = eolAssessmentCache.get(asset.customId) || null;
  const jobSummary = aiJobStatusCache.get(asset.customId) || null;
  const backgroundProcessing = Boolean(jobSummary?.hasActiveJobs);

  const defaultMetrics = { years: 5, cost: 500 };
  const baseMetrics = EOL_METRICS[canonicalType(asset.type)] || EOL_METRICS.default || defaultMetrics;
  const prediction = lifespanPredictionCache.get(asset.customId) || predictAssetLifespan(asset, baseMetrics);
  const predictedYears = lifecycle.actualLifespanYears
    || Number(backendAssessment?.predictedLifespanYears || 0)
    || prediction.years
    || baseMetrics.years
    || defaultMetrics.years;
  const metrics = {
    ...baseMetrics,
    years: Math.max(0.5, Number(predictedYears) || defaultMetrics.years),
    cost: lifecycle.replacementCost || baseMetrics.cost,
    prediction
  };

  const backendEolDate = toValidDate(backendAssessment?.predictedEolDate);
  const expiryDate = outcomeDate
    ? new Date(outcomeDate)
    : (backendEolDate ? new Date(backendEolDate) : new Date(startDate));
  if (!outcomeDate && !backendEolDate) expiryDate.setDate(expiryDate.getDate() + Math.round(metrics.years * 365));

  const msRemaining = expiryDate - now;
  const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
  const closedOutcome = ['retired', 'replaced', 'failed'].includes(lifecycle.finalOutcome) || String(asset.status || '').toLowerCase() === 'retired';
  const failureRisk = Number(prediction.failureRisk || 0);

  let remainingText = '';
  let statusClass = 'bg-success';
  let confidence = Number(backendAssessment?.confidence ?? NaN);
  let reason = String(backendAssessment?.reason || '');
  let eolStatus = String(backendAssessment?.status || '').toLowerCase();

  if (!backendAssessment && backgroundProcessing) {
    remainingText = 'Processing';
    statusClass = 'bg-secondary';
    eolStatus = 'processing';
    reason = 'AI/EOL background processing is in progress.';
  } else if (backendAssessment) {
    const monthsRemaining = Number(backendAssessment.monthsRemaining);
    if (closedOutcome && outcomeDate) {
      remainingText = `${capitalize(lifecycle.finalOutcome || 'retired')} on ${outcomeDate.toLocaleDateString()}`;
      statusClass = 'bg-secondary';
    } else if (eolStatus === 'overdue') {
      const overdueMonths = Number.isFinite(monthsRemaining) ? Math.abs(monthsRemaining).toFixed(1) : '0';
      remainingText = `Overdue by ${overdueMonths} month(s)`;
      statusClass = 'bg-danger';
    } else if (eolStatus === 'due_soon') {
      const soonMonths = Number.isFinite(monthsRemaining) ? monthsRemaining.toFixed(1) : '?';
      remainingText = `⚠️ ${soonMonths} month(s) left`;
      statusClass = 'bg-warning text-dark';
    } else if (eolStatus === 'watch') {
      const watchMonths = Number.isFinite(monthsRemaining) ? monthsRemaining.toFixed(1) : '?';
      remainingText = `Watch window: ${watchMonths} month(s) left`;
      statusClass = 'bg-info text-dark';
    } else if (eolStatus === 'healthy') {
      const healthyMonths = Number.isFinite(monthsRemaining) ? monthsRemaining.toFixed(1) : '?';
      remainingText = `Healthy: ${healthyMonths} month(s) left`;
      statusClass = 'bg-success';
    } else if (eolStatus === 'insufficient_data') {
      remainingText = 'Insufficient data';
      statusClass = 'bg-secondary';
    } else {
      remainingText = 'Unknown (low confidence)';
      statusClass = 'bg-secondary';
    }
  } else {
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
  }

  const lowConfidence = Number.isFinite(confidence) ? confidence < 0.6 : true;
  const procurementRecommended = Boolean(backendAssessment?.procurementRecommended) && !lowConfidence;
  const shortAction = backgroundProcessing
    ? 'Waiting for AI pipeline'
    : procurementRecommended
      ? 'Plan procurement'
      : lowConfidence
        ? 'Manual review recommended'
        : 'Monitoring';
  const whyDetails = {
    reason: reason || 'No detailed explanation available.',
    predictionSource: String(backendAssessment?.predictionSource || 'frontend_estimate'),
    telemetryStatus: String(backendAssessment?.telemetryStatus || getAssetProfile(asset).telemetryStatus || 'unknown'),
    specEvidenceStatus: String(backendAssessment?.specEvidenceStatus || getAssetSpecs(asset).aiSpecEvidenceStatus || 'insufficient_source_evidence'),
    modelVersion: String(getAssetSpecs(asset).lifespanModelVersion || ''),
    failureRisk: Number(failureRisk || 0),
    aiLifespanYears: Number(metrics.years || 0),
  };

  return {
    remainingText,
    statusClass,
    daysRemaining,
    metrics,
    expiryDate,
    failureRisk,
    isClosedLifecycle: closedOutcome,
    confidence: Number.isFinite(confidence) ? confidence : null,
    reason: reason || '',
    eolStatus: eolStatus || 'unknown',
    procurementRecommended,
    predictionSource: String(backendAssessment?.predictionSource || 'frontend_estimate'),
    evidenceLevel: String(backendAssessment?.evidenceLevel || 'low'),
    lowConfidence,
    backgroundProcessing,
    shortAction,
    whyDetails,
  };
}

window.showEolWhy = async function showEolWhy(assetId) {
  const asset = currentAssets.find((entry) => String(entry.customId) === String(assetId));
  if (!asset) {
    showMessage('Asset not found for EOL details.', 'warning');
    return;
  }

  const eol = getEOLDetails(asset);
  const details = eol.whyDetails || {};
  const reason = String(details.reason || 'No detailed explanation available.');
  let message = [
    `Status: ${eol.remainingText}`,
    `Confidence: ${eol.confidence !== null ? `${Math.round(eol.confidence * 100)}%` : 'N/A'}`,
    `AI Lifespan: ${Number.isFinite(Number(details.aiLifespanYears)) ? `${details.aiLifespanYears} years` : 'N/A'}`,
    `Failure Risk: ${Math.round((Number(details.failureRisk || 0) || 0) * 100)}%`,
    `Telemetry: ${String(details.telemetryStatus || 'unknown')}`,
    `Spec Evidence: ${String(details.specEvidenceStatus || 'insufficient_source_evidence')}`,
    details.modelVersion ? `Model Version: ${details.modelVersion}` : '',
    `Reason: ${reason}`,
  ].filter(Boolean).join(' | ');

  try {
    const response = await inventoryRequest(`/assets/${encodeURIComponent(assetId)}/eol-explanation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telemetryStatus: details.telemetryStatus || 'unknown',
        specEvidenceStatus: details.specEvidenceStatus || 'insufficient_source_evidence',
        confidence: eol.confidence,
        predictedLifespanYears: details.aiLifespanYears,
        procurementSuitable: eol.procurementRecommended,
      }),
    });
    if (response.ok) {
      const explanation = await response.json();
      const shortUser = String(explanation.shortUserExplanation || '').trim();
      const technical = String(explanation.technicalExplanation || '').trim();
      if (shortUser || technical) {
        message = [shortUser, technical].filter(Boolean).join(' | ');
      }
    }
  } catch (_error) {
    // Keep deterministic fallback message when helper is unavailable.
  }

  await showInventoryInsight({
    title: 'EOL Why',
    message,
    type: eol.lowConfidence ? 'warning' : 'info',
    confirmText: 'Close',
  });
};

function checkGlobalEOLAlerts() {
  const activeAssets = currentAssets.filter((asset) => !getEOLDetails(asset).isClosedLifecycle);
  const expiringCount = activeAssets.filter(a => {
    const eol = getEOLDetails(a);
    return !eol.lowConfidence && eol.daysRemaining >= 0 && eol.daysRemaining <= 180;
  }).length;

  const expiredCount = activeAssets.filter(a => {
    const eol = getEOLDetails(a);
    return !eol.lowConfidence && eol.daysRemaining < 0;
  }).length;
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

function getSpecVerificationStatus(asset) {
  const specs = getAssetSpecs(asset);
  const explicitStatus = String(
    specs.specVerificationStatus ||
    specs.spec_status ||
    specs?.specVerification?.status ||
    ''
  ).trim().toLowerCase();

  if (explicitStatus) return explicitStatus;

  const aiDetectedSpecs = (specs.aiDetectedSpecs && typeof specs.aiDetectedSpecs === 'object')
    ? specs.aiDetectedSpecs
    : {};
  const hasAIDetectedSpecs = Object.keys(aiDetectedSpecs).length > 0;
  if (!hasAIDetectedSpecs) return 'unchecked';

  const confidence = Number(specs.aiSpecConfidence);
  const lowConfidence = Number.isFinite(confidence) ? confidence < 0.85 : false;
  const lookupMode = String(specs.aiSpecLookupMode || '').trim().toLowerCase();
  const evidenceStatus = String(specs.aiSpecEvidenceStatus || '').trim().toLowerCase();
  const weakEvidence = evidenceStatus === 'insufficient_source_evidence' || evidenceStatus === 'llm_or_heuristic_only';
  const weakLookup = (
    lookupMode.includes('heuristic')
    || lookupMode.includes('fallback')
    || lookupMode.includes('low_confidence')
    || lookupMode.includes('llm')
    || lookupMode.includes('no_source')
  );

  if (lowConfidence || weakLookup || weakEvidence) return 'pending';
  return 'verified';
}

function getSpecVerificationBadge(status) {
  if (status === 'pending') return '<span class="badge bg-warning text-dark">Spec Review Pending</span>';
  if (status === 'corrected') return '<span class="badge bg-info text-dark">Spec Corrected</span>';
  if (status === 'verified') return '<span class="badge bg-success">Spec Verified</span>';
  if (status === 'rejected') return '<span class="badge bg-secondary">Spec Rejected</span>';
  return '<span class="badge bg-light text-dark border">Spec Unchecked</span>';
}

function shouldShowSpecReviewButton(status) {
  return status === 'pending' || status === 'unchecked';
}

function getPendingSpecReviewAssetsInGroup(groupAssets = []) {
  return groupAssets.filter((asset) => {
    const status = getSpecVerificationStatus(asset);
    return status === 'pending' || status === 'unchecked';
  });
}

function getAssetReviewSeedSpecs(asset) {
  const specs = getAssetSpecs(asset);
  if (specs.aiDetectedSpecs && typeof specs.aiDetectedSpecs === 'object' && Object.keys(specs.aiDetectedSpecs).length) {
    return specs.aiDetectedSpecs;
  }
  return extractUserFacingSpecs(asset);
}

function extractUserFacingSpecs(asset) {
  const specs = getAssetSpecs(asset);
  const hiddenKeys = new Set([
    'aidetectedspecs',
    'aispecfieldconfidence',
    'aispecconfidence',
    'aispecsource',
    'aispeclookupmode',
    'aispecsourceurls',
    'aispecruleversion',
    'aispecvariant',
    'aispecevidencestatus',
    'aispecevidencereason',
    'aispecdetectedat',
    'specverificationstatus',
    'specverificationupdatedat',
    'specverificationreviewedby',
    'specverificationreviewedat',
    'specverificationaction',
    'specverificationcorrections',
    'telemetrystatus',
    'telemetryconfidence',
    'telemetryreason',
    'trackworkinghours',
    'operationalstate',
    'operationalstateupdatedat',
    'workinghours',
    'workinghourssource',
  ]);
  const filtered = {};
  Object.entries(specs || {}).forEach(([key, value]) => {
    const normalized = normalizeValue(key);
    if (!key || hiddenKeys.has(normalized)) return;
    const safeValue = String(value ?? '').trim();
    if (!safeValue) return;
    filtered[key] = safeValue;
  });
  return filtered;
}

function getSpecsSignature(specs = {}) {
  const normalizedEntries = Object.entries(specs || {})
    .map(([key, value]) => [String(key || '').trim().toLowerCase(), String(value || '').trim()])
    .filter(([key, value]) => key && value)
    .sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify(normalizedEntries);
}

function buildBulkSpecReviewContext(groupName) {
  const groupAssets = currentAssets.filter((asset) => asset.name === groupName);
  const pendingAssets = getPendingSpecReviewAssetsInGroup(groupAssets);
  const pendingUnits = pendingAssets.reduce((sum, asset) => sum + getAssetQuantity(asset), 0);

  const specBuckets = new Map();
  pendingAssets.forEach((asset) => {
    const specs = getAssetReviewSeedSpecs(asset);
    const signature = getSpecsSignature(specs);
    if (!specBuckets.has(signature)) {
      specBuckets.set(signature, { specs, assets: [] });
    }
    specBuckets.get(signature).assets.push(asset);
  });

  let dominantBucket = null;
  specBuckets.forEach((bucket) => {
    if (!dominantBucket || bucket.assets.length > dominantBucket.assets.length) dominantBucket = bucket;
  });

  const groupType = groupAssets.length ? formatType(groupAssets[0].type) : 'Unknown';
  return {
    groupName,
    groupType,
    groupAssets,
    pendingAssets,
    pendingUnits,
    specBuckets,
    dominantBucket,
    specsDiffer: specBuckets.size > 1,
    expectedGroupKey: `${normalizeValue(groupName)}::${normalizeValue(groupType)}`,
  };
}

function setBulkSpecActionButtonsDisabled(disabled) {
  ['bulkSpecApproveBtn', 'bulkSpecCorrectBtn', 'bulkSpecRejectBtn'].forEach((id) => {
    const button = document.getElementById(id);
    if (button) button.disabled = Boolean(disabled);
  });
}

function updateSpecVerificationSnapshotFromLocalAssets() {
  const pendingCount = currentAssets.reduce((count, asset) => {
    return count + (getSpecVerificationStatus(asset) === 'pending' ? getAssetQuantity(asset) : 0);
  }, 0);
  specVerificationSnapshot.pendingCount = pendingCount;

  const badgeEl = document.getElementById('specVerificationPendingBadge');
  if (badgeEl) {
    badgeEl.className = `badge ${pendingCount > 0 ? 'bg-warning text-dark' : 'bg-success'}`;
    badgeEl.textContent = `Pending: ${pendingCount}`;
  }
}

function upsertAssetInLocalState(updatedAsset) {
  if (!updatedAsset || !updatedAsset.customId) return null;
  const index = currentAssets.findIndex((asset) => asset.customId === updatedAsset.customId);
  if (index < 0) return null;
  currentAssets[index] = {
    ...currentAssets[index],
    ...updatedAsset,
    specifications: (updatedAsset.specifications && typeof updatedAsset.specifications === 'object')
      ? updatedAsset.specifications
      : currentAssets[index].specifications
  };
  return currentAssets[index];
}

function rerenderOpenDetailsModalIfNeeded() {
  const detailsModalEl = document.getElementById('detailsModal');
  if (!detailsModalEl || !detailsModalEl.classList.contains('show')) return;
  if (!activeDetailsGroupName) return;

  const hasGroupAssets = currentAssets.some((asset) => asset.name === activeDetailsGroupName);
  if (!hasGroupAssets) return;
  window.viewAssetDetails(activeDetailsGroupName);
}

async function refreshDerivedStateForAssets(assetIds = []) {
  const uniqueIds = Array.from(new Set(
    (assetIds || [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  ));
  if (!uniqueIds.length) return;

  await runWithConcurrency(uniqueIds, 3, async (assetId) => {
    try {
      const [jobRes, eolRes] = await Promise.all([
        inventoryRequest(`/assets/${encodeURIComponent(assetId)}/ai-jobs`),
        inventoryRequest(`/assets/${encodeURIComponent(assetId)}/eol-assessment`)
      ]);

      if (jobRes.ok) {
        const jobPayload = await jobRes.json();
        aiJobStatusCache.set(assetId, jobPayload);
      }
      if (eolRes.ok) {
        const eolPayload = await eolRes.json();
        eolAssessmentCache.set(assetId, eolPayload);
      }
    } catch (error) {
      console.warn(`Failed to refresh derived AI state for ${assetId}:`, error?.message || error);
    }
  });

  renderTable();
  rerenderOpenDetailsModalIfNeeded();
  checkGlobalEOLAlerts();
}

async function refreshSingleAssetDerivedState(assetId) {
  if (!assetId) return;
  await refreshDerivedStateForAssets([assetId]);
}

async function refreshSpecVerificationSnapshot() {
  const summaryEl = document.getElementById('specVerificationSummary');
  const badgeEl = document.getElementById('specVerificationPendingBadge');
  try {
    const [pendingRes, metricsRes] = await Promise.all([
      fetch(`${API_URL}/assets/spec-verification/pending`),
      fetch(`${API_URL}/assets/spec-verification/metrics`)
    ]);

    const pendingPayload = pendingRes.ok ? await pendingRes.json() : { count: 0, assets: [] };
    const metricsPayload = metricsRes.ok ? await metricsRes.json() : null;

    specVerificationSnapshot = {
      pendingCount: Number(pendingPayload.count || 0),
      metrics: metricsPayload
    };

    if (badgeEl) {
      badgeEl.className = `badge ${specVerificationSnapshot.pendingCount > 0 ? 'bg-warning text-dark' : 'bg-success'}`;
      badgeEl.textContent = `Pending: ${specVerificationSnapshot.pendingCount}`;
    }

    if (summaryEl) {
      const evaluated = Number(metricsPayload?.evaluated_records || 0);
      const ramPrecision = Number(metricsPayload?.precision_by_field?.RAM || 0);
      summaryEl.textContent = `Reviewed records: ${evaluated}. RAM precision: ${(ramPrecision * 100).toFixed(0)}%.`;
    }
  } catch (error) {
    console.error('Failed to refresh spec verification snapshot', error);
    if (summaryEl) summaryEl.textContent = 'Could not load verification queue/metrics.';
    if (badgeEl) {
      badgeEl.className = 'badge bg-secondary';
      badgeEl.textContent = 'Pending: --';
    }
  }
}

window.openSpecVerificationModal = (customId) => {
  const asset = currentAssets.find(a => a.customId === customId);
  if (!asset) {
    showMessage('Asset not found.', 'error');
    return;
  }
  const specs = getAssetSpecs(asset);
  const predicted = (specs.aiDetectedSpecs && typeof specs.aiDetectedSpecs === 'object') ? specs.aiDetectedSpecs : {};
  const correctedSeed = Object.keys(predicted).length ? predicted : specs;

  const assetIdInput = document.getElementById('specVerificationAssetId');
  const assetLabel = document.getElementById('specVerificationAssetLabel');
  const predictedBox = document.getElementById('specVerificationPredicted');
  const correctedBox = document.getElementById('specVerificationCorrected');
  const meta = document.getElementById('specVerificationMeta');

  if (assetIdInput) assetIdInput.value = customId;
  if (assetLabel) assetLabel.textContent = `${asset.name || 'Asset'} (${customId})`;
  if (predictedBox) predictedBox.value = formatSpecsObject(predicted) || 'No AI predicted specs stored.';
  if (correctedBox) correctedBox.value = formatSpecsObject(correctedSeed);
  if (meta) {
    const conf = Number(specs.aiSpecConfidence || 0);
    const source = String(specs.aiSpecSource || 'unknown');
    const mode = String(specs.aiSpecLookupMode || 'unknown');
    const evidenceReason = String(specs.aiSpecEvidenceReason || '').trim();
    meta.textContent = evidenceReason
      ? `Confidence ${(conf * 100).toFixed(1)}% | Source: ${source} | Mode: ${mode} | ${evidenceReason}`
      : `Confidence ${(conf * 100).toFixed(1)}% | Source: ${source} | Mode: ${mode}`;
  }

  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('specVerificationModal'));
  modal.show();
};

window.openBulkSpecVerificationModal = () => {
  if (!activeDetailsGroupName) {
    showMessage('Open a group first to review pending specs.', 'warning');
    return;
  }

  const context = buildBulkSpecReviewContext(activeDetailsGroupName);
  if (!context.pendingAssets.length) {
    showMessage('No pending spec-review assets in this group.', 'info');
    return;
  }
  bulkSpecReviewContext = context;

  const groupLabel = document.getElementById('bulkSpecVerificationGroupLabel');
  const pendingCount = document.getElementById('bulkSpecVerificationPendingCount');
  const predictedBox = document.getElementById('bulkSpecVerificationPredicted');
  const correctedBox = document.getElementById('bulkSpecVerificationCorrected');
  const warningBox = document.getElementById('bulkSpecVerificationWarning');

  const sharedSpecs = context.dominantBucket?.specs || {};
  if (groupLabel) groupLabel.textContent = `${context.groupName} (${context.groupType})`;
  if (pendingCount) pendingCount.textContent = `${context.pendingUnits} unit(s) across ${context.pendingAssets.length} record(s)`;
  if (predictedBox) {
    predictedBox.value = formatSpecsObject(sharedSpecs) || 'No shared AI-predicted specs found.';
  }
  if (correctedBox) {
    correctedBox.value = formatSpecsObject(sharedSpecs);
  }
  if (warningBox) {
    if (context.specsDiffer) {
      warningBox.classList.remove('d-none');
      warningBox.textContent = 'Pending assets have different predicted specs. Review carefully before applying one correction to all.';
    } else {
      warningBox.classList.add('d-none');
      warningBox.textContent = '';
    }
  }

  setBulkSpecActionButtonsDisabled(false);
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('bulkSpecVerificationModal'));
  modal.show();
};

async function submitBulkSpecVerificationAction(action) {
  if (bulkSpecActionInFlight) return;
  if (!bulkSpecReviewContext || !bulkSpecReviewContext.pendingAssets?.length) {
    showMessage('No pending assets selected for bulk review.', 'warning');
    return;
  }

  const correctedText = document.getElementById('bulkSpecVerificationCorrected')?.value || '';
  const correctedSpecifications = parseSpecsText(correctedText);
  if (action === 'correct' && !Object.keys(correctedSpecifications).length) {
    showMessage('Please provide corrected specifications before choosing Correct All.', 'warning');
    return;
  }

  if (bulkSpecReviewContext.specsDiffer && (action === 'approve' || action === 'correct')) {
    const confirmMixed = await confirmInventoryAction({
      title: 'Mixed Predicted Specs',
      message: 'Pending assets in this group do not share identical predicted specs. Apply this bulk action anyway?',
      confirmText: 'Apply to All Pending',
      cancelText: 'Cancel',
      confirmClass: 'inventory-insight-warning'
    });
    if (!confirmMixed) return;
  }

  bulkSpecActionInFlight = true;
  setBulkSpecActionButtonsDisabled(true);

  try {
    const response = await fetch(`${API_URL}/assets/spec-verification/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assetIds: bulkSpecReviewContext.pendingAssets.map((asset) => asset.customId),
        action,
        correctedSpecifications: action === 'correct' ? correctedSpecifications : {},
        expectedGroupKey: bulkSpecReviewContext.expectedGroupKey,
        reviewer: 'inventory-admin-ui-bulk'
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Bulk spec verification failed.');
    }

    const updatedAssets = Array.isArray(payload.updatedAssets) ? payload.updatedAssets : [];
    updatedAssets.forEach((entry) => {
      const updatedAsset = entry?.asset || entry;
      upsertAssetInLocalState(updatedAsset);
    });

    updateSpecVerificationSnapshotFromLocalAssets();
    renderTable();
    rerenderOpenDetailsModalIfNeeded();
    checkGlobalEOLAlerts();
    refreshSpecVerificationSnapshot().catch(() => {});

    const updatedIds = updatedAssets
      .map((entry) => String(entry?.assetId || entry?.customId || entry?.asset?.customId || '').trim())
      .filter(Boolean);
    if (updatedIds.length) {
      refreshDerivedStateForAssets(updatedIds).catch(() => {});
    }

    const modal = bootstrap.Modal.getInstance(document.getElementById('bulkSpecVerificationModal'));
    if (modal) modal.hide();

    const updatedCount = Number(payload.updatedCount || updatedAssets.length || 0);
    const skippedCount = Number(payload.skippedCount || 0);
    if (action === 'approve') showMessage(`${updatedCount} specs approved${skippedCount ? ` (${skippedCount} skipped)` : ''}`, 'success');
    else if (action === 'correct') showMessage(`${updatedCount} corrected specs saved${skippedCount ? ` (${skippedCount} skipped)` : ''}`, 'success');
    else showMessage(`${updatedCount} specs rejected${skippedCount ? ` (${skippedCount} skipped)` : ''}`, 'success');
  } catch (error) {
    console.error(error);
    showMessage(error.message || 'Failed to run bulk spec verification.', 'error');
  } finally {
    bulkSpecActionInFlight = false;
    setBulkSpecActionButtonsDisabled(false);
  }
}

async function submitSpecVerificationAction(action) {
  const assetId = document.getElementById('specVerificationAssetId')?.value;
  if (!assetId) {
    showMessage('Missing asset ID for verification.', 'error');
    return;
  }

  const correctedText = document.getElementById('specVerificationCorrected')?.value || '';
  const correctedSpecifications = parseSpecsText(correctedText);

  if (action === 'correct' && !Object.keys(correctedSpecifications).length) {
    showMessage('Please provide corrected specifications before choosing Correct.', 'warning');
    return;
  }

  try {
    const response = await fetch(`${API_URL}/assets/${encodeURIComponent(assetId)}/spec-verification`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        correctedSpecifications: action === 'correct' ? correctedSpecifications : {},
        reviewer: 'inventory-admin-ui'
      })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || 'Verification update failed');
    }

    const payload = await response.json().catch(() => ({}));
    const updatedAsset = payload?.asset || payload;
    const mergedAsset = upsertAssetInLocalState(updatedAsset);
    if (!mergedAsset) {
      throw new Error('Updated asset state could not be applied locally.');
    }

    const modal = bootstrap.Modal.getInstance(document.getElementById('specVerificationModal'));
    if (modal) modal.hide();

    updateSpecVerificationSnapshotFromLocalAssets();
    renderTable();
    rerenderOpenDetailsModalIfNeeded();
    checkGlobalEOLAlerts();
    refreshSpecVerificationSnapshot().catch(() => {});

    const historyTitle = document.querySelector('#historyModal .modal-title');
    const historyModalEl = document.getElementById('historyModal');
    if (historyModalEl?.classList.contains('show') && historyTitle?.textContent?.includes(assetId)) {
      window.viewTransferHistory(assetId).catch(() => {});
    }

    refreshSingleAssetDerivedState(assetId).catch(() => {});

    if (action === 'approve') showMessage('Specs approved', 'success');
    else if (action === 'correct') showMessage('Corrected specs saved', 'success');
    else showMessage('Specs rejected', 'success');
  } catch (error) {
    console.error(error);
    showMessage(error.message || 'Failed to submit specification review.', 'error');
  }
}
function populateFilters() {
  const buildingSelect = document.getElementById('filterBuilding');
  const deptSelect = document.getElementById('filterDept');
  const typeSelect = document.getElementById('filterType');
  const lifecycleSelect = document.getElementById('filterLifecycle');

  if (!buildingSelect || !deptSelect || !typeSelect) return;

  const currentBuilding = buildingSelect.value;
  const currentDept = deptSelect.value;
  const currentType = typeSelect.value;
  const currentLifecycle = lifecycleSelect?.value || 'all';

  buildingSelect.innerHTML = '<option value="all">All Buildings</option>' + BUILDINGS.map(b => `<option value="${b}">${b}</option>`).join('');
  deptSelect.innerHTML = '<option value="all">All Departments</option>' + DEPARTMENTS.map(d => `<option value="${d}">${d}</option>`).join('');
  typeSelect.innerHTML = '<option value="all">All Asset Types</option>' + ASSET_TYPES.map(at => `<option value="${at.value}">${at.label}</option>`).join('');

  if (BUILDINGS.includes(currentBuilding) || currentBuilding === 'all') buildingSelect.value = currentBuilding;
  if (DEPARTMENTS.includes(currentDept) || currentDept === 'all') deptSelect.value = currentDept;
  if (ASSET_TYPES.map(a => a.value).includes(currentType) || currentType === 'all') typeSelect.value = currentType;
  if (lifecycleSelect) lifecycleSelect.value = currentLifecycle || 'all';
}

function syncFilters() {
  renderTable();
  filterGroupTable();
}
function resetFilters() {
  document.getElementById('filterBuilding').value = 'all';
  document.getElementById('filterDept').value = 'all';
  document.getElementById('filterType').value = 'all';
  const lifecycleSelect = document.getElementById('filterLifecycle');
  if (lifecycleSelect) lifecycleSelect.value = 'all';
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
  const lifecycleFilter = document.getElementById('filterLifecycle')?.value;

  const filteredAssets = currentAssets.filter(asset => {
    const matchBuilding = !buildingFilter || buildingFilter === 'all' || normalizeValue(displayLocation(asset.location)) === normalizeValue(buildingFilter);
    const matchDept = !deptFilter || deptFilter === 'all' || normalizeValue(displayDepartment(asset.department)) === normalizeValue(deptFilter);
    const matchType = !typeFilter || typeFilter === 'all' || normalizeValue(canonicalType(asset.type)) === normalizeValue(typeFilter);
    const assetLifecycle = normalizeLifecycleStatus(asset.lifecycleStatus || asset.lifecycle_status || 'in_stock');
    const matchLifecycle = !lifecycleFilter || lifecycleFilter === 'all' || normalizeValue(assetLifecycle) === normalizeValue(lifecycleFilter);
    return matchBuilding && matchDept && matchType && matchLifecycle;
  });

  if (!filteredAssets || filteredAssets.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4">No assets found matching filters.</td></tr>`;
    updateDeleteAllAssetsButton();
    return;
  }

  const groupedByName = {};
  filteredAssets.forEach(asset => {
    if (!groupedByName[asset.name]) groupedByName[asset.name] = [];
    groupedByName[asset.name].push(asset);
  });

  tableBody.innerHTML = Object.entries(groupedByName).map(([assetName, assetGroup]) => {
    const totalQty = getAssetsTotalQuantity(assetGroup);
    const firstAsset = assetGroup[0];
    const typeObj = ASSET_TYPES.find(t => normalizeValue(t.value) === normalizeValue(canonicalType(firstAsset.type)));
    const typeLabel = typeObj ? typeObj.label : formatType(firstAsset.type);
    
    const locationsSet = new Set(assetGroup.map(a => displayLocation(a.location)).filter(Boolean));
    const departmentsSet = new Set(assetGroup.map(a => displayDepartment(a.department)).filter(Boolean));
    const serialsSet = new Set(assetGroup.map(a => getDisplaySerial(a)).filter(Boolean));
    const tagsSet = new Set(assetGroup.map(a => getDisplayAssetTag(a)).filter(Boolean));
    const locationsFound = Array.from(locationsSet).join(', ') || 'Unknown';
    const departmentsFound = Array.from(departmentsSet).join(', ') || 'Unassigned';
    const serialsFound = Array.from(serialsSet).join(', ');
    const tagsFound = Array.from(tagsSet).join(', ');

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
              <span class="d-none">${serialsFound} ${tagsFound}</span>
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
  updateDeleteAllAssetsButton();
}

function updateDeleteAllAssetsButton() {
  const button = document.getElementById('deleteAllAssetsBtn');
  if (!button) return;
  const count = getAssetsTotalQuantity(currentAssets);
  button.disabled = count === 0;
  button.innerHTML = `<i class="bi bi-trash3"></i> Delete All${count ? ` (${count})` : ''}`;
}

async function handleAddAsset(e) {
  e.preventDefault();

  if (!INVENTORY_ACCESS.canCreateAsset) {
    showMessage('Only admins can create new assets.', 'error');
    return;
  }
  if (specPreviewInFlight) {
    showMessage('Please wait for AI specs generation to complete.', 'warning');
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.innerHTML;
  
  const name = document.getElementById('assetName').value;
  const quantityRaw = document.getElementById('assetQuantity').value;
  const quantity = parseInt(quantityRaw, 10);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    showMessage('Quantity must be a positive integer.', 'warning');
    return;
  }
  const type = document.getElementById('assetType').value;
  const location = document.getElementById('assetLocation').value || 'Central Warehouse';
  const department = document.getElementById('assetDepartment').value || 'Unassigned';
  const brand = document.getElementById('assetBrand')?.value.trim() || '';
  const version = document.getElementById('assetVersion')?.value.trim() || '';
  const serialNumber = document.getElementById('assetSerialNumber')?.value.trim() || '';
  const serialNumbersText = document.getElementById('assetSerialNumbers')?.value || '';
  const serialNumbers = parseMultilineValues(serialNumbersText);
  const assetTag = document.getElementById('assetTag')?.value.trim() || '';
  const manufacturerPartNumber = document.getElementById('assetManufacturerPartNumber')?.value.trim() || '';
  const vendor = document.getElementById('assetVendor')?.value.trim() || '';
  const purchaseDate = document.getElementById('assetPurchaseDate')?.value || '';
  const purchaseCost = document.getElementById('assetPurchaseCost')?.value || '';
  const invoiceNumber = document.getElementById('assetInvoiceNumber')?.value.trim() || '';
  const purchaseOrderNumber = document.getElementById('assetPurchaseOrderNumber')?.value.trim() || '';
  const warrantyStartDate = document.getElementById('assetWarrantyStartDate')?.value || '';
  const warrantyEndDate = document.getElementById('assetWarrantyEndDate')?.value || '';
  const replacementCost = document.getElementById('assetReplacementCost')?.value || '';
  const assignedToName = document.getElementById('assetAssignedToName')?.value.trim() || '';
  const assignedToUserId = document.getElementById('assetAssignedToUserId')?.value.trim() || '';
  const assignedDepartment = document.getElementById('assetAssignedDepartment')?.value.trim() || '';
  const expectedReturnDate = document.getElementById('assetExpectedReturnDate')?.value || '';
  const trackWorkingHours = Boolean(document.getElementById('assetTrackHours')?.checked);
  const specConfirmationReviewed = Boolean(document.getElementById('assetSpecConfirmedOnCreate')?.checked);
  const reviewerUser = AuthService.getUser();
  const reviewerNameCandidate = `${reviewerUser?.firstName || ''} ${reviewerUser?.lastName || ''}`.trim();
  const specConfirmationReviewedBy = String(
    reviewerUser?.email
    || reviewerUser?.name
    || reviewerNameCandidate
    || 'asset_creator'
  ).trim();
  const manualSpecs = parseSpecsText(document.getElementById('assetSpecs')?.value || '');
  const inferredQuality = inferAssetQuality({ brand, version, specs: manualSpecs, type });
  const specifications = {
    ...manualSpecs,
    brand,
    version,
    inferredQuality,
    trackWorkingHours,
    telemetryEnabled: trackWorkingHours,
    workingHours: 0,
    operationalState: trackWorkingHours ? 'insufficient_data' : undefined,
    telemetryStatus: trackWorkingHours ? 'insufficient_data' : 'not_monitored',
    telemetryConfidence: 'low',
    telemetryReason: trackWorkingHours
      ? 'Telemetry monitoring enabled, but no live signal has been received yet.'
      : 'Telemetry monitoring disabled for this asset.',
    operationalStateUpdatedAt: trackWorkingHours ? new Date().toISOString() : undefined,
    specVerificationStatus: specConfirmationReviewed ? 'verified' : 'pending',
    specVerificationConfirmedOnCreate: specConfirmationReviewed,
    specVerificationReviewedBy: specConfirmationReviewed ? specConfirmationReviewedBy : undefined,
    specVerificationReviewedAt: specConfirmationReviewed ? new Date().toISOString() : undefined,
    specVerificationAction: specConfirmationReviewed ? 'confirmed_on_create' : undefined,
    aiSpecEvidenceStatus: 'insufficient_source_evidence',
    aiSpecEvidenceReason: 'No trusted exact source evidence found. Manual review recommended.'
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

  const sanityCheck = await requestSpecSanityCheck({
    assetType: type,
    brand,
    model: version,
    normalizedSpecs: manualSpecs,
    sourceType: lastSpecPreviewMeta.sourceType || '',
    evidenceStatus: lastSpecPreviewMeta.evidenceStatus || specifications.aiSpecEvidenceStatus,
  });
  if (sanityCheck) {
    const warnings = Array.isArray(sanityCheck.warnings) ? sanityCheck.warnings.filter(Boolean) : [];
    const suspicious = Array.isArray(sanityCheck.suspiciousFields) ? sanityCheck.suspiciousFields.filter(Boolean) : [];
    if (warnings.length > 0) {
      setSpecPreviewStatus(`Spec sanity check: ${warnings[0]}`, 'warning');
    }
    if (Boolean(sanityCheck.requiresReview) && suspicious.length > 0) {
      const proceedWithWarnings = await confirmInventoryAction({
        title: 'Spec Sanity Warnings',
        message: `${warnings.slice(0, 2).join(' ')} Continue creating assets with these warnings?`,
        type: 'warning',
        confirmText: 'Create Anyway',
        cancelText: 'Review Specs',
        confirmClass: 'inventory-insight-primary'
      });
      if (!proceedWithWarnings) return;
    }
  }

  submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving...';
  submitBtn.disabled = true;

  function generateCustomId() { return `ASSET-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

  try {
    const quantityToCreate = quantity;
    const customId = generateCustomId();
    const assetData = {
      name,
      customId,
      type,
      location,
      department,
      status: 'active',
      quantity: quantityToCreate,
      serialNumber,
      serialNumbers,
      serialNumbersText,
      assetTag,
      manufacturerPartNumber,
      assignedToName,
      assignedToUserId,
      assignedDepartment,
      expectedReturnDate: expectedReturnDate || null,
      vendor,
      purchaseDate: purchaseDate || null,
      purchaseCost: purchaseCost ? Number(purchaseCost) : null,
      invoiceNumber,
      purchaseOrderNumber,
      warrantyStartDate: warrantyStartDate || null,
      warrantyEndDate: warrantyEndDate || null,
      replacementCost: replacementCost ? Number(replacementCost) : null,
      specifications,
      specConfirmationReviewed,
      specConfirmationReviewedBy,
    };

    const response = await inventoryRequest('/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(assetData),
    });
    if (!response.ok) throw new Error((await response.json()).message || 'Failed to create asset');
    const payload = await response.json().catch(() => ({}));
    const createdCount = Number(payload?.createdCount || quantityToCreate);

    const modalEl = document.getElementById('receiveOrderModal');
    if (modalEl) bootstrap.Modal.getInstance(modalEl).hide();

    e.target.reset();
    document.getElementById('assetLocation').value = 'Central Warehouse';
    document.getElementById('assetDepartment').value = 'Unassigned';
    const specConfirmedCheckbox = document.getElementById('assetSpecConfirmedOnCreate');
    if (specConfirmedCheckbox) specConfirmedCheckbox.checked = false;
    lastSpecPreviewMeta = {
      sourceType: '',
      evidenceStatus: '',
      confidence: 0,
      requiresReview: true,
    };
    updateWorkingHoursAvailability();
    applyAssetTypeSpecTemplate();
    setSpecPreviewStatus('Approve/Edit before Create.', 'muted');
    updateInferredQualityPreview();

    await loadAssets();
    const bgStatus = String(payload?.backgroundProcessing?.status || 'queued');
    const serialWarnings = payload?.serialNumberSummary?.warnings || [];
    if (Array.isArray(serialWarnings) && serialWarnings.length) {
      showMessage(`Created ${createdCount} unit(s). Serial warning: ${serialWarnings[0]}`, 'warning');
    }
    if (bgStatus === 'enqueue_failed') {
      showMessage(`Created ${createdCount} asset unit(s), but background AI/EOL jobs failed to queue.`, 'warning');
    } else if (bgStatus === 'partially_queued') {
      showMessage(`Created ${createdCount} asset unit(s). AI/EOL processing is queued for most units.`, 'info');
    } else {
      showMessage(`Created ${createdCount} asset unit(s). AI/EOL processing in background.`, 'success');
    }

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
  activeDetailsGroupName = assetName;
  const groupAssets = currentAssets.filter(a => a.name === assetName);
  
  if (!groupAssets.length) {
    showMessage('Asset group not found.', 'error');
    return;
  }

  const totalQty = getAssetsTotalQuantity(groupAssets);
  const unitRows = getAssetUnitRows(groupAssets);
  console.debug('[AssetCreateDebug] modal-render', { assetName, groupAssets: groupAssets.length, totalQty, renderedRows: unitRows.length });
  const batchCount = groupAssets.length;
  document.getElementById('detailModalTitle').textContent = `${assetName} - ${totalQty} Unit(s)`;
  const detailSubtitle = document.getElementById('detailModalSubtitle');
  if (detailSubtitle) detailSubtitle.textContent = `Showing ${totalQty} unit(s) across ${batchCount} backend batch(es)`;
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
    
    const failingCount = groupAssets.reduce((count, asset) => {
      const eol = getEOLDetails(asset);
      return count + (!eol.isClosedLifecycle && eol.daysRemaining <= 180 ? getAssetQuantity(asset) : 0);
    }, 0);
    const lowConfidenceCount = groupAssets.reduce((count, asset) => {
      const eol = getEOLDetails(asset);
      return count + (eol.lowConfidence ? getAssetQuantity(asset) : 0);
    }, 0);
    const unknownCount = groupAssets.reduce((count, asset) => {
      const eol = getEOLDetails(asset);
      return count + (eol.eolStatus === 'unknown' || eol.eolStatus === 'insufficient_data' ? getAssetQuantity(asset) : 0);
    }, 0);

    let aiText = `<strong>AI Prediction:</strong>&nbsp;Profile-based lifespan for a&nbsp;<strong>${formatType(sampleAsset.type)}</strong>&nbsp;is&nbsp;<strong>${eolData.metrics.years} years</strong>.&nbsp;`;

    if (unknownCount > 0) {
      aiText += ` <span class="text-warning">` +
        `${unknownCount} item${unknownCount === 1 ? '' : 's'} ha${unknownCount === 1 ? 's' : 've'} unknown EOL status due to insufficient evidence or missing telemetry.` +
        `</span>`;
    } else if (lowConfidenceCount > 0) {
      aiText += ` <span class="text-warning">Backend EOL assessment is low confidence. Manual review recommended.</span>`;
    } else if (failingCount > 0) {
      aiText += ` <span class="text-danger">Based on backend EOL assessment, <b>${failingCount} item(s)</b> in this group need replacement planning soon.</span>`;
    } else {
      aiText += ` <span class="text-success">All items in this group currently have a healthy EOL status.</span>`;
    }

    aiBanner.innerHTML = aiText;
    headerDiv.insertBefore(aiBanner, headerDiv.firstChild);
  }

	  detailsBody.innerHTML = unitRows.map(({ asset, unitIndex, unitCount, unitLabel, isVirtualUnit }) => {
	    const eol = getEOLDetails(asset);
	    const profile = eol.metrics.prediction.profile;
	    const specStatus = getSpecVerificationStatus(asset);
	    const serialLabel = getDisplaySerial(asset);
	    const assetTagLabel = getDisplayAssetTag(asset);
	    const isDeployed = normalizeValue(displayLocation(asset.location)) !== normalizeValue('Central Warehouse');
    const trackingLabel = profile.trackWorkingHours
      ? `${getOperationalStateLabel(profile.telemetryStatus)} · ${capitalize(String(profile.telemetryConfidence || 'low'))} confidence${profile.hasTelemetry ? ` · ${Math.round(profile.workingHours).toLocaleString()}h observed` : ''}`
      : 'Not monitored';
    return `
	    <tr>
		      <td class="ps-4">
		        <span class="font-monospace fw-bold">${unitLabel}</span>
		        <div class="text-muted pred-lifespan-text">Batch ID: ${asset.customId}</div>
		        ${isVirtualUnit ? `<div class="text-muted pred-lifespan-text">Unit ${unitIndex} of ${unitCount}</div>` : ''}
	        <div class="text-muted pred-lifespan-text">${profile.brand || 'Unknown brand'}${profile.version ? ` - ${profile.version}` : ''}</div>
	        <div class="text-muted pred-lifespan-text">Detected quality: ${capitalize(profile.quality)}</div>
	        <div class="mt-1">${getSpecVerificationBadge(specStatus)}</div>
	      </td>
	      <td>
	        <span class="font-monospace">${UI.escapeHTML(serialLabel || 'Missing')}</span>
	        ${assetTagLabel ? `<div class="text-muted small">Tag: ${UI.escapeHTML(assetTagLabel)}</div>` : ''}
	      </td>
	      <td>
	        <span class="badge ${getStatusBadgeClass(asset.status)}">
	          ${displayStatus(asset.status)}
	        </span>
	        <div class="text-muted small mt-1">${UI.escapeHTML(displayLifecycleStatus(asset.lifecycleStatus || 'in_stock'))}</div>
	      </td>
      <td>${displayLocation(asset.location)}</td>
      <td>${displayDepartment(asset.department)}</td>
	      <td>
	        <div class="mb-1">
	          <span class="badge ${eol.statusClass}">${eol.remainingText}</span>
	        </div>
	        <div class="text-muted pred-lifespan-text">
	          <i class="bi bi-bar-chart-line inventory-ai-inline-icon"></i> EOL confidence: ${eol.confidence !== null ? `${Math.round(eol.confidence * 100)}%` : 'N/A'} (${capitalize(eol.evidenceLevel || 'low')})
	        </div>
	        <div class="text-muted pred-lifespan-text">
	          <i class="bi bi-lightning-charge inventory-ai-inline-icon"></i> ${UI.escapeHTML(eol.shortAction)}
	        </div>
	        ${eol.lowConfidence ? `<div class="text-warning pred-lifespan-text"><i class="bi bi-exclamation-triangle-fill me-1"></i>Low confidence</div>` : ''}
	        ${eol.procurementRecommended ? `<div class="text-danger pred-lifespan-text"><i class="bi bi-cart-check me-1"></i>Procurement recommended</div>` : ''}
	        <div class="mt-1">
	          <button class="btn btn-sm btn-outline-secondary" onclick="window.showEolWhy('${asset.customId}')" title="Why this EOL status">
	            Why?
	          </button>
	        </div>
	        <div class="text-muted pred-lifespan-text">
	          <i class="bi bi-clock-history inventory-ai-inline-icon"></i> ${trackingLabel}
	        </div>
	      </td>
	      <td class="text-end pe-4">
	        <div class="d-inline-flex flex-column align-items-end gap-1 inventory-row-actions">
	          <div class="btn-group btn-group-sm" role="group" aria-label="Primary row actions">
	            ${profile.trackWorkingHours && isDeployed ? `
	            <button class="btn btn-outline-dark" onclick="window.viewOperationalTelemetry('${asset.customId}')" title="Telemetry State">
	              <i class="bi bi-activity"></i>
	            </button>` : ''}
	            <button class="btn btn-outline-info d-inline-flex align-items-center justify-content-center p-0" style="width:36px;height:36px;font-size:16px;" onclick="window.viewQRCode('${asset.customId}')" title="View QR code">
	              <i class="bi bi-qr-code"></i>
	            </button>
		            <button class="btn btn-outline-primary d-inline-flex align-items-center justify-content-center p-0" style="width:36px;height:36px;font-size:16px;" onclick="window.viewTransferHistory('${asset.customId}')" title="View history">
		              <i class="bi bi-clock-history"></i>
		            </button>
		            <button class="btn btn-outline-success d-inline-flex align-items-center justify-content-center p-0" style="width:36px;height:36px;font-size:16px;" onclick="window.openAssetCmdb('${asset.customId}')" title="Components / Maintenance / Custody / Relationships">
		              <i class="bi bi-diagram-3"></i>
		            </button>
		            ${INVENTORY_ACCESS.canEditSpecs ? `
		            <button class="btn btn-outline-secondary d-inline-flex align-items-center justify-content-center p-0" style="width:36px;height:36px;font-size:16px;" onclick="window.editSpecs('${asset.customId}', false)" title="Edit specs/details">
		              <i class="bi bi-pencil"></i>
	            </button>` : ''}
	          </div>
	          <div class="d-flex gap-1 justify-content-end flex-wrap">
	            ${INVENTORY_ACCESS.canEditSpecs && shouldShowSpecReviewButton(specStatus) ? `
	            <button class="btn btn-sm btn-warning text-dark" onclick="window.openSpecVerificationModal('${asset.customId}')" title="Review AI-detected specifications">
	              <i class="bi bi-shield-exclamation me-1"></i>Review
	            </button>` : ''}
	            ${INVENTORY_ACCESS.canTransferAsset ? `
	            <button class="btn btn-sm btn-info text-white" onclick="window.transferIndividual('${asset.customId}')" title="Transfer asset">
	              <i class="bi bi-arrow-left-right me-1"></i>Transfer
	            </button>` : ''}
	            ${INVENTORY_ACCESS.canDeleteAsset ? `
	            <button class="btn btn-sm btn-danger" onclick="window.deleteIndividual('${asset.customId}')" title="Delete asset">
	              <i class="bi bi-trash me-1"></i>Remove
	            </button>` : ''}
	          </div>
	        </div>
	      </td>
	    </tr>
	  `}).join('');

  const bulkTransferBtn = document.getElementById('bulkTransferBtn');
  const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
  const bulkSpecReviewBtn = document.getElementById('bulkSpecReviewBtn');
  const pendingAssetsForGroup = getPendingSpecReviewAssetsInGroup(groupAssets);
  const pendingUnitsForGroup = pendingAssetsForGroup.reduce((sum, asset) => sum + getAssetQuantity(asset), 0);

  if (bulkTransferBtn) {
    bulkTransferBtn.style.display = INVENTORY_ACCESS.canTransferAsset ? '' : 'none';
    bulkTransferBtn.onclick = () => window.bulkTransferGroup(assetName);
  }
  if (bulkDeleteBtn) {
    bulkDeleteBtn.style.display = INVENTORY_ACCESS.canDeleteAsset ? '' : 'none';
    bulkDeleteBtn.onclick = () => window.bulkDeleteGroup(assetName);
  }
  if (bulkSpecReviewBtn) {
    const canBulkReview = INVENTORY_ACCESS.canEditSpecs && pendingAssetsForGroup.length > 0;
    bulkSpecReviewBtn.classList.toggle('d-none', !canBulkReview);
    bulkSpecReviewBtn.textContent = `Review Specs (${pendingUnitsForGroup})`;
    bulkSpecReviewBtn.onclick = () => window.openBulkSpecVerificationModal();
  }

  if (headerDiv) {
    const groupActionsDiv = document.createElement('div');
    groupActionsDiv.className = 'd-flex gap-2 ms-auto';
    groupActionsDiv.innerHTML = `
      <button class="btn btn-sm btn-outline-info" onclick="window.printQRLabels('${assetName}', true)" title="Print QR Labels">
        <i class="bi bi-printer"></i> Print Labels
      </button>
      ${INVENTORY_ACCESS.canEditSpecs ? `<button class="btn btn-sm btn-outline-secondary" onclick="window.editSpecs('${assetName}', true)" title="Edit Group Specs">
        <i class="bi bi-pencil"></i> Edit Specs
      </button>` : ''}
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
  if (!INVENTORY_ACCESS.canTransferAsset) {
    showMessage('Only admins and senior technicians can transfer assets.', 'error');
    return;
  }

  const asset = currentAssets.find(a => a.customId === customId);
  if (!asset) return;

  const availableQuantity = getAssetQuantity(asset);
  const quantity = availableQuantity;
  const displayLabel = asset.name || customId;
  selectedAssetCustomId = customId;
  document.getElementById('transferAssetId').textContent = `${displayLabel || customId} (${quantity} unit${quantity === 1 ? '' : 's'})`;
  document.getElementById('maxTransferQty').textContent = quantity;
  document.getElementById('transferQty').value = quantity;
  document.getElementById('transferQty').max = quantity;

  document.getElementById('checkBuilding').checked = false;
  document.getElementById('checkDept').checked = false;
  document.getElementById('buildingSelect').classList.add('d-none');
  document.getElementById('deptSelect').classList.add('d-none');
  
  populateTransferSelects();
  
  const transferModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('transferModal'));
  transferModal.show();
};

window.deleteIndividual = async (customId) => {
  if (!INVENTORY_ACCESS.canDeleteAsset) {
    showMessage('Only admins can delete assets.', 'error');
    return;
  }

  const assetToDelete = currentAssets.find(a => a.customId === customId);
  const confirmed = await confirmInventoryAction({
    title: 'Delete Asset',
    message: `Delete ${assetToDelete?.name || 'this asset'} (${customId})? This cannot be undone.`,
    confirmText: 'Delete',
    confirmClass: 'inventory-insight-danger'
  });
  if (!confirmed) return;

  try {
    const response = await inventoryRequest(`/assets/${encodeURIComponent(customId)}`, { method: 'DELETE' });
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
  if (!INVENTORY_ACCESS.canTransferAsset) {
    showMessage('Only admins and senior technicians can transfer assets.', 'error');
    return;
  }

  const groupAssets = currentAssets.filter(a => a.name === assetName);
  if (!groupAssets.length) return;

  const totalQty = getAssetsTotalQuantity(groupAssets);
  selectedAssetCustomId = assetName; 
  document.getElementById('transferAssetId').textContent = `${assetName} (${totalQty} unit${totalQty === 1 ? '' : 's'})`;
  document.getElementById('maxTransferQty').textContent = totalQty;
  document.getElementById('transferQty').value = totalQty;
  document.getElementById('transferQty').max = totalQty;

  document.getElementById('checkBuilding').checked = false;
  document.getElementById('checkDept').checked = false;
  document.getElementById('buildingSelect').classList.add('d-none');
  document.getElementById('deptSelect').classList.add('d-none');
  
  populateTransferSelects();
  
  const transferModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('transferModal'));
  transferModal.show();
};

window.bulkDeleteGroup = async (assetName) => {
  if (!INVENTORY_ACCESS.canDeleteAsset) {
    showMessage('Only admins can delete assets.', 'error');
    return;
  }

  const groupAssets = currentAssets.filter(a => a.name === assetName);
  if (!groupAssets.length) return;
  const totalQty = getAssetsTotalQuantity(groupAssets);

  const confirmed = await confirmInventoryAction({
    title: 'Delete Asset Group',
    message: `Delete all ${totalQty} unit(s) of "${assetName}"? This cannot be undone.`,
    confirmText: 'Delete Group',
    confirmClass: 'inventory-insight-danger'
  });
  if (!confirmed) return;

  try {
    for (const asset of groupAssets) {
      const response = await inventoryRequest(`/assets/${encodeURIComponent(asset.customId)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`Failed to delete ${asset.customId}`);
    }

    const detailsModal = bootstrap.Modal.getInstance(document.getElementById('detailsModal'));
    if (detailsModal) detailsModal.hide();

    await loadAssets();
    showMessage(`Deleted all ${totalQty} unit(s) of "${assetName}".`, 'success');
  } catch (error) {
    console.error(error);
    showMessage(error.message || 'Failed to delete asset group.', 'error');
  }
};

window.deleteAllAssets = async () => {
  const assetsToDelete = [...currentAssets];
  const totalQty = getAssetsTotalQuantity(assetsToDelete);
  if (!assetsToDelete.length) {
    showMessage('No assets to delete.', 'warning');
    return;
  }

  const confirmed = await confirmInventoryAction({
    title: 'Delete All Assets',
    message: `Delete all ${totalQty} asset unit(s)? This cannot be undone.`,
    confirmText: 'Delete All',
    confirmClass: 'inventory-insight-danger'
  });
  if (!confirmed) return;

  const deleteButton = document.getElementById('deleteAllAssetsBtn');
  const originalHtml = deleteButton?.innerHTML;
  if (deleteButton) {
    deleteButton.disabled = true;
    deleteButton.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Deleting...';
  }

  try {
    for (const asset of assetsToDelete) {
      const response = await fetch(`${API_URL}/assets/${encodeURIComponent(asset.customId)}`, { method: 'DELETE' });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || `Failed to delete ${asset.customId}`);
      }
    }

    const detailsModal = bootstrap.Modal.getInstance(document.getElementById('detailsModal'));
    if (detailsModal) detailsModal.hide();

    await loadAssets();
    showMessage(`Deleted ${totalQty} asset unit(s).`, 'success');
  } catch (error) {
    console.error(error);
    if (deleteButton) {
      deleteButton.disabled = false;
      deleteButton.innerHTML = originalHtml || '<i class="bi bi-trash3"></i> Delete All';
    }
    showMessage(error.message || 'Failed to delete all assets.', 'error');
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
    const response = await inventoryRequest(`/assets/${encodeURIComponent(customId)}/history`);
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

async function readInventoryJson(path) {
  const response = await inventoryRequest(path);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || `Request failed: ${path}`);
  }
  return response.json();
}

async function postInventoryJson(path, payload = {}, method = 'POST') {
  const response = await inventoryRequest(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || `Request failed: ${path}`);
  }
  return response.json().catch(() => ({}));
}

function cmdbStatusLabel(status) {
  const normalized = String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const labels = {
    in_stock: 'In Stock',
    installed: 'Installed',
    under_repair: 'Under Repair',
    failed: 'Failed',
    removed: 'Removed',
    replaced: 'Replaced',
    retired: 'Retired',
    disposed: 'Disposed',
  };
  return labels[normalized] || (normalized ? normalized.replace(/_/g, ' ') : '-');
}

function ensureCmdbModal() {
  let modalEl = document.getElementById(CMDB_MODAL_ID);
  if (!modalEl) {
    const modalHtml = `
      <div class="modal fade" id="${CMDB_MODAL_ID}" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-xl modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title fw-bold" id="${CMDB_MODAL_ID}-title">CMDB Management</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body" id="${CMDB_MODAL_ID}-body"></div>
            <div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button></div>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    modalEl = document.getElementById(CMDB_MODAL_ID);
    modalEl.addEventListener('hidden.bs.modal', () => {
      cmdbState = { assetId: null, activeTab: 'components' };
      const bodyEl = document.getElementById(`${CMDB_MODAL_ID}-body`);
      if (bodyEl) bodyEl.innerHTML = '';
    });
  }
  return bootstrap.Modal.getOrCreateInstance(modalEl);
}

async function fetchCmdbData(customId) {
  const [components, maintenance, custody, relationships, lifecycleEvents] = await Promise.all([
    readInventoryJson(`/assets/${encodeURIComponent(customId)}/components?includeRemoved=true`).catch(() => []),
    readInventoryJson(`/assets/${encodeURIComponent(customId)}/maintenance`).catch(() => []),
    readInventoryJson(`/assets/${encodeURIComponent(customId)}/custody`).catch(() => []),
    readInventoryJson(`/assets/${encodeURIComponent(customId)}/relationships`).catch(() => ({ outgoing: [], incoming: [] })),
    readInventoryJson(`/assets/${encodeURIComponent(customId)}/lifecycle-events`).catch(() => []),
  ]);
  return { components, maintenance, custody, relationships, lifecycleEvents };
}

function renderCmdbBody(customId, data) {
  const componentsRows = (data.components || []).map((component) => `
    <tr>
      <td>${UI.escapeHTML(component.componentName || '-')}</td>
      <td>${UI.escapeHTML(component.componentType || '-')}</td>
      <td>${UI.escapeHTML([component.brand, component.model].filter(Boolean).join(' / ') || '-')}</td>
      <td>${UI.escapeHTML(component.serialNumber || '-')}</td>
      <td>${UI.escapeHTML(component.partNumber || '-')}</td>
      <td><span class="badge bg-light text-dark border">${UI.escapeHTML(cmdbStatusLabel(component.status))}</span></td>
      <td>${UI.escapeHTML(component.condition || '-')}</td>
      <td>${component.installedAt ? UI.formatDateTime(component.installedAt) : '-'}</td>
      <td class="text-end">
        <div class="dropdown">
          <button class="btn btn-sm btn-outline-secondary dropdown-toggle" data-bs-toggle="dropdown" type="button">Actions</button>
          <ul class="dropdown-menu dropdown-menu-end">
            <li><button class="dropdown-item" onclick="window.cmdbEditComponent('${customId}','${component.id}')">Edit</button></li>
            <li><button class="dropdown-item" onclick="window.cmdbViewComponentHistory('${customId}','${component.id}')">History</button></li>
            <li><button class="dropdown-item text-warning" onclick="window.cmdbRepairComponent('${customId}','${component.id}')">Repair</button></li>
            <li><button class="dropdown-item text-primary" onclick="window.cmdbReplaceComponent('${customId}','${component.id}')">Replace</button></li>
            <li><button class="dropdown-item text-primary" onclick="window.cmdbReplaceFromStock('${customId}','${component.id}')">Stock Replace</button></li>
            <li><button class="dropdown-item text-danger" onclick="window.cmdbRemoveComponent('${customId}','${component.id}')">Remove</button></li>
            <li><button class="dropdown-item text-danger" onclick="window.cmdbMarkFailedComponent('${customId}','${component.id}')">Mark Failed</button></li>
            <li><button class="dropdown-item text-danger" onclick="window.cmdbRetireComponent('${customId}','${component.id}')">Retire/Dispose</button></li>
          </ul>
        </div>
      </td>
    </tr>
  `).join('');

  const maintenanceRows = (data.maintenance || []).map((row) => `
    <tr>
      <td>${UI.escapeHTML(row.maintenanceType || '-')}</td>
      <td>${UI.escapeHTML(row.status || '-')}</td>
      <td>${UI.escapeHTML(row.performedBy || '-')}</td>
      <td>${row.performedAt ? UI.formatDateTime(row.performedAt) : '-'}</td>
      <td>${UI.escapeHTML(String(row.cost ?? '-'))}</td>
    </tr>
  `).join('');

  const custodyRows = (data.custody || []).map((row) => `
    <tr>
      <td>${UI.escapeHTML(row.action || '-')}</td>
      <td>${UI.escapeHTML(row.assignedToName || row.assignedToUserId || '-')}</td>
      <td>${row.checkoutDate ? UI.formatDateTime(row.checkoutDate) : '-'}</td>
      <td>${row.returnedDate ? UI.formatDateTime(row.returnedDate) : '-'}</td>
      <td>${UI.escapeHTML(row.reason || '-')}</td>
    </tr>
  `).join('');

  const relRows = [
    ...((data.relationships?.outgoing || []).map((row) => ({ ...row, direction: 'outgoing' }))),
    ...((data.relationships?.incoming || []).map((row) => ({ ...row, direction: 'incoming' }))),
  ].map((row) => `
    <tr>
      <td>${UI.escapeHTML(row.direction)}</td>
      <td>${UI.escapeHTML(row.relationshipType || '-')}</td>
      <td>${UI.escapeHTML(row.assetId || '-')}</td>
      <td>${UI.escapeHTML(row.relatedAssetId || '-')}</td>
      <td class="text-end">${row.direction === 'outgoing' ? `<button class="btn btn-sm btn-outline-danger" onclick="window.cmdbDeleteRelationship('${customId}','${row.id}')">Delete</button>` : ''}</td>
    </tr>
  `).join('');

  const lifecycleRows = (data.lifecycleEvents || []).slice(0, 80).map((row) => `
    <tr>
      <td>${row.createdAt ? UI.formatDateTime(row.createdAt) : '-'}</td>
      <td>${UI.escapeHTML(row.eventType || '-')}</td>
      <td>${UI.escapeHTML(row.reason || '-')}</td>
      <td>${UI.escapeHTML(row.actor || '-')}</td>
    </tr>
  `).join('');

  return `
    <ul class="nav nav-tabs" role="tablist">
      <li class="nav-item"><button class="nav-link" data-cmdb-tab="components" data-bs-toggle="tab" data-bs-target="#${CMDB_MODAL_ID}-components" type="button">Components</button></li>
      <li class="nav-item"><button class="nav-link" data-cmdb-tab="maintenance" data-bs-toggle="tab" data-bs-target="#${CMDB_MODAL_ID}-maintenance" type="button">Maintenance</button></li>
      <li class="nav-item"><button class="nav-link" data-cmdb-tab="custody" data-bs-toggle="tab" data-bs-target="#${CMDB_MODAL_ID}-custody" type="button">Assignment/Custody</button></li>
      <li class="nav-item"><button class="nav-link" data-cmdb-tab="relationships" data-bs-toggle="tab" data-bs-target="#${CMDB_MODAL_ID}-relationships" type="button">Relationships</button></li>
      <li class="nav-item"><button class="nav-link" data-cmdb-tab="lifecycle" data-bs-toggle="tab" data-bs-target="#${CMDB_MODAL_ID}-lifecycle" type="button">Lifecycle Events</button></li>
    </ul>
    <div class="tab-content pt-3">
      <div class="tab-pane fade" id="${CMDB_MODAL_ID}-components">
        <div class="d-flex justify-content-end gap-2 mb-2">
          <button class="btn btn-sm btn-outline-primary" onclick="window.cmdbInstallFromStock('${customId}')">Install From Stock</button>
          <button class="btn btn-sm btn-primary" onclick="window.cmdbAddComponent('${customId}')">Add Component</button>
        </div>
        <div class="table-responsive"><table class="table table-sm">
          <thead><tr><th>Name</th><th>Type</th><th>Brand/Model</th><th>Serial</th><th>Part No.</th><th>Status</th><th>Condition</th><th>Installed At</th><th class="text-end">Actions</th></tr></thead>
          <tbody>${componentsRows || '<tr><td colspan="9" class="text-muted">No components.</td></tr>'}</tbody>
        </table></div>
      </div>
      <div class="tab-pane fade" id="${CMDB_MODAL_ID}-maintenance">
        <div class="d-flex justify-content-end mb-2"><button class="btn btn-sm btn-primary" onclick="window.cmdbAddMaintenance('${customId}')">Add Maintenance</button></div>
        <div class="table-responsive"><table class="table table-sm"><thead><tr><th>Type</th><th>Status</th><th>By</th><th>At</th><th>Cost</th></tr></thead><tbody>${maintenanceRows || '<tr><td colspan="5" class="text-muted">No maintenance records.</td></tr>'}</tbody></table></div>
      </div>
      <div class="tab-pane fade" id="${CMDB_MODAL_ID}-custody">
        <div class="d-flex justify-content-end gap-2 mb-2">
          <button class="btn btn-sm btn-primary" onclick="window.cmdbAssignAsset('${customId}')">Assign/Checkout</button>
          <button class="btn btn-sm btn-outline-secondary" onclick="window.cmdbCheckinAsset('${customId}')">Check-in</button>
        </div>
        <div class="table-responsive"><table class="table table-sm"><thead><tr><th>Action</th><th>User</th><th>Checkout</th><th>Return</th><th>Reason</th></tr></thead><tbody>${custodyRows || '<tr><td colspan="5" class="text-muted">No custody history.</td></tr>'}</tbody></table></div>
      </div>
      <div class="tab-pane fade" id="${CMDB_MODAL_ID}-relationships">
        <div class="d-flex justify-content-end mb-2"><button class="btn btn-sm btn-primary" onclick="window.cmdbAddRelationship('${customId}')">Add Relationship</button></div>
        <div class="table-responsive"><table class="table table-sm"><thead><tr><th>Direction</th><th>Type</th><th>Asset</th><th>Related</th><th></th></tr></thead><tbody>${relRows || '<tr><td colspan="5" class="text-muted">No relationships.</td></tr>'}</tbody></table></div>
      </div>
      <div class="tab-pane fade" id="${CMDB_MODAL_ID}-lifecycle">
        <div class="table-responsive"><table class="table table-sm"><thead><tr><th>When</th><th>Event</th><th>Reason</th><th>Actor</th></tr></thead><tbody>${lifecycleRows || '<tr><td colspan="4" class="text-muted">No lifecycle events.</td></tr>'}</tbody></table></div>
      </div>
    </div>
  `;
}

async function refreshCmdbModal(customId = cmdbState.assetId, preferredTab = cmdbState.activeTab || 'components') {
  const asset = currentAssets.find((entry) => entry.customId === customId);
  if (!asset) {
    showMessage('Asset not found.', 'error');
    return;
  }
  const modal = ensureCmdbModal();
  cmdbState.assetId = customId;
  cmdbState.activeTab = preferredTab;
  const titleEl = document.getElementById(`${CMDB_MODAL_ID}-title`);
  const bodyEl = document.getElementById(`${CMDB_MODAL_ID}-body`);
  if (titleEl) titleEl.textContent = `CMDB Management - ${asset.name} (${customId})`;
  if (bodyEl) bodyEl.innerHTML = '<div class="text-muted py-3">Loading CMDB data...</div>';

  const data = await fetchCmdbData(customId);
  if (bodyEl) bodyEl.innerHTML = renderCmdbBody(customId, data);
  const tabButtons = Array.from(document.querySelectorAll(`#${CMDB_MODAL_ID} [data-cmdb-tab]`));
  tabButtons.forEach((btn) => {
    btn.addEventListener('shown.bs.tab', (event) => {
      cmdbState.activeTab = event.target?.getAttribute('data-cmdb-tab') || 'components';
    });
  });
  const targetBtn = document.querySelector(`#${CMDB_MODAL_ID} [data-cmdb-tab="${cmdbState.activeTab}"]`) || document.querySelector(`#${CMDB_MODAL_ID} [data-cmdb-tab="components"]`);
  if (targetBtn) bootstrap.Tab.getOrCreateInstance(targetBtn).show();
  modal.show();
}

window.openAssetCmdb = async (customId) => {
  try {
    await refreshCmdbModal(customId, cmdbState.assetId === customId ? cmdbState.activeTab : 'components');
  } catch (error) {
    showMessage(error.message || 'Failed to open CMDB modal.', 'error');
  }
};

window.cmdbViewComponentHistory = async (assetId, componentId) => {
  try {
    const rows = await readInventoryJson(`/assets/${encodeURIComponent(assetId)}/components/${encodeURIComponent(componentId)}/history`);
    const preview = (rows || []).slice(0, 8).map((row) => `${row.createdAt ? new Date(row.createdAt).toLocaleString() : '-'} - ${row.eventType || '-'} (${row.reason || 'n/a'})`).join('\n');
    window.alert(preview || 'No component history entries yet.');
  } catch (error) {
    showMessage(error.message || 'Failed to load component history.', 'error');
  }
};

window.cmdbAddComponent = async (assetId) => {
  const componentName = window.prompt('Component name (e.g., RAM 16GB):', '');
  if (!componentName) return;
  const componentType = window.prompt('Component type (ram/cpu/ssd/gpu/etc):', 'component') || 'component';
  const serialNumber = window.prompt('Component serial number (optional):', '') || '';
  const partNumber = window.prompt('Part number (optional):', '') || '';
  const existingChildAssetId = window.prompt('Existing component asset custom ID (optional):', '') || '';
  const createAsAsset = window.confirm('Create this component as a linked inventory asset as well?');
  const reason = window.prompt('Reason/notes (optional):', '') || '';
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/components`, {
      componentName,
      componentType,
      serialNumber,
      partNumber,
      childAssetId: existingChildAssetId || null,
      createAsAsset: existingChildAssetId ? false : createAsAsset,
      reason,
      status: 'installed',
    });
    showMessage('Component added.', 'success');
    await loadAssets();
    await refreshCmdbModal(assetId, 'components');
  } catch (error) {
    showMessage(error.message || 'Failed to add component.', 'error');
  }
};

window.cmdbEditComponent = async (assetId, componentId) => {
  const componentName = window.prompt('Updated component name:', '');
  if (!componentName) return;
  const componentType = window.prompt('Updated component type:', 'component') || 'component';
  const serialNumber = window.prompt('Updated serial (optional):', '') || '';
  const partNumber = window.prompt('Updated part number (optional):', '') || '';
  const condition = window.prompt('Updated condition (optional):', '') || '';
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/components/${encodeURIComponent(componentId)}`, {
      componentName,
      componentType,
      serialNumber,
      partNumber,
      condition,
    }, 'PUT');
    showMessage('Component updated.', 'success');
    await refreshCmdbModal(assetId, 'components');
  } catch (error) {
    showMessage(error.message || 'Failed to update component.', 'error');
  }
};

window.cmdbRemoveComponent = async (assetId, componentId) => {
  const reason = window.prompt('Removal reason:', 'removed');
  if (!reason) return;
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/components/${encodeURIComponent(componentId)}/remove`, { reason, status: 'removed' });
    showMessage('Component removed.', 'success');
    await refreshCmdbModal(assetId, 'components');
  } catch (error) {
    showMessage(error.message || 'Failed to remove component.', 'error');
  }
};

window.cmdbReplaceComponent = async (assetId, componentId) => {
  const componentName = window.prompt('New component name:', '');
  if (!componentName) return;
  const componentType = window.prompt('New component type:', 'component') || 'component';
  const serialNumber = window.prompt('New component serial (optional):', '') || '';
  const reason = window.prompt('Replacement reason:', 'replaced');
  if (!reason) return;
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/components/${encodeURIComponent(componentId)}/replace`, {
      reason,
      newComponent: { componentName, componentType, serialNumber, status: 'installed' },
      oldStatus: 'replaced',
    });
    showMessage('Component replaced.', 'success');
    await refreshCmdbModal(assetId, 'components');
  } catch (error) {
    showMessage(error.message || 'Failed to replace component.', 'error');
  }
};

window.cmdbRepairComponent = async (assetId, componentId) => {
  const reason = window.prompt('Repair reason:', 'repair');
  if (!reason) return;
  const nextStatus = window.prompt('Set status after repair (under_repair/installed):', 'under_repair') || 'under_repair';
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/components/${encodeURIComponent(componentId)}/repair`, {
      reason,
      status: nextStatus,
      maintenanceType: 'component_repair',
      maintenanceStatus: 'completed',
    });
    showMessage('Component repair recorded.', 'success');
    await refreshCmdbModal(assetId, 'components');
  } catch (error) {
    showMessage(error.message || 'Failed to repair component.', 'error');
  }
};

window.cmdbMarkFailedComponent = async (assetId, componentId) => {
  const reason = window.prompt('Failure reason:', 'hardware failure');
  if (!reason) return;
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/components/${encodeURIComponent(componentId)}/mark-failed`, { reason });
    showMessage('Component marked as failed.', 'warning');
    await refreshCmdbModal(assetId, 'components');
  } catch (error) {
    showMessage(error.message || 'Failed to mark component failed.', 'error');
  }
};

window.cmdbRetireComponent = async (assetId, componentId) => {
  const status = window.prompt('Retire status (retired/disposed):', 'retired') || 'retired';
  const reason = window.prompt('Retire/Dispose reason:', status) || status;
  if (!reason) return;
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/components/${encodeURIComponent(componentId)}/retire`, { status, reason });
    showMessage(`Component ${status}.`, status === 'disposed' ? 'warning' : 'success');
    await refreshCmdbModal(assetId, 'components');
  } catch (error) {
    showMessage(error.message || 'Failed to retire/dispose component.', 'error');
  }
};

window.cmdbInstallFromStock = async (assetId) => {
  await window.loadSpareStock();
  const stockLabel = spareStockItemsCache.filter((item) => Number(item.quantityAvailable) > 0)
    .map((item) => `${item.id}: ${item.partName} (${item.quantityAvailable})`).join('\n');
  if (!stockLabel) {
    showMessage('No available spare stock items to install.', 'warning');
    return;
  }
  const spareStockItemId = window.prompt(`Enter spare stock ID to install:\n${stockLabel}`, '') || '';
  if (!spareStockItemId) return;
  const reason = window.prompt('Install reason:', 'installed_from_stock') || 'installed_from_stock';
  try {
    const result = await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/components/install-from-stock`, {
      spareStockItemId,
      reason,
      createAsAsset: true,
      status: 'installed',
    });
    showMessage(result?.lowStockWarning ? 'Installed from stock. Low stock warning triggered.' : 'Installed from stock.', result?.lowStockWarning ? 'warning' : 'success');
    await loadSpareStock();
    await loadAssets();
    await refreshCmdbModal(assetId, 'components');
  } catch (error) {
    showMessage(error.message || 'Failed to install from stock.', 'error');
  }
};

window.cmdbReplaceFromStock = async (assetId, componentId) => {
  await window.loadSpareStock();
  const stockLabel = spareStockItemsCache.filter((item) => Number(item.quantityAvailable) > 0)
    .map((item) => `${item.id}: ${item.partName} (${item.quantityAvailable})`).join('\n');
  if (!stockLabel) {
    showMessage('No available spare stock items for replacement.', 'warning');
    return;
  }
  const spareStockItemId = window.prompt(`Enter spare stock ID for replacement:\n${stockLabel}`, '') || '';
  if (!spareStockItemId) return;
  const reason = window.prompt('Replacement reason:', 'replaced_from_stock') || 'replaced_from_stock';
  if (!reason) return;
  try {
    const result = await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/components/${encodeURIComponent(componentId)}/replace-from-stock`, {
      spareStockItemId,
      reason,
      oldStatus: 'replaced',
      createAsAsset: true,
      createMaintenanceRecord: true,
      maintenanceType: 'component_replacement',
      maintenanceStatus: 'completed',
    });
    showMessage(result?.lowStockWarning ? 'Component replaced. Low stock warning triggered.' : 'Component replaced from stock.', result?.lowStockWarning ? 'warning' : 'success');
    await loadSpareStock();
    await loadAssets();
    await refreshCmdbModal(assetId, 'components');
  } catch (error) {
    showMessage(error.message || 'Failed to replace from stock.', 'error');
  }
};

window.cmdbAddMaintenance = async (assetId) => {
  const maintenanceType = window.prompt('Maintenance type:', 'preventive_maintenance');
  if (!maintenanceType) return;
  const status = window.prompt('Status (completed/in_progress/scheduled):', 'completed') || 'completed';
  const performedBy = window.prompt('Performed by (optional):', '') || '';
  const reason = window.prompt('Reason/notes (optional):', '') || '';
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/maintenance`, {
      maintenanceType,
      status,
      performedBy,
      reason,
      performedAt: new Date().toISOString(),
    });
    showMessage('Maintenance record added.', 'success');
    await refreshCmdbModal(assetId, 'maintenance');
  } catch (error) {
    showMessage(error.message || 'Failed to add maintenance record.', 'error');
  }
};

window.cmdbAssignAsset = async (assetId) => {
  const assignedToName = window.prompt('Assign to (name):', '');
  if (!assignedToName) return;
  const assignedDepartment = window.prompt('Assigned department (optional):', '') || '';
  const expectedReturnDate = window.prompt('Expected return date (YYYY-MM-DD, optional):', '') || '';
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/assign`, {
      assignedToName,
      assignedDepartment,
      expectedReturnDate: expectedReturnDate || null,
      checkoutDate: new Date().toISOString(),
    });
    showMessage('Asset assigned/checked out.', 'success');
    await loadAssets();
    await refreshCmdbModal(assetId, 'custody');
  } catch (error) {
    showMessage(error.message || 'Failed to assign asset.', 'error');
  }
};

window.cmdbCheckinAsset = async (assetId) => {
  const reason = window.prompt('Check-in note/reason (optional):', '') || '';
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/check-in`, {
      returnedDate: new Date().toISOString(),
      reason,
    });
    showMessage('Asset checked in.', 'success');
    await loadAssets();
    await refreshCmdbModal(assetId, 'custody');
  } catch (error) {
    showMessage(error.message || 'Failed to check in asset.', 'error');
  }
};

window.cmdbAddRelationship = async (assetId) => {
  const relatedAssetId = window.prompt('Related asset custom ID:', '');
  if (!relatedAssetId) return;
  const relationshipType = window.prompt('Relationship type (uses/connected_to/depends_on/etc):', 'uses');
  if (!relationshipType) return;
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/relationships`, {
      relatedAssetId,
      relationshipType,
    });
    showMessage('Relationship added.', 'success');
    await refreshCmdbModal(assetId, 'relationships');
  } catch (error) {
    showMessage(error.message || 'Failed to add relationship.', 'error');
  }
};

window.cmdbDeleteRelationship = async (assetId, relationshipId) => {
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/relationships/${encodeURIComponent(relationshipId)}`, {}, 'DELETE');
    showMessage('Relationship removed.', 'success');
    await refreshCmdbModal(assetId, 'relationships');
  } catch (error) {
    showMessage(error.message || 'Failed to remove relationship.', 'error');
  }
};

window.loadSpareStock = async () => {
  try {
    const response = await readInventoryJson('/inventory/spare-stock');
    spareStockItemsCache = Array.isArray(response?.items) ? response.items : [];
    window.renderSpareStockTable();
  } catch (error) {
    showMessage(error.message || 'Failed to load spare stock.', 'error');
  }
};

window.renderSpareStockTable = () => {
  const tableBody = document.getElementById('spareStockTableBody');
  if (!tableBody) return;
  const search = String(document.getElementById('spareStockSearchInput')?.value || '').trim().toLowerCase();
  const rows = (spareStockItemsCache || []).filter((item) => {
    if (spareStockLowOnly && !item.lowStock) return false;
    if (!search) return true;
    return [
      item.partName,
      item.componentType,
      item.brand,
      item.model,
      item.partNumber,
      item.location,
      item.vendor,
    ].some((value) => String(value || '').toLowerCase().includes(search));
  });
  if (!rows.length) {
    tableBody.innerHTML = '<tr><td colspan="9" class="text-muted text-center py-4">No spare stock items found.</td></tr>';
    return;
  }
  tableBody.innerHTML = rows.map((item) => {
    const compatible = Array.isArray(item.compatibleBrandsModels) ? item.compatibleBrandsModels.join(', ') : '';
    return `
      <tr>
        <td>${UI.escapeHTML(item.partName || '-')}</td>
        <td>${UI.escapeHTML(item.componentType || '-')}</td>
        <td>${UI.escapeHTML([item.brand, item.model].filter(Boolean).join(' / ') || '-')}</td>
        <td>${UI.escapeHTML(item.partNumber || '-')}</td>
        <td>
          <span class="badge ${item.lowStock ? 'bg-warning text-dark' : 'bg-light text-dark border'}">${UI.escapeHTML(String(item.quantityAvailable ?? 0))}</span>
        </td>
        <td>${UI.escapeHTML(String(item.minimumStockLevel ?? 0))}</td>
        <td>${UI.escapeHTML(item.location || '-')}</td>
        <td>${UI.escapeHTML(compatible || '-')}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-secondary" onclick="window.editSpareStockItem('${item.id}')">Edit</button>
          <button class="btn btn-sm btn-outline-primary" onclick="window.adjustSpareStockItem('${item.id}')">Adjust</button>
        </td>
      </tr>
    `;
  }).join('');
};

window.openSpareStockModal = async () => {
  const modalEl = document.getElementById('spareStockModal');
  if (!modalEl) return;
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
  await window.loadSpareStock();
};

window.addSpareStockItem = async () => {
  const partName = window.prompt('Part name:', '');
  if (!partName) return;
  const componentType = window.prompt('Component type:', 'ssd') || 'component';
  const brand = window.prompt('Brand (optional):', '') || '';
  const model = window.prompt('Model (optional):', '') || '';
  const partNumber = window.prompt('Part number (optional):', '') || '';
  const quantityAvailable = Number(window.prompt('Quantity available:', '0') || '0');
  const minimumStockLevel = Number(window.prompt('Minimum stock level:', '0') || '0');
  const reorderPoint = Number(window.prompt('Reorder point (optional):', '') || '0');
  const location = window.prompt('Location (optional):', 'Central Warehouse') || '';
  const compatibleBrandsModels = window.prompt('Compatible brands/models (comma-separated):', '') || '';
  try {
    await postInventoryJson('/inventory/spare-stock', {
      partName,
      componentType,
      brand,
      model,
      partNumber,
      quantityAvailable: Number.isFinite(quantityAvailable) ? quantityAvailable : 0,
      minimumStockLevel: Number.isFinite(minimumStockLevel) ? minimumStockLevel : 0,
      reorderPoint: Number.isFinite(reorderPoint) ? reorderPoint : 0,
      location,
      compatibleBrandsModels: compatibleBrandsModels.split(',').map((v) => v.trim()).filter(Boolean),
    });
    showMessage('Spare stock item added.', 'success');
    await window.loadSpareStock();
  } catch (error) {
    showMessage(error.message || 'Failed to add spare stock item.', 'error');
  }
};

window.editSpareStockItem = async (id) => {
  const target = spareStockItemsCache.find((item) => item.id === id);
  if (!target) return;
  const partName = window.prompt('Part name:', target.partName || '') || '';
  if (!partName) return;
  const componentType = window.prompt('Component type:', target.componentType || 'component') || target.componentType;
  const brand = window.prompt('Brand:', target.brand || '') || '';
  const model = window.prompt('Model:', target.model || '') || '';
  const partNumber = window.prompt('Part number:', target.partNumber || '') || '';
  const minimumStockLevel = Number(window.prompt('Minimum stock level:', String(target.minimumStockLevel || 0)) || String(target.minimumStockLevel || 0));
  const location = window.prompt('Location:', target.location || '') || '';
  try {
    await postInventoryJson(`/inventory/spare-stock/${encodeURIComponent(id)}`, {
      partName,
      componentType,
      brand,
      model,
      partNumber,
      minimumStockLevel: Number.isFinite(minimumStockLevel) ? minimumStockLevel : target.minimumStockLevel,
      location,
    }, 'PATCH');
    showMessage('Spare stock item updated.', 'success');
    await window.loadSpareStock();
  } catch (error) {
    showMessage(error.message || 'Failed to update spare stock item.', 'error');
  }
};

window.adjustSpareStockItem = async (id) => {
  const delta = Number(window.prompt('Adjustment delta (+/- integer):', '1') || '0');
  if (!Number.isFinite(delta) || delta === 0) {
    showMessage('Please enter a non-zero integer.', 'warning');
    return;
  }
  try {
    const result = await postInventoryJson(`/inventory/spare-stock/${encodeURIComponent(id)}/adjust`, { delta });
    showMessage(result?.lowStock ? 'Stock adjusted. Item is now low-stock.' : 'Stock adjusted.', result?.lowStock ? 'warning' : 'success');
    await window.loadSpareStock();
  } catch (error) {
    showMessage(error.message || 'Failed to adjust spare stock item.', 'error');
  }
};

function renderImportPreviewRows(rows = []) {
  const tableBody = document.getElementById('importPreviewTableBody');
  if (!tableBody) return;
  if (!Array.isArray(rows) || rows.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="9" class="text-muted text-center py-4">No rows in preview.</td></tr>';
    return;
  }
  tableBody.innerHTML = rows.map((row) => {
    const message = [...(row.errors || []), ...(row.warnings || [])].join(' | ') || 'OK';
    const status = row.statusLabel || 'valid';
    const statusBadge = status === 'error'
      ? '<span class="badge bg-danger">Error</span>'
      : (status === 'warning' ? '<span class="badge bg-warning text-dark">Warning</span>' : '<span class="badge bg-success">Valid</span>');
    return `
      <tr>
        <td>${UI.escapeHTML(String(row.rowNumber || '-'))}</td>
        <td>${UI.escapeHTML(row.recordType || '-')}</td>
        <td>${UI.escapeHTML(row.assetName || '-')}</td>
        <td>${UI.escapeHTML(row.serialNumber || '-')}</td>
        <td>${UI.escapeHTML(row.assetTag || '-')}</td>
        <td>${UI.escapeHTML(row.parentAssetTag || '-')}</td>
        <td>${UI.escapeHTML(row.proposedAction || '-')}</td>
        <td>${statusBadge}</td>
        <td class="small">${UI.escapeHTML(message)}</td>
      </tr>
    `;
  }).join('');
}

window.openImportAssetsModal = async () => {
  importPreviewCache = null;
  const summary = document.getElementById('importPreviewSummary');
  const commitSummary = document.getElementById('importCommitSummary');
  const commitBtn = document.getElementById('commitImportBtn');
  if (summary) summary.textContent = 'No preview yet.';
  if (commitSummary) commitSummary.textContent = '';
  if (commitBtn) commitBtn.disabled = true;
  renderImportPreviewRows([]);
  const modalEl = document.getElementById('importAssetsModal');
  if (!modalEl) return;
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
};

window.copyImportTemplateCsv = async () => {
  const template = [
    'Record Type,Asset Name,Category,Asset Type,Brand,Model,Serial Number,Asset Tag,Manufacturer Part Number,Location,Department,Status,Lifecycle Status,Parent Asset Tag,Component Type,Condition,Quantity,Minimum Stock Level,Reorder Point,Vendor,Purchase Date,Warranty Start Date,Warranty End Date,Purchase Cost,Assigned To,Notes',
    'parent_asset,Dell OptiPlex Lab PC,Asset,Desktop,Dell,OptiPlex 7090,PC-SN-001,UNI-PC-LAB-A-001,LAT7090,Main Building,Computer Science,active,in_use,,,,1,,,Dell,2024-01-15,2024-01-15,2027-01-15,25000,IT Lab,Main PC',
    'embedded_component,RAM 16GB DDR4,Component,Electronics,Kingston,16GB DDR4,RAM-SN-001,UNI-RAM-001,KVR16GB,Main Building,Computer Science,active,in_use,UNI-PC-LAB-A-001,RAM,Good,1,,,,,,,,Initial RAM',
    'embedded_component,SSD 512GB,Component,Electronics,Samsung,512GB SSD,SSD-SN-001,UNI-SSD-001,SAM512,Main Building,Computer Science,active,in_use,UNI-PC-LAB-A-001,Storage,Good,1,,,,,,,,Initial SSD',
    'spare_stock,Samsung 512GB SSD,Spare Part,Electronics,Samsung,512GB SSD,,SPARE-SSD-512,SAM512,Central Warehouse,Computer Science,active,in_stock,,Storage,New,3,1,1,Dell,,,,1500,,Compatible with Dell OptiPlex',
  ].join('\n');
  try {
    await navigator.clipboard.writeText(template);
    showMessage('Import template CSV copied to clipboard.', 'success');
  } catch (_error) {
    showMessage('Could not copy template automatically. Please copy manually from the docs text.', 'warning');
  }
};

window.previewImportAssets = async () => {
  const fileInput = document.getElementById('importAssetsFile');
  const summary = document.getElementById('importPreviewSummary');
  const commitSummary = document.getElementById('importCommitSummary');
  const commitBtn = document.getElementById('commitImportBtn');
  if (!fileInput || !fileInput.files || !fileInput.files.length) {
    showMessage('Please choose a CSV or XLSX file.', 'warning');
    return;
  }
  const file = fileInput.files[0];
  const name = String(file.name || '');
  const lower = name.toLowerCase();

  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    showMessage('XLSX preview is not enabled yet. Please use CSV for now.', 'warning');
    return;
  }
  const text = await file.text();
  try {
    const preview = await postInventoryJson('/assets/import/preview', {
      filename: name,
      fileContent: text,
    });
    importPreviewCache = preview;
    renderImportPreviewRows(preview.normalizedRows || []);
    if (summary) {
      summary.textContent = `Rows: ${preview.totalRows || 0} | Valid: ${preview.validRows || 0} | Invalid: ${preview.invalidRows || 0} | Can Import: ${preview.canImport ? 'Yes' : 'No'}`;
    }
    if (commitSummary) {
      const msg = [...(preview.errors || []), ...(preview.warnings || [])].join(' | ');
      commitSummary.textContent = msg || '';
      commitSummary.className = `small mt-2 ${preview.canImport ? 'text-muted' : 'text-danger'}`;
    }
    if (commitBtn) commitBtn.disabled = !preview.canImport;
  } catch (error) {
    showMessage(error.message || 'Failed to preview import.', 'error');
  }
};

window.commitImportAssets = async () => {
  const summary = document.getElementById('importCommitSummary');
  if (!importPreviewCache || !Array.isArray(importPreviewCache.normalizedRows)) {
    showMessage('Run preview first.', 'warning');
    return;
  }
  if (!importPreviewCache.canImport) {
    showMessage('Import cannot proceed while preview has errors.', 'error');
    return;
  }
  try {
    const filename = importPreviewCache.filename || (document.getElementById('importAssetsFile')?.files?.[0]?.name || 'import.csv');
    const result = await postInventoryJson('/assets/import/commit', {
      filename,
      normalizedRows: importPreviewCache.normalizedRows,
    });
    if (summary) {
      summary.textContent = `Import complete. Assets: ${result.createdAssets || 0}, Components: ${result.createdComponents || 0}, Spare Stock: ${result.createdSpareStockItems || 0}, Skipped: ${(result.skippedRows || []).length}.`;
      summary.className = `small mt-2 ${result.success ? 'text-success' : 'text-danger'}`;
    }
    showMessage(result.success ? 'Import completed successfully.' : 'Import finished with errors.', result.success ? 'success' : 'warning');
    await loadAssets();
    await window.loadSpareStock();
    if (cmdbState.assetId) {
      await refreshCmdbModal(cmdbState.assetId, cmdbState.activeTab || 'components');
    }
  } catch (error) {
    showMessage(error.message || 'Failed to commit import.', 'error');
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
  const label = document.querySelector('label[for="assetTrackHours"]');
  const hint = document.getElementById('assetTrackHoursHint');
  const telemetryCard = document.getElementById('assetTelemetryCard');
  if (!checkbox) return;

  const canTrack = TRACKABLE_ASSET_TYPES.has(type);
  checkbox.disabled = Boolean(type) && !canTrack;
  if (!canTrack) {
    checkbox.checked = false;
  }

  if (label) {
    label.textContent = canTrack
      ? 'Enable automatic telemetry for lifespan prediction'
      : 'Telemetry monitoring is not applicable for this asset type';
  }

  if (hint) {
    hint.textContent = canTrack
      ? 'When enabled, telemetry starts in waiting-for-signal mode until a real signal arrives.'
      : 'Use inspection/condition updates for this asset type instead of online/offline telemetry.';
  }

  if (telemetryCard) {
    telemetryCard.classList.toggle('telemetry-compact-info', Boolean(type) && !canTrack);
  }
}

function applyAssetTypeSpecTemplate() {
  const specsInput = document.getElementById('assetSpecs');
  const type = document.getElementById('assetType')?.value || '';
  if (!specsInput) return;

  const template = getSpecTemplateForType(type);
  specsInput.placeholder = formatSpecsObject(template);
}

function updateSpecPreviewButtonState() {
  const generateBtn = document.getElementById('assetGenerateSpecsBtn');
  const trustedBtn = document.getElementById('assetSearchTrustedSourcesBtn');

  if (generateBtn) {
    const loadingFast = specPreviewInFlight && specPreviewActiveMode === 'fast_preview';
    generateBtn.disabled = specPreviewInFlight;
    generateBtn.innerHTML = loadingFast
      ? '<span class="spinner-border spinner-border-sm me-1"></span>Generating...'
      : '<i class="bi bi-stars me-1"></i>Generate Specs with AI';
  }

  if (trustedBtn) {
    const loadingTrusted = specPreviewInFlight && specPreviewActiveMode === 'trusted_lookup';
    trustedBtn.disabled = specPreviewInFlight;
    trustedBtn.innerHTML = loadingTrusted
      ? '<span class="spinner-border spinner-border-sm me-1"></span>Searching...'
      : '<i class="bi bi-globe2 me-1"></i>Search Trusted Sources';
  }
}

function invalidateSpecPreviewRequest() {
  specPreviewRequestNonce += 1;
  lastSpecPreviewMeta = {
    sourceType: '',
    evidenceStatus: '',
    confidence: 0,
    requiresReview: true,
  };
}

async function animateSpecsIntoTextarea(textarea, text, nonce) {
  if (!textarea) return;
  const safeText = String(text || '');
  const lines = safeText.split('\n');
  textarea.value = '';
  specPreviewIsWriting = true;
  specPreviewUserIntervened = false;

  const charDelayMs = 22;
  const lineDelayMs = 180;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (let i = 0; i < line.length; i += 1) {
      if (nonce !== specPreviewRequestNonce || specPreviewUserIntervened) {
        specPreviewIsWriting = false;
        return;
      }
      textarea.value += line[i];
      await new Promise((resolve) => setTimeout(resolve, charDelayMs));
    }

    if (lineIndex < lines.length - 1) {
      if (nonce !== specPreviewRequestNonce || specPreviewUserIntervened) {
        specPreviewIsWriting = false;
        return;
      }
      textarea.value += '\n';
      await new Promise((resolve) => setTimeout(resolve, lineDelayMs));
    }
  }
  specPreviewIsWriting = false;
}

function buildSpecPreviewPayload() {
  const type = document.getElementById('assetType')?.value || '';
  const name = document.getElementById('assetName')?.value.trim() || '';
  const brand = document.getElementById('assetBrand')?.value.trim() || '';
  const model = document.getElementById('assetVersion')?.value.trim() || '';
  const currentSpecsText = document.getElementById('assetSpecs')?.value || '';
  const currentSpecs = parseSpecsText(currentSpecsText);

  return {
    name,
    type,
    brand,
    model,
    currentSpecsText,
    currentSpecs
  };
}

async function requestSpecNormalization(payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await inventoryRequest('/assets/spec-normalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (_error) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestSpecSanityCheck(payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await inventoryRequest('/assets/spec-sanity-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (_error) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runSpecPreviewRequest(mode = 'cache_only') {
  const specsInput = document.getElementById('assetSpecs');
  const submitBtn = document.querySelector('#addAssetForm button[type="submit"]');
  const payload = buildSpecPreviewPayload();
  if (specPreviewInFlight) return;

  if (!payload.type) {
    showMessage('Please select an asset type before generating specs.', 'warning');
    return;
  }

  if (!payload.brand && !payload.model && !payload.name) {
    showMessage('Enter at least asset name, brand, or model before generating specs.', 'warning');
    return;
  }

  const currentText = String(specsInput?.value || '').trim();
  const currentPlaceholder = String(specsInput?.placeholder || '');
  if (currentText && !isSpecsPlaceholderLike(currentText, currentPlaceholder)) {
    const overwrite = window.confirm('Technical Specs already contain text. Replace with AI-generated specs?');
    if (!overwrite) return;
  }

  const isTrustedLookup = mode === 'live_allowed';
  const previewMode = isTrustedLookup ? 'trusted_lookup' : 'fast_preview';
  const timeoutMs = isTrustedLookup ? 105000 : 9000;
  const requestNonce = specPreviewRequestNonce + 1;
  specPreviewRequestNonce = requestNonce;
  specPreviewInFlight = true;
  specPreviewActiveMode = previewMode;
  specPreviewUserIntervened = false;
  updateSpecPreviewButtonState();
  if (submitBtn && !isTrustedLookup) submitBtn.disabled = true;
  setSpecPreviewStatus(isTrustedLookup ? 'Searching trusted sources...' : 'Checking saved specs...', 'muted');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const progressTimers = [];
  if (isTrustedLookup) {
    progressTimers.push(setTimeout(() => {
      if (requestNonce === specPreviewRequestNonce && specPreviewInFlight) {
        setSpecPreviewStatus('Ranking candidates...', 'muted');
      }
    }, 2500));
    progressTimers.push(setTimeout(() => {
      if (requestNonce === specPreviewRequestNonce && specPreviewInFlight) {
        setSpecPreviewStatus('Fetching source page...', 'muted');
      }
    }, 9000));
    progressTimers.push(setTimeout(() => {
      if (requestNonce === specPreviewRequestNonce && specPreviewInFlight) {
        setSpecPreviewStatus('Extracting specs from source...', 'muted');
      }
    }, 18000));
    progressTimers.push(setTimeout(() => {
      if (requestNonce === specPreviewRequestNonce && specPreviewInFlight) {
        setSpecPreviewStatus('Saving result for future use...', 'muted');
      }
    }, 30000));
  } else {
    progressTimers.push(setTimeout(() => {
      if (requestNonce === specPreviewRequestNonce && specPreviewInFlight) {
        setSpecPreviewStatus('Checking source cache...', 'muted');
      }
    }, 500));
  }

  try {
    const endpoint = isTrustedLookup ? '/assets/spec-source-lookup' : '/assets/spec-preview';
    const requestBody = isTrustedLookup
      ? {
        assetType: payload.type,
        brand: payload.brand,
        model: payload.model || payload.name,
        forceRefresh: false,
      }
      : {
        ...payload,
        liveLookupMode: 'cache_only',
      };
    const response = await inventoryRequest(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || 'AI spec preview request failed');
    }

    const rawResponse = await response.json();
    const preview = isTrustedLookup
      ? {
        ...rawResponse,
        sourceUrls: rawResponse.sourceUrl ? [rawResponse.sourceUrl] : [],
      }
      : rawResponse;
    if (requestNonce !== specPreviewRequestNonce) return;

    if (isTrustedLookup && !preview.success) {
      const reason = String(preview.message || preview.evidenceReason || 'No trusted source result was confirmed.').trim();
      setSpecPreviewStatus(`${reason} You can continue with current specs or try again later.`, 'warning');
      showMessage(reason, 'warning');
      return;
    }

    const normalizedSpecs = (preview.normalizedSpecs && typeof preview.normalizedSpecs === 'object')
      ? preview.normalizedSpecs
      : {};
    if (isTrustedLookup && !Object.keys(normalizedSpecs).length) {
      const reason = String(preview.message || preview.evidenceReason || 'Trusted sources were found, but no usable specs were extracted.').trim();
      setSpecPreviewStatus(`${reason} You can continue with the current specs.`, 'warning');
      showMessage(reason, 'warning');
      return;
    }
    const fallbackTemplate = getSpecTemplateForType(payload.type);
    let specsText = String(preview.specsText || '').trim() || formatSpecsObject(
      Object.keys(normalizedSpecs).length ? normalizedSpecs : fallbackTemplate
    );
    let normalizationWarnings = [];
    const normalizeResponse = await requestSpecNormalization({
      assetType: payload.type,
      brand: payload.brand,
      model: payload.model,
      rawSpecsText: specsText,
      currentSpecs: normalizedSpecs,
    });
    if (normalizeResponse && requestNonce === specPreviewRequestNonce) {
      const normalizedText = String(normalizeResponse.normalizedSpecsText || '').trim();
      if (normalizedText) {
        specsText = normalizedText;
      }
      normalizationWarnings = Array.isArray(normalizeResponse.warnings) ? normalizeResponse.warnings.filter(Boolean) : [];
    }

    if (isTrustedLookup) {
      setSpecPreviewStatus('Saving result for future use...', 'muted');
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    setSpecPreviewStatus('Writing specs...', 'muted');
    await animateSpecsIntoTextarea(specsInput, specsText, requestNonce);
    if (specPreviewUserIntervened || requestNonce !== specPreviewRequestNonce) {
      if (specPreviewUserIntervened) {
        setSpecPreviewStatus('Stopped AI writing because you edited specs manually.', 'warning');
      }
      return;
    }
    updateInferredQualityPreview();

    const confidencePercent = Math.round((Number(preview.confidence || 0) || 0) * 100);
    const evidenceStatus = String(preview.evidenceStatus || '').toLowerCase();
    const sourceEvidenceStatus = String(preview.sourceEvidenceStatus || '').toLowerCase();
    const reason = String(preview.evidenceReason || preview.reason || '').trim();
    const extraWarnings = Array.isArray(preview.warnings) ? preview.warnings.filter(Boolean) : [];
    const combinedWarnings = [...extraWarnings, ...normalizationWarnings].filter(Boolean);
    const sourceType = String(preview.sourceType || '').trim();
    const sourceDomain = String(preview.sourceDomain || '').trim();
    const sourceUrl = Array.isArray(preview.sourceUrls) && preview.sourceUrls.length ? String(preview.sourceUrls[0] || '').trim() : '';
    const cacheHit = Boolean(preview.cacheHit);
    const warningText = combinedWarnings.length ? ` ${combinedWarnings[0]}` : '';
    lastSpecPreviewMeta = {
      sourceType,
      evidenceStatus,
      confidence: Number(preview.confidence || 0) || 0,
      requiresReview: Boolean(preview.requiresReview),
    };

    if (evidenceStatus === 'trusted' || sourceEvidenceStatus === 'source_backed') {
      const sourceLabel = sourceDomain || sourceType || 'trusted_source_lookup';
      const sourceDetail = sourceUrl ? ` ${sourceUrl}` : '';
      const cacheLabel = cacheHit ? 'cache hit' : 'live lookup';
      setSpecPreviewStatus(
        `Source-backed specs found (${confidencePercent}% confidence, ${cacheLabel}) via ${sourceLabel}.${sourceDetail} Review/edit before create.${warningText}`,
        'success'
      );
    } else if (evidenceStatus === 'user_confirmed' && preview.requiresReview !== true) {
      setSpecPreviewStatus(
        `Using previously user-confirmed specs (${confidencePercent}% confidence). Source: ${sourceType || 'user_confirmed_previous_asset'}. Review/edit before create.${warningText}`,
        'success'
      );
    } else {
      const noSourceReason = normalizeValue(reason).includes('no trusted') || normalizeValue(reason).includes('cache') || normalizeValue(reason).includes('insufficient');
      if (noSourceReason) {
        setSpecPreviewStatus(
          `No trusted source found; using safe fallback. ${reason || 'Please review and edit specs before create.'}${warningText}`,
          'warning'
        );
        return;
      }
      setSpecPreviewStatus(
        `AI generated specs require review (${confidencePercent}% confidence). ${reason || 'No trusted source evidence; please verify.'}${warningText}`,
        'warning'
      );
    }
  } catch (error) {
    if (requestNonce === specPreviewRequestNonce) {
      const isAbort = String(error?.name || '').toLowerCase() === 'aborterror';
      if (isTrustedLookup && isAbort) {
        setSpecPreviewStatus('Trusted source lookup is taking longer than expected. You can continue with the current specs or try again later.', 'warning');
        showMessage('Trusted source lookup is taking longer than expected. You can continue with the current specs or try again later.', 'warning');
      } else if (!isTrustedLookup && isAbort) {
        setSpecPreviewStatus('Fast AI preview timed out. You can continue with current/manual specs.', 'warning');
        showMessage('Fast AI preview timed out. You can continue with current/manual specs.', 'warning');
      } else {
        setSpecPreviewStatus('Spec preview is temporarily unavailable. You can still edit and create the asset.', 'warning');
        showMessage(error.message || 'Failed to generate spec preview.', 'warning');
      }
    }
  } finally {
    clearTimeout(timeoutId);
    progressTimers.forEach((timer) => clearTimeout(timer));
    specPreviewIsWriting = false;
    specPreviewInFlight = false;
    specPreviewActiveMode = 'idle';
    updateSpecPreviewButtonState();
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function handleGenerateSpecsPreview() {
  return runSpecPreviewRequest('cache_only');
}

async function handleSearchTrustedSourcesPreview() {
  return runSpecPreviewRequest('live_allowed');
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
  if (!INVENTORY_ACCESS.canTransferAsset) {
    showMessage('Only admins and senior technicians can transfer assets.', 'error');
    return;
  }

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
    const transferAssetQuantity = async (assetId, destType, destination, quantityToMove, label) => {
      const transferData = { destType, destination, quantityToMove };
      const response = await fetch(`${API_URL}/assets/${assetId}/transfer`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transferData),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || `${label} transfer failed for ${assetId}`);
      }
    };

    if (!isBulk) {
      const selectedAsset = currentAssets.find(a => a.customId === selectedAssetCustomId);
      const maxQuantity = getAssetQuantity(selectedAsset);
      if (quantity > maxQuantity) {
        throw new Error(`Only ${maxQuantity} unit(s) are available to transfer.`);
      }
      if (buildingChecked) {
        const transferData = { destType: 'building', destination: buildingValue, quantityToMove: quantity };
        const response = await inventoryRequest(`/assets/${selectedAssetCustomId}/transfer`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(transferData),
        });
        if (!response.ok) throw new Error((await response.json()).message || 'Building transfer failed');
      }

      if (deptChecked) {
        const transferData = { destType: 'department', destination: deptValue, quantityToMove: quantity };
        const response = await inventoryRequest(`/assets/${selectedAssetCustomId}/transfer`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(transferData),
        });
        if (!response.ok) throw new Error((await response.json()).message || 'Department transfer failed');
      }
    } else {
      const groupAssets = currentAssets.filter(a => a.name === selectedAssetCustomId);
      const maxQuantity = getAssetsTotalQuantity(groupAssets);
      if (quantity > maxQuantity) {
        throw new Error(`Only ${maxQuantity} unit(s) are available to transfer.`);
      }

      let remainingQuantity = quantity;
      for (const asset of groupAssets) {
        if (remainingQuantity <= 0) break;
        const quantityToMove = Math.min(remainingQuantity, getAssetQuantity(asset));
        if (buildingChecked) {
          const transferData = { destType: 'building', destination: buildingValue, quantityToMove: 1 };
          const response = await inventoryRequest(`/assets/${asset.customId}/transfer`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(transferData),
          });
          if (!response.ok) throw new Error((await response.json()).message || `Building transfer failed for ${asset.customId}`);
        }

        if (deptChecked) {
          const transferData = { destType: 'department', destination: deptValue, quantityToMove: 1 };
          const response = await inventoryRequest(`/assets/${asset.customId}/transfer`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(transferData),
          });
          if (!response.ok) throw new Error((await response.json()).message || `Department transfer failed for ${asset.customId}`);
        }
        remainingQuantity -= quantityToMove;
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
  const statusLabel = getOperationalStateLabel(profile.telemetryStatus);
  const telemetryReason = profile.telemetryReason || 'Telemetry not connected';
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
            <p class="text-muted small mb-3">Live status is computed from real telemetry when available for <strong>${UI.escapeHTML(customId)}</strong>.</p>
            <div class="inventory-ai-quality-preview mb-3">
              Detected state: ${statusLabel}
            </div>
            <div class="inventory-ai-quality-preview mt-3">
              Current consumption-adjusted hours: ${profile.hasTelemetry ? Math.round(profile.workingHours).toLocaleString() : 'Unavailable'}
            </div>
            <div class="inventory-ai-quality-preview mt-3">
              Confidence: ${String(profile.telemetryConfidence || 'low').toUpperCase()} | Reason: ${UI.escapeHTML(telemetryReason)}
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
  if (!INVENTORY_ACCESS.canEditSpecs) {
    showMessage('Only admins and senior technicians can edit specifications.', 'error');
    return;
  }

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
  const serialInput = document.getElementById('editSpecSerialNumber');
  const assetTagInput = document.getElementById('editSpecAssetTag');
  if (serialInput) {
    serialInput.value = isGroupEdit ? '' : (getDisplaySerial(targetAssets[0]) || '');
    serialInput.disabled = Boolean(isGroupEdit);
    serialInput.placeholder = isGroupEdit ? 'Disabled for group edit' : 'Update serial number';
  }
  if (assetTagInput) {
    assetTagInput.value = isGroupEdit ? '' : (getDisplayAssetTag(targetAssets[0]) || '');
    assetTagInput.disabled = Boolean(isGroupEdit);
    assetTagInput.placeholder = isGroupEdit ? 'Disabled for group edit' : 'Update asset tag';
  }
  document.getElementById('editSpecTargetId').value = isGroupEdit ? assetNameOrId : targetAssets[0].customId;

  window._editingGroup = isGroupEdit;
  window._editingAssets = targetAssets;

  const editModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('editSpecsModal'));
  editModal.show();
};

window.saveUpdatedSpecs = async () => {
  if (!INVENTORY_ACCESS.canEditSpecs) {
    showMessage('Only admins and senior technicians can edit specifications.', 'error');
    return;
  }

  const textArea = document.getElementById('editSpecTextArea');
  const specsText = textArea.value;
  const serialInput = document.getElementById('editSpecSerialNumber');
  const assetTagInput = document.getElementById('editSpecAssetTag');
  const saveBtn = document.getElementById('saveSpecsBtn');
  const originalText = saveBtn.innerHTML;

  const specs = parseSpecsText(specsText);

  try {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving...';

    const assetsToUpdate = window._editingAssets || [];
    for (const asset of assetsToUpdate) {
      const isSingleEdit = assetsToUpdate.length === 1 && !window._editingGroup;
      const payload = { specifications: specs };
      if (isSingleEdit && serialInput) payload.serialNumber = serialInput.value.trim() || null;
      if (isSingleEdit && assetTagInput) payload.assetTag = assetTagInput.value.trim() || null;
      const response = await inventoryRequest(`/assets/${asset.customId}/details`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
  const asset = currentAssets.find(a => a.customId === customId);
  const serial = asset ? getDisplaySerial(asset) : '';
  const assetTag = asset ? getDisplayAssetTag(asset) : '';
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
  infoDiv.innerHTML = `
    <strong>${customId}</strong>
    ${serial ? `<div class="small text-muted mt-1">Serial: ${UI.escapeHTML(serial)}</div>` : ''}
    ${assetTag ? `<div class="small text-muted">Tag: ${UI.escapeHTML(assetTag)}</div>` : ''}
  `;
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
              <div class="label-info">SN: ${UI.escapeHTML(getDisplaySerial(asset) || 'N/A')}</div>
              ${getDisplayAssetTag(asset) ? `<div class="label-info">Tag: ${UI.escapeHTML(getDisplayAssetTag(asset))}</div>` : ''}
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
      `Serial Number: ${getDisplaySerial(asset) || 'Missing'}`,
      `Asset Tag: ${getDisplayAssetTag(asset) || 'N/A'}`,
      `Type: ${formatType(asset.type)}`,
      `Location: ${displayLocation(asset.location)}`,
      `Department: ${displayDepartment(asset.department)}`,
      `Status: ${displayStatus(asset.status)}`,
      `Brand: ${profile.brand || 'N/A'}`,
      `Version: ${profile.version || 'N/A'}`,
      `Detected Quality: ${capitalize(profile.quality)}`,
      `Device State: ${profile.trackWorkingHours ? getOperationalStateLabel(profile.telemetryStatus) : 'Not monitored'}`,
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

    if (!eol.isClosedLifecycle && eol.procurementRecommended && !eol.lowConfidence) {
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
