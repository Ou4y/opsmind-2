import UI from '/assets/js/ui.js';
import AuthService from '/services/authService.js';

// Config is set as globals in config.js (loaded in HTML head)
const API_URL = window.OPSMIND_INVENTORY_API_URL || 'http://localhost:5000/api';
const INVENTORY_AI_URL = window.OPSMIND_INVENTORY_AI_API_URL || 'http://localhost:8002';
const AUTO_REFRESH_INTERVAL_MS = 60 * 1000;
const AUTO_REFRESH_PREF_KEY = 'opsmind_auto_refresh_enabled';

// Define configuration variables globally so the rest of the script can use them
let BUILDINGS = [];
let DEPARTMENTS = [];
let ASSET_TYPES = [];
let EOL_METRICS = {};
let COMPONENT_TYPE_REGISTRY_BY_PARENT = {};
let ACCESSORY_TYPES = [];
let CONSUMABLE_TYPES = [];
let SPARE_STOCK_TYPES = [];
let LICENSE_TYPES = [];
const STANDARD_MIU_DEPARTMENTS = [
  'Computer Science',
  'Business',
  'Mass Communication',
  'Pharmacy',
  'Dentistry',
  'Engineering',
  'Architecture',
  'ALSUN',
  'Unassigned',
];
const DEPARTMENT_BACKEND_LABEL_OVERRIDES = {
  'Mass Communication': 'Mass Comm',
  ALSUN: 'Alsun',
};
const INVENTORY_FILTER_SNAPSHOT_TTL_MS = 45 * 1000;
const INVENTORY_AI_LONG_WAIT_MS = 5000;

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
let activeDetailsContext = null;
let bulkSpecReviewContext = null;
let bulkSpecActionInFlight = false;
let spareStockItemsCache = [];
let spareStockLowOnly = false;
let currentInventoryView = 'parents';
const INVENTORY_VIEWS = ['parents', 'components', 'accessories', 'consumables', 'spare_stock', 'licenses'];
const INVENTORY_VIEW_BUTTON_IDS = {
  parents: 'inventoryParentAssetsViewBtn',
  components: 'inventoryComponentsViewBtn',
  accessories: 'inventoryAccessoriesViewBtn',
  consumables: 'inventoryConsumablesViewBtn',
  spare_stock: 'inventorySpareStockViewBtn',
  licenses: 'inventoryLicensesViewBtn',
};
const INVENTORY_SAVED_VIEWS = [
  { value: 'all', label: 'All Assets', description: 'No saved-view filter.' },
  { value: 'low_stock', label: 'Low Stock', description: 'Spare stock or consumables at/below reorder level.' },
  { value: 'needs_review', label: 'Needs Review', description: 'Missing data, lifecycle, risk, or relationship issues.' },
  { value: 'high_risk', label: 'High Risk', description: 'EOL, maintenance, retired, lost, or failed signals.' },
  { value: 'missing_data', label: 'Missing Data', description: 'Missing serial, location, department, purchase, or warranty evidence.' },
  { value: 'recently_imported', label: 'Recently Imported', description: 'Created or updated in the last 14 days.' },
  { value: 'eol_soon', label: 'EOL Soon', description: 'Lifecycle or warranty evidence suggests replacement planning.' },
  { value: 'unassigned', label: 'Unassigned', description: 'Department, owner, or assignment is missing/unassigned.' },
  { value: 'linked_component_issues', label: 'Linked Components Issues', description: 'Components/accessories/licenses without a clear parent relationship.' },
];
const CMDB_MODAL_ID = 'inventoryCmdbModal';
const GROUP_CMDB_MODAL_ID = 'inventoryGroupCmdbModal';
let cmdbState = {
  assetId: null,
  activeTab: 'components',
};
let groupCmdbState = {
  groupName: '',
  activeTab: 'components',
  selectedAssetIds: [],
  searchText: '',
};
let importPreviewCache = null;
let importAiRepairState = {
  suggestions: [],
  beforeMetrics: null,
  lastApplySummary: '',
};
const INVENTORY_GROUP_PAGE_SIZE = 50;
let inventoryGroupRenderLimit = INVENTORY_GROUP_PAGE_SIZE;
let inventoryPageState = {
  page: 1,
  pageSize: 50,
  total: 0,
  totalPages: 1,
  loadedAt: 0,
  refreshTimer: null,
  refreshing: false,
};
let transferSelectionState = {
  targetAssetIds: [],
  isBulk: false,
};
let searchDebounceTimer = null;
let inventorySavedView = localStorage.getItem('opsmind_inventory_saved_view') || 'all';
let historyViewState = {
  assetId: null,
  includeRelated: true,
};
let inventoryAiState = {
  mode: 'assistant',
};
let inventoryAiChatState = {
  open: false,
  messages: [],
  loading: false,
  loadingSince: null,
  status: 'gemma',
  promptsCollapsed: null,
};
const cmdbAiInFlightActions = new Set();
let importAiHeaderMappings = null;
let lastImportCommitMeta = null;
let loanerBoardRows = [];
let auditBoardRows = [];
let procurementBoardState = {
  board: null,
  loading: false,
};
let inventory360AnalyticsState = {
  board: null,
  loading: false,
  inFlightPromise: null,
  loadedAt: 0,
};
let bulkCheckoutValidationRows = [];
let inventoryFilterSnapshotState = {
  loading: false,
  inFlightPromise: null,
  allAssets: [],
  spareStockRows: [],
  loadedAt: 0,
};
const INVENTORY_MAP_IMAGE_PATH = '/assets/images/miu-campus-map.png';
const INVENTORY_MAP_DEFAULT_PAGE_SIZE = 500;
const INVENTORY_MAP_LANDSCAPE_MODE = 'clockwise';
const INVENTORY_MAP_FLIP_CURRENT_HORIZONTAL_180 = true;
const INVENTORY_MAP_COORDINATE_MODE = 'display';
// Coordinate tuning note:
// Coordinates below are in FINAL DISPLAY SPACE (what users see in the horizontal map):
// xPercent: left -> right, yPercent: top -> bottom.
// We keep image rotation for visual orientation, but marker placement uses these
// display coordinates directly (no extra projection math).
const INVENTORY_MAP_LOCATION_DEFINITIONS = [
  {
    key: 'central_warehouse',
    name: 'Central Warehouse',
    xPercent: 92,
    yPercent: 76,
    aliases: ['central warehouse', 'central_warehouse', 'warehouse', 'main warehouse', 'warehouse staging'],
  },
  {
    key: 'main',
    name: 'Main Building',
    xPercent: 88,
    yPercent: 58,
    aliases: ['main', 'main building', 'building main', 'main_building'],
  },
  {
    key: 'k',
    name: 'K Building',
    xPercent: 86,
    yPercent: 23,
    aliases: ['k', 'k building', 'building k', 'k_building'],
  },
  {
    key: 'r',
    name: 'R Building',
    xPercent: 12,
    yPercent: 25,
    aliases: ['r', 'r building', 'building r', 'r_building'],
  },
  {
    key: 'n',
    name: 'N Building',
    xPercent: 38,
    yPercent: 80,
    aliases: ['n', 'n building', 'building n', 'n_building'],
  },
  {
    key: 's',
    name: 'S Building',
    xPercent: 39,
    yPercent: 43,
    aliases: ['s', 's building', 'building s', 's_building'],
  },
  {
    key: 'pharmacy',
    name: 'Pharmacy Building',
    xPercent: 60,
    yPercent: 23,
    aliases: ['pharmacy', 'pharmacy building', 'pharmacy_building'],
  },
  {
    key: 'copy_center',
    name: 'Copy Center',
    xPercent: 60,
    yPercent: 83,
    aliases: ['copy center', 'copycenter', 'copy-center', 'copy_centre', 'copy_center'],
  },
  {
    key: 'mosque',
    name: 'Mosque',
    xPercent: 56,
    yPercent: 83,
    aliases: ['mosque'],
  },
  {
    key: 'workshop',
    name: 'Workshop',
    xPercent: 4,
    yPercent: 52,
    aliases: ['workshop'],
  },
];
const INVENTORY_MAP_LOCATION_INDEX = INVENTORY_MAP_LOCATION_DEFINITIONS.reduce((acc, entry) => {
  const aliasSet = new Set([entry.name, ...(entry.aliases || [])]);
  aliasSet.forEach((alias) => {
    acc.set(String(alias || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ''), entry);
  });
  return acc;
}, new Map());
let inventoryMapState = {
  loading: false,
  allAssets: [],
  filteredAssets: [],
  groupedMarkers: [],
  selectedLocationKey: null,
  mapImageReady: false,
  mapImageMissing: false,
  canvasSize: { width: 0, height: 0 },
};
let inventoryMapCalibrationState = {
  enabled: false,
  draggingKey: null,
  selectedKey: null,
  draftByKey: new Map(),
};

function getInventoryMapDisplayRotation() {
  let rotation = 0;
  if (INVENTORY_MAP_LANDSCAPE_MODE === 'clockwise') rotation = 90;
  if (INVENTORY_MAP_LANDSCAPE_MODE === 'counterclockwise') rotation = 270;
  if (INVENTORY_MAP_FLIP_CURRENT_HORIZONTAL_180) rotation += 180;
  const normalized = ((rotation % 360) + 360) % 360;
  return normalized;
}

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
  DESKTOP_PC: 'desktop',
  PC: 'desktop',
  WORKSTATION: 'desktop',
  THIN_CLIENT: 'desktop',
  LAB_COMPUTER: 'desktop',
  LIBRARY_PC: 'desktop',
  TABLET: 'tablet',
  IPAD: 'tablet',
  SERVER: 'server',
  NAS_STORAGE: 'server',
  NVR_DVR: 'server',
  MONITOR: 'monitor',
  PERIPHERAL: 'peripheral',
  EXTERNAL_STORAGE_DEVICE: 'peripheral',
  KEYBOARD: 'keyboard',
  ELECTRONICS: 'electronics',
  UPS: 'electronics',
  BIOMETRIC_ATTENDANCE_DEVICE: 'electronics',
  IP_PHONE: 'electronics',
  PROJECTOR: 'projector',
  SMARTBOARD: 'smartboard',
  INTERACTIVE_DISPLAY: 'smartboard',
  CAMERA: 'camera',
  CCTV_CAMERA: 'camera',
  DOCUMENT_CAMERA: 'camera',
  LECTURE_CAPTURE_DEVICE: 'camera',
  SPEAKER: 'speaker',
  SPEAKER_SYSTEM: 'speaker',
  AMPLIFIER: 'speaker',
  MICROPHONE: 'microphone',
  ROUTER: 'router',
  SWITCH: 'switch',
  NETWORK_SWITCH: 'switch',
  ACCESS_POINT: 'access_point',
  FIREWALL: 'firewall',
  FIREWALL_APPLIANCE: 'firewall',
  PRINTER: 'printer',
  PHOTOCOPIER: 'printer',
  SCANNER: 'scanner',
  BARCODE_SCANNER: 'scanner',
  RFID_READER: 'scanner',
  BOOK_SCANNER: 'scanner',
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
  MAIN: 'Main Building',
  MAIN_BUILDING: 'Main Building',
  K: 'K Building',
  K_BUILDING: 'K Building',
  N: 'N Building',
  N_BUILDING: 'N Building',
  S: 'S Building',
  S_BUILDING: 'S Building',
  R: 'R Building',
  R_BUILDING: 'R Building',
  PHARMACY: 'Pharmacy Building',
  PHARMACY_BUILDING: 'Pharmacy Building',
  COPY_CENTER: 'Copy Center',
  COPYCENTER: 'Copy Center',
  COPY_CENTRE: 'Copy Center',
  MOSQUE: 'Mosque',
  WORKSHOP: 'Workshop',
  IT_STORE: 'IT Store',
  COMPUTER_LAB_A: 'Computer Lab A',
};

const DEPARTMENT_ALIASES = {
  COMPUTER_SCIENCE: 'Computer Science',
  ENGINEERING: 'Engineering',
  ARCHITECTURE: 'Architecture',
  BUSINESS: 'Business',
  MASS_COMM: 'Mass Communication',
  ALSUN: 'ALSUN',
  PHARMACY: 'Pharmacy',
  DENTISTRY: 'Dentistry',
  UNASSIGNED: 'Unassigned',
  GENERAL: 'General'
};

function normalizeValue(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function formatCurrencyEGP(value, options = {}) {
  if (value === null || typeof value === 'undefined' || String(value).trim() === '') return options.missingLabel || 'Cost data missing';
  const amount = Number(value);
  const allowZero = options.allowZero !== false;
  if (!Number.isFinite(amount) || (!allowZero && amount <= 0)) return options.missingLabel || 'Cost data missing';
  return new Intl.NumberFormat('en-EG', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatRelativeTime(value) {
  if (!value) return 'not updated yet';
  const timestamp = typeof value === 'number' ? value : new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'not updated yet';
  const diffSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (diffSeconds < 45) return 'just now';
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  return new Date(timestamp).toLocaleString();
}

function isAutoRefreshEnabled() {
  return String(localStorage.getItem(AUTO_REFRESH_PREF_KEY) || 'true').toLowerCase() !== 'false';
}

function shouldPauseInventoryAutoRefresh() {
  if (document.visibilityState === 'hidden') return true;
  if (document.querySelector('.modal.show')) return true;
  const active = document.activeElement;
  if (!active) return false;
  const tag = String(active.tagName || '').toLowerCase();
  return ['input', 'textarea', 'select'].includes(tag) || active.isContentEditable;
}

function canonicalType(type) {
  const raw = String(type || '').trim();
  if (!raw) return '';
  const normalized = raw.toUpperCase().replace(/[\s-]+/g, '_');
  return TYPE_ALIASES[normalized] || raw.toLowerCase().replace(/[\s-]+/g, '_');
}

function displayLocation(location) {
  const raw = String(location || '');
  return LOCATION_ALIASES[raw.toUpperCase()] || raw || 'Unknown';
}

function getAssetDisplayLocation(asset, options = {}) {
  const source = asset && typeof asset === 'object' ? asset : {};
  const specs = getAssetSpecs(source);
  const preferInstalledParent = options.preferInstalledParent === true;
  const candidates = [];
  if (preferInstalledParent && source?.installedParentLocation) candidates.push(source.installedParentLocation);
  candidates.push(
    specs?.mapLocationHint,
    specs?.mapLocation,
    specs?.importedLocation,
    source?.location
  );
  for (const candidate of candidates) {
    const raw = String(candidate || '').trim();
    if (!raw) continue;
    const label = displayLocation(raw);
    if (label && normalizeValue(label) !== 'unknown') return label;
  }
  return 'Unknown';
}

function getAssetDisplayDepartment(asset, options = {}) {
  const source = asset && typeof asset === 'object' ? asset : {};
  const preferInstalledParent = options.preferInstalledParent === true;
  const candidate = preferInstalledParent && source?.installedParentDepartment
    ? source.installedParentDepartment
    : source?.department;
  return displayDepartment(candidate);
}

function normalizeInventoryMapToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isExactTokenBoundaryMatch(normalizedValue, aliasNorm) {
  if (!normalizedValue || !aliasNorm) return false;
  if (normalizedValue === aliasNorm) return true;
  if (!normalizedValue.startsWith(aliasNorm) && !normalizedValue.endsWith(aliasNorm)) return false;
  if (normalizedValue.startsWith(aliasNorm)) {
    const nextChar = normalizedValue.charAt(aliasNorm.length);
    if (!nextChar) return true;
    return /[0-9]/.test(nextChar);
  }
  if (normalizedValue.endsWith(aliasNorm)) {
    const prevIndex = normalizedValue.length - aliasNorm.length - 1;
    const prevChar = normalizedValue.charAt(prevIndex);
    if (!prevChar) return true;
    return /[0-9]/.test(prevChar);
  }
  return false;
}

function resolveInventoryMapLocation(locationValue) {
  const raw = String(locationValue || '').trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const normalized = normalizeInventoryMapToken(cleaned);
  if (!normalized) return null;

  const direct = INVENTORY_MAP_LOCATION_INDEX.get(normalized);
  if (direct) {
    return {
      ...direct,
      matchedAlias: cleaned,
      matchMethod: 'exact',
    };
  }

  let best = null;
  let bestScore = -1;
  for (const entry of INVENTORY_MAP_LOCATION_DEFINITIONS) {
    const aliases = [entry.name, ...(entry.aliases || [])];
    for (const alias of aliases) {
      const aliasRaw = String(alias || '').trim();
      const aliasNorm = normalizeInventoryMapToken(alias);
      if (!aliasNorm) continue;
      if (aliasNorm.length <= 4) {
        if (normalized === aliasNorm) {
          if (bestScore < 4) {
            best = { ...entry, matchedAlias: aliasRaw, matchMethod: 'exact_short' };
            bestScore = 4;
          }
        }
        continue;
      }
      if (normalized === aliasNorm) {
        if (bestScore < 4) {
          best = { ...entry, matchedAlias: aliasRaw, matchMethod: 'exact' };
          bestScore = 4;
        }
        continue;
      }
      if (isExactTokenBoundaryMatch(normalized, aliasNorm)) {
        if (bestScore < 3) {
          best = { ...entry, matchedAlias: aliasRaw, matchMethod: 'boundary' };
          bestScore = 3;
        }
        continue;
      }
      if (aliasNorm.length >= 6 && normalized.includes(aliasNorm)) {
        if (bestScore < 2) {
          best = { ...entry, matchedAlias: aliasRaw, matchMethod: 'contains' };
          bestScore = 2;
        }
      }
    }
  }
  if (best) return best;
  return null;
}

function updateInventoryMapCanvasLayout() {
  const wrapEl = document.querySelector('.inventory-map-canvas-wrap');
  const canvasEl = document.getElementById('inventoryAssetMapCanvas');
  const imageEl = document.getElementById('inventoryAssetMapImage');
  const markerLayer = document.getElementById('inventoryAssetMapMarkers');
  if (!wrapEl || !canvasEl || !imageEl || !markerLayer) return;
  const naturalWidth = Number(imageEl.naturalWidth || 0);
  const naturalHeight = Number(imageEl.naturalHeight || 0);
  if (!naturalWidth || !naturalHeight) return;

  const availableWidth = Math.max(220, Math.floor(wrapEl.clientWidth - 12));
  const availableHeight = Math.max(220, Math.floor(wrapEl.clientHeight - 12));
  const rotation = getInventoryMapDisplayRotation();
  const isLandscape = rotation === 90 || rotation === 270;
  const effectiveWidth = isLandscape ? naturalHeight : naturalWidth;
  const effectiveHeight = isLandscape ? naturalWidth : naturalHeight;
  const imageRatio = effectiveWidth / effectiveHeight;

  let targetWidth = availableWidth;
  let targetHeight = Math.round(targetWidth / imageRatio);
  if (targetHeight > availableHeight) {
    targetHeight = availableHeight;
    targetWidth = Math.round(targetHeight * imageRatio);
  }

  canvasEl.style.width = `${targetWidth}px`;
  canvasEl.style.height = `${targetHeight}px`;
  imageEl.style.setProperty('--inventory-map-image-rotation', `${rotation}deg`);
  if (isLandscape) {
    imageEl.style.width = `${targetHeight}px`;
    imageEl.style.height = `${targetWidth}px`;
  } else {
    imageEl.style.width = `${targetWidth}px`;
    imageEl.style.height = `${targetHeight}px`;
  }
  markerLayer.style.width = '100%';
  markerLayer.style.height = '100%';
  inventoryMapState.canvasSize = { width: targetWidth, height: targetHeight };
  window.renderInventoryMapCalibrationMarkers?.();
}

function projectInventoryMapCoordinates(xPercent, yPercent) {
  const x = Number(xPercent);
  const y = Number(yPercent);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (INVENTORY_MAP_COORDINATE_MODE === 'display') {
    return { xPercent: x, yPercent: y };
  }
  const rotation = getInventoryMapDisplayRotation();
  if (rotation === 90) return { xPercent: y, yPercent: 100 - x };
  if (rotation === 180) return { xPercent: 100 - x, yPercent: 100 - y };
  if (rotation === 270) return { xPercent: 100 - y, yPercent: x };
  return { xPercent: x, yPercent: y };
}

function unprojectInventoryMapCoordinates(displayXPercent, displayYPercent) {
  const x = Number(displayXPercent);
  const y = Number(displayYPercent);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (INVENTORY_MAP_COORDINATE_MODE === 'display') {
    return { xPercent: x, yPercent: y };
  }
  const rotation = getInventoryMapDisplayRotation();
  if (rotation === 90) return { xPercent: 100 - y, yPercent: x };
  if (rotation === 180) return { xPercent: 100 - x, yPercent: 100 - y };
  if (rotation === 270) return { xPercent: y, yPercent: 100 - x };
  return { xPercent: x, yPercent: y };
}

function getMapLocationDefinitionByKey(locationKey) {
  return INVENTORY_MAP_LOCATION_DEFINITIONS.find((entry) => entry.key === locationKey) || null;
}

function getCalibrationBaseCoordinates(locationKey) {
  const draft = inventoryMapCalibrationState.draftByKey.get(locationKey);
  if (draft && Number.isFinite(Number(draft.xPercent)) && Number.isFinite(Number(draft.yPercent))) {
    return {
      xPercent: Number(draft.xPercent),
      yPercent: Number(draft.yPercent),
    };
  }
  const definition = getMapLocationDefinitionByKey(locationKey);
  if (!definition) return null;
  return {
    xPercent: Number(definition.xPercent),
    yPercent: Number(definition.yPercent),
  };
}

function inventoryMapViewToCategory(view) {
  const v = String(view || '').trim().toLowerCase();
  if (!v || v === 'all') return 'all';
  if (v === 'spare_parts') return 'spare_stock';
  return v;
}

function shouldTreatMapItemAsNearEol(asset) {
  const lifecycle = String(asset?.lifecycleStatus || '').trim().toLowerCase();
  if (lifecycle.includes('eol') || lifecycle.includes('retired') || lifecycle.includes('disposed')) return true;
  const expiry = asset?.warrantyEndDate ? new Date(asset.warrantyEndDate) : null;
  if (!expiry || Number.isNaN(expiry.getTime())) return false;
  const deltaDays = (expiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  return deltaDays <= 90;
}

function displayDepartment(department) {
  return normalizeDepartmentLabel(department);
}

function normalizeDepartmentLabel(value, options = {}) {
  const fallbackUnassigned = options.fallbackUnassigned !== false;
  const raw = String(value || '').trim();
  if (!raw) return fallbackUnassigned ? 'Unassigned' : '';

  const exactAlias = DEPARTMENT_ALIASES[raw.toUpperCase()];
  if (exactAlias) return exactAlias;

  const normalized = normalizeValue(raw);
  if (!normalized || normalized === 'unknown' || normalized === 'null' || normalized === 'none' || normalized === 'na' || normalized === 'n/a') {
    return fallbackUnassigned ? 'Unassigned' : '';
  }
  if (normalized === 'cs' || normalized === 'computerscience' || normalized === 'computersciences') return 'Computer Science';
  if (normalized === 'business' || normalized === 'businessadmin' || normalized === 'businessadministration') return 'Business';
  if (normalized === 'masscommunication' || normalized === 'masscomm' || normalized === 'masscommunications') return 'Mass Communication';
  if (normalized === 'pharmacy') return 'Pharmacy';
  if (normalized === 'dentistry') return 'Dentistry';
  if (normalized === 'engineering') return 'Engineering';
  if (normalized === 'architecture') return 'Architecture';
  if (normalized === 'alsun' || normalized === 'alalsun' || normalized === 'languages') return 'ALSUN';
  if (normalized === 'unassigned' || normalized === 'unallocate' || normalized === 'unallocated') return 'Unassigned';

  return raw;
}

function toBackendDepartmentFilterValue(value) {
  const canonical = normalizeDepartmentLabel(value);
  return DEPARTMENT_BACKEND_LABEL_OVERRIDES[canonical] || canonical;
}

function normalizeDepartmentForFilter(value) {
  return normalizeValue(normalizeDepartmentLabel(value));
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

function populateAssetTypeSelectOptions() {
  const select = document.getElementById('assetType');
  if (!select) return;
  const entries = Array.isArray(ASSET_TYPES) ? ASSET_TYPES : [];
  if (!entries.length) return;

  const currentValue = String(select.value || '').trim();
  const grouped = new Map();
  entries.forEach((entry) => {
    const category = String(entry?.category || 'Other').trim() || 'Other';
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(entry);
  });

  const html = ['<option value="">Select Asset Type</option>'];
  grouped.forEach((items, category) => {
    html.push(`<optgroup label="${UI.escapeHTML(category)}">`);
    items.forEach((entry) => {
      const value = String(entry?.value || '').trim();
      const label = String(entry?.label || value).trim();
      if (!value) return;
      html.push(`<option value="${UI.escapeHTML(value)}" data-registry-key="${UI.escapeHTML(String(entry?.registryKey || ''))}" data-registry-label="${UI.escapeHTML(label)}">${UI.escapeHTML(label)}</option>`);
    });
    html.push('</optgroup>');
  });

  select.innerHTML = html.join('');
  if (currentValue && Array.from(select.options).some((opt) => opt.value === currentValue)) {
    select.value = currentValue;
  }
}

function normalizeInventoryView(value) {
  const normalizedRaw = String(value || '').trim().toLowerCase();
  const normalized = normalizedRaw === 'spare_parts' ? 'spare_stock' : normalizedRaw;
  return INVENTORY_VIEWS.includes(normalized) ? normalized : 'parents';
}

function getAssetCategoryKey(asset) {
  return String(asset?.category || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function isAccessoryAsset(asset) {
  return getAssetCategoryKey(asset) === 'accessory';
}

function isConsumableAsset(asset) {
  return getAssetCategoryKey(asset) === 'consumable';
}

function isLicenseAsset(asset) {
  return getAssetCategoryKey(asset) === 'license';
}

function isSparePartAsset(asset) {
  return getAssetCategoryKey(asset) === 'spare_part';
}

const TRACKABLE_ASSET_TYPES = new Set([
  'laptop', 'desktop', 'tablet', 'server', 'monitor', 'projector', 'smartboard',
  'camera', 'speaker', 'microphone', 'router', 'switch', 'access_point',
  'firewall', 'printer', 'scanner', 'peripheral', 'nas_storage', 'nvr_dvr',
  'cctv_camera', 'document_camera', 'lecture_capture_device', 'ip_phone',
  'biometric_attendance_device',
  'microscope', 'centrifuge', 'oscilloscope',
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
  insufficient_data: 'Monitoring enabled Â· Waiting for signal',
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
  const canonical = canonicalType(asset?.type);
  const trackWorkingHours = toBoolean(specs.trackWorkingHours) && (
    TRACKABLE_ASSET_TYPES.has(canonical)
    || toBoolean(specs.telemetryEnabled)
    || toBoolean(specs.telemetryApplicable)
  );
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

function sanitizeInventoryFieldId(raw) {
  return String(raw || 'field')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'field';
}

function formatInventoryFieldOptions(options = []) {
  return (Array.isArray(options) ? options : [])
    .map((option) => {
      if (option && typeof option === 'object') {
        const value = String(option.value ?? '').trim();
        const label = String((option.label ?? value) || 'Option').trim() || 'Option';
        return `<option value="${UI.escapeHTML(value)}">${UI.escapeHTML(label)}</option>`;
      }
      const value = String(option ?? '').trim();
      return `<option value="${UI.escapeHTML(value)}">${UI.escapeHTML(value || 'Option')}</option>`;
    })
    .join('');
}

function normalizeInventoryModalFieldValue(field, rawValue) {
  const type = String(field?.type || 'text').toLowerCase();
  if (type === 'checkbox') return Boolean(rawValue);
  if (type === 'number') {
    const value = Number(rawValue);
    return Number.isFinite(value) ? value : null;
  }
  const value = String(rawValue ?? '');
  return field?.trim === false ? value : value.trim();
}

function showInventoryFormModal(options = {}) {
  return new Promise((resolve) => {
    const fields = Array.isArray(options.fields) ? options.fields : [];
    const modalId = `inventoryFormModal-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const title = String(options.title || 'Inventory Action');
    const message = String(options.message || '').trim();
    const messageHtml = String(options.messageHtml || '').trim();
    const confirmText = String(options.confirmText || 'Save');
    const cancelText = String(options.cancelText || 'Cancel');
    const confirmClass = String(options.confirmClass || 'btn-primary');
    const dialogClass = String(options.dialogClass || 'modal-lg');

    const fieldsHtml = fields.map((field, index) => {
      const name = String(field?.name || `field_${index}`).trim();
      const type = String(field?.type || 'text').toLowerCase();
      const colClass = String(field?.colClass || 'col-12');
      const id = `${modalId}-${sanitizeInventoryFieldId(name || `field-${index}`)}-${index}`;
      const label = String(field?.label || name || `Field ${index + 1}`);
      const placeholder = String(field?.placeholder || '');
      const helpText = String(field?.helpText || '');
      const required = Boolean(field?.required);
      const readonly = Boolean(field?.readonly);
      const min = field?.min ?? '';
      const max = field?.max ?? '';
      const step = field?.step ?? '';
      const rows = Number(field?.rows || 3);
      const defaultValue = field?.value;
      const safeValue = defaultValue === null || typeof defaultValue === 'undefined'
        ? ''
        : String(defaultValue);
      const requiredFlag = required ? 'required' : '';
      const readonlyFlag = readonly ? 'readonly' : '';
      const disabledFlag = field?.disabled ? 'disabled' : '';
      const hiddenClass = type === 'hidden' ? 'd-none' : '';

      let inputHtml = '';
      if (type === 'textarea') {
        inputHtml = `
          <textarea
            class="form-control form-control-sm"
            id="${id}"
            name="${UI.escapeHTML(name)}"
            data-field-index="${index}"
            placeholder="${UI.escapeHTML(placeholder)}"
            rows="${Number.isFinite(rows) && rows > 0 ? rows : 3}"
            ${requiredFlag}
            ${readonlyFlag}
            ${disabledFlag}
          >${UI.escapeHTML(safeValue)}</textarea>
        `;
      } else if (type === 'select') {
        const selectOptions = formatInventoryFieldOptions(field?.options || []);
        const includeBlank = !required || placeholder;
        inputHtml = `
          <select
            class="form-select form-select-sm"
            id="${id}"
            name="${UI.escapeHTML(name)}"
            data-field-index="${index}"
            ${requiredFlag}
            ${disabledFlag}
          >
            ${includeBlank ? `<option value="">${UI.escapeHTML(placeholder || 'Select...')}</option>` : ''}
            ${selectOptions}
          </select>
        `;
      } else if (type === 'checkbox') {
        const checked = Boolean(defaultValue) ? 'checked' : '';
        inputHtml = `
          <div class="form-check mt-1">
            <input
              class="form-check-input"
              type="checkbox"
              id="${id}"
              name="${UI.escapeHTML(name)}"
              data-field-index="${index}"
              ${checked}
              ${disabledFlag}
            >
            <label class="form-check-label small" for="${id}">
              ${UI.escapeHTML(label)}
            </label>
          </div>
        `;
      } else {
        inputHtml = `
          <input
            type="${UI.escapeHTML(type || 'text')}"
            class="form-control form-control-sm"
            id="${id}"
            name="${UI.escapeHTML(name)}"
            data-field-index="${index}"
            value="${UI.escapeHTML(safeValue)}"
            placeholder="${UI.escapeHTML(placeholder)}"
            ${min !== '' ? `min="${UI.escapeHTML(String(min))}"` : ''}
            ${max !== '' ? `max="${UI.escapeHTML(String(max))}"` : ''}
            ${step !== '' ? `step="${UI.escapeHTML(String(step))}"` : ''}
            ${requiredFlag}
            ${readonlyFlag}
            ${disabledFlag}
          >
        `;
      }

      return `
        <div class="${UI.escapeHTML(colClass)} ${hiddenClass}" data-field-wrapper="${index}">
          ${type === 'checkbox' ? '' : `<label class="form-label form-label-sm mb-1 fw-semibold" for="${id}">${UI.escapeHTML(label)}${required ? ' *' : ''}</label>`}
          ${inputHtml}
          ${helpText ? `<div class="form-text small">${UI.escapeHTML(helpText)}</div>` : ''}
          <div class="invalid-feedback" id="${id}-feedback"></div>
        </div>
      `;
    }).join('');

    const modalHtml = `
      <div class="modal fade inventory-modal-stack-high" id="${modalId}" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered ${UI.escapeHTML(dialogClass)}">
          <div class="modal-content border-0 shadow">
            <div class="modal-header">
              <h5 class="modal-title fw-bold">${UI.escapeHTML(title)}</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
              ${messageHtml ? `<div class="small text-muted mb-2">${messageHtml}</div>` : (message ? `<div class="small text-muted mb-2">${UI.escapeHTML(message)}</div>` : '')}
              <form id="${modalId}-form" novalidate>
                <div class="row g-2">${fieldsHtml}</div>
              </form>
            </div>
            <div class="modal-footer">
              ${cancelText ? `<button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">${UI.escapeHTML(cancelText)}</button>` : ''}
              <button type="button" class="btn ${UI.escapeHTML(confirmClass)}" id="${modalId}-confirm">${UI.escapeHTML(confirmText)}</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modalElement = document.getElementById(modalId);
    const formElement = document.getElementById(`${modalId}-form`);
    const confirmBtn = document.getElementById(`${modalId}-confirm`);
    const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
    let settled = false;

    const clearError = (fieldIndex) => {
      const input = formElement?.querySelector(`[data-field-index="${fieldIndex}"]`);
      if (input) input.classList.remove('is-invalid');
      const feedback = modalElement?.querySelector(`#${input?.id}-feedback`);
      if (feedback) feedback.textContent = '';
    };

    const setError = (fieldIndex, messageText) => {
      const input = formElement?.querySelector(`[data-field-index="${fieldIndex}"]`);
      if (!input) return;
      input.classList.add('is-invalid');
      const feedback = modalElement?.querySelector(`#${input.id}-feedback`);
      if (feedback) feedback.textContent = String(messageText || 'Required field.');
    };

    confirmBtn?.addEventListener('click', async () => {
      const values = {};
      let hasError = false;
      fields.forEach((field, index) => clearError(index));

      for (let index = 0; index < fields.length; index += 1) {
        const field = fields[index];
        const name = String(field?.name || `field_${index}`).trim();
        const type = String(field?.type || 'text').toLowerCase();
        const input = formElement?.querySelector(`[data-field-index="${index}"]`);
        if (!input) continue;

        const rawValue = type === 'checkbox'
          ? Boolean(input.checked)
          : input.value;
        const normalizedValue = normalizeInventoryModalFieldValue(field, rawValue);
        values[name] = normalizedValue;

        if (field?.required) {
          const missing = type === 'checkbox'
            ? !Boolean(normalizedValue)
            : !String(normalizedValue ?? '').trim();
          if (missing) {
            setError(index, `${field?.label || name} is required.`);
            if (!hasError) input.focus();
            hasError = true;
            continue;
          }
        }

        if (typeof field?.validate === 'function') {
          const errorText = field.validate(normalizedValue, values);
          if (errorText) {
            setError(index, errorText);
            if (!hasError) input.focus();
            hasError = true;
          }
        }
      }

      if (hasError) return;
      settled = true;
      modal.hide();
      resolve({ confirmed: true, values });
    });

    modalElement?.addEventListener('hidden.bs.modal', () => {
      modalElement.remove();
      if (!settled) resolve({ confirmed: false, values: {} });
    }, { once: true });

    modal.show();
    setTimeout(() => {
      const firstInput = modalElement?.querySelector('input,textarea,select');
      if (firstInput && typeof firstInput.focus === 'function') firstInput.focus();
      fields.forEach((field, index) => {
        if (String(field?.type || '').toLowerCase() !== 'select') return;
        const name = String(field?.name || `field_${index}`).trim();
        const input = formElement?.querySelector(`[data-field-index="${index}"]`);
        if (!input) return;
        const raw = field?.value;
        if (raw === null || typeof raw === 'undefined') return;
        const safeValue = String(raw);
        if (Array.from(input.options || []).some((opt) => opt.value === safeValue)) {
          input.value = safeValue;
        } else if (!field?.required) {
          input.value = '';
        }
      });
    }, 20);
  });
}

async function promptInventoryValue(options = {}) {
  const result = await showInventoryFormModal({
    title: options.title || 'Input Required',
    message: options.message || '',
    confirmText: options.confirmText || 'Continue',
    cancelText: options.cancelText || 'Cancel',
    dialogClass: options.dialogClass || 'modal-md',
    fields: [{
      name: 'value',
      label: options.label || 'Value',
      type: options.type || 'text',
      value: options.value ?? '',
      placeholder: options.placeholder || '',
      required: options.required !== false,
      options: options.options || [],
      validate: options.validate,
      rows: options.rows || 3,
      trim: options.trim !== false,
    }],
  });
  if (!result?.confirmed) return null;
  return result.values.value;
}

async function showInventoryTextPreviewModal(options = {}) {
  const result = await showInventoryFormModal({
    title: options.title || 'Details',
    message: options.message || '',
    confirmText: options.confirmText || 'Close',
    cancelText: options.cancelText || '',
    confirmClass: options.confirmClass || 'btn-outline-primary',
    dialogClass: options.dialogClass || 'modal-lg',
    fields: [{
      name: 'preview',
      label: options.label || 'Preview',
      type: 'textarea',
      value: String(options.text || ''),
      rows: Number(options.rows || 10),
      readonly: true,
      required: false,
    }],
  });
  return Boolean(result?.confirmed);
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
  ['transferIncludeRelated', 'transferIncludeComponents', 'transferIncludeAccessories', 'transferIncludeLicenses', 'transferIncludeConsumables'].forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('change', () => {
      updateTransferRelatedFormState();
      refreshTransferRelatedSummary().catch(() => {});
    });
  });
  updateTransferRelatedFormState();

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
  const savedViewSelect = document.getElementById('inventorySavedViewSelect');
  const activeFilterChips = document.getElementById('inventoryActiveFilterChips');
  const inventory360Grid = document.getElementById('inventory360Grid');

  if (buildingFilter) buildingFilter.addEventListener('change', syncFilters);
  if (deptFilter) deptFilter.addEventListener('change', syncFilters);
  if (typeFilter) typeFilter.addEventListener('change', syncFilters);
  if (lifecycleFilter) lifecycleFilter.addEventListener('change', syncFilters);
  if (savedViewSelect) {
    syncInventorySavedViewControl();
    savedViewSelect.addEventListener('change', () => setInventorySavedView(savedViewSelect.value));
  }
  if (activeFilterChips) {
    activeFilterChips.addEventListener('click', (event) => {
      const chip = event.target?.closest('[data-inventory-clear-filter]');
      if (chip) clearInventoryFilterChip(chip.getAttribute('data-inventory-clear-filter'));
    });
  }
  setupInventoryAutoRefresh();
  document.addEventListener('click', (event) => {
    const actionBtn = event.target?.closest('[data-inventory-360-action]');
    if (actionBtn) handleInventory360Action(actionBtn.getAttribute('data-inventory-360-action'));
  });
  if (inventory360Grid) renderInventory360Analytics();
  Object.entries(INVENTORY_VIEW_BUTTON_IDS).forEach(([view, buttonId]) => {
    const button = document.getElementById(buttonId);
    if (!button) return;
    button.addEventListener('click', () => setInventoryView(view));
  });
  const spareStockRefreshBtn = document.getElementById('spareStockRefreshBtn');
  const spareStockLowOnlyBtn = document.getElementById('spareStockLowOnlyBtn');
  const spareStockAddBtn = document.getElementById('spareStockAddBtn');
  const spareStockSearchInput = document.getElementById('spareStockSearchInput');
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
  const aiMapColumnsBtn = document.getElementById('aiMapColumnsBtn');
  const aiRepairImportBtn = document.getElementById('aiRepairImportBtn');
  const aiMatchInvoiceBtn = document.getElementById('aiMatchInvoiceBtn');
  const previewDocumentImportBtn = document.getElementById('previewDocumentImportBtn');
  const importViewAssetsBtn = document.getElementById('importViewAssetsBtn');
  const importAnotherFileBtn = document.getElementById('importAnotherFileBtn');
  const importAiRepairApplySafeBtn = document.getElementById('importAiRepairApplySafeBtn');
  const importAiRepairApplySelectedBtn = document.getElementById('importAiRepairApplySelectedBtn');
  const importAiRepairIgnoreAllBtn = document.getElementById('importAiRepairIgnoreAllBtn');
  const importAiRepairRerunPreviewBtn = document.getElementById('importAiRepairRerunPreviewBtn');
  const importAiRepairTableBody = document.getElementById('importAiRepairTableBody');
  if (openImportAssetsBtn) openImportAssetsBtn.addEventListener('click', () => window.openImportAssetsModal());
  if (previewImportBtn) previewImportBtn.addEventListener('click', () => window.previewImportAssets());
  if (commitImportBtn) commitImportBtn.addEventListener('click', () => window.commitImportAssets());
  if (downloadImportTemplateBtn) downloadImportTemplateBtn.addEventListener('click', () => window.copyImportTemplateCsv());
  if (aiMapColumnsBtn) aiMapColumnsBtn.addEventListener('click', () => window.runImportAiColumnMapping());
  if (aiRepairImportBtn) aiRepairImportBtn.addEventListener('click', () => window.runImportAiRepairErrors());
  if (aiMatchInvoiceBtn) aiMatchInvoiceBtn.addEventListener('click', () => window.runImportAiInvoiceMatch());
  if (previewDocumentImportBtn) previewDocumentImportBtn.addEventListener('click', () => window.previewDocumentImportRows());
  if (importViewAssetsBtn) importViewAssetsBtn.addEventListener('click', () => window.viewImportedAssetsAfterCommit());
  if (importAnotherFileBtn) importAnotherFileBtn.addEventListener('click', () => window.importAnotherFileAfterCommit());
  if (importAiRepairApplySafeBtn) importAiRepairApplySafeBtn.addEventListener('click', () => window.applyAllSafeImportRepairs());
  if (importAiRepairApplySelectedBtn) importAiRepairApplySelectedBtn.addEventListener('click', () => window.applySelectedImportRepairs());
  if (importAiRepairIgnoreAllBtn) importAiRepairIgnoreAllBtn.addEventListener('click', () => window.ignoreAllImportRepairs());
  if (importAiRepairRerunPreviewBtn) importAiRepairRerunPreviewBtn.addEventListener('click', () => window.rerunImportPreviewValidation());
  if (importAiRepairTableBody) {
    importAiRepairTableBody.addEventListener('click', (event) => {
      const applyBtn = event.target?.closest('[data-import-repair-apply-id]');
      if (applyBtn) {
        const fixId = String(applyBtn.getAttribute('data-import-repair-apply-id') || '').trim();
        if (fixId) window.applySingleImportRepair(fixId);
        return;
      }
      const ignoreBtn = event.target?.closest('[data-import-repair-ignore-id]');
      if (ignoreBtn) {
        const fixId = String(ignoreBtn.getAttribute('data-import-repair-ignore-id') || '').trim();
        if (fixId) window.ignoreSingleImportRepair(fixId);
      }
    });
    importAiRepairTableBody.addEventListener('change', (event) => {
      const checkbox = event.target?.closest('[data-import-repair-select-id]');
      if (!checkbox) return;
      const fixId = String(checkbox.getAttribute('data-import-repair-select-id') || '').trim();
      if (!fixId) return;
      const selected = Boolean(checkbox.checked);
      importAiRepairState.suggestions = (importAiRepairState.suggestions || []).map((fix) => {
        if (String(fix.id || '') !== fixId) return fix;
        return { ...fix, selected };
      });
      renderImportRepairSuggestions();
    });
  }
  const openAssetMapBtn = document.getElementById('openAssetMapBtn');
  const openBulkCheckoutBtn = document.getElementById('openBulkCheckoutBtn');
  const openLoanerBoardBtn = document.getElementById('openLoanerBoardBtn');
  const openAuditBoardBtn = document.getElementById('openAuditBoardBtn');
  const openProcurementBoardBtn = document.getElementById('openProcurementBoardBtn');
  const procurementBoardRefreshBtn = document.getElementById('procurementBoardRefreshBtn');
  const procurementCreateRequestBtn = document.getElementById('procurementCreateRequestBtn');
  const procurementStatusFilter = document.getElementById('procurementStatusFilter');
  const procurementRecommendationsTableBody = document.getElementById('procurementRecommendationsTableBody');
  const procurementRequestsTableBody = document.getElementById('procurementRequestsTableBody');
  const bulkCheckoutValidateBtn = document.getElementById('bulkCheckoutValidateBtn');
  const bulkCheckoutConfirmBtn = document.getElementById('bulkCheckoutConfirmBtn');
  const bulkCheckoutBuilding = document.getElementById('bulkCheckoutBuilding');
  const bulkCheckoutDepartment = document.getElementById('bulkCheckoutDepartment');
  const bulkCheckoutRoom = document.getElementById('bulkCheckoutRoom');
  const bulkCheckoutAssigneeRole = document.getElementById('bulkCheckoutAssigneeRole');
  const bulkCheckoutAssignedTo = document.getElementById('bulkCheckoutAssignedTo');
  const bulkCheckoutReason = document.getElementById('bulkCheckoutReason');
  const loanerRefreshBtn = document.getElementById('loanerRefreshBtn');
  const loanerSearchInput = document.getElementById('loanerSearchInput');
  const auditBoardRefreshBtn = document.getElementById('auditBoardRefreshBtn');
  const mapRefreshBtn = document.getElementById('assetMapRefreshBtn');
  const mapResetFiltersBtn = document.getElementById('assetMapResetFiltersBtn');
  const mapSearchInput = document.getElementById('assetMapSearchInput');
  const mapViewFilter = document.getElementById('assetMapViewFilter');
  const mapTypeFilter = document.getElementById('assetMapTypeFilter');
  const mapLocationFilter = document.getElementById('assetMapLocationFilter');
  const mapDepartmentFilter = document.getElementById('assetMapDepartmentFilter');
  const mapLifecycleFilter = document.getElementById('assetMapLifecycleFilter');
  const mapTelemetryOnly = document.getElementById('assetMapTelemetryOnly');
  const mapNearEolOnly = document.getElementById('assetMapNearEolOnly');
  const mapHighRiskOnly = document.getElementById('assetMapHighRiskOnly');
  const mapMaintenanceOnly = document.getElementById('assetMapMaintenanceOnly');
  const mapModalEl = document.getElementById('inventoryAssetMapModal');
  const mapCalibrateToggleBtn = document.getElementById('assetMapCalibrateToggleBtn');
  const mapCopyCoordsBtn = document.getElementById('assetMapCopyCoordsBtn');
  if (openAssetMapBtn) openAssetMapBtn.addEventListener('click', () => window.openInventoryAssetMap());
  if (openBulkCheckoutBtn) openBulkCheckoutBtn.addEventListener('click', () => window.openBulkCheckoutModal());
  if (openLoanerBoardBtn) openLoanerBoardBtn.addEventListener('click', () => window.openLoanerBoardModal());
  if (openAuditBoardBtn) openAuditBoardBtn.addEventListener('click', () => window.openAuditBoardModal());
  if (openProcurementBoardBtn) openProcurementBoardBtn.addEventListener('click', () => window.openProcurementWorkspace());
  if (procurementBoardRefreshBtn) procurementBoardRefreshBtn.addEventListener('click', () => window.loadProcurementBoard());
  if (procurementCreateRequestBtn) procurementCreateRequestBtn.addEventListener('click', () => window.createProcurementRequestManual());
  if (procurementStatusFilter) procurementStatusFilter.addEventListener('change', () => window.loadProcurementBoard());
  if (procurementRecommendationsTableBody) {
    procurementRecommendationsTableBody.addEventListener('click', (event) => {
      const button = event.target?.closest('[data-procurement-create-ai]');
      if (!button) return;
      const index = Number(button.getAttribute('data-procurement-create-ai'));
      if (!Number.isFinite(index)) return;
      window.createProcurementRequestFromAi(index);
    });
  }
  if (procurementRequestsTableBody) {
    procurementRequestsTableBody.addEventListener('click', (event) => {
      const statusBtn = event.target?.closest('[data-procurement-update-status]');
      if (statusBtn) {
        const requestId = String(statusBtn.getAttribute('data-procurement-update-status') || '').trim();
        if (requestId) window.updateProcurementRequestStatus(requestId);
        return;
      }
      const quoteBtn = event.target?.closest('[data-procurement-add-quote]');
      if (quoteBtn) {
        const requestId = String(quoteBtn.getAttribute('data-procurement-add-quote') || '').trim();
        if (requestId) window.addProcurementVendorQuote(requestId);
        return;
      }
      const orderBtn = event.target?.closest('[data-procurement-create-po]');
      if (orderBtn) {
        const requestId = String(orderBtn.getAttribute('data-procurement-create-po') || '').trim();
        if (requestId) window.createProcurementPurchaseOrder(requestId);
        return;
      }
      const receiveBtn = event.target?.closest('[data-procurement-receive]');
      if (receiveBtn) {
        const requestId = String(receiveBtn.getAttribute('data-procurement-receive') || '').trim();
        if (requestId) window.receiveProcurementRequest(requestId);
      }
    });
  }
  if (bulkCheckoutValidateBtn) bulkCheckoutValidateBtn.addEventListener('click', () => window.validateBulkCheckoutAssets());
  if (bulkCheckoutConfirmBtn) bulkCheckoutConfirmBtn.addEventListener('click', () => window.confirmBulkCheckout());
  [bulkCheckoutBuilding, bulkCheckoutDepartment, bulkCheckoutRoom, bulkCheckoutAssigneeRole, bulkCheckoutAssignedTo, bulkCheckoutReason].forEach((el) => {
    if (!el) return;
    const eventName = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(eventName, () => updateBulkCheckoutDestinationSummary());
  });
  if (loanerRefreshBtn) loanerRefreshBtn.addEventListener('click', () => window.loadLoanerBoard());
  if (loanerSearchInput) loanerSearchInput.addEventListener('input', () => window.renderLoanerBoard());
  if (auditBoardRefreshBtn) auditBoardRefreshBtn.addEventListener('click', () => window.loadAuditBoard());
  if (mapRefreshBtn) mapRefreshBtn.addEventListener('click', () => window.loadInventoryMapAssets(true));
  if (mapCalibrateToggleBtn) {
    mapCalibrateToggleBtn.addEventListener('click', () => {
      setInventoryMapCalibrationEnabled(!inventoryMapCalibrationState.enabled);
    });
  }
  if (mapCopyCoordsBtn) {
    mapCopyCoordsBtn.addEventListener('click', () => copyInventoryMapCalibrationJson());
  }
  if (mapModalEl) {
    mapModalEl.addEventListener('hidden.bs.modal', () => {
      if (inventoryMapCalibrationState.enabled) setInventoryMapCalibrationEnabled(false);
    });
  }
  if (mapResetFiltersBtn) {
    mapResetFiltersBtn.addEventListener('click', () => {
      const ids = [
        'assetMapSearchInput',
        'assetMapTypeFilter',
        'assetMapLocationFilter',
        'assetMapDepartmentFilter',
      ];
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = id === 'assetMapSearchInput' ? '' : 'all';
      });
      const viewFilter = document.getElementById('assetMapViewFilter');
      const lifecycleFilter = document.getElementById('assetMapLifecycleFilter');
      if (viewFilter) viewFilter.value = 'all';
      if (lifecycleFilter) lifecycleFilter.value = 'all';
      ['assetMapTelemetryOnly', 'assetMapNearEolOnly', 'assetMapHighRiskOnly', 'assetMapMaintenanceOnly'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.checked = false;
      });
      if (inventoryMapState.allAssets.length) window.filterInventoryMapAssets();
    });
  }
  [mapSearchInput, mapViewFilter, mapTypeFilter, mapLocationFilter, mapDepartmentFilter, mapLifecycleFilter, mapTelemetryOnly, mapNearEolOnly, mapHighRiskOnly, mapMaintenanceOnly].forEach((el) => {
    if (!el) return;
    const eventName = el.tagName === 'INPUT' && String(el.getAttribute('type') || '').toLowerCase() !== 'checkbox' ? 'input' : 'change';
    el.addEventListener(eventName, () => {
      if (!inventoryMapState.allAssets.length) return;
      window.filterInventoryMapAssets();
    });
  });
  const importFileInput = document.getElementById('importAssetsFile');
  const importDropZone = document.getElementById('importDropZone');
  const importDropHint = document.getElementById('importDropZoneHint');
  const updateDropHint = (file) => {
    if (!importDropHint) return;
    importDropHint.textContent = file ? `Selected file: ${file.name}` : 'No file selected.';
  };
  if (importFileInput) {
    importFileInput.addEventListener('change', () => {
      const file = importFileInput.files?.[0] || null;
      updateDropHint(file);
    });
  }
  if (importDropZone && importFileInput) {
    importDropZone.addEventListener('click', (event) => {
      if (event.target === importFileInput) return;
      importFileInput.click();
    });
    ['dragenter', 'dragover'].forEach((eventName) => {
      importDropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        importDropZone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach((eventName) => {
      importDropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        importDropZone.classList.remove('is-dragover');
      });
    });
    importDropZone.addEventListener('drop', (event) => {
      const dt = event.dataTransfer;
      const file = dt?.files?.[0];
      if (!file) return;
      const lower = String(file.name || '').toLowerCase();
      if (!lower.endsWith('.csv')) {
        showMessage('CSV is supported now. Please use a CSV file.', 'warning');
        return;
      }
      const transfer = new DataTransfer();
      transfer.items.add(file);
      importFileInput.files = transfer.files;
      updateDropHint(file);
    });
  }

  const inventoryAiAssistantBtn = document.getElementById('inventoryAiAssistantBtn');
  const inventoryAiSearchBtn = document.getElementById('inventoryAiSearchBtn');
  const inventoryAiMissingDataBtn = document.getElementById('inventoryAiMissingDataBtn');
  const inventoryAiMaintenanceBtn = document.getElementById('inventoryAiMaintenanceBtn');
  const inventoryAiProcurementBtn = document.getElementById('inventoryAiProcurementBtn');
  const inventoryAiDuplicateBtn = document.getElementById('inventoryAiDuplicateBtn');
  const inventoryAiRunBtn = document.getElementById('inventoryAiRunBtn');
  const inventoryAiQueryInput = document.getElementById('inventoryAiQueryInput');
  const inventoryAiChatLauncher = document.getElementById('inventoryAiChatLauncher');
  const inventoryAiChatCloseBtn = document.getElementById('inventoryAiChatCloseBtn');
  const inventoryAiChatMinimizeBtn = document.getElementById('inventoryAiChatMinimizeBtn');
  const inventoryAiChatSendBtn = document.getElementById('inventoryAiChatSendBtn');
  const inventoryAiChatInput = document.getElementById('inventoryAiChatInput');
  const inventoryAiQuickPrompts = document.getElementById('inventoryAiQuickPrompts');
  const inventoryAiPromptToggleBtn = document.getElementById('inventoryAiPromptToggleBtn');
  const inventoryAiChatMessages = document.getElementById('inventoryAiChatMessages');
  if (inventoryAiAssistantBtn) inventoryAiAssistantBtn.addEventListener('click', () => window.toggleInventoryAiChat(true));
  if (inventoryAiSearchBtn) inventoryAiSearchBtn.addEventListener('click', () => window.openInventoryAiModal('search'));
  if (inventoryAiMissingDataBtn) inventoryAiMissingDataBtn.addEventListener('click', () => window.openInventoryAiModal('missing_data'));
  if (inventoryAiMaintenanceBtn) inventoryAiMaintenanceBtn.addEventListener('click', () => window.openInventoryAiModal('maintenance'));
  if (inventoryAiProcurementBtn) inventoryAiProcurementBtn.addEventListener('click', () => window.openInventoryAiModal('procurement'));
  if (inventoryAiDuplicateBtn) inventoryAiDuplicateBtn.addEventListener('click', () => window.openInventoryAiModal('duplicates'));
  if (inventoryAiRunBtn) inventoryAiRunBtn.addEventListener('click', () => window.runInventoryAiAction());
  if (inventoryAiChatLauncher) inventoryAiChatLauncher.addEventListener('click', () => window.toggleInventoryAiChat());
  if (inventoryAiChatCloseBtn) inventoryAiChatCloseBtn.addEventListener('click', () => window.toggleInventoryAiChat(false));
  if (inventoryAiChatMinimizeBtn) inventoryAiChatMinimizeBtn.addEventListener('click', () => window.toggleInventoryAiChat(false));
  if (inventoryAiChatSendBtn) inventoryAiChatSendBtn.addEventListener('click', () => window.sendInventoryAiChatMessage());
  if (inventoryAiChatInput) {
    inventoryAiChatInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        window.sendInventoryAiChatMessage();
      }
    });
  }
  if (inventoryAiQuickPrompts) {
    inventoryAiQuickPrompts.addEventListener('click', (event) => {
      const button = event.target?.closest('[data-ai-prompt]');
      if (button) {
        const prompt = String(button.getAttribute('data-ai-prompt') || '').trim();
        if (prompt) window.openInventoryAiChatWithPrompt(prompt);
        return;
      }
      const actionButton = event.target?.closest('[data-ai-action]');
      if (!actionButton) return;
      const mode = String(actionButton.getAttribute('data-ai-action') || '').trim();
      if (mode) window.runInventoryAiQuickAction(mode);
    });
  }
  if (inventoryAiPromptToggleBtn) {
    inventoryAiPromptToggleBtn.addEventListener('click', () => {
      const promptsEl = document.getElementById('inventoryAiQuickPrompts');
      const currentlyCollapsed = String(promptsEl?.dataset?.collapsed || '') === 'true';
      inventoryAiChatState.promptsCollapsed = !currentlyCollapsed;
      updateInventoryAiPromptLayout((inventoryAiChatState.messages || []).length > 0);
    });
  }
  if (inventoryAiChatMessages) {
    inventoryAiChatMessages.addEventListener('click', (event) => {
      const promptBtn = event.target?.closest('[data-ai-prompt]');
      if (promptBtn) {
        const prompt = String(promptBtn.getAttribute('data-ai-prompt') || '').trim();
        if (prompt) window.openInventoryAiChatWithPrompt(prompt);
        return;
      }
      const copyBtn = event.target?.closest('.inventory-ai-copy-report-btn');
      if (copyBtn) {
        const encoded = String(copyBtn.getAttribute('data-report-encoded') || '').trim();
        const text = encoded ? decodeURIComponent(encoded) : '';
        if (!text) return;
        navigator.clipboard?.writeText(text).then(() => {
          showMessage('Report summary copied to clipboard.', 'success');
        }).catch(() => {
          showMessage('Could not copy report summary.', 'warning');
        });
        return;
      }
      const openPageBtn = event.target?.closest('.inventory-ai-open-page-btn');
      if (openPageBtn) {
        const targetPage = String(openPageBtn.getAttribute('data-ai-open-page') || '').trim();
        if (targetPage) window.location.href = targetPage;
        return;
      }
      const healthBtn = event.target?.closest('.inventory-ai-health-asset-btn');
      if (healthBtn) {
        const assetId = String(healthBtn.getAttribute('data-asset-id') || '').trim();
        if (!assetId) return;
        window.runInventoryAiMatchedAssetHealth(assetId);
        return;
      }
      const componentsBtn = event.target?.closest('.inventory-ai-view-components-btn');
      if (componentsBtn) {
        const assetId = String(componentsBtn.getAttribute('data-asset-id') || '').trim();
        if (!assetId) return;
        window.openInventoryAiMatchedAssetTab(assetId, 'components');
        return;
      }
      const lifecycleBtn = event.target?.closest('.inventory-ai-view-lifecycle-btn');
      if (lifecycleBtn) {
        const assetId = String(lifecycleBtn.getAttribute('data-asset-id') || '').trim();
        if (!assetId) return;
        window.openInventoryAiMatchedAssetTab(assetId, 'lifecycle');
        return;
      }
      const button = event.target?.closest('.inventory-ai-view-asset-btn');
      if (!button) return;
      const assetId = String(button.getAttribute('data-asset-id') || '').trim();
      if (!assetId) return;
      window.openInventoryAiMatchedAsset(assetId);
    });
  }
  const mapMarkerLayer = document.getElementById('inventoryAssetMapMarkers');
  if (mapMarkerLayer) {
    mapMarkerLayer.addEventListener('click', (event) => {
      const button = event.target?.closest('.inventory-map-marker');
      if (!button) return;
      const key = String(button.getAttribute('data-location-key') || '').trim();
      inventoryMapState.selectedLocationKey = key || null;
      window.renderInventoryMapLocationAssets();
    });
  }
  const mapCalibrationLayer = document.getElementById('inventoryAssetMapCalibrationMarkers');
  if (mapCalibrationLayer) {
    const findMarkerAndPoint = (event) => {
      const marker = event.target?.closest('[data-calibration-location-key]');
      if (!marker) return null;
      const canvas = document.getElementById('inventoryAssetMapCanvas');
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100;
      const y = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 100;
      const clampedX = Math.max(0, Math.min(100, x));
      const clampedY = Math.max(0, Math.min(100, y));
      return {
        marker,
        locationKey: String(marker.getAttribute('data-calibration-location-key') || '').trim(),
        xPercent: clampedX,
        yPercent: clampedY,
      };
    };
    const applyDragPoint = (point) => {
      if (!point?.locationKey) return;
      const baseCoords = unprojectInventoryMapCoordinates(point.xPercent, point.yPercent);
      if (!baseCoords) return;
      inventoryMapCalibrationState.draftByKey.set(point.locationKey, {
        xPercent: Math.max(0, Math.min(100, Number(baseCoords.xPercent))),
        yPercent: Math.max(0, Math.min(100, Number(baseCoords.yPercent))),
      });
      window.renderInventoryMapCalibrationMarkers();
      window.renderInventoryMapMarkers();
      window.renderInventoryMapLocationAssets();
      renderInventoryMapCalibrationPanel();
    };
    mapCalibrationLayer.addEventListener('pointerdown', (event) => {
      if (!inventoryMapCalibrationState.enabled) return;
      const point = findMarkerAndPoint(event);
      if (!point || !point.locationKey) return;
      inventoryMapCalibrationState.selectedKey = point.locationKey;
      inventoryMapCalibrationState.draggingKey = point.locationKey;
      event.preventDefault();
      mapCalibrationLayer.setPointerCapture?.(event.pointerId);
      applyDragPoint(point);
    });
    mapCalibrationLayer.addEventListener('pointermove', (event) => {
      if (!inventoryMapCalibrationState.enabled || !inventoryMapCalibrationState.draggingKey) return;
      const canvas = document.getElementById('inventoryAssetMapCanvas');
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100;
      const y = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 100;
      applyDragPoint({
        locationKey: inventoryMapCalibrationState.draggingKey,
        xPercent: Math.max(0, Math.min(100, x)),
        yPercent: Math.max(0, Math.min(100, y)),
      });
    });
    const stopDrag = () => {
      if (!inventoryMapCalibrationState.draggingKey) return;
      inventoryMapCalibrationState.draggingKey = null;
      window.renderInventoryMapCalibrationMarkers();
      renderInventoryMapCalibrationPanel();
    };
    mapCalibrationLayer.addEventListener('pointerup', stopDrag);
    mapCalibrationLayer.addEventListener('pointercancel', stopDrag);
    mapCalibrationLayer.addEventListener('pointerleave', () => {
      if (inventoryMapCalibrationState.draggingKey) stopDrag();
    });
  }
  const mapLocationAssets = document.getElementById('assetMapLocationAssets');
  if (mapLocationAssets) {
    mapLocationAssets.addEventListener('click', (event) => {
      const viewBtn = event.target?.closest('.inventory-map-view-btn');
      if (viewBtn) {
        const assetId = String(viewBtn.getAttribute('data-asset-id') || '').trim();
        if (!assetId) return;
        const modalEl = document.getElementById('inventoryAssetMapModal');
        bootstrap.Modal.getInstance(modalEl)?.hide();
        window.openAssetCmdb(assetId);
        return;
      }
      const transferBtn = event.target?.closest('.inventory-map-transfer-btn');
      if (transferBtn) {
        const assetId = String(transferBtn.getAttribute('data-asset-id') || '').trim();
        if (!assetId) return;
        const modalEl = document.getElementById('inventoryAssetMapModal');
        bootstrap.Modal.getInstance(modalEl)?.hide();
        window.transferIndividual(assetId);
        return;
      }
      const historyBtn = event.target?.closest('.inventory-map-history-btn');
      if (historyBtn) {
        const assetId = String(historyBtn.getAttribute('data-asset-id') || '').trim();
        if (!assetId) return;
        const modalEl = document.getElementById('inventoryAssetMapModal');
        bootstrap.Modal.getInstance(modalEl)?.hide();
        window.viewTransferHistory(assetId);
      }
    });
  }

  const loanerTableBody = document.getElementById('loanerTableBody');
  if (loanerTableBody) {
    loanerTableBody.addEventListener('click', (event) => {
      const checkoutBtn = event.target?.closest('[data-loaner-checkout-id]');
      if (checkoutBtn) {
        const assetId = String(checkoutBtn.getAttribute('data-loaner-checkout-id') || '').trim();
        if (assetId) window.loanerCheckoutAsset(assetId);
        return;
      }
      const returnBtn = event.target?.closest('[data-loaner-return-id]');
      if (returnBtn) {
        const assetId = String(returnBtn.getAttribute('data-loaner-return-id') || '').trim();
        if (assetId) window.loanerReturnAsset(assetId);
      }
    });
  }

  const auditTableBody = document.getElementById('auditBoardTableBody');
  if (auditTableBody) {
    auditTableBody.addEventListener('click', (event) => {
      const actionBtn = event.target?.closest('[data-audit-action-id]');
      if (actionBtn) {
        const assetId = String(actionBtn.getAttribute('data-audit-action-id') || '').trim();
        const action = String(actionBtn.getAttribute('data-audit-action') || '').trim();
        if (!assetId) return;
        if (action === 'verify') window.auditVerifyAssetLocation(assetId);
        if (action === 'missing') window.auditMarkAssetMissing(assetId);
        if (action === 'damaged') window.auditMarkAssetDamaged(assetId);
        if (action === 'wrong_location') window.auditMarkWrongLocation(assetId);
        if (action === 'needs_review') window.auditMarkNeedsReview(assetId);
      }
    });
  }
  if (inventoryAiQueryInput) {
    inventoryAiQueryInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        window.runInventoryAiAction();
      }
    });
  }

  const copilotPrefillFromSession = String(sessionStorage.getItem('inventory_copilot_prefill') || '').trim();
  const inventoryUrlParams = new URLSearchParams(window.location.search);
  const shouldOpenCopilotFromUrl = String(inventoryUrlParams.get('ai') || '').trim().toLowerCase() === 'copilot';
  const focusTopic = String(inventoryUrlParams.get('focus') || '').trim().toLowerCase();
  const copilotPrefill = copilotPrefillFromSession
    || (shouldOpenCopilotFromUrl
      ? (focusTopic === 'procurement'
        ? 'Show urgent procurement priorities.'
        : 'Summarize key inventory risks and next actions.')
      : '');
  if (copilotPrefillFromSession) {
    sessionStorage.removeItem('inventory_copilot_prefill');
  }
  if (copilotPrefill) {
    setTimeout(() => {
      window.openInventoryAiChatWithPrompt(copilotPrefill);
    }, 250);
  }

  const commandCenterAction = String(sessionStorage.getItem('inventory_command_action') || '').trim().toLowerCase();
  if (commandCenterAction) {
    sessionStorage.removeItem('inventory_command_action');
    setTimeout(() => {
      if (commandCenterAction === 'import') {
        window.openImportAssetsModal?.();
        return;
      }
      if (commandCenterAction === 'create') {
        const modalEl = document.getElementById('receiveOrderModal');
        if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).show();
        return;
      }
      if (commandCenterAction === 'audit') {
        window.openAuditBoardModal?.();
        return;
      }
      if (commandCenterAction === 'asset-map') {
        window.openInventoryAssetMap?.();
        return;
      }
      if (commandCenterAction === 'ai' && !copilotPrefill) {
        window.toggleInventoryAiChat?.(true);
      }
    }, 350);
  }

  updateWorkingHoursAvailability();
  applyAssetTypeSpecTemplate();
  updateSpecPreviewButtonState();
  setSpecPreviewStatus('Approve/Edit before Create.', 'muted');
  updateInferredQualityPreview();

  const detailsModalElement = document.getElementById('detailsModal');
  if (detailsModalElement) {
    detailsModalElement.addEventListener('hidden.bs.modal', () => {
      activeDetailsGroupName = null;
      activeDetailsContext = null;
      bulkSpecReviewContext = null;
    });
  }
  const importModalElement = document.getElementById('importAssetsModal');
  if (importModalElement) {
    importModalElement.addEventListener('hidden.bs.modal', () => {
      resetImportAssetsState();
    });
  }
  const transferModalElement = document.getElementById('transferModal');
  if (transferModalElement) {
    transferModalElement.addEventListener('hidden.bs.modal', () => {
      transferSelectionState = { targetAssetIds: [], isBulk: false };
      const summaryEl = document.getElementById('transferRelatedCounts');
      if (summaryEl) summaryEl.textContent = 'Related items: calculating...';
    });
  }
  const assetMapModalElement = document.getElementById('inventoryAssetMapModal');
  if (assetMapModalElement) {
    assetMapModalElement.addEventListener('shown.bs.modal', () => {
      updateInventoryMapCanvasLayout();
      window.renderInventoryMapMarkers();
    });
    assetMapModalElement.addEventListener('hidden.bs.modal', () => {
      inventoryMapState.selectedLocationKey = null;
      window.renderInventoryMapLocationAssets();
    });
  }

  updateInventoryAiFloatingOffset();
  window.addEventListener('resize', () => updateInventoryAiFloatingOffset());
  window.addEventListener('resize', () => {
    const mapModalEl = document.getElementById('inventoryAssetMapModal');
    if (mapModalEl && mapModalEl.classList.contains('show')) {
      updateInventoryMapCanvasLayout();
      window.renderInventoryMapMarkers();
    }
  });
});

async function initializePage() {
  await loadConfig(); // 1. Fetch config from backend first!
  await loadAssets(); // 2. Then load assets and render
}

// Ã°Å¸Å¡â‚¬ Fetches the single source of truth from your new backend route
async function loadConfig() {
  try {
    const response = await inventoryRequest('/config');
    if (!response.ok) throw new Error('Failed to fetch configuration');
    
    const configData = await response.json();
    
    // Assign the fetched data to our global variables
    BUILDINGS = configData.BUILDINGS || [];
    DEPARTMENTS = configData.DEPARTMENTS || [];
    ASSET_TYPES = configData.ASSET_TYPES || [];
    COMPONENT_TYPE_REGISTRY_BY_PARENT = configData.COMPONENT_TYPE_REGISTRY_BY_PARENT || {};
    ACCESSORY_TYPES = configData.ACCESSORY_TYPES || [];
    CONSUMABLE_TYPES = configData.CONSUMABLE_TYPES || [];
    SPARE_STOCK_TYPES = configData.SPARE_STOCK_TYPES || [];
    LICENSE_TYPES = configData.LICENSE_TYPES || [];
    EOL_METRICS = configData.EOL_METRICS || {};
    populateAssetTypeSelectOptions();
    
  } catch (error) {
    console.error('Error loading config:', error);
    showMessage('Could not load inventory configuration. Is the backend running?', 'error');
  }
}

function showInventoryTableLoadingState() {
  const tableBody = document.getElementById('inventoryTableBody');
  if (!tableBody) return;
  const headerColumns = document.querySelectorAll('#groupTable thead tr th').length;
  const colspan = Math.max(1, headerColumns || 5);
  tableBody.innerHTML = `
    <tr class="ops-loading-row">
      <td colspan="${colspan}">
        <div class="inventory-loading-wrap">
          <span class="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true"></span>
          <span>Loading inventory data...</span>
        </div>
        <div class="ops-skeleton-table-stack mt-2">
          <span class="ops-skeleton-line lg"></span>
          <span class="ops-skeleton-line md"></span>
          <span class="ops-skeleton-line sm"></span>
        </div>
      </td>
    </tr>
  `;
}

function normalizeAssetListResponse(payload, fallbackPage = 1, fallbackPageSize = 50) {
  if (Array.isArray(payload)) {
    return {
      assets: payload,
      total: payload.length,
      totalPages: 1,
      page: fallbackPage,
      pageSize: fallbackPageSize,
    };
  }

  const assets = Array.isArray(payload?.items)
    ? payload.items
    : (Array.isArray(payload?.assets)
        ? payload.assets
        : (Array.isArray(payload?.data)
            ? payload.data
            : (Array.isArray(payload?.rows) ? payload.rows : [])));
  const meta = payload?.pagination || payload?.meta || {};
  const total = Number(
    payload?.total
    ?? payload?.totalItems
    ?? payload?.count
    ?? meta?.total
    ?? meta?.totalItems
    ?? assets.length
  );
  const page = Number(payload?.page ?? meta?.page ?? fallbackPage);
  const pageSize = Number(payload?.pageSize ?? payload?.limit ?? meta?.pageSize ?? meta?.limit ?? fallbackPageSize);
  const totalPages = Number(
    payload?.totalPages
    ?? meta?.totalPages
    ?? (pageSize > 0 ? Math.ceil((Number.isFinite(total) ? total : assets.length) / pageSize) : 1)
  );

  return {
    assets,
    total: Number.isFinite(total) ? total : assets.length,
    totalPages: Math.max(1, Number.isFinite(totalPages) ? totalPages : 1),
    page: Math.max(1, Number.isFinite(page) ? page : fallbackPage),
    pageSize: Math.max(10, Math.min(500, Number.isFinite(pageSize) ? pageSize : fallbackPageSize)),
  };
}

async function buildInventoryHttpError(response, endpoint) {
  const payload = await response.json().catch(() => ({}));
  const detail = payload?.message || payload?.error || response.statusText || 'Request failed';
  const error = new Error(`${detail} (${response.status} ${response.statusText || 'HTTP error'})`);
  error.endpoint = endpoint;
  error.status = response.status;
  return error;
}

function renderInventoryLoadError(error, endpoint) {
  const tableBody = document.getElementById('inventoryTableBody');
  if (!tableBody) return;
  const headerColumns = document.querySelectorAll('#groupTable thead tr th').length;
  const colspan = Math.max(1, headerColumns || 5);
  const endpointLabel = endpoint || error?.endpoint || '/assets';
  const statusLabel = error?.status ? `HTTP ${error.status}` : 'Network/render error';
  tableBody.innerHTML = `
    <tr>
      <td colspan="${colspan}">
        <div class="ops-empty-state-card ops-empty-state-card-danger">
          <div class="ops-empty-state-icon"><i class="bi bi-database-x"></i></div>
          <div>
            <div class="ops-empty-state-title">Could not load inventory assets</div>
            <div class="ops-empty-state-copy">
              The Assets page could not read real database-backed inventory data.
              <span class="d-block mt-1">Endpoint: <code>${UI.escapeHTML(endpointLabel)}</code> · ${UI.escapeHTML(statusLabel)}</span>
              <span class="d-block mt-1">${UI.escapeHTML(error?.message || 'Check the inventory backend logs for details.')}</span>
            </div>
          </div>
        </div>
      </td>
    </tr>
  `;
  renderInventoryGroupPager();
  updateInventoryAiFloatingOffset();
}

function updateInventoryFreshnessStatus(status = 'ready', message = '') {
  const badge = document.getElementById('inventoryFreshnessBadge');
  const table = document.getElementById('inventoryTableFreshness');
  const autoText = isAutoRefreshEnabled()
    ? `Auto-refreshes every ${AUTO_REFRESH_INTERVAL_MS / 1000}s`
    : 'Auto-refresh paused';
  const loadedText = inventoryPageState.loadedAt ? `Updated ${formatRelativeTime(inventoryPageState.loadedAt)}` : 'Waiting for first load';
  const label = message || (status === 'refreshing'
    ? 'Refreshing inventory data...'
    : (status === 'error' ? `Refresh failed. ${loadedText}.` : `${loadedText}. ${autoText}.`));
  const stateClass = status === 'error' ? 'is-error' : (status === 'refreshing' ? 'is-refreshing' : 'is-ready');
  if (badge) {
    badge.className = `ops-freshness-pill ${stateClass}`;
    badge.innerHTML = `
      <i class="bi ${status === 'refreshing' ? 'bi-arrow-repeat' : (status === 'error' ? 'bi-exclamation-triangle' : 'bi-check2-circle')}" aria-hidden="true"></i>
      <span>${UI.escapeHTML(label)}</span>
    `;
  }
  if (table) {
    table.innerHTML = `
      <span class="ops-freshness-pill ${stateClass}">
        <i class="bi ${status === 'refreshing' ? 'bi-arrow-repeat' : (status === 'error' ? 'bi-exclamation-triangle' : 'bi-clock-history')}" aria-hidden="true"></i>
        <span>${UI.escapeHTML(label)}</span>
      </span>
    `;
  }
}

function setupInventoryAutoRefresh() {
  if (inventoryPageState.refreshTimer) clearInterval(inventoryPageState.refreshTimer);
  inventoryPageState.refreshTimer = setInterval(() => {
    if (!isAutoRefreshEnabled() || shouldPauseInventoryAutoRefresh() || loadAssetsInFlightPromise) {
      updateInventoryFreshnessStatus('ready');
      return;
    }
    loadAssets({ background: true }).catch((error) => {
      console.warn('[Inventory] Auto refresh failed:', error?.message || error);
      updateInventoryFreshnessStatus('error', 'Failed to auto-refresh inventory data.');
    });
  }, AUTO_REFRESH_INTERVAL_MS);
}

function refreshInventorySecondaryEvidence() {
  Promise.allSettled([
    loadAssetAiJobStatuses(),
    loadAssetLifespanPredictions(),
    loadAssetEolAssessments(),
  ]).then(() => {
    renderTable();
    renderInventory360Analytics();
    checkGlobalEOLAlerts();
  }).catch((error) => {
    console.warn('[Inventory] Secondary evidence refresh failed:', error?.message || error);
  });
  refreshSpecVerificationSnapshot().catch((error) => {
    console.warn('[Inventory] Spec verification snapshot failed:', error?.message || error);
  });
}

async function loadAssets(options = {}) {
  if (loadAssetsInFlightPromise) return loadAssetsInFlightPromise;
  const background = Boolean(options.background);

  loadAssetsInFlightPromise = (async () => {
    let endpoint = '/assets';
    try {
      updateInventoryFreshnessStatus('refreshing', background ? 'Refreshing inventory evidence...' : 'Loading inventory data...');
      if (!background) showInventoryTableLoadingState();
      const searchTerm = String(document.getElementById('searchInput')?.value || '').trim();
      const buildingFilter = String(document.getElementById('filterBuilding')?.value || 'all');
      const deptFilter = String(document.getElementById('filterDept')?.value || 'all');
      const typeFilter = String(document.getElementById('filterType')?.value || 'all');
      const lifecycleFilter = String(document.getElementById('filterLifecycle')?.value || 'all');
      const page = Math.max(1, Number(inventoryPageState.page || 1));
      const pageSize = Math.max(10, Math.min(500, Number(inventoryPageState.pageSize || 50)));
      const params = new URLSearchParams({
        paginate: 'true',
        page: String(page),
        pageSize: String(pageSize),
        view: currentInventoryView,
      });
      if (searchTerm) params.set('q', searchTerm);
      if (buildingFilter && buildingFilter !== 'all') params.set('location', buildingFilter);
      if (deptFilter && deptFilter !== 'all') params.set('department', toBackendDepartmentFilterValue(deptFilter));
      if (lifecycleFilter && lifecycleFilter !== 'all') params.set('lifecycleStatus', lifecycleFilter);
      if (typeFilter && typeFilter !== 'all') params.set('type', typeFilter);

      endpoint = `/assets?${params.toString()}`;
      const response = await inventoryRequest(endpoint);
      if (!response.ok) throw await buildInventoryHttpError(response, endpoint);

      const payload = await response.json();
      const normalized = normalizeAssetListResponse(payload, page, pageSize);
      const assets = normalized.assets;
      console.debug('[AssetCreateDebug] /api/assets response length:', Array.isArray(assets) ? assets.length : 0);
      currentAssets = assets;
      inventoryPageState.total = normalized.total;
      inventoryPageState.totalPages = normalized.totalPages;
      inventoryPageState.page = normalized.page;
      inventoryPageState.pageSize = normalized.pageSize;
      inventoryPageState.loadedAt = Date.now();
      await refreshInventoryFilterSnapshot().catch((error) => {
        console.warn('[Inventory] Full filter snapshot failed; using current page data:', error?.message || error);
      });
      populateFilters();
      renderTable();
      renderInventory360Analytics();
      refreshInventory360ProcurementBoard().catch(() => {});
      updateDeleteAllAssetsButton();
      refreshInventorySecondaryEvidence();
      updateInventoryFreshnessStatus('ready');
    } catch (error) {
      console.error('Error:', error);
      renderInventoryLoadError(error, endpoint);
      updateInventoryFreshnessStatus('error', `Data loaded failed at ${endpoint}. ${error?.message || 'Check logs.'}`);
    }
  })();

  try {
    await loadAssetsInFlightPromise;
  } finally {
    loadAssetsInFlightPromise = null;
  }
}

// Ã°Å¸Â¤â€“ AI Prediction Math Helper
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
      remainingText = `Warning: ${soonMonths} month(s) left`;
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
      remainingText = `Warning: ${daysRemaining} days left`;
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
      const sourceNote = aiSourceMetaText({
        llmUsed: Boolean(explanation?.llmUsed),
        llmStatus: String(explanation?.llmStatus || ''),
        fallbackUsed: Boolean(explanation?.fallbackUsed),
        fallbackReason: String(explanation?.fallbackReason || ''),
      });
      if (shortUser || technical) {
        message = [sourceNote, shortUser, technical].filter(Boolean).join(' | ');
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
  if (status === 'import_verified' || status === 'verified_by_import' || status === 'user_provided') {
    return '<span class="badge bg-primary">Import Verified</span>';
  }
  if (status === 'rejected') return '<span class="badge bg-secondary">Spec Rejected</span>';
  return '<span class="badge bg-light text-dark border">Spec Unchecked</span>';
}

function isTelemetryCategoryEligible(asset) {
  const category = getAssetCategoryKey(asset);
  return !['license', 'consumable', 'spare_part'].includes(category);
}

const CENTRAL_WAREHOUSE_LOCATION_TOKENS = new Set([
  'centralwarehouse',
  'centralwarehousestaging',
  'mainwarehouse',
  'warehouse',
  'centralstore',
]);

function isCentralWarehouseLocation(locationValue) {
  const raw = String(locationValue || '').trim();
  if (!raw) return false;
  const normalized = normalizeInventoryMapToken(displayLocation(raw) || raw);
  return CENTRAL_WAREHOUSE_LOCATION_TOKENS.has(normalized);
}

function isDeployedOutsideWarehouse(asset) {
  if (!asset) return false;
  return !isCentralWarehouseLocation(asset.location);
}

function shouldShowTelemetryControl(asset, profile = getAssetProfile(asset)) {
  if (!asset) return false;
  if (!isTelemetryCategoryEligible(asset)) return false;
  const canonical = canonicalType(asset?.type);
  const specs = profile?.specs && typeof profile.specs === 'object' ? profile.specs : getAssetSpecs(asset);
  const modelHints = [
    canonical,
    normalizeValue(asset?.name),
    normalizeValue(specs?.assetType),
    normalizeValue(specs?.assetTypeLabel),
    normalizeValue(specs?.registryKey),
  ].join(' ');
  const legacyHeuristicCapable = (
    modelHints.includes('desktop')
    || modelHints.includes('laptop')
    || modelHints.includes('pc')
    || modelHints.includes('server')
    || modelHints.includes('projector')
    || modelHints.includes('printer')
    || modelHints.includes('switch')
    || modelHints.includes('router')
    || modelHints.includes('accesspoint')
    || modelHints.includes('smartboard')
    || modelHints.includes('interactive')
    || modelHints.includes('cctv')
    || modelHints.includes('ups')
    || modelHints.includes('biometric')
  );
  const trackableType = TRACKABLE_ASSET_TYPES.has(canonical) || legacyHeuristicCapable;
  const telemetryConfigured = Boolean(
    profile.trackWorkingHours
    || profile.hasTelemetry
    || toBoolean(specs.telemetryApplicable)
    || toBoolean(specs.telemetryEnabled)
    || toBoolean(specs.trackWorkingHours)
    || toBoolean(asset.telemetryEnabledDerived)
    || toBoolean(asset.telemetryCapableDerived)
  );
  if (!trackableType && !telemetryConfigured) return false;
  if (!isDeployedOutsideWarehouse(asset)) return false;
  if (toBoolean(specs.telemetryDisabled)) return false;
  return telemetryConfigured;
}

function shouldShowSpecReviewButton(status) {
  return status === 'pending';
}

function getPendingSpecReviewAssetsInGroup(groupAssets = []) {
  return groupAssets.filter((asset) => {
    const status = getSpecVerificationStatus(asset);
    return status === 'pending';
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
  if (index < 0) {
    currentAssets.unshift(updatedAsset);
    return updatedAsset;
  }
  const merged = {
    ...currentAssets[index],
    ...updatedAsset,
    specifications: (updatedAsset.specifications && typeof updatedAsset.specifications === 'object')
      ? updatedAsset.specifications
      : currentAssets[index].specifications
  };
  currentAssets[index] = merged;
  return merged;
}

function collectAssetsFromTransferResponse(payload = {}) {
  if (!payload || typeof payload !== 'object') return [];
  const candidates = [];
  if (payload.updatedAsset && payload.updatedAsset.customId) candidates.push(payload.updatedAsset);
  if (Array.isArray(payload.updatedAssets)) {
    payload.updatedAssets.forEach((asset) => {
      if (asset && asset.customId) candidates.push(asset);
    });
  }
  if (payload.original && payload.original.customId) candidates.push(payload.original);
  if (payload.newBatch && payload.newBatch.customId) candidates.push(payload.newBatch);
  if (Array.isArray(payload.newBatches)) {
    payload.newBatches.forEach((asset) => {
      if (asset && asset.customId) candidates.push(asset);
    });
  }
  const unique = new Map();
  candidates.forEach((asset) => unique.set(asset.customId, asset));
  return Array.from(unique.values());
}

function applyTransferredAssetsToLocalState(assets = []) {
  const updatedIds = [];
  assets.forEach((asset) => {
    if (!asset?.customId) return;
    const merged = upsertAssetInLocalState(asset);
    if (merged?.customId) updatedIds.push(merged.customId);
  });
  if (!updatedIds.length) return [];
  renderTable();
  rerenderOpenDetailsModalIfNeeded();
  if (cmdbState.assetId && updatedIds.includes(cmdbState.assetId)) {
    refreshCmdbModal(cmdbState.assetId, cmdbState.activeTab || 'maintenance').catch(() => {});
  }
  if (groupCmdbState.groupName) {
    refreshGroupCmdbModal().catch(() => {});
  }
  updateSpecVerificationSnapshotFromLocalAssets();
  checkGlobalEOLAlerts();
  return updatedIds;
}

function rerenderOpenDetailsModalIfNeeded() {
  const detailsModalEl = document.getElementById('detailsModal');
  if (!detailsModalEl || !detailsModalEl.classList.contains('show')) return;
  if (!activeDetailsContext) return;
  window.viewAssetDetailsByContext(activeDetailsContext);
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
      summaryEl.textContent = `Reviewed ${evaluated} records. RAM detection confidence: ${(ramPrecision * 100).toFixed(0)}%.`;
      summaryEl.setAttribute('title', 'This checks imported and created assets against known specifications and flags records needing review.');
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
  if (currentInventoryView !== 'parents') {
    showMessage('Bulk spec review is available in Parent Assets view only.', 'info');
    return;
  }
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
function getCurrentViewMeta(view = currentInventoryView) {
  const normalized = normalizeInventoryView(view);
  const map = {
    parents: {
      searchPlaceholder: 'Search parent asset name, ID, serial, tag...',
      headerName: 'Asset Group',
      headerType: 'Asset Type',
      headerQty: 'Total Quantity',
      headerLocation: 'Locations Found',
      typeFilterLabel: 'All Asset Types',
      emptyText: 'No parent assets found matching filters.',
    },
    components: {
      searchPlaceholder: 'Search component, serial, tag, parent...',
      headerName: 'Component Group',
      headerType: 'Component Type',
      headerQty: 'Installed Components',
      headerLocation: 'Installed In Parents',
      typeFilterLabel: 'All Component Types',
      emptyText: 'No installed components found matching filters.',
    },
    accessories: {
      searchPlaceholder: 'Search accessory, serial/tag, assigned asset/user...',
      headerName: 'Accessory Group',
      headerType: 'Accessory Type',
      headerQty: 'Total Quantity',
      headerLocation: 'Locations Found',
      typeFilterLabel: 'All Accessory Types',
      emptyText: 'No accessories found matching filters.',
    },
    consumables: {
      searchPlaceholder: 'Search consumable, part number, vendor, location...',
      headerName: 'Consumable Group',
      headerType: 'Consumable Type',
      headerQty: 'Total Quantity',
      headerLocation: 'Locations Found',
      typeFilterLabel: 'All Consumable Types',
      emptyText: 'No consumables found matching filters.',
    },
    spare_stock: {
      searchPlaceholder: 'Search spare stock, part number, compatibility, vendor...',
      headerName: 'Spare Stock Group',
      headerType: 'Part Type',
      headerQty: 'Stock Quantity',
      headerLocation: 'Locations Found',
      typeFilterLabel: 'All Spare Stock Types',
      emptyText: 'No spare stock items found matching filters.',
    },
    licenses: {
      searchPlaceholder: 'Search license/software, assignment, expiry, vendor...',
      headerName: 'License Group',
      headerType: 'License Type',
      headerQty: 'Total Quantity',
      headerLocation: 'Locations Found',
      typeFilterLabel: 'All License Types',
      emptyText: 'No licenses found matching filters.',
    },
  };
  return map[normalized] || map.parents;
}

function getAssetViewTypeLabel(asset, view = currentInventoryView) {
  const normalized = normalizeInventoryView(view);
  if (normalized === 'components') return inferComponentTypeFromAsset(asset) || 'Component';
  if (normalized === 'accessories') return inferAccessoryTypeFromAsset(asset) || 'Accessory';
  if (normalized === 'consumables') return inferConsumableTypeFromAsset(asset) || 'Consumable';
  if (normalized === 'licenses') return inferLicenseTypeFromAsset(asset) || 'License';
  if (normalized === 'spare_stock') return 'Spare Stock';
  return formatType(asset?.type);
}

function getAssetsForInventoryViewFromList(assets, view = currentInventoryView) {
  const source = Array.isArray(assets) ? assets : [];
  const normalizedView = normalizeInventoryView(view);
  if (normalizedView === 'components') {
    return source.filter((asset) => isInstalledComponentAsset(asset));
  }
  if (normalizedView === 'accessories') {
    return source.filter((asset) => isAccessoryViewAsset(asset));
  }
  if (normalizedView === 'consumables') {
    return source.filter((asset) => isConsumableViewAsset(asset));
  }
  if (normalizedView === 'licenses') {
    return source.filter((asset) => isLicenseViewAsset(asset));
  }
  if (normalizedView === 'spare_stock') {
    return source.filter((asset) => isSparePartAsset(asset));
  }
  return source.filter((asset) => isParentViewAsset(asset));
}

function populateFilters() {
  const buildingSelect = document.getElementById('filterBuilding');
  const deptSelect = document.getElementById('filterDept');
  const typeSelect = document.getElementById('filterType');
  const lifecycleSelect = document.getElementById('filterLifecycle');
  const viewMeta = getCurrentViewMeta();

  if (!buildingSelect || !deptSelect || !typeSelect) return;

  const currentBuilding = buildingSelect.value;
  const currentDept = deptSelect.value;
  const currentType = typeSelect.value;
  const currentLifecycle = lifecycleSelect?.value || 'all';
  const currentBuildingDisplay = currentBuilding === 'all' ? 'all' : displayLocation(currentBuilding);
  const currentDeptDisplay = currentDept === 'all' ? 'all' : normalizeDepartmentLabel(currentDept);

  const fullAssetSource = Array.isArray(inventoryFilterSnapshotState.allAssets) && inventoryFilterSnapshotState.allAssets.length
    ? inventoryFilterSnapshotState.allAssets
    : currentAssets;
  const viewAssets = getAssetsForInventoryViewFromList(fullAssetSource, currentInventoryView);
  const allBuildings = getKnownBuildingOptions();
  const allDepartments = getKnownDepartmentOptions();
  let typeValues = [];

  if (currentInventoryView === 'spare_stock') {
    const stockRows = Array.isArray(inventoryFilterSnapshotState.spareStockRows) && inventoryFilterSnapshotState.spareStockRows.length
      ? inventoryFilterSnapshotState.spareStockRows
      : (Array.isArray(spareStockItemsCache) ? spareStockItemsCache : []);
    typeValues = Array.from(new Set(stockRows
      .map((item) => normalizeComponentTypeLabel(item.componentType || item.category || 'Spare Stock'))
      .filter(Boolean)))
      .sort((a, b) => a.localeCompare(b));
  } else {
    if (currentInventoryView === 'parents') {
      typeValues = Array.from(new Set(ASSET_TYPES.map((at) => at.value).filter(Boolean)));
    } else {
      typeValues = Array.from(new Set(viewAssets.map((asset) => getAssetViewTypeLabel(asset, currentInventoryView)).filter(Boolean)))
        .sort((a, b) => String(a).localeCompare(String(b)));
    }
  }

  buildingSelect.innerHTML = '<option value="all">All Buildings</option>' + allBuildings.map((b) => `<option value="${b}">${b}</option>`).join('');
  deptSelect.innerHTML = '<option value="all">All Departments</option>' + allDepartments.map((d) => `<option value="${d}">${d}</option>`).join('');
  typeSelect.innerHTML = `<option value="all">${viewMeta.typeFilterLabel}</option>` + typeValues.map((value) => {
    const label = currentInventoryView === 'parents'
      ? (ASSET_TYPES.find((at) => normalizeValue(at.value) === normalizeValue(value))?.label || formatType(value))
      : value;
    return `<option value="${value}">${label}</option>`;
  }).join('');

  if (allBuildings.includes(currentBuildingDisplay) || currentBuildingDisplay === 'all') buildingSelect.value = currentBuildingDisplay;
  if (allDepartments.includes(currentDeptDisplay) || currentDeptDisplay === 'all') deptSelect.value = currentDeptDisplay;
  if (Array.from(typeSelect.options).some((option) => option.value === currentType) || currentType === 'all') typeSelect.value = currentType;
  if (lifecycleSelect) {
    const lifecycleOptionMap = new Map();
    Array.from(lifecycleSelect.options).forEach((option) => {
      lifecycleOptionMap.set(String(option.value || '').trim(), String(option.textContent || '').trim() || displayLifecycleStatus(option.value));
    });
    getKnownLifecycleOptions().forEach((value) => {
      if (!lifecycleOptionMap.has(value)) lifecycleOptionMap.set(value, displayLifecycleStatus(value));
    });
    const orderedKnown = Array.from(lifecycleOptionMap.keys());
    lifecycleSelect.innerHTML = orderedKnown.map((value, index) => (
      `<option value="${value}">${index === 0 && value === 'all' ? 'All Lifecycle' : lifecycleOptionMap.get(value)}</option>`
    )).join('');
    lifecycleSelect.value = Array.from(lifecycleSelect.options).some((option) => option.value === currentLifecycle)
      ? currentLifecycle
      : 'all';
  }
}

function syncFilters() {
  if (currentInventoryView === 'spare_stock') {
    renderTable();
    return;
  }
  inventoryPageState.page = 1;
  loadAssets().catch((error) => {
    showMessage(error.message || 'Failed to refresh inventory list.', 'error');
  });
}
function resetFilters() {
  inventorySavedView = 'all';
  localStorage.setItem('opsmind_inventory_saved_view', inventorySavedView);
  syncInventorySavedViewControl();
  document.getElementById('filterBuilding').value = 'all';
  document.getElementById('filterDept').value = 'all';
  document.getElementById('filterType').value = 'all';
  const lifecycleSelect = document.getElementById('filterLifecycle');
  if (lifecycleSelect) lifecycleSelect.value = 'all';
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';
  if (currentInventoryView === 'spare_stock') {
    renderTable();
    return;
  }
  inventoryPageState.page = 1;
  loadAssets().catch((error) => {
    showMessage(error.message || 'Failed to reset filters.', 'error');
  });
}

function filterGroupTable() {
  if (currentInventoryView === 'spare_stock') {
    renderTable();
    return;
  }
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }
  searchDebounceTimer = setTimeout(() => {
    inventoryPageState.page = 1;
    loadAssets().catch((error) => {
      showMessage(error.message || 'Failed to search inventory.', 'error');
    });
  }, 260);
}

function handleSearchKeyPress(event) {
  if (event.key === 'Enter') {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    inventoryPageState.page = 1;
    loadAssets().catch((error) => {
      showMessage(error.message || 'Failed to search inventory.', 'error');
    });
  }
}

function shouldRefreshInventoryFilterSnapshot(force = false) {
  if (force) return true;
  if (!Array.isArray(inventoryFilterSnapshotState.allAssets) || !inventoryFilterSnapshotState.allAssets.length) return true;
  if (!Number(inventoryFilterSnapshotState.loadedAt)) return true;
  return (Date.now() - Number(inventoryFilterSnapshotState.loadedAt)) > INVENTORY_FILTER_SNAPSHOT_TTL_MS;
}

async function refreshInventoryFilterSnapshot(force = false) {
  if (!shouldRefreshInventoryFilterSnapshot(force)) return;
  if (inventoryFilterSnapshotState.inFlightPromise) {
    await inventoryFilterSnapshotState.inFlightPromise;
    return;
  }
  inventoryFilterSnapshotState.loading = true;
  inventoryFilterSnapshotState.inFlightPromise = (async () => {
    let fullAssets = [];
    let page = 1;
    let totalPages = 1;
    do {
      const response = await inventoryRequest(`/assets?paginate=true&page=${page}&pageSize=500`);
      if (!response.ok) throw new Error('Failed to load filter snapshot assets');
      const payload = await response.json();
      const items = Array.isArray(payload?.items) ? payload.items : [];
      fullAssets = fullAssets.concat(items);
      totalPages = Math.max(1, Number(payload?.totalPages || 1));
      page += 1;
    } while (page <= totalPages);

    let spareRows = [];
    try {
      const spareResponse = await inventoryRequest('/inventory/spare-stock');
      if (spareResponse.ok) {
        const sparePayload = await spareResponse.json();
        spareRows = Array.isArray(sparePayload?.items) ? sparePayload.items : [];
      }
    } catch (_spareError) {
      spareRows = [];
    }

    inventoryFilterSnapshotState.allAssets = fullAssets;
    inventoryFilterSnapshotState.spareStockRows = spareRows;
    inventoryFilterSnapshotState.loadedAt = Date.now();
  })()
    .catch((error) => {
      console.warn('[InventoryFilters] Failed to refresh full snapshot:', error?.message || error);
    })
    .finally(() => {
      inventoryFilterSnapshotState.loading = false;
      inventoryFilterSnapshotState.inFlightPromise = null;
    });
  await inventoryFilterSnapshotState.inFlightPromise;
}

function getKnownBuildingOptions() {
  const values = new Set();
  const pushLocation = (value) => {
    const label = displayLocation(value);
    if (label && normalizeValue(label) !== 'unknown') values.add(label);
  };

  INVENTORY_MAP_LOCATION_DEFINITIONS.forEach((entry) => {
    if (entry?.name) values.add(entry.name);
  });
  (Array.isArray(BUILDINGS) ? BUILDINGS : []).forEach((value) => pushLocation(value));
  (Array.isArray(inventoryFilterSnapshotState.allAssets) ? inventoryFilterSnapshotState.allAssets : []).forEach((asset) => {
    const specs = getAssetSpecs(asset);
    pushLocation(specs?.mapLocationHint);
    pushLocation(specs?.mapLocation);
    pushLocation(specs?.importedLocation);
    pushLocation(asset?.location);
    pushLocation(asset?.installedParentLocation);
  });
  (Array.isArray(inventoryFilterSnapshotState.spareStockRows) ? inventoryFilterSnapshotState.spareStockRows : []).forEach((row) => {
    pushLocation(row?.location);
  });

  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

function getKnownDepartmentOptions() {
  const standard = STANDARD_MIU_DEPARTMENTS.slice();
  const standardTokenSet = new Set(standard.map((label) => normalizeDepartmentForFilter(label)));
  const extras = new Set();

  (Array.isArray(DEPARTMENTS) ? DEPARTMENTS : []).forEach((value) => {
    const label = normalizeDepartmentLabel(value);
    if (!label) return;
    if (!standardTokenSet.has(normalizeDepartmentForFilter(label))) extras.add(label);
  });
  (Array.isArray(inventoryFilterSnapshotState.allAssets) ? inventoryFilterSnapshotState.allAssets : []).forEach((asset) => {
    const label = normalizeDepartmentLabel(asset?.department);
    if (!label) return;
    if (!standardTokenSet.has(normalizeDepartmentForFilter(label))) extras.add(label);
  });

  const sortedExtras = Array.from(extras).sort((a, b) => a.localeCompare(b));
  return [...standard, ...sortedExtras];
}

function getKnownLifecycleOptions() {
  const known = new Set([
    'in_stock',
    'assigned',
    'in_use',
    'under_maintenance',
    'pending_repair',
    'in_transit',
    'reserved',
    'retired',
    'disposed',
    'lost_stolen',
    'eol_expired',
  ]);
  (Array.isArray(inventoryFilterSnapshotState.allAssets) ? inventoryFilterSnapshotState.allAssets : []).forEach((asset) => {
    const value = normalizeLifecycleStatus(asset?.lifecycleStatus || asset?.lifecycle_status || '');
    if (value) known.add(value);
  });
  return Array.from(known);
}

function severityClass(severity) {
  const key = normalizeValue(severity);
  if (['critical', 'urgent', 'high', 'danger', 'red'].includes(key)) return 'is-urgent';
  if (['medium', 'warning', 'review', 'yellow'].includes(key)) return 'is-review';
  if (['success', 'healthy', 'good', 'green'].includes(key)) return 'is-healthy';
  if (['neutral', 'unknown', 'missing', 'gray', 'grey'].includes(key)) return 'is-neutral';
  return 'is-info';
}

function inventory360Number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function inventory360Cost(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function inventory360Currency(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 'Cost data missing';
  return formatCurrencyEGP(parsed);
}

function getInventory360AssetCost(asset = {}) {
  const specs = getAssetSpecs(asset);
  const purchaseCost = inventory360Cost(asset.purchaseCost ?? specs.purchaseCost ?? specs.purchase_cost);
  const replacementCost = inventory360Cost(asset.replacementCost ?? specs.replacementCost ?? specs.replacement_cost);
  const currentValue = inventory360Cost(asset.currentValue ?? asset.estimatedValue ?? specs.currentValue ?? specs.estimatedValue);
  const maintenanceCost = inventory360Cost(asset.maintenanceCost ?? asset.repairCost ?? specs.maintenanceCost ?? specs.repairCost);
  return {
    purchaseCost,
    replacementCost,
    currentValue,
    maintenanceCost,
    hasAny: [purchaseCost, replacementCost, currentValue, maintenanceCost].some((value) => value !== null),
  };
}

function getInventory360StockCost(row = {}) {
  const qty = inventory360Number(row.quantityAvailable ?? row.quantity ?? row.availableQuantity, 0);
  const unitCost = inventory360Cost(row.unitCost ?? row.averageUnitCost ?? row.cost);
  return unitCost === null ? null : qty * unitCost;
}

function getInventory360AllAssets() {
  return Array.isArray(inventoryFilterSnapshotState.allAssets) && inventoryFilterSnapshotState.allAssets.length
    ? inventoryFilterSnapshotState.allAssets
    : currentAssets;
}

function getInventory360SpareRows() {
  return Array.isArray(inventoryFilterSnapshotState.spareStockRows) && inventoryFilterSnapshotState.spareStockRows.length
    ? inventoryFilterSnapshotState.spareStockRows
    : (Array.isArray(spareStockItemsCache) ? spareStockItemsCache : []);
}

function countInventory360Duplicates(assets = []) {
  const counts = new Map();
  assets.forEach((asset) => {
    const key = normalizeValue(getDisplayAssetTag(asset) || asset.customId || '');
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Array.from(counts.values()).filter((count) => count > 1).length;
}

function getInventory360ProcurementBoard() {
  return inventory360AnalyticsState.board || procurementBoardState.board || null;
}

function buildInventory360Summary() {
  const assets = getInventory360AllAssets();
  const stockRows = getInventory360SpareRows();
  const board = getInventory360ProcurementBoard() || {};
  const requests = Array.isArray(board.requests) ? board.requests : [];
  const recommendations = Array.isArray(board.aiRecommendations) ? board.aiRecommendations : [];
  const analytics = board.analytics || {};
  const priorities = board.priorities || {};
  const statusCounts = board.statusCounts || {};
  const activeAssets = assets.filter((asset) => !['retired', 'disposed', 'lost_stolen'].includes(normalizeLifecycleStatus(asset.lifecycleStatus || asset.status || ''))).length;
  const inactiveAssets = Math.max(0, assets.length - activeAssets);
  const maintenanceAssets = assets.filter((asset) => ['under_maintenance', 'pending_repair'].includes(normalizeLifecycleStatus(asset.lifecycleStatus || asset.status || ''))).length;
  const inTransitAssets = assets.filter((asset) => normalizeLifecycleStatus(asset.lifecycleStatus || asset.status || '') === 'in_transit').length;
  const unassignedAssets = assets.filter((asset) => normalizeDepartmentForFilter(getAssetDisplayDepartment(asset)) === normalizeDepartmentForFilter('Unassigned')).length;
  const typeMix = assets.reduce((acc, asset) => {
    const label = getAssetCategoryKey(asset) || canonicalType(asset.type) || 'asset';
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
  const categoryCounts = {
    parents: getAssetsForInventoryViewFromList(assets, 'parents').length,
    components: getAssetsForInventoryViewFromList(assets, 'components').length,
    accessories: getAssetsForInventoryViewFromList(assets, 'accessories').length,
    consumables: getAssetsForInventoryViewFromList(assets, 'consumables').length,
    spare_stock: stockRows.length,
    licenses: getAssetsForInventoryViewFromList(assets, 'licenses').length,
  };
  const spareStockQuantity = stockRows.reduce((sum, row) => sum + inventory360Number(row.quantityAvailable ?? row.quantity ?? row.availableQuantity, 0), 0);
  const highRiskAssets = assets.filter((asset) => isAssetHighRisk(asset)).length;
  const eolSoonAssets = assets.filter((asset) => isAssetEolSoon(asset)).length;
  const staleTelemetryAssets = assets.filter((asset) => {
    const specs = getAssetSpecs(asset);
    const lastSeen = specs.lastSeenAt || specs.wifiLastSeenAt || specs.mockWifiLastSeenAt || specs.lastNetworkSeenAt;
    if (!lastSeen && !(asset.telemetryEnabledDerived || specs.telemetryEnabled || specs.telemetryApplicable)) return false;
    const parsed = lastSeen ? new Date(lastSeen) : null;
    return !parsed || Number.isNaN(parsed.getTime()) || (Date.now() - parsed.getTime()) > 24 * 3600000;
  }).length;
  const warrantyExpiring = assets.filter((asset) => {
    const end = asset.warrantyEndDate || getAssetSpecs(asset).warrantyEndDate || getAssetSpecs(asset).warrantyEnd;
    if (!end) return false;
    const parsed = new Date(end);
    if (Number.isNaN(parsed.getTime())) return false;
    const days = (parsed.getTime() - Date.now()) / 86400000;
    return days >= 0 && days <= 90;
  }).length;
  const missingSerials = assets.filter((asset) => !getDisplaySerial(asset)).length;
  const missingDepartments = assets.filter((asset) => normalizeDepartmentForFilter(getAssetDisplayDepartment(asset)) === normalizeDepartmentForFilter('Unassigned')).length;
  const missingLocations = assets.filter((asset) => {
    const loc = getAssetDisplayLocation(asset);
    return !loc || normalizeValue(loc) === 'unknown' || normalizeValue(loc) === 'unassigned';
  }).length;
  const missingPurchaseDates = assets.filter((asset) => {
    const specs = getAssetSpecs(asset);
    return !(asset.purchaseDate || asset.acquiredAt || specs.purchaseDate || specs.acquiredAt);
  }).length;
  const missingWarranty = assets.filter((asset) => {
    const specs = getAssetSpecs(asset);
    return !(asset.warrantyEndDate || specs.warrantyEndDate || specs.warrantyEnd);
  }).length;
  const orphanRelatedItems = assets.filter((asset) => hasLinkedComponentIssue(asset)).length;
  const duplicateTags = countInventory360Duplicates(assets);
  const lowStockRows = stockRows.filter((row) => stockItemMatchesSavedView(row, 'low_stock'));
  const fifoWarnings = inventory360Number(analytics?.fifo?.staleBatchCount, 0);
  const eoqMissing = inventory360Number(analytics?.eoqMoq?.missingDataItems, 0);
  const eoqConflicts = inventory360Number(analytics?.eoqMoq?.moqConflictItems, 0);
  const deadStock = inventory360Number(analytics?.fifo?.deadStockCount ?? analytics?.deadStockCount, 0);
  const costRows = assets.map(getInventory360AssetCost);
  const totalAssetValue = costRows.reduce((sum, row) => sum + inventory360Number(row.currentValue ?? row.purchaseCost, 0), 0);
  const replacementForecast = costRows.reduce((sum, row) => sum + inventory360Number(row.replacementCost, 0), 0);
  const maintenanceCost = costRows.reduce((sum, row) => sum + inventory360Number(row.maintenanceCost, 0), 0);
  const stockValue = stockRows.reduce((sum, row) => sum + inventory360Number(getInventory360StockCost(row), 0), 0);
  const missingCostData = costRows.filter((row) => !row.hasAny).length;
  const openRequests = requests.filter((row) => !['received', 'closed', 'cancelled', 'rejected'].includes(normalizeValue(row.status))).length;
  const pendingApprovals = inventory360Number(statusCounts.Submitted) + inventory360Number(statusCounts['Under Review']);
  const orderedTransit = requests.filter((row) => ['ordered', 'partiallyreceived'].includes(normalizeValue(row.status))).length;
  const receivingPending = inventory360Number(analytics.receivedVsPending?.pending, 0);
  const monthlySpend = inventory360Cost(analytics.monthlySpendingEstimate);

  return {
    assets,
    stockRows,
    board,
    totalAssets: assets.length,
    activeAssets,
    inactiveAssets,
    maintenanceAssets,
    inTransitAssets,
    unassignedAssets,
    typeMix,
    categoryCounts,
    spareStockQuantity,
    highRiskAssets,
    eolSoonAssets,
    staleTelemetryAssets,
    warrantyExpiring,
    missingSerials,
    missingDepartments,
    missingLocations,
    missingPurchaseDates,
    missingWarranty,
    orphanRelatedItems,
    duplicateTags,
    lowStockCount: lowStockRows.length || inventory360Number(priorities.lowStockItems?.length, 0),
    fifoWarnings,
    eoqMissing,
    eoqConflicts,
    deadStock,
    totalAssetValue,
    replacementForecast,
    maintenanceCost,
    stockValue,
    missingCostData,
    monthlySpend,
    openRequests,
    pendingApprovals,
    orderedTransit,
    receivingPending,
    recommendationCount: recommendations.length,
  };
}

function inventory360Evidence(title, evidence = [], missingData = []) {
  const evidenceRows = (Array.isArray(evidence) ? evidence : []).filter(Boolean);
  const missingRows = (Array.isArray(missingData) ? missingData : []).filter(Boolean);
  return `
    <details class="ops-360-evidence">
      <summary>View Evidence</summary>
      <div class="ops-360-evidence-body">
        <strong>${UI.escapeHTML(title || 'Evidence')}</strong>
        ${evidenceRows.length ? `<ul>${evidenceRows.map((row) => `<li>${UI.escapeHTML(row)}</li>`).join('')}</ul>` : '<p>No additional evidence rows.</p>'}
        ${missingRows.length ? `<p><strong>Missing data:</strong> ${UI.escapeHTML(missingRows.join(', '))}</p>` : ''}
      </div>
    </details>
  `;
}

function inventory360Card({ title, value, subtitle, severity = 'info', source = 'Deterministic', evidence = [], missingData = [], actions = [] } = {}) {
  return `
    <article class="ops-360-card ${severityClass(severity)}">
      <div class="ops-360-card-head">
        <div>
          <div class="ops-360-card-kicker">${UI.escapeHTML(source)}</div>
          <h3>${UI.escapeHTML(title || 'Inventory insight')}</h3>
        </div>
        <span class="ops-attention-pill ${severityClass(severity)}">${UI.escapeHTML(String(severity || 'Info'))}</span>
      </div>
      <div class="ops-360-card-value">${UI.escapeHTML(String(value ?? '-'))}</div>
      <p>${UI.escapeHTML(subtitle || '')}</p>
      ${inventory360Evidence(title, evidence, missingData)}
      ${actions.length ? `<div class="ops-360-actions">${actions.map((action, index) => `
        <button type="button" class="btn btn-sm ${index === 0 ? 'btn-primary' : 'btn-outline-primary'}" data-inventory-360-action="${UI.escapeHTML(action.action || '')}">
          ${UI.escapeHTML(action.label || 'Open')}
        </button>
      `).join('')}</div>` : ''}
    </article>
  `;
}

function renderInventory360Totals(summary = buildInventory360Summary()) {
  const el = document.getElementById('inventory360Totals');
  if (!el) return;
  const categories = [
    { label: 'All asset records', value: summary.totalAssets, action: 'view-parents', helper: 'DB-backed asset records' },
    { label: 'Parent Assets', value: summary.categoryCounts?.parents ?? 0, action: 'view-parents', helper: 'Lifecycle-managed units' },
    { label: 'Components', value: summary.categoryCounts?.components ?? 0, action: 'view-components', helper: 'Installed child items' },
    { label: 'Accessories', value: summary.categoryCounts?.accessories ?? 0, action: 'view-accessories', helper: 'Linked or standalone accessories' },
    { label: 'Consumables', value: summary.categoryCounts?.consumables ?? 0, action: 'view-consumables', helper: 'Consumable records' },
    { label: 'Spare Stock', value: summary.categoryCounts?.spare_stock ?? 0, action: 'view-spare-stock', helper: `${summary.spareStockQuantity || 0} quantity on hand` },
    { label: 'Licenses', value: summary.categoryCounts?.licenses ?? 0, action: 'view-licenses', helper: 'Software/license records' },
  ];
  el.innerHTML = categories.map((item, index) => `
    <button type="button" class="ops-total-card ${index === 0 ? 'is-primary' : ''}" data-inventory-360-action="${UI.escapeHTML(item.action)}">
      <span class="ops-total-card-label">${UI.escapeHTML(item.label)}</span>
      <strong>${UI.escapeHTML(String(item.value ?? 0))}</strong>
      <small>${UI.escapeHTML(item.helper)}</small>
    </button>
  `).join('');
}

function buildInventory360NextActions(summary) {
  const actions = [
    {
      title: 'Create procurement request',
      severity: summary.lowStockCount ? 'High' : 'Info',
      reason: `${summary.lowStockCount} low-stock item(s) or stock signal(s) need review.`,
      evidence: [`Low stock: ${summary.lowStockCount}`, `AI recommendations: ${summary.recommendationCount}`],
      action: 'procurement',
      label: 'Open Procurement',
      active: summary.lowStockCount > 0 || summary.recommendationCount > 0,
    },
    {
      title: 'Fix missing CMDB data',
      severity: summary.missingSerials + summary.missingDepartments + summary.missingLocations ? 'Medium' : 'Healthy',
      reason: 'Missing serial, location, department, purchase, or warranty data weakens AI confidence and audits.',
      evidence: [`Missing serials: ${summary.missingSerials}`, `Missing departments: ${summary.missingDepartments}`, `Missing locations: ${summary.missingLocations}`],
      action: 'missing-data',
      label: 'View Missing Data',
      active: summary.missingSerials + summary.missingDepartments + summary.missingLocations + summary.missingPurchaseDates + summary.missingWarranty > 0,
    },
    {
      title: 'Review high-risk / EOL assets',
      severity: summary.highRiskAssets + summary.eolSoonAssets ? 'High' : 'Healthy',
      reason: 'Lifecycle and risk signals suggest replacement, warranty, or maintenance planning.',
      evidence: [`High risk: ${summary.highRiskAssets}`, `EOL soon: ${summary.eolSoonAssets}`, `Warranty expiring: ${summary.warrantyExpiring}`],
      action: 'high-risk',
      label: 'Open High Risk',
      active: summary.highRiskAssets + summary.eolSoonAssets > 0,
    },
    {
      title: 'Receive stock / close procurement loop',
      severity: summary.receivingPending + summary.orderedTransit ? 'Medium' : 'Info',
      reason: 'Ordered or partially received procurement items may be waiting for receiving confirmation.',
      evidence: [`Ordered/in transit: ${summary.orderedTransit}`, `Receiving pending: ${summary.receivingPending}`],
      action: 'procurement',
      label: 'Open Procurement',
      active: summary.receivingPending + summary.orderedTransit > 0,
    },
  ].filter((row) => row.active);
  return actions.slice(0, 3);
}

function renderInventory360Analytics() {
  const grid = document.getElementById('inventory360Grid');
  if (!grid) return;
  const summary = buildInventory360Summary();
  const typeMixText = Object.entries(summary.typeMix)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([type, count]) => `${type}: ${count}`)
    .join(' | ') || 'No asset type mix yet';
  const dataQualityIssues = summary.missingSerials + summary.missingDepartments + summary.missingLocations + summary.missingPurchaseDates + summary.missingWarranty + summary.duplicateTags + summary.orphanRelatedItems;
  const stockIssues = summary.lowStockCount + summary.fifoWarnings + summary.eoqMissing + summary.eoqConflicts + summary.deadStock;
  const knownCostTotal = summary.totalAssetValue + summary.replacementForecast + summary.maintenanceCost + summary.stockValue;
  const nextActions = buildInventory360NextActions(summary);

  renderInventory360Totals(summary);
  grid.innerHTML = [
    inventory360Card({
      title: 'Inventory Health',
      value: summary.totalAssets,
      subtitle: `${summary.activeAssets} active | ${summary.inactiveAssets} inactive | ${summary.unassignedAssets} unassigned`,
      severity: summary.unassignedAssets || summary.maintenanceAssets ? 'Medium' : 'Healthy',
      evidence: [`Active assets: ${summary.activeAssets}`, `In transit: ${summary.inTransitAssets}`, `Maintenance/pending repair: ${summary.maintenanceAssets}`, `Type mix: ${typeMixText}`],
      actions: [{ label: 'Open Assets', action: 'assets' }],
    }),
    inventory360Card({
      title: 'Risk & EOL',
      value: summary.highRiskAssets + summary.eolSoonAssets,
      subtitle: `${summary.highRiskAssets} high-risk | ${summary.eolSoonAssets} EOL soon | ${summary.staleTelemetryAssets} stale telemetry`,
      severity: summary.highRiskAssets + summary.eolSoonAssets ? 'High' : 'Healthy',
      evidence: [`High risk assets: ${summary.highRiskAssets}`, `EOL soon: ${summary.eolSoonAssets}`, `Warranty expiring: ${summary.warrantyExpiring}`, `Stale/offline telemetry: ${summary.staleTelemetryAssets}`],
      missingData: summary.staleTelemetryAssets ? ['fresh telemetry readings'] : [],
      actions: [{ label: 'Open High Risk', action: 'high-risk' }, { label: 'Ask AI', action: 'ask-risk' }],
    }),
    inventory360Card({
      title: 'Data Quality',
      value: `${Math.max(0, summary.totalAssets - dataQualityIssues)}/${summary.totalAssets || 0}`,
      subtitle: `${dataQualityIssues} issue signal(s) across identity, location, cost, warranty, and relationships`,
      severity: dataQualityIssues ? 'Medium' : 'Healthy',
      evidence: [`Missing serials: ${summary.missingSerials}`, `Missing departments: ${summary.missingDepartments}`, `Missing locations: ${summary.missingLocations}`, `Duplicate tags: ${summary.duplicateTags}`, `Orphan related items: ${summary.orphanRelatedItems}`],
      missingData: ['purchase/warranty/cost fields improve 360 confidence'],
      actions: [{ label: 'View Missing Data', action: 'missing-data' }, { label: 'Open Import Tools', action: 'import' }, { label: 'Ask AI', action: 'ask-missing-data' }],
    }),
    inventory360Card({
      title: 'Stock & Reorder',
      value: stockIssues,
      subtitle: `${summary.lowStockCount} low-stock | ${summary.fifoWarnings} FIFO warning(s) | ${summary.eoqConflicts} EOQ/MOQ conflict(s)`,
      severity: stockIssues ? 'High' : 'Healthy',
      evidence: [`Low stock: ${summary.lowStockCount}`, `FIFO warnings: ${summary.fifoWarnings}`, `EOQ missing inputs: ${summary.eoqMissing}`, `Dead/obsolete stock signals: ${summary.deadStock}`],
      missingData: summary.eoqMissing ? ['annual demand', 'ordering cost', 'holding cost'] : [],
      actions: [{ label: 'Open Procurement', action: 'procurement' }, { label: 'Open Spare Stock', action: 'spare-stock' }],
    }),
    inventory360Card({
      title: 'Cost Overview',
      value: knownCostTotal > 0 ? inventory360Currency(knownCostTotal) : 'Cost data missing',
      subtitle: knownCostTotal > 0
        ? `${inventory360Currency(summary.totalAssetValue)} asset value | ${inventory360Currency(summary.stockValue)} stock value`
        : 'Add purchase cost / quote / invoice to improve analytics.',
      severity: summary.missingCostData ? 'Medium' : 'Healthy',
      evidence: [`Asset value from explicit fields: ${inventory360Currency(summary.totalAssetValue)}`, `Replacement forecast from explicit fields: ${inventory360Currency(summary.replacementForecast)}`, `Maintenance/repair cost fields: ${inventory360Currency(summary.maintenanceCost)}`, `Stock value on hand: ${inventory360Currency(summary.stockValue)}`, `Procurement spend pressure: ${inventory360Currency(summary.monthlySpend)}`],
      missingData: summary.missingCostData ? [`${summary.missingCostData} asset(s) missing cost evidence`] : [],
      actions: [{ label: 'View Cost Gaps', action: 'cost-gaps' }, { label: 'Open Finance', action: 'finance' }, { label: 'Ask AI', action: 'ask-cost' }],
    }),
    inventory360Card({
      title: 'Procurement Impact',
      value: summary.openRequests,
      subtitle: `${summary.pendingApprovals} pending approval | ${summary.orderedTransit} ordered/in transit | ${summary.recommendationCount} AI recommendation(s)`,
      severity: summary.pendingApprovals + summary.orderedTransit + summary.recommendationCount ? 'Medium' : 'Healthy',
      evidence: [`Open requests: ${summary.openRequests}`, `Pending approvals: ${summary.pendingApprovals}`, `Receiving pending: ${summary.receivingPending}`, `AI recommendations: ${summary.recommendationCount}`],
      actions: [{ label: 'Open Procurement', action: 'procurement' }],
    }),
    inventory360Card({
      title: 'Next Best Actions',
      value: nextActions.length || 'Clear',
      subtitle: nextActions.length ? 'Top actions from real evidence. Other options stay in More/Advanced flows.' : 'No critical next action detected from loaded evidence.',
      severity: nextActions.some((row) => normalizeValue(row.severity) === 'high') ? 'High' : (nextActions.length ? 'Medium' : 'Healthy'),
      evidence: nextActions.map((row) => `${row.title}: ${row.reason}`),
      actions: nextActions.map((row) => ({ label: row.label, action: row.action })),
    }),
  ].join('');
}

async function refreshInventory360ProcurementBoard(force = false) {
  const fresh = inventory360AnalyticsState.loadedAt && (Date.now() - inventory360AnalyticsState.loadedAt) < 45000;
  if (!force && fresh && inventory360AnalyticsState.board) return inventory360AnalyticsState.board;
  if (inventory360AnalyticsState.inFlightPromise) return inventory360AnalyticsState.inFlightPromise;
  inventory360AnalyticsState.loading = true;
  inventory360AnalyticsState.inFlightPromise = readInventoryJson('/inventory/procurement/board?status=all')
    .then((board) => {
      inventory360AnalyticsState.board = board;
      inventory360AnalyticsState.loadedAt = Date.now();
      renderInventory360Analytics();
      return board;
    })
    .catch((error) => {
      console.warn('[Inventory360] Procurement board unavailable:', error?.message || error);
      renderInventory360Analytics();
      return null;
    })
    .finally(() => {
      inventory360AnalyticsState.loading = false;
      inventory360AnalyticsState.inFlightPromise = null;
    });
  return inventory360AnalyticsState.inFlightPromise;
}

function inventoryGemmaFeatureRows(aiReady, diagnostics = {}) {
  const source = aiReady ? 'Gemma ready' : 'Fallback available';
  const model = diagnostics?.llm_model || diagnostics?.model || 'Gemma model';
  return [
    ['Inventory AI Daily Briefing', 'Yes', source, 'Daily brief endpoint should use Gemma for narrative when ready.'],
    ['Explain Inventory 360', 'Hybrid', source, 'Inventory facts are deterministic; Gemma explains the loaded evidence.'],
    ['Asset health summary', 'Yes', source, 'CMDB evidence packet should route through Inventory AI service.'],
    ['AI Risk Score', 'Hybrid', source, 'Risk facts are deterministic; Gemma can explain reasons and next actions.'],
    ['Draft Ticket', 'Yes/Hybrid', source, 'Draft text can be Gemma-generated, but user review remains required.'],
    ['AI Import Repair', 'Hybrid', source, 'Column/error evidence is compact; safe fixes still require review.'],
    ['AI Map Columns', 'Hybrid', source, 'Header/sample evidence is sent only when mapping needs AI.'],
    ['AI Spec Verification', 'Hybrid', source, 'Trusted-source/spec facts remain evidence-backed.'],
    ['Procurement recommendation explanation', 'Hybrid', source, 'Uses real stock/EOL/audit/request evidence.'],
    ['Copilot prompt response', 'Yes/Hybrid', source, `Routes through Inventory AI service when ${model} is available.`],
  ];
}

async function fetchInventoryGemmaDiagnostics() {
  const startedAt = performance.now();
  const [healthRes, diagnosticsRes, backendRes, testRes] = await Promise.allSettled([
    fetch(`${INVENTORY_AI_URL}/health`).then((response) => response.json()),
    fetch(`${INVENTORY_AI_URL}/ai/diagnostics`).then((response) => response.json()),
    readInventoryJson('/inventory/ai/diagnostics'),
    postInventoryJson('/inventory/ai/test-gemma', {}),
  ]);
  return {
    health: healthRes.status === 'fulfilled' ? healthRes.value : { error: healthRes.reason?.message || 'Inventory AI health unavailable' },
    diagnostics: diagnosticsRes.status === 'fulfilled' ? diagnosticsRes.value : { error: diagnosticsRes.reason?.message || 'Inventory AI diagnostics unavailable' },
    backend: backendRes.status === 'fulfilled' ? backendRes.value : { error: backendRes.reason?.message || 'Backend diagnostics unavailable' },
    test: testRes.status === 'fulfilled' ? testRes.value : { error: testRes.reason?.message || 'Backend Gemma test unavailable' },
    latencyMs: Math.round(performance.now() - startedAt),
  };
}

function renderInventoryGemmaDiagnosticsBody(result = {}) {
  const health = result.health || {};
  const diagnostics = result.diagnostics || {};
  const backend = result.backend || {};
  const test = result.test || {};
  const aiReady = String(health.llm_status || diagnostics.llm_status || '').toLowerCase() === 'ready'
    || Boolean(test.llmUsed || test.usedGemma || test.gemmaUsed);
  const model = health.llm_model || diagnostics.llm_model || diagnostics.model || test.model || 'Unknown';
  const provider = health.llm_provider || diagnostics.llm_provider || 'Unknown';
  const lastError = health.llm_last_error || diagnostics.llm_last_error || backend.error || test.error || '';
  const rows = inventoryGemmaFeatureRows(aiReady, diagnostics);
  return `
    <div class="ops-gemma-diagnostics">
      <div class="ops-gemma-summary ${aiReady ? 'is-ready' : 'is-fallback'}">
        <div>
          <div class="ops-gemma-kicker">Inventory AI diagnostics</div>
          <h3>${UI.escapeHTML(aiReady ? 'Gemma is ready for Inventory AI' : 'Inventory AI is using fallback readiness')}</h3>
          <p>${UI.escapeHTML(aiReady ? 'Calculations stay deterministic; Gemma is available for summaries, explanations, and recommendation wording.' : 'Fallback remains available. Retest after Ollama/Gemma is running and warmed up.')}</p>
        </div>
        <span class="ops-attention-pill ${aiReady ? 'is-healthy' : 'is-review'}">${UI.escapeHTML(aiReady ? 'Gemma ready' : 'Fallback mode')}</span>
      </div>
      <div class="ops-gemma-metrics">
        <div><strong>Provider</strong><span>${UI.escapeHTML(provider)}</span></div>
        <div><strong>Model</strong><span>${UI.escapeHTML(model)}</span></div>
        <div><strong>Latency</strong><span>${UI.escapeHTML(`${result.latencyMs ?? '-'} ms`)}</span></div>
        <div><strong>Timeout</strong><span>${UI.escapeHTML(String(diagnostics.timeout_seconds ?? diagnostics.timeoutSeconds ?? 'Unknown'))}</span></div>
        <div><strong>Keep alive</strong><span>${UI.escapeHTML(String(diagnostics.keep_alive ?? diagnostics.keepAlive ?? 'Unknown'))}</span></div>
        <div><strong>Backend bridge</strong><span>${UI.escapeHTML(backend.error ? 'Unavailable' : 'Reachable')}</span></div>
      </div>
      ${lastError ? `<div class="ops-gemma-warning">Latest diagnostic note: ${UI.escapeHTML(String(lastError).replace(/_/g, ' '))}</div>` : ''}
      <div class="table-responsive">
        <table class="table table-sm align-middle ops-gemma-table">
          <thead><tr><th>AI feature</th><th>Requires Gemma</th><th>Readiness/source</th><th>What this verifies</th><th></th></tr></thead>
          <tbody>
            ${rows.map(([feature, requires, source, note]) => `
              <tr>
                <td>${UI.escapeHTML(feature)}</td>
                <td>${UI.escapeHTML(requires)}</td>
                <td><span class="ops-attention-pill ${aiReady ? 'is-healthy' : 'is-review'}">${UI.escapeHTML(source)}</span></td>
                <td>${UI.escapeHTML(note)}</td>
                <td class="text-end">
                  <button type="button" class="btn btn-sm btn-outline-secondary" data-inventory-gemma-retest>Test</button>
                  <button type="button" class="btn btn-sm btn-outline-primary" data-inventory-gemma-ask="${UI.escapeHTML(feature)}">Ask Gemma</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function openInventoryGemmaDiagnostics() {
  const modalId = 'inventoryGemmaDiagnosticsModal';
  let modalEl = document.getElementById(modalId);
  if (!modalEl) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal fade" id="${modalId}" tabindex="-1" aria-labelledby="${modalId}Title" aria-hidden="true">
        <div class="modal-dialog modal-xl modal-dialog-scrollable">
          <div class="modal-content ops-diagnostics-modal">
            <div class="modal-header">
              <div>
                <h5 class="modal-title" id="${modalId}Title">Gemma diagnostics</h5>
                <div class="modal-subtitle">Read-only checks for Inventory AI routing, model readiness, and fallback labels.</div>
              </div>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close Gemma diagnostics"></button>
            </div>
            <div class="modal-body" id="${modalId}Body">
              <div class="ops-loading-stack">
                <span class="ops-skeleton-line lg"></span>
                <span class="ops-skeleton-line md"></span>
                <span class="ops-skeleton-card"></span>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Close</button>
              <button type="button" class="btn btn-primary" id="${modalId}RetestBtn">Retest Gemma</button>
            </div>
          </div>
        </div>
      </div>
    `);
    modalEl = document.getElementById(modalId);
    modalEl.addEventListener('click', (event) => {
      if (event.target?.closest('[data-inventory-gemma-retest]')) openInventoryGemmaDiagnostics();
      const askBtn = event.target?.closest('[data-inventory-gemma-ask]');
      if (askBtn) {
        const feature = askBtn.getAttribute('data-inventory-gemma-ask') || 'Inventory AI';
        openInventoryCopilotWithPrompt(`Test ${feature} with Gemma. Use real inventory evidence only and state whether Gemma, hybrid, deterministic, or fallback was used.`);
      }
    });
    document.getElementById(`${modalId}RetestBtn`)?.addEventListener('click', () => openInventoryGemmaDiagnostics());
  }
  const body = document.getElementById(`${modalId}Body`);
  if (body) {
    body.innerHTML = `
      <div class="ops-loading-stack">
        <span class="ops-skeleton-line lg"></span>
        <span class="ops-skeleton-line md"></span>
        <span class="ops-skeleton-card"></span>
      </div>
    `;
  }
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  try {
    const result = await fetchInventoryGemmaDiagnostics();
    if (body) body.innerHTML = renderInventoryGemmaDiagnosticsBody(result);
  } catch (error) {
    if (body) {
      body.innerHTML = `
        <div class="ops-empty-state-card ops-empty-state-card-danger">
          <div class="ops-empty-state-icon"><i class="bi bi-cpu"></i></div>
          <div>
            <div class="ops-empty-state-title">Diagnostics unavailable</div>
            <div class="ops-empty-state-copy">${UI.escapeHTML(error.message || 'Could not complete read-only Gemma diagnostics.')}</div>
          </div>
        </div>
      `;
    }
  }
}

function openInventoryCopilotWithPrompt(prompt = '') {
  const value = String(prompt || '').trim();
  if (value) sessionStorage.setItem('inventory_copilot_prefill', value);
  if (value && typeof window.openInventoryAiChatWithPrompt === 'function') {
    window.openInventoryAiChatWithPrompt(value);
    return;
  }
  if (typeof window.toggleInventoryAiChat === 'function') {
    window.toggleInventoryAiChat(true);
  } else {
    sessionStorage.setItem('inventory_command_action', 'ai');
  }
}

function handleInventory360Action(action = '') {
  const value = String(action || '').trim();
  const viewActionMap = {
    'view-parents': 'parents',
    'view-components': 'components',
    'view-accessories': 'accessories',
    'view-consumables': 'consumables',
    'view-spare-stock': 'spare_stock',
    'view-licenses': 'licenses',
  };
  if (viewActionMap[value]) {
    setInventorySavedView('all', { skipLoad: true });
    setInventoryView(viewActionMap[value]);
    return;
  }
  if (value === 'gemma-diagnostics') {
    openInventoryGemmaDiagnostics();
    return;
  }
  if (value === 'assets') {
    setInventorySavedView('all');
    return;
  }
  if (value === 'high-risk') {
    setInventorySavedView('high_risk');
    return;
  }
  if (value === 'missing-data' || value === 'cost-gaps') {
    setInventorySavedView('missing_data');
    return;
  }
  if (value === 'spare-stock') {
    setInventorySavedView('low_stock');
    return;
  }
  if (value === 'import') {
    if (typeof window.openImportAssetsModal === 'function') window.openImportAssetsModal();
    return;
  }
  if (value === 'procurement' || value === 'finance') {
    window.location.href = value === 'finance' ? '/pages/procurement.html#finance' : '/pages/procurement.html';
    return;
  }
  if (value === 'next-best') {
    const actions = buildInventory360NextActions(buildInventory360Summary());
    const prompt = actions.length
      ? `Explain the Inventory 360 next best actions and why they matter: ${actions.map((row) => `${row.title} - ${row.reason}`).join('; ')}`
      : 'Explain Inventory 360 and confirm there are no critical next actions from the loaded evidence.';
    openInventoryCopilotWithPrompt(prompt);
    return;
  }
  if (value === 'explain') {
    openInventoryCopilotWithPrompt('Explain Inventory 360. Use real loaded inventory evidence only: health, risk, data quality, stock, cost, procurement impact, and next best actions.');
    return;
  }
  if (value === 'ask-risk') openInventoryCopilotWithPrompt('Explain the high-risk and EOL assets from Inventory 360 evidence. Do not invent asset facts.');
  else if (value === 'ask-missing-data') openInventoryCopilotWithPrompt('What inventory data is missing and what should I fix first? Use Inventory 360 evidence only.');
  else if (value === 'ask-cost') openInventoryCopilotWithPrompt('Explain the inventory cost impact and list missing cost data. Do not invent costs.');
}

function renderInventoryGroupPager() {
  const pagerEl = document.getElementById('inventoryGroupPager');
  if (!pagerEl) return;
  const total = Number(inventoryPageState.total || 0);
  const totalPages = Math.max(1, Number(inventoryPageState.totalPages || 1));
  const page = Math.max(1, Number(inventoryPageState.page || 1));
  if (total <= 0) {
    pagerEl.classList.add('d-none');
    pagerEl.innerHTML = '';
    updateInventoryAiFloatingOffset();
    return;
  }
  const hasPrev = page > 1;
  const hasNext = page < totalPages;
  pagerEl.classList.remove('d-none');
  pagerEl.innerHTML = `
    <div class="d-flex justify-content-between align-items-center">
      <small class="text-muted">Page ${page} of ${totalPages} â€¢ Total groups/items: ${total}</small>
      <div class="d-flex gap-2">
        <button class="btn btn-sm btn-outline-secondary" ${hasPrev ? '' : 'disabled'} onclick="window.changeInventoryPage(-1)">
          <i class="bi bi-arrow-left me-1"></i>Previous
        </button>
        <button class="btn btn-sm btn-outline-secondary" ${hasNext ? '' : 'disabled'} onclick="window.changeInventoryPage(1)">
          Next<i class="bi bi-arrow-right ms-1"></i>
        </button>
      </div>
    </div>
  `;
  updateInventoryAiFloatingOffset();
}

window.changeInventoryPage = (delta = 0) => {
  const nextPage = Math.max(1, Number(inventoryPageState.page || 1) + Number(delta || 0));
  if (nextPage === inventoryPageState.page) return;
  inventoryPageState.page = nextPage;
  loadAssets().catch((error) => {
    showMessage(error.message || 'Failed to change page.', 'error');
  });
};

function renderTable() {
  const tableBody = document.getElementById('inventoryTableBody');
  if (!tableBody) return;
  syncInventorySavedViewControl();
  const headerName = document.getElementById('groupTableHeaderName');
  const headerType = document.getElementById('groupTableHeaderType');
  const headerQty = document.getElementById('groupTableHeaderQty');
  const headerLoc = document.getElementById('groupTableHeaderLocation');
  const searchInput = document.getElementById('searchInput');
  const viewMeta = getCurrentViewMeta();
  Object.entries(INVENTORY_VIEW_BUTTON_IDS).forEach(([view, buttonId]) => {
    const button = document.getElementById(buttonId);
    if (!button) return;
    button.className = normalizeInventoryView(view) === normalizeInventoryView(currentInventoryView)
      ? 'btn btn-sm btn-primary'
      : 'btn btn-sm btn-outline-primary';
  });

  if (searchInput) searchInput.placeholder = viewMeta.searchPlaceholder;
  if (headerName) headerName.textContent = viewMeta.headerName;
  if (headerType) headerType.textContent = viewMeta.headerType;
  if (headerQty) headerQty.textContent = viewMeta.headerQty;
  if (headerLoc) headerLoc.textContent = viewMeta.headerLocation;

  const buildingFilter = document.getElementById('filterBuilding')?.value;
  const deptFilter = document.getElementById('filterDept')?.value;
  const typeFilter = document.getElementById('filterType')?.value;
  const lifecycleFilter = document.getElementById('filterLifecycle')?.value;
  const searchTerm = String(document.getElementById('searchInput')?.value || '').trim().toLowerCase();

  if (currentInventoryView === 'spare_stock') {
    const pagerEl = document.getElementById('inventoryGroupPager');
    if (pagerEl) {
      pagerEl.classList.add('d-none');
      pagerEl.innerHTML = '';
    }
    const stockRows = (spareStockItemsCache || []).filter((item) => {
      const candidateBuilding = String(item.location || '').trim() || 'Unknown';
      const candidateType = normalizeComponentTypeLabel(item.componentType || item.category || 'Spare Stock');
      const matchBuilding = !buildingFilter || buildingFilter === 'all' || normalizeValue(candidateBuilding) === normalizeValue(buildingFilter);
      const matchType = !typeFilter || typeFilter === 'all' || normalizeValue(candidateType) === normalizeValue(typeFilter);
      if (!(matchBuilding && matchType) || !stockItemMatchesSavedView(item)) return false;
      if (!searchTerm) return true;
      const haystack = [
        item.partName,
        item.partNumber,
        item.brand,
        item.model,
        item.vendor,
        item.location,
        item.componentType,
        JSON.stringify(item.compatibleAssetTypes || []),
        JSON.stringify(item.compatibleBrandsModels || []),
      ].join(' ').toLowerCase();
      return haystack.includes(searchTerm);
    });

    if (!stockRows.length) {
      tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4">${UI.escapeHTML(viewMeta.emptyText)}</td></tr>`;
      updateDeleteAllAssetsButton();
      updateInventoryAiFloatingOffset();
      renderActiveInventoryFilterChips();
      return;
    }

    const groupedStock = {};
    stockRows.forEach((item) => {
      const key = normalizeComponentTypeLabel(item.componentType || item.category || 'Spare Stock');
      if (!groupedStock[key]) groupedStock[key] = [];
      groupedStock[key].push(item);
    });

    const groupedEntries = Object.entries(groupedStock)
      .sort((a, b) => String(a[0] || '').localeCompare(String(b[0] || '')));
    tableBody.innerHTML = groupedEntries.map(([groupType, groupItems]) => {
      const totalQty = groupItems.reduce((sum, item) => sum + Number(item.quantityAvailable || 0), 0);
      const locationSet = new Set(groupItems.map((item) => String(item.location || 'Unknown')).filter(Boolean));
      const partNumbers = Array.from(new Set(groupItems.map((item) => String(item.partNumber || '')).filter(Boolean)));
      const encodedType = encodeURIComponent(groupType);
      return `
        <tr>
          <td>
            <div class="d-flex align-items-center">
              <div class="avatar-initial rounded bg-light text-primary me-3">
                <i class="bi bi-box-seam"></i>
              </div>
              <div>
                <div class="fw-bold text-dark">${UI.escapeHTML(groupType)}</div>
                <small class="text-muted">${groupItems.length} stock item(s)</small>
                <span class="d-none">${UI.escapeHTML(partNumbers.join(' '))}</span>
              </div>
            </div>
          </td>
          <td><span class="badge bg-light text-dark border">${UI.escapeHTML(groupType)}</span></td>
          <td class="text-center"><span class="badge bg-primary qty-badge">${totalQty}</span></td>
          <td><small class="text-muted">${UI.escapeHTML(Array.from(locationSet).join(', ') || 'Unknown')}</small></td>
          <td class="text-end">
            <button class="btn btn-sm btn-primary" onclick="window.openSpareStockModalForType(decodeURIComponent('${encodedType}'))" title="View Spare Stock">
              <i class="bi bi-eye me-1"></i> View (${groupItems.length})
            </button>
          </td>
        </tr>
      `;
    }).join('');
    updateDeleteAllAssetsButton();
    updateInventoryAiFloatingOffset();
    renderActiveInventoryFilterChips();
    return;
  }

  const baseAssets = getAssetsForCurrentInventoryView();
  const filteredAssets = baseAssets.filter((asset) => {
    const installedParent = getInstalledParentInfo(asset);
    const parentSearchText = `${installedParent.parentName} ${installedParent.parentId} ${installedParent.parentTag}`.trim();
    const candidateBuilding = getAssetDisplayLocation(asset, { preferInstalledParent: currentInventoryView === 'components' });
    const candidateDepartment = getAssetDisplayDepartment(asset, { preferInstalledParent: currentInventoryView === 'components' });
    const candidateType = currentInventoryView === 'parents'
      ? canonicalType(asset.type)
      : getAssetViewTypeLabel(asset, currentInventoryView);
    const matchBuilding = !buildingFilter || buildingFilter === 'all' || normalizeValue(candidateBuilding) === normalizeValue(buildingFilter);
    const matchDept = !deptFilter || deptFilter === 'all' || normalizeDepartmentForFilter(candidateDepartment) === normalizeDepartmentForFilter(deptFilter);
    const matchType = !typeFilter || typeFilter === 'all' || normalizeValue(candidateType) === normalizeValue(typeFilter);
    const assetLifecycle = normalizeLifecycleStatus(asset.lifecycleStatus || asset.lifecycle_status || 'in_stock');
    const matchLifecycle = !lifecycleFilter || lifecycleFilter === 'all' || normalizeValue(assetLifecycle) === normalizeValue(lifecycleFilter);
    if (!(matchBuilding && matchDept && matchType && matchLifecycle) || !assetMatchesSavedView(asset)) return false;
    if (!searchTerm) return true;
    const haystack = [
      asset.name,
      asset.customId,
      getDisplaySerial(asset),
      getDisplayAssetTag(asset),
      inferComponentTypeFromAsset(asset),
      inferAccessoryTypeFromAsset(asset),
      inferConsumableTypeFromAsset(asset),
      inferLicenseTypeFromAsset(asset),
      candidateBuilding,
      candidateDepartment,
      parentSearchText,
      asset?.assignedToName,
      asset?.assignedToUserId,
      asset?.vendor,
    ].join(' ').toLowerCase();
    return haystack.includes(searchTerm);
  });

  if (!filteredAssets || filteredAssets.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4">${UI.escapeHTML(viewMeta.emptyText)}</td></tr>`;
    renderInventoryGroupPager();
    updateDeleteAllAssetsButton();
    renderActiveInventoryFilterChips();
    return;
  }

  if (currentInventoryView === 'components' || currentInventoryView === 'accessories' || currentInventoryView === 'consumables' || currentInventoryView === 'licenses') {
    const groupedByComponentType = {};
    filteredAssets.forEach((asset) => {
      const componentType = getAssetViewTypeLabel(asset, currentInventoryView) || 'Item';
      if (!groupedByComponentType[componentType]) groupedByComponentType[componentType] = [];
      groupedByComponentType[componentType].push(asset);
    });

    const groupedEntries = Object.entries(groupedByComponentType)
      .sort((a, b) => String(a[0] || '').localeCompare(String(b[0] || '')));
    tableBody.innerHTML = groupedEntries.map(([componentType, componentGroup]) => {
      const encodedComponentType = encodeURIComponent(componentType);
      const parentSet = new Set(componentGroup.map((asset) => {
        const parent = getInstalledParentInfo(asset);
        return parent.parentName || parent.parentId || parent.parentTag;
      }).filter(Boolean));
      const locationSet = new Set(componentGroup.map((asset) => (
        getAssetDisplayLocation(asset, { preferInstalledParent: currentInventoryView === 'components' })
      )).filter(Boolean));
      const serialsSet = new Set(componentGroup.map((asset) => getDisplaySerial(asset)).filter(Boolean));
      const tagsSet = new Set(componentGroup.map((asset) => getDisplayAssetTag(asset)).filter(Boolean));
      const parentSummary = Array.from(parentSet).slice(0, 3).join(', ');
      const moreParents = parentSet.size > 3 ? ` +${parentSet.size - 3} more` : '';
      return `
        <tr>
          <td>
            <div class="d-flex align-items-center">
              <div class="avatar-initial rounded bg-light text-primary me-3">
                <i class="bi bi-cpu"></i>
              </div>
              <div>
                <div class="fw-bold text-dark">${UI.escapeHTML(componentType)}</div>
                <small class="text-muted">${parentSummary ? `Related to: ${UI.escapeHTML(parentSummary)}${UI.escapeHTML(moreParents)}` : (currentInventoryView === 'components' ? 'No parent relationship' : 'No linked parent')}</small>
                <span class="d-none">${UI.escapeHTML(Array.from(serialsSet).join(' '))} ${UI.escapeHTML(Array.from(tagsSet).join(' '))}</span>
              </div>
            </div>
          </td>
          <td><span class="badge bg-light text-dark border">${UI.escapeHTML(componentType)}</span></td>
          <td class="text-center"><span class="badge bg-primary qty-badge">${componentGroup.length}</span></td>
          <td><small class="text-muted">${UI.escapeHTML(Array.from(locationSet).join(', ') || 'Unknown')}</small></td>
          <td class="text-end">
            <button class="btn btn-sm btn-primary" onclick="window.viewAssetDetailsByFilter('${currentInventoryView}', decodeURIComponent('${encodedComponentType}'))" title="View ${UI.escapeHTML(componentType)}">
              <i class="bi bi-eye me-1"></i> View (${componentGroup.length})
            </button>
          </td>
        </tr>
      `;
    }).join('');
    renderInventoryGroupPager();
  } else {
    const groupedByTypeAndName = {};
    filteredAssets.forEach((asset) => {
      const typeLabel = formatType(asset.type);
      const groupKey = `${typeLabel}::${asset.name}`;
      if (!groupedByTypeAndName[groupKey]) groupedByTypeAndName[groupKey] = [];
      groupedByTypeAndName[groupKey].push(asset);
    });

    const groupedEntries = Object.entries(groupedByTypeAndName)
      .sort((a, b) => {
        const aName = String((a[0] || '').split('::')[1] || a[0] || '');
        const bName = String((b[0] || '').split('::')[1] || b[0] || '');
        return aName.localeCompare(bName);
      });
    tableBody.innerHTML = groupedEntries.map(([groupKey, assetGroup]) => {
      const [typeLabel, assetName] = groupKey.split('::');
      const encodedAssetName = encodeURIComponent(assetName);
      const encodedAssetType = encodeURIComponent(canonicalType(assetGroup[0]?.type));
      const totalQty = getAssetsTotalQuantity(assetGroup);
      const firstAsset = assetGroup[0];
      const locationsSet = new Set(assetGroup.map((asset) => getAssetDisplayLocation(asset)).filter(Boolean));
      const departmentsSet = new Set(assetGroup.map((asset) => getAssetDisplayDepartment(asset)).filter(Boolean));
      const serialsSet = new Set(assetGroup.map((asset) => getDisplaySerial(asset)).filter(Boolean));
      const tagsSet = new Set(assetGroup.map((asset) => getDisplayAssetTag(asset)).filter(Boolean));
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
                <div class="fw-bold text-dark">${UI.escapeHTML(assetName)}</div>
                <small class="text-muted">${UI.escapeHTML(departmentsFound)}</small>
                <span class="d-none">${UI.escapeHTML(serialsFound)} ${UI.escapeHTML(tagsFound)}</span>
              </div>
            </div>
          </td>
          <td><span class="badge bg-light text-dark border">${UI.escapeHTML(typeLabel)}</span></td>
          <td class="text-center"><span class="badge bg-primary qty-badge">${totalQty}</span></td>
          <td><small class="text-muted">${UI.escapeHTML(locationsFound)}</small></td>
          <td class="text-end">
            <button class="btn btn-sm btn-primary" onclick="window.viewAssetDetailsByFilter('parents', decodeURIComponent('${encodedAssetName}'), decodeURIComponent('${encodedAssetType}'))" title="View & Manage Items">
              <i class="bi bi-eye me-1"></i> View (${totalQty})
            </button>
          </td>
        </tr>
      `;
    }).join('');
    renderInventoryGroupPager();
  }
  updateDeleteAllAssetsButton();
  renderActiveInventoryFilterChips();
}

function updateDeleteAllAssetsButton() {
  const button = document.getElementById('deleteAllAssetsBtn');
  if (!button) return;
  const count = currentInventoryView === 'spare_stock'
    ? (spareStockItemsCache || []).reduce((sum, item) => sum + Number(item.quantityAvailable || 0), 0)
    : getAssetsTotalQuantity(getAssetsForCurrentInventoryView());
  button.disabled = count === 0;
  const labelMap = {
    parents: 'Parent Assets',
    components: 'Components',
    accessories: 'Accessories',
    consumables: 'Consumables',
    spare_stock: 'Spare Stock',
    licenses: 'Licenses',
  };
  const label = labelMap[currentInventoryView] || 'Assets';
  button.innerHTML = `<i class="bi bi-trash3"></i> Delete ${label}${count ? ` (${count})` : ''}`;
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
  const assetTypeSelect = document.getElementById('assetType');
  const selectedTypeOption = assetTypeSelect?.options?.[assetTypeSelect.selectedIndex] || null;
  const registryTypeKey = String(selectedTypeOption?.dataset?.registryKey || '').trim();
  const registryTypeLabel = String(selectedTypeOption?.dataset?.registryLabel || selectedTypeOption?.textContent || '').trim();
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
    assetTypeRegistryKey: registryTypeKey || undefined,
    assetTypeRegistryLabel: registryTypeLabel || undefined,
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
      normalizeValue(getAssetDisplayLocation(a)) === normalizeValue('Central Warehouse') ||
      normalizeValue(getAssetDisplayDepartment(a)) === normalizeValue('Unassigned') ||
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

function resolveAssetsForDetailsContext(context) {
  if (!context || typeof context !== 'object') return [];
  if (context.mode === 'spare_stock') {
    return [];
  }
  if (context.mode === 'components' || context.mode === 'accessories' || context.mode === 'consumables' || context.mode === 'licenses') {
    return getAssetsForCurrentInventoryView().filter((asset) => normalizeValue(getAssetViewTypeLabel(asset, context.mode)) === normalizeValue(context.groupType || context.componentType || ''));
  }
  return getAssetsForCurrentInventoryView().filter((asset) => {
    const matchName = String(asset.name || '') === String(context.assetName || '');
    if (!matchName) return false;
    if (!context.assetType) return true;
    return normalizeValue(canonicalType(asset.type)) === normalizeValue(context.assetType);
  });
}

window.viewAssetDetailsByFilter = (mode, value, type = '') => {
  const normalizedMode = normalizeInventoryView(mode);
  if (normalizedMode === 'spare_stock') {
    window.openSpareStockModalForType(String(value || '').trim());
    return;
  }
  const context = normalizedMode === 'parents'
    ? { mode: 'parents', assetName: String(value || '').trim(), assetType: String(type || '').trim() }
    : { mode: normalizedMode, groupType: String(value || '').trim(), componentType: String(value || '').trim() };
  window.viewAssetDetailsByContext(context);
};

window.viewAssetDetailsByContext = (context) => {
  const safeContext = (context && typeof context === 'object') ? context : null;
  if (!safeContext) return;
  const mode = normalizeInventoryView(safeContext.mode);
  if (mode === 'spare_stock') {
    window.openSpareStockModalForType(safeContext.groupType || '');
    return;
  }
  safeContext.mode = mode;
  activeDetailsContext = safeContext;
  activeDetailsGroupName = safeContext.mode === 'parents'
    ? (safeContext.assetName || null)
    : (safeContext.groupType || safeContext.componentType || null);
  window.viewAssetDetails(activeDetailsGroupName || '');
};

// --- View Asset Group Details ---
window.viewAssetDetails = (assetName) => {
  const context = activeDetailsContext || {
    mode: currentInventoryView === 'parents' ? 'parents' : currentInventoryView,
    assetName,
    groupType: assetName,
    assetType: '',
  };
  activeDetailsGroupName = assetName;
  const groupAssets = resolveAssetsForDetailsContext(context);
  
  if (!groupAssets.length) {
    showMessage('Asset group not found.', 'error');
    return;
  }

  const totalQty = getAssetsTotalQuantity(groupAssets);
  const unitRows = getAssetUnitRows(groupAssets);
  console.debug('[AssetCreateDebug] modal-render', { assetName, groupAssets: groupAssets.length, totalQty, renderedRows: unitRows.length });
  const batchCount = groupAssets.length;
  const titleLabel = context.mode === 'parents'
    ? (context.assetName || assetName)
    : (context.groupType || context.componentType || assetName);
  document.getElementById('detailModalTitle').textContent = `${titleLabel} - ${totalQty} Unit(s)`;
  const detailSubtitle = document.getElementById('detailModalSubtitle');
  if (detailSubtitle) {
    const modeLabel = context.mode === 'parents'
      ? ''
      : context.mode === 'components'
        ? 'installed component'
        : context.mode.slice(0, -1);
    detailSubtitle.textContent = context.mode === 'parents'
      ? `Showing ${totalQty} unit(s) across ${batchCount} backend batch(es)`
      : `Showing ${totalQty} ${modeLabel} unit(s) in this group`;
  }
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
    aiBanner.className = 'w-100 mb-3 mt-2 inventory-ai-prediction-banner';
    
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

    if (context.mode !== 'parents') {
      const parentLinks = new Set(groupAssets.map((asset) => {
        const parent = getInstalledParentInfo(asset);
        return parent.parentName || parent.parentId || parent.parentTag;
      }).filter(Boolean));
      aiBanner.innerHTML = `
        <div class="inventory-ai-prediction-label">${UI.escapeHTML(context.mode === 'components' ? 'Component Group' : `${context.mode.replace(/_/g, ' ')}`)}</div>
        <div class="inventory-ai-prediction-copy">
          <p class="inventory-ai-prediction-main">
            ${UI.escapeHTML(titleLabel)} across <strong>${groupAssets.length}</strong> linked unit(s).
          </p>
          <div class="inventory-ai-prediction-note">${parentLinks.size ? `${parentLinks.size} related parent asset(s) linked.` : 'No parent relationship found.'}</div>
        </div>
      `;
    } else {
      const predictionTargetLabel = getAssetPredictionLabel(sampleAsset);
      let noteHtml = '';
      if (unknownCount > 0) {
        noteHtml = `${unknownCount} item${unknownCount === 1 ? '' : 's'} need more evidence before reliable EOL prediction. Next steps: verify specs, add purchase/warranty dates, and collect telemetry after deployment.`;
      } else if (lowConfidenceCount > 0) {
        noteHtml = 'Current EOL confidence is low. Recommended: run AI Spec Verification and complete missing lifecycle data.';
      } else if (failingCount > 0) {
        noteHtml = `${failingCount} item(s) in this group need replacement planning soon.`;
      } else {
        noteHtml = 'All items in this group currently have a healthy EOL status.';
      }

      aiBanner.innerHTML = `
        <div class="inventory-ai-prediction-label">AI Prediction</div>
        <div class="inventory-ai-prediction-copy">
          <p class="inventory-ai-prediction-main">
            Profile-based lifespan for <strong>${UI.escapeHTML(predictionTargetLabel)}</strong> is <strong>${UI.escapeHTML(String(eolData.metrics.years))} years</strong>.
          </p>
          <div class="inventory-ai-prediction-note">${UI.escapeHTML(noteHtml)}</div>
        </div>
      `;
    }
    headerDiv.insertBefore(aiBanner, headerDiv.firstChild);
  }

	  detailsBody.innerHTML = unitRows.map(({ asset, unitIndex, unitCount, unitLabel, isVirtualUnit }) => {
	    const eol = getEOLDetails(asset);
	    const profile = eol.metrics.prediction.profile;
	    const specStatus = getSpecVerificationStatus(asset);
	    const serialLabel = getDisplaySerial(asset);
	    const assetTagLabel = getDisplayAssetTag(asset);
    const parentInfo = getInstalledParentInfo(asset);
    const installedInLabel = String(
      parentInfo.parentName
      || parentInfo.parentTag
      || parentInfo.parentId
      || profile.specs?.installedInAssetName
      || profile.specs?.installedInAssetTag
      || profile.specs?.installedInAssetId
      || ''
    ).trim();
    const parentDescriptor = [parentInfo.parentName, parentInfo.parentId, parentInfo.parentTag].filter(Boolean).join(' Â· ');
    const eolApplicable = isEolRelevantAsset(asset);
    const telemetryVisible = shouldShowTelemetryControl(asset, profile);
    const telemetryConfigured = Boolean(
      profile.trackWorkingHours
      || profile.hasTelemetry
      || toBoolean(profile.specs?.telemetryApplicable)
      || toBoolean(profile.specs?.telemetryEnabled)
      || toBoolean(profile.specs?.trackWorkingHours)
    );
    const trackingLabel = profile.trackWorkingHours
      ? `${getOperationalStateLabel(profile.telemetryStatus)} Â· ${capitalize(String(profile.telemetryConfidence || 'low'))} confidence${profile.hasTelemetry ? ` Â· ${Math.round(profile.workingHours).toLocaleString()}h observed` : ''}`
      : (telemetryVisible
          ? 'Telemetry-capable (awaiting signal/configuration)'
          : (telemetryConfigured && isCentralWarehouseLocation(asset?.location)
              ? 'Telemetry activates after deployment outside Central Warehouse'
              : 'Not monitored'));
    return `
	    <tr>
		      <td class="ps-4">
		        <span class="font-monospace fw-bold">${unitLabel}</span>
		        <div class="text-muted pred-lifespan-text">Batch ID: ${asset.customId}</div>
		        ${isVirtualUnit ? `<div class="text-muted pred-lifespan-text">Unit ${unitIndex} of ${unitCount}</div>` : ''}
	        <div class="text-muted pred-lifespan-text">${profile.brand || 'Unknown brand'}${profile.version ? ` - ${profile.version}` : ''}</div>
	        <div class="text-muted pred-lifespan-text">Detected quality: ${capitalize(profile.quality)}</div>
          ${installedInLabel ? `<div class="text-muted pred-lifespan-text">Installed in: ${UI.escapeHTML(installedInLabel)}</div>` : ''}
          ${context.mode !== 'parents' ? `<div class="text-muted pred-lifespan-text">Parent: ${UI.escapeHTML(parentDescriptor || 'No parent relationship found')}</div>` : ''}
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
      <td>${getAssetDisplayLocation(asset, { preferInstalledParent: context.mode !== 'parents' })}</td>
      <td>${getAssetDisplayDepartment(asset, { preferInstalledParent: context.mode !== 'parents' })}</td>
	      <td>
	        ${eolApplicable ? `
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
	        </div>` : `<span class="badge bg-light text-dark border">Not Applicable</span>`}
	        <div class="text-muted pred-lifespan-text">
	          <i class="bi bi-clock-history inventory-ai-inline-icon"></i> ${trackingLabel}
	        </div>
	      </td>
	      <td class="text-end pe-4">
	        <div class="d-inline-flex flex-column align-items-end gap-1 inventory-row-actions">
	          <div class="btn-group btn-group-sm" role="group" aria-label="Primary row actions">
	            ${telemetryVisible ? `
	            <button class="btn btn-outline-dark" onclick="window.viewOperationalTelemetry('${asset.customId}')" title="Telemetry State" aria-label="View telemetry state for ${UI.escapeHTML(asset.customId)}">
	              <i class="bi bi-activity"></i>
	            </button>` : ''}
	            <button class="btn btn-outline-info d-inline-flex align-items-center justify-content-center p-0 inventory-row-icon-btn" onclick="window.viewQRCode('${asset.customId}')" title="View QR code" aria-label="View QR code for ${UI.escapeHTML(asset.customId)}">
	              <i class="bi bi-qr-code"></i>
	            </button>
		            <button class="btn btn-outline-primary d-inline-flex align-items-center justify-content-center p-0 inventory-row-icon-btn" onclick="window.viewTransferHistory('${asset.customId}')" title="View history" aria-label="View transfer history for ${UI.escapeHTML(asset.customId)}">
		              <i class="bi bi-clock-history"></i>
		            </button>
		            <button class="btn btn-outline-success d-inline-flex align-items-center justify-content-center p-0 inventory-row-icon-btn" onclick="window.openAssetCmdb('${asset.customId}')" title="CMDB Details" aria-label="Open CMDB details for ${UI.escapeHTML(asset.customId)}">
		              <i class="bi bi-diagram-3"></i>
		            </button>
		            ${INVENTORY_ACCESS.canEditSpecs ? `
		            <button class="btn btn-outline-secondary d-inline-flex align-items-center justify-content-center p-0 inventory-row-icon-btn" onclick="window.editSpecs('${asset.customId}', false)" title="Edit specs/details" aria-label="Edit specs for ${UI.escapeHTML(asset.customId)}">
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
  const pendingAssetsForGroup = context.mode === 'parents' ? getPendingSpecReviewAssetsInGroup(groupAssets) : [];
  const pendingUnitsForGroup = pendingAssetsForGroup.reduce((sum, asset) => sum + getAssetQuantity(asset), 0);

  if (bulkTransferBtn) {
    bulkTransferBtn.style.display = (INVENTORY_ACCESS.canTransferAsset && context.mode === 'parents') ? '' : 'none';
    bulkTransferBtn.onclick = () => window.bulkTransferGroup(assetName);
  }
  const bulkGroupCmdbBtn = document.getElementById('bulkGroupCmdbBtn');
  if (bulkGroupCmdbBtn) {
    bulkGroupCmdbBtn.onclick = () => window.openGroupCmdb(assetName);
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
    const encodedDetailGroupName = encodeURIComponent(assetName);
    const groupActionsDiv = document.createElement('div');
    groupActionsDiv.className = 'd-flex gap-2 ms-auto';
    groupActionsDiv.innerHTML = `
      <button class="btn btn-sm btn-outline-info" onclick="window.printQRLabels(decodeURIComponent('${encodedDetailGroupName}'), true)" title="Print QR Labels">
        <i class="bi bi-printer"></i> Print Labels
      </button>
      ${INVENTORY_ACCESS.canEditSpecs ? `<button class="btn btn-sm btn-outline-secondary" onclick="window.editSpecs(decodeURIComponent('${encodedDetailGroupName}'), true)" title="Edit Group Specs">
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
  transferSelectionState = {
    targetAssetIds: [customId],
    isBulk: false,
  };

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
  const includeRelatedInput = document.getElementById('transferIncludeRelated');
  const includeComponentsInput = document.getElementById('transferIncludeComponents');
  const includeAccessoriesInput = document.getElementById('transferIncludeAccessories');
  const includeLicensesInput = document.getElementById('transferIncludeLicenses');
  const includeConsumablesInput = document.getElementById('transferIncludeConsumables');
  if (includeRelatedInput) includeRelatedInput.checked = true;
  if (includeComponentsInput) includeComponentsInput.checked = true;
  if (includeAccessoriesInput) includeAccessoriesInput.checked = true;
  if (includeLicensesInput) includeLicensesInput.checked = false;
  if (includeConsumablesInput) includeConsumablesInput.checked = false;
  updateTransferRelatedFormState();
  refreshTransferRelatedSummary().catch(() => {});
  
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

    if (activeDetailsContext && resolveAssetsForDetailsContext(activeDetailsContext).length) {
      window.viewAssetDetailsByContext(activeDetailsContext);
    } else if (groupName && currentAssets.some(a => a.name === groupName)) {
      window.viewAssetDetailsByFilter('parents', groupName, '');
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

  const groupAssets = (activeDetailsContext && resolveAssetsForDetailsContext(activeDetailsContext).length)
    ? resolveAssetsForDetailsContext(activeDetailsContext)
    : currentAssets.filter((a) => a.name === assetName);
  if (!groupAssets.length) return;
  transferSelectionState = {
    targetAssetIds: groupAssets.map((asset) => asset.customId),
    isBulk: true,
  };

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
  const includeRelatedInput = document.getElementById('transferIncludeRelated');
  const includeComponentsInput = document.getElementById('transferIncludeComponents');
  const includeAccessoriesInput = document.getElementById('transferIncludeAccessories');
  const includeLicensesInput = document.getElementById('transferIncludeLicenses');
  const includeConsumablesInput = document.getElementById('transferIncludeConsumables');
  if (includeRelatedInput) includeRelatedInput.checked = true;
  if (includeComponentsInput) includeComponentsInput.checked = true;
  if (includeAccessoriesInput) includeAccessoriesInput.checked = true;
  if (includeLicensesInput) includeLicensesInput.checked = false;
  if (includeConsumablesInput) includeConsumablesInput.checked = false;
  updateTransferRelatedFormState();
  refreshTransferRelatedSummary().catch(() => {});
  
  populateTransferSelects();
  
  const transferModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('transferModal'));
  transferModal.show();
};

window.bulkDeleteGroup = async (assetName) => {
  if (!INVENTORY_ACCESS.canDeleteAsset) {
    showMessage('Only admins can delete assets.', 'error');
    return;
  }

  const groupAssets = (activeDetailsContext && resolveAssetsForDetailsContext(activeDetailsContext).length)
    ? resolveAssetsForDetailsContext(activeDetailsContext)
    : currentAssets.filter((a) => a.name === assetName);
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
  if (currentInventoryView === 'spare_stock') {
    showMessage('Use Spare Stock actions to adjust or remove spare stock items.', 'info');
    await window.openSpareStockModal();
    return;
  }
  const assetsToDelete = [...getAssetsForCurrentInventoryView()];
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

function historySourceBadgeHtml(sourceType) {
  const normalized = String(sourceType || '').trim().toLowerCase();
  const map = {
    parent: { label: 'Parent', cls: 'bg-primary-subtle text-primary-emphasis border border-primary-subtle' },
    component: { label: 'Component', cls: 'bg-info-subtle text-info-emphasis border border-info-subtle' },
    accessory: { label: 'Accessory', cls: 'bg-warning-subtle text-warning-emphasis border border-warning-subtle' },
    consumable: { label: 'Consumable', cls: 'bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle' },
    license: { label: 'License', cls: 'bg-success-subtle text-success-emphasis border border-success-subtle' },
    related: { label: 'Related', cls: 'bg-light text-dark border' },
  };
  const entry = map[normalized] || map.related;
  return `<span class="badge ${entry.cls}">${entry.label}</span>`;
}

function renderHistoryLegend(entries = []) {
  const sourceTypes = new Set(
    (entries || [])
      .map((entry) => String(entry?.sourceItemType || 'parent').trim().toLowerCase())
      .filter(Boolean)
  );
  if (!sourceTypes.size) sourceTypes.add('parent');
  return Array.from(sourceTypes).map((type) => historySourceBadgeHtml(type)).join('');
}

function renderHistoryTimeline(entries = [], includeRelated = true) {
  if (!Array.isArray(entries) || entries.length === 0) {
    const emptyMessage = includeRelated
      ? 'No related component/accessory/license history yet.'
      : 'This asset does not have recorded actions yet.';
    return `
      <div class="empty-state py-4">
        <i class="bi bi-clock-history"></i>
        <h5>No history yet</h5>
        <p>${UI.escapeHTML(emptyMessage)}</p>
      </div>
    `;
  }

  return entries.map((entry) => {
    const sourceLabel = String(entry.sourceItemName || entry.sourceItemCustomId || '').trim();
    const sourceMeta = [entry.sourceItemCustomId, entry.sourceItemAssetTag, entry.sourceItemSerialNumber]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' â€¢ ');
    const linkedParent = String(entry.linkedParentAssetId || entry.linkedParentAssetName || '').trim()
      ? `Parent: ${entry.linkedParentAssetName || entry.linkedParentAssetId}${entry.linkedParentAssetTag ? ` (${entry.linkedParentAssetTag})` : ''}`
      : '';
    const message = [
      String(entry.details || '').trim(),
      entry.reason ? `Reason: ${entry.reason}` : '',
      linkedParent,
    ].filter(Boolean).join(' | ');
    return `
      <div class="timeline-item">
        <div class="d-flex justify-content-between align-items-start gap-3">
          <div class="d-flex flex-wrap align-items-center gap-2">
            ${historySourceBadgeHtml(entry.sourceItemType || 'parent')}
            <strong>${UI.escapeHTML(entry.event || 'Asset update')}</strong>
          </div>
          <small class="text-muted">${UI.formatDateTime(entry.date)}</small>
        </div>
        ${sourceLabel ? `<div class="small mt-1"><span class="text-muted">Item:</span> ${UI.escapeHTML(sourceLabel)}${sourceMeta ? ` <span class="text-muted">(${UI.escapeHTML(sourceMeta)})</span>` : ''}</div>` : ''}
        <div class="text-muted small mt-1">${UI.escapeHTML(message || '')}</div>
      </div>
    `;
  }).join('');
}

window.viewTransferHistory = async (customId, options = {}) => {
  const historyContent = document.getElementById('historyContent');
  const historyTitle = document.querySelector('#historyModal .modal-title');
  const includeRelatedInput = document.getElementById('historyIncludeRelated');
  const historyLegend = document.getElementById('historyLegendBadges');
  const assetRecord = currentAssets.find((entry) => entry.customId === customId);
  const firstOpenForAsset = historyViewState.assetId !== customId;
  const defaultIncludeRelated = firstOpenForAsset
    ? isParentViewAsset(assetRecord || {})
    : Boolean(includeRelatedInput?.checked ?? true);
  const includeRelated = typeof options.includeRelated === 'boolean'
    ? options.includeRelated
    : defaultIncludeRelated;

  historyViewState.assetId = customId;
  historyViewState.includeRelated = includeRelated;

  if (includeRelatedInput) {
    includeRelatedInput.checked = includeRelated;
    if (!includeRelatedInput.dataset.bound) {
      includeRelatedInput.dataset.bound = 'true';
      includeRelatedInput.addEventListener('change', () => {
        if (!historyViewState.assetId) return;
        window.viewTransferHistory(historyViewState.assetId, {
          includeRelated: Boolean(includeRelatedInput.checked),
          preserveModal: true,
        }).catch(() => {});
      });
    }
  }

  if (historyTitle) historyTitle.textContent = `Audit Trail - ${customId}`;
  if (historyLegend) historyLegend.innerHTML = renderHistoryLegend([]);
  if (historyContent) {
    historyContent.innerHTML = `
      <div class="text-center py-4">
        <div class="spinner-border text-primary" role="status"></div>
        <p class="text-muted small mt-3 mb-0">Loading asset history...</p>
      </div>
    `;
  }

  const historyModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('historyModal'));
  if (!options.preserveModal) {
    historyModal.show();
  }

  try {
    const query = includeRelated ? '?includeRelated=true' : '';
    const response = await inventoryRequest(`/assets/${encodeURIComponent(customId)}/history${query}`);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to load asset history');
    }

    const entries = await response.json();
    if (historyLegend) historyLegend.innerHTML = renderHistoryLegend(entries);
    historyContent.innerHTML = renderHistoryTimeline(entries, includeRelated);
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

function parseBulkCheckoutCodes(raw) {
  return Array.from(new Set(
    String(raw || '')
      .split(/\r?\n|,/)
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  ));
}

function getBulkCheckoutFormState() {
  const building = String(document.getElementById('bulkCheckoutBuilding')?.value || '').trim();
  const department = normalizeDepartmentLabel(String(document.getElementById('bulkCheckoutDepartment')?.value || '').trim(), { fallbackUnassigned: false }) || '';
  const room = String(document.getElementById('bulkCheckoutRoom')?.value || '').trim();
  const assigneeRole = String(document.getElementById('bulkCheckoutAssigneeRole')?.value || '').trim();
  const assigneeName = String(document.getElementById('bulkCheckoutAssignedTo')?.value || '').trim();
  const expectedReturnDate = String(document.getElementById('bulkCheckoutExpectedReturnDate')?.value || '').trim();
  const reason = String(document.getElementById('bulkCheckoutReason')?.value || '').trim();
  const includeRelated = Boolean(document.getElementById('bulkCheckoutIncludeRelated')?.checked);
  return {
    building,
    department,
    room,
    assigneeRole,
    assigneeName,
    expectedReturnDate,
    reason,
    includeRelated,
  };
}

function updateBulkCheckoutDestinationSummary() {
  const summaryEl = document.getElementById('bulkCheckoutDestinationSummary');
  if (!summaryEl) return;
  const state = getBulkCheckoutFormState();
  const buildingLabel = state.building || 'Select Building';
  const roomLabel = state.room || 'Room not specified';
  const deptLabel = state.department || 'Select Department';
  const assignee = [state.assigneeRole, state.assigneeName].filter(Boolean).join(' - ') || 'No assignee selected';
  summaryEl.textContent = `Checking out assets to ${buildingLabel} / ${roomLabel}, under ${deptLabel}, assigned to ${assignee}.`;
}

function populateBulkCheckoutDestinationSelectors() {
  const buildingSelect = document.getElementById('bulkCheckoutBuilding');
  const departmentSelect = document.getElementById('bulkCheckoutDepartment');
  if (!buildingSelect || !departmentSelect) return;

  const previousBuilding = String(buildingSelect.value || '').trim();
  const previousDepartment = String(departmentSelect.value || '').trim();
  const buildings = getKnownBuildingOptions();
  const departments = getKnownDepartmentOptions();

  buildingSelect.innerHTML = `<option value="">Select Building</option>${buildings.map((value) => `<option value="${UI.escapeHTML(value)}">${UI.escapeHTML(value)}</option>`).join('')}`;
  departmentSelect.innerHTML = `<option value="">Select Department</option>${departments.map((value) => `<option value="${UI.escapeHTML(value)}">${UI.escapeHTML(value)}</option>`).join('')}`;

  if (previousBuilding && Array.from(buildingSelect.options).some((option) => option.value === previousBuilding)) {
    buildingSelect.value = previousBuilding;
  }
  if (previousDepartment && Array.from(departmentSelect.options).some((option) => option.value === previousDepartment)) {
    departmentSelect.value = previousDepartment;
  }
  updateBulkCheckoutDestinationSummary();
}

async function resolveAssetForBulkValidation(requestedCode) {
  const normalizedCode = normalizeValue(requestedCode);
  const inMemory = currentAssets.find((entry) => (
    normalizeValue(entry?.customId) === normalizedCode
    || normalizeValue(entry?.assetTag) === normalizedCode
  ));
  if (inMemory) return inMemory;

  const exactById = await readInventoryJson(`/assets/${encodeURIComponent(requestedCode)}`).catch(() => null);
  if (exactById && normalizeValue(exactById?.customId) === normalizedCode) return exactById;

  const searchPayload = await readInventoryJson(`/assets?paginate=true&page=1&pageSize=50&q=${encodeURIComponent(requestedCode)}`).catch(() => null);
  const items = Array.isArray(searchPayload?.items)
    ? searchPayload.items
    : (Array.isArray(searchPayload) ? searchPayload : []);
  const exact = items.find((entry) => (
    normalizeValue(entry?.customId) === normalizedCode
    || normalizeValue(entry?.assetTag) === normalizedCode
  ));
  return exact || null;
}

function buildBulkCheckoutValidationRow(inputCode, asset, duplicate = false) {
  if (duplicate) {
    return { input: inputCode, assetId: inputCode, valid: false, message: 'Duplicate input in this batch.' };
  }
  if (!asset) {
    return { input: inputCode, assetId: inputCode, valid: false, message: 'Asset not found in inventory.' };
  }
  const lifecycle = normalizeLifecycleStatus(asset.lifecycleStatus);
  if (['retired', 'disposed', 'lost_stolen'].includes(lifecycle)) {
    return {
      input: inputCode,
      assetId: asset.customId,
      valid: false,
      message: `Unavailable (${displayLifecycleStatus(lifecycle)}).`,
    };
  }
  const custodyStatus = normalizeValue(asset.custodyStatus || '');
  if (custodyStatus === 'checkedout') {
    return {
      input: inputCode,
      assetId: asset.customId,
      valid: false,
      message: 'Already checked out.',
    };
  }
  const specs = getAssetSpecs(asset);
  const loanerStatus = normalizeValue(specs.loanerStatus || '');
  if (loanerStatus === 'checkedout' || loanerStatus === 'overdue') {
    return {
      input: inputCode,
      assetId: asset.customId,
      valid: false,
      message: `Loaner state blocks checkout (${specs.loanerStatus || 'checked out'}).`,
    };
  }
  return {
    input: inputCode,
    assetId: asset.customId,
    valid: true,
    message: `${asset.name} | ${getAssetDisplayLocation(asset)} | ${getAssetDisplayDepartment(asset)}`,
  };
}

function renderBulkCheckoutValidation() {
  const bodyEl = document.getElementById('bulkCheckoutValidationTableBody');
  const summaryEl = document.getElementById('bulkCheckoutValidationSummary');
  const confirmBtn = document.getElementById('bulkCheckoutConfirmBtn');
  if (!bodyEl || !summaryEl) return;
  if (!bulkCheckoutValidationRows.length) {
    bodyEl.innerHTML = '<tr><td colspan="3" class="text-muted">No validation yet.</td></tr>';
    summaryEl.textContent = 'Ready.';
    if (confirmBtn) confirmBtn.disabled = true;
    return;
  }
  const validCount = bulkCheckoutValidationRows.filter((row) => row.valid).length;
  const invalidCount = bulkCheckoutValidationRows.length - validCount;
  summaryEl.textContent = `Validated ${bulkCheckoutValidationRows.length} entries: ${validCount} valid, ${invalidCount} invalid.`;
  if (confirmBtn) confirmBtn.disabled = invalidCount > 0;
  bodyEl.innerHTML = bulkCheckoutValidationRows.map((row) => `
    <tr>
      <td>${UI.escapeHTML(row.assetId || row.input || '-')}</td>
      <td>${row.valid ? '<span class="badge bg-success">Valid</span>' : '<span class="badge bg-danger">Invalid</span>'}</td>
      <td>${UI.escapeHTML(row.message || '-')}</td>
    </tr>
  `).join('');
}

window.openBulkCheckoutModal = () => {
  bulkCheckoutValidationRows = [];
  renderBulkCheckoutValidation();
  populateBulkCheckoutDestinationSelectors();
  const assigneeRoleEl = document.getElementById('bulkCheckoutAssigneeRole');
  if (assigneeRoleEl && !assigneeRoleEl.value) assigneeRoleEl.value = '';
  const receiptEl = document.getElementById('bulkCheckoutReceipt');
  if (receiptEl) receiptEl.innerHTML = '';
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('bulkCheckoutModal'));
  modal.show();
};

window.validateBulkCheckoutAssets = async () => {
  const codesRaw = document.getElementById('bulkCheckoutAssetCodes')?.value || '';
  const ids = parseBulkCheckoutCodes(codesRaw);
  if (!ids.length) {
    bulkCheckoutValidationRows = [];
    renderBulkCheckoutValidation();
    showMessage('Enter at least one asset code to validate.', 'warning');
    return;
  }
  const summaryEl = document.getElementById('bulkCheckoutValidationSummary');
  if (summaryEl) summaryEl.textContent = `Validating ${ids.length} asset code(s) against server data...`;
  const seen = new Set();
  const rows = [];
  for (const id of ids) {
    if (seen.has(id)) {
      rows.push(buildBulkCheckoutValidationRow(id, null, true));
      continue;
    }
    seen.add(id);
    const asset = await resolveAssetForBulkValidation(id);
    rows.push(buildBulkCheckoutValidationRow(id, asset, false));
  }
  bulkCheckoutValidationRows = rows;
  renderBulkCheckoutValidation();
};

window.confirmBulkCheckout = async () => {
  const codesRaw = document.getElementById('bulkCheckoutAssetCodes')?.value || '';
  const ids = parseBulkCheckoutCodes(codesRaw);
  const state = getBulkCheckoutFormState();
  const destinationType = 'building';
  const destination = state.building;
  const assignedToName = [state.assigneeRole, state.assigneeName].filter(Boolean).join(' - ') || null;
  const assignedDepartment = state.department || null;
  const expectedReturnDate = state.expectedReturnDate || null;
  const includeRelated = state.includeRelated;
  if (!ids.length) {
    showMessage('Please provide asset IDs/tags first.', 'warning');
    return;
  }
  if (!destination) {
    showMessage('Please select a destination building.', 'warning');
    return;
  }
  if (!assignedDepartment) {
    showMessage('Please select a destination department.', 'warning');
    return;
  }
  if (!bulkCheckoutValidationRows.length || bulkCheckoutValidationRows.length !== ids.length) {
    await window.validateBulkCheckoutAssets();
  }
  const invalidRows = bulkCheckoutValidationRows.filter((row) => !row.valid);
  if (invalidRows.length) {
    showMessage('Confirm is blocked. Resolve invalid assets first.', 'warning');
    renderBulkCheckoutValidation();
    return;
  }
  const confirmed = await confirmInventoryAction({
    title: 'Confirm Bulk Checkout',
    message: `Checking out ${ids.length} asset(s) to ${destination} / ${state.room || 'Room not specified'}, under ${assignedDepartment}, assigned to ${assignedToName || 'No assignee'}. Continue?`,
    confirmText: 'Confirm Checkout',
    confirmClass: 'inventory-insight-primary',
    type: 'warning',
  });
  if (!confirmed) return;
  try {
    const payload = {
      assetIds: ids,
      destinationType,
      destination,
      assignedToName,
      assignedDepartment,
      expectedReturnDate,
      includeRelated,
      includeComponents: includeRelated,
      includeAccessories: includeRelated,
      includeLicenses: includeRelated,
      includeConsumables: false,
      actor: 'inventory-ui-kiosk',
      reason: state.reason || 'bulk_checkout',
      notes: [state.reason, state.room ? `Room: ${state.room}` : ''].filter(Boolean).join(' | '),
    };
    const result = await postInventoryJson('/inventory/bulk-checkout', payload);
    const receiptEl = document.getElementById('bulkCheckoutReceipt');
    if (receiptEl) {
      const summary = result?.receiptSummary || {};
      receiptEl.innerHTML = `
        <div class="alert alert-success mt-2 mb-0">
          <div><strong>Checkout complete.</strong> Success: ${UI.escapeHTML(String(summary.successfulCount ?? 0))}, Failed: ${UI.escapeHTML(String(summary.failedCount ?? 0))}</div>
          <div class="small mt-1">Destination: ${UI.escapeHTML(destination)} / ${UI.escapeHTML(state.room || 'Room not specified')} | Department: ${UI.escapeHTML(assignedDepartment || '-')} | Assignee: ${UI.escapeHTML(assignedToName || '-')}</div>
          <div class="small mt-1">Related moved: components ${UI.escapeHTML(String(summary.relatedMoved?.components ?? 0))}, accessories ${UI.escapeHTML(String(summary.relatedMoved?.accessories ?? 0))}, licenses ${UI.escapeHTML(String(summary.relatedMoved?.licenses ?? 0))}, consumables ${UI.escapeHTML(String(summary.relatedMoved?.consumables ?? 0))}.</div>
        </div>
      `;
    }
    showMessage('Bulk checkout completed.', 'success');
    await loadAssets();
    if (document.getElementById('inventoryAssetMapModal')?.classList.contains('show')) {
      await window.loadInventoryMapAssets(true);
    }
  } catch (error) {
    showMessage(error.message || 'Bulk checkout failed.', 'error');
  }
};

window.openLoanerBoardModal = async () => {
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('loanerBoardModal'));
  modal.show();
  await window.loadLoanerBoard();
};

window.loadLoanerBoard = async () => {
  const summaryEl = document.getElementById('loanerSummaryText');
  if (summaryEl) summaryEl.textContent = 'Loading loaner inventory...';
  try {
    loanerBoardRows = await readInventoryJson('/inventory/loaners');
    window.renderLoanerBoard();
  } catch (error) {
    if (summaryEl) summaryEl.textContent = 'Could not load loaner inventory.';
    showMessage(error.message || 'Failed to load loaner board.', 'error');
  }
};

window.renderLoanerBoard = () => {
  const bodyEl = document.getElementById('loanerTableBody');
  const summaryEl = document.getElementById('loanerSummaryText');
  if (!bodyEl || !summaryEl) return;
  const search = String(document.getElementById('loanerSearchInput')?.value || '').trim().toLowerCase();
  const rows = (loanerBoardRows || []).filter((row) => {
    if (!search) return true;
    const haystack = [
      row.assetId,
      row.name,
      row.loanedTo,
      row.location,
      row.department,
      row.loanerStatus,
    ].join(' ').toLowerCase();
    return haystack.includes(search);
  });
  summaryEl.textContent = `Showing ${rows.length} of ${loanerBoardRows.length} loaner record(s).`;
  bodyEl.innerHTML = rows.map((row) => {
    const status = String(row.loanerStatus || 'available').toLowerCase();
    const isEligible = Boolean(row.loanerEligible);
    const badgeClass = status === 'overdue'
      ? 'bg-danger'
      : (status === 'checked_out' ? 'bg-warning text-dark' : 'bg-success');
    const canCheckout = isEligible && status !== 'checked_out' && status !== 'overdue';
    const canReturn = status === 'checked_out' || status === 'overdue';
    const blockedReason = isEligible
      ? ''
      : 'This asset is not marked as a loaner. Mark it as a loaner before checkout.';
    return `
      <tr>
        <td>
          <div class="fw-semibold">${UI.escapeHTML(row.name || '-')}</div>
          <div class="small text-muted">${UI.escapeHTML(row.assetId || '-')} | ${UI.escapeHTML(row.type || '-')}</div>
        </td>
        <td><span class="badge ${badgeClass}">${UI.escapeHTML(status.replace(/_/g, ' '))}</span></td>
        <td>${UI.escapeHTML(row.loanedTo || '-')}</td>
        <td>${row.expectedReturnDate ? UI.formatDateTime(row.expectedReturnDate) : '-'}</td>
        <td>${UI.escapeHTML(row.location || '-')}</td>
        <td class="text-end">
          <div class="d-flex justify-content-end gap-1">
            <button
              type="button"
              class="btn btn-sm ${canCheckout ? 'btn-outline-primary' : 'btn-outline-secondary'}"
              data-loaner-checkout-id="${UI.escapeHTML(row.assetId)}"
              ${canCheckout ? '' : 'disabled'}
              title="${UI.escapeHTML(blockedReason || (canReturn ? 'Asset is already loaned out.' : 'Checkout is unavailable for this row.'))}"
            >Checkout</button>
            <button
              type="button"
              class="btn btn-sm ${canReturn ? 'btn-outline-dark' : 'btn-outline-secondary'}"
              data-loaner-return-id="${UI.escapeHTML(row.assetId)}"
              ${canReturn ? '' : 'disabled'}
              title="${UI.escapeHTML(canReturn ? 'Record loaner return.' : 'Loaner return is available only when asset is currently loaned out.')}"
            >Return</button>
          </div>
          ${blockedReason ? `<div class="small text-muted mt-1">${UI.escapeHTML(blockedReason)}</div>` : ''}
        </td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="6" class="text-muted">No loaner rows found.</td></tr>';
};

window.loanerCheckoutAsset = async (assetId) => {
  const row = (loanerBoardRows || []).find((entry) => String(entry.assetId || '') === String(assetId || ''));
  if (!row) {
    showMessage('Loaner asset row not found.', 'warning');
    return;
  }
  if (!row.loanerEligible) {
    showMessage('This asset is not marked as a loaner. Mark it as a loaner before checkout.', 'warning');
    return;
  }
  const form = await showInventoryFormModal({
    title: 'Loaner Checkout',
    message: `Asset: ${row.name || assetId}`,
    confirmText: 'Confirm Checkout',
    confirmClass: 'btn-primary',
    dialogClass: 'modal-md',
    fields: [
      {
        name: 'loanedTo',
        label: 'Borrower / Role',
        type: 'text',
        value: row.loanedTo || '',
        placeholder: 'Student or staff name',
        required: true,
      },
      {
        name: 'department',
        label: 'Department',
        type: 'select',
        options: getKnownDepartmentOptions(),
        value: normalizeDepartmentLabel(row.department || '', { fallbackUnassigned: false }) || '',
        placeholder: 'Select Department',
        required: true,
      },
      {
        name: 'expectedReturnDate',
        label: 'Expected Return Date',
        type: 'date',
        value: row.expectedReturnDate ? String(row.expectedReturnDate).slice(0, 10) : '',
        required: false,
      },
      {
        name: 'reason',
        label: 'Reason',
        type: 'text',
        value: 'Loaner checkout',
        required: true,
      },
      {
        name: 'notes',
        label: 'Notes',
        type: 'textarea',
        rows: 3,
        required: false,
      },
    ],
  });
  if (!form?.confirmed) return;

  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/loaner-checkout`, {
      loanedTo: form.values.loanedTo,
      expectedReturnDate: form.values.expectedReturnDate || null,
      notes: [form.values.reason, form.values.notes, form.values.department ? `Department: ${form.values.department}` : ''].filter(Boolean).join(' | '),
      actor: 'inventory-ui-loaner',
    });
    showMessage(`Loaner checkout recorded for ${assetId}.`, 'success');
    await Promise.all([window.loadLoanerBoard(), loadAssets()]);
  } catch (error) {
    showMessage(error.message || 'Loaner checkout failed.', 'error');
  }
};

window.loanerReturnAsset = async (assetId) => {
  const row = (loanerBoardRows || []).find((entry) => String(entry.assetId || '') === String(assetId || ''));
  const form = await showInventoryFormModal({
    title: 'Loaner Return',
    message: `Asset: ${row?.name || assetId}`,
    confirmText: 'Confirm Return',
    confirmClass: 'btn-outline-dark',
    dialogClass: 'modal-md',
    fields: [
      {
        name: 'condition',
        label: 'Return Condition',
        type: 'select',
        options: [
          { value: 'good', label: 'Good' },
          { value: 'damaged', label: 'Damaged' },
          { value: 'missing_accessories', label: 'Missing accessories' },
        ],
        value: 'good',
        required: true,
      },
      {
        name: 'location',
        label: 'Return Location',
        type: 'select',
        options: getKnownBuildingOptions(),
        value: row?.location || '',
        required: false,
      },
      {
        name: 'notes',
        label: 'Damage / Missing Notes',
        type: 'textarea',
        rows: 3,
        required: false,
      },
    ],
  });
  if (!form?.confirmed) return;
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/loaner-return`, {
      location: form.values.location || null,
      notes: [form.values.condition ? `Condition: ${form.values.condition}` : '', form.values.notes].filter(Boolean).join(' | '),
      actor: 'inventory-ui-loaner',
    });
    showMessage(`Loaner return recorded for ${assetId}.`, 'success');
    await Promise.all([window.loadLoanerBoard(), loadAssets()]);
  } catch (error) {
    showMessage(error.message || 'Loaner return failed.', 'error');
  }
};

window.openAuditBoardModal = async () => {
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('auditBoardModal'));
  modal.show();
  await window.loadAuditBoard();
};

window.loadAuditBoard = async () => {
  const staleAfterDays = Number(document.getElementById('auditStaleDaysInput')?.value || 90);
  const summaryEl = document.getElementById('auditBoardSummary');
  if (summaryEl) summaryEl.textContent = 'Loading audit board...';
  try {
    const payload = await readInventoryJson(`/inventory/audit-board?staleAfterDays=${encodeURIComponent(String(staleAfterDays || 90))}`);
    auditBoardRows = Array.isArray(payload?.assetsNeedingAttention) ? payload.assetsNeedingAttention : [];
    window.renderAuditBoard(payload);
  } catch (error) {
    if (summaryEl) summaryEl.textContent = 'Could not load audit board.';
    showMessage(error.message || 'Failed to load audit board.', 'error');
  }
};

window.renderAuditBoard = (payload = null) => {
  const bodyEl = document.getElementById('auditBoardTableBody');
  const summaryEl = document.getElementById('auditBoardSummary');
  const pointsEl = document.getElementById('auditBoardVerifierPoints');
  if (!bodyEl || !summaryEl || !pointsEl) return;
  const rows = Array.isArray(auditBoardRows) ? auditBoardRows : [];
  const counts = payload?.counts || {};
  summaryEl.textContent = `Needs verification: ${counts.needsVerification ?? '-'} | Missing: ${counts.missing ?? '-'} | Stale: ${counts.staleVerification ?? '-'} | Location mismatch: ${counts.locationMismatch ?? '-'}`;
  pointsEl.textContent = Array.isArray(payload?.verifierPoints) && payload.verifierPoints.length
    ? `Verifier points: ${payload.verifierPoints.map((entry) => `${entry.name} (${entry.points})`).join(', ')}`
    : 'Verifier points: no data yet.';
  bodyEl.innerHTML = rows.map((row) => `
    <tr>
      <td>
        <div class="fw-semibold">${UI.escapeHTML(row.name || '-')}</div>
        <div class="small text-muted">${UI.escapeHTML(row.assetId || '-')} | ${UI.escapeHTML(row.type || '-')}</div>
      </td>
      <td>${UI.escapeHTML(String(row.status || '-').replace(/_/g, ' '))}</td>
      <td>${UI.escapeHTML(row.location || '-')}</td>
      <td>${row.lastVerifiedAt ? UI.formatDateTime(row.lastVerifiedAt) : '-'}</td>
      <td>${UI.escapeHTML(row.lastVerifiedBy || '-')}</td>
      <td class="text-end">
        <div class="d-flex flex-wrap justify-content-end gap-1">
          <button type="button" class="btn btn-sm btn-outline-success" data-audit-action-id="${UI.escapeHTML(row.assetId)}" data-audit-action="verify">Verify</button>
          <button type="button" class="btn btn-sm btn-outline-danger" data-audit-action-id="${UI.escapeHTML(row.assetId)}" data-audit-action="missing">Missing</button>
          <button type="button" class="btn btn-sm btn-outline-warning text-dark" data-audit-action-id="${UI.escapeHTML(row.assetId)}" data-audit-action="damaged">Damaged</button>
          <button type="button" class="btn btn-sm btn-outline-primary" data-audit-action-id="${UI.escapeHTML(row.assetId)}" data-audit-action="wrong_location">Wrong Location</button>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-audit-action-id="${UI.escapeHTML(row.assetId)}" data-audit-action="needs_review">Needs Review</button>
        </div>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="text-muted">No audit issues found.</td></tr>';
};

async function patchAuditSnapshot(assetId, patch = {}) {
  const latestAsset = await readInventoryJson(`/assets/${encodeURIComponent(assetId)}`);
  const currentSpecs = getAssetSpecs(latestAsset || {});
  const mergedSpecs = {
    ...currentSpecs,
    ...patch,
  };
  await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/details`, {
    specifications: mergedSpecs,
  }, 'PATCH');
}

function getAuditRowByAssetId(assetId) {
  return (auditBoardRows || []).find((row) => String(row.assetId || '') === String(assetId || '')) || null;
}

window.auditVerifyAssetLocation = async (assetId) => {
  const row = getAuditRowByAssetId(assetId);
  const form = await showInventoryFormModal({
    title: 'Mark Verified',
    message: `Asset: ${row?.name || assetId}`,
    confirmText: 'Save Verification',
    confirmClass: 'btn-outline-success',
    dialogClass: 'modal-md',
    fields: [
      {
        name: 'location',
        label: 'Observed Location',
        type: 'select',
        options: getKnownBuildingOptions(),
        value: row?.location || '',
        required: false,
      },
      {
        name: 'condition',
        label: 'Condition',
        type: 'select',
        options: ['Good', 'Needs Review', 'Damaged'],
        value: 'Good',
        required: true,
      },
      {
        name: 'notes',
        label: 'Notes',
        type: 'textarea',
        rows: 3,
        required: false,
      },
      {
        name: 'verifier',
        label: 'Auditor',
        type: 'text',
        value: row?.lastVerifiedBy || 'inventory-tech',
        required: true,
      },
    ],
  });
  if (!form?.confirmed) return;

  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/verify-location`, {
      location: form.values.location || null,
      verifier: form.values.verifier,
      markMissing: false,
    });
    await patchAuditSnapshot(assetId, {
      verificationStatus: 'verified',
      verificationCondition: form.values.condition || 'Good',
      verificationNotes: form.values.notes || null,
      verificationLocation: form.values.location || row?.location || null,
      lastVerifiedAt: new Date().toISOString(),
      lastVerifiedBy: form.values.verifier,
    });
    showMessage(`Asset ${assetId} verified.`, 'success');
    await Promise.all([window.loadAuditBoard(), loadAssets()]);
  } catch (error) {
    showMessage(error.message || 'Failed to verify asset.', 'error');
  }
};

window.auditMarkAssetMissing = async (assetId) => {
  const row = getAuditRowByAssetId(assetId);
  const form = await showInventoryFormModal({
    title: 'Mark Missing',
    message: `Asset: ${row?.name || assetId}`,
    confirmText: 'Mark Missing',
    confirmClass: 'btn-danger',
    dialogClass: 'modal-md',
    fields: [
      {
        name: 'location',
        label: 'Observed Location',
        type: 'select',
        options: getKnownBuildingOptions(),
        value: row?.location || '',
        required: false,
      },
      {
        name: 'condition',
        label: 'Condition',
        type: 'select',
        options: ['Missing', 'Damaged', 'Unknown'],
        value: 'Missing',
        required: true,
      },
      {
        name: 'notes',
        label: 'Notes',
        type: 'textarea',
        rows: 3,
        required: false,
      },
      {
        name: 'verifier',
        label: 'Auditor',
        type: 'text',
        value: row?.lastVerifiedBy || 'inventory-tech',
        required: true,
      },
    ],
  });
  if (!form?.confirmed) return;
  const confirmed = await confirmInventoryAction({
    title: 'Confirm Missing Status',
    message: `Mark asset ${assetId} as missing?`,
    confirmText: 'Confirm Missing',
    confirmClass: 'inventory-insight-danger',
  });
  if (!confirmed) return;
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/verify-location`, {
      verifier: form.values.verifier,
      markMissing: true,
    });
    await patchAuditSnapshot(assetId, {
      verificationStatus: 'missing',
      verificationCondition: form.values.condition || 'Missing',
      verificationNotes: form.values.notes || null,
      verificationLocation: form.values.location || row?.location || null,
      lastVerifiedAt: new Date().toISOString(),
      lastVerifiedBy: form.values.verifier,
    });
    showMessage(`Asset ${assetId} marked missing.`, 'warning');
    await Promise.all([window.loadAuditBoard(), loadAssets()]);
  } catch (error) {
    showMessage(error.message || 'Failed to mark asset missing.', 'error');
  }
};

window.auditMarkAssetDamaged = async (assetId) => {
  const row = getAuditRowByAssetId(assetId);
  const form = await showInventoryFormModal({
    title: 'Mark Damaged',
    message: `Asset: ${row?.name || assetId}`,
    confirmText: 'Mark Damaged',
    confirmClass: 'btn-warning',
    dialogClass: 'modal-md',
    fields: [
      {
        name: 'location',
        label: 'Observed Location',
        type: 'select',
        options: getKnownBuildingOptions(),
        value: row?.location || '',
        required: false,
      },
      {
        name: 'condition',
        label: 'Condition',
        type: 'select',
        options: ['Damaged', 'Needs Repair', 'Out of Service'],
        value: 'Damaged',
        required: true,
      },
      {
        name: 'notes',
        label: 'Notes',
        type: 'textarea',
        rows: 3,
        required: false,
      },
      {
        name: 'verifier',
        label: 'Auditor',
        type: 'text',
        value: row?.lastVerifiedBy || 'inventory-tech',
        required: true,
      },
    ],
  });
  if (!form?.confirmed) return;
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/status`, {
      status: 'maintenance',
      lifecycleStatus: 'pending_repair',
      actor: form.values.verifier,
      reason: 'audit_mark_damaged',
    }, 'PATCH');
    await patchAuditSnapshot(assetId, {
      verificationStatus: 'damaged',
      verificationCondition: form.values.condition || 'Damaged',
      verificationNotes: form.values.notes || null,
      verificationLocation: form.values.location || row?.location || null,
      lastVerifiedAt: new Date().toISOString(),
      lastVerifiedBy: form.values.verifier,
    });
    showMessage(`Asset ${assetId} marked damaged and moved to maintenance.`, 'warning');
    await Promise.all([window.loadAuditBoard(), loadAssets()]);
  } catch (error) {
    showMessage(error.message || 'Failed to mark asset damaged.', 'error');
  }
};

window.auditMarkWrongLocation = async (assetId) => {
  const row = getAuditRowByAssetId(assetId);
  const form = await showInventoryFormModal({
    title: 'Wrong Location',
    message: `Asset: ${row?.name || assetId}`,
    confirmText: 'Record',
    confirmClass: 'btn-primary',
    dialogClass: 'modal-md',
    fields: [
      {
        name: 'location',
        label: 'Observed Location',
        type: 'select',
        options: getKnownBuildingOptions(),
        value: row?.location || '',
        required: true,
      },
      {
        name: 'updateLocation',
        label: 'Update asset location to observed location now',
        type: 'checkbox',
        value: false,
        required: false,
      },
      {
        name: 'notes',
        label: 'Notes',
        type: 'textarea',
        rows: 3,
        required: false,
      },
      {
        name: 'verifier',
        label: 'Auditor',
        type: 'text',
        value: row?.lastVerifiedBy || 'inventory-tech',
        required: true,
      },
    ],
  });
  if (!form?.confirmed) return;

  try {
    if (form.values.updateLocation) {
      const confirmed = await confirmInventoryAction({
        title: 'Confirm Location Update',
        message: `Update asset ${assetId} location to ${form.values.location}?`,
        confirmText: 'Update Location',
        confirmClass: 'inventory-insight-primary',
        type: 'warning',
      });
      if (!confirmed) return;
      await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/verify-location`, {
        location: form.values.location,
        verifier: form.values.verifier,
        markMissing: false,
      });
    } else {
      const latestAsset = await readInventoryJson(`/assets/${encodeURIComponent(assetId)}`);
      await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/status`, {
        status: latestAsset?.status || 'active',
        lifecycleStatus: latestAsset?.lifecycleStatus || 'in_use',
        actor: form.values.verifier,
        reason: 'audit_wrong_location_needs_review',
      }, 'PATCH');
    }
    await patchAuditSnapshot(assetId, {
      verificationStatus: 'location_mismatch',
      verificationCondition: 'Wrong location',
      verificationNotes: form.values.notes || null,
      verificationLocation: form.values.location,
      lastVerifiedAt: new Date().toISOString(),
      lastVerifiedBy: form.values.verifier,
    });
    showMessage(form.values.updateLocation ? 'Location updated after confirmation.' : 'Wrong-location audit recorded without changing asset location.', 'success');
    await Promise.all([window.loadAuditBoard(), loadAssets()]);
  } catch (error) {
    showMessage(error.message || 'Failed to record wrong-location audit.', 'error');
  }
};

window.auditMarkNeedsReview = async (assetId) => {
  const row = getAuditRowByAssetId(assetId);
  const form = await showInventoryFormModal({
    title: 'Needs Review',
    message: `Asset: ${row?.name || assetId}`,
    confirmText: 'Mark Needs Review',
    confirmClass: 'btn-secondary',
    dialogClass: 'modal-md',
    fields: [
      {
        name: 'location',
        label: 'Observed Location',
        type: 'select',
        options: getKnownBuildingOptions(),
        value: row?.location || '',
        required: false,
      },
      {
        name: 'condition',
        label: 'Condition',
        type: 'select',
        options: ['Needs Review', 'Pending Verification', 'Unknown'],
        value: 'Needs Review',
        required: true,
      },
      {
        name: 'notes',
        label: 'Notes',
        type: 'textarea',
        rows: 3,
        required: true,
      },
      {
        name: 'verifier',
        label: 'Auditor',
        type: 'text',
        value: row?.lastVerifiedBy || 'inventory-tech',
        required: true,
      },
    ],
  });
  if (!form?.confirmed) return;
  try {
    const latestAsset = await readInventoryJson(`/assets/${encodeURIComponent(assetId)}`);
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/status`, {
      status: latestAsset?.status || 'active',
      lifecycleStatus: latestAsset?.lifecycleStatus || 'in_use',
      actor: form.values.verifier,
      reason: 'audit_needs_review',
    }, 'PATCH');
    await patchAuditSnapshot(assetId, {
      verificationStatus: 'needs_review',
      verificationCondition: form.values.condition || 'Needs Review',
      verificationNotes: form.values.notes || null,
      verificationLocation: form.values.location || row?.location || null,
      lastVerifiedAt: new Date().toISOString(),
      lastVerifiedBy: form.values.verifier,
    });
    showMessage(`Asset ${assetId} marked for review.`, 'info');
    await Promise.all([window.loadAuditBoard(), loadAssets()]);
  } catch (error) {
    showMessage(error.message || 'Failed to mark asset for review.', 'error');
  }
};

function procurementStatusBadgeClass(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'approved' || normalized === 'received' || normalized === 'closed') return 'bg-success';
  if (normalized === 'ordered' || normalized === 'partially received' || normalized === 'under review') return 'bg-warning text-dark';
  if (normalized === 'rejected' || normalized === 'cancelled') return 'bg-danger';
  return 'bg-secondary';
}

function formatProcurementDate(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString();
}

function getProcurementRequestById(requestId) {
  const rows = Array.isArray(procurementBoardState?.board?.requests) ? procurementBoardState.board.requests : [];
  return rows.find((row) => String(row.requestId || '') === String(requestId || '')) || null;
}

function renderProcurementBoard() {
  const summaryEl = document.getElementById('procurementBoardSummary');
  const badgesEl = document.getElementById('procurementStatusBadges');
  const analyticsEl = document.getElementById('procurementAnalyticsSummary');
  const priorityBody = document.getElementById('procurementPriorityTableBody');
  const recBody = document.getElementById('procurementRecommendationsTableBody');
  const requestsBody = document.getElementById('procurementRequestsTableBody');
  if (!summaryEl || !badgesEl || !analyticsEl || !priorityBody || !recBody || !requestsBody) return;
  const board = procurementBoardState.board;
  if (!board) {
    summaryEl.textContent = 'Procurement board data is unavailable.';
    badgesEl.innerHTML = '';
    analyticsEl.textContent = '';
    priorityBody.innerHTML = '<tr><td colspan="4" class="text-muted">No data.</td></tr>';
    recBody.innerHTML = '<tr><td colspan="6" class="text-muted">No recommendations.</td></tr>';
    requestsBody.innerHTML = '<tr><td colspan="6" class="text-muted">No requests.</td></tr>';
    return;
  }
  summaryEl.textContent = String(board.summary || 'Procurement board loaded.');
  const counts = board.statusCounts && typeof board.statusCounts === 'object' ? board.statusCounts : {};
  badgesEl.innerHTML = Object.entries(counts).map(([status, count]) => `
    <span class="badge ${procurementStatusBadgeClass(status)}">${UI.escapeHTML(status)}: ${UI.escapeHTML(String(count || 0))}</span>
  `).join('') || '<span class="text-muted small">No request counts.</span>';

  const analytics = board.analytics || {};
  analyticsEl.textContent = [
    `Monthly spend estimate: ${formatCurrencyEGP(analytics.monthlySpendingEstimate)}`,
    `Open POs: ${analytics.openPurchaseOrders ?? 0}`,
    `Aging approved/ordered requests: ${analytics.agingApprovedRequests ?? 0}`,
    `Received: ${analytics.receivedVsPending?.received ?? 0}`,
    `Pending: ${analytics.receivedVsPending?.pending ?? 0}`,
  ].join(' | ');

  const priorities = board.priorities || {};
  const priorityRows = [];
  (Array.isArray(priorities.urgentReplacements) ? priorities.urgentReplacements.slice(0, 6) : []).forEach((row) => {
    priorityRows.push({
      stream: 'Urgent Replacements',
      item: `${row.assetName || row.assetId || '-'}`,
      need: `Window: ${row.procurementWindowMonths ?? '-'} month(s)`,
      reason: row.reason || row.status || '-',
    });
  });
  (Array.isArray(priorities.highRiskAssets) ? priorities.highRiskAssets.slice(0, 6) : []).forEach((row) => {
    priorityRows.push({
      stream: 'High Risk Assets',
      item: `${row.assetName || row.assetId || '-'}`,
      need: `${String(row.riskLevel || '-').toUpperCase()} (${row.riskScore ?? '-'})`,
      reason: row.reason || '-',
    });
  });
  (Array.isArray(priorities.lowStockItems) ? priorities.lowStockItems.slice(0, 6) : []).forEach((row) => {
    priorityRows.push({
      stream: 'Low Stock',
      item: row.itemName || '-',
      need: `Current ${row.currentQuantity ?? '-'} | Reorder ${row.reorderPoint ?? '-'}`,
      reason: row.reason || '-',
    });
  });
  (Array.isArray(priorities.auditNeeds) ? priorities.auditNeeds.slice(0, 6) : []).forEach((row) => {
    priorityRows.push({
      stream: 'Audit Needs',
      item: row.assetName || row.assetId || '-',
      need: String(row.eventType || '-').replace(/_/g, ' '),
      reason: row.reason || '-',
    });
  });
  priorityBody.innerHTML = priorityRows.map((row) => `
    <tr>
      <td>${UI.escapeHTML(row.stream)}</td>
      <td>${UI.escapeHTML(row.item)}</td>
      <td>${UI.escapeHTML(row.need)}</td>
      <td>${UI.escapeHTML(row.reason)}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="text-muted">No priority items detected.</td></tr>';

  const recommendations = Array.isArray(board.aiRecommendations) ? board.aiRecommendations : [];
  recBody.innerHTML = recommendations.map((row, index) => `
    <tr>
      <td>${UI.escapeHTML(row.itemName || '-')}</td>
      <td>${UI.escapeHTML(row.type || '-')}</td>
      <td>${UI.escapeHTML(String(row.recommendedQuantity ?? '-'))}</td>
      <td>${UI.escapeHTML(String(row.priority || '-').toUpperCase())}</td>
      <td>${UI.escapeHTML(row.reason || '-')}</td>
      <td class="text-end">
        <button type="button" class="btn btn-sm btn-outline-primary" data-procurement-create-ai="${UI.escapeHTML(String(index))}">Create Request</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="text-muted">No AI procurement recommendations available.</td></tr>';

  const requests = Array.isArray(board.requests) ? board.requests : [];
  requestsBody.innerHTML = requests.map((row) => {
    const selectedQuote = Array.isArray(row.vendorQuotes) ? row.vendorQuotes.find((quote) => quote.selected) : null;
    return `
      <tr>
        <td>
          <div class="fw-semibold">${UI.escapeHTML(row.requestId || '-')}</div>
          <div class="small text-muted">${UI.escapeHTML(row.title || '-')}</div>
        </td>
        <td>
          <div>${UI.escapeHTML(String(row.quantity || 1))} x ${UI.escapeHTML(row.itemType || '-')}</div>
          <div class="small text-muted">${UI.escapeHTML(row.reason || '-')}</div>
        </td>
        <td>
          <div>${UI.escapeHTML(row.requestedBy || '-')}</div>
          <div class="small text-muted">${UI.escapeHTML(row.linkedDepartment || 'Unassigned')} | ${UI.escapeHTML(row.linkedLocation || '-')}</div>
          ${selectedQuote ? `<div class="small text-muted">Selected quote: ${UI.escapeHTML(selectedQuote.vendorName || '-')} (${selectedQuote.totalPrice !== null ? UI.escapeHTML(formatCurrencyEGP(selectedQuote.totalPrice)) : '-'})</div>` : ''}
        </td>
        <td><span class="badge ${procurementStatusBadgeClass(row.status)}">${UI.escapeHTML(row.status || '-')}</span></td>
        <td>${UI.escapeHTML(formatProcurementDate(row.updatedAt))}</td>
        <td class="text-end">
          <div class="d-flex flex-wrap justify-content-end gap-1">
            <button type="button" class="btn btn-sm btn-outline-secondary" data-procurement-update-status="${UI.escapeHTML(row.requestId || '')}">Status</button>
            <button type="button" class="btn btn-sm btn-outline-secondary" data-procurement-add-quote="${UI.escapeHTML(row.requestId || '')}">Add Quote</button>
            <button type="button" class="btn btn-sm btn-outline-secondary" data-procurement-create-po="${UI.escapeHTML(row.requestId || '')}">Create PO</button>
            <button type="button" class="btn btn-sm btn-outline-success" data-procurement-receive="${UI.escapeHTML(row.requestId || '')}">Receive</button>
          </div>
        </td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="6" class="text-muted">No procurement requests yet.</td></tr>';
}

window.openProcurementWorkspace = () => {
  window.location.href = '/pages/procurement.html';
};

window.openProcurementBoardModal = async () => {
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('procurementBoardModal'));
  modal.show();
  await window.loadProcurementBoard();
};

window.loadProcurementBoard = async () => {
  const summaryEl = document.getElementById('procurementBoardSummary');
  const statusFilter = String(document.getElementById('procurementStatusFilter')?.value || 'all').trim() || 'all';
  if (summaryEl) summaryEl.textContent = 'Loading procurement board...';
  try {
    procurementBoardState.loading = true;
    procurementBoardState.board = await readInventoryJson(`/inventory/procurement/board?status=${encodeURIComponent(statusFilter)}`);
    renderProcurementBoard();
  } catch (error) {
    if (summaryEl) summaryEl.textContent = 'Could not load procurement board.';
    showMessage(error.message || 'Failed to load procurement board.', 'error');
  } finally {
    procurementBoardState.loading = false;
  }
};

window.createProcurementRequestManual = async () => {
  const form = await showInventoryFormModal({
    title: 'Create Procurement Request',
    message: 'Create a manual procurement request linked to inventory need.',
    confirmText: 'Create Request',
    confirmClass: 'btn-primary',
    dialogClass: 'modal-lg',
    fields: [
      { name: 'title', label: 'Title', type: 'text', value: '', required: true },
      { name: 'itemCategory', label: 'Item Category', type: 'select', options: ['replacement', 'spare_stock', 'consumable', 'license', 'new_asset'], value: 'replacement', required: true },
      { name: 'itemType', label: 'Item / Type', type: 'text', value: '', required: true },
      { name: 'quantity', label: 'Quantity', type: 'number', value: '1', required: true, min: 1 },
      { name: 'priority', label: 'Priority', type: 'select', options: ['low', 'medium', 'high', 'critical'], value: 'medium', required: true },
      { name: 'reason', label: 'Reason', type: 'textarea', rows: 3, required: true },
      { name: 'linkedDepartment', label: 'Linked Department', type: 'select', options: ['Unassigned', ...STANDARD_MIU_DEPARTMENTS.filter((entry) => entry !== 'Unassigned')], value: 'Unassigned', required: false },
      { name: 'linkedLocation', label: 'Linked Building/Location', type: 'select', options: getKnownBuildingOptions(), value: '', required: false },
      { name: 'linkedAssetIds', label: 'Linked Asset IDs (comma separated)', type: 'text', value: '', required: false },
      { name: 'requestedBy', label: 'Requested By', type: 'text', value: 'Inventory Team', required: true },
      { name: 'requiredDate', label: 'Required Date', type: 'date', value: '', required: false },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, required: false },
    ],
  });
  if (!form?.confirmed) return;
  const linkedAssetIds = String(form.values.linkedAssetIds || '')
    .split(',')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  try {
    await postInventoryJson('/inventory/procurement/requests', {
      title: form.values.title,
      itemCategory: form.values.itemCategory,
      itemType: form.values.itemType,
      quantity: Number(form.values.quantity || 1),
      priority: form.values.priority,
      reason: form.values.reason,
      linkedAssetIds,
      linkedDepartment: form.values.linkedDepartment || null,
      linkedLocation: form.values.linkedLocation || null,
      requestedBy: form.values.requestedBy || 'Inventory Team',
      requiredDate: form.values.requiredDate || null,
      notes: form.values.notes || '',
      source: 'manual_request',
    });
    showMessage('Procurement request created.', 'success');
    await window.loadProcurementBoard();
  } catch (error) {
    showMessage(error.message || 'Failed to create procurement request.', 'error');
  }
};

window.createProcurementRequestFromAi = async (index) => {
  const board = procurementBoardState.board || {};
  const recs = Array.isArray(board.aiRecommendations) ? board.aiRecommendations : [];
  const row = recs[index];
  if (!row) {
    showMessage('Recommendation not found.', 'warning');
    return;
  }
  const form = await showInventoryFormModal({
    title: 'Create Request From AI Recommendation',
    message: 'Review details before creating procurement request.',
    confirmText: 'Create Request',
    confirmClass: 'btn-primary',
    dialogClass: 'modal-lg',
    fields: [
      { name: 'title', label: 'Title', type: 'text', value: `Procure ${row.itemName || 'item'}`, required: true },
      { name: 'itemCategory', label: 'Item Category', type: 'select', options: ['spare_stock', 'replacement', 'consumable', 'license', 'new_asset'], value: 'spare_stock', required: true },
      { name: 'itemType', label: 'Item / Type', type: 'text', value: row.type || row.itemName || '', required: true },
      { name: 'quantity', label: 'Quantity', type: 'number', value: String(row.recommendedQuantity || 1), required: true, min: 1 },
      { name: 'priority', label: 'Priority', type: 'select', options: ['low', 'medium', 'high', 'critical'], value: String(row.priority || 'medium').toLowerCase(), required: true },
      { name: 'reason', label: 'Reason', type: 'textarea', rows: 3, value: row.reason || '', required: true },
      { name: 'requestedBy', label: 'Requested By', type: 'text', value: 'Inventory AI Copilot', required: true },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, value: 'Generated from AI procurement recommendation. Review before approval.', required: false },
    ],
  });
  if (!form?.confirmed) return;
  try {
    await postInventoryJson('/inventory/procurement/requests', {
      title: form.values.title,
      itemCategory: form.values.itemCategory,
      itemType: form.values.itemType,
      quantity: Number(form.values.quantity || 1),
      priority: form.values.priority,
      reason: form.values.reason,
      requestedBy: form.values.requestedBy || 'Inventory AI Copilot',
      notes: form.values.notes || '',
      source: 'ai_recommendation',
      aiContext: {
        llmUsed: true,
        sourceLabel: 'gemma_generated',
        confidence: String(row.priority || 'medium').toLowerCase(),
      },
    });
    showMessage('Procurement request created from AI recommendation.', 'success');
    await window.loadProcurementBoard();
  } catch (error) {
    showMessage(error.message || 'Failed to create request from recommendation.', 'error');
  }
};

window.updateProcurementRequestStatus = async (requestId) => {
  const request = getProcurementRequestById(requestId);
  if (!request) {
    showMessage('Procurement request not found.', 'warning');
    return;
  }
  const form = await showInventoryFormModal({
    title: `Update Status - ${requestId}`,
    message: `${request.title || ''}`,
    confirmText: 'Update Status',
    confirmClass: 'btn-outline-primary',
    dialogClass: 'modal-md',
    fields: [
      { name: 'status', label: 'Status', type: 'select', options: ['Draft', 'Submitted', 'Under Review', 'Approved', 'Rejected', 'Ordered', 'Partially Received', 'Received', 'Closed', 'Cancelled'], value: request.status || 'Draft', required: true },
      { name: 'decision', label: 'Decision', type: 'select', options: ['update', 'submit', 'approve', 'reject', 'order', 'receive', 'close', 'cancel'], value: 'update', required: true },
      { name: 'approver', label: 'Approver', type: 'text', value: 'Inventory Team', required: true },
      { name: 'reason', label: 'Reason / Comment', type: 'textarea', rows: 3, required: false },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, required: false },
    ],
  });
  if (!form?.confirmed) return;
  try {
    await postInventoryJson(`/inventory/procurement/requests/${encodeURIComponent(requestId)}/status`, {
      status: form.values.status,
      decision: form.values.decision,
      approver: form.values.approver,
      reason: form.values.reason || '',
      notes: form.values.notes || '',
    }, 'PATCH');
    showMessage('Procurement request status updated.', 'success');
    await window.loadProcurementBoard();
  } catch (error) {
    showMessage(error.message || 'Failed to update procurement status.', 'error');
  }
};

window.addProcurementVendorQuote = async (requestId) => {
  const request = getProcurementRequestById(requestId);
  if (!request) {
    showMessage('Procurement request not found.', 'warning');
    return;
  }
  const form = await showInventoryFormModal({
    title: `Add Vendor Quote - ${requestId}`,
    message: request.title || '',
    confirmText: 'Save Quote',
    confirmClass: 'btn-outline-primary',
    dialogClass: 'modal-lg',
    fields: [
      { name: 'vendorName', label: 'Vendor Name', type: 'text', value: '', required: true },
      { name: 'quotedItem', label: 'Quoted Item', type: 'text', value: request.itemType || request.title || '', required: true },
      { name: 'unitPrice', label: 'Unit Price', type: 'number', value: '', required: false, min: 0, step: 0.01 },
      { name: 'quantity', label: 'Quantity', type: 'number', value: String(request.quantity || 1), required: true, min: 1 },
      { name: 'warrantyMonths', label: 'Warranty (months)', type: 'number', value: '', required: false, min: 0 },
      { name: 'deliveryDays', label: 'Delivery Time (days)', type: 'number', value: '', required: false, min: 0 },
      { name: 'reliabilityScore', label: 'Reliability Score (1-10)', type: 'number', value: '', required: false, min: 1, max: 10 },
      { name: 'selected', label: 'Select this quote', type: 'checkbox', value: true, required: false },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, required: false },
    ],
  });
  if (!form?.confirmed) return;
  try {
    await postInventoryJson(`/inventory/procurement/requests/${encodeURIComponent(requestId)}/vendor-quotes`, {
      vendorName: form.values.vendorName,
      quotedItem: form.values.quotedItem,
      unitPrice: form.values.unitPrice !== '' ? Number(form.values.unitPrice) : null,
      quantity: Number(form.values.quantity || request.quantity || 1),
      warrantyMonths: form.values.warrantyMonths !== '' ? Number(form.values.warrantyMonths) : null,
      deliveryDays: form.values.deliveryDays !== '' ? Number(form.values.deliveryDays) : null,
      reliabilityScore: form.values.reliabilityScore !== '' ? Number(form.values.reliabilityScore) : null,
      selected: Boolean(form.values.selected),
      notes: form.values.notes || '',
    });
    showMessage('Vendor quote added.', 'success');
    await window.loadProcurementBoard();
  } catch (error) {
    showMessage(error.message || 'Failed to add vendor quote.', 'error');
  }
};

window.createProcurementPurchaseOrder = async (requestId) => {
  const request = getProcurementRequestById(requestId);
  if (!request) {
    showMessage('Procurement request not found.', 'warning');
    return;
  }
  const form = await showInventoryFormModal({
    title: `Create Purchase Order - ${requestId}`,
    message: request.title || '',
    confirmText: 'Create PO',
    confirmClass: 'btn-outline-primary',
    dialogClass: 'modal-md',
    fields: [
      { name: 'poNumber', label: 'PO Number', type: 'text', value: `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${requestId.slice(-4)}`, required: true },
      { name: 'vendorName', label: 'Vendor', type: 'text', value: request.vendorQuotes?.find((row) => row.selected)?.vendorName || '', required: true },
      { name: 'expectedDelivery', label: 'Expected Delivery', type: 'date', value: '', required: false },
      { name: 'status', label: 'PO Status', type: 'select', options: ['ordered', 'processing', 'partial_delivery'], value: 'ordered', required: true },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, required: false },
    ],
  });
  if (!form?.confirmed) return;
  try {
    await postInventoryJson(`/inventory/procurement/requests/${encodeURIComponent(requestId)}/purchase-order`, {
      poNumber: form.values.poNumber,
      vendorName: form.values.vendorName,
      expectedDelivery: form.values.expectedDelivery || null,
      status: form.values.status,
      notes: form.values.notes || '',
    });
    showMessage('Purchase order created.', 'success');
    await window.loadProcurementBoard();
  } catch (error) {
    showMessage(error.message || 'Failed to create purchase order.', 'error');
  }
};

window.receiveProcurementRequest = async (requestId) => {
  const request = getProcurementRequestById(requestId);
  if (!request) {
    showMessage('Procurement request not found.', 'warning');
    return;
  }
  const form = await showInventoryFormModal({
    title: `Receive Request - ${requestId}`,
    message: request.title || '',
    confirmText: 'Confirm Receiving',
    confirmClass: 'btn-success',
    dialogClass: 'modal-lg',
    fields: [
      { name: 'receivedQuantity', label: 'Received Quantity', type: 'number', value: String(request.quantity || 1), required: true, min: 1 },
      { name: 'receivedBy', label: 'Received By', type: 'text', value: 'inventory-receiving', required: true },
      { name: 'condition', label: 'Condition', type: 'select', options: ['good', 'partial', 'damaged', 'needs_inspection'], value: 'good', required: true },
      { name: 'applyTarget', label: 'Apply Receiving To', type: 'select', options: [{ value: 'none', label: 'Record only (no stock update)' }, { value: 'spare_stock', label: 'Spare Stock quantity update' }], value: 'none', required: true },
      { name: 'spareStockItemId', label: 'Spare Stock Item ID (if apply target is spare stock)', type: 'text', value: '', required: false, placeholder: 'Paste spare stock item UUID' },
      { name: 'notes', label: 'Receiving Notes', type: 'textarea', rows: 2, required: false },
    ],
  });
  if (!form?.confirmed) return;
  if (String(form.values.applyTarget || '') === 'spare_stock' && !String(form.values.spareStockItemId || '').trim()) {
    showMessage('Spare stock item ID is required when applying to spare stock.', 'warning');
    return;
  }
  try {
    const payload = {
      receivedQuantity: Number(form.values.receivedQuantity || 1),
      receivedBy: form.values.receivedBy || 'inventory-receiving',
      condition: form.values.condition || 'good',
      applyTarget: form.values.applyTarget || 'none',
      spareStockItemId: form.values.spareStockItemId || null,
      notes: form.values.notes || '',
    };
    const preview = await postInventoryJson(`/inventory/procurement/requests/${encodeURIComponent(requestId)}/receive`, {
      ...payload,
      previewOnly: true,
    });
    const impact = preview?.impactPreview || {};
    const confirmResult = await showInventoryFormModal({
      title: 'Confirm Receiving Impact',
      messageHtml: `
        <div class="alert alert-light border small mb-1">
          <div><strong>Request:</strong> ${UI.escapeHTML(String(impact.requestId || requestId))}</div>
          <div><strong>Item:</strong> ${UI.escapeHTML(String(impact.itemName || request.itemType || '-'))}</div>
          <div><strong>Quantity:</strong> ${UI.escapeHTML(String(impact.receivedQuantity || payload.receivedQuantity))}</div>
          <div><strong>Apply Target:</strong> ${UI.escapeHTML(String(impact.applyTarget || payload.applyTarget).replace(/_/g, ' '))}</div>
          ${impact.applyTarget === 'spare_stock'
            ? `<div><strong>Stock Change:</strong> ${UI.escapeHTML(String(impact.spareStockBefore ?? '-'))} -> ${UI.escapeHTML(String(impact.spareStockAfter ?? '-'))}</div>`
            : ''}
          <div class="text-muted mt-1">${UI.escapeHTML(String(impact.summary || 'Review receiving impact before applying.'))}</div>
        </div>
      `,
      confirmText: 'Apply Receiving',
      confirmClass: 'btn-success',
      dialogClass: 'modal-md',
      fields: [{
        name: 'confirmImpact',
        label: 'I reviewed and approve this receiving impact',
        type: 'checkbox',
        value: false,
        required: true,
        validate: (value) => (value ? '' : 'You must confirm inventory impact to continue.'),
      }],
    });
    if (!confirmResult?.confirmed) return;
    const result = await postInventoryJson(`/inventory/procurement/requests/${encodeURIComponent(requestId)}/receive`, {
      ...payload,
      confirmInventoryImpact: true,
      previewOnly: false,
    });
    showMessage(result?.followUp || 'Receiving recorded.', 'success');
    await Promise.all([window.loadProcurementBoard(), loadAssets()]);
  } catch (error) {
    showMessage(error.message || 'Failed to receive procurement request.', 'error');
  }
};

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

function formatCmdbValue(value) {
  const raw = String(value ?? '').trim();
  return raw ? UI.escapeHTML(raw) : '-';
}

function formatCmdbDate(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString();
}

function formatCmdbCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '-';
  return formatCurrencyEGP(amount);
}

function getCmdbRelationshipLabel(relationshipType) {
  const normalized = normalizeValue(relationshipType);
  const labelMap = {
    assignedto: 'Assigned to this asset',
    licensedto: 'Licensed to this asset',
    installedin: 'Installed in this asset',
    usedwith: 'Used with this asset',
    consumedby: 'Consumed by this asset',
    sparefor: 'Spare for this asset',
    connectedto: 'Connected to this asset',
    dependson: 'Depends on this asset',
    relatedto: 'Related to this asset',
  };
  return labelMap[normalized] || `Related (${String(relationshipType || 'unknown').replace(/_/g, ' ')})`;
}

function getCmdbLifecycleEventLabel(eventType) {
  const normalized = normalizeValue(eventType);
  const labelMap = {
    licenseimportedassigned: 'License assigned during import',
    accessoryimportedassigned: 'Accessory assigned during import',
    componentimported: 'Component installed during import',
    assetimported: 'Asset created during import',
    assetcreated: 'Asset created',
    assettransferred: 'Asset transferred',
    maintenancerecorded: 'Maintenance added',
    custodycheckedout: 'Custody checkout',
    custodycheckedin: 'Custody check-in',
    loanercheckedout: 'Loaner checkout',
    loanerreturned: 'Loaner return',
    assetupdated: 'Asset details updated',
  };
  return labelMap[normalized] || capitalize(String(eventType || '-').replace(/_/g, ' '));
}

function getCmdbLifecycleRelatedSummary(row) {
  const details = row && typeof row === 'object' ? row : {};
  const merged = {
    ...(details.oldValue && typeof details.oldValue === 'object' ? details.oldValue : {}),
    ...(details.newValue && typeof details.newValue === 'object' ? details.newValue : {}),
    ...(details.metadata && typeof details.metadata === 'object' ? details.metadata : {}),
  };
  const candidateName = merged.relatedAssetName || merged.relatedName || merged.componentName || merged.accessoryName || merged.licenseName || merged.parentName || merged.assetName;
  const candidateTag = merged.relatedAssetTag || merged.relatedTag || merged.assetTag || merged.parentTag;
  if (!candidateName && !candidateTag) return '';
  return [candidateName, candidateTag].filter(Boolean).join(' | ');
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
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
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
      document.querySelectorAll('body > .modal-backdrop').forEach((backdrop, index, list) => {
        if (index < list.length - 1) backdrop.remove();
      });
    });
  }
  return bootstrap.Modal.getOrCreateInstance(modalEl);
}

async function fetchCmdbData(customId) {
  const [components, maintenance, custody, relationships, lifecycleEvents, kitHealth] = await Promise.all([
    readInventoryJson(`/assets/${encodeURIComponent(customId)}/components?includeRemoved=true`).catch(() => []),
    readInventoryJson(`/assets/${encodeURIComponent(customId)}/maintenance`).catch(() => []),
    readInventoryJson(`/assets/${encodeURIComponent(customId)}/custody`).catch(() => []),
    readInventoryJson(`/assets/${encodeURIComponent(customId)}/relationships`).catch(() => ({ outgoing: [], incoming: [] })),
    readInventoryJson(`/assets/${encodeURIComponent(customId)}/lifecycle-events`).catch(() => []),
    readInventoryJson(`/assets/${encodeURIComponent(customId)}/kit-health`).catch(() => null),
  ]);
  return { components, maintenance, custody, relationships, lifecycleEvents, kitHealth };
}

function renderCmdbBody(customId, data, asset) {
  const installedParent = getInstalledParentInfo(asset || {});
  const specs = getAssetSpecs(asset || {});
  const categoryKey = getAssetCategoryKey(asset || {});
  const isComponentContext = isInstalledComponentAsset(asset || {});
  const isAccessoryContext = categoryKey === 'accessory';
  const isConsumableContext = categoryKey === 'consumable';
  const isSparePartContext = categoryKey === 'spare_part';
  const isLicenseContext = categoryKey === 'license';
  const showComponentsTab = !(isComponentContext || isAccessoryContext || isConsumableContext || isSparePartContext || isLicenseContext);
  const isParentContext = showComponentsTab;
  const maintenanceTabLabel = (isConsumableContext || isSparePartContext) ? 'Stock/Adjustments' : 'Maintenance';
  const maintenanceActionLabel = (isConsumableContext || isSparePartContext) ? 'Add Adjustment' : 'Add Maintenance';
  const maintenanceEmptyLabel = (isConsumableContext || isSparePartContext) ? 'No stock adjustments.' : 'No maintenance records.';
  const custodyTabLabel = isLicenseContext ? 'Assignment' : 'Assignment/Custody';
  const relationshipsTabLabel = isConsumableContext ? 'Usage/Relationships' : 'Relationships';
  const kitHealth = data?.kitHealth?.kitHealth || null;
  const kitStatus = String(kitHealth?.status || 'unknown').toLowerCase();
  const kitBadgeClass = kitStatus === 'complete'
    ? 'bg-success'
    : (kitStatus === 'missing_child_item'
      ? 'bg-danger'
      : (kitStatus === 'under_repair'
        ? 'bg-warning text-dark'
        : (kitStatus === 'damaged_child_item' || kitStatus === 'degraded'
          ? 'bg-warning text-dark'
          : 'bg-secondary')));
  const missingChildren = Array.isArray(kitHealth?.evidence?.missingChildren) ? kitHealth.evidence.missingChildren : [];
  const damagedChildren = Array.isArray(kitHealth?.evidence?.damagedChildren) ? kitHealth.evidence.damagedChildren : [];
  const repairChildren = Array.isArray(kitHealth?.evidence?.underRepairChildren) ? kitHealth.evidence.underRepairChildren : [];
  const wifiInfo = {
    macAddress: String(specs.macAddress || '').trim(),
    lastSeenNetwork: String(specs.lastSeenNetwork || '').trim(),
    lastSeenAccessPoint: String(specs.lastSeenAccessPoint || '').trim(),
    lastSeenLocation: String(specs.lastSeenLocation || '').trim(),
    lastSeenTimestamp: String(specs.lastSeenTimestamp || '').trim(),
    mismatch: Boolean(specs.networkLocationMismatch),
  };
  const loanerEligible = Boolean(specs.loanerEligible);
  const loanerStatus = String(specs.loanerStatus || '').trim().toLowerCase();
  const showLoanerActions = !isConsumableContext && !isSparePartContext && !isLicenseContext;
  const showWifiPanel = !isConsumableContext && !isSparePartContext && !isLicenseContext;
  const profile = getAssetProfile(asset || {});
  const lifecycleSnapshot = getLifecycleSnapshot(asset || {});
  const categoryLabelMap = {
    asset: 'Parent Asset',
    component: 'Component',
    accessory: 'Accessory',
    consumable: 'Consumable',
    spare_part: 'Spare Stock',
    license: 'License',
  };
  const categoryLabel = categoryLabelMap[categoryKey] || capitalize(String(categoryKey || 'asset').replace(/_/g, ' '));
  const displayLocationLabel = getAssetDisplayLocation(asset);
  const displayDepartmentLabel = getAssetDisplayDepartment(asset);
  const assignedDepartmentLabel = normalizeDepartmentLabel(specs.assignedDepartment || asset?.assignedDepartment || '', { fallbackUnassigned: false });
  const assignedPersonLabel = String(specs.loanedTo || asset?.assignedToName || asset?.assignedToUserId || asset?.assignedUser || '').trim();
  const ownerLabel = String(specs.owner || specs.ownerName || '').trim();
  const hasWifiData = Boolean(wifiInfo.macAddress || wifiInfo.lastSeenNetwork || wifiInfo.lastSeenAccessPoint || wifiInfo.lastSeenLocation || wifiInfo.lastSeenTimestamp);
  const telemetryRelevant = Boolean(profile.trackWorkingHours || profile.hasTelemetry || shouldShowTelemetryControl(asset, profile));
  const telemetrySummary = telemetryRelevant
    ? `${getOperationalStateLabel(profile.telemetryStatus)} (${capitalize(String(profile.telemetryConfidence || 'low'))} confidence${profile.hasTelemetry ? ` | ${Math.round(Number(profile.workingHours || 0)).toLocaleString()}h observed` : ''})`
    : '';
  const identityRows = [
    { label: 'Asset Name', value: asset?.name || '' },
    { label: 'Asset Tag / Unique ID', value: `${getDisplayAssetTag(asset) || '-'} | ${asset?.customId || '-'}` },
    { label: 'Serial Number', value: getDisplaySerial(asset) || '' },
    { label: 'Category / Record Type', value: categoryLabel },
    { label: 'Asset Type', value: formatType(asset?.type || '-') },
    { label: 'Brand / Model', value: [specs.brand || asset?.brand, specs.version || specs.model || asset?.model].filter(Boolean).join(' / ') || '' },
    { label: 'Location', value: displayLocationLabel },
    { label: 'Department', value: displayDepartmentLabel },
    { label: 'Status', value: displayStatus(asset?.status || 'active') },
    { label: 'Lifecycle Status', value: displayLifecycleStatus(asset?.lifecycleStatus || asset?.lifecycle_status || '') },
    { label: 'Warranty Start', value: formatCmdbDate(asset?.warrantyStartDate || lifecycleSnapshot?.warrantyStartDate || specs.warrantyStartDate) },
    { label: 'Warranty End', value: formatCmdbDate(asset?.warrantyEndDate || lifecycleSnapshot?.warrantyEndDate || specs.warrantyEndDate) },
    { label: 'Purchase Cost', value: formatCmdbCurrency(asset?.purchaseCost || lifecycleSnapshot?.replacementCost || specs.purchaseCost || specs.replacementCost) },
    { label: 'Assigned To', value: assignedPersonLabel },
    { label: 'Assigned Department', value: assignedDepartmentLabel },
    { label: 'Owner', value: ownerLabel },
  ];
  if (telemetrySummary) {
    identityRows.push({ label: 'Telemetry State', value: telemetrySummary });
  }
  if ((isComponentContext || isAccessoryContext || isConsumableContext || isSparePartContext || isLicenseContext) && installedParent.hasParent) {
    identityRows.push({ label: 'Parent Asset Name', value: installedParent.parentName || '-' });
    identityRows.push({ label: 'Parent Asset Tag', value: installedParent.parentTag || installedParent.parentId || '-' });
  }
  const custodyStatus = String(asset?.custodyStatus || '').trim().toLowerCase();
  const hasActiveAssignment = Boolean(
    assignedPersonLabel
    || ['assigned', 'checked_out'].includes(custodyStatus)
    || (Array.isArray(data.custody) && data.custody.some((row) => row?.checkoutDate && !row?.returnedDate))
  );
  const isLoanedOut = ['checked_out', 'overdue'].includes(loanerStatus);
  const custodyStateLabel = isLoanedOut
    ? 'Loaned out'
    : (hasActiveAssignment
      ? (custodyStatus === 'checked_out' ? 'Checked out' : 'Assigned')
      : (loanerStatus === 'returned' ? 'Returned' : 'Available'));
  const componentsRows = (data.components || []).map((component) => `
    <tr>
      <td>
        <div>${UI.escapeHTML(component.componentName || '-')}</div>
        ${component.childAsset?.customId ? `<div class="small text-muted">Asset: ${UI.escapeHTML(component.childAsset.customId)}</div>` : ''}
      </td>
      <td>${UI.escapeHTML(component.componentType || '-')}</td>
      <td>${UI.escapeHTML([component.brand, component.model].filter(Boolean).join(' / ') || '-')}</td>
      <td>${UI.escapeHTML(component.serialNumber || '-')}</td>
      <td>${UI.escapeHTML(component.partNumber || '-')}</td>
      <td><span class="badge bg-light text-dark border">${UI.escapeHTML(cmdbStatusLabel(component.status))}</span></td>
      <td>${UI.escapeHTML(component.condition || '-')}</td>
      <td>${component.installedAt ? UI.formatDateTime(component.installedAt) : '-'}</td>
      <td class="text-end">
        ${component.childAsset?.customId ? `<button class="btn btn-sm btn-outline-success me-1" onclick="window.openAssetCmdb('${component.childAsset.customId}')">Open Asset</button>` : ''}
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

  const componentNameById = new Map(
    (data.components || []).map((row) => [String(row?.id || ''), String(row?.componentName || '').trim()]).filter((entry) => entry[0])
  );
  const maintenanceRows = (data.maintenance || []).map((row) => `
    <tr>
      <td>${row.componentId ? UI.escapeHTML(`Component: ${componentNameById.get(String(row.componentId)) || row.componentId}`) : 'Whole Asset'}</td>
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

  const allRelationshipRows = [
    ...((data.relationships?.outgoing || []).map((row) => ({ ...row, direction: 'outgoing' }))),
    ...((data.relationships?.incoming || []).map((row) => ({ ...row, direction: 'incoming' }))),
  ];
  const snapshotAssets = Array.isArray(inventoryFilterSnapshotState.allAssets) ? inventoryFilterSnapshotState.allAssets : [];
  const relRows = allRelationshipRows.map((row) => {
    const relatedAssetId = row.direction === 'incoming' ? row.assetId : row.relatedAssetId;
    const relatedAsset = currentAssets.find((entry) => entry.customId === relatedAssetId)
      || snapshotAssets.find((entry) => String(entry?.customId || '') === String(relatedAssetId || ''))
      || null;
    const relatedName = relatedAsset?.name || relatedAssetId || '-';
    const relatedCategory = relatedAsset
      ? (categoryLabelMap[getAssetCategoryKey(relatedAsset)] || formatType(relatedAsset.type || 'asset'))
      : '-';
    const relatedTag = relatedAsset ? (getDisplayAssetTag(relatedAsset) || '-') : '-';
    const relatedStatus = relatedAsset
      ? displayLifecycleStatus(relatedAsset.lifecycleStatus || relatedAsset.status || '-')
      : '-';
    const relationshipLabel = row.direction === 'incoming'
      ? `Linked to this asset (${getCmdbRelationshipLabel(row.relationshipType)})`
      : getCmdbRelationshipLabel(row.relationshipType);
    const technicalTitle = `Type: ${String(row.relationshipType || '-')} | Direction: ${String(row.direction || '-')}`;
    return `
      <tr>
        <td>${UI.escapeHTML(relatedName)}</td>
        <td>${UI.escapeHTML(relatedCategory)}</td>
        <td title="${UI.escapeHTML(technicalTitle)}">${UI.escapeHTML(relationshipLabel)}</td>
        <td>${UI.escapeHTML(relatedTag)}</td>
        <td>${UI.escapeHTML(relatedStatus)}</td>
        <td class="text-end">
          ${relatedAssetId ? `<button class="btn btn-sm btn-outline-primary me-1" onclick="window.openAssetCmdb('${relatedAssetId}')">Open Asset</button>` : ''}
          ${row.direction === 'outgoing' ? `<button class="btn btn-sm btn-outline-danger" onclick="window.cmdbDeleteRelationship('${customId}','${row.id}')">Delete</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');
  const relatedParentRelationshipType = isComponentContext
    ? 'installed_in'
    : isAccessoryContext
      ? 'used_with'
      : isConsumableContext
        ? 'consumed_by'
        : isLicenseContext
          ? 'licensed_to'
          : isSparePartContext
            ? 'spare_for'
            : 'related_to';
  const componentInstalledInRows = installedParent.hasParent
    ? `
      <tr>
        <td>${UI.escapeHTML(installedParent.parentName || installedParent.parentId || '-')}</td>
        <td>Parent Asset</td>
        <td title="${UI.escapeHTML(`Type: ${relatedParentRelationshipType} | Direction: outgoing`)}">${UI.escapeHTML(getCmdbRelationshipLabel(relatedParentRelationshipType))}</td>
        <td>${UI.escapeHTML(installedParent.parentTag || '-')}</td>
        <td>${UI.escapeHTML('Active')}</td>
        <td class="text-end">${installedParent.parentId ? `<button class="btn btn-sm btn-outline-primary" onclick="window.openAssetCmdb('${installedParent.parentId}')">Open Asset</button>` : ''}</td>
      </tr>
    `
    : '';

  const lifecycleRows = (data.lifecycleEvents || []).slice(0, 80).map((row) => {
    const eventLabel = getCmdbLifecycleEventLabel(row.eventType);
    const relatedSummary = getCmdbLifecycleRelatedSummary(row);
    return `
      <tr>
        <td>${row.createdAt ? UI.formatDateTime(row.createdAt) : '-'}</td>
        <td title="${UI.escapeHTML(String(row.eventType || '-'))}">
          <div>${UI.escapeHTML(eventLabel)}</div>
          ${relatedSummary ? `<div class="small text-muted">${UI.escapeHTML(relatedSummary)}</div>` : ''}
        </td>
        <td>${UI.escapeHTML(row.reason || '-')}</td>
        <td>${UI.escapeHTML(row.actor || '-')}</td>
      </tr>
    `;
  }).join('');

  const asset360Cost = getInventory360AssetCost(asset || {});
  const asset360MissingData = getAssetDataQualityMissingFields(asset || {});
  const explicitCostTotal = [
    asset360Cost.purchaseCost,
    asset360Cost.currentValue,
    asset360Cost.maintenanceCost,
    asset360Cost.replacementCost,
  ].reduce((sum, value) => sum + inventory360Number(value), 0);
  const relationshipCount = allRelationshipRows.length + (Array.isArray(data.components) ? data.components.length : 0) + (installedParent.hasParent ? 1 : 0);
  const riskSignalCount = (isAssetHighRisk(asset || {}) ? 1 : 0) + (isAssetEolSoon(asset || {}) ? 1 : 0) + (wifiInfo.mismatch ? 1 : 0);
  const asset360NextAction = asset360MissingData.length
    ? { label: 'Fix missing data', action: `window.editSpecs('${customId}', false)`, reason: `${asset360MissingData.length} missing data field(s)` }
    : (riskSignalCount
      ? { label: 'Generate AI health summary', action: `window.cmdbAiHealthSummary('${customId}')`, reason: 'Risk/EOL evidence needs review' }
      : { label: 'View lifecycle', action: '', reason: 'Asset 360 is currently serviceable' });

  return `
    <div class="card border-0 shadow-sm mb-3 asset-digital-passport-card">
      <div class="card-header bg-light py-2">
        <strong class="small text-uppercase">Asset Identity</strong>
      </div>
      <div class="card-body py-2">
        <div class="row g-2">
          ${identityRows.map((row) => `
            <div class="col-md-6">
              <div class="small text-muted">${UI.escapeHTML(row.label)}</div>
              <div class="fw-semibold small">${formatCmdbValue(row.value)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
    <div class="asset-360-summary-grid mb-3">
      <article class="asset-360-summary-card ${riskSignalCount ? 'is-review' : 'is-healthy'}">
        <div class="asset-360-summary-label">Health / Risk / EOL</div>
        <div class="asset-360-summary-value">${UI.escapeHTML(riskSignalCount ? `${riskSignalCount} signal(s)` : 'Healthy')}</div>
        <p>${UI.escapeHTML(riskSignalCount ? 'Review EOL, lifecycle, telemetry, or location mismatch evidence.' : 'No major risk/EOL signal detected from loaded evidence.')}</p>
      </article>
      <article class="asset-360-summary-card ${asset360Cost.hasAny ? 'is-healthy' : 'is-review'}">
        <div class="asset-360-summary-label">Cost Summary</div>
        <div class="asset-360-summary-value">${UI.escapeHTML(asset360Cost.hasAny ? inventory360Currency(explicitCostTotal) : 'Cost missing')}</div>
        <p>${UI.escapeHTML(asset360Cost.hasAny ? `Purchase ${inventory360Currency(asset360Cost.purchaseCost)} | Replacement ${inventory360Currency(asset360Cost.replacementCost)}` : 'Add purchase cost, replacement estimate, quote, or invoice data to improve cost analytics.')}</p>
      </article>
      <article class="asset-360-summary-card ${asset360MissingData.length ? 'is-review' : 'is-healthy'}">
        <div class="asset-360-summary-label">Data Quality</div>
        <div class="asset-360-summary-value">${UI.escapeHTML(asset360MissingData.length ? `${asset360MissingData.length} gap(s)` : 'Complete')}</div>
        <p>${UI.escapeHTML(asset360MissingData.length ? asset360MissingData.join(', ') : 'Core identity/location/cost confidence is serviceable.')}</p>
      </article>
      <article class="asset-360-summary-card is-info">
        <div class="asset-360-summary-label">Relationships</div>
        <div class="asset-360-summary-value">${UI.escapeHTML(String(relationshipCount))}</div>
        <p>${UI.escapeHTML('Components, accessories, licenses, and related CMDB links connected to this record.')}</p>
      </article>
      <article class="asset-360-summary-card ${asset360MissingData.length || riskSignalCount ? 'is-review' : 'is-healthy'}">
        <div class="asset-360-summary-label">Next Best Action</div>
        <div class="asset-360-summary-value">${UI.escapeHTML(asset360NextAction.label)}</div>
        <p>${UI.escapeHTML(asset360NextAction.reason)}</p>
        ${asset360NextAction.action ? `<button type="button" class="btn btn-sm btn-outline-primary" onclick="${UI.escapeHTML(asset360NextAction.action)}">${UI.escapeHTML(asset360NextAction.label)}</button>` : ''}
      </article>
    </div>
    ${isParentContext ? `
      <div class="alert alert-light border mb-3">
        <div class="d-flex flex-wrap justify-content-between gap-2 align-items-start">
          <div>
            <div class="small text-uppercase text-muted fw-semibold">Kit Health</div>
            <div class="mt-1">
              <span class="badge ${kitBadgeClass}">${UI.escapeHTML(String(kitHealth?.label || 'Unknown'))}</span>
            </div>
            <div class="small text-muted mt-1">${UI.escapeHTML(String(kitHealth?.summary || 'No kit-health summary available yet.'))}</div>
          </div>
          <div class="small">
            <div><strong>Missing:</strong> ${UI.escapeHTML(String(missingChildren.length))}</div>
            <div><strong>Damaged:</strong> ${UI.escapeHTML(String(damagedChildren.length))}</div>
            <div><strong>Under Repair:</strong> ${UI.escapeHTML(String(repairChildren.length))}</div>
          </div>
        </div>
        ${(missingChildren.length || damagedChildren.length || repairChildren.length) ? `
          <div class="small mt-2">
            ${missingChildren.length ? `<div><strong>Missing:</strong> ${UI.escapeHTML(missingChildren.map((item) => item.name || item.id || '-').join(', '))}</div>` : ''}
            ${damagedChildren.length ? `<div><strong>Damaged:</strong> ${UI.escapeHTML(damagedChildren.map((item) => item.name || item.id || '-').join(', '))}</div>` : ''}
            ${repairChildren.length ? `<div><strong>Under Repair:</strong> ${UI.escapeHTML(repairChildren.map((item) => item.name || item.id || '-').join(', '))}</div>` : ''}
          </div>
        ` : ''}
      </div>
    ` : ''}
    ${showWifiPanel ? `
      <div class="border rounded bg-light-subtle p-3 mb-3">
        <div class="d-flex flex-wrap justify-content-between gap-2 align-items-start">
          <div>
            <div class="small text-uppercase text-muted fw-semibold">Wi-Fi Location Tracker (Demo)</div>
            <div class="small text-muted">Demo-safe tracker. Real Wi-Fi integration is not connected.</div>
            ${hasWifiData
      ? `
              <div class="small mt-1">MAC: ${UI.escapeHTML(wifiInfo.macAddress || '-')} | Last Seen: ${UI.escapeHTML(wifiInfo.lastSeenLocation || '-')}</div>
              <div class="small text-muted">Network: ${UI.escapeHTML(wifiInfo.lastSeenNetwork || '-')} | AP: ${UI.escapeHTML(wifiInfo.lastSeenAccessPoint || '-')} | Seen At: ${wifiInfo.lastSeenTimestamp ? UI.formatDateTime(wifiInfo.lastSeenTimestamp) : '-'}</div>
            `
      : '<div class="small mt-1 text-muted">No network activity recorded yet.</div>'}
            ${wifiInfo.mismatch ? `<div class="small text-warning-emphasis mt-1"><strong>Warning:</strong> Network location mismatch with assigned location.</div>` : ''}
          </div>
          <div class="d-flex gap-2">
            <button class="btn btn-sm btn-outline-secondary" onclick="window.cmdbMockWifiUpdate('${customId}')">Update Last Seen Network</button>
          </div>
        </div>
      </div>
    ` : ''}
    <ul class="nav nav-tabs" role="tablist">
      ${showComponentsTab ? `<li class="nav-item"><button class="nav-link" data-cmdb-tab="components" data-bs-toggle="tab" data-bs-target="#${CMDB_MODAL_ID}-components" type="button">Components</button></li>` : ''}
      <li class="nav-item"><button class="nav-link" data-cmdb-tab="maintenance" data-bs-toggle="tab" data-bs-target="#${CMDB_MODAL_ID}-maintenance" type="button">${maintenanceTabLabel}</button></li>
      <li class="nav-item"><button class="nav-link" data-cmdb-tab="custody" data-bs-toggle="tab" data-bs-target="#${CMDB_MODAL_ID}-custody" type="button">${custodyTabLabel}</button></li>
      <li class="nav-item"><button class="nav-link" data-cmdb-tab="relationships" data-bs-toggle="tab" data-bs-target="#${CMDB_MODAL_ID}-relationships" type="button">${relationshipsTabLabel}</button></li>
      <li class="nav-item"><button class="nav-link" data-cmdb-tab="lifecycle" data-bs-toggle="tab" data-bs-target="#${CMDB_MODAL_ID}-lifecycle" type="button">Lifecycle Events</button></li>
    </ul>
    <div class="tab-content pt-3">
      ${showComponentsTab ? `
      <div class="tab-pane fade" id="${CMDB_MODAL_ID}-components">
        <div class="d-flex justify-content-end gap-2 mb-2">
          <button class="btn btn-sm btn-outline-primary" onclick="window.cmdbInstallFromStock('${customId}')">Install From Stock</button>
          <button class="btn btn-sm btn-primary" onclick="window.cmdbAddComponent('${customId}')">Create & Add New Component</button>
        </div>
        <div class="table-responsive"><table class="table table-sm">
          <thead><tr><th>Name</th><th>Type</th><th>Brand/Model</th><th>Serial</th><th>Part No.</th><th>Status</th><th>Condition</th><th>Installed At</th><th class="text-end">Actions</th></tr></thead>
          <tbody>${componentsRows || '<tr><td colspan="9" class="text-muted">No components.</td></tr>'}</tbody>
        </table></div>
      </div>` : ''}
      <div class="tab-pane fade" id="${CMDB_MODAL_ID}-maintenance">
        <div class="d-flex justify-content-end mb-2"><button class="btn btn-sm btn-primary" onclick="window.cmdbAddMaintenance('${customId}')">${maintenanceActionLabel}</button></div>
        <div class="table-responsive"><table class="table table-sm"><thead><tr><th>Scope</th><th>Type</th><th>Status</th><th>By</th><th>At</th><th>Cost</th></tr></thead><tbody>${maintenanceRows || `<tr><td colspan="6" class="text-muted">${maintenanceEmptyLabel}</td></tr>`}</tbody></table></div>
      </div>
      <div class="tab-pane fade" id="${CMDB_MODAL_ID}-custody">
        <div class="d-flex justify-content-end gap-2 mb-2">
          <button class="btn btn-sm btn-primary" onclick="window.cmdbAssignAsset('${customId}')">Assign/Checkout</button>
          <button class="btn btn-sm btn-outline-secondary" onclick="window.cmdbCheckinAsset('${customId}')" ${hasActiveAssignment ? '' : 'disabled'} title="${UI.escapeHTML(hasActiveAssignment ? 'Record check-in details.' : 'No active assignment to check in.')}">${hasActiveAssignment ? 'Check-in' : 'Check-in (N/A)'}</button>
          ${showLoanerActions ? `<button class="btn btn-sm btn-outline-info" onclick="window.cmdbLoanerCheckout('${customId}')" ${(loanerEligible && !isLoanedOut) ? '' : 'disabled'} title="${UI.escapeHTML(loanerEligible ? (isLoanedOut ? 'Asset is already loaned out.' : 'Record loaner checkout.') : 'This asset is not marked as a loaner. Mark it as a loaner before checkout.')}">Loaner Checkout</button>` : ''}
          ${showLoanerActions ? `<button class="btn btn-sm btn-outline-dark" onclick="window.cmdbLoanerReturn('${customId}')" ${isLoanedOut ? '' : 'disabled'} title="${UI.escapeHTML(isLoanedOut ? 'Record loaner return.' : 'Loaner return is available only when asset is currently loaned out.')}">Loaner Return</button>` : ''}
        </div>
        ${showLoanerActions ? `
          <div class="small text-muted mb-2">
            Loaner: ${UI.escapeHTML(loanerEligible ? 'Yes' : 'No')} | Custody: ${UI.escapeHTML(custodyStateLabel)}
            ${isLoanedOut ? ` | Loaned To: ${UI.escapeHTML(String(specs.loanedTo || assignedPersonLabel || '-'))}` : ` | Assigned To: ${UI.escapeHTML(String(assignedPersonLabel || '-'))}`}
            | Assigned Department: ${UI.escapeHTML(assignedDepartmentLabel || '-')}
          </div>
          ${!loanerEligible ? `<div class="small text-muted mb-2">This asset is not marked as a loaner. Mark it as loaner-eligible before loaner checkout.</div>` : ''}
        ` : ''}
        <div class="table-responsive"><table class="table table-sm"><thead><tr><th>Action</th><th>User</th><th>Checkout</th><th>Return</th><th>Reason</th></tr></thead><tbody>${custodyRows || '<tr><td colspan="5" class="text-muted">No custody history.</td></tr>'}</tbody></table></div>
      </div>
      <div class="tab-pane fade" id="${CMDB_MODAL_ID}-relationships">
        <div class="d-flex justify-content-end mb-2"><button class="btn btn-sm btn-primary" onclick="window.cmdbAddRelationship('${customId}')">Add Relationship</button></div>
        <div class="table-responsive"><table class="table table-sm">
          <thead><tr><th>Related Item</th><th>Category</th><th>Relationship</th><th>Asset Tag</th><th>Status</th><th class="text-end">Actions</th></tr></thead>
          <tbody>
            ${componentInstalledInRows}
            ${relRows}
            ${(!relRows && !componentInstalledInRows) ? '<tr><td colspan="6" class="text-muted">No relationships found.</td></tr>' : ''}
          </tbody>
        </table></div>
      </div>
      <div class="tab-pane fade" id="${CMDB_MODAL_ID}-lifecycle">
        ${isParentContext ? `
        <div class="d-flex justify-content-end flex-wrap gap-2 mb-2">
          <button class="btn btn-sm btn-outline-dark" onclick="window.cmdbAiHealthSummary('${customId}')">
            <i class="bi bi-stars me-1"></i>AI Health Summary
          </button>
          <button class="btn btn-sm btn-outline-primary" onclick="window.cmdbAiRiskScore('${customId}')">
            <i class="bi bi-shield-exclamation me-1"></i>AI Risk Score
          </button>
          <button class="btn btn-sm btn-outline-success" onclick="window.cmdbDigitalTwin('${customId}')">
            <i class="bi bi-diagram-3 me-1"></i>Digital Twin
          </button>
          <button class="btn btn-sm btn-outline-info" onclick="window.cmdbBlackBoxTimeline('${customId}')">
            <i class="bi bi-clock-history me-1"></i>Black Box Timeline
          </button>
          <button class="btn btn-sm btn-outline-secondary" onclick="window.cmdbAiDraftTicket('${customId}')">
            <i class="bi bi-card-checklist me-1"></i>Draft Ticket
          </button>
        </div>
        <div id="${CMDB_MODAL_ID}-ai-health" class="mb-2"></div>
        <div id="${CMDB_MODAL_ID}-ai-risk" class="mb-2"></div>
        <div id="${CMDB_MODAL_ID}-digital-twin" class="mb-2"></div>
        <div id="${CMDB_MODAL_ID}-black-box" class="mb-2"></div>
        <div id="${CMDB_MODAL_ID}-ai-ticket" class="mb-2"></div>
        ` : ''}
        <div class="table-responsive"><table class="table table-sm"><thead><tr><th>When</th><th>Event</th><th>Reason</th><th>Actor</th></tr></thead><tbody>${lifecycleRows || '<tr><td colspan="4" class="text-muted">No lifecycle events.</td></tr>'}</tbody></table></div>
      </div>
    </div>
  `;
}

async function refreshCmdbModal(customId = cmdbState.assetId, preferredTab = cmdbState.activeTab || 'components') {
  const lookupValue = String(customId || '').trim();
  const resolveFromLoaded = () => currentAssets.find((entry) => (
    String(entry?.customId || '').trim() === lookupValue
    || normalizeValue(entry?.assetTag) === normalizeValue(lookupValue)
  ));
  let asset = resolveFromLoaded();
  if (!asset && lookupValue) {
    asset = await readInventoryJson(`/assets/${encodeURIComponent(lookupValue)}`).catch(() => null);
  }
  if (!asset && lookupValue) {
    const searchPayload = await readInventoryJson(`/assets?paginate=true&page=1&pageSize=50&q=${encodeURIComponent(lookupValue)}`).catch(() => null);
    const searchRows = Array.isArray(searchPayload?.items)
      ? searchPayload.items
      : (Array.isArray(searchPayload) ? searchPayload : []);
    asset = searchRows.find((entry) => (
      String(entry?.customId || '').trim() === lookupValue
      || normalizeValue(entry?.assetTag) === normalizeValue(lookupValue)
    )) || null;
  }
  if (!asset) {
    showMessage('Asset not found.', 'error');
    return;
  }
  const resolvedId = String(asset.customId || lookupValue).trim();
  const modal = ensureCmdbModal();
  cmdbState.assetId = resolvedId;
  cmdbState.activeTab = preferredTab;
  const titleEl = document.getElementById(`${CMDB_MODAL_ID}-title`);
  const bodyEl = document.getElementById(`${CMDB_MODAL_ID}-body`);
  if (titleEl) titleEl.textContent = `CMDB Management - ${asset.name} (${resolvedId})`;
  if (bodyEl) bodyEl.innerHTML = '<div class="text-muted py-3">Loading CMDB data...</div>';

  const data = await fetchCmdbData(resolvedId);
  if (bodyEl) bodyEl.innerHTML = renderCmdbBody(resolvedId, data, asset);
  const tabButtons = Array.from(document.querySelectorAll(`#${CMDB_MODAL_ID} [data-cmdb-tab]`));
  tabButtons.forEach((btn) => {
    btn.addEventListener('shown.bs.tab', (event) => {
      cmdbState.activeTab = event.target?.getAttribute('data-cmdb-tab') || 'components';
    });
  });
  const categoryKey = getAssetCategoryKey(asset || {});
  const allowComponentsTab = !(isInstalledComponentAsset(asset) || ['accessory', 'consumable', 'spare_part', 'license'].includes(categoryKey));
  const targetBtn = document.querySelector(`#${CMDB_MODAL_ID} [data-cmdb-tab="${cmdbState.activeTab}"]`)
    || document.querySelector(`#${CMDB_MODAL_ID} [data-cmdb-tab="${allowComponentsTab ? 'components' : 'maintenance'}"]`);
  if (targetBtn) bootstrap.Tab.getOrCreateInstance(targetBtn).show();
  const modalEl = document.getElementById(CMDB_MODAL_ID);
  if (modalEl && !modalEl.classList.contains('show')) {
    modal.show();
  }
}

function setInventoryView(nextView = 'parents') {
  currentInventoryView = normalizeInventoryView(nextView);
  inventoryPageState.page = 1;
  activeDetailsContext = null;
  activeDetailsGroupName = null;
  bulkSpecReviewContext = null;
  if (currentInventoryView === 'spare_stock') {
    window.loadSpareStock()
      .then(async () => {
        await refreshInventoryFilterSnapshot();
        if (currentInventoryView === 'spare_stock') {
          populateFilters();
          renderTable();
        }
      })
      .catch(() => {});
    return;
  }
  loadAssets().catch((error) => {
    showMessage(error.message || 'Failed to switch inventory view.', 'error');
  });
}

window.openAssetCmdb = async (customId) => {
  try {
    const lookupValue = String(customId || '').trim();
    let asset = currentAssets.find((entry) => (
      String(entry?.customId || '').trim() === lookupValue
      || normalizeValue(entry?.assetTag) === normalizeValue(lookupValue)
    ));
    if (!asset && lookupValue) {
      asset = await readInventoryJson(`/assets/${encodeURIComponent(lookupValue)}`).catch(() => null);
    }
    const categoryKey = getAssetCategoryKey(asset || {});
    const allowComponentsTab = asset && !(isInstalledComponentAsset(asset) || ['accessory', 'consumable', 'spare_part', 'license'].includes(categoryKey));
    const defaultTab = allowComponentsTab ? 'components' : 'maintenance';
    const resolvedId = String(asset?.customId || lookupValue).trim();
    await refreshCmdbModal(resolvedId, cmdbState.assetId === resolvedId ? cmdbState.activeTab : defaultTab);
  } catch (error) {
    showMessage(error.message || 'Failed to open CMDB modal.', 'error');
  }
};

function getTransferRelatedOptionsFromForm() {
  const includeRelated = Boolean(document.getElementById('transferIncludeRelated')?.checked);
  return {
    includeRelated,
    includeComponents: includeRelated && Boolean(document.getElementById('transferIncludeComponents')?.checked),
    includeAccessories: includeRelated && Boolean(document.getElementById('transferIncludeAccessories')?.checked),
    includeLicenses: includeRelated && Boolean(document.getElementById('transferIncludeLicenses')?.checked),
    includeConsumables: includeRelated && Boolean(document.getElementById('transferIncludeConsumables')?.checked),
  };
}

function updateTransferRelatedFormState() {
  const includeRelated = Boolean(document.getElementById('transferIncludeRelated')?.checked);
  ['transferIncludeComponents', 'transferIncludeAccessories', 'transferIncludeLicenses', 'transferIncludeConsumables'].forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.disabled = !includeRelated;
  });
}

async function refreshTransferRelatedSummary() {
  const summaryEl = document.getElementById('transferRelatedCounts');
  if (!summaryEl) return;
  const opts = getTransferRelatedOptionsFromForm();
  if (!opts.includeRelated) {
    summaryEl.textContent = 'Related item transfer disabled.';
    return;
  }
  if (transferSelectionState.isBulk || !transferSelectionState.targetAssetIds.length) {
    summaryEl.textContent = 'Related counts will be resolved during transfer for selected units.';
    return;
  }
  const assetId = transferSelectionState.targetAssetIds[0];
  try {
    const params = new URLSearchParams({
      includeComponents: String(opts.includeComponents),
      includeAccessories: String(opts.includeAccessories),
      includeLicenses: String(opts.includeLicenses),
      includeConsumables: String(opts.includeConsumables),
    });
    const payload = await readInventoryJson(`/assets/${encodeURIComponent(assetId)}/transfer-related-summary?${params.toString()}`);
    const counts = payload?.counts || {};
    summaryEl.textContent = `Related items: ${counts.components || 0} components, ${counts.accessories || 0} accessories, ${counts.licenses || 0} licenses, ${counts.consumables || 0} linked consumables.`;
  } catch (_error) {
    summaryEl.textContent = 'Could not load related counts. They will be resolved during transfer.';
  }
}

function getGroupCmdbAssets(groupName = groupCmdbState.groupName) {
  if (currentInventoryView === 'spare_stock') return [];
  const scopedAssets = getAssetsForCurrentInventoryView();
  return scopedAssets
    .filter((asset) => {
      if (currentInventoryView === 'parents') return asset.name === groupName;
      return normalizeValue(getAssetViewTypeLabel(asset, currentInventoryView)) === normalizeValue(groupName);
    })
    .sort((a, b) => String(a.customId || '').localeCompare(String(b.customId || '')));
}

function ensureGroupCmdbModal() {
  let modalEl = document.getElementById(GROUP_CMDB_MODAL_ID);
  if (!modalEl) {
    const modalHtml = `
      <div class="modal fade" id="${GROUP_CMDB_MODAL_ID}" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-xl modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title fw-bold" id="${GROUP_CMDB_MODAL_ID}-title">Group CMDB</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body" id="${GROUP_CMDB_MODAL_ID}-body"></div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    modalEl = document.getElementById(GROUP_CMDB_MODAL_ID);
    modalEl.addEventListener('hidden.bs.modal', () => {
      groupCmdbState = {
        groupName: '',
        activeTab: 'components',
        selectedAssetIds: [],
        searchText: '',
      };
      const bodyEl = document.getElementById(`${GROUP_CMDB_MODAL_ID}-body`);
      if (bodyEl) bodyEl.innerHTML = '';
      document.querySelectorAll('body > .modal-backdrop').forEach((backdrop, index, list) => {
        if (index < list.length - 1) backdrop.remove();
      });
    });
  }
  return bootstrap.Modal.getOrCreateInstance(modalEl);
}

async function fetchGroupCmdbData(selectedAssetIds = []) {
  const ids = Array.from(new Set((selectedAssetIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  const pairs = await Promise.all(ids.map(async (assetId) => {
    const data = await fetchCmdbData(assetId);
    return [assetId, data];
  }));
  return Object.fromEntries(pairs);
}

function renderGroupCmdbBody(groupAssets, selectedAssetIds, dataMap) {
  const selectedSet = new Set(selectedAssetIds);
  const selectedAssets = groupAssets.filter((asset) => selectedSet.has(asset.customId));
  const selectedCount = selectedAssets.length;
  const totalCount = groupAssets.length;
  const activeTab = groupCmdbState.activeTab || 'components';
  const selectedData = selectedAssets.map((asset) => ({
    asset,
    data: dataMap[asset.customId] || { components: [], maintenance: [], custody: [], relationships: { outgoing: [], incoming: [] }, lifecycleEvents: [] },
  }));
  const componentsRows = selectedData.flatMap(({ asset, data }) => (data.components || []).map((component) => `
    <tr>
      <td>${UI.escapeHTML(asset.customId || '-')}</td>
      <td>${UI.escapeHTML(component.componentName || '-')}</td>
      <td>${UI.escapeHTML(component.componentType || '-')}</td>
      <td>${UI.escapeHTML(component.serialNumber || '-')}</td>
      <td>${UI.escapeHTML(cmdbStatusLabel(component.status || '-'))}</td>
      <td>${component.installedAt ? UI.formatDateTime(component.installedAt) : '-'}</td>
    </tr>
  `)).join('');
  const maintenanceRows = selectedData.flatMap(({ asset, data }) => (data.maintenance || []).map((row) => `
    <tr>
      <td>${UI.escapeHTML(asset.customId || '-')}</td>
      <td>${UI.escapeHTML(row.maintenanceType || '-')}</td>
      <td>${UI.escapeHTML(row.status || '-')}</td>
      <td>${row.performedAt ? UI.formatDateTime(row.performedAt) : '-'}</td>
      <td>${UI.escapeHTML(row.performedBy || '-')}</td>
    </tr>
  `)).join('');
  const custodyRows = selectedData.flatMap(({ asset, data }) => (data.custody || []).map((row) => `
    <tr>
      <td>${UI.escapeHTML(asset.customId || '-')}</td>
      <td>${UI.escapeHTML(row.action || '-')}</td>
      <td>${UI.escapeHTML(row.assignedToName || row.assignedToUserId || '-')}</td>
      <td>${row.checkoutDate ? UI.formatDateTime(row.checkoutDate) : '-'}</td>
      <td>${row.returnedDate ? UI.formatDateTime(row.returnedDate) : '-'}</td>
    </tr>
  `)).join('');
  const relationshipRows = selectedData.flatMap(({ asset, data }) => {
    const outgoing = (data.relationships?.outgoing || []).map((row) => ({ ...row, direction: 'outgoing' }));
    const incoming = (data.relationships?.incoming || []).map((row) => ({ ...row, direction: 'incoming' }));
    return [...outgoing, ...incoming].map((row) => `
      <tr>
        <td>${UI.escapeHTML(asset.customId || '-')}</td>
        <td>${UI.escapeHTML(row.direction || '-')}</td>
        <td>${UI.escapeHTML(row.relationshipType || '-')}</td>
        <td>${UI.escapeHTML(row.relatedAssetId || row.assetId || '-')}</td>
      </tr>
    `);
  }).join('');
  const lifecycleRows = selectedData.flatMap(({ asset, data }) => (data.lifecycleEvents || []).slice(0, 30).map((row) => `
    <tr>
      <td>${UI.escapeHTML(asset.customId || '-')}</td>
      <td>${row.createdAt ? UI.formatDateTime(row.createdAt) : '-'}</td>
      <td>${UI.escapeHTML(row.eventType || '-')}</td>
      <td>${UI.escapeHTML(row.reason || '-')}</td>
    </tr>
  `)).join('');

  const listRows = groupAssets.filter((asset) => {
    const haystack = `${asset.customId} ${getDisplaySerial(asset)} ${getAssetDisplayLocation(asset)} ${getAssetDisplayDepartment(asset)}`.toLowerCase();
    return !groupCmdbState.searchText || haystack.includes(groupCmdbState.searchText.toLowerCase());
  }).map((asset) => {
    const checked = selectedSet.has(asset.customId) ? 'checked' : '';
    return `
      <label class="list-group-item list-group-item-action py-2">
        <input class="form-check-input me-2" type="checkbox" data-group-cmdb-checkbox="${asset.customId}" ${checked}>
        <span class="fw-semibold">${UI.escapeHTML(asset.customId)}</span>
        <div class="small text-muted">${UI.escapeHTML(getDisplaySerial(asset) || 'No Serial')} | ${UI.escapeHTML(getAssetDisplayLocation(asset))}</div>
      </label>
    `;
  }).join('');

  const summaryCards = selectedAssets.map((asset) => {
    const data = dataMap[asset.customId] || {};
    const components = Array.isArray(data.components) ? data.components.length : 0;
    const maintenance = Array.isArray(data.maintenance) ? data.maintenance.length : 0;
    return `
      <tr>
        <td>${UI.escapeHTML(asset.customId)}</td>
        <td>${components}</td>
        <td>${maintenance}</td>
        <td><button class="btn btn-sm btn-outline-secondary" data-group-cmdb-single="${asset.customId}">Open Unit CMDB</button></td>
      </tr>
    `;
  }).join('');

  return `
    <div class="inventory-group-cmdb-layout">
      <div>
        <div class="d-flex align-items-center justify-content-between mb-2">
          <div class="small fw-bold text-uppercase text-muted">Units</div>
          <div class="small text-muted">${selectedCount}/${totalCount} selected</div>
        </div>
        <div class="input-group input-group-sm mb-2">
          <span class="input-group-text"><i class="bi bi-search"></i></span>
          <input type="text" class="form-control" id="${GROUP_CMDB_MODAL_ID}-search" value="${UI.escapeHTML(groupCmdbState.searchText)}" placeholder="Search ID / serial / location">
        </div>
        <div class="d-flex gap-2 mb-2">
          <button class="btn btn-sm btn-outline-secondary w-100" id="${GROUP_CMDB_MODAL_ID}-select-all">Select All</button>
          <button class="btn btn-sm btn-outline-secondary w-100" id="${GROUP_CMDB_MODAL_ID}-clear-all">Clear</button>
        </div>
        <div class="list-group inventory-group-cmdb-unit-list">
          ${listRows || '<div class="text-muted small p-3">No units match this filter.</div>'}
        </div>
      </div>
      <div>
        <div class="alert alert-light border py-2 mb-2 small">
          Group CMDB lets you compare differences across units and apply actions only to selected units.
        </div>
        <ul class="nav nav-tabs" role="tablist">
          <li class="nav-item"><button class="nav-link" data-group-cmdb-tab="components" data-bs-toggle="tab" data-bs-target="#${GROUP_CMDB_MODAL_ID}-components" type="button">Components</button></li>
          <li class="nav-item"><button class="nav-link" data-group-cmdb-tab="maintenance" data-bs-toggle="tab" data-bs-target="#${GROUP_CMDB_MODAL_ID}-maintenance" type="button">Maintenance</button></li>
          <li class="nav-item"><button class="nav-link" data-group-cmdb-tab="custody" data-bs-toggle="tab" data-bs-target="#${GROUP_CMDB_MODAL_ID}-custody" type="button">Assignment/Custody</button></li>
          <li class="nav-item"><button class="nav-link" data-group-cmdb-tab="relationships" data-bs-toggle="tab" data-bs-target="#${GROUP_CMDB_MODAL_ID}-relationships" type="button">Relationships</button></li>
          <li class="nav-item"><button class="nav-link" data-group-cmdb-tab="lifecycle" data-bs-toggle="tab" data-bs-target="#${GROUP_CMDB_MODAL_ID}-lifecycle" type="button">Lifecycle Events</button></li>
        </ul>
        <div class="tab-content pt-3">
          <div class="tab-pane fade" id="${GROUP_CMDB_MODAL_ID}-components">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <div class="small text-muted">Use unit selector to compare per-unit components.</div>
              ${selectedCount === 1 ? `
                <div class="d-flex gap-2">
                  <button class="btn btn-sm btn-outline-primary" onclick="window.cmdbInstallFromStock('${selectedAssets[0].customId}')">Install From Stock</button>
                  <button class="btn btn-sm btn-primary" onclick="window.cmdbAddComponent('${selectedAssets[0].customId}')">Create & Add New Component</button>
                </div>
              ` : ''}
            </div>
            <div class="table-responsive mb-3"><table class="table table-sm">
              <thead><tr><th>Unit</th><th>Components</th><th>Maintenance</th><th></th></tr></thead>
              <tbody>${summaryCards || '<tr><td colspan="4" class="text-muted">Select one or more units to begin.</td></tr>'}</tbody>
            </table></div>
            <div class="table-responsive"><table class="table table-sm">
              <thead><tr><th>Unit</th><th>Name</th><th>Type</th><th>Serial</th><th>Status</th><th>Installed At</th></tr></thead>
              <tbody>${componentsRows || '<tr><td colspan="6" class="text-muted">No component records for selected units.</td></tr>'}</tbody>
            </table></div>
          </div>
          <div class="tab-pane fade" id="${GROUP_CMDB_MODAL_ID}-maintenance">
            <div class="d-flex justify-content-end mb-2">
              <button class="btn btn-sm btn-primary" id="${GROUP_CMDB_MODAL_ID}-bulk-maintenance">Bulk Add Maintenance</button>
            </div>
            <div class="table-responsive"><table class="table table-sm">
              <thead><tr><th>Unit</th><th>Type</th><th>Status</th><th>At</th><th>By</th></tr></thead>
              <tbody>${maintenanceRows || '<tr><td colspan="5" class="text-muted">No maintenance records for selected units.</td></tr>'}</tbody>
            </table></div>
          </div>
          <div class="tab-pane fade" id="${GROUP_CMDB_MODAL_ID}-custody">
            <div class="d-flex gap-2 justify-content-end mb-2">
              <button class="btn btn-sm btn-primary" id="${GROUP_CMDB_MODAL_ID}-bulk-assign">Bulk Assign/Checkout</button>
              <button class="btn btn-sm btn-outline-secondary" id="${GROUP_CMDB_MODAL_ID}-bulk-checkin">Bulk Check-in</button>
            </div>
            <div class="table-responsive"><table class="table table-sm">
              <thead><tr><th>Unit</th><th>Action</th><th>User</th><th>Checkout</th><th>Return</th></tr></thead>
              <tbody>${custodyRows || '<tr><td colspan="5" class="text-muted">No custody records for selected units.</td></tr>'}</tbody>
            </table></div>
          </div>
          <div class="tab-pane fade" id="${GROUP_CMDB_MODAL_ID}-relationships">
            <div class="table-responsive"><table class="table table-sm">
              <thead><tr><th>Unit</th><th>Direction</th><th>Type</th><th>Related Asset</th></tr></thead>
              <tbody>${relationshipRows || '<tr><td colspan="4" class="text-muted">No relationships for selected units.</td></tr>'}</tbody>
            </table></div>
          </div>
          <div class="tab-pane fade" id="${GROUP_CMDB_MODAL_ID}-lifecycle">
            <div class="table-responsive"><table class="table table-sm">
              <thead><tr><th>Unit</th><th>When</th><th>Event</th><th>Reason</th></tr></thead>
              <tbody>${lifecycleRows || '<tr><td colspan="4" class="text-muted">No lifecycle events for selected units.</td></tr>'}</tbody>
            </table></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function refreshGroupCmdbModal() {
  const groupAssets = getGroupCmdbAssets(groupCmdbState.groupName);
  if (!groupAssets.length) {
    showMessage('No assets found for this group.', 'warning');
    return;
  }
  const validIds = new Set(groupAssets.map((asset) => asset.customId));
  const selectedAssetIds = (groupCmdbState.selectedAssetIds || []).filter((id) => validIds.has(id));
  if (!selectedAssetIds.length) selectedAssetIds.push(groupAssets[0].customId);
  groupCmdbState.selectedAssetIds = selectedAssetIds;

  const modal = ensureGroupCmdbModal();
  const titleEl = document.getElementById(`${GROUP_CMDB_MODAL_ID}-title`);
  const bodyEl = document.getElementById(`${GROUP_CMDB_MODAL_ID}-body`);
  if (titleEl) titleEl.textContent = `Group CMDB - ${groupCmdbState.groupName}`;
  if (bodyEl) bodyEl.innerHTML = '<div class="text-muted py-3">Loading group CMDB data...</div>';

  const dataMap = await fetchGroupCmdbData(selectedAssetIds);
  if (bodyEl) bodyEl.innerHTML = renderGroupCmdbBody(groupAssets, selectedAssetIds, dataMap);

  const searchInput = document.getElementById(`${GROUP_CMDB_MODAL_ID}-search`);
  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      groupCmdbState.searchText = String(event.target?.value || '');
      refreshGroupCmdbModal().catch((error) => showMessage(error.message || 'Failed to refresh Group CMDB.', 'error'));
    }, { once: true });
  }

  document.querySelectorAll(`[data-group-cmdb-checkbox]`).forEach((checkbox) => {
    checkbox.addEventListener('change', (event) => {
      const assetId = String(event.target?.getAttribute('data-group-cmdb-checkbox') || '');
      const checked = Boolean(event.target?.checked);
      const next = new Set(groupCmdbState.selectedAssetIds || []);
      if (checked) next.add(assetId);
      else next.delete(assetId);
      groupCmdbState.selectedAssetIds = Array.from(next);
      refreshGroupCmdbModal().catch((error) => showMessage(error.message || 'Failed to refresh Group CMDB.', 'error'));
    }, { once: true });
  });

  const selectAllBtn = document.getElementById(`${GROUP_CMDB_MODAL_ID}-select-all`);
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      groupCmdbState.selectedAssetIds = groupAssets.map((asset) => asset.customId);
      refreshGroupCmdbModal().catch((error) => showMessage(error.message || 'Failed to refresh Group CMDB.', 'error'));
    }, { once: true });
  }
  const clearAllBtn = document.getElementById(`${GROUP_CMDB_MODAL_ID}-clear-all`);
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      groupCmdbState.selectedAssetIds = [];
      refreshGroupCmdbModal().catch((error) => showMessage(error.message || 'Failed to refresh Group CMDB.', 'error'));
    }, { once: true });
  }
  document.querySelectorAll('[data-group-cmdb-tab]').forEach((tabBtn) => {
    tabBtn.addEventListener('shown.bs.tab', (event) => {
      groupCmdbState.activeTab = event.target?.getAttribute('data-group-cmdb-tab') || 'components';
    }, { once: true });
  });
  const tabBtn = document.querySelector(`[data-group-cmdb-tab="${groupCmdbState.activeTab || 'components'}"]`)
    || document.querySelector('[data-group-cmdb-tab="components"]');
  if (tabBtn) bootstrap.Tab.getOrCreateInstance(tabBtn).show();

  document.querySelectorAll('[data-group-cmdb-single]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      const assetId = String(event.target?.getAttribute('data-group-cmdb-single') || '');
      if (assetId) window.openAssetCmdb(assetId);
    }, { once: true });
  });

  const bulkMaintenanceBtn = document.getElementById(`${GROUP_CMDB_MODAL_ID}-bulk-maintenance`);
  if (bulkMaintenanceBtn) {
    bulkMaintenanceBtn.addEventListener('click', () => window.groupCmdbBulkAddMaintenance(), { once: true });
  }
  const bulkAssignBtn = document.getElementById(`${GROUP_CMDB_MODAL_ID}-bulk-assign`);
  if (bulkAssignBtn) {
    bulkAssignBtn.addEventListener('click', () => window.groupCmdbBulkAssign(), { once: true });
  }
  const bulkCheckinBtn = document.getElementById(`${GROUP_CMDB_MODAL_ID}-bulk-checkin`);
  if (bulkCheckinBtn) {
    bulkCheckinBtn.addEventListener('click', () => window.groupCmdbBulkCheckin(), { once: true });
  }

  const modalEl = document.getElementById(GROUP_CMDB_MODAL_ID);
  if (modalEl && !modalEl.classList.contains('show')) {
    modal.show();
  }
}

window.openGroupCmdb = async (groupName) => {
  if (currentInventoryView === 'spare_stock') {
    await window.openSpareStockModalForType(groupName);
    return;
  }
  if (!String(groupName || '').trim()) {
    showMessage('Open a group first.', 'warning');
    return;
  }
  groupCmdbState.groupName = String(groupName).trim();
  groupCmdbState.activeTab = 'components';
  groupCmdbState.searchText = '';
  groupCmdbState.selectedAssetIds = getGroupCmdbAssets(groupCmdbState.groupName).map((asset) => asset.customId);
  await refreshGroupCmdbModal();
};

window.groupCmdbBulkAddMaintenance = async () => {
  const selectedIds = Array.from(new Set(groupCmdbState.selectedAssetIds || []));
  if (!selectedIds.length) {
    showMessage('Select at least one unit.', 'warning');
    return;
  }
  const form = await showInventoryFormModal({
    title: 'Bulk Maintenance',
    message: `Apply to ${selectedIds.length} selected unit(s).`,
    confirmText: 'Apply',
    confirmClass: 'btn-primary',
    dialogClass: 'modal-md',
    fields: [
      { name: 'maintenanceType', label: 'Maintenance Type', type: 'text', value: 'preventive_maintenance', required: true },
      { name: 'status', label: 'Status', type: 'select', options: ['completed', 'in_progress', 'scheduled'], value: 'completed', required: true },
      { name: 'performedBy', label: 'Performed By', type: 'text', required: false },
      { name: 'reason', label: 'Reason / Notes', type: 'textarea', rows: 3, required: false },
    ],
  });
  if (!form?.confirmed) return;
  for (const assetId of selectedIds) {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/maintenance`, {
      maintenanceType: form.values.maintenanceType,
      status: form.values.status || 'completed',
      performedBy: form.values.performedBy || '',
      reason: form.values.reason || '',
      performedAt: new Date().toISOString(),
    });
  }
  showMessage(`Maintenance record added to ${selectedIds.length} unit(s).`, 'success');
  await refreshGroupCmdbModal();
};

window.groupCmdbBulkAssign = async () => {
  const selectedIds = Array.from(new Set(groupCmdbState.selectedAssetIds || []));
  if (!selectedIds.length) {
    showMessage('Select at least one unit.', 'warning');
    return;
  }
  const form = await showInventoryFormModal({
    title: 'Bulk Assign / Checkout',
    message: `Apply to ${selectedIds.length} selected unit(s).`,
    confirmText: 'Assign',
    confirmClass: 'btn-primary',
    dialogClass: 'modal-lg',
    fields: [
      { name: 'assignedToRole', label: 'Assigned To Role', type: 'select', options: ['Lab Supervisor', 'Senior', 'Junior', 'Professor', 'Technician', 'Department Admin', 'Student Worker', 'Other'], required: true, colClass: 'col-md-6' },
      { name: 'assignedToName', label: 'Assignee Name', type: 'text', required: true, colClass: 'col-md-6' },
      { name: 'assignedDepartment', label: 'Department', type: 'select', options: getKnownDepartmentOptions(), required: true, colClass: 'col-md-6' },
      { name: 'expectedReturnDate', label: 'Expected Return Date', type: 'date', required: false, colClass: 'col-md-6' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 3, required: false, colClass: 'col-12' },
    ],
  });
  if (!form?.confirmed) return;
  const assignedToName = [form.values.assignedToRole, form.values.assignedToName].filter(Boolean).join(' - ');
  const assignedDepartment = form.values.assignedDepartment || '';
  const expectedReturnDate = form.values.expectedReturnDate || '';
  for (const assetId of selectedIds) {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/assign`, {
      assignedToName,
      assignedDepartment,
      expectedReturnDate: expectedReturnDate || null,
      checkoutDate: new Date().toISOString(),
      notes: form.values.notes || '',
    });
  }
  await loadAssets();
  showMessage(`Checked out ${selectedIds.length} unit(s).`, 'success');
  await refreshGroupCmdbModal();
};

window.groupCmdbBulkCheckin = async () => {
  const selectedIds = Array.from(new Set(groupCmdbState.selectedAssetIds || []));
  if (!selectedIds.length) {
    showMessage('Select at least one unit.', 'warning');
    return;
  }
  const form = await showInventoryFormModal({
    title: 'Bulk Check-in',
    message: `Apply to ${selectedIds.length} selected unit(s).`,
    confirmText: 'Check-in',
    confirmClass: 'btn-outline-secondary',
    dialogClass: 'modal-md',
    fields: [
      { name: 'conditionIn', label: 'Return Condition', type: 'select', options: ['good', 'needs_review', 'damaged'], value: 'good', required: true },
      { name: 'reason', label: 'Notes', type: 'textarea', rows: 3, required: false },
    ],
  });
  if (!form?.confirmed) return;
  for (const assetId of selectedIds) {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/check-in`, {
      returnedDate: new Date().toISOString(),
      conditionIn: form.values.conditionIn || 'good',
      reason: form.values.reason || '',
      notes: form.values.reason || '',
    });
  }
  await loadAssets();
  showMessage(`Checked in ${selectedIds.length} unit(s).`, 'success');
  await refreshGroupCmdbModal();
};

window.cmdbAiHealthSummary = async (assetId) => {
  const panel = document.getElementById(`${CMDB_MODAL_ID}-ai-health`);
  if (!panel) return;
  const actionKey = `ai_health_${assetId}`;
  if (!beginCmdbAiAction(actionKey)) return;
  const stopLoadingHint = startAiPanelLoading(panel, 'Generating AI health summary...');
  try {
    const result = await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/ai-health-summary`, {
      includeRelated: true,
    });
    stopLoadingHint();
    const evidenceConfidence = normalizeInventoryAiConfidenceLabel(result?.confidence);
    const evidenceReason = summarizeInventoryAiEvidenceReason({
      missingData: Array.isArray(result?.missingData) ? result.missingData : [],
      scannedCount: Number(result?.scannedCount || 0),
    });
    const listHtml = (items) => (Array.isArray(items) && items.length
      ? `<ul class="mb-2">${items.map((item) => `<li>${UI.escapeHTML(String(item || ''))}</li>`).join('')}</ul>`
      : '<div class="text-muted small mb-2">None.</div>');
    panel.innerHTML = `
      <div class="alert alert-dark mb-2">
        <div class="d-flex justify-content-between align-items-center gap-2">
          <strong>AI Asset Health Summary</strong>
          <span class="badge bg-${evidenceConfidence === 'high' ? 'success' : evidenceConfidence === 'medium' ? 'warning text-dark' : 'danger'}">Evidence confidence: ${UI.escapeHTML(String(evidenceConfidence || 'low').toUpperCase())}</span>
        </div>
        <div class="small mt-2">${UI.escapeHTML(result.summary || 'No summary available.')}</div>
        ${aiSourceMetaHtml(result)}
        ${evidenceConfidence === 'low' && !result?.fallbackUsed ? `
          <details class="mt-2">
            <summary class="small text-primary">Why low evidence confidence?</summary>
            <div class="small text-muted mt-1">${UI.escapeHTML(
              evidenceReason
                ? `Low evidence confidence because ${evidenceReason}. This is not a Gemma failure.`
                : 'Gemma generated the answer, but supporting asset evidence is limited.'
            )}</div>
            <div class="small text-muted mt-1">Add telemetry readings, warranty/purchase details, and maintenance history to improve confidence.</div>
          </details>
        ` : ''}
      </div>
      <div class="small"><strong>Main Risks</strong></div>${listHtml(result.risks)}
      <div class="small"><strong>Recent Changes</strong></div>${listHtml(result.recentChanges)}
      <div class="small"><strong>Component Issues</strong></div>${listHtml(result.componentIssues)}
      <div class="small"><strong>Warranty/EOL Concerns</strong></div>${listHtml(result.warrantyEolConcerns)}
      <div class="small"><strong>Recommended Next Actions</strong></div>${listHtml(result.recommendations)}
      <div class="small"><strong>Missing Data</strong></div>${listHtml(result.missingData)}
    `;
  } catch (error) {
    stopLoadingHint();
    panel.innerHTML = `
      <div class="alert alert-warning mb-0">
        <strong>AI summary unavailable.</strong>
        <div class="small mt-1">${UI.escapeHTML(error.message || 'Try again later.')}</div>
      </div>
    `;
    showMessage(error.message || 'Failed to generate AI health summary.', 'warning');
  } finally {
    endCmdbAiAction(actionKey);
  }
};

window.cmdbAiRiskScore = async (assetId) => {
  const panel = document.getElementById(`${CMDB_MODAL_ID}-ai-risk`);
  if (!panel) return;
  const actionKey = `ai_risk_${assetId}`;
  if (!beginCmdbAiAction(actionKey)) return;
  const stopLoadingHint = startAiPanelLoading(panel, 'Calculating AI risk score...');
  try {
    const result = await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/ai-risk-score`, {});
    stopLoadingHint();
    const row = Array.isArray(result?.riskScores) ? result.riskScores[0] : null;
    if (!row) {
      panel.innerHTML = '<div class="alert alert-warning mb-0">No risk score available for this asset.</div>';
      return;
    }
    const riskLabel = String(row.riskLevel || 'low').toLowerCase();
    const badgeClass = riskLabel === 'critical'
      ? 'danger'
      : (riskLabel === 'high' ? 'warning text-dark' : (riskLabel === 'medium' ? 'info text-dark' : 'success'));
    const reasons = Array.isArray(row.reasons) ? row.reasons : [];
    const actions = Array.isArray(row.recommendedActions) ? row.recommendedActions : [];
    const missingData = Array.isArray(result?.missingData) ? result.missingData : [];
    panel.innerHTML = `
      <div class="alert alert-primary mb-2">
        <div class="d-flex justify-content-between align-items-center">
          <strong>AI Risk Score</strong>
          <span class="badge bg-${badgeClass}">${UI.escapeHTML(String(row.riskLevel || 'low').toUpperCase())} (${UI.escapeHTML(String(row.riskScore ?? '-'))})</span>
        </div>
        <div class="small mt-2">${UI.escapeHTML(result?.summary || 'Risk analysis completed.')}</div>
        ${aiSourceMetaHtml(result)}
      </div>
      <div class="small"><strong>Reasons</strong></div>
      ${reasons.length ? `<ul class="mb-2">${reasons.map((item) => `<li>${UI.escapeHTML(String(item || ''))}</li>`).join('')}</ul>` : '<div class="text-muted small mb-2">No detailed reasons.</div>'}
      <div class="small"><strong>Recommended Actions</strong></div>
      ${actions.length ? `<ul class="mb-2">${actions.map((item) => `<li>${UI.escapeHTML(String(item || ''))}</li>`).join('')}</ul>` : '<div class="text-muted small mb-2">No actions suggested.</div>'}
      <div class="small"><strong>Missing Data</strong></div>
      ${missingData.length ? `<ul class="mb-0">${missingData.map((item) => `<li>${UI.escapeHTML(String(item || ''))}</li>`).join('')}</ul>` : '<div class="text-muted small mb-0">None.</div>'}
    `;
  } catch (error) {
    stopLoadingHint();
    panel.innerHTML = `
      <div class="alert alert-warning mb-0">
        <strong>AI risk score unavailable.</strong>
        <div class="small mt-1">${UI.escapeHTML(error.message || 'Try again later.')}</div>
      </div>
    `;
    showMessage(error.message || 'Failed to generate AI risk score.', 'warning');
  } finally {
    endCmdbAiAction(actionKey);
  }
};

window.cmdbDigitalTwin = async (assetId) => {
  const panel = document.getElementById(`${CMDB_MODAL_ID}-digital-twin`);
  if (!panel) return;
  const actionKey = `digital_twin_${assetId}`;
  if (!beginCmdbAiAction(actionKey)) return;
  const stopLoadingHint = startAiPanelLoading(panel, 'Loading Digital Twin...');
  try {
    const result = await readInventoryJson(`/assets/${encodeURIComponent(assetId)}/digital-twin`);
    stopLoadingHint();
    const risk = result?.riskScore || {};
    const kit = result?.kitHealth || {};
    const related = result?.relatedCounts || {};
    const issues = Array.isArray(result?.openIssues) ? result.openIssues : [];
    panel.innerHTML = `
      <div class="alert alert-success mb-2">
        <div class="d-flex justify-content-between align-items-center gap-2">
          <strong>Digital Twin Overview</strong>
          <span class="badge bg-${result?.confidence === 'high' ? 'success' : result?.confidence === 'medium' ? 'warning text-dark' : 'danger'}">${UI.escapeHTML(String(result?.confidence || 'low').toUpperCase())}</span>
        </div>
        <div class="small mt-1">${UI.escapeHTML(String(result?.asset?.name || '-'))} (${UI.escapeHTML(String(result?.asset?.customId || '-'))})</div>
        ${aiSourceMetaHtml({
    llmUsed: Boolean(result?.llmUsed),
    fallbackUsed: Boolean(result?.fallbackUsed),
    llmStatus: String(result?.llmStatus || 'deterministic_only'),
    fallbackReason: String(result?.fallbackReason || ''),
  })}
      </div>
      <div class="small">
        <div><strong>Health Score:</strong> ${UI.escapeHTML(String(result?.healthScore ?? '-'))}</div>
        <div><strong>Risk:</strong> ${UI.escapeHTML(String(risk.riskLevel || '-'))} (${UI.escapeHTML(String(risk.riskScore ?? '-'))})</div>
        <div><strong>Kit Health:</strong> ${UI.escapeHTML(String(kit.label || kit.status || '-'))}</div>
        <div><strong>EOL:</strong> ${UI.escapeHTML(String(result?.eolStatus?.status || '-'))}</div>
        <div><strong>Warranty:</strong> ${UI.escapeHTML(String(result?.warrantyStatus?.status || '-'))}</div>
        <div><strong>Telemetry:</strong> ${UI.escapeHTML(String(result?.telemetryStatus?.status || '-'))}</div>
        <div><strong>Location:</strong> ${UI.escapeHTML(String(result?.currentLocation || '-'))}</div>
        <div><strong>Last Transfer:</strong> ${UI.escapeHTML(String(result?.lastTransfer?.timestamp ? UI.formatDateTime(result.lastTransfer.timestamp) : '-'))}</div>
        <div><strong>Last Maintenance:</strong> ${UI.escapeHTML(String(result?.lastMaintenance?.createdAt ? UI.formatDateTime(result.lastMaintenance.createdAt) : '-'))}</div>
        <div><strong>Related Counts:</strong> Components ${UI.escapeHTML(String(related.components ?? 0))} â€¢ Accessories ${UI.escapeHTML(String(related.accessories ?? 0))} â€¢ Licenses ${UI.escapeHTML(String(related.licenses ?? 0))} â€¢ Consumables ${UI.escapeHTML(String(related.consumables ?? 0))}</div>
      </div>
      ${issues.length ? `<div class="small mt-2"><strong>Open Issues:</strong> ${UI.escapeHTML(issues.join(' | '))}</div>` : '<div class="small mt-2 text-muted">No open issues.</div>'}
      ${result?.recommendedAction ? `<div class="small mt-2"><strong>Recommended Action:</strong> ${UI.escapeHTML(String(result.recommendedAction))}</div>` : ''}
    `;
  } catch (error) {
    stopLoadingHint();
    panel.innerHTML = `
      <div class="alert alert-warning mb-0">
        <strong>Digital Twin unavailable.</strong>
        <div class="small mt-1">${UI.escapeHTML(error.message || 'Try again later.')}</div>
      </div>
    `;
    showMessage(error.message || 'Failed to load digital twin.', 'warning');
  } finally {
    endCmdbAiAction(actionKey);
  }
};

window.cmdbBlackBoxTimeline = async (assetId, group = 'all') => {
  const panel = document.getElementById(`${CMDB_MODAL_ID}-black-box`);
  if (!panel) return;
  const requestedGroup = String(group || 'all').trim().toLowerCase();
  const actionKey = `black_box_${assetId}_${requestedGroup}`;
  const useCache = cmdbState.blackBoxTimelineAssetId === assetId && Array.isArray(cmdbState.blackBoxTimelineRows);
  if (!useCache && !beginCmdbAiAction(actionKey)) return;
  let stopLoadingHint = () => {};
  if (!useCache) {
    stopLoadingHint = startAiPanelLoading(panel, 'Loading Black Box Timeline...');
    try {
      const payload = await readInventoryJson(`/assets/${encodeURIComponent(assetId)}/black-box-timeline?includeRelated=true`);
      cmdbState.blackBoxTimelineAssetId = assetId;
      cmdbState.blackBoxTimelineRows = Array.isArray(payload?.events) ? payload.events : [];
      stopLoadingHint();
    } catch (error) {
      stopLoadingHint();
      panel.innerHTML = `
        <div class="alert alert-warning mb-0">
          <strong>Black Box Timeline unavailable.</strong>
          <div class="small mt-1">${UI.escapeHTML(error.message || 'Try again later.')}</div>
        </div>
      `;
      showMessage(error.message || 'Failed to load black box timeline.', 'warning');
      endCmdbAiAction(actionKey);
      return;
    } finally {
      endCmdbAiAction(actionKey);
    }
  }

  const rows = Array.isArray(cmdbState.blackBoxTimelineRows) ? cmdbState.blackBoxTimelineRows : [];
  const groupedCounts = rows.reduce((acc, row) => {
    const key = String(row?.eventGroup || 'all');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const filtered = requestedGroup === 'all'
    ? rows
    : rows.filter((row) => String(row?.eventGroup || 'all') === requestedGroup);

  const groups = ['all', 'transfer', 'maintenance', 'components', 'audit', 'ai_risk_eol', 'loaner', 'telemetry'];
  const controls = groups.map((key) => `
    <button type="button"
      class="btn btn-sm ${requestedGroup === key ? 'btn-primary' : 'btn-outline-primary'}"
      onclick="window.cmdbBlackBoxTimeline('${assetId}','${key}')">
      ${UI.escapeHTML(key.replace(/_/g, ' '))} (${UI.escapeHTML(String(key === 'all' ? rows.length : (groupedCounts[key] || 0)))})
    </button>
  `).join('');

  const timelineRows = filtered.slice(0, 120).map((row) => `
    <tr>
      <td>${row.timestamp ? UI.formatDateTime(row.timestamp) : '-'}</td>
      <td>${UI.escapeHTML(row.label || row.eventType || '-')}</td>
      <td>${UI.escapeHTML(row.sourceItemType || '-')}</td>
      <td>${UI.escapeHTML(row.sourceItemName || row.sourceItemCustomId || '-')}</td>
      <td>${UI.escapeHTML(row.reason || row.notes || '-')}</td>
      <td><span class="badge bg-${row.severity === 'critical' ? 'danger' : (row.severity === 'warning' ? 'warning text-dark' : 'secondary')}">${UI.escapeHTML(String(row.severity || 'info'))}</span></td>
    </tr>
  `).join('');

  panel.innerHTML = `
    <div class="alert alert-light border mb-2">
      <div class="d-flex flex-wrap gap-2 align-items-center justify-content-between">
        <strong>Black Box Timeline</strong>
        <span class="small text-muted">Events: ${UI.escapeHTML(String(rows.length))}</span>
      </div>
      ${aiSourceMetaHtml({ llmStatus: 'deterministic_only', llmUsed: false, fallbackUsed: false })}
      <div class="d-flex flex-wrap gap-2 mt-2">${controls}</div>
    </div>
    <div class="table-responsive">
      <table class="table table-sm">
        <thead><tr><th>When</th><th>Event</th><th>Type</th><th>Item</th><th>Reason/Notes</th><th>Severity</th></tr></thead>
        <tbody>${timelineRows || '<tr><td colspan="6" class="text-muted">No events.</td></tr>'}</tbody>
      </table>
    </div>
  `;
};

window.cmdbAiDraftTicket = async (assetId) => {
  const panel = document.getElementById(`${CMDB_MODAL_ID}-ai-ticket`);
  if (!panel) return;
  const actionKey = `ai_ticket_${assetId}`;
  const asset = currentAssets.find((entry) => entry.customId === assetId) || await readInventoryJson(`/assets/${encodeURIComponent(assetId)}`).catch(() => null);
  const form = await showInventoryFormModal({
    title: 'Draft Ticket',
    message: `Review and confirm before drafting a ticket. Asset: ${asset?.name || assetId}`,
    confirmText: 'Create Draft',
    confirmClass: 'btn-secondary',
    dialogClass: 'modal-lg',
    fields: [
      {
        name: 'assetName',
        label: 'Asset Name',
        type: 'text',
        value: asset?.name || '-',
        readonly: true,
      },
      {
        name: 'assetTag',
        label: 'Asset Tag',
        type: 'text',
        value: getDisplayAssetTag(asset || {}) || '-',
        readonly: true,
      },
      {
        name: 'location',
        label: 'Location',
        type: 'text',
        value: getAssetDisplayLocation(asset || {}),
        readonly: true,
      },
      {
        name: 'department',
        label: 'Department',
        type: 'text',
        value: getAssetDisplayDepartment(asset || {}),
        readonly: true,
      },
      {
        name: 'issueSummary',
        label: 'Issue Summary',
        type: 'text',
        value: 'Asset risk or maintenance follow-up',
        required: true,
      },
      {
        name: 'description',
        label: 'Description',
        type: 'textarea',
        rows: 4,
        required: false,
      },
      {
        name: 'priority',
        label: 'Priority',
        type: 'select',
        options: ['low', 'medium', 'high', 'critical'],
        value: 'medium',
        required: true,
      },
      {
        name: 'suggestedCategory',
        label: 'Suggested Category',
        type: 'select',
        options: ['maintenance', 'risk', 'hardware', 'software', 'other'],
        value: 'maintenance',
        required: true,
      },
    ],
  });
  if (!form?.confirmed) return;
  if (!beginCmdbAiAction(actionKey)) return;

  const issue = [
    form.values.issueSummary,
    form.values.description,
    `Priority: ${form.values.priority}`,
    `Category: ${form.values.suggestedCategory}`,
  ].filter(Boolean).join(' | ');

  const stopLoadingHint = startAiPanelLoading(panel, 'Drafting inventory ticket...');
  try {
    const result = await postInventoryJson('/inventory/ai/ticket-draft', {
      assetId,
      issue,
    });
    stopLoadingHint();
    const draft = result?.ticketDraft || {};
    const draftText = [
      `Title: ${draft.title || '-'}`,
      `Priority: ${draft.priority || '-'}`,
      `Category: ${draft.category || '-'}`,
      `Asset: ${draft.assetName || '-'} (${draft.assetId || '-'})`,
      `Suggested Assignee: ${draft.suggestedAssignee || '-'}`,
      `Recommended Due Date: ${draft.recommendedDueDate || '-'}`,
      '',
      `Description:`,
      `${draft.description || '-'}`,
    ].join('\n');
    panel.innerHTML = `
      <div class="alert alert-secondary mb-2">
        <div class="d-flex justify-content-between align-items-center">
          <strong>AI Ticket Draft</strong>
          <span class="badge bg-${result?.confidence === 'high' ? 'success' : (result?.confidence === 'medium' ? 'warning text-dark' : 'danger')}">${UI.escapeHTML(String(result?.confidence || 'low').toUpperCase())}</span>
        </div>
        <div class="small mt-1">Review before creating a real ticket. Nothing is submitted automatically.</div>
        ${aiSourceMetaHtml(result)}
      </div>
      <textarea class="form-control form-control-sm" rows="8" readonly>${UI.escapeHTML(draftText)}</textarea>
    `;
  } catch (error) {
    stopLoadingHint();
    panel.innerHTML = `
      <div class="alert alert-warning mb-0">
        <strong>AI ticket draft unavailable.</strong>
        <div class="small mt-1">${UI.escapeHTML(error.message || 'Try again later.')}</div>
      </div>
    `;
    showMessage(error.message || 'Failed to draft inventory ticket.', 'warning');
  } finally {
    endCmdbAiAction(actionKey);
  }
};

window.cmdbViewComponentHistory = async (assetId, componentId) => {
  try {
    const rows = await readInventoryJson(`/assets/${encodeURIComponent(assetId)}/components/${encodeURIComponent(componentId)}/history`);
    const preview = (rows || []).slice(0, 8).map((row) => `${row.createdAt ? new Date(row.createdAt).toLocaleString() : '-'} - ${row.eventType || '-'} (${row.reason || 'n/a'})`).join('\n');
    await showInventoryTextPreviewModal({
      title: 'Component History',
      message: 'Latest component history entries.',
      text: preview || 'No component history entries yet.',
      rows: 10,
      confirmText: 'Close',
    });
  } catch (error) {
    showMessage(error.message || 'Failed to load component history.', 'error');
  }
};

window.cmdbAddComponent = async (assetId) => {
  const parentAsset = currentAssets.find((asset) => asset.customId === assetId) || await readInventoryJson(`/assets/${encodeURIComponent(assetId)}`).catch(() => null);
  const componentOptions = getComponentRegistryOptionsForAsset(parentAsset || {});
  const form = await showInventoryFormModal({
    title: 'Create & Add New Component',
    message: `Parent asset: ${parentAsset?.name || assetId}`,
    confirmText: 'Create Component',
    confirmClass: 'btn-primary',
    dialogClass: 'modal-lg',
    fields: [
      {
        name: 'componentName',
        label: 'Component Name',
        type: 'text',
        placeholder: 'RAM 16GB / SSD 1TB / GPU RTX...',
        required: true,
        colClass: 'col-md-6',
      },
      {
        name: 'componentType',
        label: 'Component Type',
        type: 'select',
        options: componentOptions,
        value: componentOptions[0] || 'component',
        required: true,
        colClass: 'col-md-6',
      },
      {
        name: 'brand',
        label: 'Brand',
        type: 'text',
        required: false,
        colClass: 'col-md-6',
      },
      {
        name: 'model',
        label: 'Model',
        type: 'text',
        required: false,
        colClass: 'col-md-6',
      },
      {
        name: 'serialNumber',
        label: 'Serial Number',
        type: 'text',
        required: false,
        colClass: 'col-md-6',
      },
      {
        name: 'assetTag',
        label: 'Asset Tag / Unique ID',
        type: 'text',
        required: false,
        colClass: 'col-md-6',
      },
      {
        name: 'partNumber',
        label: 'Part Number',
        type: 'text',
        required: false,
        colClass: 'col-md-6',
      },
      {
        name: 'condition',
        label: 'Condition',
        type: 'select',
        options: ['new', 'good', 'used', 'repair_needed'],
        value: 'new',
        required: true,
        colClass: 'col-md-6',
      },
      {
        name: 'status',
        label: 'Status / Lifecycle',
        type: 'select',
        options: ['installed', 'under_repair', 'in_stock'],
        value: 'installed',
        required: true,
        colClass: 'col-md-6',
      },
      {
        name: 'createAsAsset',
        label: 'Create as standalone inventory component asset',
        type: 'checkbox',
        value: true,
        required: false,
        colClass: 'col-md-6',
      },
      {
        name: 'notes',
        label: 'Notes',
        type: 'textarea',
        rows: 3,
        required: false,
        colClass: 'col-12',
      },
    ],
  });
  if (!form?.confirmed) return;
  const componentName = String(form.values.componentName || '').trim();
  if (!componentName) return;
  const serialNumber = String(form.values.serialNumber || '').trim();
  const assetTag = String(form.values.assetTag || '').trim();

  const existingRows = await readInventoryJson(`/assets/${encodeURIComponent(assetId)}/components?includeRemoved=true`).catch(() => []);
  const duplicateExisting = (Array.isArray(existingRows) ? existingRows : []).find((row) => {
    const rowStatus = normalizeLifecycleStatus(row?.status || '');
    const removed = Boolean(row?.removedAt) || ['removed', 'replaced', 'retired', 'disposed'].includes(rowStatus);
    if (removed) return false;
    const serialMatch = serialNumber && normalizeValue(row?.serialNumber) === normalizeValue(serialNumber);
    const tagMatch = assetTag && normalizeValue(row?.childAsset?.assetTag || row?.assetTag) === normalizeValue(assetTag);
    return serialMatch || tagMatch;
  });
  if (duplicateExisting) {
    showMessage('A component with the same serial number or asset tag is already installed on this asset.', 'warning');
    return;
  }

  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/components`, {
      componentName,
      componentType: form.values.componentType || 'component',
      brand: form.values.brand || null,
      model: form.values.model || null,
      serialNumber: serialNumber || null,
      assetTag: assetTag || null,
      partNumber: form.values.partNumber || null,
      condition: form.values.condition || 'new',
      reason: form.values.notes || 'component_created_and_added',
      notes: form.values.notes || null,
      createAsAsset: Boolean(form.values.createAsAsset),
      status: form.values.status || 'installed',
    });
    showMessage('Component added.', 'success');
    await loadAssets();
    await refreshCmdbModal(assetId, 'components');
  } catch (error) {
    showMessage(error.message || 'Failed to add component.', 'error');
  }
};

async function getCmdbComponentRecord(assetId, componentId) {
  const rows = await readInventoryJson(`/assets/${encodeURIComponent(assetId)}/components?includeRemoved=true`).catch(() => []);
  return (Array.isArray(rows) ? rows : []).find((row) => String(row?.id || '') === String(componentId || '')) || null;
}

window.cmdbEditComponent = async (assetId, componentId) => {
  const parentAsset = currentAssets.find((asset) => asset.customId === assetId);
  const componentOptions = getComponentRegistryOptionsForAsset(parentAsset || {});
  const target = await getCmdbComponentRecord(assetId, componentId);
  if (!target) {
    showMessage('Component not found.', 'warning');
    return;
  }
  const form = await showInventoryFormModal({
    title: 'Edit Component',
    message: `Parent asset: ${parentAsset?.name || assetId}`,
    confirmText: 'Save Changes',
    confirmClass: 'btn-primary',
    dialogClass: 'modal-lg',
    fields: [
      { name: 'componentName', label: 'Component Name', type: 'text', value: target.componentName || '', required: true, colClass: 'col-md-6' },
      { name: 'componentType', label: 'Component Type', type: 'select', options: componentOptions, value: target.componentType || componentOptions[0] || 'component', required: true, colClass: 'col-md-6' },
      { name: 'serialNumber', label: 'Serial Number', type: 'text', value: target.serialNumber || '', required: false, colClass: 'col-md-6' },
      { name: 'partNumber', label: 'Part Number', type: 'text', value: target.partNumber || '', required: false, colClass: 'col-md-6' },
      { name: 'condition', label: 'Condition', type: 'text', value: target.condition || '', required: false, colClass: 'col-md-6' },
    ],
  });
  if (!form?.confirmed) return;
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/components/${encodeURIComponent(componentId)}`, {
      componentName: form.values.componentName,
      componentType: form.values.componentType || 'component',
      serialNumber: form.values.serialNumber || '',
      partNumber: form.values.partNumber || '',
      condition: form.values.condition || '',
    }, 'PUT');
    showMessage('Component updated.', 'success');
    await refreshCmdbModal(assetId, 'components');
  } catch (error) {
    showMessage(error.message || 'Failed to update component.', 'error');
  }
};

window.cmdbRemoveComponent = async (assetId, componentId) => {
  const reason = await promptInventoryValue({
    title: 'Remove Component',
    label: 'Removal reason',
    value: 'removed',
    required: true,
  });
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
  const parentAsset = currentAssets.find((asset) => asset.customId === assetId);
  const componentOptions = getComponentRegistryOptionsForAsset(parentAsset || {});
  const form = await showInventoryFormModal({
    title: 'Replace Component',
    message: 'Create replacement component and retire current one.',
    confirmText: 'Replace Component',
    confirmClass: 'btn-primary',
    dialogClass: 'modal-lg',
    fields: [
      { name: 'componentName', label: 'New Component Name', type: 'text', required: true, colClass: 'col-md-6' },
      { name: 'componentType', label: 'New Component Type', type: 'select', options: componentOptions, value: componentOptions[0] || 'component', required: true, colClass: 'col-md-6' },
      { name: 'serialNumber', label: 'New Component Serial', type: 'text', required: false, colClass: 'col-md-6' },
      { name: 'reason', label: 'Replacement Reason', type: 'text', value: 'replaced', required: true, colClass: 'col-md-6' },
    ],
  });
  if (!form?.confirmed) return;
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/components/${encodeURIComponent(componentId)}/replace`, {
      reason: form.values.reason,
      newComponent: {
        componentName: form.values.componentName,
        componentType: form.values.componentType || 'component',
        serialNumber: form.values.serialNumber || '',
        status: 'installed',
      },
      oldStatus: 'replaced',
    });
    showMessage('Component replaced.', 'success');
    await refreshCmdbModal(assetId, 'components');
  } catch (error) {
    showMessage(error.message || 'Failed to replace component.', 'error');
  }
};

window.cmdbRepairComponent = async (assetId, componentId) => {
  const form = await showInventoryFormModal({
    title: 'Repair Component',
    confirmText: 'Record Repair',
    confirmClass: 'btn-warning',
    dialogClass: 'modal-md',
    fields: [
      { name: 'reason', label: 'Repair Reason', type: 'text', value: 'repair', required: true },
      { name: 'nextStatus', label: 'Status After Repair', type: 'select', options: ['under_repair', 'installed'], value: 'under_repair', required: true },
    ],
  });
  if (!form?.confirmed) return;
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/components/${encodeURIComponent(componentId)}/repair`, {
      reason: form.values.reason,
      status: form.values.nextStatus || 'under_repair',
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
  const reason = await promptInventoryValue({
    title: 'Mark Component Failed',
    label: 'Failure reason',
    value: 'hardware failure',
    required: true,
  });
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
  const form = await showInventoryFormModal({
    title: 'Retire / Dispose Component',
    confirmText: 'Apply',
    confirmClass: 'btn-danger',
    dialogClass: 'modal-md',
    fields: [
      { name: 'status', label: 'Status', type: 'select', options: ['retired', 'disposed'], value: 'retired', required: true },
      { name: 'reason', label: 'Reason', type: 'text', value: 'retired', required: true },
    ],
  });
  if (!form?.confirmed) return;
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/components/${encodeURIComponent(componentId)}/retire`, {
      status: form.values.status || 'retired',
      reason: form.values.reason || form.values.status || 'retired',
    });
    showMessage(`Component ${form.values.status || 'retired'}.`, form.values.status === 'disposed' ? 'warning' : 'success');
    await refreshCmdbModal(assetId, 'components');
  } catch (error) {
    showMessage(error.message || 'Failed to retire/dispose component.', 'error');
  }
};

async function getInstallableFreeComponentAssets(parentAssetId) {
  await refreshInventoryFilterSnapshot();
  const snapshotAssets = Array.isArray(inventoryFilterSnapshotState.allAssets) ? inventoryFilterSnapshotState.allAssets : [];
  return snapshotAssets
    .filter((asset) => {
      const customId = String(asset?.customId || '').trim();
      if (!customId || customId === parentAssetId) return false;
      const categoryKey = getAssetCategoryKey(asset || {});
      if (categoryKey !== 'component') return false;
      const lifecycle = normalizeLifecycleStatus(asset?.lifecycleStatus || asset?.lifecycle_status || '');
      if (['retired', 'disposed', 'lost_stolen'].includes(lifecycle)) return false;
      const installedParent = String(asset?.installedParentCustomId || asset?.installedParentAssetId || '').trim();
      if (installedParent && installedParent !== parentAssetId) return false;
      const relatedParent = String(asset?.relatedParentCustomId || '').trim();
      if (relatedParent && relatedParent !== parentAssetId) return false;
      return true;
    })
    .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
}

window.cmdbInstallFromStock = async (assetId) => {
  const sourceMode = await promptInventoryValue({
    title: 'Install From Stock',
    label: 'Source Mode',
    type: 'select',
    options: [
      { value: 'existing_asset', label: 'Existing free asset' },
      { value: 'spare_stock', label: 'Spare stock item' },
    ],
    value: 'existing_asset',
    placeholder: 'Select source mode',
    required: true,
  });
  if (!sourceMode) return;

  const activeComponents = await readInventoryJson(`/assets/${encodeURIComponent(assetId)}/components?includeRemoved=true`).catch(() => []);
  const activeChildIds = new Set(
    (Array.isArray(activeComponents) ? activeComponents : [])
      .filter((row) => !row?.removedAt && !['removed', 'replaced', 'retired', 'disposed'].includes(normalizeLifecycleStatus(row?.status)))
      .map((row) => String(row?.childAssetId || '').trim())
      .filter(Boolean)
  );

  if (sourceMode === 'existing_asset') {
    const candidates = await getInstallableFreeComponentAssets(assetId);
    const filteredCandidates = candidates.filter((asset) => !activeChildIds.has(String(asset?.customId || '').trim()));
    if (!filteredCandidates.length) {
      showMessage('No free component assets are available for linking.', 'warning');
      return;
    }
    const form = await showInventoryFormModal({
      title: 'Install Existing Free Asset',
      message: 'Select an available component asset to link to this parent asset.',
      confirmText: 'Install Component',
      confirmClass: 'btn-primary',
      dialogClass: 'modal-lg',
      fields: [
        {
          name: 'childAssetId',
          label: 'Existing Free Asset',
          type: 'select',
          options: filteredCandidates.map((asset) => ({
            value: asset.customId,
            label: `${asset.name} | ${asset.customId} | ${getAssetDisplayLocation(asset)} | ${getAssetDisplayDepartment(asset)}`,
          })),
          placeholder: 'Select asset',
          required: true,
        },
        {
          name: 'reason',
          label: 'Reason / Notes',
          type: 'textarea',
          rows: 3,
          value: 'installed_from_existing_asset',
          required: true,
        },
      ],
    });
    if (!form?.confirmed) return;
    const selectedId = String(form.values.childAssetId || '').trim();
    if (!selectedId || selectedId === assetId) {
      showMessage('Invalid component selection.', 'warning');
      return;
    }
    if (activeChildIds.has(selectedId)) {
      showMessage('This component is already installed on the parent asset.', 'warning');
      return;
    }
    const selected = filteredCandidates.find((asset) => String(asset.customId || '') === selectedId);
    if (!selected) {
      showMessage('Selected component asset was not found.', 'warning');
      return;
    }
    try {
      await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/components`, {
        childAssetId: selectedId,
        componentName: selected.name || selectedId,
        componentType: selected.componentType || getAssetSpecs(selected)?.componentType || 'component',
        serialNumber: selected.serialNumber || null,
        partNumber: selected.manufacturerPartNumber || null,
        createAsAsset: false,
        status: 'installed',
        reason: form.values.reason || 'installed_from_existing_asset',
        notes: form.values.reason || null,
      });
      showMessage('Existing asset linked as component.', 'success');
      await loadAssets();
      await refreshCmdbModal(assetId, 'components');
    } catch (error) {
      showMessage(error.message || 'Failed to link existing component asset.', 'error');
    }
    return;
  }

  await window.loadSpareStock();
  const availableStock = (spareStockItemsCache || []).filter((item) => Number(item.quantityAvailable) > 0);
  if (!availableStock.length) {
    showMessage('No available spare stock items to install.', 'warning');
    return;
  }
  const stockForm = await showInventoryFormModal({
    title: 'Install From Spare Stock',
    message: 'Select spare stock item and quantity to install.',
    confirmText: 'Install From Stock',
    confirmClass: 'btn-primary',
    dialogClass: 'modal-lg',
    fields: [
      {
        name: 'spareStockItemId',
        label: 'Spare Stock Item',
        type: 'select',
        options: availableStock.map((item) => ({
          value: item.id,
          label: `${item.partName} | ${item.componentType} | Qty ${item.quantityAvailable}`,
        })),
        required: true,
      },
      {
        name: 'quantity',
        label: 'Quantity',
        type: 'number',
        value: 1,
        min: 1,
        step: 1,
        required: true,
        validate: (value) => {
          const parsed = Number(value);
          if (!Number.isFinite(parsed) || parsed < 1) return 'Quantity must be 1 or more.';
          if (!Number.isInteger(parsed)) return 'Quantity must be a whole number.';
          return '';
        },
      },
      {
        name: 'reason',
        label: 'Reason / Notes',
        type: 'textarea',
        rows: 3,
        value: 'installed_from_stock',
        required: true,
      },
    ],
  });
  if (!stockForm?.confirmed) return;

  const spareStockItemId = String(stockForm.values.spareStockItemId || '').trim();
  const quantity = Math.max(1, Math.trunc(Number(stockForm.values.quantity || 1)));
  const selectedStock = availableStock.find((item) => String(item.id || '') === spareStockItemId);
  if (!selectedStock) {
    showMessage('Selected spare stock item was not found.', 'warning');
    return;
  }
  if (quantity > Number(selectedStock.quantityAvailable || 0)) {
    showMessage(`Only ${selectedStock.quantityAvailable} item(s) are available in stock.`, 'warning');
    return;
  }

  try {
    let lowStockTriggered = false;
    let installedCount = 0;
    for (let index = 0; index < quantity; index += 1) {
      const result = await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/components/install-from-stock`, {
        spareStockItemId,
        reason: stockForm.values.reason || 'installed_from_stock',
        createAsAsset: true,
        status: 'installed',
      });
      installedCount += 1;
      if (result?.lowStockWarning) lowStockTriggered = true;
    }
    showMessage(
      lowStockTriggered
        ? `Installed ${installedCount} component(s) from stock. Low stock warning triggered.`
        : `Installed ${installedCount} component(s) from stock.`,
      lowStockTriggered ? 'warning' : 'success'
    );
    await loadSpareStock();
    await loadAssets();
    await refreshCmdbModal(assetId, 'components');
  } catch (error) {
    showMessage(error.message || 'Failed to install from stock.', 'error');
  }
};

window.cmdbReplaceFromStock = async (assetId, componentId) => {
  await window.loadSpareStock();
  const availableStock = (spareStockItemsCache || []).filter((item) => Number(item.quantityAvailable) > 0);
  if (!availableStock.length) {
    showMessage('No available spare stock items for replacement.', 'warning');
    return;
  }
  const form = await showInventoryFormModal({
    title: 'Replace From Spare Stock',
    message: 'Choose spare stock item for replacement.',
    confirmText: 'Replace Component',
    confirmClass: 'btn-primary',
    dialogClass: 'modal-lg',
    fields: [
      {
        name: 'spareStockItemId',
        label: 'Spare Stock Item',
        type: 'select',
        options: availableStock.map((item) => ({
          value: item.id,
          label: `${item.partName} | ${item.componentType} | Qty ${item.quantityAvailable}`,
        })),
        required: true,
      },
      {
        name: 'reason',
        label: 'Replacement Reason',
        type: 'text',
        value: 'replaced_from_stock',
        required: true,
      },
    ],
  });
  if (!form?.confirmed) return;
  const spareStockItemId = String(form.values.spareStockItemId || '').trim();
  const reason = String(form.values.reason || '').trim() || 'replaced_from_stock';
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
  const components = await readInventoryJson(`/assets/${encodeURIComponent(assetId)}/components`).catch(() => []);
  const activeComponents = (Array.isArray(components) ? components : [])
    .filter((row) => !row?.removedAt && !['removed', 'replaced', 'retired', 'disposed'].includes(normalizeLifecycleStatus(row?.status)))
    .map((row) => ({
      value: row.id,
      label: `${row.componentName || row.id} | ${row.componentType || '-'}`,
    }));
  const form = await showInventoryFormModal({
    title: 'Add Maintenance',
    message: 'Maintenance supports whole-asset and component-specific records.',
    confirmText: 'Save Maintenance',
    confirmClass: 'btn-primary',
    dialogClass: 'modal-lg',
    fields: [
      {
        name: 'scope',
        label: 'Scope',
        type: 'select',
        options: [
          { value: 'whole_asset', label: 'Whole Asset' },
          { value: 'specific_component', label: 'Specific Component' },
        ],
        value: 'whole_asset',
        required: true,
        colClass: 'col-md-6',
      },
      {
        name: 'componentId',
        label: 'Component',
        type: 'select',
        options: activeComponents,
        placeholder: activeComponents.length ? 'Select component' : 'No installed components available',
        required: false,
        colClass: 'col-md-6',
        validate: (value, values) => {
          if (values.scope === 'specific_component' && !String(value || '').trim()) {
            return 'Select a component for component-specific maintenance.';
          }
          return '';
        },
      },
      {
        name: 'maintenanceType',
        label: 'Maintenance Type',
        type: 'text',
        value: 'preventive_maintenance',
        required: true,
        colClass: 'col-md-4',
      },
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        options: ['completed', 'in_progress', 'scheduled'],
        value: 'completed',
        required: true,
        colClass: 'col-md-4',
      },
      {
        name: 'cost',
        label: 'Cost',
        type: 'number',
        value: '',
        min: 0,
        step: 0.01,
        required: false,
        colClass: 'col-md-4',
      },
      {
        name: 'performedBy',
        label: 'Performed By',
        type: 'text',
        required: false,
        colClass: 'col-md-6',
      },
      {
        name: 'performedAt',
        label: 'Date',
        type: 'date',
        value: new Date().toISOString().slice(0, 10),
        required: true,
        colClass: 'col-md-6',
      },
      {
        name: 'notes',
        label: 'Notes',
        type: 'textarea',
        rows: 3,
        required: false,
        colClass: 'col-12',
      },
    ],
  });
  if (!form?.confirmed) return;
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/maintenance`, {
      componentId: form.values.scope === 'specific_component' ? (form.values.componentId || null) : null,
      maintenanceType: form.values.maintenanceType,
      status: form.values.status || 'completed',
      performedBy: form.values.performedBy || '',
      reason: form.values.notes || '',
      notes: form.values.notes || '',
      cost: form.values.cost,
      performedAt: form.values.performedAt
        ? new Date(`${form.values.performedAt}T09:00:00`).toISOString()
        : new Date().toISOString(),
    });
    showMessage('Maintenance record added.', 'success');
    await refreshCmdbModal(assetId, 'maintenance');
  } catch (error) {
    showMessage(error.message || 'Failed to add maintenance record.', 'error');
  }
};

window.cmdbAssignAsset = async (assetId) => {
  const asset = currentAssets.find((entry) => entry.customId === assetId) || await readInventoryJson(`/assets/${encodeURIComponent(assetId)}`).catch(() => null);
  const form = await showInventoryFormModal({
    title: 'Assign / Checkout Asset',
    message: `Asset: ${asset?.name || assetId}`,
    confirmText: 'Assign Asset',
    confirmClass: 'btn-primary',
    dialogClass: 'modal-lg',
    fields: [
      {
        name: 'assignmentType',
        label: 'Assignment Type',
        type: 'select',
        options: ['Assigned', 'Checked out'],
        value: 'Assigned',
        required: true,
        colClass: 'col-md-6',
      },
      {
        name: 'building',
        label: 'Building',
        type: 'select',
        options: getKnownBuildingOptions(),
        value: getAssetDisplayLocation(asset || {}),
        required: true,
        colClass: 'col-md-6',
      },
      {
        name: 'department',
        label: 'Department',
        type: 'select',
        options: getKnownDepartmentOptions(),
        value: normalizeDepartmentLabel(getAssetDisplayDepartment(asset || ''), { fallbackUnassigned: false }) || '',
        required: true,
        colClass: 'col-md-6',
      },
      {
        name: 'room',
        label: 'Room',
        type: 'text',
        value: '',
        placeholder: 'Rooms will be configured later',
        required: false,
        colClass: 'col-md-6',
      },
      {
        name: 'assignedToRole',
        label: 'Assigned To Role',
        type: 'select',
        options: ['Lab Supervisor', 'Senior', 'Junior', 'Professor', 'Technician', 'Department Admin', 'Student Worker', 'Other'],
        required: true,
        colClass: 'col-md-6',
      },
      {
        name: 'assignedToName',
        label: 'Assignee Name',
        type: 'text',
        required: true,
        colClass: 'col-md-6',
      },
      {
        name: 'expectedReturnDate',
        label: 'Expected Return Date',
        type: 'date',
        required: false,
        colClass: 'col-md-6',
      },
      {
        name: 'notes',
        label: 'Reason / Notes',
        type: 'textarea',
        rows: 3,
        required: false,
        colClass: 'col-12',
      },
    ],
  });
  if (!form?.confirmed) return;

  const assignedToName = [form.values.assignedToRole, form.values.assignedToName].filter(Boolean).join(' - ');
  const assignedDepartment = form.values.department || '';
  const expectedReturnDate = form.values.expectedReturnDate || '';
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/assign`, {
      assignedToName,
      assignedDepartment,
      expectedReturnDate: expectedReturnDate || null,
      checkoutDate: new Date().toISOString(),
      reason: normalizeValue(form.values.assignmentType) === 'checkedout' ? 'checkout' : 'assignment',
      notes: [
        form.values.notes || '',
        form.values.building ? `Building: ${form.values.building}` : '',
        form.values.room ? `Room: ${form.values.room}` : '',
      ].filter(Boolean).join(' | '),
    });
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/details`, {
      specifications: {
        ...getAssetSpecs(asset || {}),
        assignedBuilding: form.values.building || null,
        assignedRoom: form.values.room || null,
      }
    }, 'PATCH').catch(() => {});
    showMessage('Asset assigned/checked out.', 'success');
    await loadAssets();
    await refreshCmdbModal(assetId, 'custody');
  } catch (error) {
    showMessage(error.message || 'Failed to assign asset.', 'error');
  }
};

window.cmdbCheckinAsset = async (assetId) => {
  const form = await showInventoryFormModal({
    title: 'Check-in Asset',
    message: `Asset ID: ${assetId}`,
    confirmText: 'Confirm Check-in',
    confirmClass: 'btn-outline-secondary',
    dialogClass: 'modal-md',
    fields: [
      {
        name: 'conditionIn',
        label: 'Return Condition',
        type: 'select',
        options: ['good', 'needs_review', 'damaged', 'missing_accessories'],
        value: 'good',
        required: true,
      },
      {
        name: 'reason',
        label: 'Notes',
        type: 'textarea',
        rows: 3,
        required: false,
      },
    ],
  });
  if (!form?.confirmed) return;
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/check-in`, {
      returnedDate: new Date().toISOString(),
      conditionIn: form.values.conditionIn || 'good',
      reason: form.values.reason || '',
      notes: form.values.reason || '',
    });
    showMessage('Asset checked in.', 'success');
    await loadAssets();
    await refreshCmdbModal(assetId, 'custody');
  } catch (error) {
    showMessage(error.message || 'Failed to check in asset.', 'error');
  }
};

window.cmdbAddRelationship = async (assetId) => {
  await refreshInventoryFilterSnapshot();
  const candidates = (Array.isArray(inventoryFilterSnapshotState.allAssets) ? inventoryFilterSnapshotState.allAssets : [])
    .filter((asset) => String(asset?.customId || '').trim() && String(asset?.customId || '').trim() !== String(assetId || '').trim())
    .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')))
    .slice(0, 1200);
  const form = await showInventoryFormModal({
    title: 'Add Relationship',
    messageHtml: 'Direction: this asset <strong>links to</strong> the selected related item.',
    confirmText: 'Add Relationship',
    confirmClass: 'btn-primary',
    dialogClass: 'modal-lg',
    fields: [
      {
        name: 'relatedAssetId',
        label: 'Related Item',
        type: 'select',
        options: candidates.map((asset) => ({
          value: asset.customId,
          label: `${asset.name} | ${asset.customId} | ${getAssetDisplayLocation(asset)} | ${getAssetDisplayDepartment(asset)}`,
        })),
        placeholder: 'Select related asset',
        required: true,
      },
      {
        name: 'relationshipType',
        label: 'Relationship',
        type: 'select',
        options: [
          { value: 'assigned_to', label: 'Assigned to this asset' },
          { value: 'licensed_to', label: 'Licensed to this asset' },
          { value: 'related_to', label: 'Related to this asset' },
          { value: 'accessory_of', label: 'Accessory of this asset' },
          { value: 'component_of', label: 'Component of this asset' },
          { value: 'uses', label: 'Uses' },
          { value: 'connected_to', label: 'Connected to' },
          { value: 'depends_on', label: 'Depends on' },
        ],
        value: 'related_to',
        required: true,
      },
      {
        name: 'notes',
        label: 'Notes',
        type: 'textarea',
        rows: 3,
        required: false,
      },
    ],
  });
  if (!form?.confirmed) return;
  const relatedAssetId = String(form.values.relatedAssetId || '').trim();
  const relationshipType = String(form.values.relationshipType || '').trim();
  if (!relatedAssetId || !relationshipType) return;
  if (relatedAssetId === assetId) {
    showMessage('An asset cannot be related to itself.', 'warning');
    return;
  }
  const currentRelationships = await readInventoryJson(`/assets/${encodeURIComponent(assetId)}/relationships`).catch(() => ({ outgoing: [], incoming: [] }));
  const isDuplicate = Array.isArray(currentRelationships?.outgoing)
    && currentRelationships.outgoing.some((row) => (
      String(row?.relatedAssetId || '') === relatedAssetId
      && normalizeValue(row?.relationshipType) === normalizeValue(relationshipType)
    ));
  if (isDuplicate) {
    showMessage('This relationship already exists.', 'warning');
    return;
  }
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/relationships`, {
      relatedAssetId,
      relationshipType,
      notes: form.values.notes || null,
    });
    showMessage('Relationship added.', 'success');
    await refreshCmdbModal(assetId, 'relationships');
  } catch (error) {
    showMessage(error.message || 'Failed to add relationship.', 'error');
  }
};

window.cmdbDeleteRelationship = async (assetId, relationshipId) => {
  const confirmed = await confirmInventoryAction({
    title: 'Delete Relationship',
    message: 'Delete this relationship? This action cannot be undone.',
    confirmText: 'Delete',
    confirmClass: 'inventory-insight-danger',
  });
  if (!confirmed) return;
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

window.openSpareStockModalForType = async (componentType = '') => {
  await window.openSpareStockModal();
  const searchInput = document.getElementById('spareStockSearchInput');
  if (searchInput) {
    searchInput.value = String(componentType || '').trim();
    window.renderSpareStockTable();
  }
};

window.cmdbLoanerCheckout = async (assetId) => {
  const asset = currentAssets.find((entry) => entry.customId === assetId) || await readInventoryJson(`/assets/${encodeURIComponent(assetId)}`).catch(() => null);
  const specs = getAssetSpecs(asset || {});
  if (!toBoolean(specs.loanerEligible)) {
    showMessage('This asset is not marked as a loaner. Mark it as a loaner before checkout.', 'warning');
    return;
  }
  const form = await showInventoryFormModal({
    title: 'Loaner Checkout',
    message: `Asset: ${asset?.name || assetId}`,
    confirmText: 'Confirm Checkout',
    confirmClass: 'btn-outline-info',
    dialogClass: 'modal-md',
    fields: [
      {
        name: 'loanedTo',
        label: 'Borrower / Role',
        type: 'text',
        value: '',
        required: true,
      },
      {
        name: 'department',
        label: 'Department',
        type: 'select',
        options: getKnownDepartmentOptions(),
        value: normalizeDepartmentLabel(getAssetDisplayDepartment(asset || {}), { fallbackUnassigned: false }) || '',
        required: true,
      },
      {
        name: 'expectedReturnDate',
        label: 'Expected Return Date',
        type: 'date',
        required: false,
      },
      {
        name: 'reason',
        label: 'Reason',
        type: 'text',
        value: 'loaner_checkout',
        required: true,
      },
      {
        name: 'notes',
        label: 'Notes',
        type: 'textarea',
        rows: 3,
        required: false,
      },
    ],
  });
  if (!form?.confirmed) return;
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/loaner-checkout`, {
      loanedTo: form.values.loanedTo,
      expectedReturnDate: form.values.expectedReturnDate || null,
      reason: form.values.reason || 'loaner_checkout',
      notes: [form.values.notes, form.values.department ? `Department: ${form.values.department}` : ''].filter(Boolean).join(' | '),
      actor: 'inventory-ui-cmdb',
    });
    showMessage('Loaner checkout recorded.', 'success');
    await loadAssets();
    await refreshCmdbModal(assetId, 'custody');
  } catch (error) {
    showMessage(error.message || 'Failed to run loaner checkout.', 'error');
  }
};

window.cmdbLoanerReturn = async (assetId) => {
  const asset = currentAssets.find((entry) => entry.customId === assetId) || await readInventoryJson(`/assets/${encodeURIComponent(assetId)}`).catch(() => null);
  const specs = getAssetSpecs(asset || {});
  const loanerStatus = normalizeValue(specs.loanerStatus || '');
  if (!(loanerStatus === 'checkedout' || loanerStatus === 'overdue')) {
    showMessage('Loaner return is available only when the asset is currently loaned out.', 'warning');
    return;
  }
  const form = await showInventoryFormModal({
    title: 'Loaner Return',
    message: `Asset: ${asset?.name || assetId}`,
    confirmText: 'Confirm Return',
    confirmClass: 'btn-outline-dark',
    dialogClass: 'modal-md',
    fields: [
      {
        name: 'condition',
        label: 'Return Condition',
        type: 'select',
        options: ['good', 'damaged', 'missing_accessories'],
        value: 'good',
        required: true,
      },
      {
        name: 'location',
        label: 'Return Location',
        type: 'select',
        options: getKnownBuildingOptions(),
        value: getAssetDisplayLocation(asset || {}),
        required: false,
      },
      {
        name: 'notes',
        label: 'Damage / Missing Notes',
        type: 'textarea',
        rows: 3,
        required: false,
      },
    ],
  });
  if (!form?.confirmed) return;
  try {
    await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/loaner-return`, {
      location: form.values.location || null,
      notes: [form.values.condition ? `Condition: ${form.values.condition}` : '', form.values.notes].filter(Boolean).join(' | '),
      actor: 'inventory-ui-cmdb',
    });
    showMessage('Loaner return recorded.', 'success');
    await loadAssets();
    await refreshCmdbModal(assetId, 'custody');
  } catch (error) {
    showMessage(error.message || 'Failed to run loaner return.', 'error');
  }
};

window.cmdbMockWifiUpdate = async (assetId) => {
  const asset = currentAssets.find((entry) => entry.customId === assetId) || await readInventoryJson(`/assets/${encodeURIComponent(assetId)}`).catch(() => null);
  const specs = getAssetSpecs(asset || {});
  const form = await showInventoryFormModal({
    title: 'Update Last Seen Network',
    message: 'Demo-safe update. Real Wi-Fi integration is not connected.',
    confirmText: 'Save Update',
    confirmClass: 'btn-outline-secondary',
    dialogClass: 'modal-lg',
    fields: [
      {
        name: 'macAddress',
        label: 'MAC Address',
        type: 'text',
        value: specs.macAddress || '',
        required: false,
        colClass: 'col-md-6',
      },
      {
        name: 'network',
        label: 'Network / SSID',
        type: 'text',
        value: specs.lastSeenNetwork || '',
        required: false,
        colClass: 'col-md-6',
      },
      {
        name: 'accessPoint',
        label: 'Access Point',
        type: 'text',
        value: specs.lastSeenAccessPoint || '',
        required: false,
        colClass: 'col-md-6',
      },
      {
        name: 'location',
        label: 'Seen At (Location)',
        type: 'select',
        options: getKnownBuildingOptions(),
        value: specs.lastSeenLocation || '',
        required: false,
        colClass: 'col-md-6',
      },
      {
        name: 'seenAt',
        label: 'Seen At Time',
        type: 'date',
        value: specs.lastSeenTimestamp ? String(specs.lastSeenTimestamp).slice(0, 10) : new Date().toISOString().slice(0, 10),
        required: false,
        colClass: 'col-md-6',
      },
      {
        name: 'confidence',
        label: 'Confidence / Source',
        type: 'select',
        options: ['high', 'medium', 'low', 'manual_demo'],
        value: 'manual_demo',
        required: false,
        colClass: 'col-md-6',
      },
      {
        name: 'notes',
        label: 'Notes',
        type: 'textarea',
        rows: 3,
        required: false,
        colClass: 'col-12',
      },
    ],
  });
  if (!form?.confirmed) return;
  const macAddress = String(form.values.macAddress || '').trim();
  const network = String(form.values.network || '').trim();
  const accessPoint = String(form.values.accessPoint || '').trim();
  const location = String(form.values.location || '').trim();
  if (!location && !network && !accessPoint && !macAddress) {
    showMessage('No Wi-Fi update values were provided.', 'warning');
    return;
  }
  try {
    const result = await postInventoryJson(`/assets/${encodeURIComponent(assetId)}/mock-wifi-location`, {
      macAddress: macAddress || null,
      lastSeenNetwork: network || null,
      lastSeenAccessPoint: accessPoint || null,
      lastSeenLocation: location || null,
      seenAt: form.values.seenAt ? new Date(`${form.values.seenAt}T09:00:00`).toISOString() : null,
      notes: [form.values.notes || '', form.values.confidence ? `Source: ${form.values.confidence}` : ''].filter(Boolean).join(' | '),
      actor: 'inventory-ui-cmdb',
    });
    if (result?.wifiTracking?.warning) {
      showMessage(result.wifiTracking.warning, 'warning');
    } else {
      showMessage('Mock Wi-Fi location updated.', 'success');
    }
    await loadAssets();
    await refreshCmdbModal(assetId, cmdbState.activeTab || 'maintenance');
  } catch (error) {
    showMessage(error.message || 'Failed to update mock Wi-Fi location.', 'error');
  }
};

window.addSpareStockItem = async () => {
  const form = await showInventoryFormModal({
    title: 'Add Spare Stock Item',
    confirmText: 'Add Item',
    confirmClass: 'btn-primary',
    dialogClass: 'modal-lg',
    fields: [
      { name: 'partName', label: 'Part Name', type: 'text', required: true, colClass: 'col-md-6' },
      { name: 'componentType', label: 'Component Type', type: 'select', options: SPARE_STOCK_TYPES?.length ? SPARE_STOCK_TYPES : ['Spare SSD'], value: SPARE_STOCK_TYPES?.[0] || 'Spare SSD', required: true, colClass: 'col-md-6' },
      { name: 'brand', label: 'Brand', type: 'text', required: false, colClass: 'col-md-6' },
      { name: 'model', label: 'Model', type: 'text', required: false, colClass: 'col-md-6' },
      { name: 'partNumber', label: 'Part Number', type: 'text', required: false, colClass: 'col-md-6' },
      { name: 'quantityAvailable', label: 'Quantity Available', type: 'number', value: 0, min: 0, step: 1, required: true, colClass: 'col-md-6' },
      { name: 'minimumStockLevel', label: 'Minimum Stock Level', type: 'number', value: 0, min: 0, step: 1, required: true, colClass: 'col-md-6' },
      { name: 'reorderPoint', label: 'Reorder Point', type: 'number', value: 0, min: 0, step: 1, required: false, colClass: 'col-md-6' },
      { name: 'location', label: 'Location', type: 'select', options: getKnownBuildingOptions(), value: 'Central Warehouse', required: false, colClass: 'col-md-6' },
      { name: 'compatibleBrandsModels', label: 'Compatible Brands/Models', type: 'text', required: false, colClass: 'col-md-6', placeholder: 'Comma-separated' },
    ],
  });
  if (!form?.confirmed) return;
  const partName = String(form.values.partName || '').trim();
  if (!partName) return;
  const quantityAvailable = Number(form.values.quantityAvailable || 0);
  const minimumStockLevel = Number(form.values.minimumStockLevel || 0);
  const reorderPoint = Number(form.values.reorderPoint || 0);
  try {
    await postInventoryJson('/inventory/spare-stock', {
      partName,
      componentType: form.values.componentType || 'component',
      brand: form.values.brand || '',
      model: form.values.model || '',
      partNumber: form.values.partNumber || '',
      quantityAvailable: Number.isFinite(quantityAvailable) ? quantityAvailable : 0,
      minimumStockLevel: Number.isFinite(minimumStockLevel) ? minimumStockLevel : 0,
      reorderPoint: Number.isFinite(reorderPoint) ? reorderPoint : 0,
      location: form.values.location || '',
      compatibleBrandsModels: String(form.values.compatibleBrandsModels || '').split(',').map((v) => v.trim()).filter(Boolean),
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
  const form = await showInventoryFormModal({
    title: 'Edit Spare Stock Item',
    confirmText: 'Save Changes',
    confirmClass: 'btn-primary',
    dialogClass: 'modal-lg',
    fields: [
      { name: 'partName', label: 'Part Name', type: 'text', value: target.partName || '', required: true, colClass: 'col-md-6' },
      { name: 'componentType', label: 'Component Type', type: 'select', options: SPARE_STOCK_TYPES?.length ? SPARE_STOCK_TYPES : ['component'], value: target.componentType || SPARE_STOCK_TYPES?.[0] || 'component', required: true, colClass: 'col-md-6' },
      { name: 'brand', label: 'Brand', type: 'text', value: target.brand || '', required: false, colClass: 'col-md-6' },
      { name: 'model', label: 'Model', type: 'text', value: target.model || '', required: false, colClass: 'col-md-6' },
      { name: 'partNumber', label: 'Part Number', type: 'text', value: target.partNumber || '', required: false, colClass: 'col-md-6' },
      { name: 'minimumStockLevel', label: 'Minimum Stock Level', type: 'number', value: Number(target.minimumStockLevel || 0), min: 0, step: 1, required: true, colClass: 'col-md-6' },
      { name: 'location', label: 'Location', type: 'select', options: getKnownBuildingOptions(), value: target.location || '', required: false, colClass: 'col-md-6' },
    ],
  });
  if (!form?.confirmed) return;
  const partName = String(form.values.partName || '').trim();
  if (!partName) return;
  const minimumStockLevel = Number(form.values.minimumStockLevel || target.minimumStockLevel || 0);
  try {
    await postInventoryJson(`/inventory/spare-stock/${encodeURIComponent(id)}`, {
      partName,
      componentType: form.values.componentType || target.componentType,
      brand: form.values.brand || '',
      model: form.values.model || '',
      partNumber: form.values.partNumber || '',
      minimumStockLevel: Number.isFinite(minimumStockLevel) ? minimumStockLevel : target.minimumStockLevel,
      location: form.values.location || '',
    }, 'PATCH');
    showMessage('Spare stock item updated.', 'success');
    await window.loadSpareStock();
  } catch (error) {
    showMessage(error.message || 'Failed to update spare stock item.', 'error');
  }
};

window.adjustSpareStockItem = async (id) => {
  const deltaValue = await promptInventoryValue({
    title: 'Adjust Spare Stock Quantity',
    label: 'Adjustment Delta (+/- integer)',
    type: 'number',
    value: 1,
    required: true,
    validate: (value) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed === 0) {
        return 'Enter a non-zero integer.';
      }
      return '';
    },
  });
  const delta = Number(deltaValue || 0);
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

function inventoryAiStatusLabel(status) {
  const normalized = String(status || '').trim().toLowerCase();
  const map = {
    online: { text: 'Online', dotClass: '' },
    gemma: { text: 'Gemma ready', dotClass: '' },
    ready: { text: 'Gemma ready', dotClass: '' },
    deterministic_only: { text: 'Rule-based', dotClass: 'warning' },
    fallback: { text: 'Fallback mode', dotClass: 'warning' },
    disabled: { text: 'Fallback mode', dotClass: 'warning' },
    offline: { text: 'Offline', dotClass: 'error' },
    loading: { text: 'Gemma thinking', dotClass: 'warning' },
    error: { text: 'Offline', dotClass: 'error' },
  };
  return map[normalized] || map.online;
}

function setInventoryAiChatStatus(status) {
  inventoryAiChatState.status = status;
  const statusText = document.getElementById('inventoryAiChatStatusText');
  const statusDot = document.getElementById('inventoryAiChatStatusDot');
  const statusBadge = document.getElementById('inventoryAiChatStatusBadge');
  const meta = inventoryAiStatusLabel(status);
  if (statusText) statusText.textContent = meta.text;
  if (statusDot) {
    statusDot.className = 'inventory-ai-status-dot';
    if (meta.dotClass) statusDot.classList.add(meta.dotClass);
  }
  if (statusBadge) {
    const normalized = String(status || '').toLowerCase();
    statusBadge.dataset.mode = normalized === 'fallback' || normalized === 'disabled' || normalized === 'deterministic_only'
      ? 'fallback'
      : ((normalized === 'error' || normalized === 'offline') ? 'offline' : 'online');
    if (status === 'fallback') {
      statusBadge.title = 'Using rule-based fallback because Gemma is unavailable or slow.';
    } else if (normalized === 'deterministic_only') {
      statusBadge.title = 'This result is rule-based and does not require Gemma.';
    } else if (normalized === 'disabled') {
      statusBadge.title = 'LLM is disabled. Using rule-based fallback.';
    } else if (normalized === 'loading') {
      statusBadge.title = 'Gemma is processing your request.';
    } else if (status === 'error' || normalized === 'offline') {
      statusBadge.title = 'Inventory AI service is currently unreachable.';
    } else {
      statusBadge.title = 'Gemma and inventory AI service are available.';
    }
  }
  syncInventorySavedViewControl();
  renderActiveInventoryFilterChips();
}

function getInventorySavedViewMeta(view = inventorySavedView) {
  return INVENTORY_SAVED_VIEWS.find((entry) => entry.value === view) || INVENTORY_SAVED_VIEWS[0];
}

function syncInventorySavedViewControl() {
  const select = document.getElementById('inventorySavedViewSelect');
  if (!select) return;
  const allowedValues = new Set(INVENTORY_SAVED_VIEWS.map((entry) => entry.value));
  if (!allowedValues.has(inventorySavedView)) inventorySavedView = 'all';
  if (select.value !== inventorySavedView) select.value = inventorySavedView;
}

function getAssetDataQualityMissingFields(asset = {}) {
  const specs = getAssetSpecs(asset);
  const missing = [];
  if (!getDisplaySerial(asset)) missing.push('serial');
  if (!getAssetDisplayDepartment(asset) || normalizeDepartmentForFilter(getAssetDisplayDepartment(asset)) === normalizeDepartmentForFilter('Unassigned')) missing.push('department');
  const displayLoc = getAssetDisplayLocation(asset);
  if (!displayLoc || normalizeValue(displayLoc) === 'unknown' || normalizeValue(displayLoc) === 'unassigned') missing.push('location');
  if (!(asset.purchaseDate || asset.acquiredAt || specs.purchaseDate || specs.acquiredAt)) missing.push('purchase date');
  if (!(asset.warrantyEndDate || specs.warrantyEndDate || specs.warrantyEnd)) missing.push('warranty');
  return missing;
}

function isRecentlyImportedAsset(asset = {}) {
  const dateValue = asset.createdAt || asset.importedAt || getAssetSpecs(asset).importedAt || asset.updatedAt;
  const parsed = dateValue ? new Date(dateValue) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return false;
  return (Date.now() - parsed.getTime()) <= 14 * 86400000;
}

function isAssetHighRisk(asset = {}) {
  const lifecycle = normalizeLifecycleStatus(asset.lifecycleStatus || asset.lifecycle_status || asset.status || '');
  const riskLevel = String(asset.riskLevel || asset.aiRiskLevel || getAssetSpecs(asset).riskLevel || '').toLowerCase();
  const maintenanceFlag = String(asset.maintenanceStatus || getAssetSpecs(asset).maintenanceStatus || '').toLowerCase();
  return ['retired', 'disposed', 'lost_stolen', 'eol_expired', 'under_maintenance', 'pending_repair'].includes(lifecycle)
    || ['critical', 'high', 'urgent'].includes(riskLevel)
    || maintenanceFlag.includes('overdue')
    || maintenanceFlag.includes('failed');
}

function isAssetEolSoon(asset = {}) {
  const lifecycle = normalizeLifecycleStatus(asset.lifecycleStatus || asset.lifecycle_status || asset.status || '');
  if (String(lifecycle || '').includes('eol') || lifecycle === 'retired') return true;
  const eol = getEOLDetails(asset);
  return String(eol?.eolStatus || '').toLowerCase().includes('due')
    || String(eol?.eolStatus || '').toLowerCase().includes('overdue')
    || Number(eol?.daysRemaining) <= 180;
}

function hasLinkedComponentIssue(asset = {}) {
  const category = getAssetCategoryKey(asset);
  if (!['component', 'accessory', 'license', 'spare_part'].includes(category)) return false;
  const specs = getAssetSpecs(asset);
  return !asset.parentAssetId
    && !asset.parentAssetTag
    && !asset.parentAsset?.customId
    && !specs.parentAssetTag
    && !specs.installedParentId;
}

function stockItemMatchesSavedView(item = {}, view = inventorySavedView) {
  if (!view || view === 'all') return true;
  const qty = Number(item.quantityAvailable ?? item.quantity ?? 0);
  const reorder = Number(item.reorderPoint ?? item.minQuantity ?? item.minimumQuantity ?? NaN);
  if (view === 'low_stock') return Number.isFinite(reorder) ? qty <= reorder : qty <= 0;
  if (view === 'missing_data') return !item.partName || !item.location || !item.componentType;
  if (view === 'needs_review') return stockItemMatchesSavedView(item, 'low_stock') || stockItemMatchesSavedView(item, 'missing_data');
  if (view === 'recently_imported') {
    const parsed = item.receivedAt || item.createdAt || item.updatedAt ? new Date(item.receivedAt || item.createdAt || item.updatedAt) : null;
    return parsed && !Number.isNaN(parsed.getTime()) && (Date.now() - parsed.getTime()) <= 14 * 86400000;
  }
  return true;
}

function assetMatchesSavedView(asset = {}, view = inventorySavedView) {
  if (!view || view === 'all') return true;
  if (view === 'missing_data') return getAssetDataQualityMissingFields(asset).length > 0;
  if (view === 'recently_imported') return isRecentlyImportedAsset(asset);
  if (view === 'high_risk') return isAssetHighRisk(asset);
  if (view === 'eol_soon') return isAssetEolSoon(asset);
  if (view === 'unassigned') {
    const department = getAssetDisplayDepartment(asset);
    const assignedTo = asset.assignedToName || asset.assignedToUserId || asset.owner || getAssetSpecs(asset).assignedTo;
    return normalizeDepartmentForFilter(department) === normalizeDepartmentForFilter('Unassigned') || !String(assignedTo || '').trim();
  }
  if (view === 'linked_component_issues') return hasLinkedComponentIssue(asset);
  if (view === 'needs_review') {
    return getAssetDataQualityMissingFields(asset).length > 0
      || isAssetHighRisk(asset)
      || isAssetEolSoon(asset)
      || hasLinkedComponentIssue(asset);
  }
  if (view === 'low_stock') return false;
  return true;
}

function setInventorySavedView(view = 'all', options = {}) {
  const nextView = getInventorySavedViewMeta(view).value;
  inventorySavedView = nextView;
  localStorage.setItem('opsmind_inventory_saved_view', inventorySavedView);
  syncInventorySavedViewControl();
  inventoryPageState.page = 1;
  if (!options.skipLoad && inventorySavedView === 'low_stock' && currentInventoryView !== 'spare_stock') {
    setInventoryView('spare_stock');
    return;
  }
  if (!options.skipLoad && inventorySavedView === 'linked_component_issues' && currentInventoryView === 'parents') {
    setInventoryView('components');
    return;
  }
  if (options.skipLoad || currentInventoryView === 'spare_stock') {
    renderTable();
    return;
  }
  loadAssets().catch((error) => {
    showMessage(error.message || 'Failed to apply saved view.', 'error');
  });
}

function renderActiveInventoryFilterChips() {
  const el = document.getElementById('inventoryActiveFilterChips');
  if (!el) return;
  const chips = [];
  const search = String(document.getElementById('searchInput')?.value || '').trim();
  const building = document.getElementById('filterBuilding')?.value || 'all';
  const dept = document.getElementById('filterDept')?.value || 'all';
  const type = document.getElementById('filterType')?.value || 'all';
  const lifecycle = document.getElementById('filterLifecycle')?.value || 'all';
  if (inventorySavedView && inventorySavedView !== 'all') chips.push({ key: 'saved_view', label: `View: ${getInventorySavedViewMeta().label}` });
  if (search) chips.push({ key: 'search', label: `Search: ${search}` });
  if (building !== 'all') chips.push({ key: 'building', label: `Building: ${displayLocation(building)}` });
  if (dept !== 'all') chips.push({ key: 'dept', label: `Department: ${normalizeDepartmentLabel(dept)}` });
  if (type !== 'all') chips.push({ key: 'type', label: `Type: ${type}` });
  if (lifecycle !== 'all') chips.push({ key: 'lifecycle', label: `Lifecycle: ${displayLifecycleStatus(lifecycle)}` });
  el.innerHTML = chips.length
    ? chips.map((chip) => `
      <button type="button" class="inventory-filter-chip" data-inventory-clear-filter="${UI.escapeHTML(chip.key)}" aria-label="Remove ${UI.escapeHTML(chip.label)} filter">
        <span>${UI.escapeHTML(chip.label)}</span>
        <i class="bi bi-x-lg" aria-hidden="true"></i>
      </button>
    `).join('')
    : '<span class="inventory-filter-chip is-muted">No active filters</span>';
}

function clearInventoryFilterChip(key = '') {
  const filterKey = String(key || '').trim();
  if (filterKey === 'saved_view') inventorySavedView = 'all';
  if (filterKey === 'search') {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';
  }
  if (filterKey === 'building') {
    const el = document.getElementById('filterBuilding');
    if (el) el.value = 'all';
  }
  if (filterKey === 'dept') {
    const el = document.getElementById('filterDept');
    if (el) el.value = 'all';
  }
  if (filterKey === 'type') {
    const el = document.getElementById('filterType');
    if (el) el.value = 'all';
  }
  if (filterKey === 'lifecycle') {
    const el = document.getElementById('filterLifecycle');
    if (el) el.value = 'all';
  }
  localStorage.setItem('opsmind_inventory_saved_view', inventorySavedView);
  syncInventorySavedViewControl();
  syncFilters();
}

function beginCmdbAiAction(actionKey) {
  if (cmdbAiInFlightActions.has(actionKey)) {
    showMessage('This AI action is already running. Please wait for the current response.', 'info');
    return false;
  }
  cmdbAiInFlightActions.add(actionKey);
  return true;
}

function endCmdbAiAction(actionKey) {
  cmdbAiInFlightActions.delete(actionKey);
}

function startAiPanelLoading(panel, message) {
  if (!panel) return () => {};
  panel.innerHTML = `
    <div class="alert alert-secondary mb-0">
      <div class="d-flex align-items-center gap-2">
        <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
        <span data-ai-loading-text>${UI.escapeHTML(message || 'Running AI analysis...')}</span>
      </div>
    </div>
  `;
  const textEl = panel.querySelector('[data-ai-loading-text]');
  const longWaitTimer = setTimeout(() => {
    if (!textEl) return;
    textEl.textContent = 'Gemma is thinking... First response may take longer while the local model wakes up.';
  }, INVENTORY_AI_LONG_WAIT_MS);
  return () => clearTimeout(longWaitTimer);
}

function aiSourceMetaHtml(result = {}) {
  const llmUsed = Boolean(result?.llmUsed);
  const llmStatus = String(result?.llmStatus || '').trim().toLowerCase();
  const fallbackUsed = Boolean(result?.fallbackUsed);
  const fallbackReason = String(result?.fallbackReason || '').trim();
  if (llmUsed) {
    return '<div class="small text-muted mt-1"><span class="badge bg-success-subtle text-success-emphasis border">Gemma-generated</span> Inventory AI service + local Gemma reasoning.</div>';
  }
  if (llmStatus === 'deterministic_only') {
    return '<div class="small text-muted mt-1"><span class="badge bg-info-subtle text-info-emphasis border">Rule-based summary</span> This result is deterministic and does not require Gemma.</div>';
  }
  if (fallbackUsed || llmStatus === 'fallback' || llmStatus === 'offline' || llmStatus === 'disabled') {
    const reasonText = fallbackReason ? ` Reason: ${UI.escapeHTML(fallbackReason)}.` : '';
    return `<div class="small text-muted mt-1"><span class="badge bg-secondary-subtle text-secondary-emphasis border">Fallback summary</span> AI model unavailable. Showing deterministic CMDB summary.${reasonText}</div>`;
  }
  return '<div class="small text-muted mt-1"><span class="badge bg-secondary-subtle text-secondary-emphasis border">Inventory AI service</span></div>';
}

function aiSourceMetaText(result = {}) {
  const llmUsed = Boolean(result?.llmUsed);
  const llmStatus = String(result?.llmStatus || '').trim().toLowerCase();
  const fallbackUsed = Boolean(result?.fallbackUsed);
  const fallbackReason = String(result?.fallbackReason || '').trim();
  if (llmUsed) return 'Source: Gemma-generated.';
  if (llmStatus === 'deterministic_only') return 'Source: Rule-based deterministic logic.';
  if (fallbackUsed || llmStatus === 'fallback' || llmStatus === 'offline' || llmStatus === 'disabled') {
    return `Source: Deterministic fallback${fallbackReason ? ` (${fallbackReason})` : ''}.`;
  }
  return 'Source: Inventory AI service.';
}

function updateInventoryAiFloatingOffset() {
  const desktopBottom = 22;
  const mobileBottom = 16;
  document.documentElement.style.setProperty('--inventory-ai-launcher-bottom', `${desktopBottom}px`);
  document.documentElement.style.setProperty('--inventory-ai-launcher-bottom-mobile', `${mobileBottom}px`);
}

function formatInventoryAiChatTime(timeValue) {
  const time = new Date(timeValue || Date.now());
  if (Number.isNaN(time.getTime())) {
    return '';
  }
  return time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function normalizeInventoryAiSuggestions(actions = []) {
  if (!Array.isArray(actions)) return [];
  return actions
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .slice(0, 6);
}

function normalizeInventoryAiMissingData(entry = {}) {
  const direct = Array.isArray(entry?.missingData) ? entry.missingData : [];
  if (direct.length) {
    return direct.map((value) => String(value || '').trim()).filter(Boolean);
  }
  const actionResultMissing = Array.isArray(entry?.actionResult?.missingData) ? entry.actionResult.missingData : [];
  return actionResultMissing.map((value) => String(value || '').trim()).filter(Boolean);
}

function summarizeInventoryAiEvidenceReason(entry = {}) {
  const reasons = [];
  const normalizedMissing = normalizeInventoryAiMissingData(entry).map((value) => normalizeValue(value));
  if (normalizedMissing.some((value) => value.includes('telemetry'))) reasons.push('telemetry is missing');
  if (normalizedMissing.some((value) => value.includes('eol'))) reasons.push('EOL evidence is limited');
  if (normalizedMissing.some((value) => value.includes('warranty'))) reasons.push('warranty data is missing');
  if (normalizedMissing.some((value) => value.includes('purchase'))) reasons.push('purchase date is missing');
  if (normalizedMissing.some((value) => value.includes('serial'))) reasons.push('serial data is incomplete');
  if (normalizedMissing.some((value) => value.includes('history') || value.includes('lifecycle'))) reasons.push('lifecycle history is limited');
  if (!reasons.length && Number(entry?.scannedCount || 0) <= 0) reasons.push('supporting asset evidence is limited');
  return Array.from(new Set(reasons)).slice(0, 3).join(', ');
}

function updateInventoryAiPromptLayout(hasMessages = false) {
  const panel = document.getElementById('inventoryAiChatPanel');
  const promptsEl = document.getElementById('inventoryAiQuickPrompts');
  const toggleBtn = document.getElementById('inventoryAiPromptToggleBtn');
  if (!panel || !promptsEl) return;
  panel.classList.toggle('has-messages', Boolean(hasMessages));
  const autoCollapsed = Boolean(hasMessages) && !inventoryAiChatState.loading;
  const collapsed = typeof inventoryAiChatState.promptsCollapsed === 'boolean'
    ? inventoryAiChatState.promptsCollapsed
    : autoCollapsed;
  promptsEl.dataset.collapsed = collapsed ? 'true' : 'false';
  if (toggleBtn) {
    toggleBtn.textContent = collapsed ? 'Expand' : 'Collapse';
    toggleBtn.setAttribute('aria-label', collapsed ? 'Expand quick prompts' : 'Collapse quick prompts');
    toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
}

function getInventoryAiChatContext() {
  const searchValue = String(document.getElementById('searchInput')?.value || '').trim();
  const building = String(document.getElementById('filterBuilding')?.value || '').trim();
  const selectedDepartment = String(document.getElementById('filterDept')?.value || '').trim();
  const department = selectedDepartment && selectedDepartment !== 'all'
    ? toBackendDepartmentFilterValue(selectedDepartment)
    : selectedDepartment;
  const type = String(document.getElementById('filterType')?.value || '').trim();
  const lifecycleStatus = String(document.getElementById('filterLifecycle')?.value || '').trim();
  const selectedAssetId = cmdbState.assetId || historyViewState.assetId || selectedAssetCustomId || null;
  return {
    view: currentInventoryView,
    search: searchValue,
    filters: {
      building,
      department,
      type,
      lifecycleStatus,
      page: inventoryPageState.page,
      pageSize: inventoryPageState.pageSize,
    },
    selectedAssetCustomId: selectedAssetId,
  };
}

function normalizeLocationForFilter(value) {
  return normalizeValue(displayLocation(value));
}

function populateInventoryMapFilterOptions() {
  const typeSelect = document.getElementById('assetMapTypeFilter');
  const locationSelect = document.getElementById('assetMapLocationFilter');
  const departmentSelect = document.getElementById('assetMapDepartmentFilter');
  if (!typeSelect || !locationSelect || !departmentSelect) return;

  const previousType = String(typeSelect.value || 'all');
  const previousLocation = String(locationSelect.value || 'all');
  const previousDepartment = String(departmentSelect.value || 'all');
  const mapAssets = Array.isArray(inventoryMapState.allAssets) ? inventoryMapState.allAssets : [];

  const knownTypes = Array.from(new Set(
    mapAssets
      .map((asset) => String(asset.mapTypeLabel || asset.type || asset.componentType || '').trim())
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b));

  const knownLocations = new Set(getKnownBuildingOptions());
  mapAssets.forEach((asset) => {
    const label = String(asset.mapDisplayLocation || getAssetDisplayLocation(asset) || '').trim();
    if (label) knownLocations.add(label);
  });
  const sortedLocations = Array.from(knownLocations).sort((a, b) => a.localeCompare(b));

  const knownDepartments = new Set(getKnownDepartmentOptions());
  mapAssets.forEach((asset) => {
    const label = normalizeDepartmentLabel(asset.department);
    if (label) knownDepartments.add(label);
  });
  const sortedDepartments = Array.from(knownDepartments).sort((a, b) => {
    const aIndex = STANDARD_MIU_DEPARTMENTS.indexOf(a);
    const bIndex = STANDARD_MIU_DEPARTMENTS.indexOf(b);
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    return a.localeCompare(b);
  });

  typeSelect.innerHTML = `<option value="all">All Types</option>${knownTypes.map((value) => `<option value="${UI.escapeHTML(value)}">${UI.escapeHTML(value)}</option>`).join('')}`;
  locationSelect.innerHTML = `<option value="all">All Locations</option>${sortedLocations.map((value) => `<option value="${UI.escapeHTML(value)}">${UI.escapeHTML(value)}</option>`).join('')}`;
  departmentSelect.innerHTML = `<option value="all">All Departments</option>${sortedDepartments.map((value) => `<option value="${UI.escapeHTML(value)}">${UI.escapeHTML(value)}</option>`).join('')}`;

  typeSelect.value = Array.from(typeSelect.options).some((option) => option.value === previousType) ? previousType : 'all';
  locationSelect.value = Array.from(locationSelect.options).some((option) => option.value === previousLocation) ? previousLocation : 'all';
  departmentSelect.value = Array.from(departmentSelect.options).some((option) => option.value === previousDepartment) ? previousDepartment : 'all';
}

function getInventoryMapUiFilters() {
  return {
    search: String(document.getElementById('assetMapSearchInput')?.value || '').trim().toLowerCase(),
    view: inventoryMapViewToCategory(document.getElementById('assetMapViewFilter')?.value || 'all'),
    type: String(document.getElementById('assetMapTypeFilter')?.value || 'all').trim(),
    location: String(document.getElementById('assetMapLocationFilter')?.value || 'all').trim(),
    department: String(document.getElementById('assetMapDepartmentFilter')?.value || 'all').trim(),
    lifecycle: String(document.getElementById('assetMapLifecycleFilter')?.value || 'all').trim().toLowerCase(),
    telemetryOnly: Boolean(document.getElementById('assetMapTelemetryOnly')?.checked),
    nearEolOnly: Boolean(document.getElementById('assetMapNearEolOnly')?.checked),
    highRiskOnly: Boolean(document.getElementById('assetMapHighRiskOnly')?.checked),
    maintenanceOnly: Boolean(document.getElementById('assetMapMaintenanceOnly')?.checked),
  };
}

function normalizeInventoryMapAsset(asset) {
  const specs = getAssetSpecs(asset);
  const profile = getAssetProfile(asset);
  const viewType = inventoryMapViewToCategory(asset.inventoryViewType || (asset.category || 'parents'));
  const rawLocation = specs.mapLocationHint
    || specs.mapLocation
    || specs.importedLocation
    || asset.location
    || asset.installedParentLocation
    || asset.relatedParentLocation
    || asset.parentLocation
    || '';
  const locationLabel = displayLocation(rawLocation);
  const mapLocation = resolveInventoryMapLocation(locationLabel);
  const lifecycle = String(asset.lifecycleStatus || '').toLowerCase();
  const status = String(asset.status || '').toLowerCase();
  const telemetryEnabled = Boolean(
    (profile.trackWorkingHours
      || profile.hasTelemetry
      || toBoolean(profile.specs?.telemetryApplicable)
      || toBoolean(profile.specs?.telemetryEnabled)
      || toBoolean(asset.telemetryEnabledDerived)
      || toBoolean(asset.telemetryCapableDerived))
    && profile.telemetryStatus !== 'unavailable'
  );
  const riskLevel = String(specs.riskLevel || specs.risk_score_level || '').toLowerCase();
  const highRisk = riskLevel === 'high' || riskLevel === 'critical';
  const nearEol = shouldTreatMapItemAsNearEol(asset);
  const needsMaintenance = ['maintenance', 'repair'].includes(status)
    || lifecycle.includes('maintenance')
    || lifecycle.includes('repair');

  return {
    ...asset,
    mapViewType: viewType,
    mapLocationKey: mapLocation?.key || null,
    mapLocationName: mapLocation?.name || null,
    mapXPercent: mapLocation?.xPercent ?? null,
    mapYPercent: mapLocation?.yPercent ?? null,
    mapDisplayLocation: locationLabel || 'Unknown',
    mapTelemetryEnabled: telemetryEnabled,
    mapNearEol: nearEol,
    mapHighRisk: highRisk,
    mapNeedsMaintenance: needsMaintenance,
    mapRiskLevel: riskLevel || 'unknown',
    mapTelemetryStatus: String(profile.telemetryStatus || 'unavailable'),
    mapParentLabel: asset.installedParentName || asset.relatedParentName || null,
    mapTypeLabel: String(asset.componentType || asset.type || '').trim(),
    mapSerial: String(asset.serialNumber || '').trim(),
    mapTag: String(asset.assetTag || '').trim(),
    mapRawLocationValue: String(rawLocation || '').trim() || 'Unknown',
    mapMatchedAlias: mapLocation?.matchedAlias || null,
    mapMatchMethod: mapLocation?.matchMethod || null,
  };
}

function buildInventoryMapLocationStats(assets = []) {
  const rawCounts = new Map();
  const normalizedCounts = new Map();
  let unmappedCount = 0;
  assets.forEach((asset) => {
    const rawLocation = String(asset.mapRawLocationValue || asset.location || 'Unknown').trim() || 'Unknown';
    rawCounts.set(rawLocation, (rawCounts.get(rawLocation) || 0) + 1);
    if (asset.mapLocationKey) {
      const normalizedLabel = String(asset.mapLocationName || asset.mapLocationKey || 'Unknown').trim() || 'Unknown';
      normalizedCounts.set(normalizedLabel, (normalizedCounts.get(normalizedLabel) || 0) + 1);
    } else {
      unmappedCount += 1;
    }
  });
  const topRaw = Array.from(rawCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const topNormalized = Array.from(normalizedCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return {
    rawLocationCount: rawCounts.size,
    normalizedLocationCount: normalizedCounts.size,
    unmappedCount,
    topRaw,
    topNormalized,
  };
}

function assetMatchesInventoryMapFilters(asset, filters) {
  if (filters.view && filters.view !== 'all' && inventoryMapViewToCategory(asset.mapViewType) !== filters.view) return false;
  if (filters.lifecycle && filters.lifecycle !== 'all') {
    const lifecycle = String(asset.lifecycleStatus || '').trim().toLowerCase();
    if (lifecycle !== filters.lifecycle) return false;
  }
  if (filters.telemetryOnly && !asset.mapTelemetryEnabled) return false;
  if (filters.nearEolOnly && !asset.mapNearEol) return false;
  if (filters.highRiskOnly && !asset.mapHighRisk) return false;
  if (filters.maintenanceOnly && !asset.mapNeedsMaintenance) return false;

  const haystack = [
    asset.customId,
    asset.name,
    asset.mapTypeLabel,
    asset.mapDisplayLocation,
    displayLocation(asset.installedParentLocation || ''),
    displayLocation(asset.location || ''),
    getAssetDisplayDepartment(asset),
    String(asset.serialNumber || ''),
    String(asset.assetTag || ''),
    String(asset.mapParentLabel || ''),
  ].join(' ').toLowerCase();
  if (filters.search && !haystack.includes(filters.search)) return false;
  if (filters.type && filters.type !== 'all') {
    const selectedType = normalizeValue(filters.type);
    const assetType = normalizeValue(String(asset.mapTypeLabel || asset.type || asset.componentType || ''));
    if (!selectedType || assetType !== selectedType) return false;
  }
  if (filters.location && filters.location !== 'all') {
    const selectedLocation = normalizeLocationForFilter(filters.location);
    const assetLocation = normalizeLocationForFilter(asset.mapDisplayLocation || asset.mapLocationName || asset.location || '');
    if (!selectedLocation || assetLocation !== selectedLocation) return false;
  }
  if (filters.department && filters.department !== 'all') {
    const selectedDepartment = normalizeDepartmentForFilter(filters.department);
    const assetDepartment = normalizeDepartmentForFilter(asset.department || '');
    if (!selectedDepartment || assetDepartment !== selectedDepartment) return false;
  }
  return true;
}

function markerCategoryClass(category) {
  const view = inventoryMapViewToCategory(category || 'parents');
  if (view === 'components') return 'components';
  if (view === 'accessories') return 'accessories';
  if (view === 'consumables') return 'consumables';
  if (view === 'spare_stock') return 'spare_stock';
  if (view === 'licenses') return 'licenses';
  return 'parents';
}

function setInventoryMapCalibrationEnabled(enabled) {
  const next = Boolean(enabled);
  inventoryMapCalibrationState.enabled = next;
  inventoryMapCalibrationState.draggingKey = null;
  if (next && !inventoryMapCalibrationState.selectedKey) {
    inventoryMapCalibrationState.selectedKey = INVENTORY_MAP_LOCATION_DEFINITIONS[0]?.key || null;
  }
  if (!next) inventoryMapCalibrationState.selectedKey = null;
  const panel = document.getElementById('assetMapCalibrationPanel');
  const copyBtn = document.getElementById('assetMapCopyCoordsBtn');
  const toggleBtn = document.getElementById('assetMapCalibrateToggleBtn');
  if (panel) panel.classList.toggle('d-none', !next);
  if (copyBtn) copyBtn.disabled = !next;
  if (toggleBtn) toggleBtn.classList.toggle('btn-outline-warning', !next);
  if (toggleBtn) toggleBtn.classList.toggle('btn-warning', next);
  renderInventoryMapCalibrationPanel();
  window.renderInventoryMapCalibrationMarkers();
  setTimeout(() => {
    updateInventoryMapCanvasLayout();
    window.renderInventoryMapMarkers();
    window.renderInventoryMapCalibrationMarkers();
  }, 30);
}

function copyInventoryMapCalibrationJson() {
  const rows = INVENTORY_MAP_LOCATION_DEFINITIONS.map((entry) => {
    const base = getCalibrationBaseCoordinates(entry.key) || { xPercent: entry.xPercent, yPercent: entry.yPercent };
    return {
      key: entry.key,
      label: entry.name,
      xPercent: Number(base.xPercent.toFixed(2)),
      yPercent: Number(base.yPercent.toFixed(2)),
      aliases: entry.aliases || [],
    };
  });
  const payload = JSON.stringify(rows, null, 2);
  const clipboardApi = navigator.clipboard && typeof navigator.clipboard.writeText === 'function'
    ? navigator.clipboard
    : null;
  if (clipboardApi) {
    clipboardApi.writeText(payload)
      .then(() => showMessage('Map coordinates JSON copied to clipboard.', 'success'))
      .catch(async () => {
        await showInventoryTextPreviewModal({
          title: 'Map Coordinates JSON',
          message: 'Clipboard unavailable. Copy the JSON below manually.',
          text: payload,
          rows: 12,
        });
        showMessage('Clipboard unavailable. JSON opened for manual copy.', 'warning');
      });
  } else {
    showInventoryTextPreviewModal({
      title: 'Map Coordinates JSON',
      message: 'Clipboard unavailable. Copy the JSON below manually.',
      text: payload,
      rows: 12,
    }).catch(() => {});
    showMessage('Clipboard unavailable. JSON opened for manual copy.', 'warning');
  }
  console.log('[InventoryMapCalibration]', payload);
}

function renderInventoryMapCalibrationPanel() {
  const panel = document.getElementById('assetMapCalibrationPanel');
  if (!panel) return;
  if (!inventoryMapCalibrationState.enabled) {
    panel.innerHTML = 'Calibration mode is OFF.';
    return;
  }
  const selectedKey = inventoryMapCalibrationState.selectedKey || INVENTORY_MAP_LOCATION_DEFINITIONS[0]?.key || '';
  const selectedEntry = getMapLocationDefinitionByKey(selectedKey);
  const coords = selectedEntry ? (getCalibrationBaseCoordinates(selectedEntry.key) || selectedEntry) : null;
  const aliases = selectedEntry ? [selectedEntry.name, ...(selectedEntry.aliases || [])] : [];
  panel.innerHTML = `
    <div class="fw-semibold mb-1">Calibration mode is ON</div>
    <div class="small mb-1">Step 1: drag yellow markers to building centers.</div>
    <div class="small mb-1">Step 2: click <strong>Copy Coords</strong> to copy JSON in final display coordinate space.</div>
    <div class="small"><strong>Selected:</strong> ${UI.escapeHTML(selectedEntry?.name || 'None')}</div>
    <div class="small"><strong>xPercent:</strong> ${UI.escapeHTML(coords ? Number(coords.xPercent).toFixed(2) : '-')}</div>
    <div class="small"><strong>yPercent:</strong> ${UI.escapeHTML(coords ? Number(coords.yPercent).toFixed(2) : '-')}</div>
    <div class="small mt-1"><strong>Aliases:</strong> ${UI.escapeHTML(aliases.join(' â€¢ ') || '-')}</div>
  `;
}

window.renderInventoryMapCalibrationMarkers = () => {
  const layer = document.getElementById('inventoryAssetMapCalibrationMarkers');
  if (!layer) return;
  if (!inventoryMapCalibrationState.enabled) {
    layer.innerHTML = '';
    layer.style.pointerEvents = 'none';
    return;
  }
  layer.style.pointerEvents = 'auto';
  layer.innerHTML = INVENTORY_MAP_LOCATION_DEFINITIONS.map((entry) => {
    const base = getCalibrationBaseCoordinates(entry.key) || { xPercent: entry.xPercent, yPercent: entry.yPercent };
    const projected = projectInventoryMapCoordinates(base.xPercent, base.yPercent) || base;
    const draggingClass = inventoryMapCalibrationState.draggingKey === entry.key ? 'dragging' : '';
    const selectedClass = inventoryMapCalibrationState.selectedKey === entry.key ? 'active' : '';
    return `
      <div
        class="inventory-map-calibration-marker ${draggingClass} ${selectedClass}"
        data-calibration-location-key="${UI.escapeHTML(entry.key)}"
        role="button"
        tabindex="0"
        aria-label="Calibration marker for ${UI.escapeHTML(entry.name)}. Drag to reposition."
        style="left:${UI.escapeHTML(String(projected.xPercent))}%;top:${UI.escapeHTML(String(projected.yPercent))}%;"
        title="Drag to calibrate ${UI.escapeHTML(entry.name)}"
      >${UI.escapeHTML(entry.name)}</div>
    `;
  }).join('');
};

window.renderInventoryMapMarkers = () => {
  const layer = document.getElementById('inventoryAssetMapMarkers');
  if (!layer) return;
  const groups = new Map();
  inventoryMapState.filteredAssets.forEach((asset) => {
    if (!asset.mapLocationKey || asset.mapXPercent === null || asset.mapYPercent === null) return;
    if (!groups.has(asset.mapLocationKey)) {
      groups.set(asset.mapLocationKey, {
        locationKey: asset.mapLocationKey,
        locationName: asset.mapLocationName || asset.mapDisplayLocation || asset.mapLocationKey,
        xPercent: asset.mapXPercent,
        yPercent: asset.mapYPercent,
        items: [],
      });
    }
    groups.get(asset.mapLocationKey).items.push(asset);
  });
  inventoryMapState.groupedMarkers = Array.from(groups.values());
  if (!inventoryMapState.groupedMarkers.length) {
    layer.innerHTML = '<div class="small text-muted p-2">No mapped locations for the current filters.</div>';
    return;
  }
  layer.innerHTML = inventoryMapState.groupedMarkers.map((group) => {
    const first = group.items[0];
    const baseClass = markerCategoryClass(first.mapViewType);
    const statusAlert = group.items.some((item) => item.mapNeedsMaintenance) ? 'status-alert' : '';
    const riskAlert = group.items.some((item) => item.mapNearEol || item.mapHighRisk) ? 'risk-alert' : '';
    const activeClass = inventoryMapState.selectedLocationKey && inventoryMapState.selectedLocationKey === group.locationKey ? 'active' : '';
    const overrideCoords = getCalibrationBaseCoordinates(group.locationKey);
    const baseX = overrideCoords?.xPercent ?? group.xPercent;
    const baseY = overrideCoords?.yPercent ?? group.yPercent;
    const projected = projectInventoryMapCoordinates(baseX, baseY) || { xPercent: baseX, yPercent: baseY };
    return `
      <button
        type="button"
        class="inventory-map-marker ${baseClass} ${statusAlert} ${riskAlert} ${activeClass}"
        data-location-key="${UI.escapeHTML(group.locationKey)}"
        aria-label="${UI.escapeHTML(group.locationName)} marker with ${UI.escapeHTML(String(group.items.length))} asset(s). Click to view location assets."
        aria-pressed="${inventoryMapState.selectedLocationKey && inventoryMapState.selectedLocationKey === group.locationKey ? 'true' : 'false'}"
        style="left:${UI.escapeHTML(String(projected.xPercent))}%;top:${UI.escapeHTML(String(projected.yPercent))}%;"
        title="${UI.escapeHTML(group.locationName)} (${group.items.length})"
      >${UI.escapeHTML(String(group.items.length))}</button>
    `;
  }).join('');
};

window.renderInventoryMapLocationAssets = () => {
  const titleEl = document.getElementById('assetMapLocationTitle');
  const listEl = document.getElementById('assetMapLocationAssets');
  const unmappedEl = document.getElementById('assetMapUnmappedList');
  if (!titleEl || !listEl || !unmappedEl) return;

  const selectedKey = inventoryMapState.selectedLocationKey;
  const selectedMarker = inventoryMapState.groupedMarkers.find((marker) => marker.locationKey === selectedKey) || null;
  if (!selectedMarker) {
    titleEl.textContent = 'Map Summary';
    const sortedLocations = [...inventoryMapState.groupedMarkers]
      .sort((a, b) => b.items.length - a.items.length)
      .slice(0, 8);
    const total = inventoryMapState.filteredAssets.length;
    const locationStats = buildInventoryMapLocationStats(inventoryMapState.filteredAssets);
    const unmappedTotal = locationStats.unmappedCount;
    const telemetryEnabled = inventoryMapState.filteredAssets.filter((asset) => asset.mapTelemetryEnabled).length;
    const nearEol = inventoryMapState.filteredAssets.filter((asset) => asset.mapNearEol || asset.mapHighRisk).length;
    const maintenance = inventoryMapState.filteredAssets.filter((asset) => asset.mapNeedsMaintenance).length;
    const topRawHtml = locationStats.topRaw.length
      ? locationStats.topRaw.map(([name, count]) => `${UI.escapeHTML(name)} (${UI.escapeHTML(String(count))})`).join(' â€¢ ')
      : 'None';
    const topNormalizedHtml = locationStats.topNormalized.length
      ? locationStats.topNormalized.map(([name, count]) => `${UI.escapeHTML(name)} (${UI.escapeHTML(String(count))})`).join(' â€¢ ')
      : 'None';
    listEl.innerHTML = `
      <div class="inventory-map-summary-card">
        <div><strong>Total displayed:</strong> ${UI.escapeHTML(String(total))}</div>
        <div><strong>Raw locations:</strong> ${UI.escapeHTML(String(locationStats.rawLocationCount))}</div>
        <div><strong>Normalized locations:</strong> ${UI.escapeHTML(String(locationStats.normalizedLocationCount))}</div>
        <div><strong>Locations with markers:</strong> ${UI.escapeHTML(String(inventoryMapState.groupedMarkers.length))}</div>
        <div><strong>Unmapped:</strong> ${UI.escapeHTML(String(unmappedTotal))}</div>
        <div><strong>Telemetry enabled:</strong> ${UI.escapeHTML(String(telemetryEnabled))}</div>
        <div><strong>Near EOL / High risk:</strong> ${UI.escapeHTML(String(nearEol))}</div>
        <div><strong>Needs maintenance:</strong> ${UI.escapeHTML(String(maintenance))}</div>
        <div class="mt-1"><strong>Top raw locations:</strong> ${topRawHtml}</div>
        <div><strong>Top normalized locations:</strong> ${topNormalizedHtml}</div>
      </div>
      <div class="small fw-semibold mb-1">Top Locations</div>
      ${
        sortedLocations.length
          ? sortedLocations.map((entry) => `
            <div class="inventory-map-asset-card p-2">
              <div class="d-flex justify-content-between align-items-center">
                <div class="fw-semibold small">${UI.escapeHTML(entry.locationName)}</div>
                <span class="badge text-bg-primary">${UI.escapeHTML(String(entry.items.length))}</span>
              </div>
            </div>
          `).join('')
          : '<div class="small text-muted">No mapped assets for current filters.</div>'
      }
      <div class="small text-muted mt-2">Click any marker on the map to view detailed assets for that location.</div>
    `;
  } else {
    titleEl.textContent = `${selectedMarker.locationName} (${selectedMarker.items.length})`;
    const aliasEntry = INVENTORY_MAP_LOCATION_DEFINITIONS.find((entry) => entry.key === selectedMarker.locationKey);
    const acceptedAliases = aliasEntry ? [aliasEntry.name, ...(aliasEntry.aliases || [])] : [];
    const rawExamples = Array.from(
      new Set(
        selectedMarker.items
          .map((asset) => String(asset.mapRawLocationValue || asset.location || '').trim())
          .filter(Boolean)
      )
    ).slice(0, 6);
    const matchedAliases = Array.from(
      new Set(
        selectedMarker.items
          .map((asset) => String(asset.mapMatchedAlias || '').trim())
          .filter(Boolean)
      )
    ).slice(0, 6);
    const matchMethods = Array.from(
      new Set(
        selectedMarker.items
          .map((asset) => String(asset.mapMatchMethod || '').trim())
          .filter(Boolean)
      )
    ).slice(0, 6);
    listEl.innerHTML = selectedMarker.items.map((asset) => {
      const isVirtualSpare = String(asset.customId || '').startsWith('spare-stock-');
      const actionButtons = isVirtualSpare
        ? '<div class="small text-muted mt-2">Stock record (view/edit in Spare Stock workflow).</div>'
        : `
          <div class="d-flex gap-1 mt-2">
            <button type="button" class="btn btn-sm btn-outline-primary inventory-map-view-btn" data-asset-id="${UI.escapeHTML(asset.customId)}">View CMDB</button>
            <button type="button" class="btn btn-sm btn-outline-info inventory-map-transfer-btn" data-asset-id="${UI.escapeHTML(asset.customId)}">Transfer</button>
            <button type="button" class="btn btn-sm btn-outline-secondary inventory-map-history-btn" data-asset-id="${UI.escapeHTML(asset.customId)}">History</button>
          </div>
        `;
      return `
        <div class="inventory-map-asset-card">
          <div class="fw-semibold small">${UI.escapeHTML(asset.name || 'Asset')}</div>
          <div class="small text-muted">${UI.escapeHTML(asset.customId || '-')} â€¢ ${UI.escapeHTML(asset.mapViewType || asset.category || '-')}</div>
          <div class="small text-muted">${UI.escapeHTML(getAssetDisplayLocation(asset))} | ${UI.escapeHTML(getAssetDisplayDepartment(asset))}</div>
          <div class="small text-muted">${UI.escapeHTML(String(asset.lifecycleStatus || asset.status || '-'))}${asset.mapTelemetryEnabled ? ' â€¢ telemetry' : ''}${asset.mapNearEol ? ' â€¢ near EOL' : ''}${asset.mapHighRisk ? ' â€¢ high risk' : ''}</div>
          ${actionButtons}
        </div>
      `;
    }).join('');
    listEl.insertAdjacentHTML('beforeend', `
      <div class="inventory-map-summary-card mt-2">
        <div><strong>Normalized key:</strong> ${UI.escapeHTML(String(selectedMarker.locationKey || '-'))}</div>
        <div><strong>Normalized location:</strong> ${UI.escapeHTML(selectedMarker.locationName)}</div>
        <div><strong>Asset count:</strong> ${UI.escapeHTML(String(selectedMarker.items.length))}</div>
        <div class="mt-1"><strong>Accepted aliases:</strong> ${UI.escapeHTML(acceptedAliases.join(' â€¢ ') || '-')}</div>
        <div class="mt-1"><strong>Matched alias examples:</strong> ${UI.escapeHTML(matchedAliases.join(' â€¢ ') || '-')}</div>
        <div class="mt-1"><strong>Match methods:</strong> ${UI.escapeHTML(matchMethods.join(' â€¢ ') || '-')}</div>
        <div class="mt-1"><strong>Raw location examples:</strong> ${UI.escapeHTML(rawExamples.join(' â€¢ ') || '-')}</div>
      </div>
    `);
  }

  const unmapped = inventoryMapState.filteredAssets.filter((asset) => !asset.mapLocationKey);
  if (!unmapped.length) {
    unmappedEl.textContent = 'No unmapped assets.';
  } else {
    const grouped = new Map();
    unmapped.forEach((asset) => {
      const key = String(asset.mapDisplayLocation || asset.location || 'Unknown').trim() || 'Unknown';
      grouped.set(key, (grouped.get(key) || 0) + 1);
    });
    unmappedEl.innerHTML = Array.from(grouped.entries())
      .slice(0, 40)
      .map(([location, count]) => `<div>${UI.escapeHTML(location)} <span class="text-muted">(${UI.escapeHTML(String(count))})</span></div>`)
      .join('');
  }
};

window.filterInventoryMapAssets = () => {
  const filters = getInventoryMapUiFilters();
  const filtered = (inventoryMapState.allAssets || []).filter((asset) => assetMatchesInventoryMapFilters(asset, filters));
  inventoryMapState.filteredAssets = filtered;
  window.renderInventoryMapMarkers();
  window.renderInventoryMapCalibrationMarkers();
  const countsEl = document.getElementById('assetMapCountsSummary');
  if (countsEl) {
    const stats = buildInventoryMapLocationStats(filtered);
    countsEl.textContent = `Displayed: ${filtered.length} / ${inventoryMapState.allAssets.length} asset(s) â€¢ Raw locations: ${stats.rawLocationCount} â€¢ Normalized locations: ${stats.normalizedLocationCount} â€¢ Unmapped: ${stats.unmappedCount}`;
  }
  if (inventoryMapState.selectedLocationKey) {
    const stillExists = inventoryMapState.groupedMarkers.some((marker) => marker.locationKey === inventoryMapState.selectedLocationKey);
    if (!stillExists) inventoryMapState.selectedLocationKey = null;
  }
  window.renderInventoryMapLocationAssets();
};

window.loadInventoryMapAssets = async (forceReload = false) => {
  if (inventoryMapState.loading) return;
  const countsEl = document.getElementById('assetMapCountsSummary');
  const imageEl = document.getElementById('inventoryAssetMapImage');
  if (!imageEl) return;
  if (forceReload) {
    inventoryMapState.allAssets = [];
    inventoryMapState.filteredAssets = [];
    inventoryMapState.groupedMarkers = [];
    inventoryMapState.selectedLocationKey = null;
  }
  inventoryMapState.loading = true;
  if (countsEl) countsEl.textContent = 'Loading map assets...';
  try {
    const pages = [];
    let page = 1;
    let totalPages = 1;
    do {
      const payload = await readInventoryJson(`/assets?paginate=true&page=${page}&pageSize=${INVENTORY_MAP_DEFAULT_PAGE_SIZE}`);
      const items = Array.isArray(payload?.items) ? payload.items : [];
      pages.push(...items);
      totalPages = Number(payload?.totalPages || 1);
      page += 1;
    } while (page <= totalPages);
    let spareStockRows = [];
    try {
      const sparePayload = await readInventoryJson('/inventory/spare-stock');
      spareStockRows = Array.isArray(sparePayload?.items) ? sparePayload.items : [];
    } catch (_spareErr) {
      spareStockRows = [];
    }
    const spareAsAssets = spareStockRows.map((row) => ({
      customId: `spare-stock-${row.id}`,
      name: row.partName,
      category: 'spare_part',
      type: row.componentType || 'component',
      status: 'ACTIVE',
      lifecycleStatus: 'IN_STOCK',
      location: row.location || 'Central Warehouse',
      department: 'UNASSIGNED',
      assetTag: null,
      serialNumber: null,
      componentType: row.componentType || null,
      stockQuantity: Number(row.quantityAvailable ?? 0),
      reorderPoint: Number(row.reorderPoint ?? row.minimumStockLevel ?? 0),
      minimumStockLevel: Number(row.minimumStockLevel ?? 0),
      specifications: {
        quantityAvailable: Number(row.quantityAvailable ?? 0),
        minimumStockLevel: Number(row.minimumStockLevel ?? 0),
        reorderPoint: Number(row.reorderPoint ?? row.minimumStockLevel ?? 0),
      },
      inventoryViewType: 'spare_stock',
    }));
    inventoryMapState.allAssets = [...pages, ...spareAsAssets].map((asset) => normalizeInventoryMapAsset(asset));
    populateInventoryMapFilterOptions();
    inventoryMapState.mapImageReady = true;
    inventoryMapState.mapImageMissing = false;
    updateInventoryMapCanvasLayout();
    window.filterInventoryMapAssets();
  } catch (error) {
    inventoryMapState.mapImageReady = false;
    if (countsEl) countsEl.textContent = 'Could not load map assets.';
    showMessage(error.message || 'Failed to load inventory map assets.', 'error');
  } finally {
    inventoryMapState.loading = false;
  }
};

window.openInventoryAssetMap = async () => {
  const modalEl = document.getElementById('inventoryAssetMapModal');
  const mapImageEl = document.getElementById('inventoryAssetMapImage');
  if (!modalEl || !mapImageEl) return;
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
  setTimeout(() => {
    updateInventoryMapCanvasLayout();
    window.renderInventoryMapMarkers();
  }, 60);
  try {
    if (!mapImageEl.complete || !mapImageEl.naturalWidth) {
      await new Promise((resolve, reject) => {
        const onLoad = () => {
          mapImageEl.removeEventListener('load', onLoad);
          mapImageEl.removeEventListener('error', onError);
          resolve(true);
        };
        const onError = () => {
          mapImageEl.removeEventListener('load', onLoad);
          mapImageEl.removeEventListener('error', onError);
          reject(new Error('Campus map image could not be loaded from /assets/images/miu-campus-map.png'));
        };
        mapImageEl.addEventListener('load', onLoad, { once: true });
        mapImageEl.addEventListener('error', onError, { once: true });
      });
    }
  } catch (error) {
    const countsEl = document.getElementById('assetMapCountsSummary');
    if (countsEl) countsEl.textContent = String(error.message || 'Campus map image is missing.');
    showMessage(String(error.message || 'Campus map image is missing.'), 'error');
    return;
  }
  updateInventoryMapCanvasLayout();
  await window.loadInventoryMapAssets(!inventoryMapState.allAssets.length);
};

function renderInventoryAiMatchedItems(items = []) {
  if (!Array.isArray(items) || !items.length) return '';
  const visibleItems = items.slice(0, 4);
  const hiddenItems = items.slice(4, 12);
  const renderItems = (list = []) => list.map((item) => `
    <div class="inventory-ai-chat-match">
      <div class="d-flex justify-content-between align-items-start gap-2">
        <div>
          <div class="fw-semibold small"><i class="bi bi-box-seam me-1"></i>${UI.escapeHTML(item.name || item.assetName || 'Asset')}</div>
          <div class="small text-muted">Asset Tag: ${UI.escapeHTML(item.assetTag || item.assetId || item.customId || '-')}</div>
          <div class="small text-muted">${UI.escapeHTML(item.category || item.type || '-')} | ${UI.escapeHTML(item.location || '-')} | ${UI.escapeHTML(item.department || '-')}</div>
          <div class="small text-muted">Status: ${UI.escapeHTML(item.status || item.lifecycleStatus || '-')}</div>
          ${item.reason ? `<div class="small mt-1">${UI.escapeHTML(item.reason)}</div>` : ''}
        </div>
        ${(item.assetId || item.customId) ? `
          <div class="d-flex flex-column gap-1">
            <button type="button" class="btn btn-sm btn-outline-primary inventory-ai-view-asset-btn" data-asset-id="${UI.escapeHTML(item.assetId || item.customId)}">Open CMDB</button>
            <button type="button" class="btn btn-sm btn-outline-secondary inventory-ai-view-components-btn" data-asset-id="${UI.escapeHTML(item.assetId || item.customId)}">View Components</button>
            <button type="button" class="btn btn-sm btn-outline-secondary inventory-ai-health-asset-btn" data-asset-id="${UI.escapeHTML(item.assetId || item.customId)}">Generate Health Summary</button>
            <button type="button" class="btn btn-sm btn-outline-secondary inventory-ai-view-lifecycle-btn" data-asset-id="${UI.escapeHTML(item.assetId || item.customId)}">View Lifecycle Events</button>
          </div>
        ` : ''}
      </div>
    </div>
  `).join('');
  return `
    <div class="mt-2">
      <div class="small text-muted mb-1"><strong>Matched items</strong></div>
      ${renderItems(visibleItems)}
      ${hiddenItems.length ? `
        <details class="mt-2">
          <summary class="small text-primary">Show more results (${hiddenItems.length})</summary>
          <div class="mt-1">
            ${renderItems(hiddenItems)}
          </div>
        </details>
      ` : ''}
    </div>
  `;
}

function normalizeInventoryAiConfidenceLabel(value) {
  const label = String(value || '').trim().toLowerCase();
  if (label === 'high' || label === 'medium' || label === 'low') return label;
  return 'low';
}

function resolveInventoryAiEntryConfidence(entry = {}) {
  const base = normalizeInventoryAiConfidenceLabel(entry.confidence);
  const intent = String(entry.intent || '').trim().toLowerCase();
  const dataScope = String(entry.dataScope || '').trim().toLowerCase();
  const scannedCount = Number(entry.scannedCount || 0);
  const missingCount = Number.isFinite(Number(entry.missingCount)) ? Number(entry.missingCount) : null;
  if (
    (intent === 'missing_serial' || intent === 'missing_serials')
    && dataScope === 'full_inventory'
    && scannedCount > 0
    && missingCount === 0
  ) {
    return 'high';
  }
  return base;
}

function renderInventoryAiActionCard(entry = {}) {
  const mode = String(entry.routedAction || '').trim().toLowerCase();
  const result = entry.actionResult && typeof entry.actionResult === 'object' ? entry.actionResult : null;
  if (!mode || !result) return '';

  if (mode === 'monthly_report') {
    const metrics = result.metrics && typeof result.metrics === 'object' ? result.metrics : {};
    const recommendations = Array.isArray(result.recommendations) ? result.recommendations.slice(0, 8) : [];
    const sections = Array.isArray(result.sections) ? result.sections.slice(0, 6) : [];
    const reportText = [
      `Title: ${result.reportTitle || result.report_title || 'Monthly Inventory Report'}`,
      `Range: ${result.dateRange || result.date_range || '-'}`,
      `Summary: ${result.executiveSummary || result.executive_summary || entry.text || '-'}`,
      `Recommendations: ${recommendations.join(' | ') || '-'}`,
    ].join('\n');
    const encodedReport = encodeURIComponent(reportText);
    return `
      <div class="inventory-ai-chat-match mt-2">
        <div class="d-flex justify-content-between align-items-start gap-2">
          <div>
            <div class="fw-semibold small">Monthly Inventory Report</div>
            <div class="small text-muted">${UI.escapeHTML(String(result.reportTitle || result.report_title || '-'))}</div>
          </div>
          <button type="button" class="btn btn-sm btn-outline-secondary inventory-ai-copy-report-btn" data-report-encoded="${UI.escapeHTML(encodedReport)}">Copy</button>
        </div>
        <div class="small mt-2">${UI.escapeHTML(String(result.executiveSummary || result.executive_summary || entry.text || '-'))}</div>
        <div class="small text-muted mt-2">Range: ${UI.escapeHTML(String(result.dateRange || result.date_range || '-'))}</div>
        <div class="small mt-2">
          <strong>Metrics:</strong>
          <div class="mt-1">
            Total Assets: ${UI.escapeHTML(String(metrics.totalAssets ?? '-'))} â€¢
            High Risk: ${UI.escapeHTML(String(metrics.highRiskAssets ?? '-'))} â€¢
            Near EOL: ${UI.escapeHTML(String(metrics.nearEolAssets ?? '-'))} â€¢
            Expiring Licenses: ${UI.escapeHTML(String(metrics.expiringLicenses ?? '-'))}
          </div>
        </div>
        ${sections.length ? `<div class="small mt-2"><strong>Sections:</strong> ${UI.escapeHTML(sections.map((item) => item.title || item.key).join(' | '))}</div>` : ''}
        ${recommendations.length ? `<div class="small mt-2"><strong>Recommendations:</strong> ${UI.escapeHTML(recommendations.join(' | '))}</div>` : ''}
      </div>
    `;
  }

  if (mode === 'daily_brief') {
    const metrics = result.metrics && typeof result.metrics === 'object' ? result.metrics : {};
    const highlights = Array.isArray(result.highlights) ? result.highlights.slice(0, 8) : [];
    const risks = Array.isArray(result.risks) ? result.risks.slice(0, 8) : [];
    const actions = Array.isArray(result.recommendedActions) ? result.recommendedActions.slice(0, 8) : [];
    const briefText = [
      `Title: ${result.title || 'Inventory Daily Brief'}`,
      `Range: ${result.dateRange || '-'}`,
      `Summary: ${result.summary || entry.text || '-'}`,
      `Highlights: ${highlights.join(' | ') || '-'}`,
    ].join('\n');
    const encodedBrief = encodeURIComponent(briefText);
    return `
      <div class="inventory-ai-chat-match mt-2">
        <div class="d-flex justify-content-between align-items-start gap-2">
          <div>
            <div class="fw-semibold small">Inventory Daily Brief</div>
            <div class="small text-muted">${UI.escapeHTML(String(result.dateRange || '-'))}</div>
          </div>
          <button type="button" class="btn btn-sm btn-outline-secondary inventory-ai-copy-report-btn" data-report-encoded="${UI.escapeHTML(encodedBrief)}">Copy</button>
        </div>
        <div class="small mt-2">${UI.escapeHTML(String(result.summary || entry.text || '-'))}</div>
        <div class="small text-muted mt-2">Transfers: ${UI.escapeHTML(String(metrics.transfers ?? 0))} â€¢ Maintenance: ${UI.escapeHTML(String(metrics.maintenanceEvents ?? 0))} â€¢ Audit: ${UI.escapeHTML(String(metrics.auditEvents ?? 0))}</div>
        ${highlights.length ? `<div class="small mt-2"><strong>Highlights:</strong> ${UI.escapeHTML(highlights.join(' | '))}</div>` : ''}
        ${risks.length ? `<div class="small mt-2"><strong>Risks:</strong> ${UI.escapeHTML(risks.join(' | '))}</div>` : ''}
        ${actions.length ? `<div class="small mt-2"><strong>Actions:</strong> ${UI.escapeHTML(actions.join(' | '))}</div>` : ''}
      </div>
    `;
  }

  if (mode === 'executive_dashboard') {
    const byCategory = result.assetsByCategory && typeof result.assetsByCategory === 'object' ? result.assetsByCategory : {};
    const byLocation = result.assetsByLocation && typeof result.assetsByLocation === 'object' ? result.assetsByLocation : {};
    const recommendations = Array.isArray(result.recommendations) ? result.recommendations.slice(0, 8) : [];
    return `
      <div class="inventory-ai-chat-match mt-2">
        <div class="fw-semibold small">Executive Inventory Dashboard</div>
        <div class="small text-muted mt-1">Total Assets: ${UI.escapeHTML(String(result.totalAssets ?? 0))} â€¢ High Risk: ${UI.escapeHTML(String(result.highRisk ?? 0))} â€¢ Near EOL: ${UI.escapeHTML(String(result.nearEol ?? 0))}</div>
        <div class="small text-muted mt-1">Low Stock: ${UI.escapeHTML(String(result.lowStock ?? 0))} â€¢ Maintenance Issues: ${UI.escapeHTML(String(result.openMaintenanceIssues ?? 0))} â€¢ Recent Transfers: ${UI.escapeHTML(String(result.recentTransfers ?? 0))}</div>
        <div class="small mt-2"><strong>Categories:</strong> ${UI.escapeHTML(Object.entries(byCategory).map(([k, v]) => `${k}: ${v}`).join(' | ') || '-')}</div>
        <div class="small mt-2"><strong>Locations:</strong> ${UI.escapeHTML(Object.entries(byLocation).slice(0, 8).map(([k, v]) => `${k}: ${v}`).join(' | ') || '-')}</div>
        ${recommendations.length ? `<div class="small mt-2"><strong>Recommendations:</strong> ${UI.escapeHTML(recommendations.join(' | '))}</div>` : ''}
      </div>
    `;
  }

  if (mode === 'digital_twin') {
    const asset = result.asset || {};
    const risk = result.riskScore || {};
    const kit = result.kitHealth || {};
    const related = result.relatedCounts || {};
    const openIssues = Array.isArray(result.openIssues) ? result.openIssues.slice(0, 8) : [];
    return `
      <div class="inventory-ai-chat-match mt-2">
        <div class="fw-semibold small">Digital Twin: ${UI.escapeHTML(String(asset.name || asset.customId || '-'))}</div>
        <div class="small text-muted mt-1">${UI.escapeHTML(String(asset.customId || '-'))} â€¢ ${UI.escapeHTML(String(asset.type || '-'))} â€¢ ${UI.escapeHTML(String(result.currentLocation || '-'))}</div>
        <div class="small mt-2">Health Score: ${UI.escapeHTML(String(result.healthScore ?? '-'))} â€¢ Risk: ${UI.escapeHTML(String(risk.riskLevel || '-'))} (${UI.escapeHTML(String(risk.riskScore ?? '-'))})</div>
        <div class="small mt-1">Kit Health: ${UI.escapeHTML(String(kit.label || kit.status || '-'))} â€¢ EOL: ${UI.escapeHTML(String(result.eolStatus?.status || '-'))} â€¢ Warranty: ${UI.escapeHTML(String(result.warrantyStatus?.status || '-'))}</div>
        <div class="small mt-1">Related: Components ${UI.escapeHTML(String(related.components ?? 0))} â€¢ Accessories ${UI.escapeHTML(String(related.accessories ?? 0))} â€¢ Licenses ${UI.escapeHTML(String(related.licenses ?? 0))}</div>
        ${openIssues.length ? `<div class="small mt-2"><strong>Open Issues:</strong> ${UI.escapeHTML(openIssues.join(' | '))}</div>` : ''}
        ${result.recommendedAction ? `<div class="small mt-2"><strong>Recommended Action:</strong> ${UI.escapeHTML(String(result.recommendedAction))}</div>` : ''}
      </div>
    `;
  }

  if (mode === 'black_box_timeline') {
    const allEvents = Array.isArray(result.events) ? result.events : [];
    const events = allEvents.slice(0, 12);
    const grouped = allEvents.reduce((acc, event) => {
      const key = String(event?.eventGroup || 'all');
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return `
      <div class="inventory-ai-chat-match mt-2">
        <div class="fw-semibold small">Black Box Timeline</div>
        <div class="small text-muted mt-1">Total Events: ${UI.escapeHTML(String(result.totalEvents ?? events.length))} â€¢ Returned: ${UI.escapeHTML(String(result.returnedEvents ?? events.length))}</div>
        <div class="small mt-2"><strong>Groups:</strong> ${UI.escapeHTML(Object.entries(grouped).map(([k, v]) => `${k}: ${v}`).join(' | ') || '-')}</div>
        <div class="small mt-2">
          ${events.map((event) => `${event.timestamp ? UI.formatDateTime(event.timestamp) : '-'} â€¢ ${event.label || event.eventType || 'Event'}`).join('<br>') || 'No events.'}
        </div>
      </div>
    `;
  }

  if (mode === 'plan_action') {
    const affected = Array.isArray(result.affectedItems) ? result.affectedItems.length : 0;
    const proposed = Array.isArray(result.proposedChanges) ? result.proposedChanges.length : 0;
    const risks = Array.isArray(result.risks) ? result.risks.slice(0, 6) : [];
    return `
      <div class="inventory-ai-chat-match mt-2">
        <div class="fw-semibold small">Action Plan (Review Before Execute)</div>
        <div class="small text-muted mt-1">${UI.escapeHTML(String(result.summary || entry.text || '-'))}</div>
        <div class="small mt-2">Affected Items: ${UI.escapeHTML(String(affected))} â€¢ Proposed Changes: ${UI.escapeHTML(String(proposed))}</div>
        ${risks.length ? `<div class="small mt-2"><strong>Risks:</strong> ${UI.escapeHTML(risks.join(' | '))}</div>` : ''}
      </div>
    `;
  }

  if (mode === 'demo_guide') {
    return `
      <div class="inventory-ai-chat-match mt-2 inventory-ai-demo-guide-card">
        <div class="fw-semibold small">Thesis Demo Walkthrough</div>
        <div class="small text-muted mt-1">Read-only guide. It navigates and explains; it does not create, approve, receive, or delete records.</div>
        <div class="inventory-ai-quick-action-grid mt-2">
          <button type="button" class="btn btn-sm btn-outline-primary inventory-ai-open-page-btn" data-ai-open-page="/pages/inventory-command-center.html">Open Command Center</button>
          <button type="button" class="btn btn-sm btn-outline-primary inventory-ai-open-page-btn" data-ai-open-page="/pages/procurement.html">Open Procurement</button>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-ai-prompt="Give me the daily briefing.">Daily Briefing</button>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-ai-prompt="Classify inventory by ABC.">ABC</button>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-ai-prompt="Explain FIFO recommendation.">FIFO</button>
        </div>
      </div>
    `;
  }

  return '';
}

function renderInventoryAiChatMessages() {
  const container = document.getElementById('inventoryAiChatMessages');
  const sendBtn = document.getElementById('inventoryAiChatSendBtn');
  const input = document.getElementById('inventoryAiChatInput');
  if (!container) return;
  const messages = inventoryAiChatState.messages || [];
  updateInventoryAiPromptLayout(messages.length > 0);
  const emptyState = `
    <div class="inventory-ai-chat-empty">
      <div class="inventory-ai-chat-empty-title"><i class="bi bi-stars me-1"></i>Inventory Copilot Ready</div>
      <div class="inventory-ai-chat-empty-sub">Ask me about assets, missing data, procurement, EOL risk, maintenance, or CMDB health.</div>
      <div class="inventory-ai-empty-prompts mt-2">
        <button type="button" class="btn btn-sm btn-outline-primary" data-ai-prompt="Summarize the health of UXKIT Main CS Desktop PC 001">Summarize asset health</button>
        <button type="button" class="btn btn-sm btn-outline-primary" data-ai-prompt="Explain Inventory 360 and what I should do next.">Explain Inventory 360</button>
        <button type="button" class="btn btn-sm btn-outline-primary" data-ai-prompt="Explain Procurement 360 and the next best procurement action.">Explain Procurement 360</button>
        <button type="button" class="btn btn-sm btn-outline-primary" data-ai-prompt="What is the cost impact across inventory and procurement? Use real cost evidence only.">Cost impact</button>
        <button type="button" class="btn btn-sm btn-outline-primary" data-ai-prompt="What data is missing from Inventory 360 and Request 360?">Missing data</button>
        <button type="button" class="btn btn-sm btn-outline-primary" data-ai-prompt="Which assets need maintenance?">Maintenance priorities</button>
        <button type="button" class="btn btn-sm btn-outline-primary" data-ai-prompt="What should we buy next?">What should we buy next?</button>
        <button type="button" class="btn btn-sm btn-outline-primary" data-ai-prompt="Classify inventory by ABC.">Classify by ABC</button>
        <button type="button" class="btn btn-sm btn-outline-primary" data-ai-prompt="Calculate EOQ for toner.">Calculate EOQ</button>
        <button type="button" class="btn btn-sm btn-outline-primary" data-ai-prompt="Compare EOQ and MOQ for projector lamps.">Compare EOQ vs MOQ</button>
        <button type="button" class="btn btn-sm btn-outline-primary" data-ai-prompt="Which stock should be issued first?">FIFO issue priority</button>
        <button type="button" class="btn btn-sm btn-outline-primary" data-ai-prompt="Find possible duplicate assets.">Find duplicate assets</button>
        <button type="button" class="btn btn-sm btn-outline-primary" data-ai-prompt="Generate monthly inventory report">Monthly report</button>
      </div>
    </div>
  `;
  const rows = messages.map((entry) => {
    const role = entry.role === 'user' ? 'user' : 'assistant';
    const isAssistant = role === 'assistant';
    const resolvedConfidence = isAssistant ? resolveInventoryAiEntryConfidence(entry) : null;
    const evidenceReason = isAssistant ? summarizeInventoryAiEvidenceReason(entry) : '';
    const metaPills = [];
    if (isAssistant) {
      if (entry.llmUsed) {
        metaPills.push('<span class="inventory-ai-chat-pill is-success">Gemma</span>');
        metaPills.push('<span class="inventory-ai-chat-pill is-success">AI-generated</span>');
        metaPills.push('<span class="inventory-ai-chat-pill is-info">Fallback: No</span>');
      }
      if (entry.fallbackUsed) {
        metaPills.push('<span class="inventory-ai-chat-pill is-warning">Fallback</span>');
      }
      if (String(entry.llmStatus || '').toLowerCase() === 'deterministic_only') {
        metaPills.push('<span class="inventory-ai-chat-pill is-info">Deterministic</span>');
      }
      if (resolvedConfidence) {
        metaPills.push(`<span class="inventory-ai-chat-pill">Evidence confidence: ${UI.escapeHTML(capitalize(String(resolvedConfidence)))}</span>`);
      }
      if (resolvedConfidence === 'low') {
        metaPills.push('<span class="inventory-ai-chat-pill is-warning">Data quality: Limited</span>');
      }
      if (entry.sourceLabel) {
        metaPills.push(`<span class="inventory-ai-chat-pill">Source: ${UI.escapeHTML(String(entry.sourceLabel).replace(/_/g, ' '))}</span>`);
      }
      if (entry.dataScope) {
        const scopeLabel = String(entry.dataScope) === 'filtered_view' ? 'Scope: current filtered view' : 'Scope: full inventory';
        metaPills.push(`<span class="inventory-ai-chat-pill">${UI.escapeHTML(scopeLabel)}</span>`);
      }
      if (Number.isFinite(Number(entry.scannedCount)) && Number(entry.scannedCount) > 0) {
        metaPills.push(`<span class="inventory-ai-chat-pill">Scanned: ${UI.escapeHTML(String(entry.scannedCount))}</span>`);
      }
      if (entry.missingCount !== null && entry.missingCount !== undefined && Number.isFinite(Number(entry.missingCount)) && Number(entry.missingCount) >= 0) {
        metaPills.push(`<span class="inventory-ai-chat-pill">Missing serials: ${UI.escapeHTML(String(entry.missingCount))}</span>`);
      }
      if (Array.isArray(entry.excludedCategories) && entry.excludedCategories.length) {
        metaPills.push(`<span class="inventory-ai-chat-pill">Excluded: ${UI.escapeHTML(entry.excludedCategories.join(', '))}</span>`);
      }
      if (entry.intent) {
        metaPills.push(`<span class="inventory-ai-chat-pill">Intent: ${UI.escapeHTML(String(entry.intent))}</span>`);
      }
      if (entry.routedAction) {
        metaPills.push(`<span class="inventory-ai-chat-pill">Routed: ${UI.escapeHTML(String(entry.routedAction))}</span>`);
      }
      if (entry.actionLabel) metaPills.push(`<span class="inventory-ai-chat-pill">${UI.escapeHTML(entry.actionLabel)}</span>`);
      if (entry.matchedAssetName || entry.matchedAssetTag) {
        const matchLabel = entry.matchedAssetTag
          ? `${String(entry.matchedAssetName || 'Matched asset')} (${String(entry.matchedAssetTag)})`
          : String(entry.matchedAssetName);
        metaPills.push(`<span class="inventory-ai-chat-pill is-match">Matched asset: ${UI.escapeHTML(matchLabel)}</span>`);
      }
      if (entry.matchMethod) {
        metaPills.push(`<span class="inventory-ai-chat-pill">Match: ${UI.escapeHTML(String(entry.matchMethod).replace(/_/g, ' '))}</span>`);
      }
      if (entry.extractedAssetQuery) {
        metaPills.push(`<span class="inventory-ai-chat-pill">Query: ${UI.escapeHTML(String(entry.extractedAssetQuery))}</span>`);
      }
    }
    const suggestionItems = isAssistant ? normalizeInventoryAiSuggestions(entry.suggestedActions) : [];
    const suggestionPills = suggestionItems
      .map((action) => `<span class="inventory-ai-chat-pill">${UI.escapeHTML(action)}</span>`)
      .join('');
    const senderLabel = role === 'user' ? 'You' : 'Inventory AI';
    const senderIcon = role === 'user' ? 'bi-person-fill' : 'bi-robot';
    const timestamp = formatInventoryAiChatTime(entry.createdAt);
    const timestampHtml = timestamp ? `<span class="ms-auto">${timestamp}</span>` : '';
    const matchedItemsHtml = isAssistant ? renderInventoryAiMatchedItems(entry.matchedItems || []) : '';
    const actionCardHtml = isAssistant ? renderInventoryAiActionCard(entry) : '';
    const evidenceHelpHtml = isAssistant && resolvedConfidence === 'low' && !entry.fallbackUsed
      ? `
        <details class="mt-2">
          <summary class="small text-primary">Why is evidence confidence low?</summary>
          <div class="small text-muted mt-1">
            ${UI.escapeHTML(
              evidenceReason
                ? `Low evidence confidence because ${evidenceReason}. This is not a Gemma failure.`
                : 'This answer used Gemma, but supporting asset evidence is limited.'
            )}
          </div>
          <div class="small text-muted mt-1">Improve this by adding purchase/warranty dates, telemetry readings, and maintenance history.</div>
        </details>
      `
      : '';
    const fallbackCardHtml = isAssistant && entry.fallbackUsed
      ? `
        <div class="inventory-ai-chat-fallback mt-2">
          <div class="fw-semibold small">Fallback summary</div>
          <div class="small mt-1">AI model unavailable for this response. Showing deterministic output.</div>
          ${entry.fallbackReason ? `<div class="small mt-1 text-muted">Reason: ${UI.escapeHTML(String(entry.fallbackReason).replace(/_/g, ' '))}</div>` : ''}
        </div>
      `
      : '';
    return `
      <div class="inventory-ai-chat-msg ${role}">
        <div class="inventory-ai-msg-head"><i class="bi ${senderIcon}"></i><span>${senderLabel}</span>${timestampHtml}</div>
        <div class="inventory-ai-chat-answer">${role === 'assistant' ? '<strong>Answer:</strong> ' : ''}${UI.escapeHTML(String(entry.text || ''))}</div>
        ${(metaPills.length || suggestionPills || matchedItemsHtml || fallbackCardHtml) ? `
          <div class="inventory-ai-chat-meta">
            ${metaPills.length ? `<div>${metaPills.join('')}</div>` : ''}
            ${suggestionPills ? `<div class="mt-1"><strong>Suggested Actions:</strong><div class="mt-1">${suggestionPills}</div></div>` : ''}
            ${evidenceHelpHtml}
            ${fallbackCardHtml}
            ${matchedItemsHtml}
            ${actionCardHtml}
          </div>
        ` : (actionCardHtml ? `<div class="inventory-ai-chat-meta">${actionCardHtml}</div>` : '')}
      </div>
    `;
  }).join('');
  const loadingElapsed = inventoryAiChatState.loadingSince ? (Date.now() - Number(inventoryAiChatState.loadingSince)) : 0;
  const loadingText = loadingElapsed >= INVENTORY_AI_LONG_WAIT_MS
    ? 'Gemma is thinking... First response may take longer while the local model wakes up.'
    : 'Gemma is analyzing inventory data...';
  const loadingRow = inventoryAiChatState.loading
    ? `
      <div class="inventory-ai-chat-msg assistant inventory-ai-chat-loading">
        <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
        <span>${UI.escapeHTML(loadingText)}</span>
      </div>
    `
    : '';
  container.innerHTML = (rows || emptyState) + loadingRow;
  if (sendBtn) sendBtn.disabled = inventoryAiChatState.loading;
  if (input) input.disabled = inventoryAiChatState.loading;
  container.scrollTop = container.scrollHeight;
}

function ensureInventoryAiWelcomeMessage() {
  if (inventoryAiChatState.messages.length) return;
  inventoryAiChatState.messages.push({
    role: 'assistant',
    text: 'Ask me about inventory status, stock health, maintenance priorities, duplicates, EOL risk, or import quality.',
    confidence: '',
    fallbackUsed: false,
    createdAt: Date.now(),
  });
}

window.toggleInventoryAiChat = (forceState = null) => {
  const panel = document.getElementById('inventoryAiChatPanel');
  const launcher = document.getElementById('inventoryAiChatLauncher');
  if (!panel || !launcher) return;
  const nextOpen = typeof forceState === 'boolean' ? forceState : !inventoryAiChatState.open;
  inventoryAiChatState.open = nextOpen;
  panel.classList.toggle('is-open', nextOpen);
  launcher.classList.toggle('d-none', nextOpen);
  if (nextOpen) {
    ensureInventoryAiWelcomeMessage();
    renderInventoryAiChatMessages();
    setInventoryAiChatStatus(inventoryAiChatState.status || 'gemma');
    const input = document.getElementById('inventoryAiChatInput');
    if (input) input.focus();
  }
};

window.openInventoryAiChatWithPrompt = async (prompt) => {
  const value = String(prompt || '').trim();
  if (!value) return;
  window.toggleInventoryAiChat(true);
  const input = document.getElementById('inventoryAiChatInput');
  if (input) input.value = value;
  await window.sendInventoryAiChatMessage();
};

function detectInventoryAiActionFromMessage(queryText) {
  const q = String(queryText || '')
    .toLowerCase()
    .replace(/[â€™â€˜`Â´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (!q) return null;
  const has = (...phrases) => phrases.some((phrase) => q.includes(phrase));

  if (
    /(?:what changed|show changes|daily brief|today(?:'s)? inventory brief|inventory changes this week)/.test(q)
    || has('what changed today', "today's inventory brief", 'show inventory changes this week', 'daily brief', 'give me the daily briefing')
  ) return 'daily_brief';
  if (
    /(?:generate|create|give|show|build).*(?:monthly).*(?:inventory|asset).*(?:report|summary)/.test(q)
    || has('monthly inventory report', 'monthly asset report', 'inventory monthly summary', "this month's inventory report")
  ) return 'monthly_report';
  if (
    /(?:executive dashboard|management summary|executive summary).*(?:inventory|asset)/.test(q)
    || has('show executive dashboard', 'generate executive inventory dashboard summary', 'inventory management summary', 'inventory command center', 'command center summary', 'what needs attention today', 'show inventory risks', 'which buildings are highest risk', 'which building is highest risk')
  ) return 'executive_dashboard';
  if (has('prepare my thesis demo steps', 'thesis demo steps', 'prepare demo steps', 'demo walkthrough')) return 'demo_guide';
  if (has('digital twin', 'asset digital twin', 'show digital twin for this asset')) return 'digital_twin';
  if (has('black box timeline', 'blackbox timeline', 'show black box timeline for this asset', 'asset timeline')) return 'black_box_timeline';
  if ((has('missing serial', 'without serial', 'missing data', 'data quality')) && !has('ticket')) return 'missing_data';
  if (has('license') && has('expire', 'expiring', 'expiry', 'renew')) return 'search';
  if (has('low stock', 'stock forecast', 'spare stock forecast')) return 'spare_stock_forecast';
  if (has('tech exchange', 'reallocation', 're-allocate', 'reuse before buy', 'internal transfer suggestion')) return 'reallocation';
  if (has('buy next', 'what should we buy', 'procurement', 'purchase next', 'which procurement requests need approval', 'urgent procurement priorities', 'why is this item recommended', 'show urgent procurement priorities')) return 'procurement';
  if (has('abc analysis', 'classify inventory by abc', 'a items', 'b items', 'c items')) return 'abc_analysis';
  if (has('eoq', 'economic order quantity', 'moq', 'minimum order quantity')) return 'eoq_moq';
  if (has('fifo', 'issued first', 'oldest batch', 'stock should be issued first', 'explain fifo recommendation')) return 'fifo_batches';
  if (has('budget impact', 'exceed budget', 'budget review', 'finance status')) return 'finance_summary';
  if (has('best quote', 'vendor quote', 'quote comparison', 'best supplier', 'compare vendor quotes')) return 'quote_comparison';
  if (has('dead stock', 'obsolete stock')) return 'fifo_batches';
  if (has('shortage risk', 'risk of shortage')) return 'spare_stock_forecast';
  if (has('duplicate assets', 'duplicate serial', 'duplicate asset tag', 'find duplicates')) return 'duplicates';
  if (has('need maintenance', 'maintenance recommendation', 'maintenance priorities')) return 'maintenance';
  if (has('near eol', 'end of life', 'replacement priority', 'replace first')) return 'replacement_priority';
  if (has('risk score', 'risk scores', 'high risk assets', 'critical assets')) return 'risk_scores';
  if (has('suggest relationships', 'relationship suggestions', 'build relationships')) return 'relationship_suggestions';
  if ((has('draft ticket', 'create ticket', 'ticket draft')) && !has('transfer')) return 'ticket_draft';
  if (has('transfer all', 'move all', 'assign all', 'plan transfer')) return 'plan_action';
  if (has('show assets named', 'find assets named', 'search assets')) return 'search';
  return null;
}

function inventoryAiEndpointForMode(mode, context = {}) {
  const selectedId = String(context?.selectedAssetCustomId || cmdbState.assetId || selectedAssetCustomId || '').trim();
  const map = {
    assistant: '/inventory/ai/assistant',
    search: '/inventory/ai/search',
    missing_data: '/inventory/ai/missing-data',
    data_corrections: '/inventory/ai/data-corrections',
    risk_scores: '/inventory/ai/risk-score',
    replacement_priority: '/inventory/ai/replacement-priority',
    spare_stock_forecast: '/inventory/ai/spare-stock-forecast',
    reallocation: '/inventory/ai/reallocation-suggestions',
    maintenance: '/inventory/ai/maintenance-recommendations',
    procurement: '/inventory/ai/procurement-recommendations',
    abc_analysis: '/inventory/procurement/abc-analysis',
    eoq_moq: '/inventory/procurement/eoq-moq',
    fifo_batches: '/inventory/procurement/fifo/batches?itemKind=spare_stock',
    finance_summary: '/inventory/procurement/finance/summary',
    quote_comparison: '/inventory/procurement/board?status=all',
    duplicates: '/inventory/ai/duplicate-detection',
    relationship_suggestions: '/inventory/ai/relationship-suggestions',
    ticket_draft: '/inventory/ai/ticket-draft',
    daily_brief: '/inventory/ai/daily-brief',
    monthly_report: '/inventory/ai/monthly-report',
    executive_dashboard: '/inventory/executive-dashboard',
    plan_action: '/inventory/ai/plan-action',
    demo_guide: '',
  };
  if (mode === 'digital_twin') {
    return selectedId ? `/assets/${encodeURIComponent(selectedId)}/digital-twin` : '';
  }
  if (mode === 'black_box_timeline') {
    return selectedId ? `/assets/${encodeURIComponent(selectedId)}/black-box-timeline?includeRelated=true` : '';
  }
  return map[mode] || map.assistant;
}

window.runInventoryAiQuickAction = async (mode, queryOverride = '') => {
  const actionMode = String(mode || '').trim();
  if (!actionMode || inventoryAiChatState.loading) return;
  window.toggleInventoryAiChat(true);
  inventoryAiChatState.loading = true;
  inventoryAiChatState.loadingSince = Date.now();
  setInventoryAiChatStatus('loading');
  renderInventoryAiChatMessages();
  try {
    const context = getInventoryAiChatContext();
    if (actionMode === 'demo_guide') {
      inventoryAiChatState.messages.push({
        role: 'assistant',
        text: 'Here is a safe thesis demo path: start in Inventory Command Center, show evidence-driven priorities, open Asset 360/CMDB, ask the Copilot for a daily briefing, review procurement recommendations, create a request only after review, compare vendor quotes, create a PO, receive stock with impact preview, then finish with ABC, EOQ/MOQ, FIFO, Finance, Suppliers, and reports.',
        confidence: 'high',
        fallbackUsed: false,
        missingData: [],
        matchedItems: [],
        suggestedActions: [
          'Open Command Center',
          'Open Procurement',
          'Show AI Daily Briefing',
          'Show ABC / EOQ / FIFO',
          'No data changes happen unless you confirm a workflow.',
        ],
        actionLabel: 'Thesis demo guide',
        createdAt: Date.now(),
        dataScope: 'deterministic_guide',
        llmUsed: false,
        llmStatus: 'deterministic_only',
        sourceLabel: 'Deterministic',
        intent: 'demo_guide',
        routedAction: 'demo_guide',
        routedEndpoint: 'frontend_local',
        actionResult: { mode: 'demo_guide' },
      });
      setInventoryAiChatStatus('deterministic_only');
      return;
    }
    const endpoint = inventoryAiEndpointForMode(actionMode, context);
    if (!endpoint) {
      throw new Error('Select/open an asset first, then run this action.');
    }
    const needsQuery = actionMode === 'search' || actionMode === 'plan_action' || actionMode === 'ticket_draft';
    const query = needsQuery
      ? (String(queryOverride || '').trim()
        || String(document.getElementById('inventoryAiChatInput')?.value || '').trim()
        || (actionMode === 'plan_action'
          ? 'Transfer all selected lab PCs to the target location'
          : (actionMode === 'ticket_draft'
            ? 'Draft maintenance ticket for high-risk inventory issue'
            : `important inventory risks in ${context.view}`)))
      : '';
    const payload = {
      context,
      currentView: context.view,
      search: context.search,
      filters: context.filters,
      selectedAssetCustomId: context.selectedAssetCustomId,
    };
    if (needsQuery) payload.query = query;
    if (actionMode === 'ticket_draft') {
      payload.issue = query;
      if (context.selectedAssetCustomId) payload.assetId = context.selectedAssetCustomId;
    }
    if (actionMode === 'monthly_report') {
      const now = new Date();
      payload.month = now.getMonth() + 1;
      payload.year = now.getFullYear();
    }
    const usesGet = actionMode === 'executive_dashboard' || actionMode === 'digital_twin' || actionMode === 'black_box_timeline';
    let result;
    if (usesGet) {
      let query = '';
      if (actionMode === 'executive_dashboard') {
        const params = new URLSearchParams();
        if (payload?.filters?.department && payload.filters.department !== 'all') params.set('department', toBackendDepartmentFilterValue(payload.filters.department));
        if (payload?.filters?.building && payload.filters.building !== 'all') params.set('location', payload.filters.building);
        if (payload?.filters?.type && payload.filters.type !== 'all') params.set('type', payload.filters.type);
        query = params.toString() ? `?${params.toString()}` : '';
      }
      result = await readInventoryJson(`${endpoint}${query}`);
    } else {
      result = await postInventoryJson(endpoint, payload);
    }
    const response = buildChatResponseFromMode(actionMode, result || {});
    inventoryAiChatState.messages.push({
      role: 'assistant',
      text: response.text,
      confidence: response.confidence,
      fallbackUsed: response.fallbackUsed,
      missingData: Array.isArray(response.missingData) ? response.missingData : [],
      matchedItems: response.matchedItems || [],
      suggestedActions: response.suggestedActions || [],
      actionLabel: inventoryAiQuickActionLabel(actionMode),
      createdAt: Date.now(),
      dataScope: response.dataScope || null,
      llmUsed: Boolean(response.llmUsed),
      llmStatus: String(response.llmStatus || ''),
      fallbackReason: String(response.fallbackReason || ''),
      sourceLabel: String(response.sourceLabel || ''),
      intent: String(result?.intent || actionMode),
      routedAction: actionMode,
      routedEndpoint: endpoint,
      actionResult: result || null,
    });
    setInventoryAiChatStatus(
      response.llmStatus
      || (response.fallbackUsed ? 'fallback' : 'gemma')
    );
  } catch (error) {
    inventoryAiChatState.messages.push({
      role: 'assistant',
      text: 'I could not reach the Inventory AI service for that action. You can still use regular filters/search and try again in a moment.',
      confidence: 'low',
      fallbackUsed: true,
      actionLabel: inventoryAiQuickActionLabel(actionMode),
      createdAt: Date.now(),
    });
    setInventoryAiChatStatus('error');
    showMessage(error.message || 'Inventory AI action failed.', 'error');
  } finally {
    inventoryAiChatState.loading = false;
    inventoryAiChatState.loadingSince = null;
    renderInventoryAiChatMessages();
  }
};

window.openInventoryAiMatchedAsset = async (customId) => {
  const assetId = String(customId || '').trim();
  if (!assetId) return;
  try {
    window.toggleInventoryAiChat(false);
    await window.openAssetCmdb(assetId);
  } catch (_error) {
    showMessage('Could not open asset details from AI result.', 'warning');
  }
};

window.openInventoryAiMatchedAssetTab = async (customId, tab = 'components') => {
  const assetId = String(customId || '').trim();
  const tabKey = String(tab || 'components').trim() || 'components';
  if (!assetId) return;
  try {
    await refreshCmdbModal(assetId, tabKey);
  } catch (_error) {
    showMessage('Could not open the requested CMDB tab.', 'warning');
  }
};

window.runInventoryAiMatchedAssetHealth = async (customId) => {
  const assetId = String(customId || '').trim();
  if (!assetId) return;
  try {
    await window.openAssetCmdb(assetId);
    setTimeout(() => {
      if (typeof window.cmdbAiHealthSummary === 'function') {
        window.cmdbAiHealthSummary(assetId);
      }
    }, 120);
  } catch (_error) {
    showMessage('Could not open AI health summary for the matched asset.', 'warning');
  }
};

window.sendInventoryAiChatMessage = async () => {
  if (inventoryAiChatState.loading) return;
  const input = document.getElementById('inventoryAiChatInput');
  const message = String(input?.value || '').trim();
  if (!message) return;
  inventoryAiChatState.messages.push({ role: 'user', text: message, createdAt: Date.now() });
  if (input) input.value = '';
  inventoryAiChatState.loading = true;
  inventoryAiChatState.loadingSince = Date.now();
  setInventoryAiChatStatus('loading');
  renderInventoryAiChatMessages();

  try {
    const detectedAction = detectInventoryAiActionFromMessage(message);
    if (detectedAction && detectedAction !== 'assistant') {
      inventoryAiChatState.loading = false;
      inventoryAiChatState.loadingSince = null;
      renderInventoryAiChatMessages();
      await window.runInventoryAiQuickAction(detectedAction, message);
      return;
    }
    const context = getInventoryAiChatContext();
    const recentMessages = (inventoryAiChatState.messages || [])
      .slice(-8)
      .map((entry) => ({
        role: entry.role === 'user' ? 'user' : 'assistant',
        text: String(entry.text || ''),
        createdAt: entry.createdAt || Date.now(),
      }));
    const payload = {
      query: message,
      message,
      context,
      recentMessages,
      currentView: context.view,
      search: context.search,
      filters: context.filters,
      selectedAssetCustomId: context.selectedAssetCustomId,
    };
    const result = await postInventoryJson('/inventory/ai/assistant', payload);
    const answer = String(result?.answer || 'No assistant answer returned.');
    inventoryAiChatState.messages.push({
      role: 'assistant',
      text: answer,
      confidence: String(result?.confidence || 'low'),
      fallbackUsed: Boolean(result?.fallbackUsed),
      missingData: Array.isArray(result?.missingData) ? result.missingData : [],
      intent: String(result?.intent || ''),
      scannedCount: Number(result?.scannedCount || 0),
      missingCount: result?.missingCount ?? null,
      excludedCategories: Array.isArray(result?.excludedCategories) ? result.excludedCategories : [],
      matchedItems: Array.isArray(result?.matchedItems) ? result.matchedItems : [],
      suggestedActions: normalizeInventoryAiSuggestions(result?.suggestedActions),
      actionLabel: 'Inventory AI assistant',
      createdAt: Date.now(),
      dataScope: String(result?.dataScope || ''),
      llmUsed: Boolean(result?.llmUsed),
      llmStatus: String(result?.llmStatus || ''),
      fallbackReason: String(result?.fallbackReason || ''),
      sourceLabel: String(result?.sourceLabel || ''),
      routedAction: String(result?.routedAction || ''),
      routedEndpoint: String(result?.routedEndpoint || ''),
      actionResult: result?.actionResult || null,
      extractedAssetQuery: String(result?.extractedAssetQuery || ''),
      matchedAssetId: String(result?.matchedAssetId || ''),
      matchedAssetTag: String(result?.matchedAssetTag || ''),
      matchedAssetName: String(result?.matchedAssetName || ''),
      matchMethod: String(result?.matchMethod || ''),
      searchedBy: Array.isArray(result?.searchedBy) ? result.searchedBy : [],
    });
    setInventoryAiChatStatus(
      String(result?.llmStatus || '')
      || (result?.fallbackUsed ? 'fallback' : 'gemma')
    );
  } catch (error) {
    inventoryAiChatState.messages.push({
      role: 'assistant',
      text: 'I could not reach the Inventory AI service. You can still use filters/search, or try again.',
      confidence: 'low',
      fallbackUsed: true,
      createdAt: Date.now(),
    });
    setInventoryAiChatStatus('error');
    showMessage(error.message || 'Inventory AI assistant request failed.', 'error');
  } finally {
    inventoryAiChatState.loading = false;
    inventoryAiChatState.loadingSince = null;
    renderInventoryAiChatMessages();
  }
};

function renderInventoryAiResult(payload) {
  const mode = inventoryAiState.mode;
  const resultEl = document.getElementById('inventoryAiResult');
  if (!resultEl) return;
  const confidence = String(payload?.confidence || 'low');
  const badgeClass = confidence === 'high' ? 'bg-success' : confidence === 'medium' ? 'bg-warning text-dark' : 'bg-danger';
  const summary = UI.escapeHTML(String(payload?.summary || payload?.answer || 'Completed.'));

  if (mode === 'assistant' || mode === 'search') {
    const items = Array.isArray(payload?.matchedItems || payload?.results) ? (payload.matchedItems || payload.results) : [];
    const rows = items.slice(0, 40).map((item) => `
      <tr>
        <td>${UI.escapeHTML(item.assetId || '-')}</td>
        <td>${UI.escapeHTML(item.name || '-')}</td>
        <td>${UI.escapeHTML(item.type || '-')}</td>
        <td>${UI.escapeHTML(item.location || '-')}</td>
        <td>${UI.escapeHTML(item.department || '-')}</td>
        <td>${UI.escapeHTML(item.reason || '-')}</td>
      </tr>
    `).join('');
    resultEl.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <strong>AI Result</strong>
        <span class="badge ${badgeClass}">${UI.escapeHTML(confidence.toUpperCase())}</span>
      </div>
      <div class="mb-2">${summary}</div>
      <div class="small text-muted mb-2">Filters: ${UI.escapeHTML(JSON.stringify(payload?.filtersUsed || payload?.interpretedFilters || {}))}</div>
      <div class="table-responsive"><table class="table table-sm"><thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Location</th><th>Department</th><th>Reason</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="text-muted">No matched items.</td></tr>'}</tbody></table></div>
      <div class="small text-muted mt-2">Suggested actions: ${UI.escapeHTML((payload?.suggestedActions || []).join(' | ') || '-')}</div>
    `;
    return;
  }

  if (mode === 'missing_data') {
    const rows = Array.isArray(payload?.assetsWithIssues) ? payload.assetsWithIssues.slice(0, 80) : [];
    resultEl.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <strong>Data Quality Summary</strong>
        <span class="badge ${badgeClass}">${UI.escapeHTML(confidence.toUpperCase())}</span>
      </div>
      <div class="mb-2">${summary}</div>
      <div class="small mb-2">Total Issues: <strong>${UI.escapeHTML(String(payload?.totalIssues ?? 0))}</strong> | Critical: <strong>${UI.escapeHTML(String(payload?.criticalIssues ?? 0))}</strong></div>
      <div class="table-responsive"><table class="table table-sm"><thead><tr><th>Severity</th><th>Issue</th><th>Asset</th><th>Message</th></tr></thead><tbody>
      ${rows.map((row) => `<tr><td>${UI.escapeHTML(row.severity || '-')}</td><td>${UI.escapeHTML(row.issue || '-')}</td><td>${UI.escapeHTML(`${row.assetName || ''} (${row.assetId || '-'})`)}</td><td>${UI.escapeHTML(row.message || '-')}</td></tr>`).join('') || '<tr><td colspan="4" class="text-muted">No issues.</td></tr>'}
      </tbody></table></div>
      <div class="small text-muted mt-2">Recommendations: ${UI.escapeHTML((payload?.recommendations || []).join(' | ') || '-')}</div>
    `;
    return;
  }

  if (mode === 'maintenance' || mode === 'procurement' || mode === 'reallocation') {
    const rows = mode === 'maintenance'
      ? (Array.isArray(payload?.recommendations) ? payload.recommendations.slice(0, 80) : [])
      : (mode === 'procurement'
        ? (Array.isArray(payload?.recommendedPurchases) ? payload.recommendedPurchases.slice(0, 80) : [])
        : (Array.isArray(payload?.suggestions) ? payload.suggestions.slice(0, 80) : []));
    const isProcurement = mode === 'procurement';
    const isReallocation = mode === 'reallocation';
    resultEl.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <strong>${isProcurement ? 'Procurement' : (isReallocation ? 'Reallocation / Tech Exchange' : 'Maintenance')} Recommendations</strong>
        <span class="badge ${badgeClass}">${UI.escapeHTML(confidence.toUpperCase())}</span>
      </div>
      <div class="mb-2">${summary}</div>
      <div class="table-responsive"><table class="table table-sm"><thead><tr>
      ${
        isProcurement
          ? '<th>Item</th><th>Type</th><th>Qty</th><th>Priority</th><th>Reason</th>'
          : (isReallocation
            ? '<th>Available Asset</th><th>Need</th><th>Source</th><th>Destination</th><th>Reason</th>'
            : '<th>Asset</th><th>Priority</th><th>Action</th><th>Due</th><th>Reason</th>')
      }
      </tr></thead><tbody>
      ${rows.map((row) => isProcurement
        ? `<tr><td>${UI.escapeHTML(row.itemName || '-')}</td><td>${UI.escapeHTML(row.type || '-')}</td><td>${UI.escapeHTML(String(row.recommendedQuantity ?? '-'))}</td><td>${UI.escapeHTML(row.priority || '-')}</td><td>${UI.escapeHTML(row.reason || '-')}</td></tr>`
        : (isReallocation
          ? `<tr><td>${UI.escapeHTML(`${row.availableAssetName || '-'} (${row.availableAssetId || '-'})`)}</td><td>${UI.escapeHTML(row.requestedNeed || '-')}</td><td>${UI.escapeHTML(row.sourceLocation || '-')}</td><td>${UI.escapeHTML(row.suggestedDestination || '-')}</td><td>${UI.escapeHTML(row.reason || '-')}</td></tr>`
          : `<tr><td>${UI.escapeHTML(`${row.assetName || '-'} (${row.assetId || '-'})`)}</td><td>${UI.escapeHTML(row.priority || '-')}</td><td>${UI.escapeHTML(row.recommendedAction || '-')}</td><td>${UI.escapeHTML(row.dueDateSuggestion || '-')}</td><td>${UI.escapeHTML(row.reason || '-')}</td></tr>`)
      ).join('') || `<tr><td colspan="5" class="text-muted">No recommendations.</td></tr>`}
      </tbody></table></div>
    `;
    return;
  }

  if (mode === 'duplicates') {
    const groups = Array.isArray(payload?.duplicateGroups) ? payload.duplicateGroups.slice(0, 40) : [];
    resultEl.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <strong>Duplicate Detection</strong>
        <span class="badge ${badgeClass}">${UI.escapeHTML(confidence.toUpperCase())}</span>
      </div>
      <div class="mb-2">${summary}</div>
      <div class="table-responsive"><table class="table table-sm"><thead><tr><th>Severity</th><th>Reason</th><th>Assets</th><th>Action</th></tr></thead><tbody>
      ${groups.map((group) => `<tr><td>${UI.escapeHTML(group.severity || '-')}</td><td>${UI.escapeHTML(group.reason || '-')}</td><td>${UI.escapeHTML((group.assets || []).map((asset) => asset.assetId).join(', ') || '-')}</td><td>${UI.escapeHTML(group.recommendedAction || '-')}</td></tr>`).join('') || '<tr><td colspan="4" class="text-muted">No duplicate groups.</td></tr>'}
      </tbody></table></div>
      <div class="small text-muted mt-2">Embedding support: ${UI.escapeHTML(payload?.embeddingSupport?.enabled ? `${payload.embeddingSupport.provider}:${payload.embeddingSupport.model}` : 'fallback deterministic only')}</div>
    `;
    return;
  }

  resultEl.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-2">
      <strong>Inventory AI Result</strong>
      <span class="badge ${badgeClass}">${UI.escapeHTML(confidence.toUpperCase())}</span>
    </div>
    <pre class="mb-0 small">${UI.escapeHTML(JSON.stringify(payload, null, 2))}</pre>
  `;
}

function inventoryAiQuickActionLabel(mode) {
  const map = {
    search: 'AI inventory search result',
    missing_data: 'Data quality check completed',
    data_corrections: 'Data correction suggestions ready',
    risk_scores: 'Risk score analysis completed',
    replacement_priority: 'Replacement priority ranking ready',
    spare_stock_forecast: 'Spare stock forecast completed',
    reallocation: 'AI reallocation suggestions ready',
    maintenance: 'Maintenance recommendations ready',
    procurement: 'Procurement recommendations ready',
    abc_analysis: 'ABC analysis ready',
    eoq_moq: 'EOQ/MOQ analysis ready',
    fifo_batches: 'FIFO batch visibility ready',
    finance_summary: 'Finance summary ready',
    quote_comparison: 'Quote comparison context ready',
    duplicates: 'Duplicate detection completed',
    relationship_suggestions: 'Relationship suggestions generated',
    ticket_draft: 'Inventory ticket draft prepared',
    daily_brief: 'Daily inventory brief generated',
    monthly_report: 'Monthly inventory report generated',
    executive_dashboard: 'Executive dashboard summary generated',
    digital_twin: 'Digital Twin loaded',
    black_box_timeline: 'Black Box Timeline loaded',
    plan_action: 'Natural language action plan ready',
    demo_guide: 'Thesis demo guide ready',
  };
  return map[mode] || 'Inventory AI action completed';
}

function buildChatResponseFromMode(mode, payload) {
  const confidence = String(payload?.confidence || 'low');
  const baseMeta = {
    confidence,
    fallbackUsed: Boolean(payload?.fallbackUsed),
    dataScope: payload?.dataScope || null,
    llmUsed: Boolean(payload?.llmUsed),
    llmStatus: String(payload?.llmStatus || ''),
    fallbackReason: String(payload?.fallbackReason || ''),
    sourceLabel: String(payload?.sourceLabel || ''),
    missingData: Array.isArray(payload?.missingData)
      ? payload.missingData
      : (Array.isArray(payload?.missing_data) ? payload.missing_data : []),
  };
  if (mode === 'missing_data') {
    return {
      ...baseMeta,
      text: String(payload?.summary || inventoryAiQuickActionLabel(mode)),
      matchedItems: Array.isArray(payload?.assetsWithIssues)
        ? payload.assetsWithIssues.slice(0, 10).map((item) => ({
          assetId: item.assetId,
          name: item.assetName || item.assetId || 'Asset',
          category: item.severity || 'Issue',
          type: item.issue || 'Data Quality',
          location: '-',
          status: item.message || '-',
        }))
        : [],
      suggestedActions: Array.isArray(payload?.recommendations) ? payload.recommendations : [],
    };
  }

  if (mode === 'data_corrections') {
    return {
      ...baseMeta,
      text: String(payload?.summary || inventoryAiQuickActionLabel(mode)),
      matchedItems: Array.isArray(payload?.suggestions)
        ? payload.suggestions.slice(0, 10).map((item) => ({
          assetId: item.assetId,
          name: item.assetName || item.assetId || 'Asset',
          category: item.severity || 'Issue',
          type: item.issueType || 'Data Correction',
          location: '-',
          status: item.reason || item.currentValue || '-',
        }))
        : [],
      suggestedActions: Array.isArray(payload?.suggestedActions)
        ? payload.suggestedActions
        : ['Review and apply only safe corrections with confirmation.'],
    };
  }

  if (mode === 'risk_scores') {
    return {
      ...baseMeta,
      text: String(payload?.summary || inventoryAiQuickActionLabel(mode)),
      matchedItems: Array.isArray(payload?.riskScores)
        ? payload.riskScores.slice(0, 10).map((item) => ({
          assetId: item.assetId,
          name: item.assetName || item.assetId || 'Asset',
          category: item.riskLevel || 'Risk',
          type: `Score ${item.riskScore ?? '-'}`,
          location: '-',
          status: Array.isArray(item.reasons) ? item.reasons.slice(0, 2).join(' | ') : '-',
        }))
        : [],
      suggestedActions: Array.isArray(payload?.suggestedActions)
        ? payload.suggestedActions
        : ['Prioritize high-risk assets for maintenance and replacement planning.'],
    };
  }

  if (mode === 'replacement_priority') {
    return {
      ...baseMeta,
      text: String(payload?.summary || inventoryAiQuickActionLabel(mode)),
      matchedItems: Array.isArray(payload?.rankedItems)
        ? payload.rankedItems.slice(0, 10).map((item) => ({
          assetId: item.assetId,
          name: item.assetName || item.itemName || item.assetId || 'Asset',
          category: item.priority || item.urgency || 'Priority',
          type: item.itemType || 'Replacement',
          location: '-',
          status: item.reason || '-',
        }))
        : [],
      suggestedActions: Array.isArray(payload?.suggestedActions)
        ? payload.suggestedActions
        : ['Start with top-ranked items and validate budget/stock constraints.'],
    };
  }

  if (mode === 'spare_stock_forecast') {
    return {
      ...baseMeta,
      text: String(payload?.summary || inventoryAiQuickActionLabel(mode)),
      matchedItems: Array.isArray(payload?.forecasts)
        ? payload.forecasts.slice(0, 10).map((item) => ({
          assetId: item.itemName || '-',
          name: item.itemName || 'Spare Stock Item',
          category: item.componentType || 'Spare Stock',
          type: `Current ${item.currentQuantity ?? '-'} -> Recommended ${item.recommendedQuantity ?? '-'}`,
          location: '-',
          status: item.reason || '-',
        }))
        : [],
      suggestedActions: Array.isArray(payload?.suggestedActions)
        ? payload.suggestedActions
        : ['Raise reorder requests for forecasted low-stock gaps.'],
    };
  }

  if (mode === 'reallocation') {
    return {
      ...baseMeta,
      text: String(payload?.summary || inventoryAiQuickActionLabel(mode)),
      matchedItems: Array.isArray(payload?.suggestions)
        ? payload.suggestions.slice(0, 10).map((item) => ({
          assetId: item.availableAssetId || '-',
          name: item.availableAssetName || 'Available Asset',
          category: 'Tech Exchange',
          type: item.requestedNeed || '-',
          location: item.sourceLocation || '-',
          status: item.reason || '-',
        }))
        : [],
      suggestedActions: ['Review and confirm transfer manually. No auto-transfer is performed.'],
    };
  }

  if (mode === 'maintenance') {
    return {
      ...baseMeta,
      text: String(payload?.summary || inventoryAiQuickActionLabel(mode)),
      matchedItems: Array.isArray(payload?.recommendations)
        ? payload.recommendations.slice(0, 10).map((item) => ({
          assetId: item.assetId,
          name: item.assetName || item.assetId || 'Asset',
          category: item.priority || 'Maintenance',
          type: 'Maintenance',
          location: item.dueDateSuggestion || '-',
          status: item.reason || '-',
        }))
        : [],
      suggestedActions: Array.isArray(payload?.recommendations)
        ? payload.recommendations.slice(0, 6).map((item) => String(item.recommendedAction || '').trim()).filter(Boolean)
        : [],
    };
  }

  if (mode === 'procurement') {
    return {
      ...baseMeta,
      text: String(payload?.summary || inventoryAiQuickActionLabel(mode)),
      matchedItems: Array.isArray(payload?.recommendedPurchases)
        ? payload.recommendedPurchases.slice(0, 10).map((item) => ({
          assetId: item.itemName || '-',
          name: item.itemName || 'Inventory Item',
          category: item.type || 'Procurement',
          type: item.priority || '-',
          location: '-',
          status: `Qty ${item.recommendedQuantity ?? '-'}${item.reason ? ` â€¢ ${item.reason}` : ''}`,
        }))
        : [],
      suggestedActions: Array.isArray(payload?.recommendedPurchases)
        ? payload.recommendedPurchases.slice(0, 6).map((item) => `Buy ${item.recommendedQuantity ?? '?'} ${item.itemName || 'item'}`)
        : [],
    };
  }

  if (mode === 'abc_analysis') {
    return {
      ...baseMeta,
      text: String(payload?.summary || inventoryAiQuickActionLabel(mode)),
      matchedItems: Array.isArray(payload?.rows)
        ? payload.rows.slice(0, 10).map((row) => ({
          assetId: row.itemId || '-',
          name: row.itemName || 'Item',
          category: `ABC ${row.abcClass || '-'}`,
          type: row.category || '-',
          location: row.location || '-',
          status: row.reason || '-',
        }))
        : [],
      suggestedActions: ['Prioritize A-class items for strict control and procurement review.'],
    };
  }

  if (mode === 'eoq_moq') {
    return {
      ...baseMeta,
      text: String(payload?.summary || inventoryAiQuickActionLabel(mode)),
      matchedItems: Array.isArray(payload?.rows)
        ? payload.rows.slice(0, 10).map((row) => ({
          assetId: row.stockItemId || '-',
          name: row.itemName || 'Stock Item',
          category: row.dataQuality || 'EOQ',
          type: `EOQ ${row.eoq ?? '-'} / MOQ ${row.moq ?? '-'}`,
          location: '-',
          status: row.warning || row.reason || '-',
        }))
        : [],
      suggestedActions: ['Fill D/S/H inputs for items with missing EOQ data before final quantity decisions.'],
    };
  }

  if (mode === 'fifo_batches') {
    return {
      ...baseMeta,
      text: String(payload?.summary || inventoryAiQuickActionLabel(mode)),
      matchedItems: Array.isArray(payload?.rows)
        ? payload.rows.slice(0, 10).map((row) => ({
          assetId: row.id || '-',
          name: row.itemName || 'Batch Item',
          category: 'FIFO Batch',
          type: row.batchCode || row.id || '-',
          location: row.location || '-',
          status: `Received ${row.receivedAt ? UI.formatDateTime(row.receivedAt) : '-'} | Available ${row.quantityAvailable ?? '-'}`,
        }))
        : [],
      suggestedActions: ['Issue oldest FIFO batches first. Use override only with documented reason.'],
    };
  }

  if (mode === 'finance_summary') {
    return {
      ...baseMeta,
      text: String(payload?.summary || inventoryAiQuickActionLabel(mode)),
      matchedItems: Array.isArray(payload?.overBudgetRequests)
        ? payload.overBudgetRequests.slice(0, 10).map((row) => ({
          assetId: row.requestNumber || '-',
          name: row.title || 'Procurement Request',
          category: row.financeStatus || 'Finance',
          type: `Est. ${row.estimatedBudget ?? '-'} / Avail. ${row.allocationAvailable ?? '-'}`,
          location: '-',
          status: row.exceedsBudget ? 'Exceeds budget' : 'Within budget',
        }))
        : [],
      suggestedActions: ['Review over-budget requests before approval and adjust allocation or scope.'],
    };
  }

  if (mode === 'quote_comparison') {
    const requests = Array.isArray(payload?.requests) ? payload.requests : [];
    const quoteRows = [];
    requests.forEach((request) => {
      (Array.isArray(request.vendorQuotes) ? request.vendorQuotes : []).forEach((quote) => {
        quoteRows.push({
          requestId: request.requestId || request.id || '-',
          title: request.title || '-',
          vendorName: quote.vendorName || '-',
          price: quote.totalPrice ?? null,
          status: quote.status || '-',
        });
      });
    });
    return {
      ...baseMeta,
      text: String(payload?.summary || inventoryAiQuickActionLabel(mode)),
      matchedItems: quoteRows.slice(0, 10).map((row) => ({
        assetId: row.requestId,
        name: row.title,
        category: row.vendorName,
        type: row.price !== null ? `Quote ${row.price}` : 'Quote',
        location: '-',
        status: row.status,
      })),
      suggestedActions: ['Open Procurement page to run per-request vendor quote comparison and select best value.'],
    };
  }

  if (mode === 'duplicates') {
    return {
      ...baseMeta,
      text: String(payload?.summary || inventoryAiQuickActionLabel(mode)),
      matchedItems: Array.isArray(payload?.duplicateGroups)
        ? payload.duplicateGroups.slice(0, 10).flatMap((group) => (group.assets || []).slice(0, 3).map((asset) => ({
          assetId: asset.assetId,
          name: asset.name || asset.assetId || 'Asset',
          category: group.severity || 'Duplicate',
          type: group.reason || 'Duplicate',
          location: '-',
          status: group.recommendedAction || '-',
        })))
        : [],
      suggestedActions: Array.isArray(payload?.duplicateGroups)
        ? payload.duplicateGroups.slice(0, 6).map((group) => String(group.recommendedAction || '').trim()).filter(Boolean)
        : [],
    };
  }

  if (mode === 'relationship_suggestions') {
    return {
      ...baseMeta,
      text: String(payload?.summary || inventoryAiQuickActionLabel(mode)),
      matchedItems: Array.isArray(payload?.suggestions)
        ? payload.suggestions.slice(0, 10).map((item) => ({
          assetId: item.sourceAssetId,
          name: item.sourceAssetName || item.sourceAssetId || 'Source Asset',
          category: item.relationshipType || 'Relationship',
          type: item.targetAssetName || item.targetAssetId || 'Target',
          location: '-',
          status: item.reason || '-',
        }))
        : [],
      suggestedActions: ['Review suggestions and apply only safe-to-apply links.'],
    };
  }

  if (mode === 'ticket_draft') {
    const draft = payload?.ticketDraft || {};
    return {
      ...baseMeta,
      text: String(payload?.summary || draft?.title || inventoryAiQuickActionLabel(mode)),
      matchedItems: [{
        assetId: draft.assetId || '-',
        name: draft.assetName || 'Inventory Ticket Draft',
        category: draft.priority || 'Priority',
        type: draft.category || 'Ticket',
        location: '-',
        status: draft.description || '-',
      }],
      suggestedActions: ['Review draft and create ticket in draft mode only.'],
    };
  }

  if (mode === 'daily_brief') {
    const highlights = Array.isArray(payload?.highlights) ? payload.highlights : [];
    const risks = Array.isArray(payload?.risks) ? payload.risks : [];
    const recs = Array.isArray(payload?.recommendedActions) ? payload.recommendedActions : [];
    return {
      ...baseMeta,
      text: String(payload?.summary || payload?.title || inventoryAiQuickActionLabel(mode)),
      matchedItems: [],
      suggestedActions: [...highlights.slice(0, 3), ...risks.slice(0, 3), ...recs.slice(0, 5)].filter(Boolean),
    };
  }

  if (mode === 'monthly_report') {
    const recs = Array.isArray(payload?.recommendations) ? payload.recommendations : [];
    return {
      ...baseMeta,
      text: String(payload?.executiveSummary || payload?.summary || inventoryAiQuickActionLabel(mode)),
      matchedItems: [],
      suggestedActions: recs.slice(0, 8),
    };
  }

  if (mode === 'executive_dashboard') {
    const recs = Array.isArray(payload?.recommendations) ? payload.recommendations : [];
    return {
      ...baseMeta,
      text: String(payload?.summary || `Executive dashboard loaded for ${payload?.totalAssets ?? 0} asset(s).`),
      matchedItems: [],
      suggestedActions: recs.slice(0, 8),
    };
  }

  if (mode === 'digital_twin') {
    const asset = payload?.asset || {};
    const related = payload?.relatedCounts || {};
    return {
      ...baseMeta,
      text: String(payload?.recommendedAction || payload?.summary || inventoryAiQuickActionLabel(mode)),
      matchedItems: [{
        assetId: asset.customId || '-',
        name: asset.name || 'Asset Digital Twin',
        category: payload?.riskScore?.riskLevel || payload?.kitHealth?.label || 'Digital Twin',
        type: `Health ${payload?.healthScore ?? '-'} / Risk ${payload?.riskScore?.riskScore ?? '-'}`,
        location: payload?.currentLocation || '-',
        status: `Components ${related.components ?? 0} â€¢ Accessories ${related.accessories ?? 0} â€¢ Licenses ${related.licenses ?? 0}`,
      }],
      suggestedActions: Array.isArray(payload?.openIssues) && payload.openIssues.length
        ? payload.openIssues.slice(0, 6)
        : ['No critical Digital Twin issues detected.'],
    };
  }

  if (mode === 'black_box_timeline') {
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const grouped = events.reduce((acc, event) => {
      const key = String(event.eventGroup || 'all');
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return {
      ...baseMeta,
      text: String(payload?.summary || `Black Box Timeline loaded with ${events.length} event(s).`),
      matchedItems: [],
      suggestedActions: Object.entries(grouped).map(([key, count]) => `${key}: ${count}`),
    };
  }

  if (mode === 'plan_action') {
    return {
      ...baseMeta,
      text: String(payload?.summary || inventoryAiQuickActionLabel(mode)),
      matchedItems: Array.isArray(payload?.affectedItems) ? payload.affectedItems.slice(0, 10).map((item) => ({
        assetId: item.assetId || item.customId || '-',
        name: item.name || item.assetName || 'Affected Asset',
        category: payload?.actionType || 'Action Plan',
        type: item.type || '-',
        location: item.location || '-',
        status: item.reason || '-',
      })) : [],
      suggestedActions: [String(payload?.confirmationInstructions || 'Review plan and confirm through safe workflows.')],
    };
  }

  return {
    ...baseMeta,
    text: String(payload?.answer || payload?.summary || inventoryAiQuickActionLabel(mode)),
    matchedItems: Array.isArray(payload?.results) ? payload.results : [],
    suggestedActions: Array.isArray(payload?.suggestedActions) ? payload.suggestedActions : [],
  };
}

function inventoryAiModeMeta(mode) {
  const map = {
    assistant: { title: 'Inventory AI Assistant', queryRequired: true, placeholder: 'Ask inventory questions (e.g., Which assets are missing serial numbers?)' },
    search: { title: 'AI Search', queryRequired: true, placeholder: 'Search in natural language (e.g., licenses expiring soon)' },
    missing_data: { title: 'AI Data Quality Check', queryRequired: false, placeholder: '' },
    data_corrections: { title: 'AI Data Corrections', queryRequired: false, placeholder: '' },
    risk_scores: { title: 'AI Risk Scores', queryRequired: false, placeholder: '' },
    replacement_priority: { title: 'AI Replacement Priorities', queryRequired: false, placeholder: '' },
    spare_stock_forecast: { title: 'AI Spare Stock Forecast', queryRequired: false, placeholder: '' },
    reallocation: { title: 'AI Reallocation / Tech Exchange', queryRequired: false, placeholder: '' },
    maintenance: { title: 'AI Maintenance Recommendations', queryRequired: false, placeholder: '' },
    procurement: { title: 'AI Procurement Recommendations', queryRequired: false, placeholder: '' },
    abc_analysis: { title: 'ABC Analysis', queryRequired: false, placeholder: '' },
    eoq_moq: { title: 'EOQ / MOQ', queryRequired: false, placeholder: '' },
    fifo_batches: { title: 'FIFO Batch Visibility', queryRequired: false, placeholder: '' },
    finance_summary: { title: 'Procurement Finance Summary', queryRequired: false, placeholder: '' },
    quote_comparison: { title: 'Vendor Quote Comparison', queryRequired: false, placeholder: '' },
    duplicates: { title: 'AI Duplicate Check', queryRequired: false, placeholder: '' },
    relationship_suggestions: { title: 'AI Relationship Suggestions', queryRequired: false, placeholder: '' },
    ticket_draft: { title: 'AI Ticket Draft', queryRequired: true, placeholder: 'Describe the issue to draft a ticket' },
    daily_brief: { title: 'Inventory Daily Brief', queryRequired: false, placeholder: '' },
    monthly_report: { title: 'AI Monthly Inventory Report', queryRequired: false, placeholder: '' },
    executive_dashboard: { title: 'Inventory Executive Dashboard', queryRequired: false, placeholder: '' },
    digital_twin: { title: 'Asset Digital Twin', queryRequired: false, placeholder: '' },
    black_box_timeline: { title: 'Asset Black Box Timeline', queryRequired: false, placeholder: '' },
    plan_action: { title: 'AI Natural Language Action Plan', queryRequired: true, placeholder: 'Example: Transfer all Lab A PCs to Computer Lab B' },
    demo_guide: { title: 'Thesis Demo Guide', queryRequired: false, placeholder: '' },
  };
  return map[mode] || map.assistant;
}

window.openInventoryAiModal = async (mode = 'assistant') => {
  if (mode === 'assistant') {
    window.toggleInventoryAiChat(true);
    return;
  }
  inventoryAiState.mode = mode;
  const meta = inventoryAiModeMeta(mode);
  const modalEl = document.getElementById('inventoryAiModal');
  const titleEl = document.getElementById('inventoryAiModalTitle');
  const inputSection = document.getElementById('inventoryAiInputSection');
  const queryInput = document.getElementById('inventoryAiQueryInput');
  const statusEl = document.getElementById('inventoryAiStatus');
  const resultEl = document.getElementById('inventoryAiResult');
  if (!modalEl) return;
  if (titleEl) titleEl.textContent = meta.title;
  if (inputSection) inputSection.classList.toggle('d-none', !meta.queryRequired);
  if (queryInput) queryInput.placeholder = meta.placeholder;
  if (statusEl) statusEl.textContent = 'Ready.';
  if (resultEl) resultEl.textContent = 'Click Run to start.';
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
  if (!meta.queryRequired) {
    await window.runInventoryAiAction();
  }
};

window.runInventoryAiAction = async () => {
  const mode = inventoryAiState.mode || 'assistant';
  const meta = inventoryAiModeMeta(mode);
  const queryInput = document.getElementById('inventoryAiQueryInput');
  const runBtn = document.getElementById('inventoryAiRunBtn');
  const statusEl = document.getElementById('inventoryAiStatus');
  if (meta.queryRequired && !String(queryInput?.value || '').trim()) {
    showMessage('Please enter a query first.', 'warning');
    return;
  }
  if (runBtn) {
    runBtn.disabled = true;
    runBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Running...';
  }
  if (statusEl) statusEl.textContent = 'Running AI analysis...';
  try {
    const context = getInventoryAiChatContext();
    const endpoint = inventoryAiEndpointForMode(mode, context);
    if (!endpoint) {
      throw new Error('Select/open an asset first, then run this action.');
    }
    const payload = {
      context,
      currentView: context.view,
      search: context.search,
      filters: context.filters,
      selectedAssetCustomId: context.selectedAssetCustomId,
    };
    if (meta.queryRequired) payload.query = String(queryInput?.value || '').trim();
    if (mode === 'ticket_draft') {
      payload.issue = payload.query || 'Draft maintenance ticket for inventory issue';
      if (context.selectedAssetCustomId) payload.assetId = context.selectedAssetCustomId;
    }
    if (mode === 'monthly_report') {
      const now = new Date();
      payload.month = now.getMonth() + 1;
      payload.year = now.getFullYear();
    }
    const usesGet = mode === 'executive_dashboard' || mode === 'digital_twin' || mode === 'black_box_timeline';
    let result;
    if (usesGet) {
      let query = '';
      if (mode === 'executive_dashboard') {
        const params = new URLSearchParams();
        if (payload?.filters?.department && payload.filters.department !== 'all') params.set('department', toBackendDepartmentFilterValue(payload.filters.department));
        if (payload?.filters?.building && payload.filters.building !== 'all') params.set('location', payload.filters.building);
        if (payload?.filters?.type && payload.filters.type !== 'all') params.set('type', payload.filters.type);
        query = params.toString() ? `?${params.toString()}` : '';
      }
      result = await readInventoryJson(`${endpoint}${query}`);
    } else {
      result = await postInventoryJson(endpoint, payload);
    }
    renderInventoryAiResult(result || {});
    if (statusEl) statusEl.textContent = `Completed (${result?.fallbackUsed ? 'fallback path used' : 'LLM-assisted path used'}).`;
  } catch (error) {
    if (statusEl) statusEl.textContent = 'Failed.';
    showMessage(error.message || 'Inventory AI request failed.', 'error');
  } finally {
    if (runBtn) {
      runBtn.disabled = false;
      runBtn.textContent = 'Run';
    }
  }
};

function toImportFriendlyMessage(message, severity = 'warning') {
  const original = String(message || '').trim();
  if (!original) return '';
  const withTechnical = (plain) => `${plain} (Technical: ${original})`;

  if (/^Unrecognized asset type in registry\s*\(/i.test(original)) {
    return withTechnical('This asset type is accepted but not in the standard registry. It will still import using the nearest supported type.');
  }
  if (/^Component type\s*\(.+\)\s*is not in current registry/i.test(original)) {
    return withTechnical('This component type is not in the standard registry. It will still import as a custom component type.');
  }
  if (/^Accessory type\s*\(.+\)\s*is outside the standard accessory registry/i.test(original)) {
    return withTechnical('This accessory type is outside the standard registry. It will still import as a custom accessory type.');
  }
  if (/^Consumable type\s*\(.+\)\s*is outside the standard consumable registry/i.test(original)) {
    return withTechnical('This consumable type is outside the standard registry. It will still import as a custom consumable type.');
  }
  if (/^Spare stock type\s*\(.+\)\s*is outside the standard spare-stock registry/i.test(original)) {
    return withTechnical('This spare stock type is outside the standard registry. It will still import as a custom spare stock type.');
  }
  if (/^License type\s*\(.+\)\s*is outside the standard license registry/i.test(original)) {
    return withTechnical('This license type is outside the standard registry. It will still import as a custom license type.');
  }
  if (/^Parent Asset Tag is required for component rows\.?$/i.test(original)) {
    return 'Component rows need Parent Asset Tag so they can be linked to a parent asset.';
  }
  if (/^Parent Asset Tag is required for related item rows\.?$/i.test(original)) {
    return 'Related item rows need Parent Asset Tag so they can be linked to a parent asset.';
  }
  if (/^Unknown Parent Asset Tag\s*\(/i.test(original) || /^Parent asset not found for related item row\.?$/i.test(original)) {
    return withTechnical('Parent Asset Tag was not found in this file or current inventory. Create/import the parent first, then retry.');
  }
  if (/^Duplicate serial number in file\s*\(/i.test(original)) {
    return withTechnical('This serial number appears more than once in this file. Keep one row per unique serial number.');
  }
  if (/^Duplicate asset tag in file\s*\(/i.test(original)) {
    return withTechnical('This asset tag appears more than once in this file. Keep one row per unique asset tag.');
  }
  if (/^Serial number already exists in DB\s*\(/i.test(original)) {
    return withTechnical('This serial number already exists in inventory. Update the existing asset or use a unique serial number.');
  }
  if (/^Asset tag already exists in DB\s*\(/i.test(original)) {
    return withTechnical('This asset tag already exists in inventory. Update the existing asset or use a unique asset tag.');
  }
  if (/^Invalid category\s*\(/i.test(original)) {
    return withTechnical('Category is not supported. Use one of the Inventory-supported categories.');
  }
  if (/^Invalid Record Type$/i.test(original)) {
    return withTechnical('Record Type is not supported. Use parent_asset, component/component_asset, accessory, consumable, spare_stock, or license.');
  }
  if (/^Component Type is empty; defaulting to component$/i.test(original)) {
    return 'Component Type is empty. Inventory will default this row to "component".';
  }
  if (/^\d+\s+warning\(s\)\s+detected/i.test(original)) {
    return original;
  }
  if (severity === 'error' && /^Import commit rejected due to validation errors\.?$/i.test(original)) {
    return 'Import cannot continue until blocking validation errors are fixed.';
  }
  return original;
}

function formatImportMessages(messages = [], severity = 'warning') {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((msg) => toImportFriendlyMessage(msg, severity))
    .filter(Boolean);
}

function renderImportPreviewRows(rows = []) {
  const tableBody = document.getElementById('importPreviewTableBody');
  if (!tableBody) return;
  if (!Array.isArray(rows) || rows.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="9" class="text-muted text-center py-4">No rows in preview.</td></tr>';
    return;
  }
  tableBody.innerHTML = rows.map((row) => {
    const message = [
      ...formatImportMessages(row.errors || [], 'error'),
      ...formatImportMessages(row.warnings || [], 'warning'),
    ].join(' | ') || 'OK';
    const status = row.statusLabel || 'valid';
    const displayRecordType = row.recordType === 'embedded_component' ? 'component' : (row.recordType || '-');
    const statusBadge = status === 'error'
      ? '<span class="badge bg-danger">Error</span>'
      : (status === 'warning' ? '<span class="badge bg-warning text-dark">Warning</span>' : '<span class="badge bg-success">Valid</span>');
    return `
      <tr>
        <td>${UI.escapeHTML(String(row.rowNumber || '-'))}</td>
        <td>${UI.escapeHTML(displayRecordType)}</td>
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

function setImportPreviewUiState(preview = null) {
  const summary = document.getElementById('importPreviewSummary');
  const commitSummary = document.getElementById('importCommitSummary');
  const commitBtn = document.getElementById('commitImportBtn');
  if (!preview || !Array.isArray(preview.normalizedRows)) {
    if (summary) summary.textContent = 'No preview yet.';
    if (commitSummary) {
      commitSummary.textContent = '';
      commitSummary.className = 'small mt-2';
    }
    if (commitBtn) commitBtn.disabled = true;
    renderImportPreviewRows([]);
    return;
  }
  renderImportPreviewRows(preview.normalizedRows || []);
  const warningCount = (preview.normalizedRows || [])
    .reduce((sum, row) => sum + (Array.isArray(row?.warnings) ? row.warnings.length : 0), 0);
  if (summary) {
    summary.textContent = `Rows: ${preview.totalRows || 0} | Valid: ${preview.validRows || 0} | Invalid: ${preview.invalidRows || 0} | Warnings: ${warningCount} | Can Import: ${preview.canImport ? 'Yes' : 'No'}`;
  }
  if (commitSummary) {
    const msg = [
      ...formatImportMessages(preview.errors || [], 'error'),
      ...formatImportMessages(preview.warnings || [], 'warning'),
    ].join(' | ');
    commitSummary.textContent = msg || '';
    commitSummary.className = `small mt-2 ${preview.canImport ? 'text-muted' : 'text-danger'}`;
  }
  if (commitBtn) commitBtn.disabled = !preview.canImport;
}

function resetImportRepairState() {
  importAiRepairState = {
    suggestions: [],
    beforeMetrics: null,
    lastApplySummary: '',
  };
  renderImportRepairSuggestions();
}

function normalizeImportRepairStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'applied' || normalized === 'ignored' || normalized === 'failed') return normalized;
  return 'pending';
}

function formatImportRepairValue(value) {
  if (value === null || typeof value === 'undefined') return '-';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (_error) {
      return String(value);
    }
  }
  const text = String(value).trim();
  return text || '-';
}

function toImportRepairFieldLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  return raw
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeImportRepairSuggestions(fixes = []) {
  const suggestions = Array.isArray(fixes) ? fixes.map((fix, index) => {
    const rowNumber = Number(fix?.rowNumber || 0);
    const field = String(fix?.field || '').trim();
    const confidenceValue = Number(fix?.confidence);
    return {
      id: `repair-fix-${index + 1}-${rowNumber || 'x'}-${field || 'field'}`,
      rowNumber: Number.isFinite(rowNumber) ? rowNumber : 0,
      field,
      oldValue: Object.prototype.hasOwnProperty.call(fix || {}, 'oldValue') ? fix.oldValue : fix?.originalValue,
      suggestedValue: fix?.suggestedValue,
      reason: String(fix?.reason || '').trim() || 'No reason provided.',
      confidence: Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : null,
      safeToApply: Boolean(fix?.safeToApply || fix?.canAutoApply),
      canAutoApply: Boolean(fix?.safeToApply || fix?.canAutoApply),
      severity: String(fix?.severity || '').trim().toLowerCase() || (Boolean(fix?.safeToApply || fix?.canAutoApply) ? 'info' : 'warning'),
      conflictKey: `${rowNumber || 0}::${field.toLowerCase()}`,
      conflict: false,
      status: 'pending',
      selected: Boolean(fix?.safeToApply || fix?.canAutoApply),
      appliedAt: null,
      ignoredAt: null,
      failedReason: '',
    };
  }) : [];

  const conflictBuckets = new Map();
  suggestions.forEach((fix) => {
    const key = String(fix.conflictKey || '');
    conflictBuckets.set(key, [...(conflictBuckets.get(key) || []), fix.id]);
  });

  return suggestions.map((fix) => {
    const conflictIds = conflictBuckets.get(String(fix.conflictKey || '')) || [];
    if (conflictIds.length <= 1) return fix;
    return {
      ...fix,
      conflict: true,
      canAutoApply: false,
      selected: false,
      reason: `${fix.reason} (Conflict: multiple suggestions target the same row/field.)`,
    };
  });
}

function renderImportRepairSuggestions() {
  const panelEl = document.getElementById('importAiRepairPanel');
  const metaEl = document.getElementById('importAiRepairMeta');
  const summaryEl = document.getElementById('importAiRepairApplySummary');
  const tableBody = document.getElementById('importAiRepairTableBody');
  const applySafeBtn = document.getElementById('importAiRepairApplySafeBtn');
  const applySelectedBtn = document.getElementById('importAiRepairApplySelectedBtn');
  const ignoreAllBtn = document.getElementById('importAiRepairIgnoreAllBtn');
  if (!panelEl || !metaEl || !summaryEl || !tableBody) return;

  const suggestions = Array.isArray(importAiRepairState.suggestions) ? importAiRepairState.suggestions : [];
  if (!suggestions.length) {
    panelEl.classList.add('d-none');
    metaEl.textContent = 'No suggestions loaded.';
    summaryEl.textContent = 'No fixes applied yet.';
    summaryEl.className = 'small text-muted mb-2';
    tableBody.innerHTML = '<tr><td colspan="9" class="text-muted text-center py-3">Run AI Fix Import Errors to generate suggestions.</td></tr>';
    if (applySafeBtn) applySafeBtn.disabled = true;
    if (applySelectedBtn) applySelectedBtn.disabled = true;
    if (ignoreAllBtn) ignoreAllBtn.disabled = true;
    return;
  }

  panelEl.classList.remove('d-none');
  const counts = suggestions.reduce((acc, fix) => {
    const status = normalizeImportRepairStatus(fix.status);
    acc[status] = (acc[status] || 0) + 1;
    if (fix.conflict) acc.conflicts += 1;
    if (fix.selected && status === 'pending') acc.selectedPending += 1;
    if (fix.canAutoApply && status === 'pending') acc.safePending += 1;
    return acc;
  }, {
    pending: 0,
    applied: 0,
    ignored: 0,
    failed: 0,
    conflicts: 0,
    selectedPending: 0,
    safePending: 0,
  });

  metaEl.textContent = `Suggestions: ${suggestions.length} | Pending: ${counts.pending} | Applied: ${counts.applied} | Ignored: ${counts.ignored} | Failed: ${counts.failed}${counts.conflicts ? ` | Conflicts: ${counts.conflicts}` : ''}`;
  summaryEl.textContent = importAiRepairState.lastApplySummary || 'No fixes applied yet.';
  summaryEl.className = `small mb-2 ${counts.failed ? 'text-warning' : 'text-muted'}`;

  tableBody.innerHTML = suggestions.map((fix) => {
    const status = normalizeImportRepairStatus(fix.status);
    const statusBadge = status === 'applied'
      ? '<span class="badge bg-success">Applied</span>'
      : (status === 'ignored'
        ? '<span class="badge bg-secondary">Ignored</span>'
        : (status === 'failed'
          ? '<span class="badge bg-danger">Failed</span>'
          : '<span class="badge bg-warning text-dark">Pending</span>'));
    const confidence = fix.confidence === null || typeof fix.confidence === 'undefined'
      ? '-'
      : `${Math.round(Number(fix.confidence || 0) * 100)}%`;
    const reason = fix.failedReason
      ? `${fix.reason} Failed: ${fix.failedReason}`
      : fix.reason;
    return `
      <tr>
        <td>
          <input
            type="checkbox"
            class="form-check-input"
            data-import-repair-select-id="${UI.escapeHTML(String(fix.id || ''))}"
            aria-label="Select suggestion for row ${UI.escapeHTML(String(fix.rowNumber || '-'))}, field ${UI.escapeHTML(toImportRepairFieldLabel(fix.field))}"
            ${fix.selected ? 'checked' : ''}
            ${status !== 'pending' ? 'disabled' : ''}
          />
        </td>
        <td>${UI.escapeHTML(String(fix.rowNumber || '-'))}</td>
        <td>${UI.escapeHTML(toImportRepairFieldLabel(fix.field))}</td>
        <td><code>${UI.escapeHTML(formatImportRepairValue(fix.oldValue))}</code></td>
        <td><code>${UI.escapeHTML(formatImportRepairValue(fix.suggestedValue))}</code></td>
        <td class="small">${UI.escapeHTML(reason || '-')}</td>
        <td>${UI.escapeHTML(confidence)}</td>
        <td>${statusBadge}</td>
        <td>
          <button
            type="button"
            class="btn btn-sm btn-outline-success me-1"
            data-import-repair-apply-id="${UI.escapeHTML(String(fix.id || ''))}"
            aria-label="Apply suggestion for row ${UI.escapeHTML(String(fix.rowNumber || '-'))}, field ${UI.escapeHTML(toImportRepairFieldLabel(fix.field))}"
            ${status !== 'pending' ? 'disabled' : ''}
          >Apply</button>
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary"
            data-import-repair-ignore-id="${UI.escapeHTML(String(fix.id || ''))}"
            aria-label="Ignore suggestion for row ${UI.escapeHTML(String(fix.rowNumber || '-'))}, field ${UI.escapeHTML(toImportRepairFieldLabel(fix.field))}"
            ${status !== 'pending' ? 'disabled' : ''}
          >Ignore</button>
        </td>
      </tr>
    `;
  }).join('');

  if (applySafeBtn) applySafeBtn.disabled = counts.safePending === 0;
  if (applySelectedBtn) applySelectedBtn.disabled = counts.selectedPending === 0;
  if (ignoreAllBtn) ignoreAllBtn.disabled = counts.pending === 0;
}

function coerceImportRepairValue(field, value) {
  const key = String(field || '').trim();
  if (['quantity', 'minimumStockLevel', 'reorderPoint'].includes(key)) {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (key === 'purchaseCost') {
    const parsed = Number.parseFloat(String(value ?? '').trim());
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}

function cloneImportPreviewRows(rows = []) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    ...row,
    errors: Array.isArray(row?.errors) ? [...row.errors] : [],
    warnings: Array.isArray(row?.warnings) ? [...row.warnings] : [],
  }));
}

async function revalidateImportPreviewRows() {
  if (!importPreviewCache || !Array.isArray(importPreviewCache.normalizedRows)) {
    throw new Error('No preview rows available for validation.');
  }
  const payload = await postInventoryJson('/assets/import/preview', {
    filename: importPreviewCache.filename || 'import.csv',
    rows: importPreviewCache.normalizedRows,
  });
  importPreviewCache = {
    ...importPreviewCache,
    ...payload,
    normalizedRows: Array.isArray(payload?.normalizedRows) ? payload.normalizedRows : [],
  };
  setImportPreviewUiState(importPreviewCache);
  return importPreviewCache;
}

async function applyImportRepairsByIds(ids = [], options = {}) {
  const requestedIds = Array.isArray(ids) ? ids.map((entry) => String(entry || '').trim()).filter(Boolean) : [];
  if (!requestedIds.length) {
    showMessage('Select at least one pending suggestion.', 'warning');
    return;
  }
  if (!importPreviewCache || !Array.isArray(importPreviewCache.normalizedRows)) {
    showMessage('Run preview first.', 'warning');
    return;
  }

  const requireSafe = Boolean(options?.requireSafe);
  const snapshotBefore = {
    invalidRows: Number(importPreviewCache.invalidRows || 0),
    validRows: Number(importPreviewCache.validRows || 0),
  };

  const suggestionById = new Map((importAiRepairState.suggestions || []).map((fix) => [String(fix.id || ''), fix]));
  const selectedFixes = requestedIds
    .map((id) => suggestionById.get(id))
    .filter(Boolean)
    .filter((fix) => normalizeImportRepairStatus(fix.status) === 'pending');

  if (!selectedFixes.length) {
    showMessage('No pending suggestions selected.', 'warning');
    return;
  }

  const conflictingSelections = new Map();
  selectedFixes.forEach((fix) => {
    const key = String(fix.conflictKey || '');
    conflictingSelections.set(key, [...(conflictingSelections.get(key) || []), fix]);
  });

  let appliedCount = 0;
  const appliedFixIds = [];
  const nextRows = cloneImportPreviewRows(importPreviewCache.normalizedRows);
  const nextSuggestions = (importAiRepairState.suggestions || []).map((fix) => ({ ...fix }));

  selectedFixes.forEach((fix) => {
    const nextFix = nextSuggestions.find((entry) => String(entry.id || '') === String(fix.id || ''));
    if (!nextFix) return;
    if (requireSafe && !nextFix.canAutoApply) return;
    const sameFieldSelections = conflictingSelections.get(String(nextFix.conflictKey || '')) || [];
    if (sameFieldSelections.length > 1) {
      nextFix.status = 'failed';
      nextFix.failedReason = 'Multiple conflicting suggestions selected for the same row/field.';
      return;
    }
    const rowIndex = nextRows.findIndex((row) => Number(row?.rowNumber || 0) === Number(nextFix.rowNumber || 0));
    if (rowIndex < 0) {
      nextFix.status = 'failed';
      nextFix.failedReason = 'Target row not found in current preview.';
      return;
    }
    const field = String(nextFix.field || '').trim();
    if (!field || !Object.prototype.hasOwnProperty.call(nextRows[rowIndex], field)) {
      nextFix.status = 'failed';
      nextFix.failedReason = `Field "${field || '-'}" was not found in preview row schema.`;
      return;
    }
    nextRows[rowIndex][field] = coerceImportRepairValue(field, nextFix.suggestedValue);
    nextFix.status = 'applied';
    nextFix.appliedAt = new Date().toISOString();
    nextFix.selected = false;
    nextFix.failedReason = '';
    appliedCount += 1;
    appliedFixIds.push(String(nextFix.id || ''));
  });

  importAiRepairState.suggestions = nextSuggestions;
  if (!appliedCount) {
    importAiRepairState.lastApplySummary = 'No fixes were applied. Select safe pending suggestions or resolve conflicts first.';
    renderImportRepairSuggestions();
    showMessage('No fixes were applied.', 'warning');
    return;
  }

  importPreviewCache = {
    ...importPreviewCache,
    normalizedRows: nextRows,
  };
  await revalidateImportPreviewRows();

  if (appliedFixIds.length) {
    importAiRepairState.suggestions = (importAiRepairState.suggestions || []).map((fix) => {
      const fixId = String(fix.id || '');
      if (!appliedFixIds.includes(fixId)) return fix;
      const targetRow = (importPreviewCache?.normalizedRows || []).find((row) => Number(row?.rowNumber || 0) === Number(fix.rowNumber || 0));
      if (!targetRow) {
        return {
          ...fix,
          status: 'failed',
          failedReason: 'Target row disappeared after revalidation.',
        };
      }
      const fieldToken = String(fix.field || '').trim().toLowerCase();
      const rowErrors = Array.isArray(targetRow.errors) ? targetRow.errors.map((entry) => String(entry || '').toLowerCase()) : [];
      const stillInvalid = rowErrors.some((msg) => msg.includes(fieldToken) || msg.includes(`invalid ${fieldToken}`));
      if (!stillInvalid) return fix;
      return {
        ...fix,
        status: 'failed',
        failedReason: 'Suggested value still fails validation after preview recheck.',
      };
    });
  }

  const afterInvalid = Number(importPreviewCache.invalidRows || 0);
  const remainingErrors = Number(importPreviewCache.invalidRows || 0);
  importAiRepairState.beforeMetrics = snapshotBefore;
  importAiRepairState.lastApplySummary = `Before invalid: ${snapshotBefore.invalidRows} | After invalid: ${afterInvalid} | Fixes applied: ${appliedCount} | Remaining errors: ${remainingErrors}.`;
  renderImportRepairSuggestions();
  showMessage(`Applied ${appliedCount} fix(es). Preview revalidated.`, 'success');
}

function resetImportAssetsState() {
  importPreviewCache = null;
  importAiHeaderMappings = null;
  lastImportCommitMeta = null;
  const fileInput = document.getElementById('importAssetsFile');
  const dropHint = document.getElementById('importDropZoneHint');
  const aiMappingSummary = document.getElementById('importAiMappingSummary');
  const aiRepairSummary = document.getElementById('importAiRepairSummary');
  const docText = document.getElementById('importDocumentText');
  const docSummary = document.getElementById('importDocumentSummary');
  const postCommitActions = document.getElementById('importPostCommitActions');
  setImportPreviewUiState(null);
  resetImportRepairState();
  if (aiMappingSummary) aiMappingSummary.textContent = 'No AI mapping yet.';
  if (aiRepairSummary) aiRepairSummary.textContent = 'No AI repair run yet.';
  if (docText) docText.value = '';
  if (docSummary) docSummary.textContent = 'No document extraction run yet.';
  if (fileInput) fileInput.value = '';
  if (dropHint) dropHint.textContent = 'No file selected.';
  if (postCommitActions) {
    postCommitActions.classList.add('d-none');
    delete postCommitActions.dataset.importBatchId;
    delete postCommitActions.dataset.importedAt;
  }
}

window.openImportAssetsModal = async () => {
  resetImportAssetsState();
  const modalEl = document.getElementById('importAssetsModal');
  if (!modalEl) return;
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
};

window.copyImportTemplateCsv = async () => {
  const template = [
    'Record Type,Asset Name,Category,Asset Type,Brand,Model,Serial Number,Asset Tag,Manufacturer Part Number,Location,Department,Status,Lifecycle Status,Parent Asset Tag,Component Type,Condition,Quantity,Minimum Stock Level,Reorder Point,Vendor,Purchase Date,Warranty Start Date,Warranty End Date,Purchase Cost,Assigned To,Notes',
    'parent_asset,Dell OptiPlex Lab PC,Asset,Desktop,Dell,OptiPlex 7090,PC-SN-001,UNI-PC-LAB-A-001,LAT7090,Main Building,Computer Science,active,in_use,,,,1,,,Dell,2024-01-15,2024-01-15,2027-01-15,25000,IT Lab,Main PC',
    'component,RAM 16GB DDR4,Component,Electronics,Kingston,16GB DDR4,RAM-SN-001,UNI-RAM-001,KVR16GB,Main Building,Computer Science,active,in_use,UNI-PC-LAB-A-001,RAM,Good,1,,,,,,,,Initial RAM',
    'accessory,USB-C Dock,Accessory,Dock,Anker,PowerExpand,DOC-SN-100,UNI-DOCK-001,ANK-DOC-100,Main Building,Computer Science,active,assigned,UNI-PC-LAB-A-001,,Good,1,,,Anker,2024-01-20,,,2200,Lab Supervisor,Assigned accessory',
    'license,Windows 11 Pro License,License,Software License,Microsoft,Windows 11 Pro,LIC-SN-001,UNI-LIC-W11-001,MS-W11-PRO,Main Building,Computer Science,active,assigned,UNI-PC-LAB-A-001,,Good,1,,,Microsoft,2024-01-20,,,1200,Lab Supervisor,Linked license',
    'consumable,Printer Toner Black,Consumable,Toner,HP,CF259A,,CONS-TONER-001,HP-CF259A,Central Warehouse,Computer Science,active,in_stock,,,New,5,2,2,HP,2024-02-10,,,450,,Consumable stock',
    'spare_stock,Samsung 512GB SSD,Spare Stock,Spare SSD,Samsung,512GB SSD,,SPARE-SSD-512,SAM512,Central Warehouse,Computer Science,active,in_stock,,Spare SSD,New,3,1,1,Dell,2024-01-20,,,1500,,Compatible with Dell OptiPlex',
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
  if (!fileInput || !fileInput.files || !fileInput.files.length) {
    showMessage('Please choose a CSV file.', 'warning');
    return;
  }
  const file = fileInput.files[0];
  const name = String(file.name || '');
  const lower = name.toLowerCase();

  if (!lower.endsWith('.csv')) {
    showMessage('CSV is supported now. Please upload a CSV file. XLSX is planned for a later pass.', 'warning');
    return;
  }
  const text = await file.text();
  try {
    const preview = await postInventoryJson('/assets/import/preview', {
      filename: name,
      fileContent: text,
      headerMappings: importAiHeaderMappings || undefined,
    });
    importPreviewCache = preview;
    setImportPreviewUiState(importPreviewCache);
    resetImportRepairState();
  } catch (error) {
    showMessage(error.message || 'Failed to preview import.', 'error');
  }
};

window.runImportAiColumnMapping = async () => {
  const fileInput = document.getElementById('importAssetsFile');
  const summaryEl = document.getElementById('importAiMappingSummary');
  if (!fileInput || !fileInput.files || !fileInput.files.length) {
    showMessage('Choose a CSV file first.', 'warning');
    return;
  }
  const file = fileInput.files[0];
  const lower = String(file.name || '').toLowerCase();
  if (!lower.endsWith('.csv')) {
    showMessage('AI column mapping currently supports CSV in this pass.', 'warning');
    return;
  }
  if (summaryEl) summaryEl.textContent = 'Running AI column mapping...';
  try {
    const fileContent = await file.text();
    const result = await postInventoryJson('/assets/import/ai-map-columns', {
      filename: file.name,
      fileContent,
    });
    const mappings = Array.isArray(result?.mappings) ? result.mappings : [];
    importAiHeaderMappings = {};
    mappings.forEach((entry) => {
      const source = String(entry.sourceColumn || '').trim();
      const target = String(entry.targetColumn || '').trim();
      if (source && target) importAiHeaderMappings[source] = target;
    });
    const mappedCount = Object.keys(importAiHeaderMappings || {}).length;
    const unmapped = Array.isArray(result?.unmappedColumns) ? result.unmappedColumns : [];
    const warnings = formatImportMessages(Array.isArray(result?.warnings) ? result.warnings : [], 'warning');
    const sourceNote = aiSourceMetaText(result);
    if (summaryEl) {
      summaryEl.textContent = `Mapped ${mappedCount} column(s). Unmapped: ${unmapped.length}. ${warnings.length ? `Warnings: ${warnings.join(' | ')}` : ''} ${sourceNote}`;
      summaryEl.className = `small mb-2 ${mappedCount ? 'text-success' : 'text-warning'}`;
    }
    showMessage(
      mappedCount
        ? `AI column mappings ready. Click Preview to validate rows. ${sourceNote}`
        : `No confident AI mappings found. ${sourceNote}`,
      mappedCount ? 'success' : 'warning',
    );
  } catch (error) {
    if (summaryEl) {
      summaryEl.textContent = 'AI mapping failed. You can still run normal preview.';
      summaryEl.className = 'small mb-2 text-danger';
    }
    showMessage(error.message || 'Failed to run AI import mapping.', 'error');
  }
};

window.runImportAiRepairErrors = async () => {
  const summaryEl = document.getElementById('importAiRepairSummary');
  if (!importPreviewCache || !Array.isArray(importPreviewCache.normalizedRows) || !importPreviewCache.normalizedRows.length) {
    showMessage('Run preview first before AI error repair.', 'warning');
    return;
  }
  if (summaryEl) {
    summaryEl.textContent = 'Running AI import error repair...';
    summaryEl.className = 'small text-muted mb-2';
  }
  try {
    const result = await postInventoryJson('/assets/import/ai-repair-errors', {
      normalizedRows: importPreviewCache.normalizedRows,
    });
    const fixes = Array.isArray(result?.fixes) ? result.fixes : [];
    const warnings = formatImportMessages(Array.isArray(result?.warnings) ? result.warnings : [], 'warning');
    importAiRepairState.suggestions = normalizeImportRepairSuggestions(fixes);
    importAiRepairState.beforeMetrics = {
      invalidRows: Number(importPreviewCache.invalidRows || 0),
      validRows: Number(importPreviewCache.validRows || 0),
      totalRows: Number(importPreviewCache.totalRows || (importPreviewCache.normalizedRows || []).length),
    };
    importAiRepairState.lastApplySummary = `Before invalid: ${importAiRepairState.beforeMetrics.invalidRows}. Apply fixes and re-run validation.`;
    renderImportRepairSuggestions();
    const sourceNote = aiSourceMetaText(result);
    if (summaryEl) {
      summaryEl.textContent = `${result?.summary || 'AI repair suggestions generated.'} Fixes: ${fixes.length}. Safe fixes: ${importAiRepairState.suggestions.filter((fix) => fix.canAutoApply).length}. ${warnings.length ? `Warnings: ${warnings.slice(0, 4).join(' | ')}` : ''} ${sourceNote}`;
      summaryEl.className = `small mb-2 ${fixes.length ? 'text-success' : 'text-warning'}`;
    }
    showMessage(`AI repair suggestions generated. Review and apply fixes before confirming import. ${sourceNote}`, fixes.length ? 'success' : 'warning');
  } catch (error) {
    if (summaryEl) {
      summaryEl.textContent = 'AI import error repair failed.';
      summaryEl.className = 'small mb-2 text-danger';
    }
    showMessage(error.message || 'Failed to run AI import error repair.', 'error');
  }
};

window.applySingleImportRepair = async (fixId) => {
  await applyImportRepairsByIds([fixId], { requireSafe: false });
};

window.ignoreSingleImportRepair = async (fixId) => {
  const targetId = String(fixId || '').trim();
  if (!targetId) return;
  importAiRepairState.suggestions = (importAiRepairState.suggestions || []).map((fix) => {
    if (String(fix.id || '') !== targetId) return fix;
    if (normalizeImportRepairStatus(fix.status) !== 'pending') return fix;
    return {
      ...fix,
      status: 'ignored',
      ignoredAt: new Date().toISOString(),
      selected: false,
    };
  });
  importAiRepairState.lastApplySummary = 'Marked 1 suggestion as ignored.';
  renderImportRepairSuggestions();
};

window.applyAllSafeImportRepairs = async () => {
  const ids = (importAiRepairState.suggestions || [])
    .filter((fix) => normalizeImportRepairStatus(fix.status) === 'pending' && fix.canAutoApply)
    .map((fix) => fix.id);
  await applyImportRepairsByIds(ids, { requireSafe: true });
};

window.applySelectedImportRepairs = async () => {
  const ids = (importAiRepairState.suggestions || [])
    .filter((fix) => normalizeImportRepairStatus(fix.status) === 'pending' && fix.selected)
    .map((fix) => fix.id);
  await applyImportRepairsByIds(ids, { requireSafe: false });
};

window.ignoreAllImportRepairs = async () => {
  const pending = (importAiRepairState.suggestions || []).filter((fix) => normalizeImportRepairStatus(fix.status) === 'pending');
  if (!pending.length) {
    showMessage('No pending suggestions to ignore.', 'warning');
    return;
  }
  const now = new Date().toISOString();
  importAiRepairState.suggestions = (importAiRepairState.suggestions || []).map((fix) => {
    if (normalizeImportRepairStatus(fix.status) !== 'pending') return fix;
    return {
      ...fix,
      status: 'ignored',
      ignoredAt: now,
      selected: false,
    };
  });
  importAiRepairState.lastApplySummary = `Ignored ${pending.length} pending suggestion(s).`;
  renderImportRepairSuggestions();
  showMessage(`Ignored ${pending.length} suggestion(s).`, 'info');
};

window.rerunImportPreviewValidation = async () => {
  if (!importPreviewCache || !Array.isArray(importPreviewCache.normalizedRows)) {
    showMessage('Run preview first.', 'warning');
    return;
  }
  const summaryEl = document.getElementById('importAiRepairSummary');
  if (summaryEl) {
    summaryEl.textContent = 'Revalidating preview rows...';
    summaryEl.className = 'small mb-2 text-muted';
  }
  const beforeInvalid = Number(importPreviewCache.invalidRows || 0);
  try {
    await revalidateImportPreviewRows();
    const afterInvalid = Number(importPreviewCache.invalidRows || 0);
    const appliedCount = (importAiRepairState.suggestions || []).filter((fix) => normalizeImportRepairStatus(fix.status) === 'applied').length;
    importAiRepairState.lastApplySummary = `Before invalid: ${beforeInvalid} | After invalid: ${afterInvalid} | Fixes applied: ${appliedCount} | Remaining errors: ${afterInvalid}.`;
    renderImportRepairSuggestions();
    if (summaryEl) {
      summaryEl.textContent = `Preview revalidated. Invalid rows: ${afterInvalid}.`;
      summaryEl.className = `small mb-2 ${afterInvalid ? 'text-warning' : 'text-success'}`;
    }
    showMessage('Preview revalidated successfully.', 'success');
  } catch (error) {
    if (summaryEl) {
      summaryEl.textContent = 'Preview revalidation failed.';
      summaryEl.className = 'small mb-2 text-danger';
    }
    showMessage(error.message || 'Failed to revalidate preview rows.', 'error');
  }
};

window.runImportAiInvoiceMatch = async () => {
  const summaryEl = document.getElementById('importAiRepairSummary');
  if (!importPreviewCache || !Array.isArray(importPreviewCache.normalizedRows) || !importPreviewCache.normalizedRows.length) {
    showMessage('Run preview first before invoice matching.', 'warning');
    return;
  }
  if (summaryEl) {
    summaryEl.textContent = 'Running AI invoice/warranty matching...';
    summaryEl.className = 'small text-muted mb-2';
  }
  try {
    const result = await postInventoryJson('/assets/import/ai-match-invoice', {
      extractedRows: importPreviewCache.normalizedRows,
    });
    const matches = Array.isArray(result?.matches) ? result.matches : [];
    const unmatchedItems = Array.isArray(result?.unmatchedItems) ? result.unmatchedItems : [];
    const warnings = formatImportMessages(Array.isArray(result?.warnings) ? result.warnings : [], 'warning');
    if (summaryEl) {
      summaryEl.textContent = `${result?.summary || 'Invoice matching completed.'} Matches: ${matches.length}. Unmatched: ${unmatchedItems.length}. ${warnings.length ? `Warnings: ${warnings.slice(0, 3).join(' | ')}` : ''}`;
      summaryEl.className = `small mb-2 ${matches.length ? 'text-success' : 'text-warning'}`;
    }
    showMessage(matches.length
      ? `Invoice matching suggested ${matches.length} update(s). Review before applying.`
      : 'Invoice matching completed with no confident matches.', matches.length ? 'success' : 'warning');
  } catch (error) {
    if (summaryEl) {
      summaryEl.textContent = 'AI invoice matching failed.';
      summaryEl.className = 'small mb-2 text-danger';
    }
    showMessage(error.message || 'Failed to run AI invoice matching.', 'error');
  }
};

window.previewDocumentImportRows = async () => {
  const textInput = document.getElementById('importDocumentText');
  const summary = document.getElementById('importDocumentSummary');
  const documentText = String(textInput?.value || '').trim();
  if (!documentText) {
    showMessage('Paste document text first.', 'warning');
    return;
  }
  if (summary) summary.textContent = 'Extracting candidate rows from document text...';
  try {
    const preview = await postInventoryJson('/assets/import/pdf-preview', {
      filename: 'document.txt',
      documentText,
    });
    importPreviewCache = preview;
    setImportPreviewUiState(importPreviewCache);
    resetImportRepairState();
    if (summary) {
      summary.textContent = `${preview.sourceDocumentSummary || 'Extraction completed.'} Confidence: ${Math.round(Number(preview.confidence || 0) * 100)}%.`;
      summary.className = 'small text-muted mt-2';
    }
    showMessage('Document extraction preview ready. Review rows before confirming import.', 'success');
  } catch (error) {
    if (summary) {
      summary.textContent = 'Document extraction failed.';
      summary.className = 'small text-danger mt-2';
    }
    showMessage(error.message || 'Failed to extract import rows from document text.', 'error');
  }
};

window.commitImportAssets = async () => {
  const summary = document.getElementById('importCommitSummary');
  const postCommitActions = document.getElementById('importPostCommitActions');
  const commitBtn = document.getElementById('commitImportBtn');
  const originalCommitBtnHtml = commitBtn?.innerHTML || 'Confirm Import';
  let keepCommitDisabled = false;
  if (!importPreviewCache || !Array.isArray(importPreviewCache.normalizedRows)) {
    showMessage('Run preview first.', 'warning');
    return;
  }
  if (!importPreviewCache.canImport) {
    showMessage('Import cannot proceed while preview has errors.', 'error');
    return;
  }
  if (commitBtn) {
    commitBtn.disabled = true;
    commitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Importing...';
  }
  try {
    const filename = importPreviewCache.filename || (document.getElementById('importAssetsFile')?.files?.[0]?.name || 'import.csv');
    const result = await postInventoryJson('/assets/import/commit', {
      filename,
      normalizedRows: importPreviewCache.normalizedRows,
    });
    const parentAssets = Number(result.createdParentAssets || 0);
    const componentsLinked = Number(result.createdComponents || 0);
    const accessoryAssets = Number(result.createdAccessoryAssets || 0);
    const licenseAssets = Number(result.createdLicenseAssets || 0);
    const consumablesCreated = Number(result.createdConsumableAssets || 0);
    const accessoryLinks = Number(result.createdAccessoryLinks || 0);
    const licenseLinks = Number(result.createdLicenseLinks || 0);
    const spareStockUpdated = Number(result.createdSpareStockItems || 0);
    const skippedRows = Array.isArray(result.skippedRows) ? result.skippedRows : [];
    const rowErrors = formatImportMessages(Array.isArray(result.errors) ? result.errors : [], 'error');
    const warnings = formatImportMessages(Array.isArray(result.warnings) ? result.warnings : [], 'warning');
    const failedRows = skippedRows.length + rowErrors.length;
    const importBatchId = String(result.importBatchId || '-').trim() || '-';
    const importTimestamp = result.importTimestamp
      ? new Date(result.importTimestamp).toLocaleString()
      : new Date().toLocaleString();

    lastImportCommitMeta = {
      importBatchId,
      importTimestamp,
      filename,
    };

    if (summary) {
      summary.innerHTML = `
        <div class="fw-semibold ${result.success ? 'text-success' : 'text-warning'}">Import ${result.success ? 'completed' : 'finished with issues'}.</div>
        <div class="small text-muted mt-1">Batch ID: <code>${UI.escapeHTML(importBatchId)}</code> | Imported at: ${UI.escapeHTML(importTimestamp)}</div>
        <div class="small mt-1">Parent assets created: <strong>${UI.escapeHTML(String(parentAssets))}</strong></div>
        <div class="small">Components linked: <strong>${UI.escapeHTML(String(componentsLinked))}</strong></div>
        <div class="small">Accessories created: <strong>${UI.escapeHTML(String(accessoryAssets))}</strong> (linked: ${UI.escapeHTML(String(accessoryLinks))})</div>
        <div class="small">Licenses created: <strong>${UI.escapeHTML(String(licenseAssets))}</strong> (linked: ${UI.escapeHTML(String(licenseLinks))})</div>
        <div class="small">Consumables created: <strong>${UI.escapeHTML(String(consumablesCreated))}</strong></div>
        <div class="small">Spare stock rows updated/created: <strong>${UI.escapeHTML(String(spareStockUpdated))}</strong></div>
        <div class="small">Warnings: <strong>${UI.escapeHTML(String(warnings.length))}</strong> | Failed rows: <strong>${UI.escapeHTML(String(failedRows))}</strong></div>
        ${
          warnings.length
            ? `<div class="small text-muted mt-1"><strong>Warnings:</strong> ${UI.escapeHTML(warnings.slice(0, 4).join(' | '))}</div>`
            : ''
        }
      `;
      summary.className = `small mt-2 ${result.success ? 'text-success' : 'text-danger'}`;
    }
    if (postCommitActions) {
      postCommitActions.classList.remove('d-none');
      postCommitActions.dataset.importBatchId = importBatchId;
      postCommitActions.dataset.importedAt = importTimestamp;
    }
    keepCommitDisabled = true;
    const summaryMessage = `Import ${result.success ? 'completed' : 'finished with issues'}. Batch: ${importBatchId}. Parent: ${parentAssets}, Components linked: ${componentsLinked}, Accessories linked: ${accessoryLinks}, Licenses linked: ${licenseLinks}, Consumables: ${consumablesCreated}, Spare stock: ${spareStockUpdated}.`;
    showMessage(summaryMessage, result.success ? 'success' : 'warning');
    if (result.success) {
      if (importPreviewCache) importPreviewCache.canImport = false;
      const refreshTasks = [
        loadAssets(),
        window.loadSpareStock(),
      ];
      if (cmdbState.assetId) refreshTasks.push(refreshCmdbModal(cmdbState.assetId, cmdbState.activeTab || 'components'));
      if (groupCmdbState.groupName) refreshTasks.push(refreshGroupCmdbModal());
      const outcomes = await Promise.allSettled(refreshTasks);
      const failedRefresh = outcomes.some((item) => item.status === 'rejected');
      if (failedRefresh) {
        showMessage('Import completed, but some refresh calls failed. Reload if data looks stale.', 'warning');
      }
    }
  } catch (error) {
    showMessage(error.message || 'Failed to commit import.', 'error');
  } finally {
    if (commitBtn) {
      commitBtn.innerHTML = originalCommitBtnHtml;
      commitBtn.disabled = keepCommitDisabled ? true : !importPreviewCache?.canImport;
    }
  }
};

window.viewImportedAssetsAfterCommit = async () => {
  setInventoryView('parents');
  const modalEl = document.getElementById('importAssetsModal');
  if (modalEl) {
    const modal = bootstrap.Modal.getInstance(modalEl) || bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.hide();
  }
  await loadAssets();
  if (lastImportCommitMeta?.importBatchId) {
    showMessage(`Showing latest inventory view after import batch ${lastImportCommitMeta.importBatchId}.`, 'info');
  }
};

window.importAnotherFileAfterCommit = () => {
  resetImportAssetsState();
  const fileInput = document.getElementById('importAssetsFile');
  if (fileInput) fileInput.focus();
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
    const overwrite = await confirmInventoryAction({
      title: 'Replace Existing Specs',
      message: 'Technical Specs already contain text. Replace with AI-generated specs?',
      confirmText: 'Replace',
      confirmClass: 'inventory-insight-warning',
      type: 'warning',
    });
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

    const transferOptions = getTransferRelatedOptionsFromForm();
    const isBulk = Boolean(transferSelectionState.isBulk);
    const selectedIds = Array.from(new Set(transferSelectionState.targetAssetIds || []));
    const transferAssetQuantity = async (assetId, destType, destination, quantityToMove, label, includeRelatedOnCall) => {
      const transferData = {
        destType,
        destination,
        quantityToMove,
        includeRelated: includeRelatedOnCall && transferOptions.includeRelated,
        includeComponents: transferOptions.includeComponents,
        includeAccessories: transferOptions.includeAccessories,
        includeLicenses: transferOptions.includeLicenses,
        includeConsumables: transferOptions.includeConsumables,
      };
      const response = await inventoryRequest(`/assets/${assetId}/transfer`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transferData),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || `${label} transfer failed for ${assetId}`);
      }
      return response.json().catch(() => ({}));
    };
    const allTransferPayloads = [];

    if (!isBulk) {
      const selectedAsset = currentAssets.find(a => a.customId === selectedAssetCustomId);
      if (!selectedAsset) throw new Error('Selected asset not found on current page.');
      const maxQuantity = getAssetQuantity(selectedAsset);
      if (quantity > maxQuantity) {
        throw new Error(`Only ${maxQuantity} unit(s) are available to transfer.`);
      }
      const includeRelatedOnDept = !buildingChecked || deptChecked;
      if (buildingChecked) {
        const payload = await transferAssetQuantity(selectedAssetCustomId, 'building', buildingValue, quantity, 'Building', !deptChecked);
        allTransferPayloads.push(payload);
      }

      if (deptChecked) {
        const payload = await transferAssetQuantity(selectedAssetCustomId, 'department', deptValue, quantity, 'Department', includeRelatedOnDept);
        allTransferPayloads.push(payload);
      }
    } else {
      const groupAssets = currentAssets.filter((asset) => selectedIds.includes(asset.customId));
      const maxQuantity = getAssetsTotalQuantity(groupAssets);
      if (quantity > maxQuantity) {
        throw new Error(`Only ${maxQuantity} unit(s) are available to transfer.`);
      }

      let remainingQuantity = quantity;
      for (const asset of groupAssets) {
        if (remainingQuantity <= 0) break;
        const quantityToMove = Math.min(remainingQuantity, getAssetQuantity(asset));
        if (buildingChecked) {
          const payload = await transferAssetQuantity(asset.customId, 'building', buildingValue, quantityToMove, `Building (${asset.customId})`, !deptChecked);
          allTransferPayloads.push(payload);
        }

        if (deptChecked) {
          const payload = await transferAssetQuantity(asset.customId, 'department', deptValue, quantityToMove, `Department (${asset.customId})`, true);
          allTransferPayloads.push(payload);
        }
        remainingQuantity -= quantityToMove;
      }
    }

    const transferModal = bootstrap.Modal.getInstance(document.getElementById('transferModal'));
    if (transferModal) transferModal.hide();

    const touchedIds = [];
    allTransferPayloads.forEach((payload) => {
      const assetsFromPayload = collectAssetsFromTransferResponse(payload);
      touchedIds.push(...applyTransferredAssetsToLocalState(assetsFromPayload));
    });
    const uniqueTouched = Array.from(new Set(touchedIds));
    if (uniqueTouched.length) {
      refreshDerivedStateForAssets(uniqueTouched).catch(() => {});
    }
    const mapModalEl = document.getElementById('inventoryAssetMapModal');
    if (mapModalEl && mapModalEl.classList.contains('show')) {
      window.loadInventoryMapAssets(true).catch(() => {});
    }
    const relatedSummaries = allTransferPayloads
      .map((payload) => String(payload?.relatedTransferSummary || '').trim())
      .filter(Boolean);
    const relatedSummary = relatedSummaries.length ? ` ${relatedSummaries[relatedSummaries.length - 1]}` : '';
    showMessage(`Transfer completed successfully.${relatedSummary}`, 'success');
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
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
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

  // Ã°Å¸Ââ€º FIX: Dynamically maps the global jsPDF regardless of ES6 module restrictions
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
      `Location: ${getAssetDisplayLocation(asset)}`,
      `Department: ${getAssetDisplayDepartment(asset)}`,
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
        const specText = `- ${key}: ${value}`;
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

window.generateEOLReport = async function() {
  const form = await showInventoryFormModal({
    title: 'Generate EOL Budget Report',
    confirmText: 'Generate Report',
    confirmClass: 'btn-primary',
    dialogClass: 'modal-lg',
    fields: [
      {
        name: 'monthsAhead',
        label: 'EOL Horizon (months)',
        type: 'number',
        value: 12,
        min: 1,
        step: 1,
        required: true,
        colClass: 'col-md-4',
      },
      {
        name: 'department',
        label: 'Department Filter',
        type: 'select',
        options: ['all', ...getKnownDepartmentOptions()],
        value: String(document.getElementById('filterDept')?.value || 'all'),
        required: false,
        colClass: 'col-md-4',
      },
      {
        name: 'location',
        label: 'Location Filter',
        type: 'select',
        options: ['all', ...getKnownBuildingOptions()],
        value: String(document.getElementById('filterBuilding')?.value || 'all'),
        required: false,
        colClass: 'col-md-4',
      },
      {
        name: 'type',
        label: 'Type Filter',
        type: 'select',
        options: [
          { value: 'all', label: 'All Types' },
          ...((ASSET_TYPES || [])
            .filter((entry) => entry?.value)
            .map((entry) => ({ value: entry.value, label: entry.label || entry.value }))),
        ],
        value: String(document.getElementById('filterType')?.value || 'all'),
        required: false,
        colClass: 'col-md-6',
      },
    ],
  });
  if (!form?.confirmed) return;
  const monthsAhead = Number(form.values.monthsAhead) > 0 ? Number(form.values.monthsAhead) : 12;
  const departmentInput = String(form.values.department || 'all');
  const locationInput = String(form.values.location || 'all');
  const typeInput = String(form.values.type || 'all');
  const payload = {
    monthsAhead,
    department: departmentInput && departmentInput !== 'all' ? toBackendDepartmentFilterValue(departmentInput) : null,
    location: locationInput && locationInput !== 'all' ? locationInput : null,
    type: typeInput && typeInput !== 'all' ? typeInput : null,
  };
  try {
    const report = await postInventoryJson('/inventory/eol-budget-report', payload);
    const rows = Array.isArray(report?.rows) ? report.rows : [];
    const missingCost = Array.isArray(report?.missingCostRows) ? report.missingCostRows : [];
    const recommendations = Array.isArray(report?.recommendations) ? report.recommendations : [];
    const lines = [
      'OpsMind Predictive EOL Budget Report',
      `Generated: ${new Date().toLocaleString()}`,
      `Summary: ${report?.summary || '-'}`,
      `Range: ${report?.totals?.range || '-'}`,
      `Matched Assets: ${report?.totals?.matchedAssets ?? 0}`,
      `Estimated Budget: ${report?.totals?.estimatedBudget ?? 0}`,
      `Missing Cost Data: ${report?.totals?.missingCostAssets ?? 0}`,
      '',
      'Department Breakdown:',
      ...Object.entries(report?.breakdowns?.byDepartment || {}).map(([key, value]) => `- ${key}: ${value}`),
      '',
      'Location Breakdown:',
      ...Object.entries(report?.breakdowns?.byLocation || {}).map(([key, value]) => `- ${key}: ${value}`),
      '',
      'Category Breakdown:',
      ...Object.entries(report?.breakdowns?.byCategory || {}).map(([key, value]) => `- ${key}: ${value}`),
      '',
      'Top EOL Rows:',
      ...rows.slice(0, 50).map((row) => `- ${row.assetName} (${row.assetId}) | ${row.department} | ${row.location} | EOL: ${row.eolDate?.slice(0, 10) || '-'} | Risk: ${row.riskLevel} | Replacement Cost: ${row.estimatedReplacementCost ?? 'cost data missing'}`),
      '',
      'Missing Cost Data Assets:',
      ...missingCost.slice(0, 50).map((row) => `- ${row.assetName} (${row.assetId}) | ${row.department} | ${row.location}`),
      '',
      'Recommended Actions:',
      ...recommendations.map((item) => `- ${item}`),
    ];
    const reportText = lines.join('\n');
    const encoded = encodeURIComponent(reportText);
    const anchor = document.createElement('a');
    anchor.href = `data:text/plain;charset=utf-8,${encoded}`;
    anchor.download = `opsmind_eol_budget_report_${new Date().toISOString().slice(0, 10)}.txt`;
    anchor.click();
    showMessage(`EOL budget report generated for ${rows.length} asset(s).`, 'success');
  } catch (error) {
    showMessage(error.message || 'Failed to generate EOL budget report.', 'error');
  }
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

function getAssetPredictionLabel(asset) {
  const categoryRaw = String(asset?.category || '').trim().toLowerCase();
  const categoryLabels = {
    component: 'Component',
    accessory: 'Accessory',
    consumable: 'Consumable',
    license: 'License',
    spare_part: 'Spare Stock',
    asset: ''
  };
  const typeLabel = formatType(asset?.type);
  if (typeLabel && normalizeValue(typeLabel) !== normalizeValue('electronics')) return typeLabel;
  const specs = getAssetSpecs(asset);
  const registryLabel = String(specs.assetTypeRegistryLabel || '').trim();
  if (registryLabel && normalizeValue(registryLabel) !== normalizeValue('electronics')) return registryLabel;
  const componentTypeLabel = normalizeComponentTypeLabel(specs.componentType || '');
  if (componentTypeLabel) return componentTypeLabel;
  return categoryLabels[categoryRaw] || 'Asset';
}

function isEolRelevantAsset(asset) {
  const category = getAssetCategoryKey(asset);
  if (category === 'consumable' || category === 'license' || category === 'spare_part') return false;
  return true;
}

const COMPONENT_TYPE_KEYWORDS = [
  'ram', 'memory', 'ssd', 'hdd', 'storage', 'cpu', 'processor', 'gpu', 'motherboard',
  'psu', 'power_supply', 'battery', 'network', 'nic', 'toner', 'lamp', 'charger',
  'fan', 'heatsink', 'nvme', 'card', 'module'
];

function normalizeComponentTypeLabel(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) return '';
  const labels = {
    ram: 'RAM',
    memory: 'RAM',
    storage: 'Storage',
    ssd: 'SSD',
    hdd: 'HDD',
    cpu: 'CPU',
    processor: 'CPU',
    gpu: 'GPU',
    motherboard: 'Motherboard',
    psu: 'PSU',
    power_supply: 'PSU',
    battery: 'Battery',
    network_card: 'Network Card',
    nic: 'Network Card',
    toner: 'Toner',
    lamp: 'Lamp',
  };
  return labels[normalized] || normalized.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function inferComponentTypeFromAsset(asset) {
  const specs = getAssetSpecs(asset);
  const explicit = String(
    asset?.componentType
    || asset?.component_type
    || specs.componentType
    || specs.component_type
    || ''
  ).trim();
  if (explicit) return normalizeComponentTypeLabel(explicit);
  const text = `${asset?.name || ''} ${asset?.type || ''}`.toLowerCase();
  const match = COMPONENT_TYPE_KEYWORDS.find((keyword) => text.includes(keyword.replace(/_/g, ' ')) || text.includes(keyword));
  return match ? normalizeComponentTypeLabel(match) : '';
}

function inferAccessoryTypeFromAsset(asset) {
  const specs = getAssetSpecs(asset);
  const explicit = String(specs.accessoryType || specs.type || '').trim();
  if (explicit) return normalizeComponentTypeLabel(explicit);
  return normalizeComponentTypeLabel(formatType(asset?.type || asset?.name || 'Accessory'));
}

function inferConsumableTypeFromAsset(asset) {
  const specs = getAssetSpecs(asset);
  const explicit = String(specs.consumableType || specs.componentType || specs.type || '').trim();
  if (explicit) return normalizeComponentTypeLabel(explicit);
  return normalizeComponentTypeLabel(formatType(asset?.type || asset?.name || 'Consumable'));
}

function inferLicenseTypeFromAsset(asset) {
  const specs = getAssetSpecs(asset);
  const explicit = String(specs.licenseType || specs.softwareName || '').trim();
  if (explicit) return normalizeComponentTypeLabel(explicit);
  const name = String(asset?.name || '').trim();
  if (name) return normalizeComponentTypeLabel(name);
  return 'License';
}

function normalizeRegistryKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function getComponentRegistryOptionsForAsset(asset) {
  const specs = getAssetSpecs(asset);
  const registryKey = normalizeRegistryKey(
    specs.assetTypeRegistryKey
    || inferComponentTypeFromAsset(asset)
    || canonicalType(asset?.type || '')
  );
  const specific = COMPONENT_TYPE_REGISTRY_BY_PARENT?.[registryKey];
  const fallbackByType = COMPONENT_TYPE_REGISTRY_BY_PARENT?.[canonicalType(asset?.type || '')];
  const fallback = COMPONENT_TYPE_REGISTRY_BY_PARENT?.default;
  const options = specific || fallbackByType || fallback || [];
  return Array.isArray(options) ? options : [];
}

function getInstalledParentInfo(asset) {
  const specs = getAssetSpecs(asset);
  const parentId = String(
    asset?.installedParentCustomId
    || asset?.installedParentAssetId
    || asset?.relatedParentCustomId
    || asset?.assignedToAssetCustomId
    || specs.installedInAssetId
    || specs.usedWithAssetId
    || specs.assignedToAssetId
    || ''
  ).trim();
  const parentTag = String(
    asset?.installedParentAssetTag
    || asset?.relatedParentAssetTag
    || asset?.assignedToAssetAssetTag
    || specs.installedInAssetTag
    || specs.usedWithAssetTag
    || specs.assignedToAssetTag
    || ''
  ).trim();
  const parentName = String(
    asset?.installedParentName
    || asset?.relatedParentName
    || asset?.assignedToAssetName
    || specs.installedInAssetName
    || specs.usedWithAssetName
    || specs.assignedToAssetName
    || ''
  ).trim();
  return {
    parentId,
    parentTag,
    parentName,
    hasParent: Boolean(parentId || parentTag || parentName),
  };
}

function isInstalledComponentAsset(asset) {
  const installedParent = getInstalledParentInfo(asset);
  const isComponentCategory = getAssetCategoryKey(asset) === 'component';
  const inferredComponentType = inferComponentTypeFromAsset(asset);
  const nonComponentCategory = isAccessoryAsset(asset) || isConsumableAsset(asset) || isLicenseAsset(asset) || isSparePartAsset(asset);
  return installedParent.hasParent && (
    isComponentCategory
    || Boolean(asset?.isComponentAsset)
    || (!nonComponentCategory && Boolean(inferredComponentType))
  );
}

function isParentViewAsset(asset) {
  if (isInstalledComponentAsset(asset)) return false;
  if (isAccessoryAsset(asset) || isConsumableAsset(asset) || isLicenseAsset(asset) || isSparePartAsset(asset)) return false;
  return true;
}

function isAccessoryViewAsset(asset) {
  return isAccessoryAsset(asset);
}

function isConsumableViewAsset(asset) {
  return isConsumableAsset(asset);
}

function isLicenseViewAsset(asset) {
  return isLicenseAsset(asset);
}

function getAssetsForInventoryView(view = currentInventoryView) {
  return getAssetsForInventoryViewFromList(currentAssets, view);
}

function getAssetsForCurrentInventoryView() {
  return getAssetsForInventoryView(currentInventoryView);
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
