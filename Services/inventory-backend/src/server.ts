import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { prisma } from './lib/prisma';
import AssetService from './models/Assets';
import HistoryService from './models/History';
import TicketService from './models/Tickets';
import { EventBus } from './services/EventBus';
import { TOPICS } from './events/assetEvents';
import ticketRoutes from './routes/ticketRoutes';
import configRoutes from './routes/configRoutes';
import inventoryAiReadinessRoutes from './routes/inventoryAiReadinessRoutes';
import {
    EOL_METRICS,
    ASSET_TYPES,
    COMPONENT_TYPE_REGISTRY_BY_PARENT,
    ACCESSORY_TYPES,
    CONSUMABLE_TYPES,
    SPARE_STOCK_TYPES,
    LICENSE_TYPES,
} from './config/constants';
import { notificationService } from './services/NotificationService';
import {
    getLatestPersistedLifespanPrediction,
    getLatestSpecSnapshot,
    getLatestTelemetrySample,
    persistEolAssessment,
    persistLifespanPrediction,
    persistSpecSnapshot,
    persistTelemetrySample,
} from './services/asset-ai-canonical';
import { getAssetTypeSpecProfile, lookupVerifiedSpecs } from './services/asset-intelligence/specDatasetService';
import { lookupUserConfirmedSpecs } from './services/asset-intelligence/userConfirmedSpecsService';
import { lookupTrustedSourceSpecs } from './services/asset-intelligence/sourceLookupService';
import { enqueueInitialAssetCreatedJobs, readAssetPipelineSummary, InventoryAiJobQueue } from './services/asset-ai-jobs';
import {
    Asset,
    AssetType,
    AssetStatus,
    AssetLocation,
    AssetDepartment,
    AssetCategory,
    AssetLifecycleStatus,
    AssetCustodyStatus,
    Prisma,
} from '@prisma/client';
import { requireInventoryAdminAccess, requireInventoryReadAccess } from './middlewares/inventoryAuth';

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const INVENTORY_AI_SERVICE_URL = process.env.INVENTORY_AI_SERVICE_URL || 'http://localhost:8002';
const SPEC_VERIFICATION_CONFIDENCE_THRESHOLD = Number(process.env.SPEC_VERIFICATION_CONFIDENCE_THRESHOLD || 0.85);
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3002';
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || '';
const LIFESPAN_IMPACT_MIN_HOURS = Math.max(0.5, Number(process.env.LIFESPAN_IMPACT_MIN_HOURS || 2));
const LIFESPAN_IMPACT_MIN_YEAR_DELTA = Math.max(0.05, Number(process.env.LIFESPAN_IMPACT_MIN_YEAR_DELTA || 0.1));
const LIFESPAN_IMPACT_MIN_RISK_DELTA = Math.max(0.01, Number(process.env.LIFESPAN_IMPACT_MIN_RISK_DELTA || 0.03));
const INVENTORY_ENFORCE_AUTH = String(process.env.INVENTORY_ENFORCE_AUTH || 'false').toLowerCase() === 'true';

class RequestValidationError extends Error {}

const passthroughGuard: RequestHandler = (_req, _res, next) => next();
const inventoryReadGuard: RequestHandler = INVENTORY_ENFORCE_AUTH ? requireInventoryReadAccess : passthroughGuard;
const inventoryAdminGuard: RequestHandler = INVENTORY_ENFORCE_AUTH ? requireInventoryAdminAccess : passthroughGuard;

const internalWorkerGuard: RequestHandler = (req, res, next) => {
    const expected = String(INTERNAL_API_TOKEN || '').trim();
    if (!expected) return next();
    const provided = String(req.headers['x-internal-token'] || '').trim();
    if (provided !== expected) {
        return res.status(403).json({ message: 'Forbidden' });
    }
    return next();
};

// ✅ FIXED: REMOVED HARDCODED OVERRIDE
if (!process.env.RABBITMQ_URI) {
    console.warn("⚠️ No RABBITMQ_URI found in ENV. Defaulting to localhost.");
    process.env.RABBITMQ_URI = "amqp://admin:password123@localhost:5672";
}

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// --- REQUEST LOGGER ---
app.use((req: Request, res: Response, next: NextFunction) => {
    console.log(`📡 [${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// --- DATABASE CONNECTION ---
// Prisma handles connection automatically via DATABASE_URL env var
console.log('✅ [API] Prisma Client initialized');

// --- ENUM MAPPING HELPERS ---
function mapToAssetType(value: string): AssetType {
    const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const typeMap: Record<string, AssetType> = {
        laptop: 'LAPTOP',
        desktop: 'DESKTOP',
        desktop_pc: 'DESKTOP',
        workstation: 'DESKTOP',
        thin_client: 'DESKTOP',
        lab_computer: 'DESKTOP',
        library_pc: 'DESKTOP',
        tablet: 'TABLET',
        ipad: 'TABLET',
        server: 'SERVER',
        nas_storage: 'SERVER',
        nvr_dvr: 'SERVER',
        monitor: 'MONITOR',
        peripheral: 'PERIPHERAL',
        external_storage_device: 'PERIPHERAL',
        keyboard: 'KEYBOARD',
        electronics: 'ELECTRONICS',
        ups: 'ELECTRONICS',
        network_rack: 'ELECTRONICS',
        ip_phone: 'ELECTRONICS',
        biometric_attendance_device: 'ELECTRONICS',
        self_check_machine: 'ELECTRONICS',
        blood_pressure_monitor: 'ELECTRONICS',
        thermometer: 'ELECTRONICS',
        first_aid_kit: 'ELECTRONICS',
        medical_refrigerator: 'ELECTRONICS',
        projector: 'PROJECTOR',
        smartboard: 'SMARTBOARD',
        interactive_display: 'SMARTBOARD',
        camera: 'CAMERA',
        cctv_camera: 'CAMERA',
        document_camera: 'CAMERA',
        lecture_capture_device: 'CAMERA',
        speaker: 'SPEAKER',
        speaker_system: 'SPEAKER',
        amplifier: 'SPEAKER',
        microphone: 'MICROPHONE',
        router: 'ROUTER',
        switch: 'SWITCH',
        network_switch: 'SWITCH',
        access_point: 'ACCESS_POINT',
        firewall: 'FIREWALL',
        firewall_appliance: 'FIREWALL',
        printer: 'PRINTER',
        photocopier: 'PRINTER',
        scanner: 'SCANNER',
        barcode_scanner: 'SCANNER',
        rfid_reader: 'SCANNER',
        book_scanner: 'SCANNER',
        desk: 'DESK',
        chair: 'CHAIR',
        whiteboard: 'WHITEBOARD',
        notice_board: 'WHITEBOARD',
        filing_cabinet: 'FILING_CABINET',
        furniture: 'FURNITURE',
        podium: 'FURNITURE',
        meeting_table: 'FURNITURE',
        bookshelf: 'FURNITURE',
        locker: 'FURNITURE',
        wheelchair: 'FURNITURE',
        examination_bed: 'FURNITURE',
        microscope: 'MICROSCOPE',
        centrifuge: 'CENTRIFUGE',
        oscilloscope: 'OSCILLOSCOPE',
        function_generator: 'OSCILLOSCOPE',
        '3d_printer': 'THREE_D_PRINTER',
        lab_bench: 'LAB_BENCH',
        vehicle: 'VEHICLE',
        university_vehicle: 'VEHICLE',
        golf_cart: 'VEHICLE',
        bus: 'VEHICLE',
        van: 'VEHICLE',
        car: 'VEHICLE',
        generator: 'GENERATOR',
        hvac: 'HVAC',
        hvac_unit: 'HVAC',
        air_conditioner: 'HVAC',
        maintenance_tool: 'MAINTENANCE_TOOL',
        multimeter: 'MAINTENANCE_TOOL',
        power_tool: 'MAINTENANCE_TOOL',
        tool_kit: 'MAINTENANCE_TOOL',
        cleaning_machine: 'MAINTENANCE_TOOL',
        laser_cutter: 'MAINTENANCE_TOOL',
        cnc_machine: 'MAINTENANCE_TOOL',
    };
    return typeMap[normalized] || 'ELECTRONICS';
}

function mapToAssetStatus(value: string): AssetStatus {
    const statusMap: Record<string, AssetStatus> = {
        'active': 'ACTIVE',
        'repair': 'REPAIR',
        'retired': 'RETIRED',
        'assigned': 'ASSIGNED',
        'maintenance': 'MAINTENANCE'
    };
    return statusMap[value] || 'ACTIVE';
}

function mapToLifecycleStatus(value: unknown): AssetLifecycleStatus {
    const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const lifecycleMap: Record<string, AssetLifecycleStatus> = {
        in_stock: 'IN_STOCK',
        assigned: 'ASSIGNED',
        in_use: 'IN_USE',
        under_maintenance: 'UNDER_MAINTENANCE',
        pending_repair: 'PENDING_REPAIR',
        in_transit: 'IN_TRANSIT',
        reserved: 'RESERVED',
        retired: 'RETIRED',
        disposed: 'DISPOSED',
        lost_stolen: 'LOST_STOLEN',
        eol_expired: 'EOL_EXPIRED',
    };
    return lifecycleMap[normalized] || 'IN_STOCK';
}

function mapToAssetCategory(value: unknown): AssetCategory {
    const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const categoryMap: Record<string, AssetCategory> = {
        asset: 'ASSET',
        component: 'COMPONENT',
        accessory: 'ACCESSORY',
        consumable: 'CONSUMABLE',
        license: 'LICENSE',
        spare_part: 'SPARE_PART',
        spare_stock: 'SPARE_PART',
    };
    return categoryMap[normalized] || 'ASSET';
}

function mapToCustodyStatus(value: unknown): AssetCustodyStatus {
    const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const custodyMap: Record<string, AssetCustodyStatus> = {
        unassigned: 'UNASSIGNED',
        checked_out: 'CHECKED_OUT',
        returned: 'RETURNED',
    };
    return custodyMap[normalized] || 'UNASSIGNED';
}

function normalizeLocationToken(value: unknown): string {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const LOCATION_ALIAS_REGISTRY: Array<{
    key: string;
    location: AssetLocation;
    friendlyName: string;
    aliases: string[];
}> = [
    {
        key: 'central_warehouse',
        location: 'CENTRAL_WAREHOUSE',
        friendlyName: 'Central Warehouse',
        aliases: [
            'central warehouse',
            'central_warehouse',
            'warehouse',
            'main warehouse',
            'warehouse staging',
        ],
    },
    {
        key: 'main',
        location: 'MAIN_BUILDING',
        friendlyName: 'Main Building',
        aliases: ['main', 'main building', 'building main', 'main block'],
    },
    {
        key: 'k',
        location: 'K_BUILDING',
        friendlyName: 'K Building',
        aliases: ['k', 'k building', 'building k', 'k_block'],
    },
    {
        key: 'n',
        location: 'N_BUILDING',
        friendlyName: 'N Building',
        aliases: ['n', 'n building', 'building n', 'n_block'],
    },
    {
        key: 's',
        location: 'S_BUILDING',
        friendlyName: 'S Building',
        aliases: ['s', 's building', 'building s', 's_block'],
    },
    {
        key: 'r',
        location: 'R_BUILDING',
        friendlyName: 'R Building',
        aliases: ['r', 'r building', 'building r', 'r_block'],
    },
    {
        key: 'pharmacy',
        location: 'PHARMACY_BUILDING',
        friendlyName: 'Pharmacy Building',
        aliases: ['pharmacy', 'pharmacy building', 'building pharmacy'],
    },
    {
        key: 'copy_center',
        location: 'CENTRAL_WAREHOUSE',
        friendlyName: 'Copy Center',
        aliases: ['copy center', 'copycenter', 'copy-centre', 'copy center building'],
    },
    {
        key: 'mosque',
        location: 'CENTRAL_WAREHOUSE',
        friendlyName: 'Mosque',
        aliases: ['mosque', 'university mosque'],
    },
    {
        key: 'workshop',
        location: 'CENTRAL_WAREHOUSE',
        friendlyName: 'Workshop',
        aliases: ['workshop', 'work shop'],
    },
];

const LOCATION_ALIAS_LOOKUP = new Map<string, {
    key: string;
    location: AssetLocation;
    friendlyName: string;
}>();
LOCATION_ALIAS_REGISTRY.forEach((entry) => {
    const mergedAliases = [entry.friendlyName, ...entry.aliases];
    mergedAliases.forEach((alias) => {
        const token = normalizeLocationToken(alias);
        if (!token) return;
        LOCATION_ALIAS_LOOKUP.set(token, {
            key: entry.key,
            location: entry.location,
            friendlyName: entry.friendlyName,
        });
    });
});

function resolveAssetLocationForStorage(value: unknown): {
    location: AssetLocation;
    mapLocationHint: string | null;
    matchedAlias: string | null;
    matchMethod: 'exact' | 'fallback' | null;
} {
    const raw = String(value || '').trim();
    if (!raw) {
        return {
            location: 'CENTRAL_WAREHOUSE',
            mapLocationHint: null,
            matchedAlias: null,
            matchMethod: null,
        };
    }
    const normalized = normalizeLocationToken(raw);
    const matched = LOCATION_ALIAS_LOOKUP.get(normalized);
    if (matched) {
        return {
            location: matched.location,
            mapLocationHint: matched.friendlyName,
            matchedAlias: raw,
            matchMethod: 'exact',
        };
    }
    return {
        location: 'CENTRAL_WAREHOUSE',
        mapLocationHint: raw,
        matchedAlias: null,
        matchMethod: 'fallback',
    };
}

function mapToAssetLocation(value: string): AssetLocation {
    return resolveAssetLocationForStorage(value).location;
}

function mapToAssetDepartment(value: string): AssetDepartment {
    const deptMap: Record<string, AssetDepartment> = {
        'Computer Science': 'COMPUTER_SCIENCE',
        'Engineering': 'ENGINEERING',
        'Architecture': 'ARCHITECTURE',
        'Business': 'BUSINESS',
        'Mass Comm': 'MASS_COMM',
        'Alsun': 'ALSUN',
        'Pharmacy': 'PHARMACY',
        'Dentistry': 'DENTISTRY',
        'Unassigned': 'UNASSIGNED',
        'General': 'GENERAL'
    };
    return deptMap[value] || 'UNASSIGNED';
}

function mapLocationToFriendly(value: AssetLocation | string): string {
    const mapping: Record<string, string> = {
        CENTRAL_WAREHOUSE: 'Central Warehouse',
        MAIN_BUILDING: 'Main Building',
        K_BUILDING: 'K Building',
        N_BUILDING: 'N Building',
        S_BUILDING: 'S Building',
        R_BUILDING: 'R Building',
        PHARMACY_BUILDING: 'Pharmacy Building',
    };
    return mapping[String(value || '').toUpperCase()] || String(value || '');
}

function isCentralWarehouseLocationValue(value: unknown): boolean {
    const token = normalizeLocationToken(value);
    return token === 'centralwarehouse'
        || token === 'mainwarehouse'
        || token === 'warehouse'
        || token === 'centralwarehousestaging';
}

function mapDepartmentToFriendly(value: AssetDepartment | string): string {
    const mapping: Record<string, string> = {
        COMPUTER_SCIENCE: 'Computer Science',
        ENGINEERING: 'Engineering',
        ARCHITECTURE: 'Architecture',
        BUSINESS: 'Business',
        MASS_COMM: 'Mass Comm',
        ALSUN: 'Alsun',
        PHARMACY: 'Pharmacy',
        DENTISTRY: 'Dentistry',
        UNASSIGNED: 'Unassigned',
        GENERAL: 'General',
    };
    return mapping[String(value || '').toUpperCase()] || String(value || '');
}

const MAX_ASSET_CREATION_QUANTITY = 500;

function parseRequestedQuantity(rawQuantity: unknown): number {
    const parsed = Number(rawQuantity);
    if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
        throw new RequestValidationError('Quantity must be a positive integer.');
    }
    if (parsed > MAX_ASSET_CREATION_QUANTITY) {
        throw new RequestValidationError(`Quantity must be <= ${MAX_ASSET_CREATION_QUANTITY}.`);
    }
    return parsed;
}

function parseBooleanFlag(value: unknown): boolean {
    if (value === true) return true;
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

function parseOptionalDateInput(value: unknown): Date | null {
    if (value === null || typeof value === 'undefined') return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function scheduleTransferLifespanRefresh(assetId: string) {
    Promise.resolve()
        .then(async () => {
            await refreshAndPersistAssetLifespan(assetId, {
                reason: 'asset_transferred',
                forcePersist: true,
            });
        })
        .catch((error: any) => {
            console.warn(`[InventoryAI] transfer lifespan refresh failed for ${assetId}: ${error.message}`);
        });
}

function parseOptionalNumberInput(value: unknown): number | null {
    if (value === null || typeof value === 'undefined' || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSerialValue(value: unknown): string | null {
    const serial = String(value || '').trim();
    return serial ? serial : null;
}

function parseSerialValues(rawList: unknown): string[] {
    if (Array.isArray(rawList)) {
        return rawList
            .map((value) => normalizeSerialValue(value))
            .filter((value): value is string => Boolean(value));
    }
    const text = String(rawList || '').trim();
    if (!text) return [];
    return text
        .split(/\r?\n|,/)
        .map((value) => normalizeSerialValue(value))
        .filter((value): value is string => Boolean(value));
}

function parseOptionalIntegerInput(value: unknown): number | null {
    if (value === null || typeof value === 'undefined' || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.trunc(parsed);
}

function normalizeNonNegativeInteger(value: unknown, fallback = 0): number {
    const parsed = parseOptionalIntegerInput(value);
    if (parsed === null || parsed < 0) return fallback;
    return parsed;
}

function parseJsonArrayInput(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .map((entry) => String(entry || '').trim())
            .filter(Boolean);
    }
    const raw = String(value || '').trim();
    if (!raw) return [];
    return raw
        .split(/\r?\n|,/)
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function readAssetSpecifications(asset: { specifications?: unknown }): Record<string, any> {
    if (!asset || typeof asset !== 'object') return {};
    if (!asset.specifications || typeof asset.specifications !== 'object' || Array.isArray(asset.specifications)) {
        return {};
    }
    return { ...(asset.specifications as Record<string, any>) };
}

function mergeAssetSpecifications(
    existing: unknown,
    patch: Record<string, any>,
): Record<string, any> {
    const base = (existing && typeof existing === 'object' && !Array.isArray(existing))
        ? { ...(existing as Record<string, any>) }
        : {};
    return {
        ...base,
        ...patch,
    };
}

function normalizeLocationForComparison(value: unknown): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return normalizeValue(mapLocationToFriendly(raw as any) || raw);
}

function computeWifiLocationMismatch(assetLocation: unknown, lastSeenLocation: unknown): boolean {
    const current = normalizeLocationForComparison(assetLocation);
    const seen = normalizeLocationForComparison(lastSeenLocation);
    if (!current || !seen) return false;
    return current !== seen;
}

function normalizeComponentStatus(value: unknown, fallback = 'installed'): string {
    const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const allowed = new Set([
        'in_stock',
        'installed',
        'under_repair',
        'failed',
        'removed',
        'replaced',
        'retired',
        'disposed',
    ]);
    if (!normalized) return fallback;
    return allowed.has(normalized) ? normalized : fallback;
}

function isLowStock(item: { quantityAvailable: number; minimumStockLevel: number; reorderPoint: number | null }): boolean {
    const threshold = item.reorderPoint !== null && item.reorderPoint >= 0
        ? item.reorderPoint
        : item.minimumStockLevel;
    return item.quantityAvailable <= threshold;
}

function mapComponentTypeToAssetType(componentType: unknown): AssetType {
    const normalized = String(componentType || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (['monitor'].includes(normalized)) return 'MONITOR';
    if (['keyboard'].includes(normalized)) return 'KEYBOARD';
    if (['router'].includes(normalized)) return 'ROUTER';
    if (['switch'].includes(normalized)) return 'SWITCH';
    if (['access_point', 'wifi_adapter', 'network_card', 'nic'].includes(normalized)) return 'ACCESS_POINT';
    if (['firewall'].includes(normalized)) return 'FIREWALL';
    if (['printer'].includes(normalized)) return 'PRINTER';
    if (['scanner'].includes(normalized)) return 'SCANNER';
    return 'ELECTRONICS';
}

async function generateComponentAssetCustomId(parentAssetId: string, componentType: string): Promise<string> {
    const prefix = String(componentType || 'component')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '')
        .slice(0, 8) || 'COMP';
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const suffix = Math.floor(10000 + (Math.random() * 90000));
        const candidate = `${parentAssetId}-${prefix}-${suffix}`;
        const existing = await prisma.asset.findUnique({ where: { customId: candidate }, select: { customId: true } });
        if (!existing) return candidate;
    }
    return `${parentAssetId}-${prefix}-${Date.now()}`;
}

async function updateChildAssetLinkMetadata(
    db: any,
    childAssetId: string,
    options: {
        lifecycleStatus: AssetLifecycleStatus;
        status: AssetStatus;
        parentAssetId?: string | null;
        parentAssetName?: string | null;
        parentAssetTag?: string | null;
        componentType?: string | null;
        clearInstalledIn?: boolean;
    }
): Promise<void> {
    const child = await db.asset.findUnique({ where: { customId: childAssetId } });
    if (!child) return;
    const currentSpecs = ((child.specifications as Record<string, any>) || {});
    const nextSpecs: Record<string, any> = {
        ...currentSpecs,
        componentType: options.componentType || currentSpecs.componentType || undefined,
    };
    if (options.clearInstalledIn) {
        nextSpecs.installedInAssetId = null;
        nextSpecs.installedInAssetName = null;
        nextSpecs.installedInAssetTag = null;
        nextSpecs.installedInRemovedAt = new Date().toISOString();
    } else {
        nextSpecs.installedInAssetId = options.parentAssetId || null;
        nextSpecs.installedInAssetName = options.parentAssetName || null;
        nextSpecs.installedInAssetTag = options.parentAssetTag || null;
        nextSpecs.installedInRemovedAt = null;
    }
    await db.asset.update({
        where: { customId: childAssetId },
        data: {
            category: 'COMPONENT',
            lifecycleStatus: options.lifecycleStatus,
            status: options.status,
            specifications: nextSpecs,
        }
    });
}

type ImportRecordType =
    | 'parent_asset'
    | 'component_asset'
    | 'embedded_component'
    | 'spare_stock'
    | 'accessory'
    | 'consumable'
    | 'license';

type NormalizedImportRow = {
    rowNumber: number;
    recordType: ImportRecordType | '';
    assetName: string;
    category: string;
    assetType: string;
    brand: string;
    model: string;
    serialNumber: string;
    assetTag: string;
    manufacturerPartNumber: string;
    location: string;
    department: string;
    status: string;
    lifecycleStatus: string;
    parentAssetTag: string;
    componentType: string;
    condition: string;
    quantity: number | null;
    minimumStockLevel: number | null;
    reorderPoint: number | null;
    vendor: string;
    purchaseDate: string;
    warrantyStartDate: string;
    warrantyEndDate: string;
    purchaseCost: number | null;
    assignedTo: string;
    notes: string;
    proposedAction: string;
    errors: string[];
    warnings: string[];
    statusLabel: 'valid' | 'warning' | 'error';
    canImport: boolean;
};

const IMPORT_RECORD_TYPES: ImportRecordType[] = [
    'parent_asset',
    'component_asset',
    'embedded_component',
    'spare_stock',
    'accessory',
    'consumable',
    'license',
];

const IMPORT_RECORD_TYPE_ALIAS_MAP: Record<string, ImportRecordType> = {
    parent_asset: 'parent_asset',
    parent: 'parent_asset',
    asset_parent: 'parent_asset',
    component_asset: 'component_asset',
    asset_component: 'component_asset',
    embedded_component: 'embedded_component',
    component: 'embedded_component',
    child_component: 'embedded_component',
    installed_component: 'embedded_component',
    accessory: 'accessory',
    asset_accessory: 'accessory',
    linked_accessory: 'accessory',
    assigned_accessory: 'accessory',
    consumable: 'consumable',
    spare_stock: 'spare_stock',
    spare_part: 'spare_stock',
    license: 'license',
    software_license: 'license',
    assigned_license: 'license',
};

const IMPORT_LIFECYCLE_ALLOWED = new Set([
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

const IMPORT_CATEGORY_ALLOWED = new Set([
    'asset',
    'component',
    'accessory',
    'consumable',
    'license',
    'spare_part',
    'spare_stock',
]);

const IMPORT_PARENT_ASSET_TYPE_ALLOWED = new Set(
    ASSET_TYPES.flatMap((entry: any) => {
        const values = [entry?.value, entry?.label, entry?.registryKey];
        return values
            .map((value) => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_'))
            .filter(Boolean);
    })
);

const IMPORT_COMPONENT_TYPE_ALLOWED = new Set(
    Object.values(COMPONENT_TYPE_REGISTRY_BY_PARENT)
        .flat()
        .map((entry: string) => String(entry || '').trim().toLowerCase().replace(/[\s-]+/g, '_'))
);

const IMPORT_COMPONENT_TYPE_ALIAS_MAP: Record<string, string> = {
    ram: 'ram',
    memory: 'ram',
    ssd: 'ssd',
    storage: 'ssd',
    hdd: 'hdd',
    battery: 'battery',
    gpu: 'gpu',
    cpu: 'cpu',
    motherboard: 'motherboard',
    power_supply: 'psu',
    powersupply: 'psu',
    network_card: 'network_card',
};

const IMPORT_ACCESSORY_TYPE_ALLOWED = new Set(
    ACCESSORY_TYPES.map((entry: string) => String(entry || '').trim().toLowerCase().replace(/[\s-]+/g, '_'))
);

const IMPORT_ACCESSORY_TYPE_ALIAS_MAP: Record<string, string> = {
    keyboard: 'keyboard',
    mouse: 'mouse',
    hdmi_cable: 'hdmi_cable',
    vga_cable: 'vga_cable',
    charger: 'charger',
    laptop_charger: 'charger',
    bag: 'laptop_bag',
    docking_station: 'docking_station',
    webcam: 'webcam',
    headset: 'headset',
};

const IMPORT_CONSUMABLE_TYPE_ALLOWED = new Set(
    CONSUMABLE_TYPES.map((entry: string) => String(entry || '').trim().toLowerCase().replace(/[\s-]+/g, '_'))
);

const IMPORT_SPARE_STOCK_TYPE_ALLOWED = new Set(
    SPARE_STOCK_TYPES.map((entry: string) => String(entry || '').trim().toLowerCase().replace(/[\s-]+/g, '_'))
);

const IMPORT_SPARE_STOCK_TYPE_ALIAS_MAP: Record<string, string> = {
    storage: 'spare_ssd',
    charger: 'spare_charger',
    battery: 'spare_laptop_battery',
    cable: 'spare_power_adapter',
    adapter: 'spare_power_adapter',
    toner: 'spare_printer_toner',
    lamp: 'spare_projector_lamp',
};

const IMPORT_LICENSE_TYPE_ALLOWED = new Set(
    LICENSE_TYPES.map((entry: string) => String(entry || '').trim().toLowerCase().replace(/[\s-]+/g, '_'))
);

const IMPORT_LICENSE_TYPE_ALIAS_MAP: Record<string, string> = {
    software: 'software_license',
    software_license: 'software_license',
    windows_license: 'windows_license',
    microsoft_office_license: 'microsoft_office_license',
    adobe_license: 'adobe_license',
    antivirus_license: 'antivirus_license',
    os_license: 'server_os_license',
};

const IMPORT_HEADER_MAP: Record<string, keyof Omit<NormalizedImportRow, 'rowNumber' | 'proposedAction' | 'errors' | 'warnings' | 'statusLabel' | 'canImport'>> = {
    recordtype: 'recordType',
    assetname: 'assetName',
    category: 'category',
    assettype: 'assetType',
    brand: 'brand',
    model: 'model',
    serialnumber: 'serialNumber',
    assettag: 'assetTag',
    manufacturerpartnumber: 'manufacturerPartNumber',
    location: 'location',
    department: 'department',
    status: 'status',
    lifestatus: 'lifecycleStatus',
    lifecyclestatus: 'lifecycleStatus',
    parentassettag: 'parentAssetTag',
    componenttype: 'componentType',
    condition: 'condition',
    quantity: 'quantity',
    minimumstocklevel: 'minimumStockLevel',
    reorderpoint: 'reorderPoint',
    vendor: 'vendor',
    purchasedate: 'purchaseDate',
    warrantystartdate: 'warrantyStartDate',
    warrantyenddate: 'warrantyEndDate',
    purchasecost: 'purchaseCost',
    assignedto: 'assignedTo',
    notes: 'notes',
};

function normalizeImportHeader(value: string): string {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function parseCsvContent(content: string): string[][] {
    const rows: string[][] = [];
    let currentField = '';
    let currentRow: string[] = [];
    let inQuotes = false;

    for (let i = 0; i < content.length; i += 1) {
        const char = content[i];
        const nextChar = content[i + 1];
        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                currentField += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (char === ',' && !inQuotes) {
            currentRow.push(currentField.trim());
            currentField = '';
            continue;
        }
        if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && nextChar === '\n') i += 1;
            currentRow.push(currentField.trim());
            if (currentRow.some((field) => String(field || '').trim() !== '')) {
                rows.push(currentRow);
            }
            currentRow = [];
            currentField = '';
            continue;
        }
        currentField += char;
    }
    currentRow.push(currentField.trim());
    if (currentRow.some((field) => String(field || '').trim() !== '')) {
        rows.push(currentRow);
    }
    return rows;
}

function normalizeImportRecordType(value: unknown): ImportRecordType | '' {
    const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const canonical = IMPORT_RECORD_TYPE_ALIAS_MAP[normalized] || normalized;
    return IMPORT_RECORD_TYPES.includes(canonical as ImportRecordType)
        ? (canonical as ImportRecordType)
        : '';
}

function normalizeImportLifecycleValue(value: unknown): string {
    const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!normalized) return '';
    if (normalized === 'installed') return 'in_use';
    if (normalized === 'checked_out') return 'assigned';
    return normalized;
}

function normalizeImportRegistryToken(value: unknown): string {
    return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function resolveImportAliasToken(value: unknown, aliasMap: Record<string, string>): string {
    const normalized = normalizeImportRegistryToken(value);
    if (!normalized) return '';
    return aliasMap[normalized] || normalized;
}

function normalizeImportRows(rawRows: Array<Record<string, any>>): NormalizedImportRow[] {
    return rawRows.map((raw, index) => {
        const recordType = normalizeImportRecordType(raw.recordType);
        const quantity = parseOptionalIntegerInput(raw.quantity);
        const minimumStockLevel = parseOptionalIntegerInput(raw.minimumStockLevel);
        const reorderPoint = parseOptionalIntegerInput(raw.reorderPoint);
        const purchaseCost = parseOptionalNumberInput(raw.purchaseCost);
        return {
            rowNumber: index + 1,
            recordType,
            assetName: String(raw.assetName || '').trim(),
            category: String(raw.category || '').trim(),
            assetType: String(raw.assetType || '').trim(),
            brand: String(raw.brand || '').trim(),
            model: String(raw.model || '').trim(),
            serialNumber: String(raw.serialNumber || '').trim(),
            assetTag: String(raw.assetTag || '').trim(),
            manufacturerPartNumber: String(raw.manufacturerPartNumber || '').trim(),
            location: String(raw.location || '').trim(),
            department: String(raw.department || '').trim(),
            status: String(raw.status || '').trim(),
            lifecycleStatus: normalizeImportLifecycleValue(raw.lifecycleStatus),
            parentAssetTag: String(raw.parentAssetTag || '').trim(),
            componentType: String(raw.componentType || '').trim(),
            condition: String(raw.condition || '').trim(),
            quantity: quantity === null ? null : quantity,
            minimumStockLevel: minimumStockLevel === null ? null : minimumStockLevel,
            reorderPoint: reorderPoint === null ? null : reorderPoint,
            vendor: String(raw.vendor || '').trim(),
            purchaseDate: String(raw.purchaseDate || '').trim(),
            warrantyStartDate: String(raw.warrantyStartDate || '').trim(),
            warrantyEndDate: String(raw.warrantyEndDate || '').trim(),
            purchaseCost,
            assignedTo: String(raw.assignedTo || '').trim(),
            notes: String(raw.notes || '').trim(),
            proposedAction: '',
            errors: [],
            warnings: [],
            statusLabel: 'valid',
            canImport: true,
        };
    });
}

async function validateImportRows(rows: NormalizedImportRow[]): Promise<{
    normalizedRows: NormalizedImportRow[];
    totalRows: number;
    validRows: number;
    invalidRows: number;
    warnings: string[];
    errors: string[];
    canImport: boolean;
}> {
    const normalizedRows: NormalizedImportRow[] = rows.map((row) => ({
        ...row,
        errors: Array.isArray(row.errors) ? [...row.errors] : [],
        warnings: Array.isArray(row.warnings) ? [...row.warnings] : [],
    }));
    const topWarnings: string[] = [];
    const topErrors: string[] = [];

    const serialToRows = new Map<string, number[]>();
    const tagToRows = new Map<string, number[]>();
    const parentTagSet = new Set<string>();
    const parentTagsDefinedInFile = new Set<string>();

    normalizedRows.forEach((row) => {
        if (row.assetTag && row.recordType === 'parent_asset') parentTagsDefinedInFile.add(row.assetTag.toLowerCase());
        if (row.parentAssetTag) parentTagSet.add(row.parentAssetTag.toLowerCase());
        if (row.serialNumber) {
            const key = row.serialNumber.toLowerCase();
            serialToRows.set(key, [...(serialToRows.get(key) || []), row.rowNumber]);
        }
        if (row.assetTag) {
            const key = row.assetTag.toLowerCase();
            tagToRows.set(key, [...(tagToRows.get(key) || []), row.rowNumber]);
        }
    });

    serialToRows.forEach((rowNumbers, serial) => {
        if (rowNumbers.length > 1) {
            normalizedRows.forEach((row) => {
                if (row.serialNumber.toLowerCase() === serial) {
                    row.errors.push(`Duplicate serial number in file (${row.serialNumber})`);
                }
            });
        }
    });
    tagToRows.forEach((rowNumbers, tag) => {
        if (rowNumbers.length > 1) {
            normalizedRows.forEach((row) => {
                if (row.assetTag.toLowerCase() === tag) {
                    row.errors.push(`Duplicate asset tag in file (${row.assetTag})`);
                }
            });
        }
    });

    const serials = Array.from(serialToRows.keys());
    const tags = Array.from(tagToRows.keys());
    const existingSerials = serials.length
        ? await prisma.asset.findMany({
            where: {
                OR: serials.map((serial) => ({
                    serialNumber: { equals: serial }
                })),
            },
            select: { serialNumber: true, customId: true },
            take: 500,
        })
        : [];
    const existingTags = tags.length
        ? await prisma.asset.findMany({
            where: {
                OR: tags.map((tag) => ({
                    assetTag: { equals: tag }
                })),
            },
            select: { assetTag: true, customId: true },
            take: 500,
        })
        : [];
    const existingParents = parentTagSet.size
        ? await prisma.asset.findMany({
            where: {
                OR: Array.from(parentTagSet).map((tag) => ({
                    assetTag: { equals: tag }
                })),
            },
            select: { assetTag: true, customId: true },
            take: 500,
        })
        : [];
    const existingParentTags = new Set(existingParents.map((entry) => String(entry.assetTag || '').toLowerCase()).filter(Boolean));
    const existingSerialSet = new Set(existingSerials.map((entry) => String(entry.serialNumber || '').toLowerCase()).filter(Boolean));
    const existingTagSet = new Set(existingTags.map((entry) => String(entry.assetTag || '').toLowerCase()).filter(Boolean));

    normalizedRows.forEach((row) => {
        if (!row.recordType) row.errors.push('Invalid Record Type');
        if (row.serialNumber && existingSerialSet.has(row.serialNumber.toLowerCase())) {
            row.errors.push(`Serial number already exists in DB (${row.serialNumber})`);
        }
        if (row.assetTag && existingTagSet.has(row.assetTag.toLowerCase())) {
            row.errors.push(`Asset tag already exists in DB (${row.assetTag})`);
        }
        if (row.lifecycleStatus) {
            const lifecycle = normalizeImportLifecycleValue(row.lifecycleStatus);
            row.lifecycleStatus = lifecycle;
            if (!IMPORT_LIFECYCLE_ALLOWED.has(lifecycle)) {
                row.errors.push(`Invalid lifecycle status (${row.lifecycleStatus})`);
            }
        }
        if (row.category) {
            const category = normalizeImportRegistryToken(row.category);
            if (!IMPORT_CATEGORY_ALLOWED.has(category)) {
                row.errors.push(`Invalid category (${row.category})`);
            }
        }
        if (row.assetType && row.recordType === 'parent_asset') {
            const normalizedAssetType = normalizeImportRegistryToken(row.assetType);
            if (!IMPORT_PARENT_ASSET_TYPE_ALLOWED.has(normalizedAssetType)) {
                row.warnings.push(`Unrecognized asset type in registry (${row.assetType}). It will map to nearest supported backend type.`);
            }
        }
        if (row.recordType === 'component_asset' || row.recordType === 'embedded_component') {
            if (!row.componentType && row.assetType) {
                row.componentType = String(row.assetType || '').trim();
            }
            const normalizedComponentType = resolveImportAliasToken(row.componentType, IMPORT_COMPONENT_TYPE_ALIAS_MAP);
            if (normalizedComponentType) {
                row.componentType = normalizedComponentType;
            }
            if (normalizedComponentType && !IMPORT_COMPONENT_TYPE_ALLOWED.has(normalizedComponentType)) {
                row.warnings.push(`Component type (${row.componentType}) is not in current registry; keeping as custom component type.`);
            }
        }
        if (row.recordType === 'accessory') {
            const normalizedAccessoryType = resolveImportAliasToken(row.assetType || row.category || row.assetName, IMPORT_ACCESSORY_TYPE_ALIAS_MAP);
            if (normalizedAccessoryType && !IMPORT_ACCESSORY_TYPE_ALLOWED.has(normalizedAccessoryType)) {
                row.warnings.push(`Accessory type (${row.assetType || row.category}) is outside the standard accessory registry.`);
            }
        }
        if (row.recordType === 'consumable') {
            const normalizedConsumableType = normalizeImportRegistryToken(row.assetType || row.category || '');
            if (normalizedConsumableType && !IMPORT_CONSUMABLE_TYPE_ALLOWED.has(normalizedConsumableType)) {
                row.warnings.push(`Consumable type (${row.assetType || row.category}) is outside the standard consumable registry.`);
            }
        }
        if (row.recordType === 'spare_stock') {
            const normalizedSpareType = resolveImportAliasToken(row.componentType || row.assetType || row.assetName, IMPORT_SPARE_STOCK_TYPE_ALIAS_MAP);
            if (normalizedSpareType) row.componentType = normalizedSpareType;
            if (normalizedSpareType && !IMPORT_SPARE_STOCK_TYPE_ALLOWED.has(normalizedSpareType)) {
                row.warnings.push(`Spare stock type (${row.componentType}) is outside the standard spare-stock registry.`);
            }
        }
        if (row.recordType === 'license') {
            const normalizedLicenseType = resolveImportAliasToken(row.assetType || row.assetName || '', IMPORT_LICENSE_TYPE_ALIAS_MAP);
            if (normalizedLicenseType && !IMPORT_LICENSE_TYPE_ALLOWED.has(normalizedLicenseType)) {
                row.warnings.push(`License type (${row.assetType || row.assetName}) is outside the standard license registry.`);
            }
        }

        if ((row.recordType === 'parent_asset' || row.recordType === 'accessory' || row.recordType === 'consumable' || row.recordType === 'license' || row.recordType === 'component_asset') && !row.assetName) {
            row.errors.push('Asset Name is required');
        }
        if (row.recordType === 'embedded_component' && !row.assetName) row.errors.push('Asset Name is required for embedded component');
        if (row.recordType === 'embedded_component' && !row.parentAssetTag) row.errors.push('Parent Asset Tag is required for component rows');
        if (row.recordType === 'embedded_component' && !row.componentType) row.errors.push('Component Type is required for embedded component');
        if (row.recordType === 'component_asset' && !row.componentType) row.warnings.push('Component Type is empty; defaulting to component');

        if (row.recordType === 'spare_stock') {
            if (!row.assetName) row.errors.push('Asset Name (part name) is required for spare stock');
            if (!row.componentType) row.errors.push('Component Type is required for spare stock');
            if (row.quantity === null || row.quantity < 0) row.errors.push('Spare stock quantity is missing or invalid');
            if (row.minimumStockLevel !== null && row.minimumStockLevel < 0) row.errors.push('Minimum stock level must be >= 0');
            if (row.reorderPoint !== null && row.reorderPoint < 0) row.errors.push('Reorder point must be >= 0');
        }

        if (row.quantity !== null && row.quantity <= 0 && row.recordType !== 'spare_stock') {
            row.errors.push('Quantity must be a positive integer');
        }

        const parentTagKey = String(row.parentAssetTag || '').trim().toLowerCase();
        const requiresParentResolution = (
            row.recordType === 'embedded_component'
            || (row.recordType === 'component_asset' && Boolean(row.parentAssetTag))
            || ((row.recordType === 'accessory' || row.recordType === 'license') && Boolean(row.parentAssetTag))
        );
        if (requiresParentResolution) {
            if (!parentTagKey) {
                row.errors.push('Parent Asset Tag is required for related item rows.');
            } else if (!existingParentTags.has(parentTagKey) && !parentTagsDefinedInFile.has(parentTagKey)) {
                if (row.recordType === 'accessory' || row.recordType === 'license') {
                    row.errors.push('Parent asset not found for related item row.');
                } else {
                    row.errors.push(`Unknown Parent Asset Tag (${row.parentAssetTag})`);
                }
            }
        }

        switch (row.recordType) {
            case 'parent_asset':
                row.proposedAction = 'create_parent_asset';
                break;
            case 'embedded_component':
                row.proposedAction = 'install_component_to_parent';
                break;
            case 'component_asset':
                row.proposedAction = row.parentAssetTag ? 'create_and_link_component' : 'create_component';
                break;
            case 'spare_stock':
                row.proposedAction = 'create_or_update_spare_stock';
                break;
            case 'accessory':
                row.proposedAction = row.parentAssetTag ? 'create_and_link_accessory' : 'create_accessory';
                break;
            case 'license':
                row.proposedAction = row.parentAssetTag ? 'create_and_link_license' : 'create_license';
                break;
            case 'consumable':
                row.proposedAction = 'create_consumable';
                break;
            default:
                row.proposedAction = 'skip';
                break;
        }

        if (row.errors.length > 0) {
            row.statusLabel = 'error';
            row.canImport = false;
        } else if (row.warnings.length > 0) {
            row.statusLabel = 'warning';
            row.canImport = true;
        } else {
            row.statusLabel = 'valid';
            row.canImport = true;
        }
    });

    const invalidRows = normalizedRows.filter((row) => row.statusLabel === 'error').length;
    const validRows = normalizedRows.length - invalidRows;
    if (invalidRows > 0) {
        topErrors.push(`${invalidRows} row(s) contain validation errors.`);
    }

    const warningCount = normalizedRows.reduce((sum, row) => sum + row.warnings.length, 0);
    if (warningCount > 0) {
        topWarnings.push(`${warningCount} warning(s) detected.`);
    }

    return {
        normalizedRows,
        totalRows: normalizedRows.length,
        validRows,
        invalidRows,
        warnings: topWarnings,
        errors: topErrors,
        canImport: invalidRows === 0 && normalizedRows.length > 0,
    };
}

function parseImportTemplateFieldToNormalizedKey(value: string): string {
    const normalized = normalizeImportHeader(value || '');
    const direct = IMPORT_HEADER_MAP[normalized];
    if (direct) return String(direct);
    const aliases: Record<string, string> = {
        recordtype: 'recordType',
        assetname: 'assetName',
        assettype: 'assetType',
        serialnumber: 'serialNumber',
        assettag: 'assetTag',
        manufacturerpartnumber: 'manufacturerPartNumber',
        parentassettag: 'parentAssetTag',
        componenttype: 'componentType',
        minimumstocklevel: 'minimumStockLevel',
        reorderpoint: 'reorderPoint',
        purchasedate: 'purchaseDate',
        warrantystartdate: 'warrantyStartDate',
        warrantyenddate: 'warrantyEndDate',
        purchasecost: 'purchaseCost',
        assignedto: 'assignedTo',
        lifestatus: 'lifecycleStatus',
        lifecyclestatus: 'lifecycleStatus',
    };
    return aliases[normalized] || '';
}

function parseImportFileRows(
    filename: string,
    fileContent: string,
    headerMappings: Record<string, string> | null = null
): Array<Record<string, any>> {
    const lower = String(filename || '').toLowerCase();
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        throw new RequestValidationError('XLSX import is not enabled yet. CSV is supported now. XLSX support is planned for Slice 2.1.');
    }
    const rows = parseCsvContent(fileContent);
    if (!rows.length) return [];
    const headerRow = rows[0] || [];
    const normalizedMappingEntries = new Map<string, string>();
    Object.entries(headerMappings || {}).forEach(([sourceColumn, targetColumn]) => {
        const sourceKey = normalizeImportHeader(sourceColumn);
        const targetKey = parseImportTemplateFieldToNormalizedKey(targetColumn);
        if (sourceKey && targetKey) normalizedMappingEntries.set(sourceKey, targetKey);
    });
    const headerMap = headerRow.map((header) => {
        const sourceKey = normalizeImportHeader(header);
        const mappedViaAi = normalizedMappingEntries.get(sourceKey);
        if (mappedViaAi) return mappedViaAi as keyof Omit<NormalizedImportRow, 'rowNumber' | 'proposedAction' | 'errors' | 'warnings' | 'statusLabel' | 'canImport'>;
        return IMPORT_HEADER_MAP[sourceKey] || null;
    });
    const result: Array<Record<string, any>> = [];

    for (let index = 1; index < rows.length; index += 1) {
        const row = rows[index];
        const parsed: Record<string, any> = {};
        headerMap.forEach((mappedKey, columnIndex) => {
            if (!mappedKey) return;
            parsed[mappedKey] = String(row[columnIndex] || '').trim();
        });
        result.push(parsed);
    }
    return result;
}

function buildUnitAssetIds(baseId: string, quantity: number): string[] {
    if (quantity <= 1) return [baseId];
    const padding = Math.max(3, String(quantity).length);
    return Array.from({ length: quantity }, (_, index) => {
        const unitNumber = String(index + 1);
        const zeroPadding = unitNumber.length >= padding ? '' : '0'.repeat(padding - unitNumber.length);
        return `${baseId}-UNIT-${zeroPadding}${unitNumber}`;
    });
}

const OPERATIONAL_STATE_RATES: Record<string, number> = {
    online_in_use: 1,
    online_idle: 0.2,
    offline: 0,
    not_monitored: 0,
    insufficient_data: 0,
    unknown: 0
};

function resolveTelemetryState(isOnline: boolean, isActive: boolean): string {
    if (!isOnline) return 'offline';
    return isActive ? 'online_in_use' : 'online_idle';
}

type TelemetryTruthState = 'online_in_use' | 'online_idle' | 'offline' | 'not_monitored' | 'insufficient_data' | 'unknown';

function normalizeOperationalStateValue(value: unknown): TelemetryTruthState {
    const normalized = String(value || '').trim().toLowerCase().replace(/-/g, '_');
    if (normalized === 'online_in_use') return 'online_in_use';
    if (normalized === 'online_idle') return 'online_idle';
    if (normalized === 'offline') return 'offline';
    if (normalized === 'not_monitored') return 'not_monitored';
    if (normalized === 'insufficient_data') return 'insufficient_data';
    return 'unknown';
}

function getTelemetryTruth(specifications: Record<string, any>): {
    state: TelemetryTruthState;
    confidence: 'high' | 'low';
    reason: string;
    hasTelemetry: boolean;
} {
    const hasTelemetryTimestamp = Boolean(specifications?.lastTelemetryAt || specifications?.operationalStateUpdatedAt);
    const hasTelemetryHours = Number(specifications?.workingHours || 0) > 0 && String(specifications?.workingHoursSource || '').toLowerCase() === 'telemetry';
    const hasTelemetry = hasTelemetryTimestamp || hasTelemetryHours;
    const trackEnabled = isTelemetryTracked(specifications);
    const requestedState = normalizeOperationalStateValue(specifications?.operationalState);

    if (!trackEnabled && !hasTelemetry) {
        return {
            state: 'not_monitored',
            confidence: 'low',
            reason: 'Telemetry not connected for this asset.',
            hasTelemetry: false,
        };
    }

    if (trackEnabled && !hasTelemetry) {
        return {
            state: 'insufficient_data',
            confidence: 'low',
            reason: 'Telemetry tracking enabled but no telemetry samples received yet.',
            hasTelemetry: false,
        };
    }

    if (requestedState === 'online_in_use' || requestedState === 'online_idle' || requestedState === 'offline') {
        return {
            state: requestedState,
            confidence: 'high',
            reason: 'Derived from telemetry heartbeat/activity signals.',
            hasTelemetry: true,
        };
    }

    if (requestedState === 'not_monitored' || requestedState === 'insufficient_data') {
        return {
            state: requestedState,
            confidence: 'low',
            reason: 'Telemetry is incomplete for reliable live-status classification.',
            hasTelemetry: hasTelemetry,
        };
    }

    return {
        state: 'unknown',
        confidence: 'low',
        reason: 'Telemetry signals are present but do not map to a supported live-status state.',
        hasTelemetry: hasTelemetry,
    };
}

function isTelemetryTracked(specifications: Record<string, any>): boolean {
    return (
        specifications.trackWorkingHours === true
        || String(specifications.trackWorkingHours || '').toLowerCase() === 'true'
        || specifications.telemetryEnabled === true
        || String(specifications.telemetryEnabled || '').toLowerCase() === 'true'
    );
}

function getTelemetryAdjustedHours(specifications: Record<string, any>, measuredAt: Date = new Date()): number {
    const storedHours = isTelemetryTracked(specifications) ? Number(specifications.workingHours || 0) : 0;
    const previousState = getTelemetryTruth(specifications).state;
    const previousUpdate = specifications.operationalStateUpdatedAt
        ? new Date(specifications.operationalStateUpdatedAt)
        : null;

    if (!previousUpdate || Number.isNaN(previousUpdate.getTime())) return storedHours;
    if (!measuredAt || Number.isNaN(measuredAt.getTime())) return storedHours;

    const elapsedHours = Math.max(0, (measuredAt.getTime() - previousUpdate.getTime()) / 36e5);
    return storedHours + elapsedHours * (OPERATIONAL_STATE_RATES[previousState] ?? 0);
}

function normalizeValue(value: unknown): string {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const AI_SPEC_PROTECTED_FIELDS = new Set([
    'workingHours',
    'Working Hours',
    'trackWorkingHours',
    'workingHoursSource',
    'operationalState',
    'operationalStateUpdatedAt',
    'lastTelemetryAt',
    'lifecyclePrediction',
    'predictedLifespanYears',
    'failureRisk',
    'lifespanModelVersion',
    'lifespanUpdatedAt',
    'actualLifespanYears',
    'lifecycle',
].map(normalizeValue));

const AI_SPEC_METADATA_FIELDS = new Set([
    'brand',
    'version',
    'model',
    'inferredQuality',
    'quality',
    'trackWorkingHours',
    'telemetryEnabled',
    'workingHours',
    'workingHoursSource',
    'operationalState',
    'operationalStateUpdatedAt',
    'telemetryStatus',
    'telemetryConfidence',
    'telemetryReason',
    'lastTelemetryAt',
    'aiDetectedSpecs',
    'aiSpecFieldConfidence',
    'aiSpecConfidence',
    'aiSpecSource',
    'aiSpecLookupMode',
    'aiSpecSourceUrls',
    'aiSpecRuleVersion',
    'aiSpecVariant',
    'aiSpecEvidenceStatus',
    'aiSpecEvidenceReason',
    'aiSpecDetectedAt',
    'specVerificationStatus',
    'specVerificationUpdatedAt',
    'specVerificationReviewedBy',
    'specVerificationReviewedAt',
    'specVerificationAction',
    'specVerificationCorrections',
].map(normalizeValue));

function stripLifecycleManagedSpecFields(specs: Record<string, any>): Record<string, any> {
    const safeSpecs: Record<string, any> = {};
    for (const key of Object.keys(specs || {})) {
        if (!AI_SPEC_PROTECTED_FIELDS.has(normalizeValue(key))) {
            safeSpecs[key] = specs[key];
        }
    }
    return safeSpecs;
}

function parseSpecTextToObject(specText: unknown): Record<string, string> {
    if (!specText || typeof specText !== 'string') return {};
    const parsed: Record<string, string> = {};
    for (const rawLine of specText.split('\n')) {
        const line = String(rawLine || '').trim();
        if (!line) continue;
        const separatorIndex = line.indexOf(':');
        if (separatorIndex <= 0) continue;
        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        if (!key || !value) continue;
        parsed[key] = value;
    }
    return parsed;
}

function mergeSpecMaps(...maps: Array<Record<string, string> | null | undefined>): Record<string, string> {
    const merged: Record<string, string> = {};
    maps.forEach((map) => {
        if (!map) return;
        Object.entries(map).forEach(([key, value]) => {
            const safeKey = String(key || '').trim();
            const safeValue = String(value || '').trim();
            if (!safeKey || !safeValue) return;
            merged[safeKey] = safeValue;
        });
    });
    return merged;
}

function restrictPreviewSpecsToProfile(
    candidateSpecs: Record<string, string>,
    expectedFields: string[],
    warnings: string[],
): Record<string, string> {
    if (!expectedFields.length) return candidateSpecs;
    const expectedMap = new Map(expectedFields.map((field) => [normalizeValue(field), field]));
    const filtered: Record<string, string> = {};
    const dropped: string[] = [];

    Object.entries(candidateSpecs || {}).forEach(([key, value]) => {
        const matchedKey = expectedMap.get(normalizeValue(key));
        if (!matchedKey) {
            dropped.push(key);
            return;
        }
        filtered[matchedKey] = value;
    });

    if (dropped.length) {
        warnings.push(`Ignored unsupported fields for selected asset type: ${dropped.join(', ')}`);
    }

    return filtered;
}

function extractRenderableSpecs(specs: Record<string, any>): Record<string, string> {
    const base = stripLifecycleManagedSpecFields(specs || {});
    const out: Record<string, string> = {};
    for (const [key, rawValue] of Object.entries(base)) {
        if (!String(key || '').trim()) continue;
        if (AI_SPEC_METADATA_FIELDS.has(normalizeValue(key))) continue;
        const value = String(rawValue ?? '').trim();
        if (!value) continue;
        out[String(key)] = value;
    }
    return out;
}

function formatSpecsForTextarea(specs: Record<string, string>): string {
    return Object.entries(specs || {})
        .filter(([key, value]) => String(key || '').trim() && String(value || '').trim())
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n');
}

type SpecNormalizationHelperResponse = {
    normalizedSpecs: Record<string, string>;
    normalizedSpecsText: string;
    invalidFields: string[];
    missingImportantFields: string[];
    warnings: string[];
    confidence: number;
    llmUsed: boolean;
};

type SpecSanityHelperResponse = {
    warnings: string[];
    suspiciousFields: string[];
    suggestedFixes: string[];
    requiresReview: boolean;
    llmUsed: boolean;
};

type EolExplanationHelperResponse = {
    shortUserExplanation: string;
    technicalExplanation: string;
    llmUsed: boolean;
};

type AiHealthSummaryHelperResponse = {
    summary: string;
    risks: string[];
    recentChanges: string[];
    componentIssues: string[];
    warrantyEolConcerns: string[];
    recommendations: string[];
    confidence: 'low' | 'medium' | 'high';
    missingData: string[];
    llmUsed: boolean;
};

async function callInventoryAiHelper(path: string, body: Record<string, unknown>, timeoutMs = 8_000): Promise<any | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${INVENTORY_AI_SERVICE_URL}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            console.warn(`[InventoryAIHelpers] ${path} failed status=${response.status} body=${text.slice(0, 240)}`);
            return null;
        }
        return await response.json();
    } catch (error: any) {
        const message = String(error?.message || error || 'unknown_error');
        const timeoutLike = message.toLowerCase().includes('aborted') || message.toLowerCase().includes('timeout');
        console.warn(`[InventoryAIHelpers] ${path} request failed${timeoutLike ? ' (timeout_or_abort)' : ''}: ${message}`);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function buildSpecNormalizationFallback(params: {
    rawSpecsText: string;
    currentSpecs: Record<string, any>;
    expectedFields: string[];
    notApplicableFields: string[];
    brand?: string;
    model?: string;
    assetType?: string;
}): SpecNormalizationHelperResponse {
    const parsedText = parseSpecTextToObject(params.rawSpecsText || '');
    const renderableCurrent = extractRenderableSpecs(params.currentSpecs || {});
    const merged = mergeSpecMaps(parsedText, renderableCurrent);
    const warnings: string[] = [];
    const filtered = restrictPreviewSpecsToProfile(merged, params.expectedFields, warnings);
    const invalidFields = Object.keys(merged).filter((key) => !Object.prototype.hasOwnProperty.call(filtered, key));
    const missingImportantFields = (params.expectedFields || [])
        .filter((field) => !Object.keys(filtered).some((key) => normalizeValue(key) === normalizeValue(field)));

    const brandModel = normalizeValue(`${params.brand || ''} ${params.model || ''}`);
    const osField = Object.keys(filtered).find((key) => normalizeValue(key) === 'os');
    if (
        params.assetType === 'laptop'
        && (brandModel.includes('apple') || brandModel.includes('macbook'))
        && osField
        && String(filtered[osField] || '').toLowerCase().includes('windows')
    ) {
        warnings.push('MacBook/Apple model with Windows OS looks suspicious. Verify exact model/year and OS.');
    }

    return {
        normalizedSpecs: filtered,
        normalizedSpecsText: formatSpecsForTextarea(filtered),
        invalidFields,
        missingImportantFields,
        warnings,
        confidence: Object.keys(filtered).length ? 0.55 : 0.4,
        llmUsed: false,
    };
}

function buildSpecSanityFallback(params: {
    normalizedSpecs: Record<string, string>;
    assetType: string;
    brand?: string;
    model?: string;
    expectedFields: string[];
    notApplicableFields: string[];
    sourceType?: string;
    evidenceStatus?: string;
}): SpecSanityHelperResponse {
    const warnings: string[] = [];
    const suspiciousFields: string[] = [];
    const suggestedFixes: string[] = [];
    const notApplicable = new Set((params.notApplicableFields || []).map((field) => normalizeValue(field)));
    const expected = new Set((params.expectedFields || []).map((field) => normalizeValue(field)));

    Object.entries(params.normalizedSpecs || {}).forEach(([field, value]) => {
        const normalizedField = normalizeValue(field);
        if (notApplicable.has(normalizedField)) {
            suspiciousFields.push(field);
            warnings.push(`${field} is not applicable for ${params.assetType}.`);
            suggestedFixes.push(`Remove ${field} and keep only ${params.assetType}-relevant fields.`);
        }
        if (expected.size && !expected.has(normalizedField)) {
            warnings.push(`${field} is outside expected fields for ${params.assetType}.`);
        }
        const brandModel = normalizeValue(`${params.brand || ''} ${params.model || ''}`);
        if (
            normalizedField === 'os'
            && (brandModel.includes('apple') || brandModel.includes('macbook'))
            && String(value || '').toLowerCase().includes('windows')
        ) {
            suspiciousFields.push(field);
            warnings.push('MacBook/Apple with Windows OS is suspicious.');
            suggestedFixes.push("Set OS to 'macOS' or 'Unknown - verify exact configuration'.");
        }
    });

    const lowEvidence = ['insufficient_source_evidence', 'llm_or_heuristic_only'].includes(String(params.evidenceStatus || '').toLowerCase());
    if (lowEvidence) {
        warnings.push('No trusted source evidence. Manual verification is recommended before create.');
    }
    return {
        warnings: Array.from(new Set(warnings)),
        suspiciousFields: Array.from(new Set(suspiciousFields)),
        suggestedFixes: Array.from(new Set(suggestedFixes)),
        requiresReview: lowEvidence || suspiciousFields.length > 0,
        llmUsed: false,
    };
}

function buildEolExplanationFallback(assessment: EolAssessmentResponse): EolExplanationHelperResponse {
    const confidencePct = Math.round(Number(assessment.confidence || 0) * 100);
    return {
        shortUserExplanation: `EOL status is ${assessment.status.replace(/_/g, ' ')} with ${confidencePct}% confidence. ${assessment.suitableForProcurementPlanning ? 'Procurement planning can be considered.' : 'Manual review and monitoring are recommended.'}`,
        technicalExplanation: `status=${assessment.status}; confidence=${confidencePct}%; telemetry=${assessment.telemetryStatus}; specEvidence=${assessment.specEvidenceStatus}; source=${assessment.predictionSource}; monthsRemaining=${assessment.monthsRemaining}; reason=${assessment.reason}`,
        llmUsed: false,
    };
}

function buildAiHealthSummaryFallback(params: {
    asset: Asset;
    timeline: CombinedHistoryEntry[];
    assessment: EolAssessmentResponse;
}): AiHealthSummaryHelperResponse {
    const assetSpecs = ((params.asset.specifications as Record<string, any>) || {});
    const latestChanges = (params.timeline || []).slice(0, 6).map((entry) => {
        const sourceName = entry.sourceItemName || entry.sourceItemCustomId || 'Related item';
        const reason = entry.reason ? ` — Reason: ${entry.reason}` : '';
        return `${sourceName}: ${entry.event}${reason}`;
    });
    const componentIssues = (params.timeline || [])
        .filter((entry) => {
            const key = normalizeValue(entry.eventType || entry.event);
            return entry.sourceItemType === 'component'
                && (key.includes('failed') || key.includes('repair') || key.includes('replace') || key.includes('retire') || key.includes('dispose'));
        })
        .slice(0, 6)
        .map((entry) => `${entry.sourceItemName || 'Component'} ${entry.event.toLowerCase()}`);

    const missingData: string[] = [];
    if (!params.asset.purchaseDate) missingData.push('purchaseDate');
    if (!params.asset.warrantyEndDate) missingData.push('warrantyEndDate');
    if (!normalizeSerialValue(params.asset.serialNumber)) missingData.push('serialNumber');
    if (!Array.isArray(params.timeline) || params.timeline.length === 0) missingData.push('historyEvents');
    if (!assetSpecs.telemetryEnabled && !assetSpecs.trackWorkingHours) missingData.push('telemetrySignals');

    const assessmentStatusText = String(params.assessment.status || '').trim();
    const assessmentStatusKey = assessmentStatusText.toLowerCase();
    const risks: string[] = [];
    if (assessmentStatusKey.includes('risk') || assessmentStatusKey.includes('expired') || assessmentStatusKey.includes('end_of_life')) {
        risks.push(`EOL status is ${assessmentStatusText.replace(/_/g, ' ')} (${Math.round(Number(params.assessment.confidence || 0) * 100)}% confidence).`);
    }
    if (componentIssues.length) {
        risks.push(`Component incidents detected: ${componentIssues.length} recent issue(s).`);
    }
    if (missingData.length >= 3) {
        risks.push('Key lifecycle and telemetry data is missing; health confidence is limited.');
    }

    const recommendations: string[] = [];
    if (!params.asset.warrantyEndDate) recommendations.push('Add warranty end date to improve lifecycle and procurement planning.');
    if (componentIssues.length) recommendations.push('Review frequent component issues and schedule preventive maintenance.');
    if (!params.asset.purchaseDate) recommendations.push('Backfill purchase date for stronger EOL confidence.');
    if (!recommendations.length) recommendations.push('Continue routine monitoring and maintenance reviews.');

    const warrantyEolConcerns: string[] = [];
    if (params.asset.warrantyEndDate) {
        warrantyEolConcerns.push(`Warranty end date: ${params.asset.warrantyEndDate.toISOString().slice(0, 10)}`);
    } else {
        warrantyEolConcerns.push('Warranty end date is missing.');
    }
    warrantyEolConcerns.push(`EOL assessment: ${params.assessment.reason}`);

    const confidence: 'low' | 'medium' | 'high' = missingData.length >= 4
        ? 'low'
        : missingData.length >= 2
            ? 'medium'
            : 'high';

    const summary = [
        `${params.asset.name} (${params.asset.customId}) is currently ${String(params.asset.lifecycleStatus || '').toLowerCase().replace(/_/g, ' ')}.`,
        `EOL status is ${params.assessment.status.replace(/_/g, ' ')} with ${Math.round(Number(params.assessment.confidence || 0) * 100)}% confidence.`,
        componentIssues.length
            ? `Recent component concerns were detected (${componentIssues.length}).`
            : 'No recent component failure trend was detected from recorded history.',
    ].join(' ');

    return {
        summary,
        risks,
        recentChanges: latestChanges,
        componentIssues,
        warrantyEolConcerns,
        recommendations,
        confidence,
        missingData,
        llmUsed: false,
    };
}

const INVENTORY_AI_SUPPORTED_HINT = 'I can help with inventory status, maintenance, warranty, EOL, stock, duplicates, and procurement questions.';
const INVENTORY_AI_MAX_ASSETS = 1600;
const INVENTORY_AI_MAX_COMPONENTS = 2400;
const INVENTORY_AI_MAX_EVENTS = 2400;
const INVENTORY_AI_MAX_MAINTENANCE = 1600;
const INVENTORY_AI_MAX_SPARE_STOCK = 1200;

type InventoryAiMatchedItem = {
    assetId: string;
    name: string;
    type: string;
    category: string;
    status: string;
    lifecycleStatus: string;
    location: string;
    department: string;
    serialNumber: string | null;
    assetTag: string | null;
    reason: string;
    parentAssetId?: string | null;
};

type InventoryAiSnapshot = {
    assets: Asset[];
    components: Array<{
        id: string;
        parentAssetId: string;
        childAssetId: string | null;
        componentName: string;
        componentType: string;
        status: string;
        serialNumber: string | null;
        partNumber: string | null;
        updatedAt: Date;
        removedAt: Date | null;
    }>;
    maintenance: Array<{
        id: string;
        assetId: string;
        componentId: string | null;
        maintenanceType: string;
        status: string;
        performedAt: Date | null;
        nextMaintenanceDate: Date | null;
        reason: string | null;
    }>;
    lifecycleEvents: Array<{
        id: string;
        assetId: string;
        componentId: string | null;
        eventType: string;
        reason: string | null;
        createdAt: Date;
    }>;
    spareStock: Array<{
        id: string;
        partName: string;
        componentType: string;
        quantityAvailable: number;
        minimumStockLevel: number;
        reorderPoint: number | null;
        unitCost: Prisma.Decimal | null;
        vendor: string | null;
        location: string | null;
        compatibleAssetTypes: Prisma.JsonValue | null;
    }>;
};

async function buildInventoryAiSnapshot(): Promise<InventoryAiSnapshot> {
    const assets = await prisma.asset.findMany({
        orderBy: { createdAt: 'desc' },
        take: INVENTORY_AI_MAX_ASSETS,
    });
    const assetIds = assets.map((asset) => asset.customId);
    const [components, maintenance, lifecycleEvents, spareStock] = await Promise.all([
        prisma.assetComponent.findMany({
            where: {
                OR: [
                    { parentAssetId: { in: assetIds } },
                    { childAssetId: { in: assetIds } },
                ],
            },
            select: {
                id: true,
                parentAssetId: true,
                childAssetId: true,
                componentName: true,
                componentType: true,
                status: true,
                serialNumber: true,
                partNumber: true,
                updatedAt: true,
                removedAt: true,
            },
            orderBy: { updatedAt: 'desc' },
            take: INVENTORY_AI_MAX_COMPONENTS,
        }),
        prisma.assetMaintenanceRecord.findMany({
            where: { assetId: { in: assetIds } },
            select: {
                id: true,
                assetId: true,
                componentId: true,
                maintenanceType: true,
                status: true,
                performedAt: true,
                nextMaintenanceDate: true,
                reason: true,
            },
            orderBy: { createdAt: 'desc' },
            take: INVENTORY_AI_MAX_MAINTENANCE,
        }),
        prisma.assetLifecycleEvent.findMany({
            where: { assetId: { in: assetIds } },
            select: {
                id: true,
                assetId: true,
                componentId: true,
                eventType: true,
                reason: true,
                createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
            take: INVENTORY_AI_MAX_EVENTS,
        }),
        prisma.spareStockItem.findMany({
            select: {
                id: true,
                partName: true,
                componentType: true,
                quantityAvailable: true,
                minimumStockLevel: true,
                reorderPoint: true,
                unitCost: true,
                vendor: true,
                location: true,
                compatibleAssetTypes: true,
            },
            orderBy: { updatedAt: 'desc' },
            take: INVENTORY_AI_MAX_SPARE_STOCK,
        }),
    ]);

    return { assets, components, maintenance, lifecycleEvents, spareStock };
}

function buildAiMatchedItem(asset: Asset, reason: string, parentAssetId: string | null = null): InventoryAiMatchedItem {
    return {
        assetId: asset.customId,
        name: asset.name,
        type: canonicalAssetType(asset.type),
        category: String(asset.category || '').toLowerCase(),
        status: String(asset.status || '').toLowerCase(),
        lifecycleStatus: String(asset.lifecycleStatus || '').toLowerCase(),
        location: mapLocationToFriendly(asset.location),
        department: mapDepartmentToFriendly(asset.department),
        serialNumber: normalizeSerialValue(asset.serialNumber),
        assetTag: normalizeSerialValue(asset.assetTag),
        reason,
        parentAssetId,
    };
}

function classifyAiQueryIntent(query: string): string {
    const q = String(query || '')
        .toLowerCase()
        .replace(/[’‘`´]/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
    if (!q.trim()) return 'unknown';
    const has = (...phrases: string[]) => phrases.some((phrase) => q.includes(phrase));

    if (
        /(?:what changed|show changes|daily brief|today(?:'s)? inventory brief|inventory changes this week)/.test(q)
        || has('what changed today', "today's inventory brief", 'give me todays inventory brief', 'show inventory changes this week', 'daily brief')
    ) return 'daily_brief';
    if (
        /(?:generate|create|give|show|build).*(?:monthly).*(?:inventory|asset).*(?:report|summary)/.test(q)
        || has('monthly inventory report', 'monthly asset report', 'inventory monthly summary', "this month's inventory report", 'inventory report this month')
    ) return 'monthly_report';
    if (
        /(?:executive dashboard|management summary|executive summary).*(?:inventory|asset)/.test(q)
        || has('show executive dashboard', 'generate executive inventory dashboard summary', 'inventory management summary')
    ) return 'executive_dashboard';
    if (has('digital twin', 'show digital twin for this asset', 'asset digital twin')) return 'digital_twin';
    if (has('black box timeline', 'blackbox timeline', 'show black box timeline for this asset', 'asset black box timeline')) return 'black_box_timeline';
    if ((has('missing', 'without') && has('serial'))) return 'missing_serials';
    if ((has('missing', 'without') && has('data')) || has('data quality')) return 'missing_data';
    if (has('duplicate serial', 'same serial')) return 'duplicate_serials';
    if (has('duplicate asset tag', 'same asset tag', 'duplicate tag')) return 'duplicate_asset_tags';
    if (has('find duplicate', 'possible duplicate', 'duplicate assets', 'duplicate records')) return 'duplicates';
    if (has('warranty') && has('expired', 'expire', 'expiring')) return 'warranty_expiry';
    if (has('maintenance', 'repair priority', 'maintenance priority', 'need maintenance')) return 'maintenance';
    if (has('component') && has('fail', 'replace', 'repair', 'damag')) return 'component_failures';
    if (has('low stock', 'reorder', 'spare stock', 'stock forecast')) return 'low_stock';
    if (has('buy next', 'what should we buy', 'procurement', 'purchase next', 'what to buy')) return 'procurement';
    if (has('reallocation', 're-allocate', 'tech exchange', 'internal transfer suggestion', 'reuse before buy')) return 'reallocation';
    if (has('eol', 'end of life', 'near eol', 'expired lifecycle')) return 'eol';
    if (has('license') && has('expire', 'expir', 'renew')) return 'license_expiry';
    if (has('risk score', 'risk scores', 'high risk assets', 'critical assets')) return 'risk_score';
    if (has('replacement priority', 'replace first', 'replacement ranking')) return 'replacement_priority';
    if (has('relationship') && has('suggest', 'build', 'link')) return 'relationship_suggestions';
    if (has('ticket draft', 'draft ticket', 'create ticket draft')) return 'ticket_draft';
    if (has('transfer all', 'plan transfer', 'move all', 'assign all') || (has('transfer') && has('to'))) return 'natural_language_action';
    if (has('history') && has('component')) return 'component_history';
    if (has('find asset', 'lookup', 'show assets named', 'find assets named', 'search assets')) return 'asset_lookup';
    return 'unknown';
}

function normalizeLifecycleKey(value: unknown): string {
    return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

type InventoryAssistantDataScope = 'full_inventory' | 'filtered_view';
type InventoryInsightDataScope = InventoryAssistantDataScope | 'selected_asset';
type InventoryAiConfidence = 'low' | 'medium' | 'high';

type InventoryAssistantDeterministicResult = {
    answer: string;
    matchedItems: InventoryAiMatchedItem[];
    filtersUsed: Record<string, any>;
    confidence: 'low' | 'medium' | 'high';
    missingData: string[];
    suggestedActions: string[];
    supported: boolean;
    intent: string;
    scannedCount: number;
    missingCount: number | null;
    excludedCategories: string[];
    partialFailure: boolean;
};

function buildInventoryInsightConfidence(params: {
    dataScope: InventoryInsightDataScope;
    scannedCount: number;
    matchedCount: number;
    partialFailure?: boolean;
}): InventoryAiConfidence {
    if (params.partialFailure) return 'low';
    if (params.scannedCount <= 0) return 'low';
    if (params.dataScope === 'full_inventory' || params.dataScope === 'selected_asset') return 'high';
    return params.matchedCount > 0 ? 'high' : 'medium';
}

const FACTUAL_ASSISTANT_INTENTS = new Set([
    'missing_serial',
    'missing_serials',
    'missing_data',
    'duplicate_serials',
    'duplicate_asset_tags',
    'duplicates',
    'low_stock',
    'license_expiry',
    'warranty_expiry',
]);

const ASSISTANT_ROUTED_ACTION_BY_INTENT: Record<string, { action: string; endpoint: string }> = {
    daily_brief: { action: 'daily_brief', endpoint: '/api/inventory/ai/daily-brief' },
    monthly_report: { action: 'monthly_report', endpoint: '/api/inventory/ai/monthly-report' },
    executive_dashboard: { action: 'executive_dashboard', endpoint: '/api/inventory/executive-dashboard' },
    digital_twin: { action: 'digital_twin', endpoint: '/api/assets/:id/digital-twin' },
    black_box_timeline: { action: 'black_box_timeline', endpoint: '/api/assets/:id/black-box-timeline' },
    procurement: { action: 'procurement', endpoint: '/api/inventory/ai/procurement-recommendations' },
    reallocation: { action: 'reallocation', endpoint: '/api/inventory/ai/reallocation-suggestions' },
    low_stock: { action: 'spare_stock_forecast', endpoint: '/api/inventory/ai/spare-stock-forecast' },
    maintenance: { action: 'maintenance', endpoint: '/api/inventory/ai/maintenance-recommendations' },
    risk_score: { action: 'risk_scores', endpoint: '/api/inventory/ai/risk-score' },
    replacement_priority: { action: 'replacement_priority', endpoint: '/api/inventory/ai/replacement-priority' },
    relationship_suggestions: { action: 'relationship_suggestions', endpoint: '/api/inventory/ai/relationship-suggestions' },
    duplicates: { action: 'duplicates', endpoint: '/api/inventory/ai/duplicate-detection' },
    duplicate_serials: { action: 'duplicates', endpoint: '/api/inventory/ai/duplicate-detection' },
    duplicate_asset_tags: { action: 'duplicates', endpoint: '/api/inventory/ai/duplicate-detection' },
    missing_serial: { action: 'missing_data', endpoint: '/api/inventory/ai/missing-data' },
    missing_serials: { action: 'missing_data', endpoint: '/api/inventory/ai/missing-data' },
    missing_data: { action: 'missing_data', endpoint: '/api/inventory/ai/missing-data' },
    license_expiry: { action: 'search', endpoint: '/api/inventory/ai/search' },
    natural_language_action: { action: 'plan_action', endpoint: '/api/inventory/ai/plan-action' },
    ticket_draft: { action: 'ticket_draft', endpoint: '/api/inventory/ai/ticket-draft' },
    eol: { action: 'replacement_priority', endpoint: '/api/inventory/ai/replacement-priority' },
};

function deriveAssistantConfidence(params: {
    intent: string;
    dataScope: InventoryInsightDataScope;
    scannedCount: number;
    matchedCount: number;
    supported: boolean;
    partialFailure: boolean;
}): 'low' | 'medium' | 'high' {
    if (params.partialFailure) return 'low';
    if (!params.supported) return 'low';
    const isFactual = FACTUAL_ASSISTANT_INTENTS.has(String(params.intent || '').toLowerCase());
    if (isFactual) {
        if (params.dataScope === 'full_inventory' && params.scannedCount > 0) return 'high';
        if (params.dataScope === 'filtered_view' && params.scannedCount > 0) return params.matchedCount > 0 ? 'high' : 'medium';
        return params.dataScope === 'full_inventory' ? 'medium' : 'low';
    }
    const actionIntent = String(params.intent || '').toLowerCase();
    const highConfidenceActionIntents = new Set([
        'daily_brief',
        'monthly_report',
        'executive_dashboard',
        'digital_twin',
        'black_box_timeline',
        'natural_language_action',
        'risk_score',
        'replacement_priority',
        'maintenance',
        'procurement',
        'reallocation',
        'low_stock',
        'relationship_suggestions',
        'ticket_draft',
        'license_expiry',
        'eol',
    ]);
    if (highConfidenceActionIntents.has(actionIntent) && params.scannedCount > 0) {
        return params.dataScope === 'filtered_view' ? 'medium' : 'high';
    }
    if (params.matchedCount > 20) return 'high';
    if (params.matchedCount > 0) return 'medium';
    return 'low';
}

function normalizeAssistantView(value: unknown): string {
    const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const allowed = new Set(['parents', 'components', 'accessories', 'consumables', 'spare_stock', 'licenses']);
    return allowed.has(normalized) ? normalized : 'parents';
}

function assetMatchesAssistantView(asset: Asset, view: string): boolean {
    const category = String(asset.category || '').toLowerCase();
    if (view === 'components') return category === 'component';
    if (view === 'accessories') return category === 'accessory';
    if (view === 'consumables') return category === 'consumable';
    if (view === 'licenses') return category === 'license';
    if (view === 'spare_stock') return false;
    return !['component', 'accessory', 'consumable', 'spare_part', 'license'].includes(category);
}

function shouldUseFilteredScopeForAssistant(query: string, context: Record<string, any>): boolean {
    const q = String(query || '').toLowerCase();
    if (/(\bthis\b|\bcurrent\b).*(\bview\b|\btab\b)|\bfiltered\b/.test(q)) return true;
    if (parseBooleanFlag(context?.forceFilteredScope)) return true;
    return false;
}

function resolveInventoryAiScopeFromContext(
    fullSnapshot: InventoryAiSnapshot,
    context: Record<string, any> = {},
    query = '',
): { snapshot: InventoryAiSnapshot; dataScope: InventoryInsightDataScope } {
    const selectedAssetCustomId = normalizeSerialValue(context?.selectedAssetCustomId);
    if (selectedAssetCustomId) {
        const selectedAssets = fullSnapshot.assets.filter((asset) => asset.customId === selectedAssetCustomId);
        const selectedSet = new Set(selectedAssets.map((asset) => asset.customId));
        const selectedComponents = fullSnapshot.components.filter((row) => (
            selectedSet.has(row.parentAssetId) || (row.childAssetId ? selectedSet.has(row.childAssetId) : false)
        ));
        const selectedMaintenance = fullSnapshot.maintenance.filter((row) => selectedSet.has(row.assetId));
        const selectedLifecycle = fullSnapshot.lifecycleEvents.filter((row) => selectedSet.has(row.assetId));
        return {
            snapshot: {
                assets: selectedAssets,
                components: selectedComponents,
                maintenance: selectedMaintenance,
                lifecycleEvents: selectedLifecycle,
                spareStock: fullSnapshot.spareStock,
            },
            dataScope: 'selected_asset',
        };
    }
    const useFilteredScope = shouldUseFilteredScopeForAssistant(query, context);
    if (!useFilteredScope) {
        return { snapshot: fullSnapshot, dataScope: 'full_inventory' };
    }
    return {
        snapshot: filterSnapshotForAssistantContext(fullSnapshot, context),
        dataScope: 'filtered_view',
    };
}

function filterSnapshotForAssistantContext(
    snapshot: InventoryAiSnapshot,
    context: Record<string, any>,
): InventoryAiSnapshot {
    const view = normalizeAssistantView(context?.view);
    const filters = (context?.filters && typeof context.filters === 'object') ? context.filters : {};
    const search = String(context?.search || '').trim().toLowerCase();
    const building = String(filters.building || '').trim();
    const department = String(filters.department || '').trim();
    const lifecycleStatus = String(filters.lifecycleStatus || '').trim().toLowerCase();
    const type = String(filters.type || '').trim().toLowerCase();
    const selectedAssetCustomId = String(context?.selectedAssetCustomId || '').trim();

    let assets = snapshot.assets.filter((asset) => assetMatchesAssistantView(asset, view));
    assets = assets.filter((asset) => {
        const friendlyLocation = mapLocationToFriendly(asset.location);
        const friendlyDept = mapDepartmentToFriendly(asset.department);
        const assetType = canonicalAssetType(asset.type);
        const lifecycle = normalizeLifecycleKey(asset.lifecycleStatus);
        if (building && building !== 'all' && normalizeValue(friendlyLocation) !== normalizeValue(building)) return false;
        if (department && department !== 'all' && normalizeValue(friendlyDept) !== normalizeValue(department)) return false;
        if (type && type !== 'all' && normalizeValue(assetType) !== normalizeValue(type)) return false;
        if (lifecycleStatus && lifecycleStatus !== 'all' && normalizeValue(lifecycle) !== normalizeValue(lifecycleStatus)) return false;
        if (selectedAssetCustomId && asset.customId !== selectedAssetCustomId) return false;
        if (!search) return true;
        const haystack = [
            asset.customId,
            asset.name,
            canonicalAssetType(asset.type),
            String(asset.category || ''),
            mapLocationToFriendly(asset.location),
            mapDepartmentToFriendly(asset.department),
            normalizeSerialValue(asset.serialNumber) || '',
            normalizeSerialValue(asset.assetTag) || '',
            normalizeSerialValue(asset.manufacturerPartNumber) || '',
        ].join(' ').toLowerCase();
        return haystack.includes(search);
    });

    const allowedAssetIds = new Set(assets.map((asset) => asset.customId));
    const components = snapshot.components.filter((component) => (
        allowedAssetIds.has(component.parentAssetId) || (component.childAssetId ? allowedAssetIds.has(component.childAssetId) : false)
    ));
    const maintenance = snapshot.maintenance.filter((row) => allowedAssetIds.has(row.assetId));
    const lifecycleEvents = snapshot.lifecycleEvents.filter((row) => allowedAssetIds.has(row.assetId));
    const spareStock = snapshot.spareStock;
    return { assets, components, maintenance, lifecycleEvents, spareStock };
}

function buildAssistantLlmInput(result: InventoryAssistantDeterministicResult, query: string): Record<string, any> {
    const topMatched = (result.matchedItems || []).slice(0, 18).map((item) => ({
        assetId: item.assetId,
        name: item.name,
        category: item.category,
        type: item.type,
        location: item.location,
        status: item.status,
        lifecycleStatus: item.lifecycleStatus,
        reason: item.reason,
    }));
    return {
        query,
        answer: result.answer,
        intent: result.intent,
        filtersUsed: result.filtersUsed,
        confidence: result.confidence,
        missingData: result.missingData.slice(0, 10),
        suggestedActions: result.suggestedActions.slice(0, 10),
        scannedCount: result.scannedCount,
        missingCount: result.missingCount,
        excludedCategories: result.excludedCategories.slice(0, 12),
        matchedCount: result.matchedItems.length,
        matchedItems: topMatched,
        supported: result.supported,
    };
}

function deterministicAssistantAnswer(snapshot: InventoryAiSnapshot, query: string): InventoryAssistantDeterministicResult {
    const intent = classifyAiQueryIntent(query);
    const now = new Date();
    const matchedItems: InventoryAiMatchedItem[] = [];
    const suggestedActions: string[] = [];
    const missingData: string[] = [];
    const filtersUsed: Record<string, any> = { intent };
    let scannedCount = 0;
    let missingCount: number | null = null;
    let excludedCategories: string[] = [];
    const partialFailure = false;

    if (intent === 'missing_serial' || intent === 'missing_serials') {
        excludedCategories = ['license', 'consumable', 'spare_part'];
        const assetsToScan = snapshot.assets.filter((asset) => !excludedCategories.includes(String(asset.category || '').toLowerCase()));
        scannedCount = assetsToScan.length;
        assetsToScan.forEach((asset) => {
            const category = String(asset.category || '').toLowerCase();
            if (excludedCategories.includes(category)) return;
            if (!normalizeSerialValue(asset.serialNumber)) {
                matchedItems.push(buildAiMatchedItem(asset, 'Missing serial number'));
            }
        });
        missingCount = matchedItems.length;
        suggestedActions.push('Backfill serial numbers for high-priority and assigned assets first.');
    } else if (intent === 'warranty_expiry') {
        const soonDays = 90;
        filtersUsed.windowDays = soonDays;
        scannedCount = snapshot.assets.length;
        snapshot.assets.forEach((asset) => {
            if (!asset.warrantyEndDate) return;
            const diff = (asset.warrantyEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
            if (diff <= soonDays) {
                const label = diff < 0 ? 'Warranty expired' : `Warranty expires in ${Math.ceil(diff)} day(s)`;
                matchedItems.push(buildAiMatchedItem(asset, label));
            }
        });
        suggestedActions.push('Plan renewals/replacements for assets with expired or soon-expiring warranty.');
    } else if (intent === 'maintenance') {
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const impacted = new Set<string>();
        scannedCount = snapshot.assets.length;
        snapshot.maintenance.forEach((row) => {
            const targetDate = row.nextMaintenanceDate || row.performedAt;
            if (!targetDate) return;
            if (targetDate.getMonth() === currentMonth && targetDate.getFullYear() === currentYear) {
                impacted.add(row.assetId);
            }
        });
        snapshot.assets.forEach((asset) => {
            if (impacted.has(asset.customId)) {
                matchedItems.push(buildAiMatchedItem(asset, 'Maintenance due this month'));
            }
        });
        suggestedActions.push('Schedule this month maintenance items and assign responsible technicians.');
    } else if (intent === 'component_failures') {
        const failures = new Map<string, number>();
        scannedCount = snapshot.assets.length;
        snapshot.lifecycleEvents.forEach((event) => {
            const key = normalizeValue(event.eventType);
            if (key.includes('failed') || key.includes('repair') || key.includes('replace')) {
                failures.set(event.assetId, (failures.get(event.assetId) || 0) + 1);
            }
        });
        snapshot.assets.forEach((asset) => {
            const count = failures.get(asset.customId) || 0;
            if (count > 0) {
                matchedItems.push(buildAiMatchedItem(asset, `${count} component issue event(s)`));
            }
        });
        suggestedActions.push('Inspect repeated component failures and evaluate preventive replacement plans.');
    } else if (intent === 'low_stock') {
        const consumableCount = snapshot.assets.filter((asset) => String(asset.category || '').toLowerCase() === 'consumable').length;
        scannedCount = snapshot.spareStock.length + consumableCount;
        snapshot.spareStock.forEach((item) => {
            const reorder = item.reorderPoint ?? item.minimumStockLevel;
            if (item.quantityAvailable <= reorder) {
                matchedItems.push({
                    assetId: item.id,
                    name: item.partName,
                    type: String(item.componentType || 'component'),
                    category: 'spare_part',
                    status: 'in_stock',
                    lifecycleStatus: 'in_stock',
                    location: String(item.location || '-'),
                    department: '-',
                    serialNumber: null,
                    assetTag: null,
                    reason: `Low stock (${item.quantityAvailable} <= ${reorder})`,
                });
            }
        });
        snapshot.assets.forEach((asset) => {
            const category = String(asset.category || '').toLowerCase();
            if (category !== 'consumable') return;
            const qty = Number(asset.quantity || 0);
            if (qty <= 5) {
                matchedItems.push(buildAiMatchedItem(asset, `Low consumable stock (${qty})`));
            }
        });
        suggestedActions.push('Create purchase requests for low-stock spare parts.');
    } else if (intent === 'procurement') {
        const consumableCount = snapshot.assets.filter((asset) => String(asset.category || '').toLowerCase() === 'consumable').length;
        scannedCount = snapshot.spareStock.length + consumableCount;
        snapshot.spareStock.forEach((item) => {
            const reorder = item.reorderPoint ?? item.minimumStockLevel;
            if (item.quantityAvailable <= reorder) {
                matchedItems.push({
                    assetId: item.id,
                    name: item.partName,
                    type: String(item.componentType || 'component'),
                    category: 'spare_part',
                    status: 'in_stock',
                    lifecycleStatus: 'in_stock',
                    location: String(item.location || '-'),
                    department: '-',
                    serialNumber: null,
                    assetTag: null,
                    reason: `Reorder suggested (${item.quantityAvailable} available)`,
                });
            }
        });
        snapshot.assets.forEach((asset) => {
            const category = String(asset.category || '').toLowerCase();
            if (category !== 'consumable') return;
            const qty = Number(asset.quantity || 0);
            if (qty <= 5) {
                matchedItems.push(buildAiMatchedItem(asset, `Consumable restock suggested (${qty})`));
            }
        });
        suggestedActions.push('Prioritize procurement by stock criticality and failure trends.');
    } else if (intent === 'eol') {
        scannedCount = snapshot.assets.length;
        snapshot.assets.forEach((asset) => {
            const lifecycle = normalizeLifecycleKey(asset.lifecycleStatus);
            if (lifecycle === 'eol_expired') {
                matchedItems.push(buildAiMatchedItem(asset, 'Lifecycle status marked EOL expired'));
                return;
            }
            if (asset.warrantyEndDate) {
                const diff = (asset.warrantyEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
                if (diff <= 0) {
                    matchedItems.push(buildAiMatchedItem(asset, 'Warranty ended (potential EOL risk)'));
                }
            }
        });
        suggestedActions.push('Review EOL-risk assets for replacement planning.');
    } else if (intent === 'license_expiry') {
        const licenses = snapshot.assets.filter((asset) => String(asset.category || '').toLowerCase() === 'license');
        scannedCount = licenses.length;
        licenses.forEach((asset) => {
            if (String(asset.category || '').toLowerCase() !== 'license') return;
            if (!asset.warrantyEndDate) return;
            const diff = (asset.warrantyEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
            if (diff <= 90) {
                const reason = diff < 0 ? 'License expired' : `License expires in ${Math.ceil(diff)} day(s)`;
                matchedItems.push(buildAiMatchedItem(asset, reason));
            }
        });
        suggestedActions.push('Renew or reassign expiring licenses before service interruption.');
    } else if (intent === 'duplicates' || intent === 'duplicate_serials' || intent === 'duplicate_asset_tags') {
        scannedCount = snapshot.assets.length;
        const serialMap = new Map<string, Asset[]>();
        const tagMap = new Map<string, Asset[]>();
        snapshot.assets.forEach((asset) => {
            const serial = normalizeSerialValue(asset.serialNumber);
            const tag = normalizeSerialValue(asset.assetTag);
            if (serial) {
                const serialKey = serial.toLowerCase();
                serialMap.set(serialKey, [...(serialMap.get(serialKey) || []), asset]);
            }
            if (tag) {
                const tagKey = tag.toLowerCase();
                tagMap.set(tagKey, [...(tagMap.get(tagKey) || []), asset]);
            }
        });
        serialMap.forEach((rows) => {
            if (rows.length <= 1) return;
            rows.forEach((asset) => matchedItems.push(buildAiMatchedItem(asset, `Duplicate serial (${asset.serialNumber})`)));
        });
        tagMap.forEach((rows) => {
            if (rows.length <= 1) return;
            rows.forEach((asset) => matchedItems.push(buildAiMatchedItem(asset, `Duplicate asset tag (${asset.assetTag})`)));
        });
        suggestedActions.push('Merge or correct duplicate records after verification.');
    } else if (intent === 'risk_score') {
        const riskRows = buildAssetRiskScores(snapshot).rows;
        scannedCount = riskRows.length;
        riskRows
            .filter((row) => ['critical', 'high', 'medium'].includes(String(row.riskLevel || '').toLowerCase()))
            .slice(0, 120)
            .forEach((row) => {
                const asset = snapshot.assets.find((entry) => entry.customId === row.assetId);
                if (!asset) return;
                matchedItems.push(buildAiMatchedItem(asset, `Risk ${row.riskLevel} (${row.riskScore})`));
            });
        suggestedActions.push('Review critical/high risk assets first and draft maintenance or replacement actions.');
    } else if (intent === 'replacement_priority') {
        const ranking = buildReplacementPriorityRanking(snapshot).rankedItems.slice(0, 120);
        scannedCount = snapshot.assets.length;
        ranking.forEach((row) => {
            const asset = snapshot.assets.find((entry) => entry.customId === row.assetId);
            if (!asset) return;
            matchedItems.push(buildAiMatchedItem(asset, `${row.priority} priority replacement (rank ${row.rank})`));
        });
        suggestedActions.push('Start with top-ranked replacement candidates and verify budget/stock impact.');
    } else if (intent === 'reallocation') {
        const reallocation = buildReallocationSuggestions(snapshot).suggestions.slice(0, 120);
        scannedCount = snapshot.assets.length;
        reallocation.forEach((row) => {
            const asset = snapshot.assets.find((entry) => entry.customId === row.availableAssetId);
            if (!asset) return;
            matchedItems.push(buildAiMatchedItem(
                asset,
                `Can satisfy "${row.requestedNeed}" from ${row.sourceLocation} (internal reallocation)`,
            ));
        });
        suggestedActions.push('Review reallocation opportunities before creating external procurement requests.');
    } else if (intent === 'relationship_suggestions') {
        const suggestions = buildRelationshipSuggestions(snapshot).suggestions.slice(0, 120);
        scannedCount = snapshot.assets.length;
        suggestions.forEach((row) => {
            const source = snapshot.assets.find((entry) => entry.customId === row.sourceAssetId);
            if (!source) return;
            matchedItems.push(buildAiMatchedItem(source, `${row.relationshipType} -> ${row.targetAssetId}`));
        });
        suggestedActions.push('Review suggested links before applying relationships.');
    } else if (intent === 'ticket_draft') {
        scannedCount = snapshot.assets.length;
        const riskRows = buildAssetRiskScores(snapshot).rows.filter((row) => ['critical', 'high'].includes(String(row.riskLevel || '').toLowerCase()));
        riskRows.slice(0, 20).forEach((row) => {
            const asset = snapshot.assets.find((entry) => entry.customId === row.assetId);
            if (!asset) return;
            matchedItems.push(buildAiMatchedItem(asset, `Candidate for ticket draft (${row.riskLevel})`));
        });
        suggestedActions.push('Use "Draft Ticket" to generate issue drafts for high-risk assets.');
    } else if (intent === 'daily_brief') {
        scannedCount = snapshot.assets.length;
        suggestedActions.push('Run the daily brief action to summarize key inventory changes for today or this week.');
    } else if (intent === 'monthly_report') {
        scannedCount = snapshot.assets.length;
        suggestedActions.push('Run the monthly report action to get an executive summary, metrics, and recommendations.');
    } else if (intent === 'executive_dashboard') {
        scannedCount = snapshot.assets.length;
        suggestedActions.push('Run the executive dashboard action to get leadership metrics and risk posture.');
    } else if (intent === 'digital_twin') {
        scannedCount = snapshot.assets.length;
        suggestedActions.push('Open/select an asset and run Digital Twin to view risk, kit health, telemetry, and lifecycle posture.');
    } else if (intent === 'black_box_timeline') {
        scannedCount = snapshot.assets.length;
        suggestedActions.push('Open/select an asset and run Black Box Timeline to inspect transfer, maintenance, audit, and related-item events.');
    } else if (intent === 'natural_language_action') {
        scannedCount = snapshot.assets.length;
        suggestedActions.push('Use natural-language action planning to preview changes before execution.');
    } else if (intent === 'component_history') {
        scannedCount = snapshot.assets.length;
        const impacted = new Map<string, number>();
        snapshot.lifecycleEvents.forEach((event) => {
            if (!event.componentId) return;
            impacted.set(event.assetId, (impacted.get(event.assetId) || 0) + 1);
        });
        snapshot.assets.forEach((asset) => {
            const count = impacted.get(asset.customId) || 0;
            if (count > 0) matchedItems.push(buildAiMatchedItem(asset, `${count} component history event(s)`));
        });
        suggestedActions.push('Open asset CMDB history with related events for component timelines.');
    } else if (intent === 'asset_lookup') {
        scannedCount = snapshot.assets.length;
        const lookupTokens = String(query || '')
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .map((token) => token.trim())
            .filter((token) => token.length >= 2)
            .filter((token) => !['show', 'find', 'list', 'asset', 'assets', 'named', 'search', 'for', 'in', 'the'].includes(token))
            .slice(0, 8);
        snapshot.assets.forEach((asset) => {
            const haystack = [
                asset.customId,
                asset.name,
                normalizeSerialValue(asset.assetTag) || '',
                normalizeSerialValue(asset.serialNumber) || '',
                canonicalAssetType(asset.type),
            ].join(' ').toLowerCase();
            if (!lookupTokens.length || lookupTokens.every((token) => haystack.includes(token))) {
                matchedItems.push(buildAiMatchedItem(asset, 'Lookup match'));
            }
        });
        suggestedActions.push('Open matched assets to inspect CMDB details and history.');
    } else {
        const tokens = String(query || '')
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .map((token) => token.trim())
            .filter((token) => token.length >= 3)
            .slice(0, 10);
        if (tokens.length) {
            const fuzzyMatches = snapshot.assets.filter((asset) => {
                const haystack = [
                    asset.customId,
                    asset.name,
                    canonicalAssetType(asset.type),
                    String(asset.category || ''),
                    mapLocationToFriendly(asset.location),
                    mapDepartmentToFriendly(asset.department),
                    normalizeSerialValue(asset.serialNumber) || '',
                    normalizeSerialValue(asset.assetTag) || '',
                    normalizeLifecycleKey(asset.lifecycleStatus),
                ].join(' ').toLowerCase();
                return tokens.every((token) => haystack.includes(token));
            }).slice(0, 120);
            if (fuzzyMatches.length) {
                return {
                    answer: `Found ${fuzzyMatches.length} item(s) from token search for "${query}".`,
                    matchedItems: fuzzyMatches.map((asset) => buildAiMatchedItem(asset, 'Matched by query text')),
                    filtersUsed: { intent: 'token_search', tokens },
                    confidence: fuzzyMatches.length > 20 ? 'medium' : 'low',
                    missingData: [],
                    suggestedActions: ['Refine your query with location/type/status terms for more precise results.'],
                    supported: true,
                    intent: 'token_search',
                    scannedCount: snapshot.assets.length,
                    missingCount: null,
                    excludedCategories: [],
                    partialFailure: false,
                };
            }
        }
        return {
            answer: INVENTORY_AI_SUPPORTED_HINT,
            matchedItems: [],
            filtersUsed,
            confidence: 'low',
            missingData: [],
            suggestedActions: ['Ask about missing serials, warranty expiry, maintenance, stock, duplicates, EOL, or procurement.'],
            supported: false,
            intent: 'unknown',
            scannedCount: snapshot.assets.length,
            missingCount: null,
            excludedCategories: [],
            partialFailure: false,
        };
    }

    if (!snapshot.assets.length) missingData.push('assets');
    if (!snapshot.components.length) missingData.push('components');
    if (!snapshot.maintenance.length) missingData.push('maintenanceRecords');
    if (!snapshot.lifecycleEvents.length) missingData.push('lifecycleEvents');
    if (!snapshot.spareStock.length) missingData.push('spareStockItems');

    const noMatchMessageByIntent: Record<string, string> = {
        missing_serials: 'No missing serial numbers found in the scanned inventory categories.',
        missing_serial: 'No missing serial numbers found in the scanned inventory categories.',
        duplicates: 'No duplicate serial/asset-tag groups were found in the scanned inventory set.',
        duplicate_serials: 'No duplicate serial numbers were found in the scanned inventory set.',
        duplicate_asset_tags: 'No duplicate asset tags were found in the scanned inventory set.',
        low_stock: 'No low-stock spare/consumable items were found in the scanned inventory set.',
        procurement: 'No urgent procurement gaps were detected from current stock and usage signals.',
        reallocation: 'No confident internal reallocation opportunities were detected from current stock and availability.',
        maintenance: 'No assets were flagged as needing immediate maintenance in the scanned set.',
        warranty_expiry: 'No soon-expiring warranty assets were found in the scanned set.',
        license_expiry: 'No soon-expiring licenses were found in the scanned set.',
        risk_score: 'No high/critical risk assets were detected in the scanned set.',
        replacement_priority: 'No replacement-priority candidates were found in the scanned set.',
        relationship_suggestions: 'No relationship suggestions were generated from current deterministic evidence.',
        daily_brief: 'Daily brief request recognized. Running the daily brief action will summarize recent inventory changes.',
        monthly_report: 'Monthly inventory report request recognized. Running the monthly report action will generate executive summary, metrics, and recommendations.',
        executive_dashboard: 'Executive dashboard request recognized. Running the executive dashboard action will return management metrics.',
        digital_twin: 'Digital Twin request recognized. Select an asset and run the Digital Twin action for a full asset scorecard.',
        black_box_timeline: 'Black Box Timeline request recognized. Select an asset and run the timeline action to view chronological events.',
        natural_language_action: 'Action request recognized. A review-first action plan can be generated before any execution.',
        ticket_draft: 'Ticket draft request recognized. Provide issue details to generate a reviewable draft.',
        eol: 'No explicit EOL-risk matches were found in the scanned set.',
    };
    const answer = matchedItems.length
        ? (
            intent === 'missing_serial' || intent === 'missing_serials'
                ? `Found ${matchedItems.length} asset(s) missing serial numbers in the scanned inventory categories.`
                : `Found ${matchedItems.length} matching item(s) for "${query}".`
        )
        : (noMatchMessageByIntent[intent] || `No matching records were found for "${query}" in the current dataset.`);
    const highConfidenceZeroIntents = new Set([
        'missing_serial',
        'missing_serials',
        'missing_data',
        'duplicates',
        'duplicate_serials',
        'duplicate_asset_tags',
        'low_stock',
        'procurement',
        'reallocation',
        'license_expiry',
        'warranty_expiry',
        'daily_brief',
        'monthly_report',
        'executive_dashboard',
        'digital_twin',
        'black_box_timeline',
        'natural_language_action',
    ]);
    const confidence: 'low' | 'medium' | 'high' = matchedItems.length > 20
        ? 'high'
        : matchedItems.length > 0
            ? 'medium'
            : (highConfidenceZeroIntents.has(String(intent || '').toLowerCase()) && scannedCount > 0 ? 'high' : 'low');

    return {
        answer,
        matchedItems: matchedItems.slice(0, 120),
        filtersUsed,
        confidence,
        missingData,
        suggestedActions,
        supported: true,
        intent,
        scannedCount: scannedCount || snapshot.assets.length,
        missingCount,
        excludedCategories,
        partialFailure,
    };
}

function applyAssistantQueryFilters(
    result: InventoryAssistantDeterministicResult,
    snapshot: InventoryAiSnapshot,
    query: string,
    dataScope: InventoryInsightDataScope,
): InventoryAssistantDeterministicResult {
    const q = String(query || '').toLowerCase();
    let filtered = [...result.matchedItems];
    const filtersUsed: Record<string, any> = { ...(result.filtersUsed || {}) };

    const categoryHints: Array<{ key: string; categories: string[] }> = [
        { key: 'license', categories: ['license'] },
        { key: 'component', categories: ['component'] },
        { key: 'accessory', categories: ['accessory'] },
        { key: 'consumable', categories: ['consumable'] },
        { key: 'spare', categories: ['spare_part'] },
        { key: 'stock', categories: ['spare_part', 'consumable'] },
    ];
    const categoryMatch = categoryHints.find((hint) => q.includes(hint.key));
    if (categoryMatch) {
        filtered = filtered.filter((item) => categoryMatch.categories.includes(String(item.category || '').toLowerCase()));
        filtersUsed.categoryHint = categoryMatch.key;
    }

    const locationHints = Array.from(new Set(snapshot.assets.map((asset) => mapLocationToFriendly(asset.location).trim()).filter(Boolean)));
    const matchedLocation = locationHints.find((location) => q.includes(location.toLowerCase()));
    if (matchedLocation) {
        filtered = filtered.filter((item) => String(item.location || '').toLowerCase() === matchedLocation.toLowerCase());
        filtersUsed.location = matchedLocation;
    }

    const departmentHints = Array.from(new Set(snapshot.assets.map((asset) => mapDepartmentToFriendly(asset.department).trim()).filter(Boolean)));
    const matchedDepartment = departmentHints.find((department) => q.includes(department.toLowerCase()));
    if (matchedDepartment) {
        filtered = filtered.filter((item) => String(item.department || '').toLowerCase() === matchedDepartment.toLowerCase());
        filtersUsed.department = matchedDepartment;
    }

    const isMissingSerialIntent = String(result.intent || '').toLowerCase() === 'missing_serial'
        || String(result.intent || '').toLowerCase() === 'missing_serials';
    const isRoutedActionIntent = Boolean(ASSISTANT_ROUTED_ACTION_BY_INTENT[String(result.intent || '').toLowerCase()]);
    const answer = filtered.length
        ? `Found ${filtered.length} matching item(s) for "${query}".`
        : (isMissingSerialIntent
            ? 'No missing serial numbers found in the scanned inventory categories.'
            : (isRoutedActionIntent
                ? String(result.answer || `Request recognized for "${query}".`)
                : `I did not find matching records for "${query}". Try broadening filters or switching to full inventory.`));

    return {
        ...result,
        answer,
        matchedItems: filtered.slice(0, 120),
        filtersUsed,
        confidence: deriveAssistantConfidence({
            intent: result.intent,
            dataScope,
            scannedCount: result.scannedCount,
            matchedCount: filtered.length,
            supported: result.supported,
            partialFailure: result.partialFailure,
        }),
    };
}

function deterministicImportColumnMapping(params: {
    headers: string[];
    expectedFields: string[];
}): {
    mappings: Array<{ sourceColumn: string; targetColumn: string; confidence: number; reason: string }>;
    unmappedColumns: string[];
    warnings: string[];
} {
    const aliases: Record<string, string> = {
        serialno: 'Serial Number',
        serialnumber: 'Serial Number',
        devicetag: 'Asset Tag',
        assetid: 'Asset Tag',
        assigneddept: 'Department',
        dept: 'Department',
        itemtype: 'Asset Type',
        parenttag: 'Parent Asset Tag',
        warrantyexp: 'Warranty End Date',
        warrantyexpiry: 'Warranty End Date',
        purchdate: 'Purchase Date',
        recordtype: 'Record Type',
        component: 'Component Type',
    };
    const normalizedExpected = new Map<string, string>();
    (params.expectedFields || []).forEach((field) => {
        normalizedExpected.set(normalizeImportHeader(field), field);
    });
    const mappings: Array<{ sourceColumn: string; targetColumn: string; confidence: number; reason: string }> = [];
    const unmappedColumns: string[] = [];
    const warnings: string[] = [];

    (params.headers || []).forEach((source) => {
        const normalized = normalizeImportHeader(source);
        let target = normalizedExpected.get(normalized) || aliases[normalized] || '';
        if (!target) {
            const fuzzy = Array.from(normalizedExpected.entries()).find(([key]) => key.includes(normalized) || normalized.includes(key));
            if (fuzzy) target = fuzzy[1];
        }
        if (!target) {
            unmappedColumns.push(source);
            return;
        }
        const confidence = normalizedExpected.has(normalized) ? 0.96 : (aliases[normalized] ? 0.9 : 0.72);
        mappings.push({
            sourceColumn: source,
            targetColumn: target,
            confidence,
            reason: normalizedExpected.has(normalized)
                ? 'Exact normalized header match.'
                : (aliases[normalized]
                    ? 'Mapped using known inventory header alias.'
                    : 'Mapped using fuzzy normalized header similarity.'),
        });
    });
    if (unmappedColumns.length) {
        warnings.push(`${unmappedColumns.length} column(s) could not be mapped automatically.`);
    }
    return { mappings, unmappedColumns, warnings };
}

function extractHeadersAndSampleRowsFromCsv(fileContent: string): { headers: string[]; sampleRows: Record<string, string>[] } {
    const rows = parseCsvContent(fileContent || '');
    if (!rows.length) return { headers: [], sampleRows: [] };
    const headers = (rows[0] || []).map((entry) => String(entry || '').trim()).filter(Boolean);
    const sampleRows = rows.slice(1, 6).map((row) => {
        const mapped: Record<string, string> = {};
        headers.forEach((header, index) => {
            mapped[header] = String(row[index] || '').trim();
        });
        return mapped;
    });
    return { headers, sampleRows };
}

function extractCandidateRowsFromDocumentText(documentText: string): Array<Record<string, any>> {
    const text = String(documentText || '');
    const lines = text.split(/\r?\n/).map((line) => String(line || '').trim()).filter(Boolean);
    const rows: Array<Record<string, any>> = [];
    for (const line of lines.slice(0, 400)) {
        const parts = line.split(/[|,\t;]/).map((entry) => String(entry || '').trim()).filter(Boolean);
        if (parts.length < 2) continue;
        const name = parts[0];
        const serialCandidate = parts.find((entry) => /[A-Z0-9]{4,}/i.test(entry) && /sn|serial/i.test(entry) === false) || '';
        const recordType = /license|subscription/i.test(line)
            ? 'license'
            : /toner|ink|paper|battery|label/i.test(line)
                ? 'consumable'
                : /spare|stock|replacement/i.test(line)
                    ? 'spare_stock'
                    : /ram|ssd|hdd|cpu|gpu|psu|battery|charger/i.test(line)
                        ? 'component_asset'
                        : 'parent_asset';
        rows.push({
            recordType,
            assetName: name,
            serialNumber: serialCandidate || '',
            notes: line,
            quantity: 1,
        });
    }
    return rows.slice(0, 250);
}

function computeMissingDataReport(snapshot: InventoryAiSnapshot): {
    totalIssues: number;
    criticalIssues: number;
    warnings: string[];
    assetsWithIssues: Array<Record<string, any>>;
    recommendations: string[];
    confidence: 'low' | 'medium' | 'high';
} {
    const issues: Array<Record<string, any>> = [];
    const childLinkedIds = new Set(snapshot.components.map((row) => row.childAssetId).filter(Boolean) as string[]);
    const now = new Date();
    snapshot.assets.forEach((asset) => {
        const category = String(asset.category || '').toLowerCase();
        const serialMissing = !normalizeSerialValue(asset.serialNumber);
        const tagMissing = !normalizeSerialValue(asset.assetTag);
        const vendorMissing = !normalizeSerialValue((asset as any).vendor);
        const locationMissing = !String(asset.location || '').trim();
        const departmentMissing = !String(asset.department || '').trim();
        const purchaseMissing = !asset.purchaseDate;
        const warrantyMissing = !asset.warrantyEndDate;
        const createdAt = new Date(asset.createdAt);
        const assetAgeDays = Math.max(0, (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
        const maintenanceExists = snapshot.maintenance.some((row) => row.assetId === asset.customId);
        const needsMaintenanceHistory = assetAgeDays > 365 && !maintenanceExists;

        if (!['consumable', 'spare_part'].includes(category) && serialMissing) {
            issues.push({ severity: 'critical', issue: 'missing_serial', assetId: asset.customId, assetName: asset.name, category, message: 'Serial number is missing.' });
        }
        if (!['consumable', 'spare_part'].includes(category) && tagMissing) {
            issues.push({ severity: 'warning', issue: 'missing_asset_tag', assetId: asset.customId, assetName: asset.name, category, message: 'Asset tag is missing.' });
        }
        if (warrantyMissing && category !== 'consumable' && category !== 'spare_part') {
            issues.push({ severity: 'warning', issue: 'missing_warranty_end', assetId: asset.customId, assetName: asset.name, category, message: 'Warranty end date is missing.' });
        }
        if (purchaseMissing && category !== 'consumable' && category !== 'spare_part') {
            issues.push({ severity: 'warning', issue: 'missing_purchase_date', assetId: asset.customId, assetName: asset.name, category, message: 'Purchase date is missing.' });
        }
        if (vendorMissing && ['asset', 'component', 'accessory', 'license'].includes(category)) {
            issues.push({ severity: 'info', issue: 'missing_vendor', assetId: asset.customId, assetName: asset.name, category, message: 'Vendor is missing.' });
        }
        if (locationMissing) {
            issues.push({ severity: 'critical', issue: 'missing_location', assetId: asset.customId, assetName: asset.name, category, message: 'Location is missing.' });
        }
        if (departmentMissing) {
            issues.push({ severity: 'warning', issue: 'missing_department', assetId: asset.customId, assetName: asset.name, category, message: 'Department is missing.' });
        }
        if (category === 'component' && !childLinkedIds.has(asset.customId)) {
            const specs = ((asset.specifications as Record<string, any>) || {});
            const hasParentMeta = Boolean(
                normalizeSerialValue(specs.installedInAssetId)
                || normalizeSerialValue(specs.parentAssetId)
                || normalizeSerialValue(specs.installedInAssetTag)
            );
            if (!hasParentMeta) {
                issues.push({
                    severity: 'critical',
                    issue: 'component_missing_parent_relation',
                    assetId: asset.customId,
                    assetName: asset.name,
                    category,
                    message: 'Component asset has no parent relation/link.',
                });
            }
        }
        if (needsMaintenanceHistory && ['asset', 'component', 'accessory'].includes(category)) {
            issues.push({
                severity: 'info',
                issue: 'missing_maintenance_history',
                assetId: asset.customId,
                assetName: asset.name,
                category,
                message: 'Asset is older than one year with no maintenance records.',
            });
        }
    });

    snapshot.components.forEach((component) => {
        if (!normalizeSerialValue(component.serialNumber)) {
            issues.push({
                severity: 'warning',
                issue: 'component_row_missing_serial',
                assetId: component.parentAssetId,
                assetName: component.componentName,
                category: 'component',
                message: `Component row ${component.componentName} is missing serial number.`,
            });
        }
    });

    const criticalIssues = issues.filter((issue) => issue.severity === 'critical').length;
    const warningIssues = issues.filter((issue) => issue.severity === 'warning').length;
    const confidence: 'low' | 'medium' | 'high' = criticalIssues > 0
        ? 'high'
        : (warningIssues > 0 ? 'medium' : 'low');
    const recommendations = [
        'Fix critical identity fields first: serial number, parent link, location.',
        'Backfill warranty and purchase dates for stronger lifecycle/EOL confidence.',
        'Add maintenance records for older or high-usage assets.',
    ];

    return {
        totalIssues: issues.length,
        criticalIssues,
        warnings: [
            `${criticalIssues} critical issue(s)`,
            `${warningIssues} warning issue(s)`,
        ],
        assetsWithIssues: issues.slice(0, 500),
        recommendations,
        confidence,
    };
}

function buildMaintenanceRecommendations(snapshot: InventoryAiSnapshot): Array<Record<string, any>> {
    const recommendationMap = new Map<string, Record<string, any>>();
    const failureCounts = new Map<string, number>();
    const now = new Date();
    snapshot.lifecycleEvents.forEach((event) => {
        const key = normalizeValue(event.eventType);
        if (key.includes('failed') || key.includes('repair') || key.includes('replace')) {
            failureCounts.set(event.assetId, (failureCounts.get(event.assetId) || 0) + 1);
        }
    });

    snapshot.assets.forEach((asset) => {
        const category = String(asset.category || '').toLowerCase();
        if (['consumable', 'spare_part', 'license'].includes(category)) return;
        const failures = failureCounts.get(asset.customId) || 0;
        const lifecycle = normalizeLifecycleKey(asset.lifecycleStatus);
        const isRepairStatus = lifecycle === 'pending_repair' || lifecycle === 'under_maintenance';
        const lastMaintenance = snapshot.maintenance
            .filter((row) => row.assetId === asset.customId && row.performedAt)
            .sort((a, b) => new Date(b.performedAt || 0).getTime() - new Date(a.performedAt || 0).getTime())[0];
        const daysSinceMaintenance = lastMaintenance?.performedAt
            ? (now.getTime() - new Date(lastMaintenance.performedAt).getTime()) / (1000 * 60 * 60 * 24)
            : Number.POSITIVE_INFINITY;

        if (failures >= 2 || isRepairStatus || daysSinceMaintenance > 180) {
            const priority = failures >= 3 || isRepairStatus ? 'high' : 'medium';
            const reason = isRepairStatus
                ? 'Asset lifecycle indicates maintenance/repair status.'
                : failures >= 2
                    ? `Detected ${failures} failure/repair events.`
                    : `No recent maintenance records (${Math.round(daysSinceMaintenance)} days).`;
            recommendationMap.set(asset.customId, {
                assetId: asset.customId,
                assetName: asset.name,
                priority,
                reason,
                recommendedAction: isRepairStatus
                    ? 'Run diagnostic and complete maintenance ticket.'
                    : 'Schedule preventive maintenance inspection.',
                dueDateSuggestion: new Date(now.getTime() + (priority === 'high' ? 3 : 14) * 86400000).toISOString().slice(0, 10),
                evidence: {
                    failureEvents: failures,
                    lifecycleStatus: lifecycle,
                    daysSinceMaintenance: Number.isFinite(daysSinceMaintenance) ? Math.round(daysSinceMaintenance) : null,
                },
            });
        }
    });
    return Array.from(recommendationMap.values()).slice(0, 200);
}

function buildProcurementRecommendations(snapshot: InventoryAiSnapshot): Array<Record<string, any>> {
    const recommendations: Array<Record<string, any>> = [];
    const failureByComponentType = new Map<string, number>();
    snapshot.lifecycleEvents.forEach((event) => {
        const key = normalizeValue(event.eventType);
        if (!(key.includes('failed') || key.includes('replaced'))) return;
        const componentRef = snapshot.components.find((component) => component.id === event.componentId);
        if (!componentRef) return;
        const componentTypeKey = normalizeValue(componentRef.componentType || componentRef.componentName);
        failureByComponentType.set(componentTypeKey, (failureByComponentType.get(componentTypeKey) || 0) + 1);
    });

    snapshot.spareStock.forEach((item) => {
        const reorder = item.reorderPoint ?? item.minimumStockLevel;
        if (item.quantityAvailable > reorder) return;
        const typeKey = normalizeValue(item.componentType || item.partName);
        const failurePressure = failureByComponentType.get(typeKey) || 0;
        const recommendedQuantity = Math.max(1, (reorder + 1) - item.quantityAvailable + Math.min(5, failurePressure));
        const estimatedCost = item.unitCost ? Number(item.unitCost) * recommendedQuantity : null;
        recommendations.push({
            itemName: item.partName,
            type: item.componentType,
            recommendedQuantity,
            priority: failurePressure >= 3 || item.quantityAvailable === 0 ? 'high' : 'medium',
            reason: failurePressure > 0
                ? `Low stock and ${failurePressure} related failure/replacement event(s).`
                : 'Low stock reached reorder/minimum threshold.',
            estimatedCost,
            relatedAssets: [],
            evidence: {
                quantityAvailable: item.quantityAvailable,
                reorderPoint: reorder,
                failurePressure,
                vendor: item.vendor,
                unitCost: item.unitCost ? Number(item.unitCost) : null,
            },
        });
    });
    return recommendations.slice(0, 150);
}

function buildDuplicateDetectionReport(snapshot: InventoryAiSnapshot): {
    duplicateGroups: Array<Record<string, any>>;
    summary: string;
} {
    const groups: Array<Record<string, any>> = [];
    const serialMap = new Map<string, Asset[]>();
    const tagMap = new Map<string, Asset[]>();
    const signatureMap = new Map<string, Asset[]>();

    snapshot.assets.forEach((asset) => {
        const serial = normalizeSerialValue(asset.serialNumber);
        const tag = normalizeSerialValue(asset.assetTag);
        if (serial) {
            const key = serial.toLowerCase();
            serialMap.set(key, [...(serialMap.get(key) || []), asset]);
        }
        if (tag) {
            const key = tag.toLowerCase();
            tagMap.set(key, [...(tagMap.get(key) || []), asset]);
        }
        const signature = [
            normalizeValue(asset.name),
            canonicalAssetType(asset.type),
            mapLocationToFriendly(asset.location).toLowerCase(),
            mapDepartmentToFriendly(asset.department).toLowerCase(),
        ].join('|');
        signatureMap.set(signature, [...(signatureMap.get(signature) || []), asset]);
    });

    serialMap.forEach((assets, serial) => {
        if (assets.length <= 1) return;
        groups.push({
            severity: 'high',
            reason: `Duplicate serial number (${serial})`,
            assets: assets.map((asset) => ({ assetId: asset.customId, name: asset.name, serialNumber: asset.serialNumber, assetTag: asset.assetTag })),
            recommendedAction: 'Verify physical asset identity and merge/remove duplicate records.',
            confidence: 0.98,
        });
    });
    tagMap.forEach((assets, tag) => {
        if (assets.length <= 1) return;
        groups.push({
            severity: 'high',
            reason: `Duplicate asset tag (${tag})`,
            assets: assets.map((asset) => ({ assetId: asset.customId, name: asset.name, serialNumber: asset.serialNumber, assetTag: asset.assetTag })),
            recommendedAction: 'Correct or reassign duplicate asset tags.',
            confidence: 0.96,
        });
    });
    signatureMap.forEach((assets, signature) => {
        if (assets.length <= 1) return;
        if (assets.length > 8) return;
        groups.push({
            severity: 'medium',
            reason: `Similar name/type/location signature (${signature})`,
            assets: assets.map((asset) => ({ assetId: asset.customId, name: asset.name, serialNumber: asset.serialNumber, assetTag: asset.assetTag })),
            recommendedAction: 'Review if these are duplicate imported rows or true separate units.',
            confidence: 0.72,
        });
    });

    return {
        duplicateGroups: groups.slice(0, 200),
        summary: groups.length
            ? `Detected ${groups.length} duplicate/similarity group(s).`
            : 'No likely duplicates were detected with deterministic rules.',
    };
}

type DataCorrectionSuggestion = {
    assetId: string;
    assetName: string;
    issueType: string;
    currentValue: string;
    suggestedValue: string;
    reason: string;
    severity: 'critical' | 'warning' | 'info';
    confidence: number;
    evidence: Record<string, any>;
    canAutoApply: boolean;
};

const DATA_CORRECTION_TYPE_HINTS: Array<{
    pattern: RegExp;
    expectedTypeHints: string[];
    expectedCategory?: string;
    issueType: string;
}> = [
    {
        pattern: /\bfire\s*extinguisher\b/i,
        expectedTypeHints: ['fire_extinguisher'],
        expectedCategory: 'asset',
        issueType: 'name_type_mismatch_fire_extinguisher',
    },
    {
        pattern: /\bwheelchair\b/i,
        expectedTypeHints: ['wheelchair'],
        expectedCategory: 'asset',
        issueType: 'name_type_mismatch_wheelchair',
    },
    {
        pattern: /\bpodium\b/i,
        expectedTypeHints: ['podium'],
        expectedCategory: 'asset',
        issueType: 'name_type_mismatch_podium',
    },
    {
        pattern: /\bups\b|\buninterruptible\b/i,
        expectedTypeHints: ['ups'],
        expectedCategory: 'asset',
        issueType: 'name_type_mismatch_ups',
    },
];

function buildDataCorrectionSuggestions(snapshot: InventoryAiSnapshot): {
    summary: string;
    suggestions: DataCorrectionSuggestion[];
    countsBySeverity: Record<'critical' | 'warning' | 'info', number>;
    scannedCount: number;
    matchedCount: number;
    excludedCategories: string[];
    missingData: string[];
    confidence: InventoryAiConfidence;
} {
    const suggestions: DataCorrectionSuggestion[] = [];
    const countsBySeverity: Record<'critical' | 'warning' | 'info', number> = { critical: 0, warning: 0, info: 0 };
    const now = new Date();
    const childLinkedIds = new Set(snapshot.components.map((row) => row.childAssetId).filter(Boolean) as string[]);
    const serialMap = new Map<string, string[]>();
    const tagMap = new Map<string, string[]>();
    const excludedCategories = ['spare_part'];
    const missingData: string[] = [];

    snapshot.assets.forEach((asset) => {
        const serial = normalizeSerialValue(asset.serialNumber);
        const tag = normalizeSerialValue(asset.assetTag);
        if (serial) {
            const key = serial.toLowerCase();
            serialMap.set(key, [...(serialMap.get(key) || []), asset.customId]);
        }
        if (tag) {
            const key = tag.toLowerCase();
            tagMap.set(key, [...(tagMap.get(key) || []), asset.customId]);
        }
    });

    const pushSuggestion = (entry: DataCorrectionSuggestion) => {
        suggestions.push(entry);
        countsBySeverity[entry.severity] += 1;
    };

    snapshot.assets.forEach((asset) => {
        const category = String(asset.category || '').toLowerCase();
        const type = canonicalAssetType(asset.type);
        const lifecycle = normalizeLifecycleKey(asset.lifecycleStatus);
        const serial = normalizeSerialValue(asset.serialNumber);
        const name = String(asset.name || '');

        for (const hint of DATA_CORRECTION_TYPE_HINTS) {
            if (!hint.pattern.test(name)) continue;
            if (hint.expectedTypeHints.includes(type)) continue;
            pushSuggestion({
                assetId: asset.customId,
                assetName: asset.name,
                issueType: hint.issueType,
                currentValue: `type=${type}`,
                suggestedValue: hint.expectedTypeHints[0],
                reason: `Asset name suggests type "${hint.expectedTypeHints[0]}" but current type is "${type}".`,
                severity: 'critical',
                confidence: 0.92,
                evidence: { name: asset.name, currentType: type, expectedTypeHints: hint.expectedTypeHints },
                canAutoApply: false,
            });
        }

        if (!['consumable', 'spare_part', 'license'].includes(category) && !serial) {
            pushSuggestion({
                assetId: asset.customId,
                assetName: asset.name,
                issueType: 'missing_serial',
                currentValue: '',
                suggestedValue: 'Provide manufacturer serial number',
                reason: 'Serialized asset category is missing serial number.',
                severity: 'critical',
                confidence: 0.98,
                evidence: { category, type },
                canAutoApply: false,
            });
        }

        if (asset.purchaseDate && asset.warrantyEndDate && asset.warrantyEndDate.getTime() < asset.purchaseDate.getTime()) {
            pushSuggestion({
                assetId: asset.customId,
                assetName: asset.name,
                issueType: 'warranty_before_purchase',
                currentValue: `${asset.purchaseDate.toISOString().slice(0, 10)} -> ${asset.warrantyEndDate.toISOString().slice(0, 10)}`,
                suggestedValue: 'Set warranty end date after purchase date',
                reason: 'Warranty end date is earlier than purchase date.',
                severity: 'critical',
                confidence: 0.97,
                evidence: { purchaseDate: asset.purchaseDate, warrantyEndDate: asset.warrantyEndDate },
                canAutoApply: false,
            });
        }

        if (category === 'component' && !childLinkedIds.has(asset.customId)) {
            const specs = ((asset.specifications as Record<string, any>) || {});
            const hasParentMeta = Boolean(
                normalizeSerialValue(specs.installedInAssetId)
                || normalizeSerialValue(specs.parentAssetId)
                || normalizeSerialValue(specs.installedInAssetTag)
            );
            if (!hasParentMeta) {
                pushSuggestion({
                    assetId: asset.customId,
                    assetName: asset.name,
                    issueType: 'component_without_parent',
                    currentValue: 'No parent link',
                    suggestedValue: 'Link to parent asset (installed_in/component_of)',
                    reason: 'Component has no AssetComponent link and no parent metadata.',
                    severity: 'critical',
                    confidence: 0.95,
                    evidence: { category, type },
                    canAutoApply: false,
                });
            }
        }

        if (category === 'license' && !asset.warrantyEndDate) {
            pushSuggestion({
                assetId: asset.customId,
                assetName: asset.name,
                issueType: 'license_missing_expiry',
                currentValue: '',
                suggestedValue: 'Set warranty/expiry end date',
                reason: 'License record has no expiry date.',
                severity: 'warning',
                confidence: 0.91,
                evidence: { category },
                canAutoApply: false,
            });
        }

        if (category === 'consumable' && Number(asset.quantity || 0) <= 0) {
            pushSuggestion({
                assetId: asset.customId,
                assetName: asset.name,
                issueType: 'consumable_missing_quantity',
                currentValue: String(asset.quantity || 0),
                suggestedValue: 'Set quantity > 0',
                reason: 'Consumable quantity is missing or zero.',
                severity: 'warning',
                confidence: 0.88,
                evidence: { quantity: asset.quantity },
                canAutoApply: false,
            });
        }

        if (!String(asset.location || '').trim()) {
            pushSuggestion({
                assetId: asset.customId,
                assetName: asset.name,
                issueType: 'missing_location',
                currentValue: '',
                suggestedValue: 'Set valid location',
                reason: 'Location is required for inventory traceability.',
                severity: 'critical',
                confidence: 0.94,
                evidence: {},
                canAutoApply: false,
            });
        }
        if (!String(asset.department || '').trim()) {
            pushSuggestion({
                assetId: asset.customId,
                assetName: asset.name,
                issueType: 'missing_department',
                currentValue: '',
                suggestedValue: 'Set department',
                reason: 'Department is missing.',
                severity: 'warning',
                confidence: 0.86,
                evidence: {},
                canAutoApply: false,
            });
        }

        if (lifecycle === 'eol_expired' && !asset.warrantyEndDate) {
            pushSuggestion({
                assetId: asset.customId,
                assetName: asset.name,
                issueType: 'eol_without_warranty_context',
                currentValue: lifecycle,
                suggestedValue: 'Backfill warranty and purchase dates',
                reason: 'EOL/expired lifecycle is set but no warranty end date exists.',
                severity: 'info',
                confidence: 0.78,
                evidence: { lifecycleStatus: lifecycle },
                canAutoApply: false,
            });
        }
    });

    serialMap.forEach((assetIds, key) => {
        if (assetIds.length <= 1) return;
        assetIds.forEach((assetId) => {
            const asset = snapshot.assets.find((row) => row.customId === assetId);
            if (!asset) return;
            pushSuggestion({
                assetId,
                assetName: asset.name,
                issueType: 'duplicate_serial',
                currentValue: normalizeSerialValue(asset.serialNumber) || '',
                suggestedValue: 'Verify physical identity and merge/correct duplicate',
                reason: `Serial appears on multiple assets (${assetIds.length}).`,
                severity: 'critical',
                confidence: 0.99,
                evidence: { serial: key, duplicateCount: assetIds.length, assetIds },
                canAutoApply: false,
            });
        });
    });
    tagMap.forEach((assetIds, key) => {
        if (assetIds.length <= 1) return;
        assetIds.forEach((assetId) => {
            const asset = snapshot.assets.find((row) => row.customId === assetId);
            if (!asset) return;
            pushSuggestion({
                assetId,
                assetName: asset.name,
                issueType: 'duplicate_asset_tag',
                currentValue: normalizeSerialValue(asset.assetTag) || '',
                suggestedValue: 'Reassign unique asset tag',
                reason: `Asset tag appears on multiple assets (${assetIds.length}).`,
                severity: 'critical',
                confidence: 0.99,
                evidence: { assetTag: key, duplicateCount: assetIds.length, assetIds },
                canAutoApply: false,
            });
        });
    });

    snapshot.spareStock.forEach((item) => {
        const reorder = item.reorderPoint ?? item.minimumStockLevel;
        if (item.quantityAvailable <= reorder) {
            pushSuggestion({
                assetId: item.id,
                assetName: item.partName,
                issueType: 'spare_stock_below_reorder',
                currentValue: `${item.quantityAvailable}`,
                suggestedValue: `Increase stock above ${reorder}`,
                reason: 'Spare stock is below reorder/minimum threshold.',
                severity: 'warning',
                confidence: 0.9,
                evidence: { quantityAvailable: item.quantityAvailable, reorderPoint: reorder },
                canAutoApply: false,
            });
        }
    });

    if (!snapshot.maintenance.length) missingData.push('maintenanceRecords');
    if (!snapshot.lifecycleEvents.length) missingData.push('lifecycleEvents');
    const scannedCount = snapshot.assets.length + snapshot.spareStock.length;
    const confidence = buildInventoryInsightConfidence({
        dataScope: 'full_inventory',
        scannedCount,
        matchedCount: suggestions.length,
    });
    const summary = suggestions.length
        ? `Detected ${suggestions.length} data correction suggestion(s): ${countsBySeverity.critical} critical, ${countsBySeverity.warning} warning, ${countsBySeverity.info} info.`
        : 'No major deterministic data-correction issues were detected.';
    return {
        summary,
        suggestions: suggestions.slice(0, 500),
        countsBySeverity,
        scannedCount,
        matchedCount: suggestions.length,
        excludedCategories,
        missingData,
        confidence,
    };
}

type AssetRiskScoreRow = {
    assetId: string;
    assetName: string;
    customId: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    riskScore: number;
    reasons: string[];
    evidence: Record<string, any>;
    recommendedActions: string[];
    confidence: InventoryAiConfidence;
};

function buildAssetRiskScores(snapshot: InventoryAiSnapshot, params: { assetIds?: string[] } = {}): {
    summary: string;
    rows: AssetRiskScoreRow[];
    scannedCount: number;
    matchedCount: number;
    missingData: string[];
    confidence: InventoryAiConfidence;
} {
    const targetSet = params.assetIds?.length ? new Set(params.assetIds) : null;
    const maintenanceCount = new Map<string, number>();
    const failureCount = new Map<string, number>();
    const replacementCount = new Map<string, number>();
    const now = new Date();

    snapshot.maintenance.forEach((row) => {
        maintenanceCount.set(row.assetId, (maintenanceCount.get(row.assetId) || 0) + 1);
    });
    snapshot.lifecycleEvents.forEach((row) => {
        const key = normalizeValue(row.eventType);
        if (key.includes('fail') || key.includes('damag') || key.includes('repair')) {
            failureCount.set(row.assetId, (failureCount.get(row.assetId) || 0) + 1);
        }
        if (key.includes('replace')) {
            replacementCount.set(row.assetId, (replacementCount.get(row.assetId) || 0) + 1);
        }
    });

    const rows: AssetRiskScoreRow[] = [];
    snapshot.assets.forEach((asset) => {
        if (targetSet && !targetSet.has(asset.customId)) return;
        const category = String(asset.category || '').toLowerCase();
        if (category === 'spare_part') return;
        let score = 8;
        const reasons: string[] = [];
        const actions: string[] = [];
        const evidence: Record<string, any> = {};

        const lifecycle = normalizeLifecycleKey(asset.lifecycleStatus);
        const maint = maintenanceCount.get(asset.customId) || 0;
        const failures = failureCount.get(asset.customId) || 0;
        const replacements = replacementCount.get(asset.customId) || 0;
        const childComponents = snapshot.components.filter((row) => row.parentAssetId === asset.customId);
        const activeComponents = childComponents.filter((row) => !row.removedAt);
        const removedOrMissingChildren = childComponents.filter((row) => {
            const statusKey = normalizeLifecycleKey(row.status);
            return Boolean(row.removedAt)
                || ['removed', 'retired', 'disposed'].includes(statusKey);
        });
        const repairChildren = activeComponents.filter((row) => normalizeLifecycleKey(row.status) === 'under_repair');
        const failedChildren = activeComponents.filter((row) => normalizeLifecycleKey(row.status) === 'failed');
        evidence.lifecycleStatus = lifecycle;
        evidence.maintenanceCount = maint;
        evidence.failureEvents = failures;
        evidence.replacementEvents = replacements;
        evidence.kitHealth = {
            childComponents: childComponents.length,
            activeComponents: activeComponents.length,
            missingChildren: removedOrMissingChildren.length,
            underRepairChildren: repairChildren.length,
            failedChildren: failedChildren.length,
        };

        if (lifecycle === 'pending_repair') {
            score += 28;
            reasons.push('Asset is pending repair.');
            actions.push('Prioritize diagnostics and repair ticket closure.');
        } else if (lifecycle === 'under_maintenance') {
            score += 18;
            reasons.push('Asset is under maintenance.');
        } else if (lifecycle === 'eol_expired') {
            score += 26;
            reasons.push('Asset lifecycle is marked EOL/expired.');
            actions.push('Plan replacement or retirement.');
        }

        if (asset.warrantyEndDate) {
            const days = Math.floor((asset.warrantyEndDate.getTime() - now.getTime()) / 86400000);
            evidence.warrantyDaysRemaining = days;
            if (days < 0) {
                score += 22;
                reasons.push('Warranty is expired.');
                actions.push('Budget repair/replacement without warranty coverage.');
            } else if (days <= 90) {
                score += 12;
                reasons.push('Warranty expires within 90 days.');
                actions.push('Plan renewal or replacement decision.');
            }
        } else if (category !== 'consumable' && category !== 'license') {
            score += 6;
            reasons.push('Warranty end date missing.');
            actions.push('Backfill warranty metadata for better lifecycle planning.');
        }

        if (asset.purchaseDate) {
            const ageYears = (now.getTime() - asset.purchaseDate.getTime()) / (86400000 * 365.25);
            evidence.ageYears = Number(ageYears.toFixed(2));
            if (ageYears >= 7) {
                score += 18;
                reasons.push('Asset age exceeds 7 years.');
            } else if (ageYears >= 5) {
                score += 10;
                reasons.push('Asset age exceeds 5 years.');
            }
        } else if (category !== 'consumable') {
            score += 5;
            reasons.push('Purchase date missing.');
        }

        if (failures >= 3) {
            score += 22;
            reasons.push(`Frequent failures detected (${failures}).`);
            actions.push('Investigate recurring fault root causes.');
        } else if (failures > 0) {
            score += failures * 5;
            reasons.push(`Failure events detected (${failures}).`);
        }
        if (replacements >= 2) {
            score += 12;
            reasons.push(`Frequent replacements detected (${replacements}).`);
        }
        if (maint >= 4) {
            score += 8;
            reasons.push(`High maintenance frequency (${maint} records).`);
        }

        if (removedOrMissingChildren.length > 0 && category === 'asset') {
            score += 14;
            reasons.push(`Kit has ${removedOrMissingChildren.length} missing/removed child item(s).`);
            actions.push('Restore missing child components/accessories or mark kit degraded.');
        }
        if (repairChildren.length > 0 && category === 'asset') {
            score += 10;
            reasons.push(`Kit has ${repairChildren.length} child item(s) under repair.`);
            actions.push('Resolve under-repair child items to recover full kit health.');
        }
        if (failedChildren.length > 0 && category === 'asset') {
            score += 12;
            reasons.push(`Kit has ${failedChildren.length} failed child item(s).`);
            actions.push('Replace or repair failed child items.');
        }

        if (!normalizeSerialValue(asset.serialNumber) && !['consumable', 'spare_part', 'license'].includes(category)) {
            score += 7;
            reasons.push('Serial number missing.');
            actions.push('Add serial number for traceability.');
        }
        if (!String(asset.location || '').trim()) {
            score += 6;
            reasons.push('Location missing.');
        }

        const specs = ((asset.specifications as Record<string, any>) || {});
        const telemetryStatus = String(specs.telemetryStatus || '').toLowerCase();
        evidence.telemetryStatus = telemetryStatus || 'unknown';
        if (isTelemetryCapableAsset({ type: asset.type, category: asset.category }) && (telemetryStatus === 'offline' || telemetryStatus === 'not_monitored')) {
            score += 8;
            reasons.push(`Telemetry status is ${telemetryStatus || 'unknown'}.`);
            actions.push('Verify telemetry configuration and connectivity.');
        }

        if (category === 'license') {
            score = Math.max(score - 6, 4);
            if (!asset.warrantyEndDate) {
                score += 12;
                reasons.push('License expiry date missing.');
            }
        }
        if (category === 'consumable') {
            score = Math.max(5, Math.min(score, 45));
            const qty = Number(asset.quantity || 0);
            if (qty <= 2) {
                score += 10;
                reasons.push('Consumable quantity is critically low.');
            }
        }

        score = clampNumber(score, 0, 100);
        const riskLevel: 'low' | 'medium' | 'high' | 'critical' = score >= 80
            ? 'critical'
            : score >= 60
                ? 'high'
                : score >= 35
                    ? 'medium'
                    : 'low';
        const confidence = buildInventoryInsightConfidence({
            dataScope: targetSet ? 'selected_asset' : 'full_inventory',
            scannedCount: 1,
            matchedCount: reasons.length,
        });
        rows.push({
            assetId: asset.customId,
            assetName: asset.name,
            customId: asset.customId,
            riskLevel,
            riskScore: Number(score.toFixed(1)),
            reasons: reasons.slice(0, 8),
            evidence,
            recommendedActions: Array.from(new Set(actions)).slice(0, 8),
            confidence,
        });
    });

    rows.sort((a, b) => b.riskScore - a.riskScore);
    const missingData: string[] = [];
    if (!snapshot.lifecycleEvents.length) missingData.push('lifecycleEvents');
    if (!snapshot.maintenance.length) missingData.push('maintenanceRecords');
    const confidence = buildInventoryInsightConfidence({
        dataScope: targetSet ? 'selected_asset' : 'full_inventory',
        scannedCount: rows.length,
        matchedCount: rows.filter((row) => row.riskScore >= 35).length,
    });
    const summary = rows.length
        ? `Calculated risk scores for ${rows.length} asset(s). ${rows.filter((row) => row.riskLevel === 'critical').length} critical, ${rows.filter((row) => row.riskLevel === 'high').length} high risk.`
        : 'No assets available for risk scoring.';
    return {
        summary,
        rows: rows.slice(0, 600),
        scannedCount: rows.length,
        matchedCount: rows.length,
        missingData,
        confidence,
    };
}

function buildReplacementPriorityRanking(snapshot: InventoryAiSnapshot): {
    summary: string;
    rankedItems: Array<Record<string, any>>;
    scannedCount: number;
    matchedCount: number;
    missingData: string[];
    confidence: InventoryAiConfidence;
} {
    const riskRows = buildAssetRiskScores(snapshot).rows;
    const ranked = riskRows
        .filter((row) => row.riskScore >= 30)
        .map((row, index) => ({
            rank: index + 1,
            assetId: row.assetId,
            assetName: row.assetName,
            itemType: String(snapshot.assets.find((asset) => asset.customId === row.assetId)?.category || 'asset').toLowerCase(),
            priority: row.riskLevel === 'critical' ? 'critical' : (row.riskLevel === 'high' ? 'high' : 'medium'),
            reason: row.reasons[0] || 'Elevated lifecycle risk.',
            evidence: row.evidence,
            suggestedReplacement: row.riskLevel === 'critical'
                ? 'Replace immediately'
                : (row.riskLevel === 'high' ? 'Plan replacement this quarter' : 'Monitor and schedule replacement'),
            urgency: row.riskLevel === 'critical' ? 'immediate' : (row.riskLevel === 'high' ? 'soon' : 'planned'),
            confidence: row.confidence,
        }))
        .slice(0, 250);
    const missingData: string[] = [];
    if (!snapshot.lifecycleEvents.length) missingData.push('lifecycleEvents');
    if (!snapshot.maintenance.length) missingData.push('maintenanceRecords');
    const confidence = buildInventoryInsightConfidence({
        dataScope: 'full_inventory',
        scannedCount: riskRows.length,
        matchedCount: ranked.length,
    });
    const summary = ranked.length
        ? `Ranked ${ranked.length} replacement candidate(s) using deterministic risk + lifecycle evidence.`
        : 'No replacement-priority candidates found from current deterministic inputs.';
    return {
        summary,
        rankedItems: ranked,
        scannedCount: riskRows.length,
        matchedCount: ranked.length,
        missingData,
        confidence,
    };
}

function buildSpareStockForecast(snapshot: InventoryAiSnapshot): {
    summary: string;
    forecasts: Array<Record<string, any>>;
    scannedCount: number;
    matchedCount: number;
    missingData: string[];
    confidence: InventoryAiConfidence;
} {
    const failureByComponentType = new Map<string, number>();
    snapshot.lifecycleEvents.forEach((event) => {
        const key = normalizeValue(event.eventType);
        if (!(key.includes('failed') || key.includes('replace') || key.includes('repair'))) return;
        const component = snapshot.components.find((row) => row.id === event.componentId);
        if (!component) return;
        const typeKey = normalizeValue(component.componentType || component.componentName);
        failureByComponentType.set(typeKey, (failureByComponentType.get(typeKey) || 0) + 1);
    });

    const forecasts = snapshot.spareStock.map((item) => {
        const reorder = item.reorderPoint ?? item.minimumStockLevel;
        const typeKey = normalizeValue(item.componentType || item.partName);
        const failurePressure = failureByComponentType.get(typeKey) || 0;
        const compatibleCount = parseJsonArrayInput(item.compatibleAssetTypes)
            .map((entry) => normalizeValue(entry))
            .filter(Boolean)
            .reduce((count, entry) => (
                count + snapshot.assets.filter((asset) => normalizeValue(canonicalAssetType(asset.type)) === entry).length
            ), 0);
        const gap = Math.max(0, (reorder + 1) - item.quantityAvailable);
        const suggestedByFailures = Math.min(8, failurePressure);
        const suggestedByCoverage = compatibleCount > 0 ? Math.min(5, Math.ceil(compatibleCount / 8)) : 0;
        const recommendedQuantity = Math.max(0, gap + suggestedByFailures + suggestedByCoverage);
        const reason = item.quantityAvailable <= reorder
            ? 'Current quantity is at/below reorder threshold.'
            : (failurePressure > 0
                ? 'Recent component failures indicate possible near-term demand.'
                : 'Maintaining preventive stock buffer.');
        const evidence = {
            quantityAvailable: item.quantityAvailable,
            reorderPoint: reorder,
            minimumStockLevel: item.minimumStockLevel,
            failurePressure,
            compatibleAssetCount: compatibleCount,
            unitCost: item.unitCost ? Number(item.unitCost) : null,
        };
        return {
            itemName: item.partName,
            componentType: item.componentType,
            currentQuantity: item.quantityAvailable,
            reorderPoint: reorder,
            recommendedQuantity,
            reason,
            relatedAssets: compatibleCount,
            evidence,
            confidence: (item.reorderPoint !== null || item.minimumStockLevel > 0)
                ? (failurePressure > 0 ? 'high' : 'medium')
                : 'low',
        };
    }).filter((row) => row.recommendedQuantity > 0 || row.currentQuantity <= row.reorderPoint);

    const missingData: string[] = [];
    if (!snapshot.spareStock.length) missingData.push('spareStockItems');
    if (!snapshot.lifecycleEvents.length) missingData.push('lifecycleEvents');
    const confidence = buildInventoryInsightConfidence({
        dataScope: 'full_inventory',
        scannedCount: snapshot.spareStock.length,
        matchedCount: forecasts.length,
    });
    const summary = forecasts.length
        ? `Prepared ${forecasts.length} spare-stock forecast recommendation(s).`
        : 'No immediate spare-stock forecast actions from current thresholds.';
    return {
        summary,
        forecasts: forecasts.slice(0, 200),
        scannedCount: snapshot.spareStock.length,
        matchedCount: forecasts.length,
        missingData,
        confidence,
    };
}

function tokenizeForSimilarity(value: unknown): string[] {
    return String(value || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2);
}

function scoreTokenOverlap(a: unknown, b: unknown): number {
    const aTokens = new Set(tokenizeForSimilarity(a));
    const bTokens = new Set(tokenizeForSimilarity(b));
    if (!aTokens.size || !bTokens.size) return 0;
    let overlap = 0;
    aTokens.forEach((token) => {
        if (bTokens.has(token)) overlap += 1;
    });
    return overlap / Math.max(aTokens.size, bTokens.size);
}

function buildImportErrorRepairs(params: {
    rows: NormalizedImportRow[];
    availableParentTags: string[];
}): {
    summary: string;
    fixes: Array<Record<string, any>>;
    correctedRowsPreview: NormalizedImportRow[];
    warnings: string[];
    confidence: InventoryAiConfidence;
} {
    const fixes: Array<Record<string, any>> = [];
    const correctedRows = params.rows.map((row) => ({ ...row }));
    const parentCandidates = params.availableParentTags.map((tag) => String(tag || '').trim()).filter(Boolean);

    const categoryByRecordType: Record<string, string> = {
        parent_asset: 'asset',
        embedded_component: 'component',
        component_asset: 'component',
        spare_stock: 'spare_stock',
        accessory: 'accessory',
        consumable: 'consumable',
        license: 'license',
    };

    correctedRows.forEach((row) => {
        const rowFixes: Array<{ field: keyof NormalizedImportRow | string; suggestedValue: any; reason: string; confidence: number; safeToApply: boolean }> = [];
        const rowErrors = Array.isArray(row.errors) ? row.errors : [];
        const rowWarnings = Array.isArray(row.warnings) ? row.warnings : [];
        const messages = [...rowErrors, ...rowWarnings].map((entry) => String(entry || ''));

        messages.forEach((message) => {
            if ((/unknown parent asset tag/i.test(message) || /parent asset not found for related item row/i.test(message)) && row.parentAssetTag) {
                let best: { tag: string; score: number } | null = null;
                for (const candidate of parentCandidates) {
                    const score = scoreTokenOverlap(row.parentAssetTag, candidate);
                    if (!best || score > best.score) best = { tag: candidate, score };
                }
                if (best && best.score >= 0.45) {
                    rowFixes.push({
                        field: 'parentAssetTag',
                        suggestedValue: best.tag,
                        reason: `Closest parent asset tag match found: ${best.tag}`,
                        confidence: clampNumber(best.score, 0.45, 0.92),
                        safeToApply: true,
                    });
                } else {
                    rowFixes.push({
                        field: 'parentAssetTag',
                        suggestedValue: '',
                        reason: 'No confident parent-asset tag match found. Manual review required.',
                        confidence: 0.35,
                        safeToApply: false,
                    });
                }
            }

            if (/invalid category/i.test(message)) {
                const fallbackCategory = categoryByRecordType[row.recordType] || 'asset';
                rowFixes.push({
                    field: 'category',
                    suggestedValue: fallbackCategory,
                    reason: 'Mapped category from Record Type.',
                    confidence: 0.9,
                    safeToApply: true,
                });
            }

            if (/invalid record type/i.test(message)) {
                const inferred = normalizeImportRecordType(row.recordType || row.category || row.assetType || row.notes) || 'parent_asset';
                rowFixes.push({
                    field: 'recordType',
                    suggestedValue: inferred,
                    reason: 'Inferred closest supported record type from row context.',
                    confidence: 0.72,
                    safeToApply: true,
                });
            }

            if (/invalid lifecycle status/i.test(message)) {
                rowFixes.push({
                    field: 'lifecycleStatus',
                    suggestedValue: row.recordType === 'spare_stock' ? 'in_stock' : 'in_use',
                    reason: 'Mapped to a supported lifecycle fallback value.',
                    confidence: 0.86,
                    safeToApply: true,
                });
            }

            if (/quantity.*invalid|required.*quantity|quantity must be a positive integer/i.test(message)) {
                rowFixes.push({
                    field: 'quantity',
                    suggestedValue: 1,
                    reason: 'Set quantity to minimum valid value.',
                    confidence: 0.84,
                    safeToApply: true,
                });
            }

            if (/duplicate serial/i.test(message)) {
                rowFixes.push({
                    field: 'serialNumber',
                    suggestedValue: row.serialNumber,
                    reason: 'Duplicate serial detected. Manual resolution required.',
                    confidence: 0.98,
                    safeToApply: false,
                });
            }

            if (/duplicate asset tag/i.test(message)) {
                rowFixes.push({
                    field: 'assetTag',
                    suggestedValue: row.assetTag,
                    reason: 'Duplicate asset tag detected. Manual resolution required.',
                    confidence: 0.98,
                    safeToApply: false,
                });
            }
        });

        const dedupedFixes = rowFixes.filter((fix, idx) => (
            rowFixes.findIndex((candidate) => candidate.field === fix.field) === idx
        ));
        dedupedFixes.forEach((fix) => {
            fixes.push({
                rowNumber: row.rowNumber,
                field: fix.field,
                originalValue: (row as any)[fix.field as string],
                suggestedValue: fix.suggestedValue,
                reason: fix.reason,
                confidence: fix.confidence,
                safeToApply: fix.safeToApply,
            });
            if (fix.safeToApply) {
                (row as any)[fix.field as string] = fix.suggestedValue;
            }
        });
    });

    const warnings: string[] = [];
    const safeFixCount = fixes.filter((fix) => fix.safeToApply).length;
    const manualFixCount = fixes.length - safeFixCount;
    if (manualFixCount > 0) warnings.push(`${manualFixCount} suggestion(s) require manual review.`);
    const confidence = safeFixCount > 0
        ? (manualFixCount === 0 ? 'high' : 'medium')
        : (fixes.length ? 'medium' : 'low');
    return {
        summary: fixes.length
            ? `Generated ${fixes.length} import-repair suggestion(s).`
            : 'No deterministic import-repair suggestions were generated.',
        fixes: fixes.slice(0, 500),
        correctedRowsPreview: correctedRows.slice(0, 1000),
        warnings,
        confidence,
    };
}

function buildRelationshipSuggestions(snapshot: InventoryAiSnapshot): {
    summary: string;
    suggestions: Array<Record<string, any>>;
    scannedCount: number;
    matchedCount: number;
    confidence: InventoryAiConfidence;
    missingData: string[];
} {
    const suggestions: Array<Record<string, any>> = [];
    const assetByCustomId = new Map(snapshot.assets.map((asset) => [asset.customId, asset]));
    const byTag = new Map<string, Asset>();
    snapshot.assets.forEach((asset) => {
        const tag = normalizeSerialValue(asset.assetTag);
        if (tag) byTag.set(tag.toLowerCase(), asset);
    });

    const pushSuggestion = (entry: Record<string, any>) => {
        const key = `${entry.sourceAssetId}|${entry.targetAssetId}|${entry.relationshipType}`;
        if (suggestions.some((row) => `${row.sourceAssetId}|${row.targetAssetId}|${row.relationshipType}` === key)) return;
        suggestions.push(entry);
    };

    snapshot.assets.forEach((asset) => {
        const category = String(asset.category || '').toLowerCase();
        const specs = ((asset.specifications as Record<string, any>) || {});
        const installedParentId = normalizeSerialValue(specs.installedInAssetId || specs.parentAssetId);
        const installedParentTag = normalizeSerialValue(specs.installedInAssetTag);

        if (category === 'component' && installedParentId && assetByCustomId.has(installedParentId)) {
            const target = assetByCustomId.get(installedParentId)!;
            pushSuggestion({
                sourceAssetId: asset.customId,
                sourceAssetName: asset.name,
                targetAssetId: target.customId,
                targetAssetName: target.name,
                relationshipType: 'installed_in',
                reason: 'Component metadata includes installed parent asset ID.',
                confidence: 0.98,
                evidence: { installedParentId },
                safeToApply: true,
            });
        } else if (category === 'component' && installedParentTag && byTag.has(installedParentTag.toLowerCase())) {
            const target = byTag.get(installedParentTag.toLowerCase())!;
            pushSuggestion({
                sourceAssetId: asset.customId,
                sourceAssetName: asset.name,
                targetAssetId: target.customId,
                targetAssetName: target.name,
                relationshipType: 'component_of',
                reason: 'Component metadata includes installed parent asset tag.',
                confidence: 0.95,
                evidence: { installedParentTag },
                safeToApply: true,
            });
        }

        const notesText = [
            normalizeSerialValue((asset as any).assignedToName) || '',
            normalizeSerialValue((asset as any).notes) || '',
            normalizeSerialValue(specs.installedInAssetTag) || '',
            normalizeSerialValue(specs.parentAssetTag) || '',
        ].join(' ').toLowerCase();
        if (!notesText.trim()) return;

        byTag.forEach((target, tag) => {
            if (target.customId === asset.customId) return;
            if (!notesText.includes(tag)) return;
            const relationshipType = category === 'license'
                ? 'licensed_to'
                : (category === 'accessory' ? 'used_with' : (category === 'component' ? 'component_of' : 'related_to'));
            pushSuggestion({
                sourceAssetId: asset.customId,
                sourceAssetName: asset.name,
                targetAssetId: target.customId,
                targetAssetName: target.name,
                relationshipType,
                reason: `Detected parent asset tag reference (${tag}) in notes/assignment metadata.`,
                confidence: 0.9,
                evidence: { matchedTag: tag, category },
                safeToApply: true,
            });
        });
    });

    const missingData: string[] = [];
    if (!snapshot.assets.length) missingData.push('assets');
    const confidence = buildInventoryInsightConfidence({
        dataScope: 'full_inventory',
        scannedCount: snapshot.assets.length,
        matchedCount: suggestions.length,
    });
    const summary = suggestions.length
        ? `Generated ${suggestions.length} relationship suggestion(s).`
        : 'No deterministic relationship suggestions were found.';
    return {
        summary,
        suggestions: suggestions.slice(0, 500),
        scannedCount: snapshot.assets.length,
        matchedCount: suggestions.length,
        confidence,
        missingData,
    };
}

function parseDateRangeFromInput(payload: any): { start: Date; end: Date; label: string } {
    const startRaw = parseOptionalDateInput(payload?.startDate || payload?.dateFrom || null);
    const endRaw = parseOptionalDateInput(payload?.endDate || payload?.dateTo || null);
    if (startRaw && endRaw) {
        return {
            start: startRaw,
            end: new Date(endRaw.getTime() + 86400000 - 1),
            label: `${startRaw.toISOString().slice(0, 10)} to ${endRaw.toISOString().slice(0, 10)}`,
        };
    }
    const monthRaw = Number(payload?.month);
    const yearRaw = Number(payload?.year);
    const now = new Date();
    const month = Number.isFinite(monthRaw) && monthRaw >= 1 && monthRaw <= 12 ? monthRaw - 1 : now.getMonth();
    const year = Number.isFinite(yearRaw) && yearRaw >= 2000 ? yearRaw : now.getFullYear();
    const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
    return {
        start,
        end,
        label: `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`,
    };
}

function parseDailyBriefRangeFromInput(payload: any): { start: Date; end: Date; label: string; mode: 'today' | 'last_7_days' | 'custom' } {
    const normalizeDayStart = (date: Date) => {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d;
    };
    const normalizeDayEnd = (date: Date) => {
        const d = new Date(date);
        d.setHours(23, 59, 59, 999);
        return d;
    };
    const dateRangeModeRaw = normalizeValue(payload?.dateRange || payload?.range || '');
    const explicitDate = parseOptionalDateInput(payload?.date);
    const customStart = parseOptionalDateInput(payload?.startDate || payload?.dateFrom || null);
    const customEnd = parseOptionalDateInput(payload?.endDate || payload?.dateTo || null);
    const now = new Date();

    const wantsCustomRange = dateRangeModeRaw === 'custom'
        || dateRangeModeRaw === 'daterangecustom'
        || dateRangeModeRaw === 'customrange';
    if ((wantsCustomRange || (customStart && customEnd)) && customStart && customEnd) {
        const start = normalizeDayStart(customStart);
        const end = normalizeDayEnd(customEnd);
        return {
            start,
            end,
            label: `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`,
            mode: 'custom',
        };
    }

    const wantsLast7Days = dateRangeModeRaw === 'last7days'
        || dateRangeModeRaw === 'last7day'
        || dateRangeModeRaw === 'thisweek'
        || dateRangeModeRaw === 'weekly'
        || dateRangeModeRaw === 'week';
    if (wantsLast7Days) {
        const end = normalizeDayEnd(now);
        const start = normalizeDayStart(new Date(now.getTime() - 6 * 86400000));
        return {
            start,
            end,
            label: `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`,
            mode: 'last_7_days',
        };
    }

    const targetDate = explicitDate || now;
    const start = normalizeDayStart(targetDate);
    const end = normalizeDayEnd(targetDate);
    return {
        start,
        end,
        label: `${start.toISOString().slice(0, 10)}`,
        mode: 'today',
    };
}

function parseDashboardTimeRangeDays(rawValue: unknown): number {
    const raw = String(rawValue || '').trim().toLowerCase();
    if (!raw) return 30;
    if (raw.includes('7')) return 7;
    if (raw.includes('6m') || raw.includes('180')) return 180;
    if (raw.includes('12m') || raw.includes('365') || raw.includes('year')) return 365;
    if (raw.includes('90') || raw.includes('3m') || raw.includes('quarter')) return 90;
    if (raw.includes('30') || raw.includes('month')) return 30;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return Math.min(365, Math.max(1, Math.trunc(parsed)));
    return 30;
}

function inferBlackBoxEventGroup(eventTypeRaw: unknown): string {
    const eventType = normalizeValue(eventTypeRaw || '');
    if (!eventType) return 'all';
    if (eventType.includes('transfer')) return 'transfer';
    if (eventType.includes('maintenance') || eventType.includes('repair')) return 'maintenance';
    if (eventType.includes('component') || eventType.includes('relationship')) return 'components';
    if (eventType.includes('audit') || eventType.includes('verified') || eventType.includes('missing')) return 'audit';
    if (eventType.includes('loaner')) return 'loaner';
    if (eventType.includes('telemetry') || eventType.includes('wifi')) return 'telemetry';
    if (eventType.includes('risk') || eventType.includes('eol') || eventType.includes('ticket') || eventType.includes('ai')) return 'ai_risk_eol';
    return 'all';
}

function inferBlackBoxSeverity(entry: {
    eventType?: string | null;
    reason?: string | null;
    notes?: string | null;
    details?: string | null;
}): 'info' | 'warning' | 'critical' {
    const haystack = [
        normalizeValue(entry.eventType || ''),
        normalizeValue(entry.reason || ''),
        normalizeValue(entry.notes || ''),
        normalizeValue(entry.details || ''),
    ].join(' ');
    if (/failed|damaged|missing|lost|stolen|critical|expired/.test(haystack)) return 'critical';
    if (/repair|maintenance|warning|degraded|underrepair|mismatch/.test(haystack)) return 'warning';
    return 'info';
}

function buildInvoiceAssetMatching(params: {
    rows: Array<Record<string, any>>;
    assets: Asset[];
}): {
    summary: string;
    matches: Array<Record<string, any>>;
    unmatchedItems: Array<Record<string, any>>;
    warnings: string[];
    confidence: InventoryAiConfidence;
} {
    const matches: Array<Record<string, any>> = [];
    const unmatchedItems: Array<Record<string, any>> = [];
    const warnings: string[] = [];
    const bySerial = new Map<string, Asset>();
    const byTag = new Map<string, Asset>();
    params.assets.forEach((asset) => {
        const serial = normalizeSerialValue(asset.serialNumber);
        const tag = normalizeSerialValue(asset.assetTag);
        if (serial) bySerial.set(serial.toLowerCase(), asset);
        if (tag) byTag.set(tag.toLowerCase(), asset);
    });

    (params.rows || []).slice(0, 500).forEach((row) => {
        const serial = normalizeSerialValue(row.serialNumber || row['Serial Number']);
        const tag = normalizeSerialValue(row.assetTag || row['Asset Tag']);
        const itemName = String(row.assetName || row.name || row['Asset Name'] || row.model || '').trim();
        const brand = String(row.brand || '').trim();
        const model = String(row.model || '').trim();
        const purchaseDate = String(row.purchaseDate || row['Purchase Date'] || '').trim();
        const warrantyStartDate = String(row.warrantyStartDate || row['Warranty Start Date'] || '').trim();
        const warrantyEndDate = String(row.warrantyEndDate || row['Warranty End Date'] || '').trim();
        const vendor = String(row.vendor || '').trim();
        const purchaseCost = parseOptionalNumberInput(row.purchaseCost || row['Purchase Cost']);
        const invoiceNumber = normalizeSerialValue(row.invoiceNumber || row['Invoice Number']);

        let matched: Asset | null = null;
        let matchReason = '';
        let confidence = 0;
        if (serial && bySerial.has(serial.toLowerCase())) {
            matched = bySerial.get(serial.toLowerCase()) || null;
            matchReason = 'Exact serial number match.';
            confidence = 0.99;
        } else if (tag && byTag.has(tag.toLowerCase())) {
            matched = byTag.get(tag.toLowerCase()) || null;
            matchReason = 'Exact asset-tag match.';
            confidence = 0.97;
        } else {
            let best: { asset: Asset; score: number } | null = null;
            for (const asset of params.assets) {
                const score = Math.max(
                    scoreTokenOverlap(itemName, asset.name),
                    scoreTokenOverlap(`${brand} ${model}`, `${(asset.specifications as any)?.brand || ''} ${(asset.specifications as any)?.version || ''} ${asset.name}`)
                );
                if (!best || score > best.score) best = { asset, score };
            }
            if (best && best.score >= 0.45) {
                matched = best.asset;
                matchReason = 'Best brand/model/name similarity match.';
                confidence = clampNumber(best.score, 0.45, 0.9);
            }
        }

        const documentItem = {
            assetName: itemName,
            serialNumber: serial,
            assetTag: tag,
            brand,
            model,
        };
        if (!matched) {
            unmatchedItems.push(documentItem);
            return;
        }

        const suggestedUpdates: Record<string, any> = {};
        if (purchaseDate) suggestedUpdates.purchaseDate = purchaseDate;
        if (warrantyStartDate) suggestedUpdates.warrantyStartDate = warrantyStartDate;
        if (warrantyEndDate) suggestedUpdates.warrantyEndDate = warrantyEndDate;
        if (vendor) suggestedUpdates.vendor = vendor;
        if (purchaseCost !== null) suggestedUpdates.purchaseCost = purchaseCost;
        if (invoiceNumber) suggestedUpdates.invoiceNumber = invoiceNumber;

        matches.push({
            documentItem,
            matchedAssetId: matched.customId,
            matchedAssetName: matched.name,
            suggestedUpdates,
            confidence: Number(confidence.toFixed(3)),
            reason: matchReason,
            evidence: {
                serialMatched: Boolean(serial && normalizeSerialValue(matched.serialNumber)?.toLowerCase() === serial.toLowerCase()),
                tagMatched: Boolean(tag && normalizeSerialValue(matched.assetTag)?.toLowerCase() === tag.toLowerCase()),
            },
        });
    });

    if (!params.rows.length) warnings.push('No extracted rows were provided for matching.');
    const confidence: InventoryAiConfidence = matches.length
        ? 'high'
        : (unmatchedItems.length ? 'medium' : 'low');
    return {
        summary: matches.length
            ? `Matched ${matches.length} document item(s) to existing assets.`
            : 'No confident invoice/document matches were found.',
        matches: matches.slice(0, 500),
        unmatchedItems: unmatchedItems.slice(0, 500),
        warnings,
        confidence,
    };
}

function buildInventoryTicketDraft(params: {
    asset: Asset | null;
    issue: string;
    riskRow: AssetRiskScoreRow | null;
}): {
    ticketDraft: Record<string, any>;
    confidence: InventoryAiConfidence;
    missingData: string[];
} {
    const missingData: string[] = [];
    const issue = String(params.issue || '').trim() || 'Inventory issue requires maintenance follow-up.';
    const risk = params.riskRow;
    const asset = params.asset;
    const priority = risk?.riskLevel === 'critical'
        ? 'P1'
        : risk?.riskLevel === 'high'
            ? 'P2'
            : (risk?.riskLevel === 'medium' ? 'P3' : 'P4');
    const now = new Date();
    const dueDate = new Date(now.getTime() + (priority === 'P1' ? 1 : priority === 'P2' ? 3 : 7) * 86400000)
        .toISOString()
        .slice(0, 10);
    if (!asset) missingData.push('asset');
    const ticketDraft = {
        title: asset ? `Inventory issue: ${asset.name}` : 'Inventory issue follow-up',
        priority,
        category: 'inventory_maintenance',
        assetId: asset?.customId || null,
        assetName: asset?.name || null,
        description: `${issue}${risk ? ` Risk score: ${risk.riskScore} (${risk.riskLevel}).` : ''}`,
        evidence: risk?.reasons || [],
        suggestedAssignee: 'Inventory Operations Team',
        recommendedDueDate: dueDate,
    };
    return {
        ticketDraft,
        confidence: asset ? 'high' : 'medium',
        missingData,
    };
}

function buildMonthlyInventoryReportDeterministic(params: {
    snapshot: InventoryAiSnapshot;
    rangeLabel: string;
    additions: number;
    transfers: number;
}): {
    reportTitle: string;
    dateRange: string;
    executiveSummary: string;
    sections: Array<Record<string, any>>;
    metrics: Record<string, any>;
    recommendations: string[];
    confidence: InventoryAiConfidence;
    missingData: string[];
} {
    const { snapshot } = params;
    const byCategory = snapshot.assets.reduce<Record<string, number>>((acc, asset) => {
        const key = String(asset.category || 'asset').toLowerCase();
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
    const riskRows = buildAssetRiskScores(snapshot).rows;
    const highRisk = riskRows.filter((row) => row.riskLevel === 'high' || row.riskLevel === 'critical');
    const nearEol = snapshot.assets.filter((asset) => {
        const lifecycle = normalizeLifecycleKey(asset.lifecycleStatus);
        if (lifecycle === 'eol_expired') return true;
        if (!asset.warrantyEndDate) return false;
        const days = (asset.warrantyEndDate.getTime() - Date.now()) / 86400000;
        return days <= 90;
    }).length;
    const licenseExpiring = snapshot.assets.filter((asset) => (
        String(asset.category || '').toLowerCase() === 'license'
        && asset.warrantyEndDate
        && ((asset.warrantyEndDate.getTime() - Date.now()) / 86400000) <= 90
    )).length;
    const stockForecast = buildSpareStockForecast(snapshot);
    const missingDataReport = computeMissingDataReport(snapshot);
    const recommendations = [
        highRisk.length ? `Prioritize ${highRisk.length} high-risk asset(s) for maintenance/replacement planning.` : '',
        stockForecast.forecasts.length ? `Review ${stockForecast.forecasts.length} spare-stock forecast recommendation(s).` : '',
        licenseExpiring ? `Renew/reassign ${licenseExpiring} expiring license(s).` : '',
        nearEol ? `Plan lifecycle action for ${nearEol} near-EOL asset(s).` : '',
        missingDataReport.totalIssues ? `Resolve ${missingDataReport.totalIssues} data-quality issue(s).` : '',
    ].filter(Boolean);

    const sections = [
        { key: 'assets_by_category', title: 'Total Assets by Category', data: byCategory },
        { key: 'activity', title: 'Monthly Activity', data: { additions: params.additions, transfers: params.transfers, maintenance: snapshot.maintenance.length } },
        { key: 'risk', title: 'High-Risk Assets', data: highRisk.slice(0, 20) },
        { key: 'eol', title: 'EOL and Expiry Watch', data: { nearEol, licenseExpiring } },
        { key: 'stock', title: 'Low Stock / Forecast', data: stockForecast.forecasts.slice(0, 20) },
        { key: 'data_quality', title: 'Data Quality', data: { totalIssues: missingDataReport.totalIssues, criticalIssues: missingDataReport.criticalIssues } },
    ];
    const missingData: string[] = [];
    if (!snapshot.lifecycleEvents.length) missingData.push('lifecycleEvents');
    if (!snapshot.maintenance.length) missingData.push('maintenanceRecords');
    return {
        reportTitle: `Inventory AI Monthly Report (${params.rangeLabel})`,
        dateRange: params.rangeLabel,
        executiveSummary: `Inventory currently tracks ${snapshot.assets.length} assets across ${Object.keys(byCategory).length} categories. ${highRisk.length} assets are high-risk/critical, ${nearEol} are near EOL, and ${stockForecast.forecasts.length} spare-stock forecast actions were identified.`,
        sections,
        metrics: {
            totalAssets: snapshot.assets.length,
            categoryBreakdown: byCategory,
            additions: params.additions,
            transfers: params.transfers,
            maintenanceRecords: snapshot.maintenance.length,
            highRiskAssets: highRisk.length,
            nearEolAssets: nearEol,
            expiringLicenses: licenseExpiring,
            lowStockForecastItems: stockForecast.forecasts.length,
            dataQualityIssues: missingDataReport.totalIssues,
        },
        recommendations,
        confidence: buildInventoryInsightConfidence({
            dataScope: 'full_inventory',
            scannedCount: snapshot.assets.length,
            matchedCount: highRisk.length + stockForecast.forecasts.length,
        }),
        missingData,
    };
}

type KitHealthStatusKey =
    | 'complete'
    | 'missing_child_item'
    | 'damaged_child_item'
    | 'degraded'
    | 'under_repair'
    | 'unknown';

type KitHealthEvidenceItem = {
    sourceType: 'component' | 'accessory' | 'consumable' | 'license';
    itemId: string | null;
    itemName: string;
    relationshipType: string;
    status: string;
    condition: string | null;
    reason: string;
};

async function computeKitHealthForParent(parentAssetId: string): Promise<{
    parentAssetId: string;
    status: KitHealthStatusKey;
    statusLabel: string;
    summary: string;
    counts: {
        totalLinkedItems: number;
        missing: number;
        damaged: number;
        underRepair: number;
        degraded: number;
    };
    missingItems: KitHealthEvidenceItem[];
    damagedItems: KitHealthEvidenceItem[];
    underRepairItems: KitHealthEvidenceItem[];
    degradedItems: KitHealthEvidenceItem[];
    evidence: KitHealthEvidenceItem[];
    confidence: InventoryAiConfidence;
}> {
    const [components, relationships] = await Promise.all([
        prisma.assetComponent.findMany({
            where: { parentAssetId },
            include: {
                childAsset: true,
            },
            orderBy: { updatedAt: 'desc' },
        }),
        prisma.assetRelationship.findMany({
            where: {
                assetId: parentAssetId,
                relationshipType: {
                    in: ['used_with', 'assigned_to', 'consumed_by', 'licensed_to'],
                },
            },
            include: {
                relatedAsset: true,
            },
            orderBy: { updatedAt: 'desc' },
        }),
    ]);

    const missingItems: KitHealthEvidenceItem[] = [];
    const damagedItems: KitHealthEvidenceItem[] = [];
    const underRepairItems: KitHealthEvidenceItem[] = [];
    const degradedItems: KitHealthEvidenceItem[] = [];
    const evidence: KitHealthEvidenceItem[] = [];

    const pushEvidence = (entry: KitHealthEvidenceItem) => {
        evidence.push(entry);
        if (entry.reason === 'missing_child_item') missingItems.push(entry);
        if (entry.reason === 'damaged_child_item') damagedItems.push(entry);
        if (entry.reason === 'under_repair') underRepairItems.push(entry);
        if (entry.reason === 'degraded') degradedItems.push(entry);
    };

    components.forEach((component) => {
        const normalizedStatus = String(component.status || '').trim().toLowerCase();
        const normalizedCondition = String(component.condition || '').trim().toLowerCase() || null;
        const child = component.childAsset;
        const childLifecycle = normalizeLifecycleKey(child?.lifecycleStatus || '');
        const childStatus = String(child?.status || '').toLowerCase();
        const baseItem: Omit<KitHealthEvidenceItem, 'reason'> = {
            sourceType: 'component',
            itemId: component.childAssetId || component.id,
            itemName: component.componentName || 'Component',
            relationshipType: 'component_of',
            status: normalizedStatus || childLifecycle || childStatus || 'unknown',
            condition: normalizedCondition,
        };

        if (
            ['removed', 'replaced', 'retired', 'disposed', 'missing'].includes(normalizedStatus)
            || Boolean(component.removedAt)
        ) {
            pushEvidence({ ...baseItem, reason: 'missing_child_item' });
            return;
        }
        if (
            ['failed', 'damaged', 'broken'].includes(normalizedStatus)
            || ['failed', 'damaged', 'broken'].includes(normalizedCondition || '')
            || ['retired', 'disposed', 'lost_stolen'].includes(childLifecycle)
        ) {
            pushEvidence({ ...baseItem, reason: 'damaged_child_item' });
            return;
        }
        if (
            ['under_repair', 'repair', 'pending_repair'].includes(normalizedStatus)
            || ['under_maintenance', 'pending_repair'].includes(childLifecycle)
            || ['repair', 'maintenance'].includes(childStatus)
        ) {
            pushEvidence({ ...baseItem, reason: 'under_repair' });
            return;
        }
        if (!child && !component.childAssetId && !component.serialNumber) {
            pushEvidence({ ...baseItem, reason: 'degraded' });
            return;
        }
    });

    relationships.forEach((row) => {
        const related = row.relatedAsset;
        const relatedCategory = String(related?.category || '').toLowerCase();
        const normalizedLifecycle = normalizeLifecycleKey(related?.lifecycleStatus || '');
        const normalizedStatus = String(related?.status || '').trim().toLowerCase();
        const specs = readAssetSpecifications(related || {});
        const baseItem: Omit<KitHealthEvidenceItem, 'reason'> = {
            sourceType: relatedCategory === 'license'
                ? 'license'
                : relatedCategory === 'consumable'
                    ? 'consumable'
                    : 'accessory',
            itemId: related?.customId || row.id,
            itemName: related?.name || row.relatedAssetId,
            relationshipType: String(row.relationshipType || 'related_to'),
            status: normalizedLifecycle || normalizedStatus || 'unknown',
            condition: normalizeSerialValue((specs as any).condition),
        };
        if (related && ['retired', 'disposed', 'lost_stolen'].includes(normalizedLifecycle)) {
            pushEvidence({ ...baseItem, reason: 'missing_child_item' });
            return;
        }
        if (related && ['repair', 'maintenance'].includes(normalizedStatus)) {
            pushEvidence({ ...baseItem, reason: 'under_repair' });
            return;
        }
        if (relatedCategory === 'license') {
            const expiryRaw = normalizeSerialValue((specs as any).licenseExpiry || related?.warrantyEndDate);
            const expiryDate = expiryRaw ? new Date(expiryRaw) : null;
            if (expiryDate && !Number.isNaN(expiryDate.getTime()) && expiryDate.getTime() < Date.now()) {
                pushEvidence({ ...baseItem, reason: 'degraded' });
            }
        }
    });

    const totalLinkedItems = components.length + relationships.length;
    let status: KitHealthStatusKey = 'unknown';
    if (!totalLinkedItems) {
        status = 'unknown';
    } else if (missingItems.length) {
        status = 'missing_child_item';
    } else if (underRepairItems.length) {
        status = 'under_repair';
    } else if (damagedItems.length) {
        status = 'damaged_child_item';
    } else if (degradedItems.length) {
        status = 'degraded';
    } else {
        status = 'complete';
    }

    const statusLabelMap: Record<KitHealthStatusKey, string> = {
        complete: 'Complete',
        missing_child_item: 'Missing Child Item',
        damaged_child_item: 'Damaged Child Item',
        degraded: 'Degraded',
        under_repair: 'Under Repair',
        unknown: 'Unknown',
    };
    return {
        parentAssetId,
        status,
        statusLabel: statusLabelMap[status],
        summary: totalLinkedItems
            ? `Kit health: ${statusLabelMap[status]} (${totalLinkedItems} linked item(s) evaluated).`
            : 'Kit health: Unknown (no linked child items found).',
        counts: {
            totalLinkedItems,
            missing: missingItems.length,
            damaged: damagedItems.length,
            underRepair: underRepairItems.length,
            degraded: degradedItems.length,
        },
        missingItems,
        damagedItems,
        underRepairItems,
        degradedItems,
        evidence: evidence.slice(0, 200),
        confidence: totalLinkedItems ? 'high' : 'medium',
    };
}

function buildEolBudgetReport(params: {
    snapshot: InventoryAiSnapshot;
    monthsAhead: number;
    startDate: Date;
    endDate: Date;
    department?: string | null;
    location?: string | null;
    category?: string | null;
    type?: string | null;
}): {
    summary: string;
    totals: Record<string, any>;
    breakdowns: {
        byDepartment: Record<string, number>;
        byLocation: Record<string, number>;
        byCategory: Record<string, number>;
    };
    rows: Array<Record<string, any>>;
    missingCostRows: Array<Record<string, any>>;
    recommendations: string[];
    confidence: InventoryAiConfidence;
    missingData: string[];
} {
    const now = new Date();
    const horizonEnd = new Date(now.getTime() + Math.max(1, params.monthsAhead) * 30.4375 * 86400000);
    const rangeStart = params.startDate;
    const rangeEnd = params.endDate;
    const deptFilter = normalizeValue(params.department || '');
    const locationFilter = normalizeValue(params.location || '');
    const categoryFilter = normalizeValue(params.category || '');
    const typeFilter = normalizeValue(params.type || '');
    const riskRows = buildAssetRiskScores(params.snapshot).rows;
    const riskById = new Map(riskRows.map((row) => [row.assetId, row]));
    const replacementRows = buildReplacementPriorityRanking(params.snapshot).rankedItems;
    const replacementById = new Map(replacementRows.map((row) => [row.assetId, row]));

    const byDepartment: Record<string, number> = {};
    const byLocation: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    const rows: Array<Record<string, any>> = [];
    const missingCostRows: Array<Record<string, any>> = [];
    let estimatedBudget = 0;

    params.snapshot.assets.forEach((asset) => {
        const categoryKey = String(asset.category || '').toLowerCase();
        if (categoryKey === 'consumable' || categoryKey === 'spare_part') return;
        if (deptFilter && normalizeValue(mapDepartmentToFriendly(asset.department)) !== deptFilter) return;
        if (locationFilter && normalizeValue(mapLocationToFriendly(asset.location)) !== locationFilter) return;
        if (categoryFilter && normalizeValue(categoryKey) !== categoryFilter) return;
        if (typeFilter && !normalizeValue(canonicalAssetType(asset.type)).includes(typeFilter)) return;

        const expiry = asset.warrantyEndDate || null;
        let candidateDate: Date | null = expiry;
        if (!candidateDate && asset.purchaseDate) {
            const fallbackYears = determineFallbackLifespanYears(String(asset.type || ''));
            candidateDate = computePredictedEolDate(asset.purchaseDate, fallbackYears);
        }
        if (!candidateDate || Number.isNaN(candidateDate.getTime())) return;
        if (candidateDate < rangeStart || candidateDate > rangeEnd) return;
        if (candidateDate > horizonEnd) return;

        const risk = riskById.get(asset.customId);
        const replacement = replacementById.get(asset.customId);
        const costCandidate = Number(asset.replacementCost ?? asset.purchaseCost ?? 0);
        const hasCost = Number.isFinite(costCandidate) && costCandidate > 0;
        if (hasCost) estimatedBudget += costCandidate;
        const departmentLabel = mapDepartmentToFriendly(asset.department);
        const locationLabel = mapLocationToFriendly(asset.location);
        const categoryLabel = String(asset.category || 'asset').toLowerCase();
        byDepartment[departmentLabel] = (byDepartment[departmentLabel] || 0) + 1;
        byLocation[locationLabel] = (byLocation[locationLabel] || 0) + 1;
        byCategory[categoryLabel] = (byCategory[categoryLabel] || 0) + 1;

        const row = {
            assetId: asset.customId,
            assetName: asset.name,
            department: departmentLabel,
            location: locationLabel,
            category: categoryLabel,
            type: canonicalAssetType(asset.type),
            lifecycleStatus: normalizeLifecycleKey(asset.lifecycleStatus),
            eolDate: candidateDate.toISOString(),
            riskLevel: risk?.riskLevel || 'unknown',
            riskScore: risk?.riskScore ?? null,
            replacementPriority: replacement?.priority || null,
            replacementReason: replacement?.reason || null,
            estimatedReplacementCost: hasCost ? Number(costCandidate.toFixed(2)) : null,
            costDataMissing: !hasCost,
        };
        rows.push(row);
        if (!hasCost) missingCostRows.push(row);
    });

    rows.sort((a, b) => new Date(a.eolDate).getTime() - new Date(b.eolDate).getTime());
    const recommendations = [
        rows.length ? `Plan lifecycle action for ${rows.length} asset(s) in selected horizon.` : '',
        missingCostRows.length ? `Backfill replacement/purchase cost for ${missingCostRows.length} asset(s).` : '',
        rows.filter((row) => ['high', 'critical'].includes(String(row.riskLevel || '').toLowerCase())).length
            ? 'Prioritize high-risk assets first for replacement planning.'
            : '',
    ].filter(Boolean);
    const missingData: string[] = [];
    if (!rows.length) missingData.push('no_assets_in_range');
    if (missingCostRows.length) missingData.push('replacement_or_purchase_cost');
    return {
        summary: rows.length
            ? `Prepared EOL budget report for ${rows.length} asset(s) in range with estimated budget ${estimatedBudget.toLocaleString()}.`
            : 'No assets matched the selected EOL budget report filters/time range.',
        totals: {
            matchedAssets: rows.length,
            estimatedBudget,
            missingCostAssets: missingCostRows.length,
            monthsAhead: params.monthsAhead,
            range: `${rangeStart.toISOString().slice(0, 10)} to ${rangeEnd.toISOString().slice(0, 10)}`,
        },
        breakdowns: {
            byDepartment,
            byLocation,
            byCategory,
        },
        rows: rows.slice(0, 1000),
        missingCostRows: missingCostRows.slice(0, 500),
        recommendations,
        confidence: rows.length ? 'high' : 'medium',
        missingData,
    };
}

function buildReallocationSuggestions(snapshot: InventoryAiSnapshot): {
    summary: string;
    suggestions: Array<Record<string, any>>;
    confidence: InventoryAiConfidence;
    missingData: string[];
} {
    const procurementNeeds = buildProcurementRecommendations(snapshot);
    const storageLocationHints = ['central warehouse', 'it store', 'admin store', 'network store', 'facilities store', 'store', 'storage'];
    const availableAssets = snapshot.assets.filter((asset) => {
        const category = String(asset.category || '').toLowerCase();
        if (['consumable', 'spare_part', 'license'].includes(category)) return false;
        const lifecycle = normalizeLifecycleKey(asset.lifecycleStatus);
        const friendlyLocation = mapLocationToFriendly(asset.location).toLowerCase();
        const inStorage = storageLocationHints.some((hint) => friendlyLocation.includes(hint));
        const idleLifecycle = ['in_stock', 'reserved'].includes(lifecycle);
        const unassigned = !normalizeSerialValue(asset.assignedToName) && !normalizeSerialValue(asset.assignedToUserId) && !normalizeSerialValue(asset.assignedUser);
        return inStorage && idleLifecycle && unassigned;
    });

    const usedAssetIds = new Set<string>();
    const suggestions: Array<Record<string, any>> = [];
    for (const need of procurementNeeds.slice(0, 120)) {
        const targetTypeToken = normalizeValue(need.type || need.itemName || '');
        if (!targetTypeToken) continue;
        const candidate = availableAssets.find((asset) => {
            if (usedAssetIds.has(asset.customId)) return false;
            const assetTypeToken = normalizeValue(canonicalAssetType(asset.type));
            const assetNameToken = normalizeValue(asset.name);
            return (
                assetTypeToken.includes(targetTypeToken)
                || targetTypeToken.includes(assetTypeToken)
                || assetNameToken.includes(targetTypeToken)
            );
        });
        if (!candidate) continue;
        usedAssetIds.add(candidate.customId);
        const savingsBase = Number(candidate.replacementCost ?? candidate.purchaseCost ?? candidate.value ?? 0);
        suggestions.push({
            requestedNeed: need.itemName,
            availableAssetId: candidate.customId,
            availableAssetName: candidate.name,
            sourceLocation: mapLocationToFriendly(candidate.location),
            suggestedDestination: 'Requesting department/location',
            reason: `Available idle asset in storage can satisfy need for ${need.itemName}.`,
            estimatedSavings: Number.isFinite(savingsBase) && savingsBase > 0 ? Number(savingsBase.toFixed(2)) : null,
            confidence: 0.78,
            evidence: {
                candidateType: canonicalAssetType(candidate.type),
                candidateLifecycle: normalizeLifecycleKey(candidate.lifecycleStatus),
                candidateLocation: mapLocationToFriendly(candidate.location),
                procurementPriority: need.priority,
                procurementReason: need.reason,
            },
        });
    }
    const missingData: string[] = [];
    if (!procurementNeeds.length) missingData.push('procurementNeeds');
    if (!availableAssets.length) missingData.push('availableStorageAssets');
    return {
        summary: suggestions.length
            ? `Generated ${suggestions.length} internal reallocation suggestion(s) to reduce new purchases.`
            : 'No confident reallocation opportunities were detected from current stock and availability.',
        suggestions: suggestions.slice(0, 200),
        confidence: suggestions.length ? 'medium' : 'low',
        missingData,
    };
}

function buildInventoryActionPlan(params: {
    query: string;
    snapshot: InventoryAiSnapshot;
}): {
    actionType: string;
    summary: string;
    affectedItems: Array<Record<string, any>>;
    proposedChanges: Array<Record<string, any>>;
    risks: string[];
    requiresConfirmation: boolean;
    executable: boolean;
    confirmationInstructions: string;
} {
    const query = String(params.query || '').trim();
    const q = query.toLowerCase();
    const affectedItems: Array<Record<string, any>> = [];
    const proposedChanges: Array<Record<string, any>> = [];
    const risks: string[] = [];

    if (q.includes('transfer')) {
        const destination = /to\s+([a-z0-9 _-]+)/i.exec(query)?.[1]?.trim() || 'target location';
        const typeHint = /\b(pc|desktop|laptop|server|projector|printer)\b/i.exec(q)?.[1]?.toLowerCase() || '';
        const sourceLocation = /from\s+([a-z0-9 _-]+)/i.exec(query)?.[1]?.trim().toLowerCase() || '';
        let candidates = params.snapshot.assets.filter((asset) => !['license', 'consumable', 'spare_part'].includes(String(asset.category || '').toLowerCase()));
        if (typeHint) {
            candidates = candidates.filter((asset) => canonicalAssetType(asset.type).includes(typeHint));
        }
        if (sourceLocation) {
            candidates = candidates.filter((asset) => mapLocationToFriendly(asset.location).toLowerCase().includes(sourceLocation));
        }
        candidates.slice(0, 200).forEach((asset) => {
            affectedItems.push({
                assetId: asset.customId,
                name: asset.name,
                category: String(asset.category || '').toLowerCase(),
                location: mapLocationToFriendly(asset.location),
            });
        });
        proposedChanges.push({
            field: 'location',
            newValue: destination,
            reason: 'Natural-language transfer intent detected.',
        });
        risks.push('Bulk transfer should verify destination inventory ownership and related item transfer options.');
        return {
            actionType: 'transfer_assets',
            summary: affectedItems.length
                ? `Planned transfer of ${affectedItems.length} asset(s) to ${destination}.`
                : `No assets matched transfer intent for destination ${destination}.`,
            affectedItems,
            proposedChanges,
            risks,
            requiresConfirmation: true,
            executable: false,
            confirmationInstructions: 'Review affected assets and execute transfer manually or through a dedicated reviewed bulk-transfer flow.',
        };
    }

    if (q.includes('ticket')) {
        const riskRows = buildAssetRiskScores(params.snapshot).rows.filter((row) => row.riskLevel === 'critical' || row.riskLevel === 'high');
        riskRows.slice(0, 50).forEach((row) => {
            affectedItems.push({
                assetId: row.assetId,
                name: row.assetName,
                riskLevel: row.riskLevel,
                riskScore: row.riskScore,
            });
        });
        proposedChanges.push({ field: 'tickets', newValue: 'draft_only', reason: 'Generate draft maintenance tickets for high-risk assets.' });
        risks.push('Ticket creation remains draft-only in this action planner.');
        return {
            actionType: 'draft_tickets',
            summary: affectedItems.length
                ? `Planned draft ticket generation for ${affectedItems.length} high-risk asset(s).`
                : 'No high-risk assets found for draft ticket planning.',
            affectedItems,
            proposedChanges,
            risks,
            requiresConfirmation: true,
            executable: false,
            confirmationInstructions: 'Review proposed ticket drafts before creating them in the ticketing system.',
        };
    }

    return {
        actionType: 'planning_only',
        summary: 'This action is currently planning-only. Supported intents include transfer planning and ticket drafting.',
        affectedItems: [],
        proposedChanges: [],
        risks: ['Unsupported action execution in this pass to ensure safe review-before-execute behavior.'],
        requiresConfirmation: true,
        executable: false,
        confirmationInstructions: 'Use a supported phrase like "Transfer all Lab A PCs to Computer Lab B" or "Create tickets for high-risk assets".',
    };
}

function deterministicNaturalLanguageSearch(snapshot: InventoryAiSnapshot, query: string): {
    interpretedFilters: Record<string, any>;
    results: InventoryAiMatchedItem[];
    answer: string;
    confidence: 'low' | 'medium' | 'high';
    fallbackUsed: boolean;
} {
    const assistant = deterministicAssistantAnswer(snapshot, query);
    if (assistant.supported) {
        return {
            interpretedFilters: assistant.filtersUsed,
            results: assistant.matchedItems,
            answer: assistant.answer,
            confidence: assistant.confidence,
            fallbackUsed: true,
        };
    }
    const q = normalizeValue(query);
    const results = snapshot.assets
        .filter((asset) => {
            const haystack = [
                asset.customId,
                asset.name,
                canonicalAssetType(asset.type),
                mapLocationToFriendly(asset.location),
                mapDepartmentToFriendly(asset.department),
                asset.serialNumber,
                asset.assetTag,
            ].map((entry) => normalizeValue(entry)).join(' ');
            return haystack.includes(q);
        })
        .slice(0, 120)
        .map((asset) => buildAiMatchedItem(asset, 'Matched by fallback normalized text search.'));

    return {
        interpretedFilters: { mode: 'fallback_text_search' },
        results,
        answer: results.length
            ? `Found ${results.length} item(s) using fallback text search.`
            : 'No matches found for this natural language query.',
        confidence: results.length ? 'medium' : 'low',
        fallbackUsed: true,
    };
}

function canonicalAssetType(type: unknown): string {
    const raw = String(type || '').trim();
    if (!raw) return '';
    const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_');
    const aliases: Record<string, string> = {
        laptop: 'laptop',
        desktop: 'desktop',
        desktop_pc: 'desktop',
        pc: 'desktop',
        workstation: 'desktop',
        thin_client: 'desktop',
        lab_computer: 'desktop',
        library_pc: 'desktop',
        tablet: 'tablet',
        ipad: 'tablet',
        server: 'server',
        nas_storage: 'server',
        nvr_dvr: 'server',
        monitor: 'monitor',
        peripheral: 'peripheral',
        external_storage_device: 'peripheral',
        keyboard: 'keyboard',
        electronics: 'electronics',
        ups: 'electronics',
        network_rack: 'electronics',
        biometric_attendance_device: 'electronics',
        ip_phone: 'electronics',
        projector: 'projector',
        smartboard: 'smartboard',
        interactive_display: 'smartboard',
        camera: 'camera',
        cctv_camera: 'camera',
        lecture_capture_device: 'camera',
        document_camera: 'camera',
        router: 'router',
        switch: 'switch',
        network_switch: 'switch',
        access_point: 'access_point',
        firewall: 'firewall',
        firewall_appliance: 'firewall',
        printer: 'printer',
        photocopier: 'printer',
        scanner: 'scanner',
        barcode_scanner: 'scanner',
        rfid_reader: 'scanner',
        book_scanner: 'scanner',
    };
    const byNormalized = aliases[normalized];
    if (byNormalized) return byNormalized;
    const byUpper = aliases[raw.toUpperCase().toLowerCase()];
    if (byUpper) return byUpper;
    return normalized;
}

const TELEMETRY_CAPABLE_ASSET_TYPES = new Set<string>([
    'desktop',
    'laptop',
    'server',
    'workstation',
    'thin_client',
    'tablet',
    'ipad',
    'printer',
    'photocopier',
    'projector',
    'smartboard',
    'interactive_display',
    'router',
    'switch',
    'network_switch',
    'access_point',
    'firewall',
    'firewall_appliance',
    'ip_phone',
    'cctv_camera',
    'nvr_dvr',
    'ups',
    'nas_storage',
    'external_storage_device',
    'peripheral',
    'lab_computer',
    'biometric_attendance_device',
    'monitor',
    'scanner',
]);

function isTelemetryCapableAsset(params: { type?: unknown; category?: unknown; name?: unknown }): boolean {
    const category = String(params.category || '').trim().toLowerCase();
    if (['license', 'consumable', 'spare_part', 'component'].includes(category)) return false;
    const canonicalTypeValue = canonicalAssetType(params.type);
    if (TELEMETRY_CAPABLE_ASSET_TYPES.has(canonicalTypeValue)) return true;
    const nameToken = normalizeValue(String(params.name || ''));
    if (!nameToken) return false;
    return (
        nameToken.includes('desktop')
        || nameToken.includes('laptop')
        || nameToken.includes('pc')
        || nameToken.includes('server')
        || nameToken.includes('projector')
        || nameToken.includes('printer')
        || nameToken.includes('switch')
        || nameToken.includes('router')
        || nameToken.includes('accesspoint')
        || nameToken.includes('smartboard')
        || nameToken.includes('interactive')
        || nameToken.includes('cctv')
        || nameToken.includes('ups')
        || nameToken.includes('biometric')
    );
}

function buildTelemetryDefaultsForAsset(params: {
    type?: unknown;
    category?: unknown;
    name?: unknown;
    existingSpecs?: Record<string, any>;
    location?: unknown;
}): Record<string, any> {
    const specs = params.existingSpecs || {};
    const telemetryDisabledExplicit = (
        specs.telemetryDisabled === true
        || String(specs.telemetryDisabled || '').toLowerCase() === 'true'
    );
    const telemetryExplicit = (
        specs.trackWorkingHours === true
        || String(specs.trackWorkingHours || '').toLowerCase() === 'true'
        || specs.telemetryEnabled === true
        || String(specs.telemetryEnabled || '').toLowerCase() === 'true'
    );
    const telemetryCapable = isTelemetryCapableAsset({
        type: params.type,
        category: params.category,
        name: params.name,
    });
    const telemetryEnabled = telemetryDisabledExplicit ? false : (telemetryExplicit || telemetryCapable);
    const inWarehouse = isCentralWarehouseLocationValue(params.location) || !String(params.location || '').trim();
    const baseStatus = telemetryEnabled
        ? (inWarehouse ? 'offline' : 'insufficient_data')
        : 'not_monitored';
    const baseReason = telemetryEnabled
        ? (inWarehouse
            ? 'Telemetry-capable asset is currently in warehouse/offline staging.'
            : 'Telemetry-capable asset imported/created for deployed monitoring.')
        : 'Telemetry monitoring disabled for this asset.';
    return {
        ...specs,
        trackWorkingHours: telemetryEnabled,
        telemetryEnabled,
        telemetryApplicable: telemetryEnabled,
        telemetryStatus: String(specs.telemetryStatus || baseStatus),
        telemetryConfidence: String(specs.telemetryConfidence || 'low'),
        telemetryReason: String(specs.telemetryReason || baseReason),
        operationalState: String(specs.operationalState || (telemetryEnabled ? 'insufficient_data' : 'not_monitored')),
        operationalStateUpdatedAt: String(specs.operationalStateUpdatedAt || new Date().toISOString()),
        lastTelemetryAt: specs.lastTelemetryAt || undefined,
        workingHours: Number(specs.workingHours || 0),
    };
}

function getSpecNumber(specs: Record<string, any>, keys: string[], fallback = 0): number {
    for (const key of keys) {
        const matchKey = Object.keys(specs).find((k) => normalizeValue(k) === normalizeValue(key));
        if (!matchKey) continue;
        const parsed = Number(String(specs[matchKey] ?? '').replace(/[^0-9.]/g, ''));
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}

function getEffectiveWorkingHours(specs: Record<string, any>, measuredAt: Date = new Date()): number {
    const storedHours = isTelemetryTracked(specs)
        ? Math.max(0, getSpecNumber(specs, ['workingHours', 'Working Hours'], 0))
        : 0;
    const telemetryTruth = getTelemetryTruth(specs);
    const state = telemetryTruth.state;
    const stateUpdatedAt = specs.operationalStateUpdatedAt ? new Date(specs.operationalStateUpdatedAt) : null;

    if (!stateUpdatedAt || Number.isNaN(stateUpdatedAt.getTime())) return storedHours;
    if (!measuredAt || Number.isNaN(measuredAt.getTime())) return storedHours;
    const elapsedHours = Math.max(0, (measuredAt.getTime() - stateUpdatedAt.getTime()) / 36e5);
    return storedHours + (elapsedHours * (OPERATIONAL_STATE_RATES[state] ?? 0));
}

type LifespanPredictionResponse = {
    predicted_lifespan_years: number;
    quality_tier: string;
    failure_risk: number;
    model_version: string;
    explanation: string;
};

type LifespanPredictionSnapshot = {
    predictedLifespanYears: number;
    failureRisk: number;
    qualityTier: string;
    modelVersion: string;
    explanation: string;
    workingHours: number;
    operationalState: string;
    updatedAt: string;
    reason: string;
};

type LifespanRefreshReason =
    | 'asset_created'
    | 'asset_transferred'
    | 'telemetry_update'
    | 'manual_request'
    | 'asset_updated';

type LifespanRefreshOptions = {
    reason: LifespanRefreshReason;
    forcePersist?: boolean;
    minimumHoursDelta?: number;
    requestId?: string;
    baseLifespanYears?: number;
    asOf?: Date;
};

function mapRefreshReasonToCanonicalTrigger(reason: LifespanRefreshReason): string {
    if (reason === 'manual_request') return 'manual_recalculation';
    if (reason === 'telemetry_update') return 'telemetry_update';
    if (reason === 'asset_created') return 'asset_created';
    if (reason === 'asset_transferred') return 'asset_transferred';
    if (reason === 'asset_updated') return 'asset_updated';
    return 'manual_recalculation';
}

type EolAssessmentStatus = 'healthy' | 'watch' | 'due_soon' | 'overdue' | 'unknown' | 'insufficient_data';
type EolPredictionSource = 'persisted_lifecycle_prediction' | 'freshly_calculated_prediction' | 'fallback_category_default' | 'insufficient_data';
type EolEvidenceLevel = 'high' | 'medium' | 'low';

type EolAssessmentResponse = {
    assetId: string;
    status: EolAssessmentStatus;
    predictedEolDate: string | null;
    monthsRemaining: number | null;
    confidence: number;
    reason: string;
    evidenceLevel: EolEvidenceLevel;
    procurementRecommended: boolean;
    procurementWindowMonths: number | null;
    predictionSource: EolPredictionSource;
    telemetryStatus: TelemetryTruthState;
    specEvidenceStatus: 'trusted' | 'insufficient_source_evidence' | 'llm_or_heuristic_only' | 'user_confirmed';
    suitableForProcurementPlanning: boolean;
    predictedLifespanYears: number | null;
    generatedAt: string;
};

function readLifespanSnapshot(specs: Record<string, any>): LifespanPredictionSnapshot | null {
    const raw = specs.lifecyclePrediction;
    if (!raw || typeof raw !== 'object') return null;
    const predicted = Number((raw as Record<string, any>).predictedLifespanYears);
    const risk = Number((raw as Record<string, any>).failureRisk);
    if (!Number.isFinite(predicted) || !Number.isFinite(risk)) return null;
    return {
        predictedLifespanYears: predicted,
        failureRisk: risk,
        qualityTier: String((raw as Record<string, any>).qualityTier || ''),
        modelVersion: String((raw as Record<string, any>).modelVersion || ''),
        explanation: String((raw as Record<string, any>).explanation || ''),
        workingHours: Number((raw as Record<string, any>).workingHours || 0),
        operationalState: String((raw as Record<string, any>).operationalState || 'offline'),
        updatedAt: String((raw as Record<string, any>).updatedAt || ''),
        reason: String((raw as Record<string, any>).reason || ''),
    };
}

function hasMeaningfulLifespanImpact(
    previous: LifespanPredictionSnapshot | null,
    nextPrediction: LifespanPredictionResponse,
    currentWorkingHours: number,
    currentState: string,
    minimumHoursDelta: number,
): boolean {
    if (!previous) return true;

    const hoursDelta = Math.max(0, currentWorkingHours - Number(previous.workingHours || 0));
    const yearsDelta = Math.abs(Number(previous.predictedLifespanYears || 0) - Number(nextPrediction.predicted_lifespan_years || 0));
    const riskDelta = Math.abs(Number(previous.failureRisk || 0) - Number(nextPrediction.failure_risk || 0));
    const stateChanged = String(previous.operationalState || 'offline') !== String(currentState || 'offline');
    const onlineInUse = String(currentState || '') === 'online_in_use';
    const onlineIdle = String(currentState || '') === 'online_idle';

    if (stateChanged) return true;
    if (onlineInUse && hoursDelta >= minimumHoursDelta) return true;
    if (onlineIdle && hoursDelta >= (minimumHoursDelta * 2)) return true;
    if (hoursDelta >= minimumHoursDelta && yearsDelta >= LIFESPAN_IMPACT_MIN_YEAR_DELTA) return true;
    if (hoursDelta >= minimumHoursDelta && riskDelta >= LIFESPAN_IMPACT_MIN_RISK_DELTA) return true;
    if (hoursDelta >= minimumHoursDelta * 3) return true;
    return false;
}

async function requestAssetLifespanPrediction(
    asset: Asset,
    opts: { baseLifespanYears?: number; requestId?: string; asOf?: Date } = {},
): Promise<{ prediction: LifespanPredictionResponse; requestId: string; workingHours: number; operationalState: string; durationMs: number }> {
    const requestId = opts.requestId || crypto.randomUUID();
    const startedAt = Date.now();
    const specs = ((asset.specifications as Record<string, any>) || {});
    const baseLifespanYears = Number.isFinite(Number(opts.baseLifespanYears))
        && Number(opts.baseLifespanYears) > 0
        ? Number(opts.baseLifespanYears)
        : 5;
    const telemetryTruth = getTelemetryTruth(specs);
    const workingHours = telemetryTruth.hasTelemetry
        ? Math.round(getEffectiveWorkingHours(specs, opts.asOf || new Date()))
        : 0;
    const operationalState = telemetryTruth.state;

    const payload = {
        assetId: asset.customId,
        type: canonicalAssetType(asset.type),
        brand: String(specs.brand || specs.Brand || '').trim(),
        model: String(specs.version || specs.Version || specs.model || specs.Model || '').trim(),
        specifications: specs,
        baseLifespanYears,
        workingHours,
        operationalState,
        telemetryConfidence: telemetryTruth.confidence,
        telemetryReason: telemetryTruth.reason,
    };

    const aiResponse = await fetch(`${INVENTORY_AI_SERVICE_URL}/predict-asset-lifespan`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-request-id': requestId,
        },
        body: JSON.stringify(payload),
    });

    if (!aiResponse.ok) {
        const errorText = await aiResponse.text();
        throw new Error(`Inventory AI service unavailable (${aiResponse.status}): ${errorText}`);
    }

    const prediction = await aiResponse.json() as LifespanPredictionResponse;
    const durationMs = Date.now() - startedAt;
    return {
        prediction,
        requestId,
        workingHours,
        operationalState,
        durationMs,
    };
}

async function refreshAndPersistAssetLifespan(assetId: string, options: LifespanRefreshOptions): Promise<{
    persisted: boolean;
    skippedReason?: string;
    prediction?: LifespanPredictionResponse;
    snapshot?: LifespanPredictionSnapshot;
    durationMs?: number;
    requestId?: string;
}> {
    const asset = await AssetService.getAssetByCustomId(assetId);
    if (!asset) return { persisted: false, skippedReason: 'asset_not_found' };

    const specs = ((asset.specifications as Record<string, any>) || {});
    const canonicalPrevious = await getLatestPersistedLifespanPrediction(assetId);
    const previousSnapshot = snapshotFromCanonicalPrediction(canonicalPrevious as unknown as Record<string, any>) || readLifespanSnapshot(specs);
    const asOf = options.asOf || new Date();
    const telemetryTruth = getTelemetryTruth(specs);
    const currentWorkingHours = telemetryTruth.hasTelemetry ? Math.round(getEffectiveWorkingHours(specs, asOf)) : 0;
    const currentState = telemetryTruth.state;
    const minimumHoursDelta = Math.max(0.25, Number(options.minimumHoursDelta ?? LIFESPAN_IMPACT_MIN_HOURS));

    if (!options.forcePersist && options.reason === 'telemetry_update') {
        const previousHours = Number(previousSnapshot?.workingHours || 0);
        const hoursDelta = Math.max(0, currentWorkingHours - previousHours);
        const stateChanged = String(previousSnapshot?.operationalState || currentState) !== currentState;
        const consumptionState = currentState === 'online_in_use' || currentState === 'online_idle';
        if (!stateChanged && (!consumptionState || hoursDelta < minimumHoursDelta)) {
            return { persisted: false, skippedReason: 'consumption_change_below_threshold' };
        }
    }

    const { prediction, requestId, durationMs } = await requestAssetLifespanPrediction(asset, {
        requestId: options.requestId,
        baseLifespanYears: options.baseLifespanYears,
        asOf,
    });

    const shouldPersist = Boolean(options.forcePersist)
        || hasMeaningfulLifespanImpact(previousSnapshot, prediction, currentWorkingHours, currentState, minimumHoursDelta);

    if (!shouldPersist) {
        return {
            persisted: false,
            skippedReason: 'impact_not_significant',
            prediction,
            durationMs,
            requestId,
        };
    }

    const lifecyclePrediction: LifespanPredictionSnapshot = {
        predictedLifespanYears: Number(prediction.predicted_lifespan_years || 0),
        failureRisk: Number(prediction.failure_risk || 0),
        qualityTier: String(prediction.quality_tier || ''),
        modelVersion: String(prediction.model_version || ''),
        explanation: String(prediction.explanation || ''),
        workingHours: currentWorkingHours,
        operationalState: currentState,
        updatedAt: new Date().toISOString(),
        reason: options.reason,
    };

    const updatedSpecs = {
        ...specs,
        workingHours: currentWorkingHours,
        operationalState: currentState,
        lifecyclePrediction,
        predictedLifespanYears: lifecyclePrediction.predictedLifespanYears,
        failureRisk: lifecyclePrediction.failureRisk,
        lifespanModelVersion: lifecyclePrediction.modelVersion,
        lifespanUpdatedAt: lifecyclePrediction.updatedAt,
    };

    await AssetService.updateAsset(assetId, { specifications: updatedSpecs });
    try {
        const predictionSource = String(prediction.model_version || '').toLowerCase().includes('fallback')
            ? 'fallback_category_default'
            : 'persisted_workflow_prediction';
        const specEvidenceStatus = resolveSpecEvidenceStatus(specs);
        let confidence = String(prediction.model_version || '').toLowerCase().includes('fallback') ? 0.42 : 0.68;
        if (specEvidenceStatus === 'trusted') confidence += 0.12;
        if (specEvidenceStatus !== 'trusted') confidence -= 0.08;
        if (telemetryTruth.hasTelemetry) confidence += 0.08;
        if (!telemetryTruth.hasTelemetry) confidence -= 0.08;
        confidence = clampNumber(confidence, 0.05, 0.95);
        const evidenceLevel = confidence >= 0.75 ? 'high' : confidence >= 0.5 ? 'medium' : 'low';
        await persistLifespanPrediction({
            assetId,
            predictedLifespanYears: lifecyclePrediction.predictedLifespanYears,
            failureRisk: lifecyclePrediction.failureRisk,
            qualityTier: lifecyclePrediction.qualityTier,
            modelVersion: lifecyclePrediction.modelVersion,
            predictionSource,
            trigger: mapRefreshReasonToCanonicalTrigger(options.reason),
            reason: lifecyclePrediction.reason,
            explanation: lifecyclePrediction.explanation,
            workingHours: lifecyclePrediction.workingHours,
            operationalState: lifecyclePrediction.operationalState,
            telemetryStatus: telemetryTruth.state,
            specEvidenceStatus,
            startDate: resolveLifecycleStartDate(asset, specs),
            confidence,
            evidenceLevel,
            requestId,
            provider: 'inventory-ai-service',
            generatedBy: 'inventory-backend',
        });
    } catch (error: any) {
        console.warn(`[InventoryAI] canonical lifespan persistence failed for ${assetId}: ${error.message}`);
    }
    return {
        persisted: true,
        prediction,
        snapshot: lifecyclePrediction,
        durationMs,
        requestId,
    };
}

function parseOptionalDate(value: unknown): Date | null {
    if (!value) return null;
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseOptionalNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function calculateLifespanYears(start: Date | null, end: Date | null): number | null {
    if (!start || !end) return null;
    if (end.getTime() <= start.getTime()) return null;
    return (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
}

function requiresHumanSpecVerification(specs: Record<string, any>): boolean {
    const confidence = Number(specs.aiSpecConfidence || 0);
    const lookupMode = String(specs.aiSpecLookupMode || '').toLowerCase();
    const hasSources = Array.isArray(specs.aiSpecSourceUrls) && specs.aiSpecSourceUrls.length > 0;
    const evidenceStatus = String(specs.aiSpecEvidenceStatus || '').toLowerCase();
    const looksFallback = (
        lookupMode.includes('fallback')
        || lookupMode.includes('heuristic')
        || lookupMode.includes('low_confidence')
        || lookupMode.includes('no_source')
        || lookupMode.includes('estimate')
        || lookupMode.includes('llm')
    );
    const weakEvidence = evidenceStatus === 'insufficient_source_evidence' || evidenceStatus === 'llm_or_heuristic_only';
    return confidence < SPEC_VERIFICATION_CONFIDENCE_THRESHOLD || !hasSources || looksFallback || weakEvidence;
}

function snapshotFromCanonicalPrediction(row: Record<string, any> | null): LifespanPredictionSnapshot | null {
    if (!row) return null;
    const predicted = Number(row.predictedLifespanYears);
    const risk = Number(row.failureRisk);
    if (!Number.isFinite(predicted)) return null;
    return {
        predictedLifespanYears: predicted,
        failureRisk: Number.isFinite(risk) ? risk : 0,
        qualityTier: String(row.qualityTier || ''),
        modelVersion: String(row.modelVersion || ''),
        explanation: String(row.explanation || ''),
        workingHours: Number(row.workingHours || 0),
        operationalState: String(row.operationalState || row.telemetryStatus || 'unknown'),
        updatedAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
        reason: String(row.reason || row.trigger || ''),
    };
}

function telemetryTruthFromCanonicalSample(sample: Record<string, any> | null): {
    state: TelemetryTruthState;
    confidence: 'high' | 'low';
    reason: string;
    hasTelemetry: boolean;
} | null {
    if (!sample) return null;
    const state = normalizeOperationalStateValue(sample.derivedStatus);
    const confidenceScore = Number(sample.confidence);
    const confidence: 'high' | 'low' = Number.isFinite(confidenceScore) && confidenceScore >= 0.65 ? 'high' : 'low';
    return {
        state,
        confidence,
        reason: String(sample.reason || 'Derived from canonical telemetry sample.'),
        hasTelemetry: true,
    };
}

function buildSpecEvidenceAssessment(params: {
    confidence: number;
    lookupMode: string;
    sourceUrls: string[];
}): { evidenceStatus: 'trusted' | 'insufficient_source_evidence' | 'llm_or_heuristic_only'; evidenceReason: string } {
    const lookupMode = String(params.lookupMode || '').toLowerCase();
    const sourceUrls = Array.isArray(params.sourceUrls) ? params.sourceUrls.filter(Boolean) : [];
    const confidence = Number(params.confidence || 0);
    const hasAnySource = sourceUrls.length > 0;
    const trustedByLookupMode = (
        lookupMode === 'live_catalog_lookup'
        || lookupMode === 'verified_feedback_cache'
    );

    if (!hasAnySource) {
        return {
            evidenceStatus: 'insufficient_source_evidence',
            evidenceReason: 'No trusted source evidence found.',
        };
    }

    if (!trustedByLookupMode) {
        return {
            evidenceStatus: 'llm_or_heuristic_only',
            evidenceReason: 'LLM/heuristic estimate only; requires human verification.',
        };
    }

    if (confidence < SPEC_VERIFICATION_CONFIDENCE_THRESHOLD) {
        return {
            evidenceStatus: 'insufficient_source_evidence',
            evidenceReason: 'Source evidence exists but model confidence is below verification threshold.',
        };
    }

    return {
        evidenceStatus: 'trusted',
        evidenceReason: 'Trusted source evidence available.',
    };
}

function annotateAssetWithTruthfulSignals(asset: Asset): Asset {
    const rawSpecs = ((asset.specifications as Record<string, any>) || {});
    const specs = buildTelemetryDefaultsForAsset({
        type: asset.type,
        category: asset.category,
        name: asset.name,
        location: asset.location,
        existingSpecs: rawSpecs,
    });
    const telemetryTruth = getTelemetryTruth(specs);
    const evidence = buildSpecEvidenceAssessment({
        confidence: Number(specs.aiSpecConfidence || 0),
        lookupMode: String(specs.aiSpecLookupMode || ''),
        sourceUrls: Array.isArray(specs.aiSpecSourceUrls) ? specs.aiSpecSourceUrls : [],
    });
    return {
        ...asset,
        specifications: {
            ...specs,
            operationalState: telemetryTruth.state,
            telemetryStatus: telemetryTruth.state,
            telemetryConfidence: telemetryTruth.confidence,
            telemetryReason: telemetryTruth.reason,
            aiSpecEvidenceStatus: specs.aiSpecEvidenceStatus || evidence.evidenceStatus,
            aiSpecEvidenceReason: specs.aiSpecEvidenceReason || evidence.evidenceReason,
        },
    };
}

function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function resolveSpecEvidenceStatus(specs: Record<string, any>): 'trusted' | 'insufficient_source_evidence' | 'llm_or_heuristic_only' {
    const explicit = String(specs.aiSpecEvidenceStatus || '').toLowerCase();
    if (explicit === 'trusted' || explicit === 'insufficient_source_evidence' || explicit === 'llm_or_heuristic_only') {
        return explicit;
    }
    return buildSpecEvidenceAssessment({
        confidence: Number(specs.aiSpecConfidence || 0),
        lookupMode: String(specs.aiSpecLookupMode || ''),
        sourceUrls: Array.isArray(specs.aiSpecSourceUrls) ? specs.aiSpecSourceUrls : [],
    }).evidenceStatus;
}

function normalizeCanonicalSpecEvidenceStatus(rawValue: unknown): 'trusted' | 'insufficient_source_evidence' | 'llm_or_heuristic_only' {
    const normalized = String(rawValue || '').trim().toLowerCase();
    if (normalized === 'trusted') return 'trusted';
    if (normalized === 'llm_or_heuristic_only') return 'llm_or_heuristic_only';
    return 'insufficient_source_evidence';
}

function determineFallbackLifespanYears(assetType: string): number {
    const typeKey = canonicalAssetType(assetType);
    const metrics = (EOL_METRICS as Record<string, { years?: number }>)[typeKey]
        || (EOL_METRICS as Record<string, { years?: number }>).default
        || { years: 5 };
    const years = Number(metrics.years || 5);
    return Number.isFinite(years) && years > 0 ? years : 5;
}

function resolveLifecycleStartDate(asset: Asset, specs: Record<string, any>): Date | null {
    const lifecycle = (specs.lifecycle && typeof specs.lifecycle === 'object') ? specs.lifecycle : {};
    const candidates = [
        lifecycle.commissionedAt,
        lifecycle.purchaseDate,
        specs.commissionedAt,
        specs.purchaseDate,
        specs.acquiredAt,
        asset.createdAt,
    ];
    for (const value of candidates) {
        if (!value) continue;
        const parsed = new Date(String(value));
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return null;
}

function computePredictedEolDate(startDate: Date | null, lifespanYears: number | null): Date | null {
    if (!startDate || !Number.isFinite(Number(lifespanYears)) || Number(lifespanYears) <= 0) return null;
    const result = new Date(startDate);
    result.setDate(result.getDate() + Math.round(Number(lifespanYears) * 365.25));
    return Number.isNaN(result.getTime()) ? null : result;
}

function monthsBetween(now: Date, futureDate: Date | null): number | null {
    if (!futureDate) return null;
    const months = (futureDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
    return Number.isFinite(months) ? Number(months.toFixed(1)) : null;
}

function classifyEolStatus(monthsRemaining: number | null, confidence: number, predictionSource: EolPredictionSource): EolAssessmentStatus {
    if (monthsRemaining === null) return 'insufficient_data';
    if (monthsRemaining < 0) return 'overdue';
    if (confidence < 0.5) return predictionSource === 'insufficient_data' ? 'insufficient_data' : 'unknown';
    if (monthsRemaining <= 3) return 'due_soon';
    if (monthsRemaining <= 12) return 'watch';
    return 'healthy';
}

async function buildAssetEolAssessment(asset: Asset): Promise<EolAssessmentResponse> {
    const now = new Date();
    const annotated = annotateAssetWithTruthfulSignals(asset);
    const specs = ((annotated.specifications as Record<string, any>) || {});
    const canonicalSpecSnapshot = await getLatestSpecSnapshot(asset.customId);
    const canonicalTelemetrySample = await getLatestTelemetrySample(asset.customId);
    const canonicalPrediction = await getLatestPersistedLifespanPrediction(asset.customId);
    const telemetryTruth = telemetryTruthFromCanonicalSample(canonicalTelemetrySample as unknown as Record<string, any>) || getTelemetryTruth(specs);
    const specEvidenceStatus = canonicalSpecSnapshot
        ? normalizeCanonicalSpecEvidenceStatus(canonicalSpecSnapshot.evidenceStatus)
        : resolveSpecEvidenceStatus(specs);
    const lifecycleSnapshot = snapshotFromCanonicalPrediction(canonicalPrediction as unknown as Record<string, any>) || readLifespanSnapshot(specs);
    const startDate = resolveLifecycleStartDate(asset, specs);
    const fallbackYears = determineFallbackLifespanYears(String(asset.type || ''));
    const categoryKey = String(asset.category || '').trim().toLowerCase();
    const missingData: string[] = [];
    const usedData: string[] = [];

    if (categoryKey === 'license') {
        const expiryCandidate = (
            normalizeSerialValue((specs as any).licenseExpiry)
            || normalizeSerialValue((specs as any).expiryDate)
            || normalizeSerialValue((specs as any).warrantyEndDate)
        );
        const parsedExpiry = expiryCandidate ? new Date(expiryCandidate) : asset.warrantyEndDate;
        const validExpiry = parsedExpiry && !Number.isNaN(parsedExpiry.getTime()) ? parsedExpiry : null;
        if (validExpiry) {
            usedData.push('license expiry date');
        } else {
            missingData.push('license expiry/warranty end date');
        }
        const monthsRemaining = monthsBetween(now, validExpiry);
        const status: EolAssessmentStatus = !validExpiry
            ? 'insufficient_data'
            : (monthsRemaining !== null && monthsRemaining < 0)
                ? 'overdue'
                : (monthsRemaining !== null && monthsRemaining <= 1)
                    ? 'due_soon'
                    : (monthsRemaining !== null && monthsRemaining <= 3)
                        ? 'watch'
                        : 'healthy';
        const confidence = validExpiry ? 0.9 : 0.2;
        const reason = validExpiry
            ? `License expires on ${validExpiry.toISOString().slice(0, 10)}. Data used: ${usedData.join(', ')}.`
            : `EOL confidence low because ${missingData.join(', ')} is missing.`;
        return {
            assetId: asset.customId,
            status,
            predictedEolDate: validExpiry ? validExpiry.toISOString() : null,
            monthsRemaining,
            confidence: Number(confidence.toFixed(3)),
            reason,
            evidenceLevel: confidence >= 0.75 ? 'high' : confidence >= 0.5 ? 'medium' : 'low',
            procurementRecommended: status === 'due_soon' || status === 'overdue',
            procurementWindowMonths: status === 'overdue' || status === 'due_soon' ? 1 : null,
            predictionSource: validExpiry ? 'freshly_calculated_prediction' : 'insufficient_data',
            telemetryStatus: telemetryTruth.state,
            specEvidenceStatus,
            suitableForProcurementPlanning: Boolean(validExpiry),
            predictedLifespanYears: null,
            generatedAt: new Date().toISOString(),
        };
    }

    if (categoryKey === 'consumable' || categoryKey === 'spare_part') {
        const quantity = Number((specs as any).quantityAvailable ?? (specs as any).quantity ?? asset.quantity ?? 0);
        const reorderPoint = Number((specs as any).reorderPoint ?? (specs as any).minimumStockLevel ?? 0);
        if (Number.isFinite(quantity)) usedData.push('quantity');
        else missingData.push('quantity');
        if (Number.isFinite(reorderPoint) && reorderPoint > 0) usedData.push('minimum stock/reorder point');
        else missingData.push('minimum stock/reorder point');
        const safeQty = Number.isFinite(quantity) ? quantity : 0;
        const safeReorder = Number.isFinite(reorderPoint) ? reorderPoint : 0;
        const status: EolAssessmentStatus = safeQty <= 0
            ? 'overdue'
            : safeReorder > 0 && safeQty <= safeReorder
                ? 'watch'
                : 'healthy';
        const confidence = usedData.length >= 2 ? 0.88 : 0.4;
        const reason = `Stock health for ${categoryKey === 'consumable' ? 'consumable' : 'spare stock'}: quantity=${safeQty}, reorderPoint=${safeReorder}. Data used: ${usedData.join(', ') || 'none'}.${missingData.length ? ` Missing data: ${missingData.join(', ')}.` : ''}`;
        return {
            assetId: asset.customId,
            status,
            predictedEolDate: null,
            monthsRemaining: null,
            confidence: Number(confidence.toFixed(3)),
            reason,
            evidenceLevel: confidence >= 0.75 ? 'high' : confidence >= 0.5 ? 'medium' : 'low',
            procurementRecommended: safeQty <= 0 || (safeReorder > 0 && safeQty <= safeReorder),
            procurementWindowMonths: safeQty <= 0 ? 0 : (safeReorder > 0 && safeQty <= safeReorder ? 1 : null),
            predictionSource: 'freshly_calculated_prediction',
            telemetryStatus: telemetryTruth.state,
            specEvidenceStatus,
            suitableForProcurementPlanning: true,
            predictedLifespanYears: null,
            generatedAt: new Date().toISOString(),
        };
    }

    let predictedLifespanYears: number | null = null;
    let predictionSource: EolPredictionSource = 'insufficient_data';
    let reasonParts: string[] = [];
    let modelVersion = '';

    if (lifecycleSnapshot && Number.isFinite(Number(lifecycleSnapshot.predictedLifespanYears || 0))) {
        predictedLifespanYears = Number(lifecycleSnapshot.predictedLifespanYears);
        predictionSource = 'persisted_lifecycle_prediction';
        modelVersion = String(lifecycleSnapshot.modelVersion || '');
        reasonParts.push('Using persisted lifecycle prediction snapshot.');
    } else {
        try {
            const fresh = await requestAssetLifespanPrediction(asset, {
                baseLifespanYears: fallbackYears,
            });
            predictedLifespanYears = Number(fresh.prediction.predicted_lifespan_years || 0);
            modelVersion = String(fresh.prediction.model_version || '');
            if (modelVersion.includes('fallback')) {
                predictionSource = 'fallback_category_default';
                reasonParts.push('No persisted lifecycle snapshot; using fallback category/model estimate.');
            } else {
                predictionSource = 'freshly_calculated_prediction';
                reasonParts.push('No persisted lifecycle snapshot; using fresh display-only prediction.');
            }
        } catch (error: any) {
            predictedLifespanYears = fallbackYears;
            predictionSource = 'fallback_category_default';
            reasonParts.push(`AI prediction unavailable; using fallback category default (${fallbackYears} years).`);
        }
    }

    if (!Number.isFinite(Number(predictedLifespanYears)) || Number(predictedLifespanYears) <= 0) {
        predictedLifespanYears = fallbackYears;
        predictionSource = 'fallback_category_default';
        reasonParts.push('Predicted lifespan was invalid; using fallback category default.');
    }

    if (categoryKey === 'component') {
        const componentType = String((specs as any).componentType || '').trim().toLowerCase();
        const componentProfiles: Record<string, number> = {
            ram: 6,
            cpu: 7,
            ssd: 4,
            hdd: 4,
            storage: 4,
            battery: 3,
            psu: 5,
            gpu: 6,
            motherboard: 7,
        };
        if (componentType && Number.isFinite(componentProfiles[componentType])) {
            predictedLifespanYears = componentProfiles[componentType];
            predictionSource = 'fallback_category_default';
            reasonParts.push(`Component-type profile applied (${componentType}: ${predictedLifespanYears} years).`);
        } else {
            reasonParts.push('Component-type profile unavailable; using base asset type estimate.');
        }
        if (String(asset.status || '').toUpperCase() === 'REPAIR') {
            reasonParts.push('Component is currently in repair state.');
        }
        if (String(asset.status || '').toUpperCase() === 'RETIRED') {
            reasonParts.push('Component already retired.');
        }
    }

    const predictedEolDate = computePredictedEolDate(startDate, predictedLifespanYears);
    const monthsRemaining = monthsBetween(now, predictedEolDate);

    let confidence = (
        predictionSource === 'persisted_lifecycle_prediction' ? 0.72
            : predictionSource === 'freshly_calculated_prediction' ? 0.64
                : predictionSource === 'fallback_category_default' ? 0.42
                    : 0.2
    );

    if (specEvidenceStatus === 'trusted') {
        confidence += 0.15;
        reasonParts.push('Specification evidence is trusted.');
    } else if (specEvidenceStatus === 'llm_or_heuristic_only') {
        confidence -= 0.22;
        reasonParts.push('Specification evidence is heuristic/LLM-only.');
    } else {
        confidence -= 0.25;
        reasonParts.push('Specification evidence is insufficient.');
    }

    if (telemetryTruth.state === 'online_in_use' || telemetryTruth.state === 'online_idle' || telemetryTruth.state === 'offline') {
        confidence += 0.08;
        reasonParts.push('Telemetry signals are available.');
    } else {
        confidence -= 0.12;
        reasonParts.push(`Telemetry state is ${telemetryTruth.state}.`);
    }

    if (predictionSource === 'fallback_category_default') {
        confidence -= 0.1;
    }

    if (!startDate) {
        confidence = Math.min(confidence, 0.25);
        reasonParts.push('Lifecycle start date is missing.');
        missingData.push('purchase/commission date');
    }

    if (!canonicalTelemetrySample) missingData.push('telemetry sample');
    if (!canonicalSpecSnapshot) missingData.push('canonical spec evidence snapshot');
    if (!lifecycleSnapshot) missingData.push('persisted lifecycle prediction');

    if (missingData.length) {
        reasonParts.push(`EOL confidence ${missingData.length >= 2 ? 'low' : 'medium'} because missing data: ${Array.from(new Set(missingData)).join(', ')}.`);
    }

    confidence = clampNumber(confidence, 0.05, 0.98);
    const evidenceLevel: EolEvidenceLevel = confidence >= 0.75 ? 'high' : confidence >= 0.5 ? 'medium' : 'low';
    const status = classifyEolStatus(monthsRemaining, confidence, predictionSource);

    const isLifecycleClosed = ['retired', 'replaced', 'failed'].includes(String((specs.lifecycle as Record<string, any>)?.finalOutcome || '').toLowerCase())
        || String(asset.status || '').toUpperCase() === 'RETIRED';
    if (isLifecycleClosed) {
        reasonParts.push('Asset lifecycle is closed; procurement recommendation is not applicable.');
    }

    const suitableForProcurementPlanning = !isLifecycleClosed
        && confidence >= 0.6
        && (status === 'watch' || status === 'due_soon' || status === 'overdue');
    const procurementRecommended = suitableForProcurementPlanning && (status === 'due_soon' || status === 'overdue' || (status === 'watch' && (monthsRemaining ?? 99) <= 6));
    const procurementWindowMonths = procurementRecommended
        ? (status === 'overdue' || status === 'due_soon' ? 3 : 6)
        : null;

    if (status === 'unknown' || status === 'insufficient_data') {
        reasonParts.push('Confidence is too low for procurement-grade EOL planning.');
    }
    if (modelVersion) {
        reasonParts.push(`Model version: ${modelVersion}.`);
    }

    return {
        assetId: asset.customId,
        status,
        predictedEolDate: predictedEolDate ? predictedEolDate.toISOString() : null,
        monthsRemaining,
        confidence: Number(confidence.toFixed(3)),
        reason: reasonParts.join(' '),
        evidenceLevel,
        procurementRecommended,
        procurementWindowMonths,
        predictionSource,
        telemetryStatus: telemetryTruth.state,
        specEvidenceStatus,
        suitableForProcurementPlanning,
        predictedLifespanYears,
        generatedAt: new Date().toISOString(),
    };
}

async function submitSpecVerificationFeedback(payload: Record<string, any>) {
    try {
        const response = await fetch(`${INVENTORY_AI_SERVICE_URL}/feedback/spec-verification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const text = await response.text();
            console.warn(`[InventoryAI] feedback/spec-verification failed: ${response.status} ${text}`);
        }
    } catch (error: any) {
        console.warn(`[InventoryAI] feedback/spec-verification error: ${error.message}`);
    }
}

async function publishLowStockEvent(params: {
    itemId: string;
    itemName: string;
    admin?: { id?: string; name?: string; email?: string };
}) {
    let admin = params.admin || {};
    if (!admin.id || !admin.email) {
        try {
            const response = await fetch(`${AUTH_SERVICE_URL}/internal/admin-users`, {
                method: 'GET',
                headers: {
                    'x-internal-token': INTERNAL_API_TOKEN,
                },
            });
            if (response.ok) {
                const payload = await response.json() as { data?: Array<{ id?: string; email?: string; firstName?: string; lastName?: string }> };
                const firstAdmin = Array.isArray(payload.data) ? payload.data.find((a) => a?.id && a?.email) : null;
                if (firstAdmin) {
                    admin = {
                        id: String(firstAdmin.id || ''),
                        email: String(firstAdmin.email || ''),
                        name: [String(firstAdmin.firstName || ''), String(firstAdmin.lastName || '')].join(' ').trim(),
                    };
                }
            }
        } catch (error: any) {
            console.warn(`[LowStock] Failed to fetch admin from auth-service DB-backed endpoint: ${error.message}`);
        }
    }

    await EventBus.publish(TOPICS.ASSET_LOW_STOCK, {
        item: {
            id: params.itemId,
            name: params.itemName,
        },
        admin: {
            id: String(admin.id || process.env.LOW_STOCK_ADMIN_ID || '456'),
            name: String(admin.name || process.env.LOW_STOCK_ADMIN_NAME || 'Omar'),
            email: String(admin.email || process.env.LOW_STOCK_ADMIN_EMAIL || 'omar@example.com'),
        },
    });
}

async function recordLifecycleEvent(params: {
    assetId: string;
    componentId?: string | null;
    eventType: string;
    oldValue?: Record<string, any> | null;
    newValue?: Record<string, any> | null;
    reason?: string | null;
    notes?: string | null;
    actor?: string | null;
}) {
    try {
        await prisma.assetLifecycleEvent.create({
            data: {
                assetId: params.assetId,
                componentId: params.componentId || null,
                eventType: params.eventType,
                oldValue: params.oldValue || undefined,
                newValue: params.newValue || undefined,
                reason: params.reason || undefined,
                notes: params.notes || undefined,
                actor: params.actor || undefined,
            }
        });
    } catch (error: any) {
        console.warn(`[AssetLifecycleEvent] failed: ${error?.message || error}`);
    }
}

async function recordHistoryEvent(params: { assetId: string; action: string; details: string }) {
    try {
        await HistoryService.createHistory({
            assetId: params.assetId,
            action: params.action,
            details: params.details,
        });
    } catch (error: any) {
        console.warn(`[AssetHistory] failed: ${error?.message || error}`);
    }
}

type LifecycleOutcomePayload = {
    purchaseDate?: string | null;
    commissionedAt?: string | null;
    failureDate?: string | null;
    replacementDate?: string | null;
    retiredAt?: string | null;
    failureType?: string | null;
    replacementCost?: number | null;
    actualLifespanYears?: number | null;
    finalOutcome?: string | null;
    notes?: string | null;
    reviewer?: string | null;
};

async function readLifecycleOutcome(assetId: string): Promise<Record<string, any> | null> {
    const rows = await prisma.$queryRawUnsafe<Record<string, any>[]>(
        'SELECT * FROM "asset_lifecycle_outcomes" WHERE "assetId" = $1 LIMIT 1',
        assetId
    );
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function upsertLifecycleOutcome(asset: any, payload: LifecycleOutcomePayload): Promise<Record<string, any>> {
    const purchaseDate = parseOptionalDate(payload.purchaseDate);
    const commissionedAt = parseOptionalDate(payload.commissionedAt);
    const failureDate = parseOptionalDate(payload.failureDate);
    const replacementDate = parseOptionalDate(payload.replacementDate);
    const retiredAt = parseOptionalDate(payload.retiredAt);
    const replacementCost = parseOptionalNumber(payload.replacementCost);
    const providedYears = parseOptionalNumber(payload.actualLifespanYears);
    const startDate = commissionedAt || purchaseDate || parseOptionalDate(asset.createdAt);
    const endDate = replacementDate || retiredAt || failureDate;
    const derivedYears = calculateLifespanYears(startDate, endDate);
    const actualLifespanYears = (providedYears && providedYears > 0) ? providedYears : derivedYears;

    const normalizedOutcome = String(payload.finalOutcome || '').trim().toLowerCase();
    const finalOutcome = normalizedOutcome || (
        replacementDate ? 'replaced' : (retiredAt ? 'retired' : (failureDate ? 'failed' : 'active'))
    );
    const isClosedOutcome = finalOutcome === 'retired' || finalOutcome === 'replaced' || finalOutcome === 'failed';
    const currentStatus = String(asset.status || '').toUpperCase();
    const currentSpecs = ((asset.specifications as Record<string, any>) || {});
    const existingLifecycle = (currentSpecs.lifecycle && typeof currentSpecs.lifecycle === 'object')
        ? currentSpecs.lifecycle as Record<string, any>
        : {};
    const existingPreviousStatus = String(existingLifecycle.previousStatus || '').toUpperCase();
    const nextPreviousStatus = isClosedOutcome
        ? (currentStatus !== 'RETIRED' ? currentStatus : existingPreviousStatus)
        : (existingPreviousStatus || null);

    const id = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
        `INSERT INTO "asset_lifecycle_outcomes" (
            "id", "assetId", "purchaseDate", "commissionedAt", "failureDate", "replacementDate", "retiredAt",
            "failureType", "replacementCost", "actualLifespanYears", "finalOutcome", "notes", "createdAt", "updatedAt"
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11, $12, NOW(), NOW()
        )
        ON CONFLICT ("assetId") DO UPDATE SET
            "purchaseDate" = EXCLUDED."purchaseDate",
            "commissionedAt" = EXCLUDED."commissionedAt",
            "failureDate" = EXCLUDED."failureDate",
            "replacementDate" = EXCLUDED."replacementDate",
            "retiredAt" = EXCLUDED."retiredAt",
            "failureType" = EXCLUDED."failureType",
            "replacementCost" = EXCLUDED."replacementCost",
            "actualLifespanYears" = EXCLUDED."actualLifespanYears",
            "finalOutcome" = EXCLUDED."finalOutcome",
            "notes" = EXCLUDED."notes",
            "updatedAt" = NOW()`,
        id,
        asset.customId,
        purchaseDate,
        commissionedAt,
        failureDate,
        replacementDate,
        retiredAt,
        payload.failureType ? String(payload.failureType) : null,
        replacementCost,
        actualLifespanYears,
        finalOutcome,
        payload.notes ? String(payload.notes) : null
    );

    const nextSpecs = {
        ...currentSpecs,
        lifecycle: {
            purchaseDate: purchaseDate ? purchaseDate.toISOString() : null,
            commissionedAt: commissionedAt ? commissionedAt.toISOString() : null,
            failureDate: failureDate ? failureDate.toISOString() : null,
            replacementDate: replacementDate ? replacementDate.toISOString() : null,
            retiredAt: retiredAt ? retiredAt.toISOString() : null,
            failureType: payload.failureType ? String(payload.failureType) : null,
            replacementCost,
            actualLifespanYears,
            finalOutcome,
            notes: payload.notes ? String(payload.notes) : null,
            previousStatus: nextPreviousStatus || null,
            updatedAt: new Date().toISOString(),
        },
        actualLifespanYears: actualLifespanYears ?? undefined,
    };

    await AssetService.updateAsset(asset.customId, { specifications: nextSpecs });

    if (isClosedOutcome) {
        await AssetService.updateAsset(asset.customId, { status: 'RETIRED' });
    } else if (currentStatus === 'RETIRED') {
        const candidateStatus = String(nextPreviousStatus || '').toUpperCase();
        const statusToRestore = ['ACTIVE', 'REPAIR', 'ASSIGNED', 'MAINTENANCE'].includes(candidateStatus)
            ? candidateStatus
            : 'ACTIVE';
        await AssetService.updateAsset(asset.customId, { status: statusToRestore as any });
    }

    return (await readLifecycleOutcome(asset.customId)) || {};
}

async function enrichAssetSpecificationsWithAI(params: {
    name: string;
    type: string;
    existingSpecs: Record<string, any>;
}): Promise<Record<string, any>> {
    const existing = params.existingSpecs || {};
    const brand = String(existing.brand || existing.Brand || '').trim();
    const model = String(existing.version || existing.Version || existing.model || existing.Model || '').trim();
    const typeKey = canonicalAssetType(params.type);

    if (!brand && !model && !params.name) return existing;

    if (brand && model && typeKey) {
        try {
            const sourceLookup = await lookupTrustedSourceSpecs({
                assetType: typeKey,
                brand,
                model,
                forceRefresh: false,
            });

            if (sourceLookup.success && Object.keys(sourceLookup.normalizedSpecs || {}).length > 0) {
                const inferred = stripLifecycleManagedSpecFields(sourceLookup.normalizedSpecs);
                const merged: Record<string, any> = { ...inferred, ...existing };
                merged.aiDetectedSpecs = inferred;
                merged.aiSpecFieldConfidence = {};
                merged.aiSpecConfidence = Number(sourceLookup.confidence || 0);
                merged.aiSpecSource = sourceLookup.sourceType || 'trusted_source_lookup';
                merged.aiSpecLookupMode = sourceLookup.lookupMode || 'trusted_source_live_lookup';
                merged.aiSpecSourceUrls = sourceLookup.sourceUrl ? [sourceLookup.sourceUrl] : [];
                merged.aiSpecRuleVersion = 'source-lookup-v1';
                merged.aiSpecVariant = sourceLookup.cacheHit ? 'source-cache' : 'source-live';
                merged.aiSpecEvidenceStatus = (
                    sourceLookup.evidenceStatus === 'source_backed'
                    && sourceLookup.exactModelMatched
                    && Number(sourceLookup.confidence || 0) >= SPEC_VERIFICATION_CONFIDENCE_THRESHOLD
                ) ? 'trusted' : 'insufficient_source_evidence';
                merged.aiSpecEvidenceReason = String(
                    sourceLookup.evidenceReason
                    || (
                        merged.aiSpecEvidenceStatus === 'trusted'
                            ? 'Trusted source evidence available.'
                            : 'Source lookup result requires manual verification.'
                    )
                );
                merged.aiSpecDetectedAt = new Date().toISOString();
                merged.specVerificationStatus = requiresHumanSpecVerification(merged) ? 'pending' : 'verified';
                merged.specVerificationUpdatedAt = new Date().toISOString();
                return merged;
            }
        } catch (error: any) {
            console.warn(`[InventoryAI] trusted source lookup failed for ${brand} ${model}: ${error.message}`);
        }
    }

    try {
        const response = await fetch(`${INVENTORY_AI_SERVICE_URL}/infer-asset-specs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: params.name,
                type: typeKey,
                brand,
                model,
                specifications: existing
            })
        });

        if (!response.ok) {
            console.warn(`[InventoryAI] infer-asset-specs failed with status ${response.status}`);
            return existing;
        }

        const data = await response.json() as {
            inferred_specifications?: Record<string, any>;
            field_confidence?: Record<string, number>;
            confidence?: number;
            source?: string;
            source_urls?: string[];
            lookup_mode?: string;
            rule_version?: string;
            variant?: string;
        };

        const inferred = stripLifecycleManagedSpecFields(data.inferred_specifications || {});
        const fieldConfidence = stripLifecycleManagedSpecFields(
            (data.field_confidence && typeof data.field_confidence === 'object') ? data.field_confidence : {}
        );
        const merged: Record<string, any> = { ...inferred, ...existing };
        merged.aiDetectedSpecs = inferred;
        merged.aiSpecFieldConfidence = fieldConfidence;
        merged.aiSpecConfidence = Number(data.confidence || 0);
        merged.aiSpecSource = data.source || 'inventory-ai-spec-inference-v1';
        merged.aiSpecLookupMode = data.lookup_mode || 'heuristic_fallback';
        merged.aiSpecSourceUrls = Array.isArray(data.source_urls) ? data.source_urls : [];
        merged.aiSpecRuleVersion = data.rule_version || 'spec-rules-v1';
        merged.aiSpecVariant = data.variant || 'control';
        const evidence = buildSpecEvidenceAssessment({
            confidence: merged.aiSpecConfidence,
            lookupMode: merged.aiSpecLookupMode,
            sourceUrls: merged.aiSpecSourceUrls,
        });
        merged.aiSpecEvidenceStatus = evidence.evidenceStatus;
        merged.aiSpecEvidenceReason = evidence.evidenceReason;
        merged.aiSpecDetectedAt = new Date().toISOString();
        merged.specVerificationStatus = requiresHumanSpecVerification(merged) ? 'pending' : 'verified';
        merged.specVerificationUpdatedAt = new Date().toISOString();
        return merged;
    } catch (error: any) {
        console.warn(`[InventoryAI] infer-asset-specs error: ${error.message}`);
        return existing;
    }
}

// --- MOUNT ROUTERS ---
app.use('/api/config', inventoryReadGuard);
app.use('/api/assets', inventoryReadGuard);
app.use('/api/inventory', inventoryReadGuard);
app.use('/api/inventory-ai', inventoryReadGuard);
app.use('/api/tickets', ticketRoutes);
app.use('/api/config', configRoutes);
app.use('/api/inventory-ai', inventoryAiReadinessRoutes);

app.post('/internal/inventory-ai/assets/:id/spec-refresh', internalWorkerGuard, async (req: Request, res: Response) => {
    try {
        const assetId = req.params.id;
        const asset = await AssetService.getAssetByCustomId(assetId);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });

        const currentSpecs = ((asset.specifications as Record<string, any>) || {});
        const enriched = await enrichAssetSpecificationsWithAI({
            name: String(asset.name || ''),
            type: String(asset.type || ''),
            existingSpecs: currentSpecs,
        });

        const reviewedOnCreate = parseBooleanFlag(
            req.body?.specConfirmationReviewed
            ?? enriched.specVerificationConfirmedOnCreate
            ?? currentSpecs.specVerificationConfirmedOnCreate
        );
        const reviewedBy = String(
            req.body?.specConfirmationReviewedBy
            || enriched.specVerificationReviewedBy
            || currentSpecs.specVerificationReviewedBy
            || 'asset_creator'
        ).trim();

        const nextSpecs: Record<string, any> = {
            ...enriched,
            specVerificationStatus: reviewedOnCreate
                ? 'verified'
                : (String(enriched.specVerificationStatus || '').trim() || 'pending'),
            specVerificationConfirmedOnCreate: reviewedOnCreate,
            specVerificationReviewedBy: reviewedOnCreate ? reviewedBy : enriched.specVerificationReviewedBy,
            specVerificationReviewedAt: reviewedOnCreate
                ? (String(enriched.specVerificationReviewedAt || '').trim() || new Date().toISOString())
                : enriched.specVerificationReviewedAt,
            specVerificationAction: reviewedOnCreate
                ? 'confirmed_on_create'
                : (enriched.specVerificationAction || undefined),
            aiSpecEvidenceStatus: String(enriched.aiSpecEvidenceStatus || 'insufficient_source_evidence'),
            aiSpecEvidenceReason: String(
                enriched.aiSpecEvidenceReason
                || 'No trusted exact source evidence found. Manual review recommended.'
            ),
        };

        const updated = await AssetService.updateAsset(assetId, { specifications: nextSpecs });

        try {
            await persistSpecSnapshot({
                assetId,
                specifications: nextSpecs,
                context: 'background_spec_refresh',
                reviewer: reviewedOnCreate ? reviewedBy : null,
                reviewedAt: reviewedOnCreate ? new Date() : null,
            });
        } catch (error: any) {
            console.warn(`[InventoryAIJobs] canonical spec snapshot persistence failed for ${assetId}: ${error.message}`);
        }

        if (reviewedOnCreate) {
            await submitSpecVerificationFeedback({
                asset_id: assetId,
                action: 'candidate_confirmed_on_create',
                name: String(asset.name || ''),
                type: canonicalAssetType(asset.type),
                brand: String(nextSpecs.brand || nextSpecs.Brand || ''),
                model: String(nextSpecs.version || nextSpecs.Version || nextSpecs.model || nextSpecs.Model || ''),
                predicted_specifications: nextSpecs.aiDetectedSpecs || {},
                corrected_specifications: extractRenderableSpecs(nextSpecs),
                field_confidence: (nextSpecs.aiSpecFieldConfidence && typeof nextSpecs.aiSpecFieldConfidence === 'object')
                    ? nextSpecs.aiSpecFieldConfidence
                    : {},
                confidence: Number(nextSpecs.aiSpecConfidence || 0),
                source: String(nextSpecs.aiSpecSource || ''),
                source_urls: Array.isArray(nextSpecs.aiSpecSourceUrls) ? nextSpecs.aiSpecSourceUrls : [],
                lookup_mode: String(nextSpecs.aiSpecLookupMode || ''),
                variant: String(nextSpecs.aiSpecVariant || 'control'),
                rule_version: String(nextSpecs.aiSpecRuleVersion || 'spec-rules-v1'),
                submitted_by: reviewedBy,
            });
        }

        return res.json({
            assetId,
            status: 'ok',
            specVerificationStatus: nextSpecs.specVerificationStatus,
            specVerificationConfirmedOnCreate: reviewedOnCreate,
            updatedAt: updated.updatedAt,
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to refresh specs in background', error: error.message });
    }
});

app.post('/internal/inventory-ai/assets/:id/lifespan-refresh', internalWorkerGuard, async (req: Request, res: Response) => {
    try {
        const assetId = req.params.id;
        const trigger = String(req.body?.trigger || '').toLowerCase();
        const reason: LifespanRefreshReason = trigger.includes('telemetry')
            ? 'telemetry_update'
            : trigger.includes('transfer')
                ? 'asset_transferred'
                : trigger.includes('create')
                    ? 'asset_created'
                    : 'asset_updated';
        const refresh = await refreshAndPersistAssetLifespan(assetId, {
            reason,
            forcePersist: true,
            requestId: req.body?.requestId ? String(req.body.requestId) : undefined,
            minimumHoursDelta: LIFESPAN_IMPACT_MIN_HOURS,
        });
        return res.json({
            assetId,
            ...refresh,
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to refresh lifespan in background', error: error.message });
    }
});

app.post('/internal/inventory-ai/assets/:id/eol-refresh', internalWorkerGuard, async (req: Request, res: Response) => {
    try {
        const assetId = req.params.id;
        const asset = await AssetService.getAssetByCustomId(assetId);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });

        const assessment = await buildAssetEolAssessment(asset);
        try {
            await persistEolAssessment({
                assetId: asset.customId,
                status: assessment.status,
                predictedEolDate: assessment.predictedEolDate,
                monthsRemaining: assessment.monthsRemaining,
                confidence: assessment.confidence,
                reason: assessment.reason,
                evidenceLevel: assessment.evidenceLevel,
                predictionSource: assessment.predictionSource,
                telemetryStatus: assessment.telemetryStatus,
                specEvidenceStatus: assessment.specEvidenceStatus,
                suitableForProcurementPlanning: assessment.suitableForProcurementPlanning,
                procurementRecommended: assessment.procurementRecommended,
                procurementWindowMonths: assessment.procurementWindowMonths,
                generatedAt: assessment.generatedAt,
            });
        } catch (persistError: any) {
            console.warn(`[InventoryAIJobs] canonical EOL assessment persistence failed for ${assetId}: ${persistError.message}`);
        }

        return res.json({
            ...assessment,
            assetId,
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to refresh EOL assessment in background', error: error.message });
    }
});

app.post('/internal/inventory-ai/assets/:id/procurement-refresh', internalWorkerGuard, async (req: Request, res: Response) => {
    try {
        const assetId = req.params.id;
        const asset = await AssetService.getAssetByCustomId(assetId);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });
        const assessment = await buildAssetEolAssessment(asset);
        await persistEolAssessment({
            assetId: asset.customId,
            status: assessment.status,
            predictedEolDate: assessment.predictedEolDate,
            monthsRemaining: assessment.monthsRemaining,
            confidence: assessment.confidence,
            reason: assessment.reason,
            evidenceLevel: assessment.evidenceLevel,
            predictionSource: assessment.predictionSource,
            telemetryStatus: assessment.telemetryStatus,
            specEvidenceStatus: assessment.specEvidenceStatus,
            suitableForProcurementPlanning: assessment.suitableForProcurementPlanning,
            procurementRecommended: assessment.procurementRecommended,
            procurementWindowMonths: assessment.procurementWindowMonths,
            generatedAt: assessment.generatedAt,
        });
        return res.json({
            assetId,
            procurementRecommended: assessment.procurementRecommended,
            procurementWindowMonths: assessment.procurementWindowMonths,
            status: assessment.status,
            confidence: assessment.confidence,
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to refresh procurement candidate in background', error: error.message });
    }
});

// --- SPARE STOCK ROUTES ---
app.get('/api/inventory/spare-stock/low-stock', async (_req: Request, res: Response) => {
    try {
        const rows = await prisma.spareStockItem.findMany({
            where: {
                OR: [
                    {
                        reorderPoint: {
                            not: null,
                        }
                    },
                    {
                        minimumStockLevel: {
                            gt: 0,
                        }
                    }
                ]
            },
            orderBy: [
                { quantityAvailable: 'asc' },
                { updatedAt: 'desc' },
            ],
        });
        const filtered = rows.filter((row) => isLowStock(row));
        res.json({
            count: filtered.length,
            items: filtered.map((row) => ({
                ...row,
                lowStock: true,
            })),
        });
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to fetch low stock items', error: error.message });
    }
});

app.get('/api/inventory/spare-stock', async (req: Request, res: Response) => {
    try {
        const q = String(req.query.q || '').trim();
        const componentType = String(req.query.componentType || '').trim();
        const lowStockOnly = parseBooleanFlag(req.query.lowStockOnly);
        const where: Prisma.SpareStockItemWhereInput = {};
        const andClauses: Prisma.SpareStockItemWhereInput[] = [];

        if (componentType) {
            andClauses.push({
                componentType: {
                    contains: componentType,
                    mode: 'insensitive',
                }
            });
        }

        if (q) {
            andClauses.push({
                OR: [
                    { partName: { contains: q, mode: 'insensitive' } },
                    { componentType: { contains: q, mode: 'insensitive' } },
                    { brand: { contains: q, mode: 'insensitive' } },
                    { model: { contains: q, mode: 'insensitive' } },
                    { partNumber: { contains: q, mode: 'insensitive' } },
                    { location: { contains: q, mode: 'insensitive' } },
                    { vendor: { contains: q, mode: 'insensitive' } },
                ]
            });
        }

        if (andClauses.length) where.AND = andClauses;

        const rows = await prisma.spareStockItem.findMany({
            where,
            orderBy: [
                { updatedAt: 'desc' },
                { partName: 'asc' },
            ]
        });
        const normalized = rows.map((row) => ({
            ...row,
            lowStock: isLowStock(row),
        }));
        const result = lowStockOnly
            ? normalized.filter((row) => row.lowStock)
            : normalized;
        res.json({
            count: result.length,
            items: result,
        });
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to fetch spare stock items', error: error.message });
    }
});

app.post('/api/inventory/spare-stock', inventoryAdminGuard, async (req: Request, res: Response) => {
    try {
        const partName = String(req.body?.partName || '').trim();
        const componentType = String(req.body?.componentType || '').trim();
        if (!partName) return res.status(400).json({ message: 'partName is required' });
        if (!componentType) return res.status(400).json({ message: 'componentType is required' });

        const row = await prisma.spareStockItem.create({
            data: {
                partName,
                componentType,
                category: normalizeSerialValue(req.body?.category),
                brand: normalizeSerialValue(req.body?.brand),
                model: normalizeSerialValue(req.body?.model),
                partNumber: normalizeSerialValue(req.body?.partNumber),
                quantityAvailable: normalizeNonNegativeInteger(req.body?.quantityAvailable, 0),
                minimumStockLevel: normalizeNonNegativeInteger(req.body?.minimumStockLevel, 0),
                reorderPoint: parseOptionalIntegerInput(req.body?.reorderPoint),
                location: normalizeSerialValue(req.body?.location),
                vendor: normalizeSerialValue(req.body?.vendor),
                unitCost: parseOptionalNumberInput(req.body?.unitCost),
                compatibleAssetTypes: parseJsonArrayInput(req.body?.compatibleAssetTypes),
                compatibleBrandsModels: parseJsonArrayInput(req.body?.compatibleBrandsModels),
                notes: normalizeSerialValue(req.body?.notes),
            }
        });
        res.status(201).json({
            ...row,
            lowStock: isLowStock(row),
        });
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to create spare stock item', error: error.message });
    }
});

app.patch('/api/inventory/spare-stock/:id', inventoryAdminGuard, async (req: Request, res: Response) => {
    try {
        const existing = await prisma.spareStockItem.findUnique({ where: { id: req.params.id } });
        if (!existing) return res.status(404).json({ message: 'Spare stock item not found' });

        const payload = req.body || {};
        const updateData: Prisma.SpareStockItemUpdateInput = {};
        if (typeof payload.partName !== 'undefined') updateData.partName = String(payload.partName || '').trim() || existing.partName;
        if (typeof payload.componentType !== 'undefined') updateData.componentType = String(payload.componentType || '').trim() || existing.componentType;
        if (typeof payload.category !== 'undefined') updateData.category = normalizeSerialValue(payload.category);
        if (typeof payload.brand !== 'undefined') updateData.brand = normalizeSerialValue(payload.brand);
        if (typeof payload.model !== 'undefined') updateData.model = normalizeSerialValue(payload.model);
        if (typeof payload.partNumber !== 'undefined') updateData.partNumber = normalizeSerialValue(payload.partNumber);
        if (typeof payload.quantityAvailable !== 'undefined') updateData.quantityAvailable = normalizeNonNegativeInteger(payload.quantityAvailable, existing.quantityAvailable);
        if (typeof payload.minimumStockLevel !== 'undefined') updateData.minimumStockLevel = normalizeNonNegativeInteger(payload.minimumStockLevel, existing.minimumStockLevel);
        if (typeof payload.reorderPoint !== 'undefined') updateData.reorderPoint = parseOptionalIntegerInput(payload.reorderPoint);
        if (typeof payload.location !== 'undefined') updateData.location = normalizeSerialValue(payload.location);
        if (typeof payload.vendor !== 'undefined') updateData.vendor = normalizeSerialValue(payload.vendor);
        if (typeof payload.unitCost !== 'undefined') updateData.unitCost = parseOptionalNumberInput(payload.unitCost);
        if (typeof payload.compatibleAssetTypes !== 'undefined') updateData.compatibleAssetTypes = parseJsonArrayInput(payload.compatibleAssetTypes);
        if (typeof payload.compatibleBrandsModels !== 'undefined') updateData.compatibleBrandsModels = parseJsonArrayInput(payload.compatibleBrandsModels);
        if (typeof payload.notes !== 'undefined') updateData.notes = normalizeSerialValue(payload.notes);

        const updated = await prisma.spareStockItem.update({
            where: { id: req.params.id },
            data: updateData,
        });
        res.json({
            ...updated,
            lowStock: isLowStock(updated),
        });
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to update spare stock item', error: error.message });
    }
});

app.post('/api/inventory/spare-stock/:id/adjust', inventoryAdminGuard, async (req: Request, res: Response) => {
    try {
        const delta = parseOptionalIntegerInput(req.body?.delta);
        if (delta === null || delta === 0) {
            return res.status(400).json({ message: 'delta must be a non-zero integer' });
        }
        const updated = await prisma.$transaction(async (tx) => {
            const existing = await tx.spareStockItem.findUnique({ where: { id: req.params.id } });
            if (!existing) throw new RequestValidationError('Spare stock item not found');
            const nextQty = existing.quantityAvailable + delta;
            if (nextQty < 0) throw new RequestValidationError('Adjustment would make quantity negative');
            return tx.spareStockItem.update({
                where: { id: req.params.id },
                data: {
                    quantityAvailable: nextQty,
                    notes: normalizeSerialValue(req.body?.note) || existing.notes,
                }
            });
        });
        res.json({
            ...updated,
            lowStock: isLowStock(updated),
        });
    } catch (error: any) {
        if (error instanceof RequestValidationError) {
            return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: 'Failed to adjust spare stock quantity', error: error.message });
    }
});

app.post('/api/assets/import/preview', inventoryAdminGuard, async (req: Request, res: Response) => {
    try {
        const filename = String(req.body?.filename || '').trim();
        const headerMappings = (req.body?.headerMappings && typeof req.body.headerMappings === 'object')
            ? req.body.headerMappings as Record<string, string>
            : null;
        let rawRows: Array<Record<string, any>> = [];

        if (Array.isArray(req.body?.rows)) {
            rawRows = req.body.rows as Array<Record<string, any>>;
        } else if (String(req.body?.fileContent || '').trim()) {
            rawRows = parseImportFileRows(
                filename || 'upload.csv',
                String(req.body.fileContent || ''),
                headerMappings,
            );
        } else {
            return res.status(400).json({ message: 'Provide rows[] or fileContent for import preview.' });
        }

        const normalizedRows = normalizeImportRows(rawRows);
        const result = await validateImportRows(normalizedRows);
        res.json({
            filename: filename || null,
            ...result,
        });
    } catch (error: any) {
        if (error instanceof RequestValidationError) {
            return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: 'Failed to preview import', error: error.message });
    }
});

app.post('/api/assets/import/commit', inventoryAdminGuard, async (req: Request, res: Response) => {
    try {
        const filename = String(req.body?.filename || '').trim() || 'unknown.csv';
        const sourceName = String(req.body?.sourceName || '').trim() || filename;
        const inputRows = Array.isArray(req.body?.normalizedRows)
            ? (req.body.normalizedRows as Array<Record<string, any>>)
            : (Array.isArray(req.body?.rows) ? (req.body.rows as Array<Record<string, any>>) : []);
        if (!inputRows.length) {
            return res.status(400).json({ message: 'No rows provided for import commit.' });
        }

        const normalizedRows = normalizeImportRows(inputRows);
        const revalidated = await validateImportRows(normalizedRows);
        if (!revalidated.canImport) {
            return res.status(400).json({
                message: 'Import commit rejected due to validation errors.',
                ...revalidated,
            });
        }

        const importBatchId = `IMPORT-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
        const importTimestamp = new Date().toISOString();
        const warnings: string[] = [...revalidated.warnings];
        const errors: string[] = [];
        const skippedRows: Array<{ rowNumber: number; reason: string }> = [];
        const buildImportSpecifications = (extra: Record<string, any> = {}) => ({
            ...extra,
            importBatchId,
            importedFrom: sourceName,
            importedAt: importTimestamp,
            specVerificationStatus: 'import_verified',
            specVerificationAction: 'imported_from_file',
            specVerificationReviewedBy: 'inventory-import',
            specVerificationReviewedAt: importTimestamp,
            aiSpecEvidenceStatus: 'import_provided',
            aiSpecEvidenceReason: 'Provided directly by validated inventory import file.',
        });

        const result = await prisma.$transaction(async (tx) => {
            const createdAssets: string[] = [];
            const createdComponents: string[] = [];
            const createdSpareStockItems: string[] = [];
            const createdAccessoryLinks: string[] = [];
            const createdLicenseLinks: string[] = [];
            let createdParentAssets = 0;
            let createdAccessoryAssets = 0;
            let createdLicenseAssets = 0;
            const parentTagToCustomId = new Map<string, string>();
            const parentRows = revalidated.normalizedRows.filter((row) => row.recordType === 'parent_asset');

            const parentTags = Array.from(new Set(
                revalidated.normalizedRows
                    .map((row) => String(row.parentAssetTag || '').trim())
                    .filter(Boolean)
            ));
            if (parentTags.length) {
                const existingParents = await tx.asset.findMany({
                    where: {
                        OR: parentTags.map((tag) => ({
                            assetTag: { equals: tag }
                        })),
                    },
                    select: { customId: true, assetTag: true },
                    take: 500,
                });
                existingParents.forEach((entry) => {
                    const key = String(entry.assetTag || '').trim().toLowerCase();
                    if (key) parentTagToCustomId.set(key, entry.customId);
                });
            }

            for (const row of parentRows) {
                const qty = Number.isFinite(Number(row.quantity)) && Number(row.quantity) > 0
                    ? Math.trunc(Number(row.quantity))
                    : 1;
                const baseId = normalizeSerialValue(row.assetTag) || `IMPORTED-${Date.now()}-${row.rowNumber}`;
                const unitIds = buildUnitAssetIds(baseId, qty);
                const firstUnit = unitIds[0];
                const locationResolution = resolveAssetLocationForStorage(row.location || 'Central Warehouse');
                for (let unitIdx = 0; unitIdx < unitIds.length; unitIdx += 1) {
                    const unitId = unitIds[unitIdx];
                    const created = await tx.asset.create({
                        data: {
                            customId: unitId,
                            name: row.assetName,
                            type: mapToAssetType(row.assetType || row.componentType || 'electronics'),
                            status: mapToAssetStatus(row.status || 'active'),
                            lifecycleStatus: mapToLifecycleStatus(row.lifecycleStatus || 'in_stock'),
                            category: mapToAssetCategory(row.category || 'asset'),
                            value: row.purchaseCost || 0,
                            quantity: 1,
                            assignedUser: normalizeSerialValue(row.assignedTo),
                            serialNumber: unitIdx === 0 ? normalizeSerialValue(row.serialNumber) : null,
                            assetTag: unitIdx === 0 ? normalizeSerialValue(row.assetTag) : null,
                            manufacturerPartNumber: normalizeSerialValue(row.manufacturerPartNumber),
                            location: locationResolution.location,
                            department: mapToAssetDepartment(row.department || 'Unassigned'),
                            assignedToName: normalizeSerialValue(row.assignedTo),
                            custodyStatus: normalizeSerialValue(row.assignedTo) ? 'CHECKED_OUT' : 'UNASSIGNED',
                            purchaseDate: parseOptionalDateInput(row.purchaseDate),
                            vendor: normalizeSerialValue(row.vendor),
                            purchaseCost: row.purchaseCost,
                            warrantyStartDate: parseOptionalDateInput(row.warrantyStartDate),
                            warrantyEndDate: parseOptionalDateInput(row.warrantyEndDate),
                            specifications: buildTelemetryDefaultsForAsset({
                                type: row.assetType || row.componentType || 'electronics',
                                category: mapToAssetCategory(row.category || 'asset'),
                                name: row.assetName,
                                location: row.location || 'Central Warehouse',
                                existingSpecs: buildImportSpecifications({
                                    brand: row.brand || undefined,
                                    version: row.model || undefined,
                                    mapLocationHint: locationResolution.mapLocationHint || undefined,
                                    autoComponentsFromSpecs: false,
                                }),
                            }),
                        }
                    });
                    createdAssets.push(created.customId);
                    createdParentAssets += 1;
                    await tx.assetHistory.create({
                        data: {
                            assetId: created.customId,
                            event: 'Imported',
                            details: `Imported from file: ${sourceName}`,
                        }
                    });
                    await tx.assetLifecycleEvent.create({
                        data: {
                            assetId: created.customId,
                            eventType: 'asset_imported',
                            newValue: {
                                importBatchId,
                                filename: sourceName,
                                rowNumber: row.rowNumber,
                            },
                            reason: 'bulk_import',
                            notes: `Imported from file: ${sourceName}`,
                            actor: 'inventory-import',
                        }
                    });
                }
                if (row.assetTag) {
                    parentTagToCustomId.set(row.assetTag.toLowerCase(), firstUnit);
                }
            }

            const importOrderWeight: Record<ImportRecordType, number> = {
                parent_asset: 0,
                embedded_component: 1,
                component_asset: 1,
                accessory: 2,
                license: 3,
                consumable: 4,
                spare_stock: 5,
            };

            const nonParentRows = revalidated.normalizedRows
                .filter((row) => row.recordType && row.recordType !== 'parent_asset')
                .sort((a, b) => {
                    const aWeight = importOrderWeight[(a.recordType as ImportRecordType)] ?? 99;
                    const bWeight = importOrderWeight[(b.recordType as ImportRecordType)] ?? 99;
                    if (aWeight !== bWeight) return aWeight - bWeight;
                    return a.rowNumber - b.rowNumber;
                });

            for (const row of nonParentRows) {
                try {
                    if (row.recordType === 'embedded_component') {
                        const componentTypeValue = row.componentType || resolveImportAliasToken(row.assetType, IMPORT_COMPONENT_TYPE_ALIAS_MAP) || 'component';
                        const parentId = parentTagToCustomId.get(String(row.parentAssetTag || '').toLowerCase());
                        if (!parentId) {
                            skippedRows.push({ rowNumber: row.rowNumber, reason: `Parent not found for tag ${row.parentAssetTag}` });
                            continue;
                        }
                        const parentAssetRef = await tx.asset.findUnique({
                            where: { customId: parentId },
                            select: { customId: true, name: true, assetTag: true, location: true, department: true, specifications: true },
                        });
                        if (!parentAssetRef) {
                            skippedRows.push({ rowNumber: row.rowNumber, reason: `Parent asset ${parentId} was not found.` });
                            continue;
                        }

                        const componentSerial = normalizeSerialValue(row.serialNumber);
                        const componentTag = normalizeSerialValue(row.assetTag);
                        const potentialChildFilters: Prisma.AssetWhereInput[] = [];
                        if (componentTag) potentialChildFilters.push({ assetTag: componentTag });
                        if (componentSerial) potentialChildFilters.push({ serialNumber: componentSerial });

                        let childAsset: Asset | null = null;
                        if (potentialChildFilters.length > 0) {
                            childAsset = await tx.asset.findFirst({
                                where: { OR: potentialChildFilters },
                                orderBy: { createdAt: 'desc' },
                            });
                        }
                        if (!childAsset) {
                            const generatedCustomId = componentTag || await generateComponentAssetCustomId(parentId, componentTypeValue);
                            childAsset = await tx.asset.create({
                                data: {
                                    customId: generatedCustomId,
                                    name: row.assetName,
                                    type: mapToAssetType(row.assetType || componentTypeValue || 'electronics'),
                                    status: 'ACTIVE',
                                    lifecycleStatus: 'IN_USE',
                                    category: 'COMPONENT',
                                    value: row.purchaseCost || 0,
                                    quantity: 1,
                                    serialNumber: componentSerial,
                                    assetTag: componentTag,
                                    manufacturerPartNumber: normalizeSerialValue(row.manufacturerPartNumber),
                                    location: parentAssetRef.location,
                                    department: parentAssetRef.department,
                                    custodyStatus: 'UNASSIGNED',
                                    purchaseDate: parseOptionalDateInput(row.purchaseDate),
                                    vendor: normalizeSerialValue(row.vendor),
                                    purchaseCost: row.purchaseCost,
                                    warrantyStartDate: parseOptionalDateInput(row.warrantyStartDate),
                                    warrantyEndDate: parseOptionalDateInput(row.warrantyEndDate),
                                    specifications: buildImportSpecifications({
                                        brand: row.brand || undefined,
                                        version: row.model || undefined,
                                        installedInAssetId: parentAssetRef.customId,
                                        installedInAssetName: parentAssetRef.name,
                                        installedInAssetTag: parentAssetRef.assetTag || null,
                                        mapLocationHint: normalizeSerialValue((parentAssetRef.specifications as Record<string, any>)?.mapLocationHint) || undefined,
                                        componentType: componentTypeValue,
                                    }),
                                }
                            });
                            createdAssets.push(childAsset.customId);
                        } else {
                            const existingChildSpecs = ((childAsset.specifications as Record<string, any>) || {});
                            childAsset = await tx.asset.update({
                                where: { customId: childAsset.customId },
                                data: {
                                    category: 'COMPONENT',
                                    lifecycleStatus: 'IN_USE',
                                    status: 'ACTIVE',
                                    serialNumber: componentSerial || childAsset.serialNumber,
                                    assetTag: componentTag || childAsset.assetTag,
                                    manufacturerPartNumber: normalizeSerialValue(row.manufacturerPartNumber) || childAsset.manufacturerPartNumber,
                                    location: parentAssetRef.location,
                                    department: parentAssetRef.department,
                                    specifications: buildImportSpecifications({
                                        ...existingChildSpecs,
                                        installedInAssetId: parentAssetRef.customId,
                                        installedInAssetName: parentAssetRef.name,
                                        installedInAssetTag: parentAssetRef.assetTag || null,
                                        mapLocationHint: normalizeSerialValue((parentAssetRef.specifications as Record<string, any>)?.mapLocationHint) || undefined,
                                        componentType: componentTypeValue,
                                    }),
                                }
                            });
                        }

                        const component = await tx.assetComponent.create({
                            data: {
                                parentAssetId: parentId,
                                childAssetId: childAsset.customId,
                                componentName: row.assetName,
                                componentType: componentTypeValue,
                                brand: normalizeSerialValue(row.brand),
                                model: normalizeSerialValue(row.model),
                                serialNumber: componentSerial,
                                partNumber: normalizeSerialValue(row.manufacturerPartNumber),
                                status: normalizeComponentStatus(row.status, 'installed'),
                                condition: normalizeSerialValue(row.condition),
                                installedAt: new Date(),
                                reason: `Imported from file: ${sourceName}`,
                                notes: normalizeSerialValue(row.notes),
                            },
                        });
                        createdComponents.push(component.id);
                        await tx.assetHistory.create({
                            data: {
                                assetId: parentId,
                                event: 'Component Imported',
                                details: `Imported component ${row.assetName} from file: ${sourceName}`,
                            }
                        });
                        await tx.assetLifecycleEvent.create({
                            data: {
                                assetId: parentId,
                                componentId: component.id,
                                eventType: 'component_imported',
                                newValue: {
                                    importBatchId,
                                    filename: sourceName,
                                    rowNumber: row.rowNumber,
                                    componentName: row.assetName,
                                    childAssetId: childAsset.customId,
                                },
                                reason: 'bulk_import',
                                actor: 'inventory-import',
                            }
                        });
                        continue;
                    }

                    if (row.recordType === 'component_asset') {
                        const componentTypeValue = row.componentType || resolveImportAliasToken(row.assetType, IMPORT_COMPONENT_TYPE_ALIAS_MAP) || 'component';
                        const parentId = row.parentAssetTag
                            ? parentTagToCustomId.get(String(row.parentAssetTag || '').toLowerCase()) || null
                            : null;
                        if (row.parentAssetTag && !parentId) {
                            skippedRows.push({ rowNumber: row.rowNumber, reason: `Parent not found for tag ${row.parentAssetTag}` });
                            continue;
                        }
                        const parentAssetRef = parentId
                            ? await tx.asset.findUnique({
                                where: { customId: parentId },
                                select: { customId: true, name: true, assetTag: true, location: true, department: true, specifications: true },
                            })
                            : null;
                        if (row.parentAssetTag && !parentAssetRef) {
                            skippedRows.push({ rowNumber: row.rowNumber, reason: `Parent asset ${row.parentAssetTag} was not found.` });
                            continue;
                        }
                        const fallbackLocation = parentAssetRef?.location || 'Central Warehouse';
                        const locationResolution = resolveAssetLocationForStorage(row.location || fallbackLocation);
                        const customId = normalizeSerialValue(row.assetTag) || `IMPORTED-COMP-${Date.now()}-${row.rowNumber}`;
                        const child = await tx.asset.create({
                            data: {
                                customId,
                                name: row.assetName,
                                type: mapToAssetType(row.assetType || componentTypeValue || 'electronics'),
                                status: mapToAssetStatus(row.status || 'active'),
                                lifecycleStatus: parentId ? 'IN_USE' : mapToLifecycleStatus(row.lifecycleStatus || 'in_stock'),
                                category: 'COMPONENT',
                                value: row.purchaseCost || 0,
                                quantity: 1,
                                serialNumber: normalizeSerialValue(row.serialNumber),
                                assetTag: normalizeSerialValue(row.assetTag),
                                manufacturerPartNumber: normalizeSerialValue(row.manufacturerPartNumber),
                                location: locationResolution.location,
                                department: parentAssetRef?.department || mapToAssetDepartment(row.department || 'Unassigned'),
                                assignedToName: normalizeSerialValue(row.assignedTo),
                                custodyStatus: normalizeSerialValue(row.assignedTo) ? 'CHECKED_OUT' : 'UNASSIGNED',
                                purchaseDate: parseOptionalDateInput(row.purchaseDate),
                                vendor: normalizeSerialValue(row.vendor),
                                purchaseCost: row.purchaseCost,
                                warrantyStartDate: parseOptionalDateInput(row.warrantyStartDate),
                                warrantyEndDate: parseOptionalDateInput(row.warrantyEndDate),
                                specifications: buildImportSpecifications({
                                    brand: row.brand || undefined,
                                    version: row.model || undefined,
                                    ...(parentId ? {
                                        installedInAssetId: parentId,
                                        installedInAssetTag: normalizeSerialValue(row.parentAssetTag),
                                        installedInAssetName: parentAssetRef?.name || undefined,
                                        mapLocationHint: normalizeSerialValue((parentAssetRef?.specifications as Record<string, any>)?.mapLocationHint) || locationResolution.mapLocationHint || undefined,
                                    } : {}),
                                    ...(parentId ? {} : { mapLocationHint: locationResolution.mapLocationHint || undefined }),
                                    componentType: componentTypeValue,
                                }),
                            }
                        });
                        createdAssets.push(child.customId);
                        await tx.assetHistory.create({
                            data: {
                                assetId: child.customId,
                                event: 'Imported',
                                details: `Imported from file: ${sourceName}`,
                            }
                        });
                        await tx.assetLifecycleEvent.create({
                            data: {
                                assetId: child.customId,
                                eventType: 'asset_imported',
                                newValue: {
                                    importBatchId,
                                    filename: sourceName,
                                    rowNumber: row.rowNumber,
                                },
                                reason: 'bulk_import',
                                actor: 'inventory-import',
                            }
                        });

                        if (parentId) {
                            const componentLink = await tx.assetComponent.create({
                                data: {
                                    parentAssetId: parentId,
                                    childAssetId: child.customId,
                                    componentName: row.assetName,
                                    componentType: componentTypeValue,
                                    brand: normalizeSerialValue(row.brand),
                                    model: normalizeSerialValue(row.model),
                                    serialNumber: normalizeSerialValue(row.serialNumber),
                                    partNumber: normalizeSerialValue(row.manufacturerPartNumber),
                                    status: normalizeComponentStatus(row.status, 'installed'),
                                    condition: normalizeSerialValue(row.condition),
                                    installedAt: new Date(),
                                    reason: `Imported from file: ${sourceName}`,
                                    notes: normalizeSerialValue(row.notes),
                                }
                            });
                            createdComponents.push(componentLink.id);
                            await tx.assetLifecycleEvent.create({
                                data: {
                                    assetId: parentId,
                                    componentId: componentLink.id,
                                    eventType: 'component_imported_linked_asset',
                                    newValue: {
                                        importBatchId,
                                        childAssetId: child.customId,
                                        filename: sourceName,
                                    },
                                    reason: 'bulk_import',
                                    actor: 'inventory-import',
                                }
                            });
                        }
                        continue;
                    }

                    if (row.recordType === 'spare_stock') {
                        const qty = Number.isFinite(Number(row.quantity)) ? Math.max(0, Math.trunc(Number(row.quantity))) : 0;
                        const existingStock = await tx.spareStockItem.findFirst({
                            where: {
                                OR: [
                                    ...(row.manufacturerPartNumber ? [{ partNumber: row.manufacturerPartNumber }] : []),
                                    { AND: [{ partName: row.assetName }, { componentType: row.componentType || 'component' }] }
                                ]
                            },
                            orderBy: { updatedAt: 'desc' },
                        });
                        if (existingStock) {
                            const updated = await tx.spareStockItem.update({
                                where: { id: existingStock.id },
                                data: {
                                    quantityAvailable: existingStock.quantityAvailable + qty,
                                    minimumStockLevel: row.minimumStockLevel !== null ? row.minimumStockLevel : existingStock.minimumStockLevel,
                                    reorderPoint: row.reorderPoint !== null ? row.reorderPoint : existingStock.reorderPoint,
                                    location: normalizeSerialValue(row.location) || existingStock.location,
                                    vendor: normalizeSerialValue(row.vendor) || existingStock.vendor,
                                    brand: normalizeSerialValue(row.brand) || existingStock.brand,
                                    model: normalizeSerialValue(row.model) || existingStock.model,
                                    notes: normalizeSerialValue(row.notes) || existingStock.notes,
                                }
                            });
                            createdSpareStockItems.push(updated.id);
                        } else {
                            const created = await tx.spareStockItem.create({
                                data: {
                                    partName: row.assetName,
                                    componentType: row.componentType || 'component',
                                    category: normalizeSerialValue(row.category) || 'spare_part',
                                    brand: normalizeSerialValue(row.brand),
                                    model: normalizeSerialValue(row.model),
                                    partNumber: normalizeSerialValue(row.manufacturerPartNumber),
                                    quantityAvailable: qty,
                                    minimumStockLevel: row.minimumStockLevel !== null ? row.minimumStockLevel : 0,
                                    reorderPoint: row.reorderPoint,
                                    location: normalizeSerialValue(row.location),
                                    vendor: normalizeSerialValue(row.vendor),
                                    unitCost: row.purchaseCost,
                                    compatibleBrandsModels: row.notes ? [row.notes] : [],
                                    notes: normalizeSerialValue(row.notes),
                                }
                            });
                            createdSpareStockItems.push(created.id);
                        }
                        continue;
                    }

                    if (row.recordType === 'accessory' || row.recordType === 'consumable' || row.recordType === 'license') {
                        const shouldLinkToParent = Boolean(row.parentAssetTag) && (row.recordType === 'accessory' || row.recordType === 'license');
                        const parentId = shouldLinkToParent
                            ? parentTagToCustomId.get(String(row.parentAssetTag || '').toLowerCase()) || null
                            : null;
                        if (shouldLinkToParent && !parentId) {
                            skippedRows.push({ rowNumber: row.rowNumber, reason: 'Parent asset not found for related item row.' });
                            continue;
                        }
                        const parentAssetRef = parentId
                            ? await tx.asset.findUnique({
                                where: { customId: parentId },
                                select: {
                                    customId: true,
                                    name: true,
                                    assetTag: true,
                                    location: true,
                                    department: true,
                                    specifications: true,
                                },
                            })
                            : null;
                        if (shouldLinkToParent && !parentAssetRef) {
                            skippedRows.push({ rowNumber: row.rowNumber, reason: 'Parent asset not found for related item row.' });
                            continue;
                        }
                        const qty = Number.isFinite(Number(row.quantity)) && Number(row.quantity) > 0
                            ? Math.trunc(Number(row.quantity))
                            : 1;
                        const baseId = normalizeSerialValue(row.assetTag) || `IMPORTED-${Date.now()}-${row.rowNumber}`;
                        const unitIds = buildUnitAssetIds(baseId, qty);
                        const fallbackLocation = parentAssetRef?.location || 'Central Warehouse';
                        const locationResolution = resolveAssetLocationForStorage(row.location || fallbackLocation);
                        for (let unitIdx = 0; unitIdx < unitIds.length; unitIdx += 1) {
                            const unitId = unitIds[unitIdx];
                            const parentMapLocationHint = normalizeSerialValue((parentAssetRef?.specifications as Record<string, any>)?.mapLocationHint);
                            const relationshipSpecs = shouldLinkToParent
                                ? (row.recordType === 'license'
                                    ? {
                                        assignedToAssetId: parentAssetRef?.customId || null,
                                        assignedToAssetTag: parentAssetRef?.assetTag || null,
                                        assignedToAssetName: parentAssetRef?.name || null,
                                        licensedToAssetId: parentAssetRef?.customId || null,
                                        licensedToAssetTag: parentAssetRef?.assetTag || null,
                                        licensedToAssetName: parentAssetRef?.name || null,
                                    }
                                    : {
                                        assignedToAssetId: parentAssetRef?.customId || null,
                                        assignedToAssetTag: parentAssetRef?.assetTag || null,
                                        assignedToAssetName: parentAssetRef?.name || null,
                                        usedWithAssetId: parentAssetRef?.customId || null,
                                        usedWithAssetTag: parentAssetRef?.assetTag || null,
                                        usedWithAssetName: parentAssetRef?.name || null,
                                    })
                                : {};
                            const created = await tx.asset.create({
                                data: {
                                    customId: unitId,
                                    name: row.assetName,
                                    type: mapToAssetType(row.assetType || 'electronics'),
                                    status: mapToAssetStatus(row.status || 'active'),
                                    lifecycleStatus: mapToLifecycleStatus(
                                        row.lifecycleStatus
                                        || (shouldLinkToParent ? 'assigned' : 'in_stock')
                                    ),
                                    category: mapToAssetCategory(row.recordType),
                                    value: row.purchaseCost || 0,
                                    quantity: 1,
                                    serialNumber: unitIdx === 0 ? normalizeSerialValue(row.serialNumber) : null,
                                    assetTag: unitIdx === 0 ? normalizeSerialValue(row.assetTag) : null,
                                    manufacturerPartNumber: normalizeSerialValue(row.manufacturerPartNumber),
                                    location: locationResolution.location,
                                    department: parentAssetRef?.department || mapToAssetDepartment(row.department || 'Unassigned'),
                                    assignedToName: normalizeSerialValue(row.assignedTo),
                                    custodyStatus: normalizeSerialValue(row.assignedTo) ? 'CHECKED_OUT' : 'UNASSIGNED',
                                    purchaseDate: parseOptionalDateInput(row.purchaseDate),
                                    vendor: normalizeSerialValue(row.vendor),
                                    purchaseCost: row.purchaseCost,
                                    warrantyStartDate: parseOptionalDateInput(row.warrantyStartDate),
                                    warrantyEndDate: parseOptionalDateInput(row.warrantyEndDate),
                                    specifications: buildTelemetryDefaultsForAsset({
                                        type: row.assetType || 'electronics',
                                        category: mapToAssetCategory(row.recordType),
                                        name: row.assetName,
                                        location: row.location || fallbackLocation,
                                        existingSpecs: buildImportSpecifications({
                                            brand: row.brand || undefined,
                                            version: row.model || undefined,
                                            mapLocationHint: parentMapLocationHint || locationResolution.mapLocationHint || undefined,
                                            ...relationshipSpecs,
                                        }),
                                    }),
                                }
                            });
                            createdAssets.push(created.customId);
                            if (row.recordType === 'accessory') createdAccessoryAssets += 1;
                            if (row.recordType === 'license') createdLicenseAssets += 1;
                            await tx.assetHistory.create({
                                data: {
                                    assetId: created.customId,
                                    event: 'Imported',
                                    details: `Imported from file: ${sourceName}`,
                                }
                            });
                            await tx.assetLifecycleEvent.create({
                                data: {
                                    assetId: created.customId,
                                    eventType: 'asset_imported',
                                    newValue: {
                                        importBatchId,
                                        filename: sourceName,
                                        rowNumber: row.rowNumber,
                                    },
                                    reason: 'bulk_import',
                                    actor: 'inventory-import',
                                }
                            });

                            if (shouldLinkToParent && parentAssetRef) {
                                const relationshipType = row.recordType === 'license' ? 'licensed_to' : 'assigned_to';
                                const relationship = await tx.assetRelationship.create({
                                    data: {
                                        assetId: parentAssetRef.customId,
                                        relatedAssetId: created.customId,
                                        relationshipType,
                                        notes: `Imported from file: ${sourceName}`,
                                    }
                                });
                                if (row.recordType === 'license') {
                                    createdLicenseLinks.push(relationship.id);
                                } else {
                                    createdAccessoryLinks.push(relationship.id);
                                }

                                const parentEventType = row.recordType === 'license'
                                    ? 'license_imported_assigned'
                                    : 'accessory_imported_assigned';
                                const parentEventLabel = row.recordType === 'license'
                                    ? 'License Imported'
                                    : 'Accessory Imported';
                                await tx.assetHistory.create({
                                    data: {
                                        assetId: parentAssetRef.customId,
                                        event: parentEventLabel,
                                        details: `${parentEventLabel} and linked: ${created.name} (${created.customId}) from file: ${sourceName}`,
                                    }
                                });
                                await tx.assetLifecycleEvent.create({
                                    data: {
                                        assetId: parentAssetRef.customId,
                                        eventType: parentEventType,
                                        newValue: {
                                            importBatchId,
                                            filename: sourceName,
                                            rowNumber: row.rowNumber,
                                            relationshipType,
                                            childAssetId: created.customId,
                                            childAssetName: created.name,
                                        },
                                        reason: 'bulk_import',
                                        actor: 'inventory-import',
                                    }
                                });
                            }
                        }
                        continue;
                    }

                    skippedRows.push({ rowNumber: row.rowNumber, reason: `Unsupported record type (${row.recordType})` });
                } catch (rowError: any) {
                    errors.push(`Row ${row.rowNumber}: ${rowError?.message || rowError}`);
                }
            }

            return {
                createdAssets,
                createdComponents,
                createdSpareStockItems,
                createdAccessoryLinks,
                createdLicenseLinks,
                createdParentAssets,
                createdAccessoryAssets,
                createdLicenseAssets,
            };
        });

        const success = errors.length === 0;
        res.json({
            success,
            importBatchId,
            createdAssets: result.createdAssets.length,
            createdComponents: result.createdComponents.length,
            createdSpareStockItems: result.createdSpareStockItems.length,
            createdAccessoryLinks: result.createdAccessoryLinks.length,
            createdLicenseLinks: result.createdLicenseLinks.length,
            createdParentAssets: result.createdParentAssets,
            createdAccessoryAssets: result.createdAccessoryAssets,
            createdLicenseAssets: result.createdLicenseAssets,
            skippedRows,
            errors,
            warnings,
        });
    } catch (error: any) {
        if (error instanceof RequestValidationError) {
            return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: 'Failed to commit import', error: error.message });
    }
});

app.post('/api/assets/import/ai-map-columns', inventoryAdminGuard, async (req: Request, res: Response) => {
    try {
        const expectedFields = Array.isArray(req.body?.expectedFields) && req.body.expectedFields.length
            ? req.body.expectedFields.map((entry: unknown) => String(entry || '').trim()).filter(Boolean)
            : [
                'Record Type', 'Asset Name', 'Category', 'Asset Type', 'Brand', 'Model',
                'Serial Number', 'Asset Tag', 'Manufacturer Part Number', 'Location', 'Department',
                'Status', 'Lifecycle Status', 'Parent Asset Tag', 'Component Type', 'Condition',
                'Quantity', 'Minimum Stock Level', 'Reorder Point', 'Vendor', 'Purchase Date',
                'Warranty Start Date', 'Warranty End Date', 'Purchase Cost', 'Assigned To', 'Notes',
            ];
        let headers: string[] = [];
        let sampleRows: Record<string, string>[] = [];
        const filename = String(req.body?.filename || '').trim() || 'upload.csv';
        const fileContent = String(req.body?.fileContent || '');
        if (Array.isArray(req.body?.headers) && req.body.headers.length) {
            headers = req.body.headers.map((entry: unknown) => String(entry || '').trim()).filter(Boolean);
            sampleRows = Array.isArray(req.body?.sampleRows) ? req.body.sampleRows.slice(0, 8) : [];
        } else if (fileContent.trim()) {
            const parsed = extractHeadersAndSampleRowsFromCsv(fileContent);
            headers = parsed.headers;
            sampleRows = parsed.sampleRows;
        } else {
            return res.status(400).json({ message: 'Provide headers/sampleRows or fileContent.' });
        }

        const deterministic = deterministicImportColumnMapping({ headers, expectedFields });
        const ai = await callInventoryAiHelper('/map-import-columns', {
            filename,
            headers,
            sampleRows,
            expectedFields,
            deterministicMappings: deterministic.mappings,
        }, 9_000);
        const aiMappings = Array.isArray(ai?.mappings)
            ? ai.mappings.map((row: any) => ({
                sourceColumn: String(row?.sourceColumn || '').trim(),
                targetColumn: String(row?.targetColumn || '').trim(),
                confidence: Number(row?.confidence || 0.6),
                reason: String(row?.reason || 'AI-assisted mapping suggestion'),
            })).filter((row: any) => row.sourceColumn && row.targetColumn)
            : [];

        const mergedMap = new Map<string, { sourceColumn: string; targetColumn: string; confidence: number; reason: string }>();
        deterministic.mappings.forEach((row) => mergedMap.set(normalizeImportHeader(row.sourceColumn), row));
        aiMappings.forEach((row: { sourceColumn: string; targetColumn: string; confidence: number; reason: string }) => {
            const key = normalizeImportHeader(row.sourceColumn);
            if (!mergedMap.has(key)) {
                mergedMap.set(key, row);
            } else if ((mergedMap.get(key)?.confidence || 0) < row.confidence) {
                mergedMap.set(key, row);
            }
        });

        const mappedSourceKeys = new Set(Array.from(mergedMap.values()).map((row) => normalizeImportHeader(row.sourceColumn)));
        const unmappedColumns = headers.filter((header) => !mappedSourceKeys.has(normalizeImportHeader(header)));

        return res.json({
            mappings: Array.from(mergedMap.values()),
            unmappedColumns,
            warnings: Array.from(new Set([
                ...(deterministic.warnings || []),
                ...(Array.isArray(ai?.warnings) ? ai.warnings.map((entry: unknown) => String(entry || '').trim()).filter(Boolean) : []),
            ])),
            fallbackUsed: !ai,
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to map import columns', error: error.message });
    }
});

app.post('/api/assets/import/pdf-preview', inventoryAdminGuard, async (req: Request, res: Response) => {
    try {
        const filename = String(req.body?.filename || '').trim() || 'document.txt';
        const inputText = String(req.body?.documentText || req.body?.fileContent || '').trim();
        if (!inputText) {
            return res.status(400).json({
                message: 'No document text provided. Paste extracted text or upload text-based content.',
            });
        }
        let extractedRows = extractCandidateRowsFromDocumentText(inputText);
        const ai = await callInventoryAiHelper('/extract-assets-from-document-text', {
            filename,
            documentText: inputText.slice(0, 50000),
            deterministicRows: extractedRows.slice(0, 120),
        }, 12_000);
        if (Array.isArray(ai?.extracted_rows) && ai.extracted_rows.length) {
            const aiRows = ai.extracted_rows
                .slice(0, 300)
                .map((row: any) => ({
                    recordType: normalizeImportRecordType(row?.recordType || row?.record_type || 'parent_asset') || 'parent_asset',
                    assetName: String(row?.assetName || row?.asset_name || '').trim(),
                    category: String(row?.category || '').trim(),
                    assetType: String(row?.assetType || row?.asset_type || '').trim(),
                    brand: String(row?.brand || '').trim(),
                    model: String(row?.model || '').trim(),
                    serialNumber: String(row?.serialNumber || row?.serial_number || '').trim(),
                    assetTag: String(row?.assetTag || row?.asset_tag || '').trim(),
                    manufacturerPartNumber: String(row?.manufacturerPartNumber || row?.manufacturer_part_number || '').trim(),
                    location: String(row?.location || '').trim(),
                    department: String(row?.department || '').trim(),
                    status: String(row?.status || '').trim(),
                    lifecycleStatus: String(row?.lifecycleStatus || row?.lifecycle_status || '').trim(),
                    parentAssetTag: String(row?.parentAssetTag || row?.parent_asset_tag || '').trim(),
                    componentType: String(row?.componentType || row?.component_type || '').trim(),
                    condition: String(row?.condition || '').trim(),
                    quantity: parseOptionalIntegerInput(row?.quantity) ?? 1,
                    minimumStockLevel: parseOptionalIntegerInput(row?.minimumStockLevel || row?.minimum_stock_level),
                    reorderPoint: parseOptionalIntegerInput(row?.reorderPoint || row?.reorder_point),
                    vendor: String(row?.vendor || '').trim(),
                    purchaseDate: String(row?.purchaseDate || row?.purchase_date || '').trim(),
                    warrantyStartDate: String(row?.warrantyStartDate || row?.warranty_start_date || '').trim(),
                    warrantyEndDate: String(row?.warrantyEndDate || row?.warranty_end_date || '').trim(),
                    purchaseCost: parseOptionalNumberInput(row?.purchaseCost || row?.purchase_cost),
                    assignedTo: String(row?.assignedTo || row?.assigned_to || '').trim(),
                    notes: String(row?.notes || '').trim(),
                }))
                .filter((row: Record<string, any>) => row.assetName || row.serialNumber || row.assetTag);
            if (aiRows.length) extractedRows = aiRows;
        }

        const normalizedRows = normalizeImportRows(extractedRows);
        const preview = await validateImportRows(normalizedRows);
        return res.json({
            filename,
            sourceDocumentSummary: String(ai?.source_document_summary || `Parsed ${extractedRows.length} candidate row(s) from document text.`),
            confidence: Number(ai?.confidence || (preview.validRows > 0 ? 0.72 : 0.48)),
            warnings: Array.from(new Set<string>([
                ...(preview.warnings || []),
                ...(Array.isArray(ai?.warnings) ? ai.warnings.map((entry: unknown) => String(entry || '').trim()).filter(Boolean) : []),
            ])),
            missingFields: Array.isArray(ai?.missing_fields) ? ai.missing_fields : [],
            extractedRows: preview.normalizedRows,
            normalizedRows: preview.normalizedRows,
            totalRows: preview.totalRows,
            validRows: preview.validRows,
            invalidRows: preview.invalidRows,
            errors: preview.errors,
            canImport: Boolean(preview.canImport),
            fallbackUsed: !ai,
            limitations: 'PDF/OCR extraction is limited in this pass. Review all rows before commit.',
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to build PDF/document import preview', error: error.message });
    }
});

app.post('/api/inventory/ai/assistant', inventoryReadGuard, async (req: Request, res: Response) => {
    try {
        const query = String(req.body?.query || '').trim();
        if (!query) return res.status(400).json({ message: 'query is required' });
        const context = (req.body?.context && typeof req.body.context === 'object') ? req.body.context : {};
        const fullSnapshot = await buildInventoryAiSnapshot();
        const scoped = resolveInventoryAiScopeFromContext(fullSnapshot, context as Record<string, any>, query);
        const scopedSnapshot = scoped.snapshot;
        const dataScope = scoped.dataScope;
        const deterministicRaw = deterministicAssistantAnswer(scopedSnapshot, query);
        const deterministic = applyAssistantQueryFilters(deterministicRaw, scopedSnapshot, query, dataScope);
        const deterministicConfidence = deriveAssistantConfidence({
            intent: deterministic.intent,
            dataScope,
            scannedCount: deterministic.scannedCount,
            matchedCount: deterministic.matchedItems.length,
            supported: deterministic.supported,
            partialFailure: deterministic.partialFailure,
        });
        const llmPayload = buildAssistantLlmInput(deterministic, query);
        const routedMeta = ASSISTANT_ROUTED_ACTION_BY_INTENT[String(deterministic.intent || '').toLowerCase()] || null;

        console.info(`[InventoryAI][assistant] query="${query.slice(0, 100)}" scope=${dataScope} llmAttempt=true`);
        const ai = await callInventoryAiHelper('/inventory-assistant', {
            query,
            deterministicResult: llmPayload,
            contextSummary: {
                assets: scopedSnapshot.assets.length,
                components: scopedSnapshot.components.length,
                maintenance: scopedSnapshot.maintenance.length,
                lifecycleEvents: scopedSnapshot.lifecycleEvents.length,
                spareStock: scopedSnapshot.spareStock.length,
                scope: dataScope,
            },
            recentMessages: Array.isArray(req.body?.recentMessages) ? req.body.recentMessages.slice(-8) : [],
        }, 20_000);
        const llmUsed = Boolean(ai?.llm_used);
        const fallbackUsed = !ai || !llmUsed;
        const llmStatus = ai
            ? String(ai?.llm_status || (llmUsed ? 'ready' : 'fallback'))
            : 'offline';
        const fallbackReason = String(ai?.fallback_reason || (fallbackUsed ? 'llm_unavailable_or_timeout' : '')).trim();
        const answer = String(ai?.answer || deterministic.answer || INVENTORY_AI_SUPPORTED_HINT);
        const suggestedActions = Array.isArray(ai?.suggested_actions)
            ? ai.suggested_actions.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 12)
            : deterministic.suggestedActions;
        const llmConfidence = String(ai?.confidence || '').trim().toLowerCase();
        const llmConfidenceLabel: 'low' | 'medium' | 'high' = llmConfidence === 'high'
            ? 'high'
            : llmConfidence === 'medium'
                ? 'medium'
                : 'low';
        const confidence: 'low' | 'medium' | 'high' = FACTUAL_ASSISTANT_INTENTS.has(String(deterministic.intent || '').toLowerCase())
            ? deterministicConfidence
            : (ai ? llmConfidenceLabel : deterministicConfidence);
        console.info(`[InventoryAI][assistant] llmUsed=${llmUsed} fallbackUsed=${fallbackUsed} llmStatus=${llmStatus}${fallbackReason ? ` reason=${fallbackReason}` : ''}`);
        return res.json({
            answer,
            matchedItems: deterministic.matchedItems,
            filtersUsed: deterministic.filtersUsed,
            confidence,
            missingData: Array.isArray(ai?.missing_data)
                ? ai.missing_data.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 24)
                : deterministic.missingData,
            suggestedActions,
            dataScope,
            intent: deterministic.intent,
            scannedCount: Number(deterministic.scannedCount || 0),
            matchedCount: deterministic.matchedItems.length,
            missingCount: typeof deterministic.missingCount === 'number' ? deterministic.missingCount : null,
            excludedCategories: Array.isArray(deterministic.excludedCategories) ? deterministic.excludedCategories : [],
            llmUsed,
            llmStatus,
            fallbackReason: fallbackReason || null,
            fallbackUsed,
            supported: deterministic.supported,
            routedAction: routedMeta?.action || null,
            routedEndpoint: routedMeta?.endpoint || null,
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to run inventory AI assistant', error: error.message });
    }
});

app.post('/api/inventory/ai/missing-data', inventoryReadGuard, async (_req: Request, res: Response) => {
    try {
        const snapshot = await buildInventoryAiSnapshot();
        const deterministic = computeMissingDataReport(snapshot);
        const ai = await callInventoryAiHelper('/detect-missing-inventory-data', {
            report: deterministic,
        }, 11_000);
        return res.json({
            totalIssues: deterministic.totalIssues,
            criticalIssues: deterministic.criticalIssues,
            warnings: deterministic.warnings,
            assetsWithIssues: deterministic.assetsWithIssues,
            recommendations: Array.isArray(ai?.recommendations)
                ? ai.recommendations.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 20)
                : deterministic.recommendations,
            confidence: String(ai?.confidence || deterministic.confidence),
            summary: String(ai?.summary || `Detected ${deterministic.totalIssues} data quality issue(s).`),
            fallbackUsed: !ai,
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to run missing-data detector', error: error.message });
    }
});

app.post('/api/inventory/ai/maintenance-recommendations', inventoryReadGuard, async (_req: Request, res: Response) => {
    try {
        const snapshot = await buildInventoryAiSnapshot();
        const recommendations = buildMaintenanceRecommendations(snapshot);
        const ai = await callInventoryAiHelper('/maintenance-recommendations', {
            recommendations,
        }, 11_000);
        return res.json({
            recommendations,
            summary: String(ai?.summary || (recommendations.length
                ? `Prepared ${recommendations.length} maintenance recommendation(s).`
                : 'Not enough maintenance/failure data to suggest actions.')),
            confidence: String(ai?.confidence || (recommendations.length ? 'medium' : 'low')),
            fallbackUsed: !ai,
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to generate maintenance recommendations', error: error.message });
    }
});

app.post('/api/inventory/ai/procurement-recommendations', inventoryReadGuard, async (_req: Request, res: Response) => {
    try {
        const snapshot = await buildInventoryAiSnapshot();
        const recommendedPurchases = buildProcurementRecommendations(snapshot);
        const ai = await callInventoryAiHelper('/procurement-recommendations', {
            recommendedPurchases,
        }, 11_000);
        return res.json({
            summary: String(ai?.summary || (recommendedPurchases.length
                ? `Prepared ${recommendedPurchases.length} procurement recommendation(s).`
                : 'No urgent procurement items detected from current stock thresholds.')),
            recommendedPurchases,
            missingData: Array.isArray(ai?.missing_data)
                ? ai.missing_data.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 20)
                : [],
            confidence: String(ai?.confidence || (recommendedPurchases.length ? 'medium' : 'low')),
            fallbackUsed: !ai,
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to generate procurement recommendations', error: error.message });
    }
});

app.post('/api/inventory/ai/duplicate-detection', inventoryReadGuard, async (_req: Request, res: Response) => {
    try {
        const snapshot = await buildInventoryAiSnapshot();
        const deterministic = buildDuplicateDetectionReport(snapshot);
        const ai = await callInventoryAiHelper('/explain-duplicate-assets', {
            duplicateGroups: deterministic.duplicateGroups.slice(0, 120),
            summary: deterministic.summary,
        }, 11_000);
        const embeddingProvider = String(process.env.EMBEDDING_PROVIDER || '').trim() || 'none';
        const embeddingModel = String(process.env.EMBEDDING_MODEL || '').trim() || 'n/a';
        return res.json({
            duplicateGroups: deterministic.duplicateGroups,
            summary: String(ai?.summary || deterministic.summary),
            embeddingSupport: {
                provider: embeddingProvider,
                model: embeddingModel,
                enabled: embeddingProvider.toLowerCase() === 'ollama' && Boolean(embeddingModel),
                used: false,
                note: 'Deterministic duplicate detection is active. Embedding similarity is optional and currently fallback-only.',
            },
            fallbackUsed: !ai,
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to run duplicate detection', error: error.message });
    }
});

app.post('/api/inventory/ai/search', inventoryReadGuard, async (req: Request, res: Response) => {
    try {
        const query = String(req.body?.query || '').trim();
        if (!query) return res.status(400).json({ message: 'query is required' });
        const snapshot = await buildInventoryAiSnapshot();
        const deterministic = deterministicNaturalLanguageSearch(snapshot, query);
        const ai = await callInventoryAiHelper('/natural-language-inventory-search', {
            query,
            interpretedFilters: deterministic.interpretedFilters,
            candidateResults: deterministic.results.slice(0, 80),
            fallbackAnswer: deterministic.answer,
        }, 11_000);
        return res.json({
            query,
            interpretedFilters: deterministic.interpretedFilters,
            results: deterministic.results,
            answer: String(ai?.answer || deterministic.answer),
            confidence: String(ai?.confidence || deterministic.confidence),
            fallbackUsed: !ai || deterministic.fallbackUsed,
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to run natural language inventory search', error: error.message });
    }
});

app.post('/api/inventory/ai/data-corrections', inventoryReadGuard, async (req: Request, res: Response) => {
    try {
        const context = (req.body?.context && typeof req.body.context === 'object') ? req.body.context : {};
        const fullSnapshot = await buildInventoryAiSnapshot();
        const scoped = resolveInventoryAiScopeFromContext(fullSnapshot, context, 'data corrections');
        const deterministic = buildDataCorrectionSuggestions(scoped.snapshot);
        const llmSuggestionContext = deterministic.suggestions.slice(0, 40).map((item) => ({
            assetId: item.assetId,
            assetName: item.assetName,
            issueType: item.issueType,
            severity: item.severity,
            suggestedValue: item.suggestedValue,
            reason: item.reason,
        }));
        const ai = await callInventoryAiHelper('/data-correction-suggestions', {
            summary: deterministic.summary,
            suggestions: llmSuggestionContext,
            countsBySeverity: deterministic.countsBySeverity,
            dataScope: scoped.dataScope,
        }, 22_000);
        return res.json({
            summary: String(ai?.summary || deterministic.summary),
            suggestions: deterministic.suggestions,
            countsBySeverity: deterministic.countsBySeverity,
            scannedCount: deterministic.scannedCount,
            matchedCount: deterministic.matchedCount,
            excludedCategories: deterministic.excludedCategories,
            dataScope: scoped.dataScope,
            evidence: {
                duplicateChecks: true,
                categoryTypeChecks: true,
                lifecycleChecks: true,
            },
            confidence: String(ai?.confidence || deterministic.confidence),
            missingData: Array.isArray(ai?.missing_data)
                ? ai.missing_data.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 24)
                : deterministic.missingData,
            suggestedActions: Array.isArray(ai?.suggested_actions)
                ? ai.suggested_actions.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 20)
                : ['Review critical suggestions first, then apply safe corrections with confirmation.'],
            fallbackUsed: !ai || !Boolean(ai?.llm_used),
            llmUsed: Boolean(ai?.llm_used),
            llmStatus: ai ? String(ai?.llm_status || (ai?.llm_used ? 'ready' : 'fallback')) : 'offline',
            fallbackReason: ai ? (ai?.fallback_reason || null) : 'llm_unavailable_or_timeout',
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to generate AI data correction suggestions', error: error.message });
    }
});

app.post('/api/inventory/ai/risk-score', inventoryReadGuard, async (req: Request, res: Response) => {
    try {
        const context = (req.body?.context && typeof req.body.context === 'object') ? req.body.context : {};
        const fullSnapshot = await buildInventoryAiSnapshot();
        const scoped = resolveInventoryAiScopeFromContext(fullSnapshot, context, String(req.body?.query || 'risk score'));
        const deterministic = buildAssetRiskScores(scoped.snapshot);
        const llmRiskContext = deterministic.rows.slice(0, 40).map((row) => ({
            assetId: row.assetId,
            assetName: row.assetName,
            riskLevel: row.riskLevel,
            riskScore: row.riskScore,
            reasons: row.reasons.slice(0, 4),
        }));
        const ai = await callInventoryAiHelper('/risk-score-explanation', {
            summary: deterministic.summary,
            riskScores: llmRiskContext,
            dataScope: scoped.dataScope,
            missingData: deterministic.missingData,
        }, 22_000);
        return res.json({
            summary: String(ai?.summary || deterministic.summary),
            riskScores: deterministic.rows,
            dataScope: scoped.dataScope,
            scannedCount: deterministic.scannedCount,
            matchedCount: deterministic.matchedCount,
            confidence: String(ai?.confidence || deterministic.confidence),
            missingData: Array.isArray(ai?.missing_data)
                ? ai.missing_data.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 24)
                : deterministic.missingData,
            suggestedActions: Array.isArray(ai?.suggested_actions)
                ? ai.suggested_actions.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 20)
                : ['Prioritize critical/high-risk assets for maintenance or replacement planning.'],
            fallbackUsed: !ai || !Boolean(ai?.llm_used),
            llmUsed: Boolean(ai?.llm_used),
            llmStatus: ai ? String(ai?.llm_status || (ai?.llm_used ? 'ready' : 'fallback')) : 'offline',
            fallbackReason: ai ? (ai?.fallback_reason || null) : 'llm_unavailable_or_timeout',
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to generate AI risk scores', error: error.message });
    }
});

app.post('/api/assets/:id/ai-risk-score', inventoryReadGuard, async (req: Request, res: Response) => {
    try {
        const assetId = String(req.params.id || '').trim();
        if (!assetId) return res.status(400).json({ message: 'asset id is required' });
        const fullSnapshot = await buildInventoryAiSnapshot();
        const deterministic = buildAssetRiskScores(fullSnapshot, { assetIds: [assetId] });
        if (!deterministic.rows.length) return res.status(404).json({ message: 'Asset not found for risk scoring' });
        const ai = await callInventoryAiHelper('/risk-score-explanation', {
            summary: deterministic.summary,
            riskScores: deterministic.rows.slice(0, 1),
            dataScope: 'selected_asset',
            missingData: deterministic.missingData,
        }, 20_000);
        return res.json({
            summary: String(ai?.summary || deterministic.summary),
            riskScores: deterministic.rows,
            dataScope: 'selected_asset',
            scannedCount: deterministic.scannedCount,
            matchedCount: deterministic.matchedCount,
            confidence: String(ai?.confidence || deterministic.confidence),
            missingData: deterministic.missingData,
            suggestedActions: Array.isArray(ai?.suggested_actions)
                ? ai.suggested_actions.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 20)
                : deterministic.rows[0].recommendedActions,
            fallbackUsed: !ai || !Boolean(ai?.llm_used),
            llmUsed: Boolean(ai?.llm_used),
            llmStatus: ai ? String(ai?.llm_status || (ai?.llm_used ? 'ready' : 'fallback')) : 'offline',
            fallbackReason: ai ? (ai?.fallback_reason || null) : 'llm_unavailable_or_timeout',
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to generate asset AI risk score', error: error.message });
    }
});

app.post('/api/inventory/ai/replacement-priority', inventoryReadGuard, async (_req: Request, res: Response) => {
    try {
        const snapshot = await buildInventoryAiSnapshot();
        const deterministic = buildReplacementPriorityRanking(snapshot);
        const llmRankedContext = deterministic.rankedItems.slice(0, 40).map((item) => ({
            rank: item.rank,
            assetName: item.assetName,
            itemType: item.itemType,
            priority: item.priority,
            reason: item.reason,
        }));
        const ai = await callInventoryAiHelper('/replacement-priority', {
            summary: deterministic.summary,
            rankedItems: llmRankedContext,
            missingData: deterministic.missingData,
        }, 22_000);
        return res.json({
            summary: String(ai?.summary || deterministic.summary),
            rankedItems: deterministic.rankedItems,
            scannedCount: deterministic.scannedCount,
            matchedCount: deterministic.matchedCount,
            confidence: String(ai?.confidence || deterministic.confidence),
            missingData: deterministic.missingData,
            suggestedActions: Array.isArray(ai?.suggested_actions)
                ? ai.suggested_actions.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 20)
                : ['Review top-ranked assets for replacement planning and budgeting.'],
            dataScope: 'full_inventory',
            fallbackUsed: !ai || !Boolean(ai?.llm_used),
            llmUsed: Boolean(ai?.llm_used),
            llmStatus: ai ? String(ai?.llm_status || (ai?.llm_used ? 'ready' : 'fallback')) : 'offline',
            fallbackReason: ai ? (ai?.fallback_reason || null) : 'llm_unavailable_or_timeout',
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to generate replacement priority ranking', error: error.message });
    }
});

app.post('/api/inventory/ai/spare-stock-forecast', inventoryReadGuard, async (_req: Request, res: Response) => {
    try {
        const snapshot = await buildInventoryAiSnapshot();
        const deterministic = buildSpareStockForecast(snapshot);
        const ai = await callInventoryAiHelper('/spare-stock-forecast', {
            summary: deterministic.summary,
            forecasts: deterministic.forecasts.slice(0, 40).map((item) => ({
                itemName: item.itemName,
                componentType: item.componentType,
                currentQuantity: item.currentQuantity,
                reorderPoint: item.reorderPoint,
                recommendedQuantity: item.recommendedQuantity,
                reason: item.reason,
            })),
            missingData: deterministic.missingData,
        }, 20_000);
        return res.json({
            summary: String(ai?.summary || deterministic.summary),
            forecasts: deterministic.forecasts,
            scannedCount: deterministic.scannedCount,
            matchedCount: deterministic.matchedCount,
            confidence: String(ai?.confidence || deterministic.confidence),
            missingData: deterministic.missingData,
            suggestedActions: Array.isArray(ai?.suggested_actions)
                ? ai.suggested_actions.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 20)
                : ['Review forecasted stock gaps and raise procurement requests for critical items.'],
            dataScope: 'full_inventory',
            fallbackUsed: !ai || !Boolean(ai?.llm_used),
            llmUsed: Boolean(ai?.llm_used),
            llmStatus: ai ? String(ai?.llm_status || (ai?.llm_used ? 'ready' : 'fallback')) : 'offline',
            fallbackReason: ai ? (ai?.fallback_reason || null) : 'llm_unavailable_or_timeout',
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to generate spare stock forecast', error: error.message });
    }
});

app.post('/api/inventory/ai/reallocation-suggestions', inventoryReadGuard, async (_req: Request, res: Response) => {
    try {
        const snapshot = await buildInventoryAiSnapshot();
        const deterministic = buildReallocationSuggestions(snapshot);
        const ai = await callInventoryAiHelper('/reallocation-suggestions', {
            summary: deterministic.summary,
            suggestions: deterministic.suggestions.slice(0, 60),
            missingData: deterministic.missingData,
        }, 24_000);
        return res.json({
            summary: String(ai?.summary || deterministic.summary),
            suggestions: deterministic.suggestions,
            confidence: String(ai?.confidence || deterministic.confidence),
            missingData: Array.isArray(ai?.missing_data)
                ? ai.missing_data.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 24)
                : deterministic.missingData,
            dataScope: 'full_inventory',
            fallbackUsed: !ai || !Boolean(ai?.llm_used),
            llmUsed: Boolean(ai?.llm_used),
            llmStatus: ai ? String(ai?.llm_status || (ai?.llm_used ? 'ready' : 'fallback')) : 'offline',
            fallbackReason: ai ? (ai?.fallback_reason || null) : 'llm_unavailable_or_timeout',
            suggestedActions: [
                'Validate suggested destination/ownership, then run transfer with explicit confirmation.',
                'Prioritize internal reallocation before creating new purchase requests.',
            ],
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to generate AI reallocation suggestions', error: error.message });
    }
});

app.post('/api/assets/import/ai-repair-errors', inventoryAdminGuard, async (req: Request, res: Response) => {
    try {
        const normalizedRowsInput = Array.isArray(req.body?.normalizedRows)
            ? req.body.normalizedRows as Array<Record<string, any>>
            : (Array.isArray(req.body?.preview?.normalizedRows) ? req.body.preview.normalizedRows as Array<Record<string, any>> : []);
        if (!normalizedRowsInput.length) {
            return res.status(400).json({ message: 'Provide normalizedRows from import preview first.' });
        }
        const normalizedRows = normalizeImportRows(normalizedRowsInput);
        const revalidated = await validateImportRows(normalizedRows);
        const parentAssets = await prisma.asset.findMany({
            where: { assetTag: { not: null } },
            select: { assetTag: true },
            take: 2000,
        });
        const parentTags = parentAssets.map((row) => String(row.assetTag || '').trim()).filter(Boolean);
        const deterministic = buildImportErrorRepairs({
            rows: revalidated.normalizedRows,
            availableParentTags: parentTags,
        });
        const correctedValidation = await validateImportRows(deterministic.correctedRowsPreview);
        const ai = await callInventoryAiHelper('/repair-import-errors', {
            summary: deterministic.summary,
            fixes: deterministic.fixes.slice(0, 60).map((fix) => ({
                rowNumber: fix.rowNumber,
                field: fix.field,
                originalValue: fix.originalValue,
                suggestedValue: fix.suggestedValue,
                reason: fix.reason,
                confidence: fix.confidence,
                safeToApply: fix.safeToApply,
            })),
            warnings: deterministic.warnings,
        }, 20_000);
        return res.json({
            summary: String(ai?.summary || deterministic.summary),
            fixes: deterministic.fixes,
            correctedRowsPreview: correctedValidation.normalizedRows,
            correctedValidation: {
                totalRows: correctedValidation.totalRows,
                validRows: correctedValidation.validRows,
                invalidRows: correctedValidation.invalidRows,
                warnings: correctedValidation.warnings,
                errors: correctedValidation.errors,
                canImport: correctedValidation.canImport,
            },
            warnings: deterministic.warnings,
            confidence: String(ai?.confidence || deterministic.confidence),
            dataScope: 'full_inventory',
            fallbackUsed: !ai || !Boolean(ai?.llm_used),
            llmUsed: Boolean(ai?.llm_used),
            llmStatus: ai ? String(ai?.llm_status || (ai?.llm_used ? 'ready' : 'fallback')) : 'offline',
            fallbackReason: ai ? (ai?.fallback_reason || null) : 'llm_unavailable_or_timeout',
        });
    } catch (error: any) {
        if (error instanceof RequestValidationError) {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: 'Failed to generate AI import repair suggestions', error: error.message });
    }
});

app.post('/api/inventory/ai/relationship-suggestions', inventoryReadGuard, async (_req: Request, res: Response) => {
    try {
        const snapshot = await buildInventoryAiSnapshot();
        const deterministic = buildRelationshipSuggestions(snapshot);
        const llmRelationshipContext = deterministic.suggestions.slice(0, 20).map((item) => ({
            sourceAssetId: item.sourceAssetId,
            sourceAssetName: item.sourceAssetName,
            targetAssetId: item.targetAssetId,
            targetAssetName: item.targetAssetName,
            relationshipType: item.relationshipType,
            reason: item.reason,
            confidence: item.confidence,
            safeToApply: item.safeToApply,
        }));
        const ai = await callInventoryAiHelper('/relationship-suggestions', {
            summary: deterministic.summary,
            suggestions: llmRelationshipContext,
            missingData: deterministic.missingData,
        }, 30_000);
        return res.json({
            summary: String(ai?.summary || deterministic.summary),
            suggestions: deterministic.suggestions,
            scannedCount: deterministic.scannedCount,
            matchedCount: deterministic.matchedCount,
            confidence: String(ai?.confidence || deterministic.confidence),
            missingData: deterministic.missingData,
            dataScope: 'full_inventory',
            fallbackUsed: !ai || !Boolean(ai?.llm_used),
            llmUsed: Boolean(ai?.llm_used),
            llmStatus: ai ? String(ai?.llm_status || (ai?.llm_used ? 'ready' : 'fallback')) : 'offline',
            fallbackReason: ai ? (ai?.fallback_reason || null) : 'llm_unavailable_or_timeout',
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to generate relationship suggestions', error: error.message });
    }
});

app.post('/api/inventory/ai/relationship-suggestions/apply', inventoryAdminGuard, async (req: Request, res: Response) => {
    try {
        const suggestions = Array.isArray(req.body?.suggestions) ? req.body.suggestions as Array<Record<string, any>> : [];
        if (!suggestions.length) return res.status(400).json({ message: 'No suggestions provided for apply.' });
        const created: Array<Record<string, any>> = [];
        const skipped: Array<Record<string, any>> = [];

        for (const suggestion of suggestions.slice(0, 300)) {
            const sourceAssetId = normalizeSerialValue(suggestion.sourceAssetId);
            const targetAssetId = normalizeSerialValue(suggestion.targetAssetId);
            const relationshipType = String(suggestion.relationshipType || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
            const safeToApply = parseBooleanFlag(suggestion.safeToApply);
            if (!sourceAssetId || !targetAssetId || !relationshipType) {
                skipped.push({ sourceAssetId, targetAssetId, reason: 'missing_required_fields' });
                continue;
            }
            if (!safeToApply) {
                skipped.push({ sourceAssetId, targetAssetId, reason: 'manual_review_required' });
                continue;
            }
            const [source, target] = await Promise.all([
                AssetService.getAssetByCustomId(sourceAssetId),
                AssetService.getAssetByCustomId(targetAssetId),
            ]);
            if (!source || !target) {
                skipped.push({ sourceAssetId, targetAssetId, reason: 'asset_not_found' });
                continue;
            }
            const exists = await prisma.assetRelationship.findFirst({
                where: {
                    assetId: sourceAssetId,
                    relatedAssetId: targetAssetId,
                    relationshipType,
                },
            });
            if (exists) {
                skipped.push({ sourceAssetId, targetAssetId, reason: 'already_exists' });
                continue;
            }
            const row = await prisma.assetRelationship.create({
                data: {
                    assetId: sourceAssetId,
                    relatedAssetId: targetAssetId,
                    relationshipType,
                    notes: normalizeSerialValue(suggestion.reason) || 'Applied from AI relationship suggestion',
                },
            });
            await recordLifecycleEvent({
                assetId: sourceAssetId,
                eventType: 'relationship_added',
                newValue: row as unknown as Record<string, any>,
                notes: row.notes || undefined,
                actor: 'inventory-ai-relationship-apply',
            });
            await recordHistoryEvent({
                assetId: sourceAssetId,
                action: 'Relationship Added',
                details: `${sourceAssetId} ${relationshipType} ${targetAssetId} (AI suggested)`,
            });
            created.push(row as unknown as Record<string, any>);
        }

        return res.json({
            success: true,
            createdCount: created.length,
            skippedCount: skipped.length,
            created,
            skipped,
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to apply relationship suggestions', error: error.message });
    }
});

app.post('/api/assets/import/ai-match-invoice', inventoryAdminGuard, async (req: Request, res: Response) => {
    try {
        const extractedRows = Array.isArray(req.body?.extractedRows)
            ? req.body.extractedRows as Array<Record<string, any>>
            : (Array.isArray(req.body?.rows) ? req.body.rows as Array<Record<string, any>> : []);
        if (!extractedRows.length) {
            return res.status(400).json({ message: 'Provide extractedRows from document/preview first.' });
        }
        const candidates = (await prisma.asset.findMany({
            orderBy: { updatedAt: 'desc' },
            take: 2000,
        })).filter((asset) => String(asset.category || '').toLowerCase() !== 'spare_part');
        const deterministic = buildInvoiceAssetMatching({
            rows: extractedRows,
            assets: candidates,
        });
        const ai = await callInventoryAiHelper('/match-invoice-assets', {
            summary: deterministic.summary,
            matches: deterministic.matches.slice(0, 60),
            unmatchedItems: deterministic.unmatchedItems.slice(0, 60),
        }, 20_000);
        return res.json({
            summary: String(ai?.summary || deterministic.summary),
            matches: deterministic.matches,
            unmatchedItems: deterministic.unmatchedItems,
            warnings: deterministic.warnings,
            confidence: String(ai?.confidence || deterministic.confidence),
            dataScope: 'full_inventory',
            fallbackUsed: !ai || !Boolean(ai?.llm_used),
            llmUsed: Boolean(ai?.llm_used),
            llmStatus: ai ? String(ai?.llm_status || (ai?.llm_used ? 'ready' : 'fallback')) : 'offline',
            fallbackReason: ai ? (ai?.fallback_reason || null) : 'llm_unavailable_or_timeout',
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to match invoice/document rows to assets', error: error.message });
    }
});

app.post('/api/inventory/ai/ticket-draft', inventoryReadGuard, async (req: Request, res: Response) => {
    try {
        const assetId = normalizeSerialValue(req.body?.assetId || req.body?.customId);
        const issue = String(req.body?.issue || req.body?.query || 'Inventory issue requires follow-up').trim();
        const snapshot = await buildInventoryAiSnapshot();
        const asset = assetId ? (snapshot.assets.find((row) => row.customId === assetId) || null) : null;
        const riskRows = buildAssetRiskScores(snapshot, assetId ? { assetIds: [assetId] } : {}).rows;
        const draft = buildInventoryTicketDraft({
            asset,
            issue,
            riskRow: riskRows[0] || null,
        });
        const ai = await callInventoryAiHelper('/draft-inventory-ticket', {
            ticketDraft: draft.ticketDraft,
            confidence: draft.confidence,
            missingData: draft.missingData,
        }, 20_000);
        return res.json({
            ticketDraft: ai?.ticket_draft || draft.ticketDraft,
            confidence: String(ai?.confidence || draft.confidence),
            missingData: draft.missingData,
            dataScope: assetId ? 'selected_asset' : 'full_inventory',
            fallbackUsed: !ai || !Boolean(ai?.llm_used),
            llmUsed: Boolean(ai?.llm_used),
            llmStatus: ai ? String(ai?.llm_status || (ai?.llm_used ? 'ready' : 'fallback')) : 'offline',
            fallbackReason: ai ? (ai?.fallback_reason || null) : 'llm_unavailable_or_timeout',
            suggestedActions: ['Review draft details, then create a ticket in draft mode only.'],
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to generate inventory ticket draft', error: error.message });
    }
});

app.post('/api/inventory/ai/daily-brief', inventoryReadGuard, async (req: Request, res: Response) => {
    try {
        const range = parseDailyBriefRangeFromInput(req.body || {});
        const departmentFilterRaw = normalizeSerialValue(req.body?.department);
        const locationFilterRaw = normalizeSerialValue(req.body?.location);
        const requestedScope: InventoryInsightDataScope = (departmentFilterRaw || locationFilterRaw) ? 'filtered_view' : 'full_inventory';
        const snapshot = await buildInventoryAiSnapshot();

        let scopedAssets = [...snapshot.assets];
        if (departmentFilterRaw) {
            const departmentFilter = mapToAssetDepartment(departmentFilterRaw);
            scopedAssets = scopedAssets.filter((asset) => asset.department === departmentFilter);
        }
        if (locationFilterRaw) {
            const locationFilter = mapToAssetLocation(locationFilterRaw);
            const normalizedHint = normalizeValue(locationFilterRaw);
            scopedAssets = scopedAssets.filter((asset) => {
                if (asset.location === locationFilter) return true;
                const hint = normalizeValue(((asset.specifications as Record<string, any>)?.mapLocationHint) || '');
                return hint && hint === normalizedHint;
            });
        }

        const scopedAssetIds = new Set(scopedAssets.map((asset) => asset.customId));
        const scopedSnapshot: InventoryAiSnapshot = {
            assets: scopedAssets,
            components: snapshot.components.filter((row) => (
                scopedAssetIds.has(row.parentAssetId) || (row.childAssetId ? scopedAssetIds.has(row.childAssetId) : false)
            )),
            maintenance: snapshot.maintenance.filter((row) => scopedAssetIds.has(row.assetId)),
            lifecycleEvents: snapshot.lifecycleEvents.filter((row) => scopedAssetIds.has(row.assetId)),
            spareStock: snapshot.spareStock,
        };
        const scopedAssetIdList = Array.from(scopedAssetIds);

        const [
            additions,
            transfers,
            custodyChanges,
            maintenanceEvents,
            componentLifecycleEvents,
            lifecycleEventsCount,
            auditEvents,
            loanerEvents,
            wifiUpdates,
            recentHistoryRows,
        ] = scopedAssetIdList.length
            ? await Promise.all([
                prisma.assetHistory.count({
                    where: {
                        assetId: { in: scopedAssetIdList },
                        date: { gte: range.start, lte: range.end },
                        OR: [
                            { event: { contains: 'Import', mode: 'insensitive' } },
                            { event: { contains: 'Create', mode: 'insensitive' } },
                        ],
                    },
                }),
                prisma.assetHistory.count({
                    where: {
                        assetId: { in: scopedAssetIdList },
                        date: { gte: range.start, lte: range.end },
                        event: { contains: 'Transfer', mode: 'insensitive' },
                    },
                }),
                prisma.assetCustodyEvent.count({
                    where: {
                        assetId: { in: scopedAssetIdList },
                        createdAt: { gte: range.start, lte: range.end },
                    },
                }),
                prisma.assetMaintenanceRecord.count({
                    where: {
                        assetId: { in: scopedAssetIdList },
                        createdAt: { gte: range.start, lte: range.end },
                    },
                }),
                prisma.assetLifecycleEvent.count({
                    where: {
                        assetId: { in: scopedAssetIdList },
                        createdAt: { gte: range.start, lte: range.end },
                        OR: [
                            { componentId: { not: null } },
                            { eventType: { contains: 'component', mode: 'insensitive' } },
                        ],
                    },
                }),
                prisma.assetLifecycleEvent.count({
                    where: {
                        assetId: { in: scopedAssetIdList },
                        createdAt: { gte: range.start, lte: range.end },
                    },
                }),
                prisma.assetLifecycleEvent.count({
                    where: {
                        assetId: { in: scopedAssetIdList },
                        createdAt: { gte: range.start, lte: range.end },
                        eventType: { in: ['asset_location_verified', 'asset_marked_missing'] },
                    },
                }),
                prisma.assetLifecycleEvent.count({
                    where: {
                        assetId: { in: scopedAssetIdList },
                        createdAt: { gte: range.start, lte: range.end },
                        eventType: { in: ['loaner_checked_out', 'loaner_returned'] },
                    },
                }),
                prisma.assetLifecycleEvent.count({
                    where: {
                        assetId: { in: scopedAssetIdList },
                        createdAt: { gte: range.start, lte: range.end },
                        eventType: 'mock_wifi_location_updated',
                    },
                }),
                prisma.assetHistory.findMany({
                    where: {
                        assetId: { in: scopedAssetIdList },
                        date: { gte: range.start, lte: range.end },
                    },
                    orderBy: { date: 'desc' },
                    take: 60,
                    select: {
                        assetId: true,
                        event: true,
                        details: true,
                        date: true,
                    },
                }),
            ])
            : [0, 0, 0, 0, 0, 0, 0, 0, 0, []];

        const riskRows = buildAssetRiskScores(scopedSnapshot).rows;
        const highRiskCount = riskRows.filter((row) => ['high', 'critical'].includes(String(row.riskLevel || '').toLowerCase())).length;
        const nearEolCount = scopedAssets.filter((asset) => {
            const lifecycle = normalizeLifecycleKey(asset.lifecycleStatus);
            if (lifecycle === 'eol_expired') return true;
            if (!asset.warrantyEndDate) return false;
            const days = (asset.warrantyEndDate.getTime() - Date.now()) / 86400000;
            return days <= 90;
        }).length;
        const lowStockWarnings = scopedSnapshot.spareStock.filter((item) => item.quantityAvailable <= (item.reorderPoint ?? item.minimumStockLevel)).length
            + scopedAssets.filter((asset) => String(asset.category || '').toLowerCase() === 'consumable' && Number(asset.quantity || 0) <= 5).length;

        const totalActivityEvents = additions
            + transfers
            + custodyChanges
            + maintenanceEvents
            + componentLifecycleEvents
            + auditEvents
            + loanerEvents
            + wifiUpdates;

        const highlights = [
            additions ? `${additions} assets were created/imported.` : '',
            transfers ? `${transfers} transfer events were recorded.` : '',
            maintenanceEvents ? `${maintenanceEvents} maintenance events were logged.` : '',
            componentLifecycleEvents ? `${componentLifecycleEvents} component lifecycle changes were detected.` : '',
            auditEvents ? `${auditEvents} audit verification/missing events were recorded.` : '',
            loanerEvents ? `${loanerEvents} loaner checkout/return events were recorded.` : '',
        ].filter(Boolean);

        const risks = [
            highRiskCount ? `${highRiskCount} assets are currently high/critical risk.` : '',
            nearEolCount ? `${nearEolCount} assets are near EOL or warranty expiry.` : '',
            lowStockWarnings ? `${lowStockWarnings} stock items are at/under threshold.` : '',
        ].filter(Boolean);

        const recommendedActions = [
            highRiskCount ? 'Prioritize high-risk assets for maintenance or replacement review.' : '',
            lowStockWarnings ? 'Review low-stock forecast and create procurement/reallocation plans.' : '',
            nearEolCount ? 'Run replacement-priority and EOL budget reports for near-EOL assets.' : '',
            !totalActivityEvents ? 'No significant changes detected. Consider widening the date range to last 7 days.' : '',
        ].filter(Boolean);

        const sections = [
            {
                key: 'activity',
                title: 'Activity Overview',
                data: {
                    additions,
                    transfers,
                    custodyChanges,
                    maintenanceEvents,
                    componentLifecycleEvents,
                    lifecycleEvents: lifecycleEventsCount,
                    auditEvents,
                    loanerEvents,
                    wifiUpdates,
                },
            },
            {
                key: 'risk_watch',
                title: 'Risk / EOL / Stock Watch',
                data: {
                    highRiskAssets: highRiskCount,
                    nearEolAssets: nearEolCount,
                    lowStockWarnings,
                },
            },
            {
                key: 'recent_events',
                title: 'Recent Inventory Events',
                data: recentHistoryRows.map((row) => ({
                    assetId: row.assetId,
                    event: row.event,
                    details: row.details,
                    timestamp: row.date ? row.date.toISOString() : null,
                })),
            },
        ];

        const confidence = buildInventoryInsightConfidence({
            dataScope: requestedScope,
            scannedCount: scopedAssets.length,
            matchedCount: totalActivityEvents,
        });

        const summary = totalActivityEvents
            ? `Detected ${totalActivityEvents} significant inventory event(s) for ${range.label}.`
            : `No significant inventory changes were found for ${range.label}.`;

        return res.json({
            title: `Inventory Daily Brief (${range.label})`,
            dateRange: range.label,
            summary,
            metrics: {
                scannedAssets: scopedAssets.length,
                additions,
                transfers,
                custodyChanges,
                maintenanceEvents,
                componentLifecycleEvents,
                lifecycleEvents: lifecycleEventsCount,
                auditEvents,
                loanerEvents,
                wifiUpdates,
                highRiskAssets: highRiskCount,
                nearEolAssets: nearEolCount,
                lowStockWarnings,
            },
            sections,
            highlights: highlights.length ? highlights : ['No major changes detected in the selected range.'],
            risks,
            recommendedActions,
            confidence,
            dataScope: requestedScope,
            fallbackUsed: false,
            llmUsed: false,
            llmStatus: 'deterministic_only',
            fallbackReason: null,
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to generate inventory daily brief', error: error.message });
    }
});

const inventoryExecutiveDashboardHandler = async (req: Request, res: Response) => {
    try {
        const source = req.method === 'GET' ? req.query : req.body;
        const categoryRaw = normalizeSerialValue(source?.category);
        const departmentRaw = normalizeSerialValue(source?.department);
        const locationRaw = normalizeSerialValue(source?.location);
        const typeRaw = normalizeSerialValue(source?.type);
        const timeRangeDays = parseDashboardTimeRangeDays(source?.timeRange);

        const snapshot = await buildInventoryAiSnapshot();
        let scopedAssets = [...snapshot.assets];

        if (categoryRaw && normalizeValue(categoryRaw) !== 'all') {
            const categoryFilter = mapToAssetCategory(categoryRaw);
            scopedAssets = scopedAssets.filter((asset) => asset.category === categoryFilter);
        }
        if (departmentRaw && normalizeValue(departmentRaw) !== 'all') {
            const departmentFilter = mapToAssetDepartment(departmentRaw);
            scopedAssets = scopedAssets.filter((asset) => asset.department === departmentFilter);
        }
        if (locationRaw && normalizeValue(locationRaw) !== 'all') {
            const locationFilter = mapToAssetLocation(locationRaw);
            const normalizedHint = normalizeValue(locationRaw);
            scopedAssets = scopedAssets.filter((asset) => (
                asset.location === locationFilter
                || normalizeValue(((asset.specifications as Record<string, any>)?.mapLocationHint) || '') === normalizedHint
            ));
        }
        if (typeRaw && normalizeValue(typeRaw) !== 'all') {
            const token = normalizeValue(typeRaw);
            scopedAssets = scopedAssets.filter((asset) => normalizeValue(canonicalAssetType(asset.type)).includes(token));
        }

        const scopedAssetIds = new Set(scopedAssets.map((asset) => asset.customId));
        const scopedAssetIdList = Array.from(scopedAssetIds);
        const scopedSnapshot: InventoryAiSnapshot = {
            assets: scopedAssets,
            components: snapshot.components.filter((row) => (
                scopedAssetIds.has(row.parentAssetId) || (row.childAssetId ? scopedAssetIds.has(row.childAssetId) : false)
            )),
            maintenance: snapshot.maintenance.filter((row) => scopedAssetIds.has(row.assetId)),
            lifecycleEvents: snapshot.lifecycleEvents.filter((row) => scopedAssetIds.has(row.assetId)),
            spareStock: snapshot.spareStock,
        };

        const byCategory: Record<string, number> = {};
        const byLocation: Record<string, number> = {};
        const byDepartment: Record<string, number> = {};
        let telemetryEnabled = 0;
        let warrantyExpiringSoon = 0;
        let licensesExpiringSoon = 0;
        let nearEol = 0;
        let missingCostDataCount = 0;
        let estimatedAssetValue = 0;
        let hasCostValues = false;
        let unverifiedAssets = 0;
        let missingAssets = 0;
        let loanersCheckedOut = 0;

        scopedAssets.forEach((asset) => {
            const categoryKey = String(asset.category || 'asset').toLowerCase();
            const locationLabel = mapLocationToFriendly(asset.location);
            const departmentLabel = mapDepartmentToFriendly(asset.department);
            byCategory[categoryKey] = (byCategory[categoryKey] || 0) + 1;
            byLocation[locationLabel] = (byLocation[locationLabel] || 0) + 1;
            byDepartment[departmentLabel] = (byDepartment[departmentLabel] || 0) + 1;

            const annotated = annotateAssetWithTruthfulSignals(asset);
            const specs = readAssetSpecifications(annotated);
            const telemetryApplicable = parseBooleanFlag(specs.telemetryApplicable) || parseBooleanFlag(specs.telemetryEnabled);
            if (telemetryApplicable) telemetryEnabled += 1;

            const lifecycle = normalizeLifecycleKey(asset.lifecycleStatus);
            const warrantyDays = asset.warrantyEndDate
                ? (asset.warrantyEndDate.getTime() - Date.now()) / 86400000
                : null;
            if (lifecycle === 'eol_expired' || (warrantyDays !== null && warrantyDays <= 90)) nearEol += 1;
            if (warrantyDays !== null && warrantyDays <= 90 && categoryKey !== 'license') warrantyExpiringSoon += 1;
            if (categoryKey === 'license' && warrantyDays !== null && warrantyDays <= 90) licensesExpiringSoon += 1;

            const cost = Number(asset.purchaseCost ?? asset.replacementCost ?? 0);
            const requiresCost = !['consumable', 'license', 'spare_part'].includes(categoryKey);
            if (Number.isFinite(cost) && cost > 0) {
                estimatedAssetValue += cost;
                hasCostValues = true;
            } else if (requiresCost) {
                missingCostDataCount += 1;
            }

            const verificationStatus = normalizeValue(specs.verificationStatus || '');
            if (!verificationStatus || verificationStatus !== 'verified') unverifiedAssets += 1;
            if (parseBooleanFlag(specs.missingFlag) || verificationStatus === 'missing' || lifecycle === 'lost_stolen') {
                missingAssets += 1;
            }

            const loanerStatus = normalizeValue(specs.loanerStatus || '');
            if (loanerStatus === 'checked_out' || loanerStatus === 'overdue') loanersCheckedOut += 1;
        });

        const riskRows = buildAssetRiskScores(scopedSnapshot).rows;
        const highRisk = riskRows.filter((row) => ['high', 'critical'].includes(String(row.riskLevel || '').toLowerCase())).length;
        const lowStock = scopedSnapshot.spareStock.filter((item) => item.quantityAvailable <= (item.reorderPoint ?? item.minimumStockLevel)).length
            + scopedAssets.filter((asset) => String(asset.category || '').toLowerCase() === 'consumable' && Number(asset.quantity || 0) <= 5).length;
        const openMaintenanceIssues = scopedSnapshot.maintenance.filter((row) => {
            const status = normalizeValue(row.status || '');
            return status && !['completed', 'closed', 'resolved', 'done'].includes(status);
        }).length;

        const now = new Date();
        const recentWindowStart = new Date(now.getTime() - timeRangeDays * 86400000);
        const recentTransfers = scopedAssetIdList.length
            ? await prisma.assetHistory.count({
                where: {
                    assetId: { in: scopedAssetIdList },
                    date: { gte: recentWindowStart, lte: now },
                    event: { contains: 'Transfer', mode: 'insensitive' },
                },
            })
            : 0;

        const monthsAhead = timeRangeDays >= 300 ? 12 : (timeRangeDays >= 180 ? 6 : 3);
        const budgetForecast = buildEolBudgetReport({
            snapshot: scopedSnapshot,
            monthsAhead,
            startDate: now,
            endDate: new Date(now.getTime() + timeRangeDays * 86400000),
            department: departmentRaw || undefined,
            location: locationRaw || undefined,
            category: categoryRaw || undefined,
            type: typeRaw || undefined,
        });

        const recommendations = Array.from(new Set([
            highRisk ? `Prioritize ${highRisk} high-risk asset(s) for maintenance/replacement planning.` : '',
            lowStock ? `Address ${lowStock} low-stock warning(s) using procurement or reallocation.` : '',
            nearEol ? `Review ${nearEol} near-EOL asset(s) for replacement timing.` : '',
            missingCostDataCount ? `Backfill cost data for ${missingCostDataCount} asset(s).` : '',
            ...budgetForecast.recommendations.slice(0, 4),
        ].filter(Boolean)));

        return res.json({
            totalAssets: scopedAssets.length,
            assetsByCategory: byCategory,
            assetsByLocation: byLocation,
            assetsByDepartment: byDepartment,
            parentAssets: byCategory.asset || 0,
            components: byCategory.component || 0,
            accessories: byCategory.accessory || 0,
            consumables: byCategory.consumable || 0,
            spareStock: byCategory.spare_part || 0,
            licenses: byCategory.license || 0,
            telemetryEnabled,
            nearEol,
            highRisk,
            lowStock,
            warrantyExpiringSoon,
            licensesExpiringSoon,
            openMaintenanceIssues,
            unverifiedAssets,
            missingAssets,
            loanersCheckedOut,
            recentTransfers,
            estimatedAssetValue: hasCostValues ? Number(estimatedAssetValue.toFixed(2)) : null,
            missingCostDataCount,
            budgetForecastSummary: {
                monthsAhead,
                matchedAssets: budgetForecast.totals.matchedAssets,
                estimatedBudget: budgetForecast.totals.estimatedBudget,
                missingCostAssets: budgetForecast.totals.missingCostAssets,
                summary: budgetForecast.summary,
            },
            recommendations,
            dataScope: (departmentRaw || locationRaw || categoryRaw || typeRaw) ? 'filtered_view' : 'full_inventory',
            confidence: buildInventoryInsightConfidence({
                dataScope: (departmentRaw || locationRaw || categoryRaw || typeRaw) ? 'filtered_view' : 'full_inventory',
                scannedCount: scopedAssets.length,
                matchedCount: highRisk + lowStock + recentTransfers,
            }),
            fallbackUsed: false,
            llmUsed: false,
            llmStatus: 'deterministic_only',
            fallbackReason: null,
            estimatedAssetValueIsPartial: Boolean(hasCostValues && missingCostDataCount > 0),
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to load inventory executive dashboard', error: error.message });
    }
};

app.get('/api/inventory/executive-dashboard', inventoryReadGuard, inventoryExecutiveDashboardHandler);
app.post('/api/inventory/executive-dashboard', inventoryReadGuard, inventoryExecutiveDashboardHandler);

app.post('/api/inventory/ai/monthly-report', inventoryReadGuard, async (req: Request, res: Response) => {
    try {
        const range = parseDateRangeFromInput(req.body || {});
        const snapshot = await buildInventoryAiSnapshot();
        const [additionCount, transferCount] = await Promise.all([
            prisma.assetHistory.count({
                where: {
                    event: { in: ['Imported', 'Created'] as any[] },
                    date: { gte: range.start, lte: range.end },
                },
            }),
            prisma.assetHistory.count({
                where: {
                    event: { contains: 'Transfer', mode: 'insensitive' },
                    date: { gte: range.start, lte: range.end },
                },
            }),
        ]);
        const deterministic = buildMonthlyInventoryReportDeterministic({
            snapshot,
            rangeLabel: range.label,
            additions: additionCount,
            transfers: transferCount,
        });
        const llmMetricsContext = {
            totalAssets: Number(deterministic.metrics.totalAssets || 0),
            categoryCount: Object.keys((deterministic.metrics.categoryBreakdown || {}) as Record<string, any>).length,
            additions: Number(deterministic.metrics.additions || 0),
            transfers: Number(deterministic.metrics.transfers || 0),
            maintenanceRecords: Number(deterministic.metrics.maintenanceRecords || 0),
            highRiskAssets: Number(deterministic.metrics.highRiskAssets || 0),
            nearEolAssets: Number(deterministic.metrics.nearEolAssets || 0),
            expiringLicenses: Number(deterministic.metrics.expiringLicenses || 0),
            lowStockForecastItems: Number(deterministic.metrics.lowStockForecastItems || 0),
            dataQualityIssues: Number(deterministic.metrics.dataQualityIssues || 0),
        };
        const ai = await callInventoryAiHelper('/monthly-inventory-report', {
            reportTitle: deterministic.reportTitle,
            dateRange: deterministic.dateRange,
            executiveSummary: deterministic.executiveSummary,
            sections: deterministic.sections.slice(0, 8).map((section) => ({
                key: section.key,
                title: section.title,
            })),
            metrics: llmMetricsContext,
            recommendations: deterministic.recommendations.slice(0, 12),
            confidence: deterministic.confidence,
            missingData: deterministic.missingData,
        }, 60_000);
        return res.json({
            reportTitle: String(ai?.report_title || deterministic.reportTitle),
            dateRange: deterministic.dateRange,
            executiveSummary: String(ai?.executive_summary || deterministic.executiveSummary),
            sections: Array.isArray(ai?.sections) && ai.sections.length ? ai.sections : deterministic.sections,
            metrics: deterministic.metrics,
            recommendations: Array.isArray(ai?.recommendations) && ai.recommendations.length
                ? ai.recommendations.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 30)
                : deterministic.recommendations,
            confidence: String(ai?.confidence || deterministic.confidence),
            missingData: Array.isArray(ai?.missing_data)
                ? ai.missing_data.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 24)
                : deterministic.missingData,
            dataScope: 'full_inventory',
            fallbackUsed: !ai || !Boolean(ai?.llm_used),
            llmUsed: Boolean(ai?.llm_used),
            llmStatus: ai ? String(ai?.llm_status || (ai?.llm_used ? 'ready' : 'fallback')) : 'offline',
            fallbackReason: ai ? (ai?.fallback_reason || null) : 'llm_unavailable_or_timeout',
            suggestedActions: deterministic.recommendations,
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to generate monthly inventory report', error: error.message });
    }
});

app.post('/api/inventory/eol-budget-report', inventoryReadGuard, async (req: Request, res: Response) => {
    try {
        const snapshot = await buildInventoryAiSnapshot();
        const range = parseDateRangeFromInput(req.body || {});
        const monthsRaw = parseOptionalIntegerInput(req.body?.monthsAhead || req.body?.horizonMonths || req.body?.windowMonths);
        const monthsAhead = monthsRaw && monthsRaw > 0 ? Math.min(36, monthsRaw) : 12;
        const report = buildEolBudgetReport({
            snapshot,
            monthsAhead,
            startDate: range.start,
            endDate: range.end,
            department: normalizeSerialValue(req.body?.department),
            location: normalizeSerialValue(req.body?.location),
            category: normalizeSerialValue(req.body?.category),
            type: normalizeSerialValue(req.body?.type),
        });

        return res.json({
            summary: report.summary,
            totals: report.totals,
            breakdowns: report.breakdowns,
            rows: report.rows,
            missingCostRows: report.missingCostRows,
            recommendations: report.recommendations,
            confidence: report.confidence,
            missingData: report.missingData,
            dataScope: 'full_inventory',
            fallbackUsed: false,
            llmUsed: false,
            llmStatus: 'deterministic_only',
            fallbackReason: null,
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to build EOL budget report', error: error.message });
    }
});

app.post('/api/inventory/ai/plan-action', inventoryReadGuard, async (req: Request, res: Response) => {
    try {
        const query = String(req.body?.query || '').trim();
        if (!query) return res.status(400).json({ message: 'query is required' });
        const snapshot = await buildInventoryAiSnapshot();
        const plan = buildInventoryActionPlan({ query, snapshot });
        const compactPlan = {
            ...plan,
            affectedItems: Array.isArray(plan.affectedItems) ? plan.affectedItems.slice(0, 10) : [],
            proposedChanges: Array.isArray(plan.proposedChanges) ? plan.proposedChanges.slice(0, 20) : [],
            risks: Array.isArray(plan.risks) ? plan.risks.slice(0, 12) : [],
        };
        const ai = await callInventoryAiHelper('/plan-inventory-action', {
            query,
            actionPlan: compactPlan,
        }, 30_000);
        return res.json({
            actionType: String(ai?.action_type || plan.actionType),
            summary: String(ai?.summary || plan.summary),
            affectedItems: plan.affectedItems,
            proposedChanges: plan.proposedChanges,
            risks: Array.isArray(ai?.risks) ? ai.risks : plan.risks,
            requiresConfirmation: true,
            executable: false,
            confirmationInstructions: String(ai?.confirmation_instructions || plan.confirmationInstructions),
            confidence: String(ai?.confidence || buildInventoryInsightConfidence({
                dataScope: 'full_inventory',
                scannedCount: snapshot.assets.length,
                matchedCount: plan.affectedItems.length,
            })),
            dataScope: 'full_inventory',
            missingData: [],
            fallbackUsed: !ai || !Boolean(ai?.llm_used),
            llmUsed: Boolean(ai?.llm_used),
            llmStatus: ai ? String(ai?.llm_status || (ai?.llm_used ? 'ready' : 'fallback')) : 'offline',
            fallbackReason: ai ? (ai?.fallback_reason || null) : 'llm_unavailable_or_timeout',
            suggestedActions: ['Review action plan and run approved operations manually or through dedicated safe workflows.'],
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to build natural-language inventory action plan', error: error.message });
    }
});

// --- ASSET ROUTES ---

app.get('/api/assets', async (req: Request, res: Response) => {
    try {
        const where: Prisma.AssetWhereInput = {};
        const andClauses: Prisma.AssetWhereInput[] = [];
        const orClauses: Prisma.AssetWhereInput[] = [];
        const viewRaw = String(req.query.view || '').trim().toLowerCase();
        const statusRaw = String(req.query.status || '').trim();
        const lifecycleRaw = String(req.query.lifecycleStatus || '').trim();
        const categoryRaw = String(req.query.category || '').trim();
        const typeRaw = String(req.query.type || '').trim();
        const componentTypeRaw = String(req.query.componentType || '').trim();
        const locationRaw = String(req.query.location || '').trim();
        const departmentRaw = String(req.query.department || '').trim();
        const assignedToRaw = String(req.query.assignedTo || '').trim();
        const searchRaw = String(req.query.q || req.query.query || req.query.search || '').trim();
        const pageRaw = Number(req.query.page);
        const pageSizeRaw = Number(req.query.pageSize);
        const paginationRequested = parseBooleanFlag(req.query.paginate)
            || Number.isFinite(pageRaw)
            || Number.isFinite(pageSizeRaw);
        const pageSize = Math.min(500, Math.max(1, Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? Math.trunc(pageSizeRaw) : 100));
        const page = Math.max(1, Number.isFinite(pageRaw) && pageRaw > 0 ? Math.trunc(pageRaw) : 1);
        const serialMissing = parseBooleanFlag(req.query.serialMissing);
        const underMaintenance = parseBooleanFlag(req.query.underMaintenance);
        const warrantyExpiringDays = Number(req.query.warrantyExpiringDays || 0);

        if (statusRaw) where.status = mapToAssetStatus(statusRaw);
        if (lifecycleRaw) where.lifecycleStatus = mapToLifecycleStatus(lifecycleRaw);
        if (categoryRaw) where.category = mapToAssetCategory(categoryRaw);
        if (typeRaw && viewRaw === 'parents') where.type = mapToAssetType(typeRaw);
        if (locationRaw) where.location = mapToAssetLocation(locationRaw);
        if (departmentRaw) where.department = mapToAssetDepartment(departmentRaw);

        if (assignedToRaw) {
            orClauses.push(
                { assignedToName: { contains: assignedToRaw, mode: 'insensitive' } },
                { assignedToUserId: { contains: assignedToRaw, mode: 'insensitive' } },
                { assignedUser: { contains: assignedToRaw, mode: 'insensitive' } },
            );
        }

        if (serialMissing) {
            andClauses.push(
                {
                    OR: [
                        { serialNumber: null },
                        { serialNumber: '' },
                    ]
                }
            );
        }

        if (underMaintenance) {
            andClauses.push(
                {
                    OR: [
                        { status: 'MAINTENANCE' },
                        { status: 'REPAIR' },
                        { lifecycleStatus: 'UNDER_MAINTENANCE' },
                        { lifecycleStatus: 'PENDING_REPAIR' },
                    ]
                }
            );
        }

        if (Number.isFinite(warrantyExpiringDays) && warrantyExpiringDays > 0) {
            const now = new Date();
            const upper = new Date(now.getTime() + (warrantyExpiringDays * 24 * 60 * 60 * 1000));
            andClauses.push(
                {
                    warrantyEndDate: {
                        gte: now,
                        lte: upper,
                    }
                }
            );
        }

        const useDbSearch = !(viewRaw === 'components' || viewRaw === 'accessories' || viewRaw === 'consumables' || viewRaw === 'licenses');
        if (searchRaw && useDbSearch) {
            orClauses.push(
                { customId: { contains: searchRaw, mode: 'insensitive' } },
                { name: { contains: searchRaw, mode: 'insensitive' } },
                { serialNumber: { contains: searchRaw, mode: 'insensitive' } },
                { assetTag: { contains: searchRaw, mode: 'insensitive' } },
                { manufacturerPartNumber: { contains: searchRaw, mode: 'insensitive' } },
            );
        }

        if (orClauses.length) {
            andClauses.push({ OR: orClauses });
        }
        if (andClauses.length) {
            where.AND = andClauses;
        }

        const assets = await prisma.asset.findMany({
            where,
            orderBy: { createdAt: 'desc' },
        });
        const assetIds = assets.map((asset) => asset.customId);
        const activeComponentLinks = assetIds.length
            ? await prisma.assetComponent.findMany({
                where: {
                    childAssetId: { in: assetIds },
                    removedAt: null,
                    status: { notIn: ['removed', 'replaced', 'retired', 'disposed'] },
                },
                include: {
                    parentAsset: {
                        select: {
                            customId: true,
                            name: true,
                            assetTag: true,
                            location: true,
                            department: true,
                            specifications: true,
                        }
                    }
                },
                orderBy: { updatedAt: 'desc' },
            })
            : [];
        const componentLinkByChildId = new Map<string, typeof activeComponentLinks[number]>();
        activeComponentLinks.forEach((link) => {
            if (!link.childAssetId) return;
            if (!componentLinkByChildId.has(link.childAssetId)) {
                componentLinkByChildId.set(link.childAssetId, link);
            }
        });
        const assetById = new Map(assets.map((asset) => [asset.customId, asset]));
        const componentRelationshipTypes = ['installed_in', 'component_of'];
        const componentRelationships = assetIds.length
            ? await prisma.assetRelationship.findMany({
                where: {
                    OR: [
                        {
                            assetId: { in: assetIds },
                            relationshipType: { in: componentRelationshipTypes },
                        },
                        {
                            relatedAssetId: { in: assetIds },
                            relationshipType: { in: componentRelationshipTypes },
                        },
                    ],
                },
                include: {
                    asset: {
                        select: {
                            customId: true,
                            name: true,
                            assetTag: true,
                            location: true,
                            department: true,
                            category: true,
                            specifications: true,
                        }
                    },
                    relatedAsset: {
                        select: {
                            customId: true,
                            name: true,
                            assetTag: true,
                            location: true,
                            department: true,
                            category: true,
                            specifications: true,
                        }
                    }
                },
                orderBy: { updatedAt: 'desc' },
            })
            : [];
        const relationshipParentByAssetId = new Map<string, {
            customId: string;
            name: string;
            assetTag: string | null;
            location: string;
            department: AssetDepartment;
        }>();
        componentRelationships.forEach((row) => {
            const leftAsset = assetById.get(row.assetId);
            const rightAsset = assetById.get(row.relatedAssetId);
            const leftIsComponent = String(leftAsset?.category || row.asset?.category || '').toLowerCase() === 'component';
            const rightIsComponent = String(rightAsset?.category || row.relatedAsset?.category || '').toLowerCase() === 'component';

            let childAssetId = row.assetId;
            let parentAsset = row.relatedAsset;

            if (rightIsComponent && !leftIsComponent) {
                childAssetId = row.relatedAssetId;
                parentAsset = row.asset;
            }

            if (!relationshipParentByAssetId.has(childAssetId)) {
                relationshipParentByAssetId.set(childAssetId, {
                    customId: parentAsset.customId,
                    name: parentAsset.name,
                    assetTag: parentAsset.assetTag,
                    location: normalizeSerialValue((parentAsset.specifications as Record<string, any>)?.mapLocationHint)
                        || String(parentAsset.location),
                    department: parentAsset.department,
                });
            }
        });

        const enrichedAssets = assets.map((rawAsset) => {
            const asset = annotateAssetWithTruthfulSignals(rawAsset);
            const specs = ((asset.specifications as Record<string, any>) || {});
            const linkedComponent = componentLinkByChildId.get(asset.customId);
            const relationshipParent = relationshipParentByAssetId.get(asset.customId);
            const metadataParentId = normalizeSerialValue(specs.installedInAssetId);
            const metadataParentTag = normalizeSerialValue(specs.installedInAssetTag);
            const metadataParentName = normalizeSerialValue(specs.installedInAssetName);
            const installedParentCustomId = linkedComponent?.parentAsset?.customId || relationshipParent?.customId || metadataParentId || null;
            const installedParentAssetTag = linkedComponent?.parentAsset?.assetTag || relationshipParent?.assetTag || metadataParentTag || null;
            const installedParentName = linkedComponent?.parentAsset?.name || relationshipParent?.name || metadataParentName || null;
            const linkedParentMapLocationHint = normalizeSerialValue((linkedComponent?.parentAsset?.specifications as Record<string, any>)?.mapLocationHint);
            const relationshipParentMapLocationHint = relationshipParent?.location || null;
            const installedParentLocation = linkedParentMapLocationHint || relationshipParentMapLocationHint || linkedComponent?.parentAsset?.location || null;
            const installedParentDepartment = linkedComponent?.parentAsset?.department || relationshipParent?.department || null;
            const componentType = linkedComponent?.componentType || normalizeSerialValue(specs.componentType) || null;
            const componentStatus = linkedComponent?.status || null;
            const hasInstalledParent = Boolean(installedParentCustomId || installedParentAssetTag || installedParentName);
            const categoryKey = String(asset.category || '').toLowerCase();
            const isComponentCategory = categoryKey === 'component';
            const isAccessory = categoryKey === 'accessory';
            const isConsumable = categoryKey === 'consumable';
            const isSparePart = categoryKey === 'spare_part';
            const isLicense = categoryKey === 'license';
            const relatedParentCustomId = installedParentCustomId || normalizeSerialValue(specs.assignedToAssetId) || normalizeSerialValue(specs.usedWithAssetId) || null;
            const relatedParentAssetTag = installedParentAssetTag || normalizeSerialValue(specs.assignedToAssetTag) || normalizeSerialValue(specs.usedWithAssetTag) || null;
            const relatedParentName = installedParentName || normalizeSerialValue(specs.assignedToAssetName) || normalizeSerialValue(specs.usedWithAssetName) || null;
            const assignedToAssetCustomId = normalizeSerialValue(specs.assignedToAssetId) || null;
            const assignedToAssetAssetTag = normalizeSerialValue(specs.assignedToAssetTag) || null;
            const assignedToAssetName = normalizeSerialValue(specs.assignedToAssetName) || null;
            const stockQuantity = Number.isFinite(Number((specs as any).quantityAvailable)) ? Number((specs as any).quantityAvailable) : null;
            const minimumStockLevel = Number.isFinite(Number((specs as any).minimumStockLevel)) ? Number((specs as any).minimumStockLevel) : null;
            const reorderPoint = Number.isFinite(Number((specs as any).reorderPoint)) ? Number((specs as any).reorderPoint) : null;
            const licenseExpiry = normalizeSerialValue(specs.licenseExpiry || specs.expiryDate || specs.warrantyEndDate) || (asset.warrantyEndDate ? asset.warrantyEndDate.toISOString() : null);
            const telemetryCapableDerived = isTelemetryCapableAsset({
                type: asset.type,
                category: asset.category,
                name: asset.name,
            });
            const telemetryEnabledDerived = (
                parseBooleanFlag(specs.trackWorkingHours)
                || parseBooleanFlag(specs.telemetryEnabled)
                || parseBooleanFlag(specs.telemetryApplicable)
                || telemetryCapableDerived
            ) && !parseBooleanFlag(specs.telemetryDisabled);
            const inventoryViewType = isSparePart
                ? 'spare_stock'
                : isLicense
                    ? 'licenses'
                    : isConsumable
                        ? 'consumables'
                        : isAccessory
                            ? 'accessories'
                            : (hasInstalledParent && (isComponentCategory || Boolean(componentType)))
                                ? 'components'
                                : 'parents';
            return {
                ...asset,
                inventoryViewType,
                isParentAsset: inventoryViewType === 'parents',
                isComponentAsset: Boolean(isComponentCategory || componentType),
                isAccessory,
                isConsumable,
                isSparePart,
                isLicense,
                installedParentAssetId: installedParentCustomId,
                installedParentCustomId,
                installedParentAssetTag,
                installedParentName,
                installedParentLocation,
                installedParentDepartment,
                relatedParentCustomId,
                relatedParentAssetTag,
                relatedParentName,
                assignedToAssetCustomId,
                assignedToAssetAssetTag,
                assignedToAssetName,
                componentType,
                componentStatus,
                isInstalledInParent: hasInstalledParent,
                stockQuantity,
                minimumStockLevel,
                reorderPoint,
                licenseExpiry,
                telemetryCapableDerived,
                telemetryEnabledDerived,
            };
        });

        let responseAssets = viewRaw === 'components'
            ? enrichedAssets.filter((asset) => Boolean((asset as any).isInstalledInParent))
            : viewRaw === 'parents'
                ? enrichedAssets.filter((asset) => String((asset as any).inventoryViewType) === 'parents')
                : viewRaw === 'accessories'
                    ? enrichedAssets.filter((asset) => Boolean((asset as any).isAccessory))
                    : viewRaw === 'consumables'
                        ? enrichedAssets.filter((asset) => Boolean((asset as any).isConsumable))
                        : (viewRaw === 'spare_stock' || viewRaw === 'spare_parts')
                            ? enrichedAssets.filter((asset) => Boolean((asset as any).isSparePart))
                            : viewRaw === 'licenses'
                            ? enrichedAssets.filter((asset) => Boolean((asset as any).isLicense))
                                : enrichedAssets;
        const normalizedTypeFilter = normalizeValue(componentTypeRaw || typeRaw);
        if (normalizedTypeFilter) {
            responseAssets = responseAssets.filter((asset) => {
                const normalizedAssetType = normalizeValue(String(asset.type || ''));
                const normalizedComponentType = normalizeValue(String((asset as any).componentType || ((asset.specifications as Record<string, any>)?.componentType || '')));
                const inferredLabel = normalizeValue(String((asset as any).inventoryViewType || ''));
                return (
                    normalizedAssetType.includes(normalizedTypeFilter)
                    || normalizedComponentType.includes(normalizedTypeFilter)
                    || inferredLabel.includes(normalizedTypeFilter)
                );
            });
        }
        if (searchRaw && !useDbSearch) {
            const q = normalizeValue(searchRaw);
            responseAssets = responseAssets.filter((asset) => {
                const specs = ((asset.specifications as Record<string, any>) || {});
                const haystack = [
                    asset.customId,
                    asset.name,
                    asset.serialNumber,
                    asset.assetTag,
                    asset.manufacturerPartNumber,
                    (asset as any).installedParentCustomId,
                    (asset as any).installedParentAssetTag,
                    (asset as any).installedParentName,
                    (asset as any).relatedParentCustomId,
                    (asset as any).relatedParentAssetTag,
                    (asset as any).relatedParentName,
                    specs.brand,
                    specs.version,
                    specs.componentType,
                ].map((entry) => normalizeValue(entry)).join(' ');
                return haystack.includes(q);
            });
        }
        if (!paginationRequested) {
            return res.json(responseAssets);
        }
        const total = responseAssets.length;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const boundedPage = Math.min(page, totalPages);
        const startIndex = (boundedPage - 1) * pageSize;
        const items = responseAssets.slice(startIndex, startIndex + pageSize);
        return res.json({
            items,
            total,
            page: boundedPage,
            pageSize,
            totalPages,
        });
    } catch (err) { 
        res.status(500).json({ error: 'Failed to fetch assets' }); 
    }
});

// --- QR CODE & DIRECT SEARCH ENDPOINT ---
app.get('/api/assets/single/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        console.log(`🔍 Searching for single asset: "${id}"`);

        const asset = await AssetService.getAssetByCustomId(id);

        if (!asset) {
            return res.status(404).json({ message: "Asset not found" });
        }
        res.json(annotateAssetWithTruthfulSignals(asset));
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Search failed" });
    }
});

// --- GENERAL SEARCH ENDPOINT ---
app.get('/api/assets/search', async (req: Request, res: Response) => {
    const { query } = req.query;
    try {
        const q = String(query || '').trim();
        const results = await prisma.asset.findMany({
            where: {
                OR: [
                    { customId: { contains: q, mode: 'insensitive' } },
                    { name: { contains: q, mode: 'insensitive' } },
                    { serialNumber: { contains: q, mode: 'insensitive' } },
                    { assetTag: { contains: q, mode: 'insensitive' } },
                    { manufacturerPartNumber: { contains: q, mode: 'insensitive' } },
                ]
            },
            take: 50
        });
        res.json(results);
    } catch (err) {
        res.status(500).json({ message: "Search failed" });
    }
});

app.get('/api/assets/spec-verification/pending', async (_req: Request, res: Response) => {
    try {
        const assets = await AssetService.getAssets();
        const pending = assets.filter((asset) => {
            const specs = (asset.specifications as Record<string, any>) || {};
            return String(specs.specVerificationStatus || '').toLowerCase() === 'pending';
        });
        res.json({ count: pending.length, assets: pending });
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to fetch pending spec verification queue', error: error.message });
    }
});

app.get('/api/assets/spec-verification/metrics', async (req: Request, res: Response) => {
    try {
        const variant = req.query.variant ? `?variant=${encodeURIComponent(String(req.query.variant))}` : '';
        const response = await fetch(`${INVENTORY_AI_SERVICE_URL}/metrics/spec-inference${variant}`);
        if (!response.ok) {
            const text = await response.text();
            return res.status(502).json({ message: 'Failed to read AI spec metrics', upstreamStatus: response.status, detail: text });
        }
        const data = await response.json();
        res.json(data);
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to fetch AI spec metrics', error: error.message });
    }
});

app.post('/api/assets/spec-normalize', inventoryAdminGuard, async (req: Request, res: Response) => {
    try {
        const rawAssetType = String(req.body?.assetType || req.body?.type || '').trim();
        if (!rawAssetType) {
            return res.status(400).json({ message: 'assetType is required.' });
        }
        const assetType = canonicalAssetType(rawAssetType);
        const profile = getAssetTypeSpecProfile(assetType);
        const expectedFields = Array.isArray(profile?.expectedSpecFields) ? profile!.expectedSpecFields : [];
        const notApplicableFields = Array.isArray(profile?.notApplicableFields) ? profile!.notApplicableFields : [];
        const rawSpecsText = String(req.body?.rawSpecsText || req.body?.specsText || '');
        const currentSpecs = (req.body?.currentSpecs && typeof req.body.currentSpecs === 'object')
            ? (req.body.currentSpecs as Record<string, any>)
            : {};
        const brand = String(req.body?.brand || '').trim();
        const model = String(req.body?.model || req.body?.version || '').trim();

        const helperPayload = {
            assetType,
            brand,
            model,
            rawSpecsText,
            currentSpecs,
            expectedFields,
            notApplicableFields,
        };

        const ai = await callInventoryAiHelper('/normalize-asset-specs', helperPayload, 9_000);
        if (!ai) {
            const fallback = buildSpecNormalizationFallback({
                rawSpecsText,
                currentSpecs,
                expectedFields,
                notApplicableFields,
                brand,
                model,
                assetType,
            });
            return res.json(fallback);
        }

        return res.json({
            normalizedSpecs: (ai.normalized_specs && typeof ai.normalized_specs === 'object') ? ai.normalized_specs : {},
            normalizedSpecsText: String(ai.normalized_specs_text || ''),
            invalidFields: Array.isArray(ai.invalid_fields) ? ai.invalid_fields : [],
            missingImportantFields: Array.isArray(ai.missing_important_fields) ? ai.missing_important_fields : [],
            warnings: Array.isArray(ai.warnings) ? ai.warnings : [],
            confidence: clampNumber(Number(ai.confidence || 0.5), 0.3, 0.95),
            llmUsed: Boolean(ai.llm_used),
        } as SpecNormalizationHelperResponse);
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to normalize specs', error: error.message });
    }
});

app.post('/api/assets/spec-sanity-check', inventoryAdminGuard, async (req: Request, res: Response) => {
    try {
        const rawAssetType = String(req.body?.assetType || req.body?.type || '').trim();
        if (!rawAssetType) {
            return res.status(400).json({ message: 'assetType is required.' });
        }
        const assetType = canonicalAssetType(rawAssetType);
        const profile = getAssetTypeSpecProfile(assetType);
        const expectedFields = Array.isArray(profile?.expectedSpecFields) ? profile!.expectedSpecFields : [];
        const notApplicableFields = Array.isArray(profile?.notApplicableFields) ? profile!.notApplicableFields : [];
        const normalizedSpecs = (req.body?.normalizedSpecs && typeof req.body.normalizedSpecs === 'object')
            ? (req.body.normalizedSpecs as Record<string, string>)
            : {};
        const brand = String(req.body?.brand || '').trim();
        const model = String(req.body?.model || req.body?.version || '').trim();
        const sourceType = String(req.body?.sourceType || '').trim();
        const evidenceStatus = String(req.body?.evidenceStatus || '').trim();

        const helperPayload = {
            assetType,
            brand,
            model,
            normalizedSpecs,
            sourceType,
            evidenceStatus,
            expectedFields,
            notApplicableFields,
        };

        const ai = await callInventoryAiHelper('/check-asset-spec-sanity', helperPayload, 8_000);
        if (!ai) {
            return res.json(buildSpecSanityFallback({
                normalizedSpecs,
                assetType,
                brand,
                model,
                expectedFields,
                notApplicableFields,
                sourceType,
                evidenceStatus,
            }));
        }

        return res.json({
            warnings: Array.isArray(ai.warnings) ? ai.warnings : [],
            suspiciousFields: Array.isArray(ai.suspicious_fields) ? ai.suspicious_fields : [],
            suggestedFixes: Array.isArray(ai.suggested_fixes) ? ai.suggested_fixes : [],
            requiresReview: Boolean(ai.requires_review),
            llmUsed: Boolean(ai.llm_used),
        } as SpecSanityHelperResponse);
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to run spec sanity check', error: error.message });
    }
});

app.post('/api/assets/spec-source-lookup', inventoryAdminGuard, async (req: Request, res: Response) => {
    try {
        const assetType = canonicalAssetType(String(req.body?.assetType || req.body?.type || '').trim());
        const brand = String(req.body?.brand || '').trim();
        const model = String(req.body?.model || req.body?.version || '').trim();
        const forceRefresh = parseBooleanFlag(req.body?.forceRefresh);

        if (!assetType || !brand || !model) {
            return res.status(400).json({
                success: false,
                message: 'assetType, brand, and model are required.',
            });
        }

        const result = await lookupTrustedSourceSpecs({
            assetType,
            brand,
            model,
            forceRefresh,
        });

        return res.json({
            success: result.success,
            cacheHit: result.cacheHit,
            sourceType: result.sourceType,
            sourceUrl: result.sourceUrl,
            sourceDomain: result.sourceDomain,
            specsText: result.specsText,
            normalizedSpecs: result.normalizedSpecs,
            confidence: result.confidence,
            evidenceStatus: result.evidenceStatus,
            evidenceReason: result.evidenceReason,
            requiresReview: result.requiresReview,
            warnings: result.warnings,
            candidates: result.candidates,
            exactModelMatched: result.exactModelMatched,
            lookupMode: result.lookupMode,
            message: result.message || result.evidenceReason || '',
        });
    } catch (error: any) {
        return res.status(500).json({
            success: false,
            message: 'Trusted source lookup failed.',
            error: error.message,
        });
    }
});

app.post('/api/assets/spec-preview', inventoryAdminGuard, async (req: Request, res: Response) => {
    try {
        const {
            name = '',
            type = '',
            brand = '',
            model = '',
            currentSpecsText = '',
            currentSpecs = {},
            liveLookupMode = 'cache_only',
        } = req.body || {};

        if (!String(type || '').trim()) {
            return res.status(400).json({ message: 'Asset type is required for spec preview.' });
        }

        const warnings: string[] = [];
        const normalizedType = canonicalAssetType(type);
        const profile = getAssetTypeSpecProfile(normalizedType);
        const parsedTextSpecs = parseSpecTextToObject(currentSpecsText);
        const currentSpecsObject = (currentSpecs && typeof currentSpecs === 'object') ? (currentSpecs as Record<string, any>) : {};
        const manualSpecs = mergeSpecMaps(parsedTextSpecs, extractRenderableSpecs(currentSpecsObject));

        const previewBrand = String(brand || '').trim();
        const previewModel = String(model || '').trim() || String(name || '').trim();
        const normalizedLookupMode = String(liveLookupMode || 'cache_only').trim().toLowerCase() === 'live_allowed'
            ? 'live_allowed'
            : 'cache_only';
        const allowLiveLookup = normalizedLookupMode === 'live_allowed';
        const verifiedMatch = lookupVerifiedSpecs({
            brand: previewBrand,
            model: previewModel,
            assetType: normalizedType,
        });
        const userConfirmedMatch = await lookupUserConfirmedSpecs({
            brand: previewBrand,
            model: previewModel,
            assetType: normalizedType,
        });
        const sourceLookup = (previewBrand && previewModel)
            ? await lookupTrustedSourceSpecs({
                assetType: normalizedType,
                brand: previewBrand,
                model: previewModel,
                forceRefresh: false,
                allowLiveLookup,
            })
            : null;

        let generatedSpecs: Record<string, string> = {};
        let confidence = 0.45;
        let lookupMode = 'asset_type_profile_fallback';
        let sourceType = 'asset_type_profile';
        let sourceUrls: string[] = [];
        let sourceDomain = '';
        let cacheHit = false;
        let exactModelMatched = false;
        let sourceEvidenceStatus: 'source_backed' | 'source_candidate_or_family_level' | 'insufficient_source_evidence' | 'llm_or_heuristic_only' = 'llm_or_heuristic_only';
        let evidenceStatus: 'trusted' | 'insufficient_source_evidence' | 'llm_or_heuristic_only' | 'user_confirmed' = 'insufficient_source_evidence';
        let evidenceReason = 'No trusted source evidence found. Profile-based template only; manual verification required.';
        let requiresReview = true;

        const verifiedHasTrustedExactEvidence = Boolean(
            verifiedMatch
            && verifiedMatch.quality === 'exact'
            && String(verifiedMatch.row.sourceUrl || '').trim()
            && String(verifiedMatch.row.sourceDomain || '').trim()
            && String(verifiedMatch.row.sourceType || '').trim()
            && !normalizeValue(verifiedMatch.row.notes).includes('generic')
            && !normalizeValue(verifiedMatch.row.notes).includes('family')
            && !normalizeValue(verifiedMatch.row.notes).includes('verify'),
        );

        if (verifiedMatch && verifiedHasTrustedExactEvidence) {
            generatedSpecs = mergeSpecMaps(verifiedMatch.row.verifiedSpecsJson);
            sourceType = 'verified_dataset';
            sourceUrls = verifiedMatch.row.sourceUrl ? [verifiedMatch.row.sourceUrl] : [];
            sourceDomain = verifiedMatch.row.sourceDomain || '';
            sourceEvidenceStatus = 'source_backed';
            lookupMode = 'verified_dataset_exact';
            warnings.push(...verifiedMatch.warnings);
            confidence = clampNumber(Number(verifiedMatch.row.confidence || 0.9), 0.85, 0.95);
            evidenceStatus = 'trusted';
            evidenceReason = 'Verified dataset exact match with trusted source evidence.';
            requiresReview = false;
        } else if (userConfirmedMatch) {
            generatedSpecs = mergeSpecMaps(userConfirmedMatch.specs);
            sourceType = 'user_confirmed_previous_asset';
            sourceUrls = [];
            sourceDomain = '';
            lookupMode = 'user_confirmed_exact_match';
            warnings.push(...userConfirmedMatch.warnings);
            confidence = clampNumber(Number(userConfirmedMatch.confidence || 0.82), 0.75, 0.9);
            evidenceStatus = 'user_confirmed';
            evidenceReason = userConfirmedMatch.reviewedBy
                ? `Specs reused from a previous asset confirmed by user/admin "${userConfirmedMatch.reviewedBy}".`
                : 'Specs reused from a previous asset confirmed by a user/admin.';
            requiresReview = Boolean(userConfirmedMatch.requiresReview);
            sourceEvidenceStatus = 'insufficient_source_evidence';
        } else if (sourceLookup?.success && Object.keys(sourceLookup.normalizedSpecs || {}).length > 0) {
            generatedSpecs = mergeSpecMaps(sourceLookup.normalizedSpecs || {});
            sourceType = sourceLookup.sourceType || (sourceLookup.cacheHit ? 'source_lookup_cache' : 'trusted_source_lookup');
            sourceUrls = sourceLookup.sourceUrl ? [sourceLookup.sourceUrl] : [];
            sourceDomain = sourceLookup.sourceDomain || '';
            cacheHit = Boolean(sourceLookup.cacheHit);
            exactModelMatched = Boolean(sourceLookup.exactModelMatched);
            sourceEvidenceStatus = sourceLookup.evidenceStatus;
            lookupMode = sourceLookup.lookupMode || (sourceLookup.cacheHit ? 'source_lookup_cache_hit' : 'trusted_source_live_lookup');
            warnings.push(...(sourceLookup.warnings || []));
            confidence = clampNumber(Number(sourceLookup.confidence || 0.65), 0.5, 0.95);
            if (sourceLookup.evidenceStatus === 'source_backed' && sourceLookup.exactModelMatched) {
                evidenceStatus = 'trusted';
                evidenceReason = String(sourceLookup.evidenceReason || 'Source-backed specs extracted from trusted domain.');
                requiresReview = Boolean(sourceLookup.requiresReview);
            } else {
                evidenceStatus = 'insufficient_source_evidence';
                evidenceReason = String(
                    sourceLookup.evidenceReason
                    || 'Source candidate was generic/weak. Manual verification is still required.'
                );
                requiresReview = true;
            }
            if (sourceLookup.cacheHit) {
                warnings.push('Using cached source-backed specs (no live SerpAPI search was required).');
            }
        } else if (sourceLookup && normalizedLookupMode === 'cache_only' && !sourceLookup.success) {
            warnings.push('No cached trusted source specs found; using safe profile-based fallback.');
        } else if (verifiedMatch) {
            generatedSpecs = mergeSpecMaps(verifiedMatch.row.verifiedSpecsJson);
            sourceType = 'verified_dataset';
            sourceUrls = verifiedMatch.row.sourceUrl ? [verifiedMatch.row.sourceUrl] : [];
            sourceDomain = verifiedMatch.row.sourceDomain || '';
            sourceEvidenceStatus = 'insufficient_source_evidence';
            lookupMode = verifiedMatch.quality === 'exact'
                ? 'verified_dataset_exact_weak'
                : 'verified_dataset_family';
            warnings.push(...verifiedMatch.warnings);
            confidence = clampNumber(
                Number(verifiedMatch.row.confidence || 0.68),
                0.6,
                verifiedMatch.quality === 'exact' ? 0.82 : 0.75,
            );
            evidenceStatus = 'insufficient_source_evidence';
            evidenceReason = 'No trusted exact source evidence found. Please verify exact model/year/specs.';
            requiresReview = true;
        } else if (profile) {
            generatedSpecs = mergeSpecMaps(profile.fallbackSpecTemplate);
            confidence = 0.45;
            lookupMode = 'asset_type_profile_fallback';
            sourceType = 'asset_type_profile';
            sourceUrls = [];
            sourceDomain = '';
            sourceEvidenceStatus = 'llm_or_heuristic_only';
            evidenceStatus = 'insufficient_source_evidence';
            evidenceReason = 'No trusted exact source evidence found. Profile-based safe template only.';
            requiresReview = true;
            warnings.push('No verified dataset match found; using asset type profile fallback template.');
        } else {
            generatedSpecs = mergeSpecMaps({
                Condition: 'Pending inspection',
                Notes: 'Unknown - verify exact specifications manually',
            });
            confidence = 0.35;
            lookupMode = 'safe_fallback_minimal';
            sourceType = 'asset_type_profile';
            sourceUrls = [];
            sourceDomain = '';
            sourceEvidenceStatus = 'llm_or_heuristic_only';
            evidenceStatus = 'llm_or_heuristic_only';
            evidenceReason = 'Insufficient data to infer reliable specs. Manual entry required.';
            requiresReview = true;
            warnings.push(`No asset type profile found for "${normalizedType}".`);
        }

        const expectedFields = profile?.expectedSpecFields || [];
        const filteredGeneratedSpecs = restrictPreviewSpecsToProfile(generatedSpecs, expectedFields, warnings);
        const effectiveSpecs = mergeSpecMaps(filteredGeneratedSpecs, manualSpecs);
        if (!Object.keys(effectiveSpecs).length && profile?.fallbackSpecTemplate) {
            Object.assign(effectiveSpecs, profile.fallbackSpecTemplate);
        }

        // Safety guard: Apple/MacBook previews must never default to Windows.
        const normalizedBrandModel = normalizeValue(`${brand} ${model} ${name}`);
        if (
            normalizedType === 'laptop'
            && (normalizedBrandModel.includes('apple') || normalizedBrandModel.includes('macbook'))
            && String(effectiveSpecs.OS || '').toLowerCase().includes('windows')
        ) {
            effectiveSpecs.OS = 'macOS';
            effectiveSpecs['Processor/Chip'] = effectiveSpecs['Processor/Chip'] || 'Unknown - verify exact MacBook Pro model/year';
            effectiveSpecs.Memory = effectiveSpecs.Memory || 'Unknown - verify exact configuration';
            effectiveSpecs.Storage = effectiveSpecs.Storage || 'Unknown - verify exact configuration';
            effectiveSpecs.Display = effectiveSpecs.Display || 'Unknown - verify exact model/year';
            evidenceStatus = 'insufficient_source_evidence';
            evidenceReason = 'No trusted exact source evidence found. Please verify exact MacBook Pro model/year/specs.';
            confidence = clampNumber(confidence, 0.6, 0.75);
            requiresReview = true;
            warnings.push('Applied Apple/MacBook safety override to prevent unsupported Windows defaults.');
        }

        return res.json({
            specsText: formatSpecsForTextarea(effectiveSpecs),
            normalizedSpecs: effectiveSpecs,
            confidence,
            liveLookupMode: normalizedLookupMode,
            lookupMode,
            sourceType,
            cacheHit,
            sourceUrls,
            sourceDomain,
            evidenceStatus,
            sourceEvidenceStatus,
            evidenceReason,
            requiresReview,
            exactModelMatched,
            warnings,
        });
    } catch (error: any) {
        return res.status(500).json({
            message: 'Failed to generate spec preview',
            error: error.message,
        });
    }
});

type SpecVerificationAction = 'approve' | 'correct' | 'reject';

function normalizeSpecVerificationAction(action: unknown): SpecVerificationAction | null {
    const normalizedAction = String(action || '').toLowerCase();
    if (normalizedAction === 'approve' || normalizedAction === 'correct' || normalizedAction === 'reject') {
        return normalizedAction;
    }
    return null;
}

function coerceCorrectedSpecs(input: unknown): Record<string, any> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    return input as Record<string, any>;
}

function buildSpecVerificationApiPayload(params: {
    assetId: string;
    updated: Asset;
    specifications: Record<string, any>;
    action: SpecVerificationAction;
}) {
    const verificationStatus = String(params.specifications.specVerificationStatus || '').toLowerCase();
    const requiresReview = verificationStatus === 'pending' || verificationStatus === 'unchecked' || verificationStatus === 'rejected';
    return {
        ...params.updated,
        success: true,
        asset: params.updated,
        assetId: params.assetId,
        specVerificationStatus: params.specifications.specVerificationStatus,
        specVerificationAction: params.action,
        specVerificationReviewedAt: params.specifications.specVerificationReviewedAt,
        specVerificationReviewedBy: params.specifications.specVerificationReviewedBy,
        specifications: params.specifications,
        aiSpecEvidenceStatus: params.specifications.aiSpecEvidenceStatus || 'insufficient_source_evidence',
        requiresReview,
        auditEventCreated: true,
    };
}

async function applySpecVerificationActionForAsset(params: {
    assetId: string;
    action: SpecVerificationAction;
    reviewer: string;
    correctedSpecifications?: Record<string, any>;
    existingAsset?: Asset | null;
    historyContext?: string;
}) {
    const { assetId, action, reviewer } = params;
    const correctedSpecifications = coerceCorrectedSpecs(params.correctedSpecifications || {});
    const asset = params.existingAsset ?? await AssetService.getAssetByCustomId(assetId);
    if (!asset) {
        return { notFound: true as const };
    }

    const specs = ((asset.specifications as Record<string, any>) || {});
    const nextSpecs = { ...specs };
    if (action === 'approve') {
        nextSpecs.specVerificationStatus = 'verified';
    } else if (action === 'correct') {
        Object.assign(nextSpecs, correctedSpecifications || {});
        nextSpecs.specVerificationStatus = 'corrected';
    } else {
        nextSpecs.specVerificationStatus = 'rejected';
    }
    nextSpecs.specVerificationReviewedBy = reviewer;
    nextSpecs.specVerificationReviewedAt = new Date().toISOString();
    nextSpecs.specVerificationAction = action;
    if (action === 'correct') {
        nextSpecs.specVerificationCorrections = correctedSpecifications || {};
    }

    const updated = await AssetService.updateAsset(assetId, { specifications: nextSpecs });
    try {
        await persistSpecSnapshot({
            assetId,
            specifications: nextSpecs,
            context: params.historyContext || 'spec_verification_patch',
            reviewer,
            reviewedAt: new Date(),
        });
    } catch (error: any) {
        console.warn(`[InventoryAI] canonical spec verification snapshot persistence failed for ${assetId}: ${error.message}`);
    }

    const detailsSuffix = params.historyContext ? ` (${params.historyContext})` : '';
    await HistoryService.createHistory({
        assetId,
        action: 'Spec Verification',
        details: `Action: ${action} by ${reviewer}${detailsSuffix}`
    });

    await submitSpecVerificationFeedback({
        assetId,
        action,
        name: String(asset.name || ''),
        type: canonicalAssetType(asset.type),
        brand: String(specs.brand || specs.Brand || ''),
        model: String(specs.version || specs.Version || specs.model || specs.Model || ''),
        predicted_specifications: specs.aiDetectedSpecs || {},
        corrected_specifications: action === 'correct' ? (correctedSpecifications || {}) : (specs.aiDetectedSpecs || {}),
        field_confidence: (specs.aiSpecFieldConfidence && typeof specs.aiSpecFieldConfidence === 'object')
            ? specs.aiSpecFieldConfidence
            : {},
        confidence: Number(specs.aiSpecConfidence || 0),
        source: String(specs.aiSpecSource || ''),
        source_urls: Array.isArray(specs.aiSpecSourceUrls) ? specs.aiSpecSourceUrls : [],
        lookup_mode: String(specs.aiSpecLookupMode || ''),
        variant: String(specs.aiSpecVariant || 'control'),
        rule_version: String(specs.aiSpecRuleVersion || 'spec-rules-v1'),
        submitted_by: reviewer,
        submitted_at: new Date().toISOString()
    });

    return {
        notFound: false as const,
        asset,
        updated,
        specifications: nextSpecs,
    };
}

app.patch('/api/assets/:id/spec-verification', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { action, correctedSpecifications = {}, reviewer = 'inventory-admin' } = req.body;
        const normalizedAction = normalizeSpecVerificationAction(action);
        if (!normalizedAction) {
            return res.status(400).json({ message: 'action must be approve, correct, or reject' });
        }

        const result = await applySpecVerificationActionForAsset({
            assetId: id,
            action: normalizedAction,
            reviewer: String(reviewer || 'inventory-admin'),
            correctedSpecifications,
            historyContext: 'single_review',
        });
        if (result.notFound) return res.status(404).json({ message: 'Asset not found' });
        res.json(buildSpecVerificationApiPayload({
            assetId: id,
            updated: result.updated,
            specifications: result.specifications,
            action: normalizedAction,
        }));
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to update spec verification status', error: error.message });
    }
});

app.post('/api/assets/spec-verification/bulk', async (req: Request, res: Response) => {
    try {
        const {
            assetIds = [],
            action,
            correctedSpecifications = {},
            correctedSpecsText = '',
            reviewer = 'inventory-admin',
            expectedGroupKey = '',
        } = req.body || {};

        const normalizedAction = normalizeSpecVerificationAction(action);
        if (!normalizedAction) {
            return res.status(400).json({ message: 'action must be approve, correct, or reject' });
        }

        const normalizedAssetIds = Array.from(new Set(
            (Array.isArray(assetIds) ? assetIds : [])
                .map((value) => String(value || '').trim())
                .filter(Boolean)
        ));
        if (!normalizedAssetIds.length) {
            return res.status(400).json({ message: 'assetIds must be a non-empty array' });
        }

        let correctedPayload = coerceCorrectedSpecs(correctedSpecifications);
        if (!Object.keys(correctedPayload).length && String(correctedSpecsText || '').trim()) {
            correctedPayload = parseSpecTextToObject(correctedSpecsText);
        }
        if (normalizedAction === 'correct' && !Object.keys(correctedPayload).length) {
            return res.status(400).json({ message: 'corrected specifications are required for action=correct' });
        }

        const loadedAssets = await Promise.all(
            normalizedAssetIds.map(async (assetId) => {
                const asset = await AssetService.getAssetByCustomId(assetId);
                return { assetId, asset };
            })
        );

        const skipped: Array<{ assetId: string; reason: string }> = [];
        const foundAssets: Asset[] = [];
        loadedAssets.forEach(({ assetId, asset }) => {
            if (!asset) {
                skipped.push({ assetId, reason: 'asset_not_found' });
                return;
            }
            foundAssets.push(asset);
        });

        if (!foundAssets.length) {
            return res.json({
                success: true,
                updatedCount: 0,
                skippedCount: skipped.length,
                skipped,
                updatedAssets: [],
            });
        }

        const groupKeys = new Set(
            foundAssets.map((asset) => `${normalizeValue(asset.name)}::${normalizeValue(canonicalAssetType(asset.type))}`)
        );
        if (groupKeys.size > 1) {
            return res.status(400).json({ message: 'bulk spec verification requires all assets to belong to the same group/type' });
        }

        const resolvedGroupKey = Array.from(groupKeys)[0];
        if (String(expectedGroupKey || '').trim()) {
            const normalizedExpected = normalizeValue(expectedGroupKey);
            const normalizedResolved = normalizeValue(resolvedGroupKey);
            if (normalizedExpected !== normalizedResolved) {
                return res.status(409).json({
                    message: 'group changed while reviewing; reopen the group and retry',
                    expectedGroupKey,
                    actualGroupKey: resolvedGroupKey,
                });
            }
        }

        const updatedAssets: Array<ReturnType<typeof buildSpecVerificationApiPayload>> = [];
        for (const asset of foundAssets) {
            const assetId = String(asset.customId || '').trim();
            if (!assetId) continue;
            const currentStatus = String((((asset.specifications as Record<string, any>) || {}).specVerificationStatus || '')).toLowerCase();
            if (currentStatus && currentStatus !== 'pending' && currentStatus !== 'unchecked') {
                skipped.push({ assetId, reason: `status_${currentStatus}_not_pending` });
                continue;
            }

            try {
                const result = await applySpecVerificationActionForAsset({
                    assetId,
                    action: normalizedAction,
                    reviewer: String(reviewer || 'inventory-admin'),
                    correctedSpecifications: normalizedAction === 'correct' ? correctedPayload : {},
                    existingAsset: asset,
                    historyContext: 'bulk_review',
                });
                if (result.notFound) {
                    skipped.push({ assetId, reason: 'asset_not_found' });
                    continue;
                }
                updatedAssets.push(buildSpecVerificationApiPayload({
                    assetId,
                    updated: result.updated,
                    specifications: result.specifications,
                    action: normalizedAction,
                }));
            } catch (error: any) {
                skipped.push({ assetId, reason: `update_failed:${error.message}` });
            }
        }

        return res.json({
            success: true,
            updatedCount: updatedAssets.length,
            skippedCount: skipped.length,
            skipped,
            updatedAssets,
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to run bulk spec verification', error: error.message });
    }
});

type TimelineSourceType = 'parent' | 'component' | 'accessory' | 'consumable' | 'license' | 'related';

type CombinedHistoryEntry = {
    id: string;
    date: string;
    event: string;
    details: string;
    eventType: string;
    sourceItemType: TimelineSourceType;
    sourceItemId: string | null;
    sourceItemName: string | null;
    sourceItemCustomId: string | null;
    sourceItemAssetTag: string | null;
    sourceItemSerialNumber: string | null;
    componentId: string | null;
    actor: string | null;
    reason: string | null;
    notes: string | null;
    oldValue?: Record<string, any> | null;
    newValue?: Record<string, any> | null;
    linkedParentAssetId?: string | null;
    linkedParentAssetName?: string | null;
    linkedParentAssetTag?: string | null;
};

function toTimelineSourceType(category: unknown, fallback: TimelineSourceType = 'related'): TimelineSourceType {
    const normalized = String(category || '').trim().toLowerCase();
    if (normalized === 'component') return 'component';
    if (normalized === 'accessory') return 'accessory';
    if (normalized === 'consumable') return 'consumable';
    if (normalized === 'license') return 'license';
    if (normalized === 'asset') return 'parent';
    return fallback;
}

function toTimelineDateIso(value: unknown): string {
    const parsed = value instanceof Date ? value : new Date(String(value || ''));
    if (Number.isNaN(parsed.getTime())) {
        return new Date(0).toISOString();
    }
    return parsed.toISOString();
}

function toTimelineEventLabel(eventType: string, fallback = 'Asset Update'): string {
    const normalized = String(eventType || '').trim();
    if (!normalized) return fallback;
    return normalized
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (m) => m.toUpperCase());
}

function resolveLinkedParentFromSpecs(asset: Asset | null | undefined): {
    parentAssetId: string | null;
    parentAssetName: string | null;
    parentAssetTag: string | null;
} {
    const specs = ((asset?.specifications as Record<string, any>) || {});
    return {
        parentAssetId: normalizeSerialValue(specs.installedInAssetId || specs.parentAssetId || specs.usedWithAssetId || specs.assignedToAssetId),
        parentAssetName: normalizeSerialValue(specs.installedInAssetName || specs.usedWithAssetName || specs.assignedToAssetName),
        parentAssetTag: normalizeSerialValue(specs.installedInAssetTag || specs.usedWithAssetTag || specs.assignedToAssetTag),
    };
}

async function resolveRelatedAssetIdsForHistory(parentAssetId: string): Promise<Set<string>> {
    const relatedIds = new Set<string>();
    const [componentRows, relationshipRows] = await Promise.all([
        prisma.assetComponent.findMany({
            where: { parentAssetId },
            select: { childAssetId: true },
        }),
        prisma.assetRelationship.findMany({
            where: {
                OR: [
                    { assetId: parentAssetId },
                    { relatedAssetId: parentAssetId },
                ],
            },
            include: {
                asset: { select: { customId: true, category: true } },
                relatedAsset: { select: { customId: true, category: true } },
            },
        }),
    ]);

    componentRows.forEach((row) => {
        if (row.childAssetId) relatedIds.add(row.childAssetId);
    });

    relationshipRows.forEach((row) => {
        const other = row.assetId === parentAssetId ? row.relatedAsset : row.asset;
        if (!other?.customId || other.customId === parentAssetId) return;
        const categoryKey = String(other.category || '').toLowerCase();
        if (['component', 'accessory', 'consumable', 'license'].includes(categoryKey)) {
            relatedIds.add(other.customId);
        }
    });

    return relatedIds;
}

function dedupeTimelineEntries(entries: CombinedHistoryEntry[]): CombinedHistoryEntry[] {
    const seen = new Set<string>();
    const deduped: CombinedHistoryEntry[] = [];
    for (const entry of entries) {
        const key = [
            normalizeValue(entry.eventType),
            entry.sourceItemCustomId || '',
            entry.componentId || '',
            entry.date,
            normalizeValue(entry.details),
        ].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(entry);
    }
    return deduped;
}

async function buildCombinedHistoryTimeline(assetId: string, includeRelated: boolean): Promise<CombinedHistoryEntry[]> {
    const baseAsset = await AssetService.getAssetByCustomId(assetId);
    if (!baseAsset) {
        throw new RequestValidationError('Asset not found');
    }

    const relatedIds = includeRelated ? await resolveRelatedAssetIdsForHistory(assetId) : new Set<string>();
    const sourceAssetIds = [assetId, ...Array.from(relatedIds)];

    const [sourceAssets, historyRows, lifecycleRows, maintenanceRows, custodyRows, relationshipRows, componentRows] = await Promise.all([
        prisma.asset.findMany({
            where: { customId: { in: sourceAssetIds } },
        }),
        prisma.assetHistory.findMany({
            where: { assetId: { in: sourceAssetIds } },
            orderBy: { date: 'desc' },
            take: includeRelated ? 1200 : 500,
        }),
        prisma.assetLifecycleEvent.findMany({
            where: { assetId: { in: sourceAssetIds } },
            include: { component: true },
            orderBy: { createdAt: 'desc' },
            take: includeRelated ? 1200 : 500,
        }),
        prisma.assetMaintenanceRecord.findMany({
            where: { assetId: { in: sourceAssetIds } },
            include: { component: true },
            orderBy: { createdAt: 'desc' },
            take: includeRelated ? 600 : 300,
        }),
        prisma.assetCustodyEvent.findMany({
            where: { assetId: { in: sourceAssetIds } },
            orderBy: { createdAt: 'desc' },
            take: includeRelated ? 600 : 300,
        }),
        prisma.assetRelationship.findMany({
            where: {
                OR: [
                    { assetId: { in: sourceAssetIds } },
                    { relatedAssetId: { in: sourceAssetIds } },
                ],
            },
            orderBy: { createdAt: 'desc' },
            take: includeRelated ? 600 : 300,
        }),
        prisma.assetComponent.findMany({
            where: {
                OR: [
                    { parentAssetId: assetId },
                    { childAssetId: { in: sourceAssetIds } },
                ],
            },
            orderBy: { updatedAt: 'desc' },
        }),
    ]);

    const sourceAssetById = new Map(sourceAssets.map((asset) => [asset.customId, asset]));
    const componentById = new Map(componentRows.map((row) => [row.id, row]));
    const linkedParentBySourceId = new Map<string, { id: string | null; name: string | null; tag: string | null }>();

    sourceAssets.forEach((asset) => {
        const parentFromSpecs = resolveLinkedParentFromSpecs(asset);
        linkedParentBySourceId.set(asset.customId, {
            id: parentFromSpecs.parentAssetId,
            name: parentFromSpecs.parentAssetName,
            tag: parentFromSpecs.parentAssetTag,
        });
    });

    componentRows.forEach((component) => {
        if (!component.childAssetId) return;
        const existing = linkedParentBySourceId.get(component.childAssetId);
        if (existing?.id) return;
        linkedParentBySourceId.set(component.childAssetId, {
            id: component.parentAssetId,
            name: baseAsset.customId === component.parentAssetId ? baseAsset.name : null,
            tag: baseAsset.customId === component.parentAssetId ? baseAsset.assetTag : null,
        });
    });

    const entries: CombinedHistoryEntry[] = [];

    historyRows.forEach((row) => {
        const sourceAsset = sourceAssetById.get(row.assetId) || null;
        const sourceType = row.assetId === assetId
            ? 'parent'
            : toTimelineSourceType(sourceAsset?.category, 'related');
        const parentLink = linkedParentBySourceId.get(row.assetId);
        entries.push({
            id: `history:${row.id}`,
            date: toTimelineDateIso(row.date),
            event: String(row.event || 'Asset Update'),
            details: String(row.details || ''),
            eventType: 'asset_history',
            sourceItemType: sourceType,
            sourceItemId: sourceAsset?.id || null,
            sourceItemName: sourceAsset?.name || null,
            sourceItemCustomId: sourceAsset?.customId || row.assetId,
            sourceItemAssetTag: sourceAsset?.assetTag || null,
            sourceItemSerialNumber: sourceAsset?.serialNumber || null,
            componentId: null,
            actor: null,
            reason: null,
            notes: null,
            linkedParentAssetId: parentLink?.id || null,
            linkedParentAssetName: parentLink?.name || null,
            linkedParentAssetTag: parentLink?.tag || null,
        });
    });

    lifecycleRows.forEach((row) => {
        const sourceAsset = sourceAssetById.get(row.assetId) || null;
        const relatedComponent = row.component || (row.componentId ? componentById.get(row.componentId) || null : null);
        const sourceType = relatedComponent
            ? 'component'
            : row.assetId === assetId
                ? 'parent'
                : toTimelineSourceType(sourceAsset?.category, 'related');
        const sourceName = relatedComponent?.componentName || sourceAsset?.name || row.assetId;
        const details = [
            row.reason ? `Reason: ${row.reason}` : '',
            row.notes ? `Notes: ${row.notes}` : '',
        ].filter(Boolean).join(' | ');
        const parentLink = linkedParentBySourceId.get(row.assetId);
        entries.push({
            id: `lifecycle:${row.id}`,
            date: toTimelineDateIso(row.createdAt),
            event: toTimelineEventLabel(row.eventType, 'Lifecycle Event'),
            details,
            eventType: String(row.eventType || 'lifecycle_event'),
            sourceItemType: sourceType,
            sourceItemId: sourceAsset?.id || null,
            sourceItemName: sourceName || null,
            sourceItemCustomId: relatedComponent?.childAssetId || sourceAsset?.customId || row.assetId,
            sourceItemAssetTag: sourceAsset?.assetTag || null,
            sourceItemSerialNumber: relatedComponent?.serialNumber || sourceAsset?.serialNumber || null,
            componentId: row.componentId || null,
            actor: row.actor || null,
            reason: row.reason || null,
            notes: row.notes || null,
            oldValue: (row.oldValue as Record<string, any> | null) || null,
            newValue: (row.newValue as Record<string, any> | null) || null,
            linkedParentAssetId: parentLink?.id || null,
            linkedParentAssetName: parentLink?.name || null,
            linkedParentAssetTag: parentLink?.tag || null,
        });
    });

    maintenanceRows.forEach((row) => {
        const sourceAsset = sourceAssetById.get(row.assetId) || null;
        const relatedComponent = row.component || (row.componentId ? componentById.get(row.componentId) || null : null);
        const sourceType = relatedComponent
            ? 'component'
            : row.assetId === assetId
                ? 'parent'
                : toTimelineSourceType(sourceAsset?.category, 'related');
        const sourceName = relatedComponent?.componentName || sourceAsset?.name || row.assetId;
        const detailsParts = [
            `${row.maintenanceType} (${row.status})`,
            row.reason ? `Reason: ${row.reason}` : '',
            row.notes ? `Notes: ${row.notes}` : '',
        ].filter(Boolean);
        const parentLink = linkedParentBySourceId.get(row.assetId);
        entries.push({
            id: `maintenance:${row.id}`,
            date: toTimelineDateIso(row.createdAt),
            event: 'Maintenance Record',
            details: detailsParts.join(' | '),
            eventType: 'maintenance_record',
            sourceItemType: sourceType,
            sourceItemId: sourceAsset?.id || null,
            sourceItemName: sourceName || null,
            sourceItemCustomId: relatedComponent?.childAssetId || sourceAsset?.customId || row.assetId,
            sourceItemAssetTag: sourceAsset?.assetTag || null,
            sourceItemSerialNumber: relatedComponent?.serialNumber || sourceAsset?.serialNumber || null,
            componentId: row.componentId || null,
            actor: row.performedBy || null,
            reason: row.reason || null,
            notes: row.notes || null,
            linkedParentAssetId: parentLink?.id || null,
            linkedParentAssetName: parentLink?.name || null,
            linkedParentAssetTag: parentLink?.tag || null,
        });
    });

    custodyRows.forEach((row) => {
        const sourceAsset = sourceAssetById.get(row.assetId) || null;
        const sourceType = row.assetId === assetId
            ? 'parent'
            : toTimelineSourceType(sourceAsset?.category, 'related');
        const detailsParts = [
            `Action: ${row.action}`,
            row.assignedToName || row.assignedToUserId ? `To: ${row.assignedToName || row.assignedToUserId}` : '',
            row.reason ? `Reason: ${row.reason}` : '',
            row.notes ? `Notes: ${row.notes}` : '',
        ].filter(Boolean);
        const parentLink = linkedParentBySourceId.get(row.assetId);
        entries.push({
            id: `custody:${row.id}`,
            date: toTimelineDateIso(row.createdAt),
            event: toTimelineEventLabel(`custody_${row.action}`, 'Custody Event'),
            details: detailsParts.join(' | '),
            eventType: `custody_${row.action}`,
            sourceItemType: sourceType,
            sourceItemId: sourceAsset?.id || null,
            sourceItemName: sourceAsset?.name || null,
            sourceItemCustomId: sourceAsset?.customId || row.assetId,
            sourceItemAssetTag: sourceAsset?.assetTag || null,
            sourceItemSerialNumber: sourceAsset?.serialNumber || null,
            componentId: null,
            actor: row.actor || null,
            reason: row.reason || null,
            notes: row.notes || null,
            linkedParentAssetId: parentLink?.id || null,
            linkedParentAssetName: parentLink?.name || null,
            linkedParentAssetTag: parentLink?.tag || null,
        });
    });

    relationshipRows.forEach((row) => {
        const sourceAsset = sourceAssetById.get(row.assetId) || null;
        const targetAsset = sourceAssetById.get(row.relatedAssetId) || null;
        const sourceType = row.assetId === assetId
            ? 'parent'
            : toTimelineSourceType(sourceAsset?.category, 'related');
        const details = `${row.assetId} ${row.relationshipType} ${row.relatedAssetId}`;
        const parentLink = linkedParentBySourceId.get(row.assetId);
        entries.push({
            id: `relationship:${row.id}`,
            date: toTimelineDateIso(row.createdAt),
            event: toTimelineEventLabel(`relationship_${row.relationshipType}`, 'Relationship Event'),
            details,
            eventType: 'relationship_event',
            sourceItemType: sourceType,
            sourceItemId: sourceAsset?.id || null,
            sourceItemName: sourceAsset?.name || null,
            sourceItemCustomId: sourceAsset?.customId || row.assetId,
            sourceItemAssetTag: sourceAsset?.assetTag || null,
            sourceItemSerialNumber: sourceAsset?.serialNumber || null,
            componentId: null,
            actor: null,
            reason: null,
            notes: normalizeSerialValue((row as any).notes),
            newValue: {
                relationshipType: row.relationshipType,
                assetId: row.assetId,
                relatedAssetId: row.relatedAssetId,
                relatedAssetName: targetAsset?.name || null,
            },
            linkedParentAssetId: parentLink?.id || null,
            linkedParentAssetName: parentLink?.name || null,
            linkedParentAssetTag: parentLink?.tag || null,
        });
    });

    const deduped = dedupeTimelineEntries(entries)
        .sort((a, b) => toTimelineDateIso(b.date).localeCompare(toTimelineDateIso(a.date)));
    return deduped;
}

// --- GET ASSET HISTORY ---
app.get('/api/assets/:id/history', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const includeRelated = parseBooleanFlag(req.query.includeRelated);
        if (!includeRelated) {
            const history = await HistoryService.getHistoryForAsset(id);
            return res.json(history);
        }
        const combined = await buildCombinedHistoryTimeline(id, true);
        return res.json(combined);
    } catch (err: any) {
        console.error('Error fetching history:', err);
        if (err instanceof RequestValidationError) {
            return res.status(404).json({ message: err.message });
        }
        return res.status(500).json({ message: "Failed to fetch history" });
    }
});

app.get('/api/assets/:id/black-box-timeline', inventoryReadGuard, async (req: Request, res: Response) => {
    try {
        const assetId = req.params.id;
        const includeRelated = typeof req.query.includeRelated === 'undefined'
            ? true
            : parseBooleanFlag(req.query.includeRelated);
        const filter = normalizeValue(req.query.filter || req.query.group || 'all');
        const asset = await AssetService.getAssetByCustomId(assetId);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });

        const timeline = await buildCombinedHistoryTimeline(assetId, includeRelated);
        const transformed = timeline.map((entry) => {
            const group = inferBlackBoxEventGroup(entry.eventType || entry.event);
            return {
                eventId: String(entry.id || ''),
                timestamp: entry.date ? new Date(entry.date).toISOString() : null,
                eventType: String(entry.eventType || '').trim().toLowerCase() || 'event',
                label: String(entry.event || 'Asset event'),
                source: String(entry.actor || entry.sourceItemType || 'system'),
                sourceItemType: String(entry.sourceItemType || 'parent'),
                sourceItemName: entry.sourceItemName || null,
                sourceItemCustomId: entry.sourceItemCustomId || null,
                oldValue: (entry as any).oldValue || null,
                newValue: (entry as any).newValue || null,
                reason: entry.reason || null,
                notes: entry.notes || null,
                relatedAssetId: entry.linkedParentAssetId || null,
                severity: inferBlackBoxSeverity({
                    eventType: entry.eventType,
                    reason: entry.reason,
                    notes: entry.notes,
                    details: entry.details,
                }),
                eventGroup: group,
            };
        });
        const deduped = Array.from(new Map(transformed.map((row) => [row.eventId, row])).values())
            .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
        const events = filter && filter !== 'all'
            ? deduped.filter((row) => row.eventGroup === filter)
            : deduped;

        return res.json({
            assetId,
            includeRelated,
            filter: filter || 'all',
            totalEvents: deduped.length,
            returnedEvents: events.length,
            filtersAvailable: ['all', 'transfer', 'maintenance', 'components', 'audit', 'ai_risk_eol', 'loaner', 'telemetry'],
            events,
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to load black-box timeline', error: error.message });
    }
});

app.get('/api/assets/:id/lifecycle-events', async (req: Request, res: Response) => {
    try {
        const rows = await prisma.assetLifecycleEvent.findMany({
            where: { assetId: req.params.id },
            orderBy: { createdAt: 'desc' },
            take: 300,
        });
        res.json(rows);
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to fetch lifecycle events', error: error.message });
    }
});

app.get('/api/assets/:id/kit-health', async (req: Request, res: Response) => {
    try {
        const asset = await AssetService.getAssetByCustomId(req.params.id);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });
        const category = String(asset.category || '').toLowerCase();
        if (category === 'component' || category === 'accessory' || category === 'consumable' || category === 'license' || category === 'spare_part') {
            return res.json({
                parentAssetId: asset.customId,
                kitHealth: {
                    status: 'unknown',
                    label: 'Unknown',
                    summary: 'Kit health is only computed for parent assets.',
                    evidence: {
                        missingChildren: [],
                        damagedChildren: [],
                        underRepairChildren: [],
                        presentChildren: [],
                        componentCount: 0,
                        relationshipCount: 0,
                    },
                },
            });
        }
        const health = await computeKitHealthForParent(asset.customId);
        return res.json({
            parentAssetId: asset.customId,
            parentAssetName: asset.name,
            parentAssetTag: asset.assetTag || null,
            kitHealth: {
                status: health.status,
                label: health.statusLabel,
                summary: health.summary,
                evidence: {
                    missingChildren: health.missingItems,
                    damagedChildren: health.damagedItems,
                    underRepairChildren: health.underRepairItems,
                    degradedChildren: health.degradedItems,
                    all: health.evidence,
                    componentCount: health.counts.totalLinkedItems,
                },
                confidence: health.confidence,
                computedAt: new Date().toISOString(),
            },
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to compute kit health', error: error.message });
    }
});

app.get('/api/assets/:id/digital-twin', inventoryReadGuard, async (req: Request, res: Response) => {
    try {
        const assetId = req.params.id;
        const asset = await AssetService.getAssetByCustomId(assetId);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });

        const annotated = annotateAssetWithTruthfulSignals(asset);
        const specs = readAssetSpecifications(annotated);
        const categoryKey = String(asset.category || '').toLowerCase();
        const isParentAsset = !['component', 'accessory', 'consumable', 'license', 'spare_part'].includes(categoryKey);

        const snapshot = await buildInventoryAiSnapshot();
        const riskRow = buildAssetRiskScores(snapshot, { assetIds: [assetId] }).rows[0] || null;

        const [timeline, maintenanceLast, maintenanceCount, componentRows, relationshipRows, eolAssessment, kitHealth] = await Promise.all([
            buildCombinedHistoryTimeline(assetId, true),
            prisma.assetMaintenanceRecord.findFirst({
                where: { assetId },
                orderBy: { createdAt: 'desc' },
            }),
            prisma.assetMaintenanceRecord.count({ where: { assetId } }),
            prisma.assetComponent.findMany({
                where: { parentAssetId: assetId },
                include: {
                    childAsset: {
                        select: {
                            customId: true,
                            name: true,
                            category: true,
                            lifecycleStatus: true,
                            status: true,
                        },
                    },
                },
            }),
            prisma.assetRelationship.findMany({
                where: { assetId },
                include: {
                    relatedAsset: {
                        select: {
                            customId: true,
                            name: true,
                            category: true,
                            lifecycleStatus: true,
                            status: true,
                        },
                    },
                },
            }),
            buildAssetEolAssessment(annotated),
            isParentAsset ? computeKitHealthForParent(assetId) : null,
        ]);

        const telemetryEnabled = parseBooleanFlag(specs.telemetryEnabled) || parseBooleanFlag(specs.telemetryApplicable);
        const telemetryStatus = String(specs.telemetryStatus || specs.operationalState || (telemetryEnabled ? 'enabled' : 'not_applicable')).trim().toLowerCase() || 'unknown';
        const warrantyDays = annotated.warrantyEndDate
            ? Math.floor((annotated.warrantyEndDate.getTime() - Date.now()) / 86400000)
            : null;
        const warrantyStatus = warrantyDays === null
            ? 'missing'
            : (warrantyDays < 0 ? 'expired' : (warrantyDays <= 90 ? 'expiring_soon' : 'active'));

        const componentCount = componentRows.filter((row) => !row.removedAt).length;
        const relatedCounts = {
            components: componentCount,
            accessories: relationshipRows.filter((row) => String(row.relatedAsset?.category || '').toLowerCase() === 'accessory').length,
            licenses: relationshipRows.filter((row) => String(row.relatedAsset?.category || '').toLowerCase() === 'license').length,
            consumables: relationshipRows.filter((row) => String(row.relatedAsset?.category || '').toLowerCase() === 'consumable').length,
        };

        const lastTransfer = timeline.find((entry) => normalizeValue(entry.eventType || entry.event).includes('transfer')) || null;
        const lastMaintenance = maintenanceLast
            ? {
                maintenanceType: maintenanceLast.maintenanceType,
                status: maintenanceLast.status,
                performedAt: maintenanceLast.performedAt ? maintenanceLast.performedAt.toISOString() : null,
                createdAt: maintenanceLast.createdAt ? maintenanceLast.createdAt.toISOString() : null,
                reason: maintenanceLast.reason || null,
            }
            : null;

        const openIssues: string[] = [];
        if (kitHealth) {
            if (kitHealth.missingItems.length) openIssues.push(`${kitHealth.missingItems.length} missing child item(s).`);
            if (kitHealth.damagedItems.length) openIssues.push(`${kitHealth.damagedItems.length} damaged child item(s).`);
            if (kitHealth.underRepairItems.length) openIssues.push(`${kitHealth.underRepairItems.length} child item(s) under repair.`);
        }
        if (riskRow?.riskLevel && ['high', 'critical'].includes(String(riskRow.riskLevel).toLowerCase())) {
            openIssues.push(`Risk is ${riskRow.riskLevel} (${riskRow.riskScore}).`);
        }
        if (warrantyStatus === 'expired') openIssues.push('Warranty is expired.');
        if (warrantyStatus === 'missing') openIssues.push('Warranty end date is missing.');
        if (normalizeLifecycleKey(annotated.lifecycleStatus) === 'eol_expired') openIssues.push('Lifecycle status is EOL expired.');

        const recommendedAction = openIssues.length
            ? (openIssues[0].toLowerCase().includes('risk')
                ? 'Review AI risk score and open a maintenance/replacement ticket.'
                : (openIssues[0].toLowerCase().includes('missing child')
                    ? 'Restore missing child items and verify kit completeness.'
                    : 'Review CMDB history and perform corrective maintenance action.'))
            : 'No urgent action required. Continue standard monitoring and audits.';

        const riskScore = riskRow ? Number(riskRow.riskScore || 0) : 0;
        const healthScore = Number(clampNumber(100 - riskScore, 0, 100).toFixed(1));
        const normalizedMapLocation = normalizeSerialValue(specs.mapLocationHint) || mapLocationToFriendly(annotated.location);
        const confidence = buildInventoryInsightConfidence({
            dataScope: 'selected_asset',
            scannedCount: 1,
            matchedCount: openIssues.length || 1,
        });

        return res.json({
            asset: {
                customId: annotated.customId,
                name: annotated.name,
                type: canonicalAssetType(annotated.type),
                category: String(annotated.category || '').toLowerCase(),
                status: normalizeLifecycleKey(annotated.status),
                lifecycleStatus: normalizeLifecycleKey(annotated.lifecycleStatus),
            },
            healthScore,
            riskScore: riskRow
                ? {
                    riskLevel: riskRow.riskLevel,
                    riskScore: riskRow.riskScore,
                    reasons: riskRow.reasons,
                }
                : null,
            kitHealth: kitHealth
                ? {
                    status: kitHealth.status,
                    label: kitHealth.statusLabel,
                    summary: kitHealth.summary,
                    counts: kitHealth.counts,
                }
                : {
                    status: 'unknown',
                    label: 'Unknown',
                    summary: 'Kit health is available for parent assets.',
                    counts: { totalLinkedItems: 0, missing: 0, damaged: 0, underRepair: 0, degraded: 0 },
                },
            eolStatus: {
                status: eolAssessment.status,
                reason: eolAssessment.reason,
                confidence: eolAssessment.confidence,
                predictedEolDate: eolAssessment.predictedEolDate,
                monthsRemaining: eolAssessment.monthsRemaining,
            },
            warrantyStatus: {
                status: warrantyStatus,
                daysRemaining: warrantyDays,
            },
            telemetryStatus: {
                enabled: telemetryEnabled,
                status: telemetryStatus,
                confidence: Number(specs.telemetryConfidence || 0) || null,
            },
            currentLocation: mapLocationToFriendly(annotated.location),
            normalizedMapLocation,
            lastTransfer: lastTransfer
                ? {
                    timestamp: lastTransfer.date ? new Date(lastTransfer.date).toISOString() : null,
                    label: lastTransfer.event,
                    details: lastTransfer.details,
                    reason: lastTransfer.reason || null,
                }
                : null,
            lastMaintenance,
            maintenanceCount,
            relatedCounts,
            openIssues,
            recommendedAction,
            evidence: {
                componentCount,
                relationshipCount: relationshipRows.length,
                timelineEvents: timeline.length,
                telemetryCapable: isTelemetryCapableAsset({
                    type: annotated.type,
                    category: annotated.category,
                    name: annotated.name,
                }),
            },
            confidence,
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to load asset digital twin', error: error.message });
    }
});

app.get('/api/assets/:id/components', async (req: Request, res: Response) => {
    try {
        const includeRemoved = parseBooleanFlag(req.query.includeRemoved);
        const components = await prisma.assetComponent.findMany({
            where: {
                parentAssetId: req.params.id,
                ...(includeRemoved ? {} : { removedAt: null }),
            },
            include: {
                childAsset: {
                    select: {
                        customId: true,
                        name: true,
                        type: true,
                        category: true,
                        lifecycleStatus: true,
                        serialNumber: true,
                        assetTag: true,
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json(components);
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to fetch components', error: error.message });
    }
});

app.post('/api/assets/:id/components', async (req: Request, res: Response) => {
    try {
        const asset = await AssetService.getAssetByCustomId(req.params.id);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });
        const componentName = String(req.body?.componentName || '').trim() || String(req.body?.name || '').trim();
        const componentType = String(req.body?.componentType || '').trim() || 'component';
        if (!componentName) return res.status(400).json({ message: 'componentName is required' });

        const createAsAsset = typeof req.body?.createAsAsset === 'undefined'
            ? true
            : parseBooleanFlag(req.body?.createAsAsset);
        const requestedChildAssetId = normalizeSerialValue(req.body?.childAssetId);
        const componentSerial = normalizeSerialValue(req.body?.serialNumber);
        const componentTag = normalizeSerialValue(req.body?.assetTag);

        const component = await prisma.$transaction(async (tx) => {
            let linkedAssetId: string | null = requestedChildAssetId;
            let linkedAsset: Asset | null = null;

            if (requestedChildAssetId) {
                linkedAsset = await tx.asset.findUnique({ where: { customId: requestedChildAssetId } });
                if (!linkedAsset) {
                    throw new RequestValidationError('childAssetId does not exist');
                }
                linkedAsset = await tx.asset.update({
                    where: { customId: linkedAsset.customId },
                    data: {
                        category: 'COMPONENT',
                        lifecycleStatus: 'IN_USE',
                        status: 'ACTIVE',
                        serialNumber: componentSerial || linkedAsset.serialNumber,
                        assetTag: componentTag || linkedAsset.assetTag,
                        manufacturerPartNumber: normalizeSerialValue(req.body?.partNumber) || linkedAsset.manufacturerPartNumber,
                        specifications: {
                            ...((linkedAsset.specifications as Record<string, any>) || {}),
                            installedInAssetId: req.params.id,
                            installedInAssetName: asset.name,
                            installedInAssetTag: asset.assetTag || null,
                            componentType,
                        },
                    }
                });
            } else if (createAsAsset) {
                if (componentSerial) {
                    linkedAsset = await tx.asset.findFirst({
                        where: { serialNumber: componentSerial },
                        orderBy: { createdAt: 'desc' },
                    });
                }
                if (!linkedAsset) {
                    const requestedAssetType = normalizeSerialValue(req.body?.assetType);
                    const resolvedAssetType = requestedAssetType
                        ? mapToAssetType(requestedAssetType)
                        : mapComponentTypeToAssetType(componentType);
                    const generatedCustomId = normalizeSerialValue(req.body?.childAssetCustomId)
                        || await generateComponentAssetCustomId(req.params.id, componentType);
                    linkedAsset = await tx.asset.create({
                        data: {
                            customId: generatedCustomId,
                            name: componentName,
                            type: resolvedAssetType,
                            status: 'ACTIVE',
                            lifecycleStatus: 'IN_USE',
                            category: 'COMPONENT',
                            value: parseOptionalNumberInput(req.body?.componentValue) || 0,
                            quantity: 1,
                            assignedUser: null,
                            serialNumber: componentSerial,
                            assetTag: componentTag,
                            manufacturerPartNumber: normalizeSerialValue(req.body?.partNumber),
                            location: asset.location,
                            department: asset.department,
                            assignedToName: null,
                            assignedToUserId: null,
                            assignedDepartment: null,
                            custodyStatus: 'UNASSIGNED',
                            specifications: {
                                installedInAssetId: req.params.id,
                                installedInAssetName: asset.name,
                                installedInAssetTag: asset.assetTag || null,
                                parentAssetId: req.params.id,
                                componentType,
                                createdFrom: 'component_create_as_asset',
                            },
                        }
                    });
                } else {
                    linkedAsset = await tx.asset.update({
                        where: { customId: linkedAsset.customId },
                        data: {
                            category: 'COMPONENT',
                            lifecycleStatus: 'IN_USE',
                            status: 'ACTIVE',
                            serialNumber: componentSerial || linkedAsset.serialNumber,
                            assetTag: componentTag || linkedAsset.assetTag,
                            manufacturerPartNumber: normalizeSerialValue(req.body?.partNumber) || linkedAsset.manufacturerPartNumber,
                            specifications: {
                                ...((linkedAsset.specifications as Record<string, any>) || {}),
                                installedInAssetId: req.params.id,
                                installedInAssetName: asset.name,
                                installedInAssetTag: asset.assetTag || null,
                                componentType,
                            },
                        }
                    });
                }
                linkedAssetId = linkedAsset.customId;
            }

            const createdComponent = await tx.assetComponent.create({
                data: {
                    parentAssetId: req.params.id,
                    childAssetId: linkedAssetId,
                    componentName,
                    componentType,
                    brand: normalizeSerialValue(req.body?.brand),
                    model: normalizeSerialValue(req.body?.model),
                    serialNumber: componentSerial,
                    partNumber: normalizeSerialValue(req.body?.partNumber),
                    status: normalizeComponentStatus(req.body?.status, 'installed'),
                    condition: normalizeSerialValue(req.body?.condition),
                    installedAt: parseOptionalDateInput(req.body?.installedAt) || new Date(),
                    reason: normalizeSerialValue(req.body?.reason),
                    notes: normalizeSerialValue(req.body?.notes),
                },
                include: {
                    childAsset: {
                        select: {
                            customId: true,
                            name: true,
                            type: true,
                            category: true,
                            lifecycleStatus: true,
                            serialNumber: true,
                            assetTag: true,
                        }
                    }
                }
            });
            return createdComponent;
        });

        if (component.childAssetId) {
            const duplicateLink = await prisma.assetComponent.findFirst({
                where: {
                    parentAssetId: req.params.id,
                    childAssetId: component.childAssetId,
                    removedAt: null,
                    id: { not: component.id },
                },
                select: { id: true },
            });
            if (duplicateLink) {
                await prisma.assetComponent.delete({ where: { id: component.id } });
                return res.status(409).json({ message: 'This component asset is already installed on the parent asset.' });
            }
        }

        await recordLifecycleEvent({
            assetId: req.params.id,
            componentId: component.id,
            eventType: 'component_added',
            newValue: {
                componentName: component.componentName,
                componentType: component.componentType,
                serialNumber: component.serialNumber,
                status: component.status,
                childAssetId: component.childAssetId || null,
            },
            reason: component.reason || undefined,
            notes: component.notes || undefined,
            actor: String(req.body?.actor || ''),
        });
        await recordHistoryEvent({
            assetId: req.params.id,
            action: 'Component Added',
            details: `${component.componentName} (${component.componentType}) installed`,
        });

        res.status(201).json(component);
    } catch (error: any) {
        if (error instanceof RequestValidationError) {
            return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: 'Failed to add component', error: error.message });
    }
});

app.put('/api/assets/:id/components/:componentId', async (req: Request, res: Response) => {
    try {
        const component = await prisma.assetComponent.findUnique({ where: { id: req.params.componentId } });
        if (!component || component.parentAssetId !== req.params.id) {
            return res.status(404).json({ message: 'Component not found' });
        }
        const updated = await prisma.assetComponent.update({
            where: { id: req.params.componentId },
            data: {
                componentName: String(req.body?.componentName || component.componentName).trim(),
                componentType: String(req.body?.componentType || component.componentType).trim(),
                brand: typeof req.body?.brand !== 'undefined' ? normalizeSerialValue(req.body?.brand) : component.brand,
                model: typeof req.body?.model !== 'undefined' ? normalizeSerialValue(req.body?.model) : component.model,
                serialNumber: typeof req.body?.serialNumber !== 'undefined' ? normalizeSerialValue(req.body?.serialNumber) : component.serialNumber,
                partNumber: typeof req.body?.partNumber !== 'undefined' ? normalizeSerialValue(req.body?.partNumber) : component.partNumber,
                status: typeof req.body?.status !== 'undefined' ? String(req.body.status || '').trim() || component.status : component.status,
                condition: typeof req.body?.condition !== 'undefined' ? normalizeSerialValue(req.body?.condition) : component.condition,
                installedAt: typeof req.body?.installedAt !== 'undefined' ? parseOptionalDateInput(req.body?.installedAt) : component.installedAt,
                removedAt: typeof req.body?.removedAt !== 'undefined' ? parseOptionalDateInput(req.body?.removedAt) : component.removedAt,
                reason: typeof req.body?.reason !== 'undefined' ? normalizeSerialValue(req.body?.reason) : component.reason,
                notes: typeof req.body?.notes !== 'undefined' ? normalizeSerialValue(req.body?.notes) : component.notes,
            },
        });
        await recordLifecycleEvent({
            assetId: req.params.id,
            componentId: component.id,
            eventType: 'component_updated',
            oldValue: component as unknown as Record<string, any>,
            newValue: updated as unknown as Record<string, any>,
            reason: normalizeSerialValue(req.body?.reason),
            actor: String(req.body?.actor || ''),
        });
        await recordHistoryEvent({
            assetId: req.params.id,
            action: 'Component Updated',
            details: `${updated.componentName} updated`,
        });
        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to update component', error: error.message });
    }
});

app.get('/api/assets/:id/components/:componentId/history', async (req: Request, res: Response) => {
    try {
        const rows = await prisma.assetLifecycleEvent.findMany({
            where: {
                assetId: req.params.id,
                componentId: req.params.componentId,
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json(rows);
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to fetch component history', error: error.message });
    }
});

app.post('/api/assets/:id/components/:componentId/remove', async (req: Request, res: Response) => {
    try {
        const component = await prisma.assetComponent.findUnique({ where: { id: req.params.componentId } });
        if (!component || component.parentAssetId !== req.params.id) {
            return res.status(404).json({ message: 'Component not found' });
        }
        const reason = normalizeSerialValue(req.body?.reason) || 'removed';
        const updated = await prisma.assetComponent.update({
            where: { id: component.id },
            data: {
                status: normalizeComponentStatus(req.body?.status, 'removed'),
                removedAt: parseOptionalDateInput(req.body?.removedAt) || new Date(),
                reason,
                notes: normalizeSerialValue(req.body?.notes),
            }
        });
        if (updated.childAssetId) {
            await updateChildAssetLinkMetadata(prisma, updated.childAssetId, {
                lifecycleStatus: 'IN_STOCK',
                status: 'ACTIVE',
                clearInstalledIn: true,
                componentType: updated.componentType,
            });
        }
        await recordLifecycleEvent({
            assetId: req.params.id,
            componentId: component.id,
            eventType: 'component_removed',
            oldValue: component as unknown as Record<string, any>,
            newValue: updated as unknown as Record<string, any>,
            reason,
            actor: String(req.body?.actor || ''),
        });
        await recordHistoryEvent({
            assetId: req.params.id,
            action: 'Component Removed',
            details: `${updated.componentName} removed (${reason})`,
        });
        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to remove component', error: error.message });
    }
});

app.post('/api/assets/:id/components/:componentId/replace', async (req: Request, res: Response) => {
    try {
        const component = await prisma.assetComponent.findUnique({ where: { id: req.params.componentId } });
        if (!component || component.parentAssetId !== req.params.id) {
            return res.status(404).json({ message: 'Component not found' });
        }
        const parentAsset = await AssetService.getAssetByCustomId(req.params.id);
        if (!parentAsset) return res.status(404).json({ message: 'Asset not found' });
        const reason = normalizeSerialValue(req.body?.reason) || 'replaced';
        const newComponentInput = req.body?.newComponent || {};
        const [oldComponent, newComponent] = await prisma.$transaction([
            prisma.assetComponent.update({
                where: { id: component.id },
                data: {
                    status: normalizeComponentStatus(req.body?.oldStatus, 'replaced'),
                    removedAt: new Date(),
                    reason,
                },
            }),
            prisma.assetComponent.create({
                data: {
                    parentAssetId: req.params.id,
                    childAssetId: normalizeSerialValue(newComponentInput.childAssetId),
                    componentName: String(newComponentInput.componentName || component.componentName).trim(),
                    componentType: String(newComponentInput.componentType || component.componentType).trim(),
                    brand: normalizeSerialValue(newComponentInput.brand) || component.brand,
                    model: normalizeSerialValue(newComponentInput.model) || component.model,
                    serialNumber: normalizeSerialValue(newComponentInput.serialNumber),
                    partNumber: normalizeSerialValue(newComponentInput.partNumber),
                    status: normalizeComponentStatus(newComponentInput.status, 'installed'),
                    condition: normalizeSerialValue(newComponentInput.condition),
                    installedAt: parseOptionalDateInput(newComponentInput.installedAt) || new Date(),
                    notes: normalizeSerialValue(newComponentInput.notes),
                    reason,
                },
            }),
        ]);
        if (oldComponent.childAssetId) {
            await updateChildAssetLinkMetadata(prisma, oldComponent.childAssetId, {
                lifecycleStatus: 'IN_STOCK',
                status: 'ACTIVE',
                clearInstalledIn: true,
                componentType: oldComponent.componentType,
            });
        }
        if (newComponent.childAssetId) {
            await updateChildAssetLinkMetadata(prisma, newComponent.childAssetId, {
                lifecycleStatus: 'IN_USE',
                status: 'ACTIVE',
                parentAssetId: parentAsset.customId,
                parentAssetName: parentAsset.name,
                parentAssetTag: parentAsset.assetTag || null,
                componentType: newComponent.componentType,
            });
        }
        await recordLifecycleEvent({
            assetId: req.params.id,
            componentId: component.id,
            eventType: 'component_replaced_out',
            oldValue: component as unknown as Record<string, any>,
            newValue: oldComponent as unknown as Record<string, any>,
            reason,
            actor: String(req.body?.actor || ''),
        });
        await recordLifecycleEvent({
            assetId: req.params.id,
            componentId: newComponent.id,
            eventType: 'component_replaced_in',
            newValue: newComponent as unknown as Record<string, any>,
            reason,
            actor: String(req.body?.actor || ''),
        });
        await recordHistoryEvent({
            assetId: req.params.id,
            action: 'Component Replaced',
            details: `${component.componentName} replaced (${reason})`,
        });
        res.json({ replaced: oldComponent, installed: newComponent });
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to replace component', error: error.message });
    }
});

app.post('/api/assets/:id/components/install-from-stock', async (req: Request, res: Response) => {
    try {
        const asset = await AssetService.getAssetByCustomId(req.params.id);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });
        const spareStockItemId = String(req.body?.spareStockItemId || '').trim();
        if (!spareStockItemId) return res.status(400).json({ message: 'spareStockItemId is required' });
        const reason = normalizeSerialValue(req.body?.reason) || 'installed_from_stock';

        const result = await prisma.$transaction(async (tx) => {
            const stock = await tx.spareStockItem.findUnique({ where: { id: spareStockItemId } });
            if (!stock) throw new RequestValidationError('Spare stock item not found');
            if (stock.quantityAvailable <= 0) throw new RequestValidationError('Spare stock quantity is 0');

            const updatedStock = await tx.spareStockItem.update({
                where: { id: stock.id },
                data: { quantityAvailable: stock.quantityAvailable - 1 },
            });

            const componentName = normalizeSerialValue(req.body?.componentName) || stock.partName;
            const componentType = normalizeSerialValue(req.body?.componentType) || stock.componentType;
            const serialNumber = normalizeSerialValue(req.body?.serialNumber);
            const partNumber = normalizeSerialValue(req.body?.partNumber) || stock.partNumber;
            const createAsAsset = typeof req.body?.createAsAsset === 'undefined'
                ? true
                : parseBooleanFlag(req.body?.createAsAsset);

            let childAssetId: string | null = normalizeSerialValue(req.body?.childAssetId);
            if (!childAssetId && createAsAsset) {
                const componentAssetCustomId = normalizeSerialValue(req.body?.childAssetCustomId)
                    || await generateComponentAssetCustomId(req.params.id, componentType || 'component');
                const createdChildAsset = await tx.asset.create({
                    data: {
                        customId: componentAssetCustomId,
                        name: componentName || stock.partName,
                        type: mapComponentTypeToAssetType(componentType),
                        status: 'ACTIVE',
                        lifecycleStatus: 'IN_USE',
                        category: 'COMPONENT',
                        value: parseOptionalNumberInput(req.body?.componentValue) || Number(stock.unitCost || 0),
                        quantity: 1,
                        serialNumber,
                        assetTag: normalizeSerialValue(req.body?.assetTag),
                        manufacturerPartNumber: partNumber,
                        location: asset.location,
                        department: asset.department,
                        custodyStatus: 'UNASSIGNED',
                        specifications: {
                            parentAssetId: req.params.id,
                            installedInAssetId: req.params.id,
                            installedInAssetName: asset.name,
                            installedInAssetTag: asset.assetTag || null,
                            stockItemId: stock.id,
                            componentType,
                            createdFrom: 'stock_install',
                        },
                    }
                });
                childAssetId = createdChildAsset.customId;
            }

            const installed = await tx.assetComponent.create({
                data: {
                    parentAssetId: req.params.id,
                    childAssetId,
                    componentName: componentName || stock.partName,
                    componentType: componentType || stock.componentType,
                    brand: normalizeSerialValue(req.body?.brand) || stock.brand,
                    model: normalizeSerialValue(req.body?.model) || stock.model,
                    serialNumber,
                    partNumber,
                    status: normalizeComponentStatus(req.body?.status, 'installed'),
                    condition: normalizeSerialValue(req.body?.condition) || 'new',
                    installedAt: parseOptionalDateInput(req.body?.installedAt) || new Date(),
                    reason,
                    notes: normalizeSerialValue(req.body?.notes),
                },
                include: {
                    childAsset: {
                        select: {
                            customId: true,
                            name: true,
                            type: true,
                            category: true,
                            lifecycleStatus: true,
                        }
                    }
                }
            });

            if (installed.childAssetId) {
                await updateChildAssetLinkMetadata(tx, installed.childAssetId, {
                    lifecycleStatus: 'IN_USE',
                    status: 'ACTIVE',
                    parentAssetId: asset.customId,
                    parentAssetName: asset.name,
                    parentAssetTag: asset.assetTag || null,
                    componentType: installed.componentType,
                });
            }

            return {
                stockBefore: stock,
                stockAfter: updatedStock,
                installed,
            };
        });

        await recordLifecycleEvent({
            assetId: req.params.id,
            componentId: result.installed.id,
            eventType: 'component_installed_from_stock',
            newValue: {
                componentName: result.installed.componentName,
                componentType: result.installed.componentType,
                serialNumber: result.installed.serialNumber,
                partNumber: result.installed.partNumber,
                stockItemId: spareStockItemId,
            },
            reason,
            actor: String(req.body?.actor || ''),
        });
        await recordHistoryEvent({
            assetId: req.params.id,
            action: 'Component Installed From Stock',
            details: `${result.installed.componentName} installed from spare stock`,
        });

        res.status(201).json({
            installed: result.installed,
            stock: result.stockAfter,
            lowStockWarning: isLowStock(result.stockAfter),
        });
    } catch (error: any) {
        if (error instanceof RequestValidationError) {
            return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: 'Failed to install component from stock', error: error.message });
    }
});

app.post('/api/assets/:id/components/:componentId/replace-from-stock', async (req: Request, res: Response) => {
    try {
        const asset = await AssetService.getAssetByCustomId(req.params.id);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });

        const spareStockItemId = String(req.body?.spareStockItemId || '').trim();
        if (!spareStockItemId) return res.status(400).json({ message: 'spareStockItemId is required' });

        const result = await prisma.$transaction(async (tx) => {
            const existing = await tx.assetComponent.findUnique({ where: { id: req.params.componentId } });
            if (!existing || existing.parentAssetId !== req.params.id) {
                throw new RequestValidationError('Component not found');
            }
            const stock = await tx.spareStockItem.findUnique({ where: { id: spareStockItemId } });
            if (!stock) throw new RequestValidationError('Spare stock item not found');
            if (stock.quantityAvailable <= 0) throw new RequestValidationError('Spare stock quantity is 0');

            const reason = normalizeSerialValue(req.body?.reason) || 'replaced_from_stock';
            const failedStatus = normalizeComponentStatus(req.body?.oldStatus, 'replaced');
            const oldComponent = await tx.assetComponent.update({
                where: { id: existing.id },
                data: {
                    status: failedStatus,
                    removedAt: parseOptionalDateInput(req.body?.removedAt) || new Date(),
                    reason,
                    notes: normalizeSerialValue(req.body?.oldNotes) || existing.notes,
                }
            });

            if (oldComponent.childAssetId) {
                await updateChildAssetLinkMetadata(tx, oldComponent.childAssetId, {
                    lifecycleStatus: failedStatus === 'failed' ? 'PENDING_REPAIR' : 'IN_STOCK',
                    status: failedStatus === 'failed' ? 'REPAIR' : 'ACTIVE',
                    clearInstalledIn: failedStatus !== 'failed',
                    componentType: oldComponent.componentType,
                });
            }

            const updatedStock = await tx.spareStockItem.update({
                where: { id: stock.id },
                data: {
                    quantityAvailable: stock.quantityAvailable - 1,
                }
            });

            const componentName = normalizeSerialValue(req.body?.componentName) || stock.partName || oldComponent.componentName;
            const componentType = normalizeSerialValue(req.body?.componentType) || stock.componentType || oldComponent.componentType;
            const serialNumber = normalizeSerialValue(req.body?.serialNumber);
            const partNumber = normalizeSerialValue(req.body?.partNumber) || stock.partNumber || oldComponent.partNumber;
            const createAsAsset = typeof req.body?.createAsAsset === 'undefined'
                ? true
                : parseBooleanFlag(req.body?.createAsAsset);
            let childAssetId: string | null = normalizeSerialValue(req.body?.childAssetId);

            if (!childAssetId && createAsAsset) {
                const componentAssetCustomId = normalizeSerialValue(req.body?.childAssetCustomId)
                    || await generateComponentAssetCustomId(req.params.id, componentType || 'component');
                const createdChildAsset = await tx.asset.create({
                    data: {
                        customId: componentAssetCustomId,
                        name: componentName || oldComponent.componentName,
                        type: mapComponentTypeToAssetType(componentType),
                        status: 'ACTIVE',
                        lifecycleStatus: 'IN_USE',
                        category: 'COMPONENT',
                        value: parseOptionalNumberInput(req.body?.componentValue) || Number(stock.unitCost || 0),
                        quantity: 1,
                        serialNumber,
                        assetTag: normalizeSerialValue(req.body?.assetTag),
                        manufacturerPartNumber: partNumber,
                        location: asset.location,
                        department: asset.department,
                        custodyStatus: 'UNASSIGNED',
                        specifications: {
                            parentAssetId: req.params.id,
                            installedInAssetId: req.params.id,
                            installedInAssetName: asset.name,
                            installedInAssetTag: asset.assetTag || null,
                            stockItemId: stock.id,
                            replacedComponentId: oldComponent.id,
                            componentType,
                            createdFrom: 'stock_replace',
                        },
                    }
                });
                childAssetId = createdChildAsset.customId;
            }

            const installed = await tx.assetComponent.create({
                data: {
                    parentAssetId: req.params.id,
                    childAssetId,
                    componentName: componentName || oldComponent.componentName,
                    componentType: componentType || oldComponent.componentType,
                    brand: normalizeSerialValue(req.body?.brand) || stock.brand || oldComponent.brand,
                    model: normalizeSerialValue(req.body?.model) || stock.model || oldComponent.model,
                    serialNumber,
                    partNumber,
                    status: normalizeComponentStatus(req.body?.newStatus, 'installed'),
                    condition: normalizeSerialValue(req.body?.condition) || 'new',
                    installedAt: parseOptionalDateInput(req.body?.installedAt) || new Date(),
                    reason,
                    notes: normalizeSerialValue(req.body?.notes),
                },
                include: {
                    childAsset: {
                        select: {
                            customId: true,
                            name: true,
                            type: true,
                            category: true,
                            lifecycleStatus: true,
                        }
                    }
                }
            });

            if (installed.childAssetId) {
                await updateChildAssetLinkMetadata(tx, installed.childAssetId, {
                    lifecycleStatus: 'IN_USE',
                    status: 'ACTIVE',
                    parentAssetId: asset.customId,
                    parentAssetName: asset.name,
                    parentAssetTag: asset.assetTag || null,
                    componentType: installed.componentType,
                });
            }

            const maintenance = parseBooleanFlag(req.body?.createMaintenanceRecord)
                ? await tx.assetMaintenanceRecord.create({
                    data: {
                        assetId: req.params.id,
                        componentId: oldComponent.id,
                        maintenanceType: String(req.body?.maintenanceType || 'component_replacement'),
                        status: String(req.body?.maintenanceStatus || 'completed'),
                        performedBy: normalizeSerialValue(req.body?.performedBy),
                        performedAt: parseOptionalDateInput(req.body?.performedAt) || new Date(),
                        reason: normalizeSerialValue(req.body?.reason) || 'replaced_from_stock',
                        notes: normalizeSerialValue(req.body?.notes),
                    }
                })
                : null;

            return {
                oldComponent,
                installed,
                stockAfter: updatedStock,
                maintenance,
            };
        });

        await recordLifecycleEvent({
            assetId: req.params.id,
            componentId: result.oldComponent.id,
            eventType: 'component_replaced_out_stock',
            oldValue: result.oldComponent as unknown as Record<string, any>,
            newValue: {
                status: result.oldComponent.status,
                removedAt: result.oldComponent.removedAt,
            },
            reason: normalizeSerialValue(req.body?.reason) || 'replaced_from_stock',
            actor: String(req.body?.actor || ''),
        });
        await recordLifecycleEvent({
            assetId: req.params.id,
            componentId: result.installed.id,
            eventType: 'component_replaced_in_stock',
            newValue: {
                componentName: result.installed.componentName,
                componentType: result.installed.componentType,
                serialNumber: result.installed.serialNumber,
                partNumber: result.installed.partNumber,
                stockItemId: spareStockItemId,
            },
            reason: normalizeSerialValue(req.body?.reason) || 'replaced_from_stock',
            actor: String(req.body?.actor || ''),
        });
        await recordHistoryEvent({
            assetId: req.params.id,
            action: 'Component Replaced From Stock',
            details: `${result.oldComponent.componentName} replaced from spare stock`,
        });

        res.json({
            replaced: result.oldComponent,
            installed: result.installed,
            maintenance: result.maintenance,
            stock: result.stockAfter,
            lowStockWarning: isLowStock(result.stockAfter),
        });
    } catch (error: any) {
        if (error instanceof RequestValidationError) {
            return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: 'Failed to replace component from stock', error: error.message });
    }
});

app.post('/api/assets/:id/components/:componentId/repair', async (req: Request, res: Response) => {
    try {
        const component = await prisma.assetComponent.findUnique({ where: { id: req.params.componentId } });
        if (!component || component.parentAssetId !== req.params.id) {
            return res.status(404).json({ message: 'Component not found' });
        }
        const parentAsset = await AssetService.getAssetByCustomId(req.params.id);
        if (!parentAsset) return res.status(404).json({ message: 'Asset not found' });
        const reason = normalizeSerialValue(req.body?.reason) || 'repair';
        const repairedStatus = String(req.body?.status || 'under_repair').trim();
        const updated = await prisma.assetComponent.update({
            where: { id: component.id },
            data: {
                status: normalizeComponentStatus(repairedStatus, 'under_repair'),
                notes: normalizeSerialValue(req.body?.notes) || component.notes,
                reason,
            },
        });
        if (updated.childAssetId) {
            await updateChildAssetLinkMetadata(prisma, updated.childAssetId, {
                lifecycleStatus: normalizeComponentStatus(repairedStatus, 'under_repair') === 'installed'
                    ? 'IN_USE'
                    : 'PENDING_REPAIR',
                status: normalizeComponentStatus(repairedStatus, 'under_repair') === 'installed' ? 'ACTIVE' : 'REPAIR',
                parentAssetId: parentAsset.customId,
                parentAssetName: parentAsset.name,
                parentAssetTag: parentAsset.assetTag || null,
                componentType: updated.componentType,
            });
        }
        const maintenance = await prisma.assetMaintenanceRecord.create({
            data: {
                assetId: req.params.id,
                componentId: component.id,
                maintenanceType: String(req.body?.maintenanceType || 'component_repair'),
                status: String(req.body?.maintenanceStatus || 'completed'),
                performedBy: normalizeSerialValue(req.body?.performedBy),
                performedAt: parseOptionalDateInput(req.body?.performedAt) || new Date(),
                nextMaintenanceDate: parseOptionalDateInput(req.body?.nextMaintenanceDate),
                cost: parseOptionalNumberInput(req.body?.cost),
                reason,
                notes: normalizeSerialValue(req.body?.notes),
                linkedTicketId: normalizeSerialValue(req.body?.linkedTicketId),
            },
        });
        await recordLifecycleEvent({
            assetId: req.params.id,
            componentId: component.id,
            eventType: 'component_repaired',
            oldValue: component as unknown as Record<string, any>,
            newValue: updated as unknown as Record<string, any>,
            reason,
            notes: normalizeSerialValue(req.body?.notes),
            actor: String(req.body?.actor || ''),
        });
        await recordHistoryEvent({
            assetId: req.params.id,
            action: 'Component Repaired',
            details: `${component.componentName} repaired (${reason})`,
        });
        res.json({ component: updated, maintenance });
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to repair component', error: error.message });
    }
});

app.post('/api/assets/:id/components/:componentId/mark-failed', async (req: Request, res: Response) => {
    try {
        const component = await prisma.assetComponent.findUnique({ where: { id: req.params.componentId } });
        if (!component || component.parentAssetId !== req.params.id) {
            return res.status(404).json({ message: 'Component not found' });
        }
        const parentAsset = await AssetService.getAssetByCustomId(req.params.id);
        if (!parentAsset) return res.status(404).json({ message: 'Asset not found' });
        const reason = normalizeSerialValue(req.body?.reason) || 'failed';
        const updated = await prisma.assetComponent.update({
            where: { id: component.id },
            data: {
                status: 'failed',
                reason,
                notes: normalizeSerialValue(req.body?.notes) || component.notes,
            }
        });
        if (updated.childAssetId) {
            await updateChildAssetLinkMetadata(prisma, updated.childAssetId, {
                lifecycleStatus: 'PENDING_REPAIR',
                status: 'REPAIR',
                parentAssetId: parentAsset.customId,
                parentAssetName: parentAsset.name,
                parentAssetTag: parentAsset.assetTag || null,
                componentType: updated.componentType,
            });
        }
        await recordLifecycleEvent({
            assetId: req.params.id,
            componentId: component.id,
            eventType: 'component_marked_failed',
            oldValue: component as unknown as Record<string, any>,
            newValue: updated as unknown as Record<string, any>,
            reason,
            actor: String(req.body?.actor || ''),
        });
        await recordHistoryEvent({
            assetId: req.params.id,
            action: 'Component Failed',
            details: `${component.componentName} marked failed (${reason})`,
        });
        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to mark component failed', error: error.message });
    }
});

app.post('/api/assets/:id/components/:componentId/retire', async (req: Request, res: Response) => {
    try {
        const component = await prisma.assetComponent.findUnique({ where: { id: req.params.componentId } });
        if (!component || component.parentAssetId !== req.params.id) {
            return res.status(404).json({ message: 'Component not found' });
        }
        const nextStatus = normalizeComponentStatus(req.body?.status, 'retired');
        const reason = normalizeSerialValue(req.body?.reason) || 'retired';
        const updated = await prisma.assetComponent.update({
            where: { id: component.id },
            data: {
                status: nextStatus,
                removedAt: parseOptionalDateInput(req.body?.removedAt) || new Date(),
                reason,
                notes: normalizeSerialValue(req.body?.notes) || component.notes,
            }
        });
        if (updated.childAssetId) {
            await updateChildAssetLinkMetadata(prisma, updated.childAssetId, {
                lifecycleStatus: nextStatus === 'disposed' ? 'DISPOSED' : 'RETIRED',
                status: 'RETIRED',
                clearInstalledIn: true,
                componentType: updated.componentType,
            });
        }
        await recordLifecycleEvent({
            assetId: req.params.id,
            componentId: component.id,
            eventType: nextStatus === 'disposed' ? 'component_disposed' : 'component_retired',
            oldValue: component as unknown as Record<string, any>,
            newValue: updated as unknown as Record<string, any>,
            reason,
            actor: String(req.body?.actor || ''),
        });
        await recordHistoryEvent({
            assetId: req.params.id,
            action: nextStatus === 'disposed' ? 'Component Disposed' : 'Component Retired',
            details: `${component.componentName} ${nextStatus} (${reason})`,
        });
        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to retire component', error: error.message });
    }
});

app.get('/api/assets/:id/maintenance', async (req: Request, res: Response) => {
    try {
        const rows = await prisma.assetMaintenanceRecord.findMany({
            where: { assetId: req.params.id },
            orderBy: { createdAt: 'desc' },
        });
        res.json(rows);
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to fetch maintenance records', error: error.message });
    }
});

app.post('/api/assets/:id/maintenance', async (req: Request, res: Response) => {
    try {
        const asset = await AssetService.getAssetByCustomId(req.params.id);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });
        const row = await prisma.assetMaintenanceRecord.create({
            data: {
                assetId: req.params.id,
                componentId: normalizeSerialValue(req.body?.componentId),
                maintenanceType: String(req.body?.maintenanceType || '').trim() || 'general',
                status: String(req.body?.status || 'completed').trim(),
                performedBy: normalizeSerialValue(req.body?.performedBy),
                performedAt: parseOptionalDateInput(req.body?.performedAt) || new Date(),
                nextMaintenanceDate: parseOptionalDateInput(req.body?.nextMaintenanceDate),
                cost: parseOptionalNumberInput(req.body?.cost),
                reason: normalizeSerialValue(req.body?.reason),
                notes: normalizeSerialValue(req.body?.notes),
                linkedTicketId: normalizeSerialValue(req.body?.linkedTicketId),
            },
        });
        await recordLifecycleEvent({
            assetId: req.params.id,
            componentId: row.componentId || undefined,
            eventType: 'maintenance_record_added',
            newValue: row as unknown as Record<string, any>,
            reason: row.reason || undefined,
            notes: row.notes || undefined,
            actor: String(req.body?.actor || ''),
        });
        await recordHistoryEvent({
            assetId: req.params.id,
            action: 'Maintenance Record Added',
            details: `${row.maintenanceType} (${row.status})`,
        });
        res.status(201).json(row);
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to add maintenance record', error: error.message });
    }
});

app.get('/api/assets/:id/custody', async (req: Request, res: Response) => {
    try {
        const rows = await prisma.assetCustodyEvent.findMany({
            where: { assetId: req.params.id },
            orderBy: { createdAt: 'desc' },
        });
        res.json(rows);
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to fetch custody history', error: error.message });
    }
});

app.post('/api/assets/:id/assign', async (req: Request, res: Response) => {
    try {
        const asset = await AssetService.getAssetByCustomId(req.params.id);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });
        const assignedTo = normalizeSerialValue(req.body?.assignedToName);
        const assignedUserId = normalizeSerialValue(req.body?.assignedToUserId);
        const assignedDept = normalizeSerialValue(req.body?.assignedDepartment);
        const checkoutAt = parseOptionalDateInput(req.body?.checkoutDate) || new Date();
        const expectedAt = parseOptionalDateInput(req.body?.expectedReturnDate);
        const updated = await AssetService.updateAsset(req.params.id, {
            assignedToName: assignedTo,
            assignedToUserId: assignedUserId,
            assignedDepartment: assignedDept,
            checkoutDate: checkoutAt,
            expectedReturnDate: expectedAt,
            returnedDate: null,
            custodyStatus: 'CHECKED_OUT',
            assignedUser: assignedTo || assignedUserId,
            status: 'ASSIGNED',
            lifecycleStatus: 'ASSIGNED',
        });
        const custodyEvent = await prisma.assetCustodyEvent.create({
            data: {
                assetId: req.params.id,
                action: 'assign',
                assignedToName: assignedTo,
                assignedToUserId: assignedUserId,
                assignedDepartment: assignedDept,
                checkoutDate: checkoutAt,
                expectedReturnDate: expectedAt,
                conditionOut: normalizeSerialValue(req.body?.conditionOut),
                reason: normalizeSerialValue(req.body?.reason),
                notes: normalizeSerialValue(req.body?.notes),
                actor: normalizeSerialValue(req.body?.actor),
            },
        });
        await recordLifecycleEvent({
            assetId: req.params.id,
            eventType: 'asset_assigned',
            newValue: {
                assignedToName: assignedTo,
                assignedToUserId: assignedUserId,
                checkoutDate: checkoutAt.toISOString(),
                expectedReturnDate: expectedAt?.toISOString() || null,
            },
            reason: normalizeSerialValue(req.body?.reason),
            notes: normalizeSerialValue(req.body?.notes),
            actor: normalizeSerialValue(req.body?.actor),
        });
        await recordHistoryEvent({
            assetId: req.params.id,
            action: 'Asset Assigned',
            details: `Assigned to ${assignedTo || assignedUserId || 'unknown'}`,
        });
        res.json({ asset: updated, custodyEvent });
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to assign asset', error: error.message });
    }
});

app.post('/api/assets/:id/check-in', async (req: Request, res: Response) => {
    try {
        const asset = await AssetService.getAssetByCustomId(req.params.id);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });
        const returnedAt = parseOptionalDateInput(req.body?.returnedDate) || new Date();
        const updated = await AssetService.updateAsset(req.params.id, {
            returnedDate: returnedAt,
            custodyStatus: 'RETURNED',
            assignedUser: null,
            assignedToName: null,
            assignedToUserId: null,
            status: 'ACTIVE',
            lifecycleStatus: 'IN_STOCK',
        });
        const custodyEvent = await prisma.assetCustodyEvent.create({
            data: {
                assetId: req.params.id,
                action: 'check_in',
                returnedDate: returnedAt,
                conditionIn: normalizeSerialValue(req.body?.conditionIn),
                reason: normalizeSerialValue(req.body?.reason),
                notes: normalizeSerialValue(req.body?.notes),
                actor: normalizeSerialValue(req.body?.actor),
            },
        });
        await recordLifecycleEvent({
            assetId: req.params.id,
            eventType: 'asset_checked_in',
            oldValue: {
                assignedToName: (asset as any).assignedToName || null,
                assignedToUserId: (asset as any).assignedToUserId || null,
            },
            newValue: {
                returnedDate: returnedAt.toISOString(),
                custodyStatus: 'RETURNED',
            },
            reason: normalizeSerialValue(req.body?.reason),
            notes: normalizeSerialValue(req.body?.notes),
            actor: normalizeSerialValue(req.body?.actor),
        });
        await recordHistoryEvent({
            assetId: req.params.id,
            action: 'Asset Checked In',
            details: `Returned at ${returnedAt.toISOString()}`,
        });
        res.json({ asset: updated, custodyEvent });
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to check in asset', error: error.message });
    }
});

app.post('/api/assets/:id/loaner-checkout', inventoryAdminGuard, async (req: Request, res: Response) => {
    try {
        const asset = await AssetService.getAssetByCustomId(req.params.id);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });
        const category = String(asset.category || '').toLowerCase();
        if (['consumable', 'spare_part', 'license'].includes(category)) {
            return res.status(400).json({ message: 'This category is not supported for loaner checkout.' });
        }

        const loanedTo = normalizeSerialValue(req.body?.loanedTo || req.body?.assignedToName || req.body?.assignedToUserId);
        if (!loanedTo) return res.status(400).json({ message: 'loanedTo is required' });
        const expectedReturnDate = parseOptionalDateInput(req.body?.expectedReturnDate);
        const checkoutAt = parseOptionalDateInput(req.body?.loanedAt || req.body?.checkoutDate) || new Date();
        const reviewer = normalizeSerialValue(req.body?.actor) || 'inventory-loaner';
        const assignedDepartment = normalizeSerialValue(req.body?.assignedDepartment);

        const currentSpecs = readAssetSpecifications(asset);
        const nextSpecs = mergeAssetSpecifications(currentSpecs, {
            loanerEligible: true,
            loanerStatus: 'checked_out',
            loanedTo,
            loanedAt: checkoutAt.toISOString(),
            expectedReturnDate: expectedReturnDate?.toISOString() || null,
            returnedAt: null,
        });

        const updated = await AssetService.updateAsset(req.params.id, {
            specifications: nextSpecs,
            assignedToName: loanedTo,
            assignedToUserId: normalizeSerialValue(req.body?.assignedToUserId) || asset.assignedToUserId,
            assignedDepartment: assignedDepartment || asset.assignedDepartment,
            assignedUser: loanedTo,
            checkoutDate: checkoutAt,
            expectedReturnDate,
            returnedDate: null,
            custodyStatus: 'CHECKED_OUT',
            status: 'ASSIGNED',
            lifecycleStatus: 'ASSIGNED',
        });

        const custodyEvent = await prisma.assetCustodyEvent.create({
            data: {
                assetId: req.params.id,
                action: 'loaner_checkout',
                assignedToName: loanedTo,
                assignedToUserId: normalizeSerialValue(req.body?.assignedToUserId),
                assignedDepartment: assignedDepartment || null,
                checkoutDate: checkoutAt,
                expectedReturnDate: expectedReturnDate || null,
                conditionOut: normalizeSerialValue(req.body?.conditionOut),
                reason: normalizeSerialValue(req.body?.reason) || 'loaner_checkout',
                notes: normalizeSerialValue(req.body?.notes),
                actor: reviewer,
            },
        });

        await recordLifecycleEvent({
            assetId: req.params.id,
            eventType: 'loaner_checked_out',
            oldValue: {
                assignedToName: asset.assignedToName || null,
                checkoutDate: asset.checkoutDate?.toISOString() || null,
                expectedReturnDate: asset.expectedReturnDate?.toISOString() || null,
            },
            newValue: {
                assignedToName: updated.assignedToName || loanedTo,
                checkoutDate: checkoutAt.toISOString(),
                expectedReturnDate: expectedReturnDate?.toISOString() || null,
                loanerStatus: 'checked_out',
            },
            reason: normalizeSerialValue(req.body?.reason) || 'loaner_checkout',
            notes: normalizeSerialValue(req.body?.notes),
            actor: reviewer,
        });
        await recordHistoryEvent({
            assetId: req.params.id,
            action: 'Loaner Checked Out',
            details: `Loaned to ${loanedTo}${expectedReturnDate ? ` until ${expectedReturnDate.toISOString().slice(0, 10)}` : ''}`,
        });

        return res.json({
            success: true,
            asset: updated,
            custodyEvent,
            loaner: {
                loanerEligible: true,
                loanerStatus: 'checked_out',
                loanedTo,
                loanedAt: checkoutAt.toISOString(),
                expectedReturnDate: expectedReturnDate?.toISOString() || null,
            },
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to run loaner checkout', error: error.message });
    }
});

app.post('/api/assets/:id/loaner-return', inventoryAdminGuard, async (req: Request, res: Response) => {
    try {
        const asset = await AssetService.getAssetByCustomId(req.params.id);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });
        const returnedAt = parseOptionalDateInput(req.body?.returnedAt || req.body?.returnedDate) || new Date();
        const reviewer = normalizeSerialValue(req.body?.actor) || 'inventory-loaner';
        const returnLocationRaw = normalizeSerialValue(req.body?.location);
        const returnLocation = returnLocationRaw ? mapToAssetLocation(returnLocationRaw) : asset.location;

        const currentSpecs = readAssetSpecifications(asset);
        const nextSpecs = mergeAssetSpecifications(currentSpecs, {
            loanerEligible: parseBooleanFlag(currentSpecs.loanerEligible) || true,
            loanerStatus: 'returned',
            returnedAt: returnedAt.toISOString(),
        });

        const updated = await AssetService.updateAsset(req.params.id, {
            specifications: nextSpecs,
            location: returnLocation,
            returnedDate: returnedAt,
            custodyStatus: 'RETURNED',
            assignedUser: null,
            assignedToName: null,
            assignedToUserId: null,
            status: 'ACTIVE',
            lifecycleStatus: 'IN_STOCK',
        });

        const custodyEvent = await prisma.assetCustodyEvent.create({
            data: {
                assetId: req.params.id,
                action: 'loaner_return',
                returnedDate: returnedAt,
                conditionIn: normalizeSerialValue(req.body?.conditionIn),
                reason: normalizeSerialValue(req.body?.reason) || 'loaner_return',
                notes: normalizeSerialValue(req.body?.notes),
                actor: reviewer,
            },
        });

        await recordLifecycleEvent({
            assetId: req.params.id,
            eventType: 'loaner_returned',
            oldValue: {
                assignedToName: asset.assignedToName || null,
                location: String(asset.location),
            },
            newValue: {
                location: String(updated.location),
                returnedDate: returnedAt.toISOString(),
                loanerStatus: 'returned',
            },
            reason: normalizeSerialValue(req.body?.reason) || 'loaner_return',
            notes: normalizeSerialValue(req.body?.notes),
            actor: reviewer,
        });
        await recordHistoryEvent({
            assetId: req.params.id,
            action: 'Loaner Returned',
            details: `Loaner returned${returnLocationRaw ? ` to ${mapLocationToFriendly(returnLocation)}` : ''}`,
        });

        return res.json({
            success: true,
            asset: updated,
            custodyEvent,
            loaner: {
                loanerEligible: parseBooleanFlag(nextSpecs.loanerEligible),
                loanerStatus: 'returned',
                returnedAt: returnedAt.toISOString(),
            },
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to return loaner asset', error: error.message });
    }
});

app.get('/api/inventory/loaners', inventoryReadGuard, async (_req: Request, res: Response) => {
    try {
        const assets = await prisma.asset.findMany({
            orderBy: { updatedAt: 'desc' },
            take: 5000,
        });
        const now = new Date();
        const rows = assets
            .map((asset) => {
                const specs = readAssetSpecifications(asset);
                const eligible = parseBooleanFlag(specs.loanerEligible);
                const status = String(specs.loanerStatus || '').trim().toLowerCase();
                const expected = parseOptionalDateInput(specs.expectedReturnDate || asset.expectedReturnDate);
                const overdue = Boolean(status === 'checked_out' && expected && expected.getTime() < now.getTime());
                if (!eligible && !status) return null;
                return {
                    assetId: asset.customId,
                    name: asset.name,
                    category: String(asset.category || '').toLowerCase(),
                    type: canonicalAssetType(asset.type),
                    location: mapLocationToFriendly(asset.location),
                    department: mapDepartmentToFriendly(asset.department),
                    loanerEligible: eligible,
                    loanerStatus: overdue ? 'overdue' : (status || 'available'),
                    loanedTo: normalizeSerialValue(specs.loanedTo || asset.assignedToName || asset.assignedToUserId),
                    loanedAt: specs.loanedAt || asset.checkoutDate?.toISOString() || null,
                    expectedReturnDate: expected?.toISOString() || null,
                    returnedAt: specs.returnedAt || asset.returnedDate?.toISOString() || null,
                };
            })
            .filter(Boolean);
        return res.json(rows);
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to fetch loaner inventory', error: error.message });
    }
});

app.get('/api/inventory/audit-board', inventoryReadGuard, async (req: Request, res: Response) => {
    try {
        const staleAfterDays = Math.max(1, Math.min(3650, parseOptionalIntegerInput(req.query.staleAfterDays) || 90));
        const assets = await prisma.asset.findMany({
            orderBy: { updatedAt: 'desc' },
            take: 7000,
        });
        const now = new Date();
        const rows: Array<Record<string, any>> = [];
        const verifierPoints: Record<string, number> = {};
        const byLocation: Record<string, number> = {};

        assets.forEach((asset) => {
            const specs = readAssetSpecifications(asset);
            const verificationStatusRaw = String(specs.verificationStatus || 'pending').trim().toLowerCase();
            const lastVerifiedAt = parseOptionalDateInput(specs.lastVerifiedAt);
            const verificationLocation = normalizeSerialValue(specs.verificationLocation);
            const lastVerifiedBy = normalizeSerialValue(specs.lastVerifiedBy);
            const daysSinceVerification = lastVerifiedAt
                ? Math.floor((now.getTime() - lastVerifiedAt.getTime()) / 86400000)
                : null;
            const mismatch = verificationLocation
                ? computeWifiLocationMismatch(asset.location, verificationLocation)
                : false;

            let boardStatus = 'verified';
            if (verificationStatusRaw === 'missing') boardStatus = 'missing';
            else if (!lastVerifiedAt) boardStatus = 'needs_verification';
            else if (daysSinceVerification !== null && daysSinceVerification > staleAfterDays) boardStatus = 'stale_verification';
            else if (mismatch) boardStatus = 'location_mismatch';

            if (boardStatus !== 'verified') {
                rows.push({
                    assetId: asset.customId,
                    name: asset.name,
                    category: String(asset.category || '').toLowerCase(),
                    type: canonicalAssetType(asset.type),
                    status: boardStatus,
                    location: mapLocationToFriendly(asset.location),
                    department: mapDepartmentToFriendly(asset.department),
                    verificationLocation: verificationLocation || null,
                    lastVerifiedAt: lastVerifiedAt?.toISOString() || null,
                    lastVerifiedBy: lastVerifiedBy || null,
                    daysSinceVerification,
                });
            }

            const locationKey = mapLocationToFriendly(asset.location);
            byLocation[locationKey] = (byLocation[locationKey] || 0) + 1;
            if (lastVerifiedBy) verifierPoints[lastVerifiedBy] = (verifierPoints[lastVerifiedBy] || 0) + 1;
        });

        const counts = {
            totalAssets: assets.length,
            needsVerification: rows.filter((row) => row.status === 'needs_verification').length,
            missing: rows.filter((row) => row.status === 'missing').length,
            staleVerification: rows.filter((row) => row.status === 'stale_verification').length,
            locationMismatch: rows.filter((row) => row.status === 'location_mismatch').length,
        };

        return res.json({
            staleAfterDays,
            counts,
            assetsNeedingAttention: rows.slice(0, 1200),
            topLocations: Object.entries(byLocation)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 12)
                .map(([location, count]) => ({ location, count })),
            verifierPoints: Object.entries(verifierPoints)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 15)
                .map(([name, points]) => ({ name, points })),
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to fetch audit board', error: error.message });
    }
});

app.post('/api/assets/:id/verify-location', inventoryAdminGuard, async (req: Request, res: Response) => {
    try {
        const asset = await AssetService.getAssetByCustomId(req.params.id);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });
        const verifier = normalizeSerialValue(req.body?.verifier || req.body?.actor) || 'inventory-audit';
        const markMissing = parseBooleanFlag(req.body?.markMissing);
        const reportedLocationRaw = normalizeSerialValue(req.body?.location);
        const reportedLocation = reportedLocationRaw ? mapToAssetLocation(reportedLocationRaw) : asset.location;
        const now = new Date();

        const currentSpecs = readAssetSpecifications(asset);
        const verificationStatus = markMissing ? 'missing' : 'verified';
        const verificationLocation = mapLocationToFriendly(reportedLocation);
        const nextSpecs = mergeAssetSpecifications(currentSpecs, {
            verificationStatus,
            verificationLocation,
            lastVerifiedAt: now.toISOString(),
            lastVerifiedBy: verifier,
            missingFlag: markMissing,
        });

        const updatePayload: Record<string, any> = { specifications: nextSpecs };
        if (!markMissing && reportedLocationRaw) {
            updatePayload.location = reportedLocation;
        }
        const updated = await AssetService.updateAsset(req.params.id, updatePayload);

        await recordLifecycleEvent({
            assetId: req.params.id,
            eventType: markMissing ? 'asset_marked_missing' : 'asset_location_verified',
            oldValue: {
                location: String(asset.location),
                verificationStatus: String(currentSpecs.verificationStatus || 'pending'),
            },
            newValue: {
                location: String(updated.location),
                verificationStatus,
                verificationLocation,
                lastVerifiedAt: now.toISOString(),
                lastVerifiedBy: verifier,
            },
            reason: markMissing ? 'audit_mark_missing' : 'audit_verify_location',
            actor: verifier,
        });
        await recordHistoryEvent({
            assetId: req.params.id,
            action: markMissing ? 'Marked Missing (Audit)' : 'Location Verified (Audit)',
            details: markMissing
                ? `Marked missing by ${verifier}`
                : `Verified at ${verificationLocation} by ${verifier}`,
        });

        return res.json({
            success: true,
            asset: updated,
            verification: {
                status: verificationStatus,
                location: verificationLocation,
                verifiedAt: now.toISOString(),
                verifiedBy: verifier,
            },
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to verify asset location', error: error.message });
    }
});

app.post('/api/assets/:id/mock-wifi-location', inventoryAdminGuard, async (req: Request, res: Response) => {
    try {
        const asset = await AssetService.getAssetByCustomId(req.params.id);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });
        const currentSpecs = readAssetSpecifications(asset);
        const macAddress = normalizeSerialValue(req.body?.macAddress || currentSpecs.macAddress);
        const lastSeenNetwork = normalizeSerialValue(req.body?.lastSeenNetwork || currentSpecs.lastSeenNetwork);
        const lastSeenAccessPoint = normalizeSerialValue(req.body?.lastSeenAccessPoint || currentSpecs.lastSeenAccessPoint);
        const seenLocationRaw = normalizeSerialValue(req.body?.lastSeenLocation || req.body?.location || currentSpecs.lastSeenLocation);
        const seenLocation = seenLocationRaw ? mapLocationToFriendly(seenLocationRaw) : null;
        const seenAt = parseOptionalDateInput(req.body?.lastSeenAt || req.body?.seenAt) || new Date();
        const mismatch = computeWifiLocationMismatch(asset.location, seenLocation || '');
        const reviewer = normalizeSerialValue(req.body?.actor) || 'inventory-wifi-mock';

        const nextSpecs = mergeAssetSpecifications(currentSpecs, {
            macAddress: macAddress || null,
            lastSeenNetwork: lastSeenNetwork || null,
            lastSeenAccessPoint: lastSeenAccessPoint || null,
            lastSeenLocation: seenLocation || null,
            lastSeenTimestamp: seenAt.toISOString(),
            networkLocationMismatch: mismatch,
        });

        const updated = await AssetService.updateAsset(req.params.id, { specifications: nextSpecs });
        await recordLifecycleEvent({
            assetId: req.params.id,
            eventType: 'mock_wifi_location_updated',
            newValue: {
                macAddress: macAddress || null,
                lastSeenNetwork: lastSeenNetwork || null,
                lastSeenAccessPoint: lastSeenAccessPoint || null,
                lastSeenLocation: seenLocation || null,
                lastSeenTimestamp: seenAt.toISOString(),
                networkLocationMismatch: mismatch,
            },
            reason: 'mock_wifi_update',
            actor: reviewer,
        });
        await recordHistoryEvent({
            assetId: req.params.id,
            action: 'Mock Wi-Fi Location Updated',
            details: seenLocation
                ? `Last seen at ${seenLocation}${mismatch ? ' (location mismatch)' : ''}`
                : 'Wi-Fi signal metadata updated',
        });

        return res.json({
            success: true,
            asset: updated,
            wifiTracking: {
                macAddress: macAddress || null,
                lastSeenNetwork: lastSeenNetwork || null,
                lastSeenAccessPoint: lastSeenAccessPoint || null,
                lastSeenLocation: seenLocation || null,
                lastSeenTimestamp: seenAt.toISOString(),
                networkLocationMismatch: mismatch,
                warning: mismatch
                    ? `Network location mismatch: assigned location is ${mapLocationToFriendly(asset.location)} but last seen at ${seenLocation}.`
                    : null,
            },
            note: 'Mock/manual Wi-Fi tracking only in this pass. Real controller/AP integration is future work.',
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to update mock Wi-Fi location', error: error.message });
    }
});

app.get('/api/assets/:id/relationships', async (req: Request, res: Response) => {
    try {
        const outgoing = await prisma.assetRelationship.findMany({
            where: { assetId: req.params.id },
            orderBy: { createdAt: 'desc' },
        });
        const incoming = await prisma.assetRelationship.findMany({
            where: { relatedAssetId: req.params.id },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ outgoing, incoming });
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to fetch relationships', error: error.message });
    }
});

app.post('/api/assets/:id/relationships', async (req: Request, res: Response) => {
    try {
        const assetId = req.params.id;
        const relatedAssetId = normalizeSerialValue(req.body?.relatedAssetId);
        const relationshipType = String(req.body?.relationshipType || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
        if (!relatedAssetId || !relationshipType) {
            return res.status(400).json({ message: 'relatedAssetId and relationshipType are required' });
        }
        const [source, target] = await Promise.all([
            AssetService.getAssetByCustomId(assetId),
            AssetService.getAssetByCustomId(relatedAssetId),
        ]);
        if (!source || !target) return res.status(404).json({ message: 'One or both assets not found' });

        const row = await prisma.assetRelationship.create({
            data: {
                assetId,
                relatedAssetId,
                relationshipType,
                notes: normalizeSerialValue(req.body?.notes),
            },
        });
        await recordLifecycleEvent({
            assetId,
            eventType: 'relationship_added',
            newValue: row as unknown as Record<string, any>,
            notes: row.notes || undefined,
            actor: normalizeSerialValue(req.body?.actor),
        });
        await recordHistoryEvent({
            assetId,
            action: 'Relationship Added',
            details: `${assetId} ${relationshipType} ${relatedAssetId}`,
        });
        res.status(201).json(row);
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to add relationship', error: error.message });
    }
});

app.delete('/api/assets/:id/relationships/:relationshipId', async (req: Request, res: Response) => {
    try {
        const row = await prisma.assetRelationship.findUnique({ where: { id: req.params.relationshipId } });
        if (!row || row.assetId !== req.params.id) {
            return res.status(404).json({ message: 'Relationship not found' });
        }
        await prisma.assetRelationship.delete({ where: { id: row.id } });
        await recordLifecycleEvent({
            assetId: req.params.id,
            eventType: 'relationship_removed',
            oldValue: row as unknown as Record<string, any>,
            actor: normalizeSerialValue(req.body?.actor),
        });
        await recordHistoryEvent({
            assetId: req.params.id,
            action: 'Relationship Removed',
            details: `${row.assetId} ${row.relationshipType} ${row.relatedAssetId}`,
        });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to remove relationship', error: error.message });
    }
});

app.get('/api/assets/:id/eol-assessment', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const asset = await AssetService.getAssetByCustomId(id);
        if (!asset) return res.status(404).json({ message: "Asset not found" });
        const assessment = await buildAssetEolAssessment(asset);
        try {
            await persistEolAssessment({
                assetId: assessment.assetId,
                status: assessment.status,
                predictedEolDate: assessment.predictedEolDate,
                monthsRemaining: assessment.monthsRemaining,
                confidence: assessment.confidence,
                reason: assessment.reason,
                evidenceLevel: assessment.evidenceLevel,
                predictionSource: assessment.predictionSource,
                telemetryStatus: assessment.telemetryStatus,
                specEvidenceStatus: assessment.specEvidenceStatus,
                suitableForProcurementPlanning: assessment.suitableForProcurementPlanning,
                procurementRecommended: assessment.procurementRecommended,
                procurementWindowMonths: assessment.procurementWindowMonths,
                generatedAt: assessment.generatedAt,
            });
        } catch (persistError: any) {
            console.warn(`[InventoryAI] canonical EOL assessment persistence failed for ${id}: ${persistError.message}`);
        }
        res.json(assessment);
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to compute EOL assessment', error: error.message });
    }
});

app.post('/api/assets/:id/eol-explanation', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const asset = await AssetService.getAssetByCustomId(id);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });
        const assessment = await buildAssetEolAssessment(asset);
        const payload = {
            assessment,
            telemetryStatus: assessment.telemetryStatus,
            specEvidenceStatus: assessment.specEvidenceStatus,
            predictedLifespanYears: assessment.predictedLifespanYears,
            confidence: assessment.confidence,
            procurementSuitable: assessment.suitableForProcurementPlanning,
        };
        const ai = await callInventoryAiHelper('/explain-eol-assessment', payload, 7_000);
        if (!ai) {
            return res.json(buildEolExplanationFallback(assessment));
        }
        return res.json({
            shortUserExplanation: String(ai.short_user_explanation || buildEolExplanationFallback(assessment).shortUserExplanation),
            technicalExplanation: String(ai.technical_explanation || buildEolExplanationFallback(assessment).technicalExplanation),
            llmUsed: Boolean(ai.llm_used),
        } as EolExplanationHelperResponse);
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to generate EOL explanation', error: error.message });
    }
});

app.post('/api/assets/:id/ai-health-summary', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const asset = await AssetService.getAssetByCustomId(id);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });
        const includeRelated = typeof req.body?.includeRelated === 'undefined'
            ? true
            : parseBooleanFlag(req.body?.includeRelated);

        const [timeline, assessment, components, maintenanceCount] = await Promise.all([
            buildCombinedHistoryTimeline(id, includeRelated),
            buildAssetEolAssessment(asset),
            prisma.assetComponent.findMany({
                where: { parentAssetId: id },
                orderBy: { updatedAt: 'desc' },
                take: 300,
            }),
            prisma.assetMaintenanceRecord.count({
                where: { assetId: id },
            }),
        ]);

        const helperPayload = {
            asset: {
                customId: asset.customId,
                name: asset.name,
                type: asset.type,
                category: asset.category,
                status: asset.status,
                lifecycleStatus: asset.lifecycleStatus,
                serialNumber: asset.serialNumber,
                assetTag: asset.assetTag,
                purchaseDate: asset.purchaseDate ? asset.purchaseDate.toISOString() : null,
                warrantyEndDate: asset.warrantyEndDate ? asset.warrantyEndDate.toISOString() : null,
                location: asset.location,
                department: asset.department,
                specifications: asset.specifications || {},
            },
            eolAssessment: assessment,
            includeRelated,
            historyEvents: timeline.slice(0, 120).map((entry) => ({
                date: entry.date,
                event: entry.event,
                eventType: entry.eventType,
                sourceItemType: entry.sourceItemType,
                sourceItemName: entry.sourceItemName,
                sourceItemCustomId: entry.sourceItemCustomId,
                details: entry.details,
                reason: entry.reason,
            })),
            components: components.slice(0, 120).map((component) => ({
                id: component.id,
                name: component.componentName,
                type: component.componentType,
                status: component.status,
                condition: component.condition,
                serialNumber: component.serialNumber,
                partNumber: component.partNumber,
                installedAt: component.installedAt ? component.installedAt.toISOString() : null,
                removedAt: component.removedAt ? component.removedAt.toISOString() : null,
            })),
            maintenanceCount,
        };

        const ai = await callInventoryAiHelper('/summarize-asset-health', helperPayload, 12_000);
        if (!ai) {
            return res.json(buildAiHealthSummaryFallback({
                asset,
                timeline,
                assessment,
            }));
        }

        const fallback = buildAiHealthSummaryFallback({
            asset,
            timeline,
            assessment,
        });
        const confidenceRaw = normalizeValue(ai.confidence || fallback.confidence);
        const confidence: 'low' | 'medium' | 'high' = confidenceRaw === 'high'
            ? 'high'
            : confidenceRaw === 'medium'
                ? 'medium'
                : 'low';
        return res.json({
            summary: String(ai.summary || fallback.summary),
            risks: Array.isArray(ai.risks) ? ai.risks.map((item: unknown) => String(item || '').trim()).filter(Boolean).slice(0, 12) : fallback.risks,
            recentChanges: Array.isArray(ai.recent_changes)
                ? ai.recent_changes.map((item: unknown) => String(item || '').trim()).filter(Boolean).slice(0, 12)
                : fallback.recentChanges,
            componentIssues: Array.isArray(ai.component_issues)
                ? ai.component_issues.map((item: unknown) => String(item || '').trim()).filter(Boolean).slice(0, 12)
                : fallback.componentIssues,
            warrantyEolConcerns: Array.isArray(ai.warranty_eol_concerns)
                ? ai.warranty_eol_concerns.map((item: unknown) => String(item || '').trim()).filter(Boolean).slice(0, 12)
                : fallback.warrantyEolConcerns,
            recommendations: Array.isArray(ai.recommendations)
                ? ai.recommendations.map((item: unknown) => String(item || '').trim()).filter(Boolean).slice(0, 12)
                : fallback.recommendations,
            confidence,
            missingData: Array.isArray(ai.missing_data)
                ? ai.missing_data.map((item: unknown) => String(item || '').trim()).filter(Boolean).slice(0, 24)
                : fallback.missingData,
            llmUsed: Boolean(ai.llm_used),
        } as AiHealthSummaryHelperResponse);
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to generate AI health summary', error: error.message });
    }
});

app.get('/api/assets/:id/ai-jobs', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const asset = await AssetService.getAssetByCustomId(id);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });
        const summary = await readAssetPipelineSummary(id);
        return res.json(summary);
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to read AI job status', error: error.message });
    }
});

app.get('/api/assets/ai-jobs/status', async (req: Request, res: Response) => {
    try {
        const raw = String(req.query.assetIds || '').trim();
        const assetIds = raw
            ? raw.split(',').map((value) => value.trim()).filter(Boolean)
            : [];
        if (!assetIds.length) {
            return res.json({ summaries: {} });
        }
        const uniqueAssetIds = Array.from(new Set(assetIds));
        const summaries = await Promise.all(
            uniqueAssetIds.map(async (assetId) => {
                const summary = await readAssetPipelineSummary(assetId);
                return [assetId, summary] as const;
            })
        );
        return res.json({
            summaries: Object.fromEntries(summaries),
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to read AI job status summaries', error: error.message });
    }
});

// --- CATCH-ALL FETCH ROUTE ---
app.get('/api/assets/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const asset = await AssetService.getAssetByCustomId(id);

        if (!asset) return res.status(404).json({ message: "Asset not found" });
        res.json(annotateAssetWithTruthfulSignals(asset));
    } catch (err) {
        res.status(500).json({ message: "Server error fetching asset" });
    }
});

// --- CREATE LOGIC ---
app.post('/api/assets', inventoryAdminGuard, async (req: Request, res: Response) => {
    try {
        console.log(`📥 POST /api/assets from ${req.ip} - headers: ${JSON.stringify(req.headers)}`);
        console.log('📦 Payload:', JSON.stringify(req.body));

        const {
            name,
            type,
            value,
            customId,
            location,
            department,
            quantity,
            specifications,
            admin,
            specConfirmationReviewed,
            specConfirmationReviewedBy,
            serialNumber,
            serialNumbers,
            serialNumbersText,
            assetTag,
            assetTags,
            manufacturerPartNumber,
            category,
            lifecycleStatus,
            assignedToName,
            assignedToUserId,
            assignedDepartment,
            checkoutDate,
            expectedReturnDate,
            returnedDate,
            custodyStatus,
            purchaseDate,
            vendor,
            purchaseCost,
            invoiceNumber,
            purchaseOrderNumber,
            warrantyStartDate,
            warrantyEndDate,
            replacementCost,
        } = req.body;
        if (!String(name || '').trim()) {
            return res.status(400).json({ message: 'Asset name is required.' });
        }
        if (!String(type || '').trim()) {
            return res.status(400).json({ message: 'Asset type is required.' });
        }
        const inputSpecifications = (specifications && typeof specifications === 'object')
            ? stripLifecycleManagedSpecFields(specifications as Record<string, any>)
            : {};
        const reviewedOnCreate = parseBooleanFlag(
            specConfirmationReviewed ?? inputSpecifications.specVerificationConfirmedOnCreate
        );
        const reviewedBy = String(
            specConfirmationReviewedBy
            || inputSpecifications.specVerificationReviewedBy
            || admin?.email
            || admin?.name
            || 'asset_creator'
        ).trim();
        const normalizedCategory = mapToAssetCategory(category);

        const locationResolution = resolveAssetLocationForStorage(location || 'Central Warehouse');
        const enrichedSpecificationsBase: Record<string, any> = {
            ...inputSpecifications,
            mapLocationHint: normalizeSerialValue(inputSpecifications.mapLocationHint)
                || locationResolution.mapLocationHint
                || undefined,
            specVerificationConfirmedOnCreate: reviewedOnCreate,
            specVerificationReviewedBy: reviewedOnCreate ? reviewedBy : undefined,
            specVerificationReviewedAt: reviewedOnCreate ? new Date().toISOString() : undefined,
            specVerificationAction: reviewedOnCreate
                ? 'confirmed_on_create'
                : (inputSpecifications.specVerificationAction || undefined),
            specVerificationStatus: reviewedOnCreate
                ? 'verified'
                : (String(inputSpecifications.specVerificationStatus || '').trim() || 'pending'),
            aiSpecEvidenceStatus: String(inputSpecifications.aiSpecEvidenceStatus || 'insufficient_source_evidence'),
            aiSpecEvidenceReason: String(
                inputSpecifications.aiSpecEvidenceReason
                || 'No trusted exact source evidence found. Manual review recommended.'
            ),
        };
        const trackTelemetry = (
            enrichedSpecificationsBase.trackWorkingHours === true
            || String(enrichedSpecificationsBase.trackWorkingHours || '').toLowerCase() === 'true'
            || enrichedSpecificationsBase.telemetryEnabled === true
            || String(enrichedSpecificationsBase.telemetryEnabled || '').toLowerCase() === 'true'
        ) || isTelemetryCapableAsset({ type, category: normalizedCategory, name });
        const enrichedSpecifications = buildTelemetryDefaultsForAsset({
            type,
            category: normalizedCategory,
            name,
            existingSpecs: {
                ...enrichedSpecificationsBase,
                trackWorkingHours: trackTelemetry,
                telemetryEnabled: trackTelemetry,
            },
            location,
        });

        const qty = parseRequestedQuantity(quantity ?? 1);
        const assetGroupId = String(customId || `ASSET-${Date.now()}`).trim();
        const unitIds = buildUnitAssetIds(assetGroupId, qty);
        const normalizedLifecycleStatus = mapToLifecycleStatus(lifecycleStatus || (assignedToName || assignedToUserId ? 'assigned' : 'in_stock'));
        const normalizedCustodyStatus = mapToCustodyStatus(custodyStatus || (assignedToName || assignedToUserId ? 'checked_out' : 'unassigned'));

        const parsedSerials = qty > 1
            ? parseSerialValues(serialNumbers ?? serialNumbersText)
            : [normalizeSerialValue(serialNumber)].filter((value): value is string => Boolean(value));
        const parsedAssetTags = qty > 1
            ? parseSerialValues(assetTags)
            : [normalizeSerialValue(assetTag)].filter((value): value is string => Boolean(value));

        const duplicateSerialsInPayload = Array.from(
            parsedSerials.reduce((dups, rawSerial, _idx, arr) => {
                const key = rawSerial.toLowerCase();
                if (arr.filter((entry) => entry.toLowerCase() === key).length > 1) dups.add(rawSerial);
                return dups;
            }, new Set<string>())
        );
        const uniqueSerialInputs = Array.from(new Set(parsedSerials.map((serial) => serial.toLowerCase())));
        const existingSerialMatches = uniqueSerialInputs.length
            ? await prisma.asset.findMany({
                where: {
                    OR: uniqueSerialInputs.map((serialLower) => ({
                        serialNumber: { equals: serialLower }
                    })),
                },
                select: { customId: true, serialNumber: true },
                take: 100,
            })
            : [];
        const duplicateSerialsExisting = existingSerialMatches.map((entry) => String(entry.serialNumber || '').trim()).filter(Boolean);
        const serialWarnings: string[] = [];
        if (duplicateSerialsInPayload.length) {
            serialWarnings.push(`Duplicate serials in request: ${duplicateSerialsInPayload.join(', ')}`);
        }
        if (duplicateSerialsExisting.length) {
            serialWarnings.push(`Serials already exist on assets: ${duplicateSerialsExisting.join(', ')}`);
        }
        if (qty > 1 && parsedSerials.length > 0 && parsedSerials.length < qty) {
            serialWarnings.push(`Only ${parsedSerials.length}/${qty} serial numbers were provided. Remaining units were created without serial numbers.`);
        }

        console.log(`[AssetCreateDebug] quantityRequested=${qty} generatedUnitIds=${unitIds.length}`);

        const createdAssets = await AssetService.createAssets(
            unitIds.map((unitId, index) => ({
                customId: unitId,
                name: String(name),
                type: mapToAssetType(type),
                status: 'ACTIVE',
                lifecycleStatus: normalizedLifecycleStatus,
                category: normalizedCategory,
                value: value || 0,
                serialNumber: parsedSerials[index] || null,
                assetTag: parsedAssetTags[index] || (qty === 1 ? normalizeSerialValue(assetTag) : null),
                manufacturerPartNumber: normalizeSerialValue(manufacturerPartNumber),
                location: locationResolution.location,
                department: mapToAssetDepartment(department || 'Unassigned'),
                assignedToName: normalizeSerialValue(assignedToName),
                assignedToUserId: normalizeSerialValue(assignedToUserId),
                assignedDepartment: normalizeSerialValue(assignedDepartment),
                checkoutDate: parseOptionalDateInput(checkoutDate),
                expectedReturnDate: parseOptionalDateInput(expectedReturnDate),
                returnedDate: parseOptionalDateInput(returnedDate),
                custodyStatus: normalizedCustodyStatus,
                purchaseDate: parseOptionalDateInput(purchaseDate),
                vendor: normalizeSerialValue(vendor),
                purchaseCost: parseOptionalNumberInput(purchaseCost),
                invoiceNumber: normalizeSerialValue(invoiceNumber),
                purchaseOrderNumber: normalizeSerialValue(purchaseOrderNumber),
                warrantyStartDate: parseOptionalDateInput(warrantyStartDate),
                warrantyEndDate: parseOptionalDateInput(warrantyEndDate),
                replacementCost: parseOptionalNumberInput(replacementCost),
                quantity: 1,
                specifications: enrichedSpecifications,
            }))
        );
        console.log(`[AssetCreateDebug] insertedRecords=${createdAssets.length} requestedQuantity=${qty}`);

        const enqueueResults = await Promise.all(
            createdAssets.map(async (createdAsset) => {
                try {
                    await enqueueInitialAssetCreatedJobs({
                        assetId: createdAsset.customId,
                        trigger: 'asset_created',
                        requestId: crypto.randomUUID(),
                        specConfirmationReviewed: reviewedOnCreate,
                        specConfirmationReviewedBy: reviewedBy,
                    });
                    return { assetId: createdAsset.customId, status: 'queued' as const };
                } catch (error: any) {
                    console.warn(`[InventoryAIJobs] failed to enqueue asset-created job for ${createdAsset.customId}: ${error?.message || error}`);
                    return {
                        assetId: createdAsset.customId,
                        status: 'enqueue_failed' as const,
                        error: String(error?.message || error),
                    };
                }
            })
        );

        const queuedJobs = enqueueResults.filter((result) => result.status === 'queued').length;
        const failedJobs = enqueueResults.length - queuedJobs;

        const LOW_STOCK_THRESHOLD = 5;
        if (createdAssets.length === LOW_STOCK_THRESHOLD) {
            await publishLowStockEvent({
                itemId: assetGroupId,
                itemName: String(name),
                admin,
            });
        }

        await Promise.all(
            createdAssets.map((createdAsset, index) =>
                EventBus.publish(TOPICS.ASSET_CREATED, {
                    customId: createdAsset.customId,
                    quantity: createdAsset.quantity,
                    location: String(createdAsset.location),
                    department: String(createdAsset.department),
                    status: String(createdAsset.status),
                    timestamp: new Date().toISOString(),
                    source: 'inventory-backend',
                    historyAction: 'Created',
                    historyDetails: qty > 1
                        ? `Bulk asset created (${index + 1}/${qty}) in group ${assetGroupId}`
                        : 'Asset Created',
                })
            )
        );
        await Promise.all(
            createdAssets.map((createdAsset) =>
                recordLifecycleEvent({
                    assetId: createdAsset.customId,
                    eventType: 'asset_created',
                    newValue: {
                        status: createdAsset.status,
                        lifecycleStatus: createdAsset.lifecycleStatus,
                        category: createdAsset.category,
                        serialNumber: createdAsset.serialNumber,
                        assetTag: createdAsset.assetTag,
                    },
                    notes: 'Asset created',
                    actor: String(admin?.email || admin?.name || 'inventory-admin'),
                })
            )
        );

        res.status(201).json({
            message: `Successfully created ${createdAssets.length} asset unit(s).`,
            quantityRequested: qty,
            createdCount: createdAssets.length,
            assetGroupId,
            asset: createdAssets[0],
            assets: createdAssets,
            backgroundProcessing: {
                status: failedJobs === 0 ? 'queued' : (queuedJobs > 0 ? 'partially_queued' : 'enqueue_failed'),
                queuedJobs,
                failedJobs,
                queueJobType: 'inventory.ai.asset_created',
                message: failedJobs === 0
                    ? 'Assets created. AI/EOL processing is running in background.'
                    : 'Assets created, but some background AI jobs could not be queued.',
            },
            specConfirmation: {
                reviewed: reviewedOnCreate,
                reviewedBy: reviewedOnCreate ? reviewedBy : null,
            },
            serialNumberSummary: {
                provided: parsedSerials.length,
                duplicatesInPayload: duplicateSerialsInPayload,
                duplicatesExisting: duplicateSerialsExisting,
                warnings: serialWarnings,
            },
        });

    } catch (error: any) {
        console.error('[AssetCreate] POST Error:', error.message);
        if (error instanceof RequestValidationError) {
            return res.status(400).json({ message: error.message });
        }
        if (error.code === 'P2002') return res.status(400).json({ message: 'Asset ID already exists. Try a different ID.' });
        res.status(500).json({ message: error.message });
    }
});

type RelatedTransferOptions = {
    includeRelated: boolean;
    includeComponents: boolean;
    includeAccessories: boolean;
    includeLicenses: boolean;
    includeConsumables: boolean;
};

function parseRelatedTransferOptions(payload: any): RelatedTransferOptions {
    const includeRelated = parseBooleanFlag(payload?.includeRelated);
    const includeComponents = includeRelated && parseBooleanFlag(
        payload?.includeComponents ?? true
    );
    const includeAccessories = includeRelated && parseBooleanFlag(
        payload?.includeAccessories ?? true
    );
    const includeLicenses = includeRelated && parseBooleanFlag(
        payload?.includeLicenses ?? false
    );
    const includeConsumables = includeRelated && parseBooleanFlag(
        payload?.includeConsumables ?? false
    );
    return {
        includeRelated,
        includeComponents,
        includeAccessories,
        includeLicenses,
        includeConsumables,
    };
}

async function collectRelatedAssetsForTransfer(parentAssetId: string, options: RelatedTransferOptions) {
    const blockedComponentStatuses = ['removed', 'replaced', 'retired', 'disposed'];
    const byCategory = {
        components: new Set<string>(),
        accessories: new Set<string>(),
        licenses: new Set<string>(),
        consumables: new Set<string>(),
    };

    if (options.includeComponents) {
        const componentRows = await prisma.assetComponent.findMany({
            where: {
                parentAssetId,
                childAssetId: { not: null },
                removedAt: null,
                status: { notIn: blockedComponentStatuses },
            },
            select: {
                childAssetId: true,
            },
        });
        componentRows.forEach((row) => {
            if (row.childAssetId) byCategory.components.add(row.childAssetId);
        });
    }

    if (options.includeAccessories || options.includeLicenses || options.includeConsumables || options.includeComponents) {
        const relationshipTypes = [
            'installed_in',
            'component_of',
            'uses',
            'used_with',
            'assigned_to',
            'license_for',
            'licensed_to',
            'consumed_by',
            'attached_to',
            'connected_to',
        ];
        const relationshipRows = await prisma.assetRelationship.findMany({
            where: {
                relationshipType: { in: relationshipTypes },
                OR: [
                    { assetId: parentAssetId },
                    { relatedAssetId: parentAssetId },
                ]
            },
            include: {
                asset: {
                    select: { customId: true, category: true },
                },
                relatedAsset: {
                    select: { customId: true, category: true },
                },
            },
        });

        relationshipRows.forEach((row) => {
            const other = row.assetId === parentAssetId ? row.relatedAsset : row.asset;
            const otherId = other?.customId;
            const otherCategory = String(other?.category || '').toLowerCase();
            if (!otherId || otherId === parentAssetId) return;
            if (otherCategory === 'component' && options.includeComponents) byCategory.components.add(otherId);
            if (otherCategory === 'accessory' && options.includeAccessories) byCategory.accessories.add(otherId);
            if (otherCategory === 'license' && options.includeLicenses) byCategory.licenses.add(otherId);
            if (otherCategory === 'consumable' && options.includeConsumables) byCategory.consumables.add(otherId);
        });
    }

    const allIds = Array.from(new Set([
        ...Array.from(byCategory.components),
        ...Array.from(byCategory.accessories),
        ...Array.from(byCategory.licenses),
        ...Array.from(byCategory.consumables),
    ]));

    return {
        allIds,
        byCategory: {
            components: Array.from(byCategory.components),
            accessories: Array.from(byCategory.accessories),
            licenses: Array.from(byCategory.licenses),
            consumables: Array.from(byCategory.consumables),
        },
        counts: {
            components: byCategory.components.size,
            accessories: byCategory.accessories.size,
            licenses: byCategory.licenses.size,
            consumables: byCategory.consumables.size,
            total: allIds.length,
        }
    };
}

async function transferRelatedAssetsWithParent(params: {
    parentAsset: Asset;
    updateData: Record<string, any>;
    destinationType: string;
    destination: string;
    options: RelatedTransferOptions;
}) {
    if (!params.options.includeRelated) {
        return {
            updatedAssets: [] as Asset[],
            affectedRelatedIds: [] as string[],
            affectedRelatedCounts: {
                components: 0,
                accessories: 0,
                licenses: 0,
                consumables: 0,
                total: 0,
            },
            summary: 'Related item transfer disabled.',
        };
    }

    const related = await collectRelatedAssetsForTransfer(params.parentAsset.customId, params.options);
    if (!related.allIds.length) {
        return {
            updatedAssets: [] as Asset[],
            affectedRelatedIds: [] as string[],
            affectedRelatedCounts: related.counts,
            summary: 'No related items were linked to this parent asset.',
        };
    }

    const relatedAssets = await prisma.asset.findMany({
        where: { customId: { in: related.allIds } },
    });
    const updatesById = new Map<string, Partial<Asset>>();
    const updatedAssets: Asset[] = [];

    for (const relatedAsset of relatedAssets) {
        const category = String(relatedAsset.category || '').toLowerCase();
        const isLicense = category === 'license';
        const shouldMovePhysically = !isLicense && category !== 'spare_part';
        const updatePayload: Record<string, any> = {};
        if (shouldMovePhysically) {
            if (typeof params.updateData.location !== 'undefined') updatePayload.location = params.updateData.location;
            if (typeof params.updateData.department !== 'undefined') updatePayload.department = params.updateData.department;
            const nextMapLocationHint = normalizeSerialValue((params.updateData.specifications as Record<string, any> | undefined)?.mapLocationHint)
                || mapLocationToFriendly(params.updateData.location || params.parentAsset.location);
            updatePayload.specifications = mergeAssetSpecifications(relatedAsset.specifications, {
                mapLocationHint: nextMapLocationHint || undefined,
            });
        }

        let updatedAsset = relatedAsset;
        if (Object.keys(updatePayload).length > 0) {
            updatedAsset = await AssetService.updateAsset(relatedAsset.customId, updatePayload);
        }
        updatesById.set(updatedAsset.customId, updatedAsset as Partial<Asset>);
        updatedAssets.push(updatedAsset);

        await recordLifecycleEvent({
            assetId: updatedAsset.customId,
            eventType: 'asset_transferred_with_parent',
            oldValue: {
                location: String(relatedAsset.location),
                department: String(relatedAsset.department),
            },
            newValue: {
                location: String(updatedAsset.location),
                department: String(updatedAsset.department),
                parentAssetId: params.parentAsset.customId,
                destinationType: params.destinationType,
                destination: params.destination,
            },
            reason: 'moved_with_parent_asset',
            notes: `Moved with parent asset ${params.parentAsset.customId}`,
        });
        await recordHistoryEvent({
            assetId: updatedAsset.customId,
            action: 'Transferred With Parent',
            details: `Moved with parent asset ${params.parentAsset.customId} to ${params.destinationType}: ${params.destination}`,
        });
    }

    const summary = `Transferred related items with parent ${params.parentAsset.customId}: components=${related.counts.components}, accessories=${related.counts.accessories}, licenses=${related.counts.licenses}, consumables=${related.counts.consumables}.`;
    return {
        updatedAssets,
        affectedRelatedIds: related.allIds,
        affectedRelatedCounts: related.counts,
        summary,
    };
}

app.get('/api/assets/:id/transfer-related-summary', async (req: Request, res: Response) => {
    try {
        const asset = await AssetService.getAssetByCustomId(req.params.id);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });
        const options = parseRelatedTransferOptions({
            includeRelated: true,
            includeComponents: req.query.includeComponents ?? 'true',
            includeAccessories: req.query.includeAccessories ?? 'true',
            includeLicenses: req.query.includeLicenses ?? 'false',
            includeConsumables: req.query.includeConsumables ?? 'false',
        });
        const summary = await collectRelatedAssetsForTransfer(asset.customId, options);
        return res.json({
            parentAssetId: asset.customId,
            counts: summary.counts,
            ids: summary.byCategory,
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to read transfer-related summary', error: error.message });
    }
});

app.post('/api/inventory/bulk-checkout', inventoryAdminGuard, async (req: Request, res: Response) => {
    try {
        const destinationType = String(req.body?.destinationType || req.body?.destType || 'building').trim().toLowerCase();
        const destination = String(req.body?.destination || req.body?.location || '').trim();
        if (!destination) return res.status(400).json({ message: 'destination is required' });

        const assetIds = Array.from(new Set([
            ...((Array.isArray(req.body?.assetIds) ? req.body.assetIds : []).map((entry: unknown) => String(entry || '').trim())),
            ...parseSerialValues(req.body?.assetCodes || req.body?.assetCodesText || req.body?.assetTagsText),
        ].filter(Boolean)));
        if (!assetIds.length) return res.status(400).json({ message: 'Provide at least one asset id/customId/tag for bulk checkout.' });

        const options = parseRelatedTransferOptions({
            ...req.body,
            includeRelated: typeof req.body?.includeRelated === 'undefined' ? true : req.body?.includeRelated,
            includeComponents: typeof req.body?.includeComponents === 'undefined' ? true : req.body?.includeComponents,
            includeAccessories: typeof req.body?.includeAccessories === 'undefined' ? true : req.body?.includeAccessories,
            includeLicenses: typeof req.body?.includeLicenses === 'undefined' ? true : req.body?.includeLicenses,
            includeConsumables: typeof req.body?.includeConsumables === 'undefined' ? false : req.body?.includeConsumables,
        });
        const assignedToName = normalizeSerialValue(req.body?.assignedToName || req.body?.assignedTo || req.body?.assignee);
        const assignedToUserId = normalizeSerialValue(req.body?.assignedToUserId);
        const assignedDepartmentRaw = normalizeSerialValue(req.body?.assignedDepartment || req.body?.department);
        const assignedDepartment = assignedDepartmentRaw ? mapToAssetDepartment(assignedDepartmentRaw) : null;
        const expectedReturnDate = parseOptionalDateInput(req.body?.expectedReturnDate);
        const actor = normalizeSerialValue(req.body?.actor || req.body?.admin) || 'inventory-kiosk';
        const note = normalizeSerialValue(req.body?.notes || req.body?.reason) || 'bulk_checkout';

        const successful: Array<Record<string, any>> = [];
        const failed: Array<Record<string, any>> = [];
        const relatedAggregate = {
            components: 0,
            accessories: 0,
            licenses: 0,
            consumables: 0,
            total: 0,
        };

        for (const requestedId of assetIds.slice(0, 500)) {
            const asset = await AssetService.getAssetByCustomId(requestedId);
            if (!asset) {
                failed.push({ requestedId, reason: 'asset_not_found' });
                continue;
            }
            const lifecycle = normalizeLifecycleKey(asset.lifecycleStatus);
            if (['retired', 'disposed', 'lost_stolen'].includes(lifecycle)) {
                failed.push({ requestedId: asset.customId, reason: `asset_unavailable_${lifecycle}` });
                continue;
            }

            const updateData: Record<string, any> = {
                checkoutDate: new Date(),
                expectedReturnDate,
                returnedDate: null,
                custodyStatus: 'CHECKED_OUT',
                assignedToName: assignedToName || asset.assignedToName || null,
                assignedToUserId: assignedToUserId || asset.assignedToUserId || null,
                assignedDepartment: assignedDepartment || asset.assignedDepartment || null,
            };
            if (destinationType === 'building' || destinationType === 'location') {
                const locationResolution = resolveAssetLocationForStorage(destination);
                updateData.location = locationResolution.location;
                updateData.status = 'ACTIVE';
                updateData.lifecycleStatus = 'IN_TRANSIT';
                updateData.specifications = mergeAssetSpecifications(asset.specifications, {
                    mapLocationHint: locationResolution.mapLocationHint || destination,
                });
            } else if (destinationType === 'department') {
                updateData.department = mapToAssetDepartment(destination);
                updateData.lifecycleStatus = 'IN_USE';
            } else {
                updateData.assignedUser = assignedToName || destination;
                updateData.status = 'ASSIGNED';
                updateData.lifecycleStatus = 'ASSIGNED';
            }
            if (assignedDepartment) updateData.department = assignedDepartment;
            if (assignedToName) updateData.assignedUser = assignedToName;

            const updated = await AssetService.updateAsset(asset.customId, updateData);
            await prisma.assetCustodyEvent.create({
                data: {
                    assetId: updated.customId,
                    action: 'bulk_checkout',
                    assignedToName: assignedToName || null,
                    assignedToUserId: assignedToUserId || null,
                    assignedDepartment: assignedDepartment || null,
                    checkoutDate: updateData.checkoutDate,
                    expectedReturnDate: expectedReturnDate || null,
                    reason: note,
                    notes: normalizeSerialValue(req.body?.notes),
                    actor,
                },
            });
            await recordLifecycleEvent({
                assetId: updated.customId,
                eventType: 'asset_bulk_checked_out',
                oldValue: {
                    location: String(asset.location),
                    department: String(asset.department),
                    assignedToName: asset.assignedToName || null,
                },
                newValue: {
                    location: String(updated.location),
                    department: String(updated.department),
                    assignedToName: updated.assignedToName || null,
                    destinationType,
                    destination,
                },
                reason: 'bulk_checkout',
                notes: note,
                actor,
            });
            await recordHistoryEvent({
                assetId: updated.customId,
                action: 'Bulk Checkout',
                details: `Bulk checkout to ${destinationType}: ${destination}`,
            });

            let relatedTransferSummary = 'Related transfer disabled.';
            let relatedCounts = {
                components: 0,
                accessories: 0,
                licenses: 0,
                consumables: 0,
                total: 0,
            };
            if (options.includeRelated && (destinationType === 'building' || destinationType === 'location' || destinationType === 'department')) {
                const relatedResult = await transferRelatedAssetsWithParent({
                    parentAsset: updated,
                    updateData,
                    destinationType,
                    destination,
                    options,
                });
                relatedTransferSummary = relatedResult.summary;
                relatedCounts = relatedResult.affectedRelatedCounts;
                relatedAggregate.components += relatedCounts.components;
                relatedAggregate.accessories += relatedCounts.accessories;
                relatedAggregate.licenses += relatedCounts.licenses;
                relatedAggregate.consumables += relatedCounts.consumables;
                relatedAggregate.total += relatedCounts.total;
            }

            successful.push({
                assetId: updated.customId,
                name: updated.name,
                destinationType,
                destination,
                location: mapLocationToFriendly(updated.location),
                department: mapDepartmentToFriendly(updated.department),
                assignedTo: updated.assignedToName || updated.assignedToUserId || null,
                expectedReturnDate: expectedReturnDate?.toISOString() || null,
                relatedCounts,
                relatedTransferSummary,
            });
        }

        const receiptSummary = {
            destinationType,
            destination,
            totalRequested: assetIds.length,
            successfulCount: successful.length,
            failedCount: failed.length,
            relatedMoved: relatedAggregate,
            expectedReturnDate: expectedReturnDate?.toISOString() || null,
            generatedAt: new Date().toISOString(),
        };

        return res.json({
            success: true,
            receiptSummary,
            successfulTransfers: successful,
            failedTransfers: failed,
            affectedAssets: successful.map((row) => row.assetId),
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Failed to run bulk checkout', error: error.message });
    }
});

// --- TRANSFER & SPLIT LOGIC ---
app.patch('/api/assets/:id/transfer', async (req: Request, res: Response) => {
    const { destType, destination, quantityToMove, admin } = req.body;
    console.log(`📦 Attempting transfer for ID: ${req.params.id}`);
    const relatedTransferOptions = parseRelatedTransferOptions(req.body);

    try {
        const asset = await AssetService.getAssetByCustomId(req.params.id);

        if (!asset) {
            return res.status(404).json({ message: "Asset not found" });
        }

        let updateData: any = {};
        if (destType === 'building') {
            const locationResolution = resolveAssetLocationForStorage(destination);
            updateData.location = locationResolution.location;
            updateData.status = 'ACTIVE';
            updateData.assignedUser = null;
            updateData.lifecycleStatus = 'IN_TRANSIT';
            updateData.custodyStatus = 'UNASSIGNED';
            updateData.specifications = mergeAssetSpecifications(asset.specifications, {
                mapLocationHint: locationResolution.mapLocationHint || destination,
            });
        } else if (destType === 'department') {
            updateData.department = mapToAssetDepartment(destination);
            updateData.lifecycleStatus = 'IN_USE';
        } else if (destType === 'user') {
            updateData.assignedUser = destination;
            updateData.status = 'ASSIGNED';
            updateData.assignedToName = destination;
            updateData.checkoutDate = new Date();
            updateData.custodyStatus = 'CHECKED_OUT';
            updateData.lifecycleStatus = 'ASSIGNED';
        }

        const parsedMoveQty = Number(quantityToMove);
        const moveQty = Number.isFinite(parsedMoveQty) && parsedMoveQty > 0 ? parsedMoveQty : asset.quantity;
        if (!Number.isInteger(moveQty) || moveQty <= 0) {
            return res.status(400).json({ message: "quantityToMove must be a positive integer." });
        }
        if (moveQty > asset.quantity) return res.status(400).json({ message: "Not enough quantity." });

        if (moveQty === asset.quantity) {
            const updated = await AssetService.updateAsset(req.params.id, updateData);
            await recordLifecycleEvent({
                assetId: updated.customId,
                eventType: 'asset_transferred',
                oldValue: {
                    location: String(asset.location),
                    department: String(asset.department),
                    assignedUser: asset.assignedUser || null,
                },
                newValue: {
                    location: String(updated.location),
                    department: String(updated.department),
                    assignedUser: updated.assignedUser || null,
                    lifecycleStatus: String(updated.lifecycleStatus || ''),
                },
                reason: `transfer_${destType}`,
            });
            await EventBus.publish(TOPICS.ASSET_TRANSFERRED, {
                customId: updated.customId,
                quantityMoved: moveQty,
                destinationType: destType,
                destination,
                location: String(updated.location),
                department: String(updated.department),
                status: String(updated.status),
                timestamp: new Date().toISOString(),
                source: 'inventory-backend',
                historyAction: 'Transfer',
                historyDetails: `Moved to ${destType}: ${destination}`,
            });
            scheduleTransferLifespanRefresh(updated.customId);
            const refreshed = await AssetService.getAssetByCustomId(updated.customId);
            const normalized = annotateAssetWithTruthfulSignals(refreshed || updated);
            const relatedTransferResult = await transferRelatedAssetsWithParent({
                parentAsset: normalized as Asset,
                updateData,
                destinationType: String(destType || ''),
                destination: String(destination || ''),
                options: relatedTransferOptions,
            });
            const normalizedRelated = relatedTransferResult.updatedAssets.map((entry) => annotateAssetWithTruthfulSignals(entry));
            return res.json({
                success: true,
                updatedAsset: normalized,
                updatedAssets: [normalized, ...normalizedRelated],
                affectedRelatedIds: relatedTransferResult.affectedRelatedIds,
                affectedRelatedCounts: relatedTransferResult.affectedRelatedCounts,
                relatedTransferSummary: relatedTransferResult.summary,
            });
        }

        // Partial transfer - reduce original quantity
        const updated = await AssetService.updateAsset(req.params.id, {
            quantity: asset.quantity - moveQty
        });

        const LOW_STOCK_THRESHOLD = 5;
        if (updated.quantity === LOW_STOCK_THRESHOLD) {
            await publishLowStockEvent({
                itemId: asset.customId,
                itemName: asset.name,
                admin,
            });
        }

        await EventBus.publish(TOPICS.ASSET_UPDATED, {
            customId: updated.customId,
            fields: ['quantity'],
            quantity: updated.quantity,
            timestamp: new Date().toISOString(),
            source: 'inventory-backend',
            historyAction: 'Distributed',
            historyDetails: `Sent ${moveQty} units to ${destination}`,
        });

        // Create new unit records for transferred quantity (legacy multi-quantity rows are normalized here).
        const splitBaseId = `${asset.customId}-SPLIT-${Math.floor(1000 + Math.random() * 9000)}`;
        const splitUnitIds = buildUnitAssetIds(splitBaseId, moveQty);
        const newBatches = await AssetService.createAssets(
            splitUnitIds.map((splitUnitId) => ({
                customId: splitUnitId,
                name: asset.name,
                type: asset.type,
                status: updateData.status || asset.status,
                value: Number(asset.value),
                quantity: 1,
                location: updateData.location || asset.location,
                department: updateData.department || asset.department,
                assignedUser: updateData.assignedUser,
                specifications: mergeAssetSpecifications(
                    (asset.specifications as Record<string, any>) || {},
                    {
                        mapLocationHint: normalizeSerialValue((updateData.specifications as Record<string, any> | undefined)?.mapLocationHint)
                            || mapLocationToFriendly(updateData.location || asset.location),
                    }
                )
            }))
        );

        await Promise.all(
            newBatches.map((newBatch, index) =>
                EventBus.publish(TOPICS.ASSET_TRANSFERRED, {
                    customId: newBatch.customId,
                    parentAssetId: asset.customId,
                    quantityMoved: newBatch.quantity,
                    destinationType: destType,
                    destination,
                    location: String(newBatch.location),
                    department: String(newBatch.department),
                    status: String(newBatch.status),
                    timestamp: new Date().toISOString(),
                    source: 'inventory-backend',
                    historyAction: 'Received_Distribution',
                    historyDetails: moveQty > 1
                        ? `Split from ${asset.customId} (${index + 1}/${moveQty})`
                        : `Split from ${asset.customId}`,
                })
            )
        );

        for (const newBatch of newBatches) {
            scheduleTransferLifespanRefresh(newBatch.customId);
        }
        const refreshedOriginal = await AssetService.getAssetByCustomId(updated.customId);
        const refreshedSplits = await Promise.all(newBatches.map((newBatch) => AssetService.getAssetByCustomId(newBatch.customId)));
        const normalizedOriginal = annotateAssetWithTruthfulSignals(refreshedOriginal || updated);
        const normalizedSplits = refreshedSplits
            .filter((entry): entry is Asset => Boolean(entry))
            .map((entry) => annotateAssetWithTruthfulSignals(entry));

        const partialRelatedSummary = relatedTransferOptions.includeRelated
            ? 'Related-item transfer was skipped because partial quantity transfer creates split units.'
            : 'Related item transfer disabled.';
        res.json({
            success: true,
            original: normalizedOriginal,
            newBatch: normalizedSplits[0] || annotateAssetWithTruthfulSignals(newBatches[0]),
            newBatches: normalizedSplits,
            updatedAssets: [normalizedOriginal, ...normalizedSplits],
            affectedRelatedIds: [],
            affectedRelatedCounts: {
                components: 0,
                accessories: 0,
                licenses: 0,
                consumables: 0,
                total: 0,
            },
            relatedTransferSummary: partialRelatedSummary,
        });
    } catch (error: any) {
        console.error("❌ Transfer Route Error:", error.message);
        res.status(500).json({ message: "Transfer failed", error: error.message });
    }
});

// --- STATUS & DETAILS UPDATE ---
app.patch('/api/assets/:id/status', async (req: Request, res: Response) => {
    try {
        const { status, lifecycleStatus, actor, reason } = req.body;
        const existing = await AssetService.getAssetByCustomId(req.params.id);
        if (!existing) return res.status(404).json({ message: "Asset not found" });
        const mappedStatus = mapToAssetStatus(status);
        const mappedLifecycle = lifecycleStatus ? mapToLifecycleStatus(lifecycleStatus) : undefined;
        const updated = await AssetService.updateAsset(req.params.id, {
            status: mappedStatus,
            ...(mappedLifecycle ? { lifecycleStatus: mappedLifecycle } : {})
        });
        await recordLifecycleEvent({
            assetId: updated.customId,
            eventType: 'status_changed',
            oldValue: {
                status: String(existing.status),
                lifecycleStatus: String((existing as any).lifecycleStatus || ''),
            },
            newValue: {
                status: String(updated.status),
                lifecycleStatus: String((updated as any).lifecycleStatus || ''),
            },
            reason: String(reason || ''),
            actor: String(actor || ''),
        });
        await EventBus.publish(TOPICS.ASSET_UPDATED, {
            customId: updated.customId,
            fields: mappedLifecycle ? ['status', 'lifecycleStatus'] : ['status'],
            status: String(updated.status),
            timestamp: new Date().toISOString(),
            source: 'inventory-backend',
            historyAction: 'Status Updated',
            historyDetails: `Status changed to ${updated.status}`,
        });
        res.json(updated);
    } catch (err) {
        res.status(500).json({ message: "Status update failed" });
    }
});

app.post('/api/assets/:id/retire', async (req: Request, res: Response) => {
    try {
        const asset = await AssetService.getAssetByCustomId(req.params.id);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });
        const updated = await AssetService.updateAsset(req.params.id, {
            status: 'RETIRED',
            lifecycleStatus: 'RETIRED',
        });
        await recordLifecycleEvent({
            assetId: req.params.id,
            eventType: 'asset_retired',
            oldValue: { status: String(asset.status), lifecycleStatus: String((asset as any).lifecycleStatus || '') },
            newValue: { status: String(updated.status), lifecycleStatus: String((updated as any).lifecycleStatus || '') },
            reason: normalizeSerialValue(req.body?.reason),
            notes: normalizeSerialValue(req.body?.notes),
            actor: normalizeSerialValue(req.body?.actor),
        });
        await recordHistoryEvent({
            assetId: req.params.id,
            action: 'Asset Retired',
            details: normalizeSerialValue(req.body?.reason) || 'Retired by user action',
        });
        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to retire asset', error: error.message });
    }
});

app.post('/api/assets/:id/dispose', async (req: Request, res: Response) => {
    try {
        const asset = await AssetService.getAssetByCustomId(req.params.id);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });
        const updated = await AssetService.updateAsset(req.params.id, {
            status: 'RETIRED',
            lifecycleStatus: 'DISPOSED',
        });
        await recordLifecycleEvent({
            assetId: req.params.id,
            eventType: 'asset_disposed',
            oldValue: { status: String(asset.status), lifecycleStatus: String((asset as any).lifecycleStatus || '') },
            newValue: { status: String(updated.status), lifecycleStatus: String((updated as any).lifecycleStatus || '') },
            reason: normalizeSerialValue(req.body?.reason),
            notes: normalizeSerialValue(req.body?.notes),
            actor: normalizeSerialValue(req.body?.actor),
        });
        await recordHistoryEvent({
            assetId: req.params.id,
            action: 'Asset Disposed',
            details: normalizeSerialValue(req.body?.reason) || 'Disposed by user action',
        });
        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to dispose asset', error: error.message });
    }
});

// Device agents/integrations call this endpoint. The UI only displays the detected state.
app.patch('/api/assets/:id/telemetry', async (req: Request, res: Response) => {
    try {
        const { isOnline = false, isActive = false, reportedAt } = req.body;
        const asset = await AssetService.getAssetByCustomId(req.params.id);

        if (!asset) return res.status(404).json({ message: "Asset not found" });

        const currentSpecs = (asset.specifications as Record<string, any>) || {};
        const nextState = resolveTelemetryState(Boolean(isOnline), Boolean(isActive));
        const timestamp = reportedAt ? new Date(reportedAt) : new Date();
        if (Number.isNaN(timestamp.getTime())) {
            return res.status(400).json({ message: "Invalid telemetry timestamp." });
        }

        const previousUpdate = currentSpecs.operationalStateUpdatedAt
            ? new Date(currentSpecs.operationalStateUpdatedAt)
            : null;
        const measuredAt = (previousUpdate && !Number.isNaN(previousUpdate.getTime()) && timestamp < previousUpdate)
            ? previousUpdate
            : timestamp;
        const adjustedHours = getTelemetryAdjustedHours(currentSpecs, measuredAt);

        const updatedSpecifications = {
            ...currentSpecs,
            trackWorkingHours: true,
            workingHours: Math.round(adjustedHours),
            workingHoursSource: 'telemetry',
            operationalState: nextState,
            operationalStateUpdatedAt: measuredAt.toISOString(),
            lastTelemetryAt: timestamp.toISOString()
        };

        await AssetService.updateAsset(req.params.id, {
            specifications: updatedSpecifications
        });

        try {
            await persistTelemetrySample({
                assetId: req.params.id,
                observedAt: timestamp,
                telemetrySource: 'inventory-backend-telemetry-endpoint',
                rawSignals: {
                    isOnline: Boolean(isOnline),
                    isActive: Boolean(isActive),
                    reportedAt: timestamp.toISOString(),
                    workingHours: Math.round(adjustedHours),
                },
                derivedStatus: nextState,
                confidence: 0.9,
                reason: 'Telemetry patch endpoint received direct heartbeat/activity signal.',
                activeHours: nextState === 'online_in_use' ? Math.round(adjustedHours) : null,
                idleHours: nextState === 'online_idle' ? Math.round(adjustedHours) : null,
                offlineHours: nextState === 'offline' ? Math.round(adjustedHours) : null,
                utilization: null,
                consumptionScore: null,
                qualityImpactScore: null,
            });
        } catch (error: any) {
            console.warn(`[InventoryAI] canonical telemetry sample persistence failed for ${req.params.id}: ${error.message}`);
        }

        await EventBus.publish(TOPICS.ASSET_UPDATED, {
            customId: req.params.id,
            fields: ['specifications.workingHours', 'specifications.operationalState', 'specifications.lastTelemetryAt'],
            operationalState: nextState,
            workingHours: Math.round(adjustedHours),
            timestamp: timestamp.toISOString(),
            source: 'inventory-backend',
            historyAction: 'Telemetry Updated',
            historyDetails: `Detected state: ${nextState}`,
        });

        try {
            const telemetryRefresh = await refreshAndPersistAssetLifespan(req.params.id, {
                reason: 'telemetry_update',
                forcePersist: false,
                minimumHoursDelta: LIFESPAN_IMPACT_MIN_HOURS,
                asOf: measuredAt,
            });
            if (!telemetryRefresh.persisted && telemetryRefresh.skippedReason) {
                console.log(`[InventoryAI] telemetry lifespan refresh skipped for ${req.params.id}: ${telemetryRefresh.skippedReason}`);
            }
        } catch (error: any) {
            console.warn(`[InventoryAI] telemetry lifespan refresh failed for ${req.params.id}: ${error.message}`);
        }

        const updatedAsset = await AssetService.getAssetByCustomId(req.params.id);
        if (!updatedAsset) {
            return res.status(404).json({ message: "Asset not found after telemetry update" });
        }

        res.json(annotateAssetWithTruthfulSignals(updatedAsset));
    } catch (error: any) {
        console.error("Telemetry Update Error:", error.message);
        res.status(500).json({ message: "Telemetry update failed", error: error.message });
    }
});

app.get('/api/assets/:id/lifecycle-outcome', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const asset = await AssetService.getAssetByCustomId(id);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });

        const row = await readLifecycleOutcome(id);
        const specs = (asset.specifications as Record<string, any>) || {};
        const lifecycleFromSpecs = (specs.lifecycle && typeof specs.lifecycle === 'object') ? specs.lifecycle : null;

        res.json({
            assetId: id,
            db: row || null,
            specs: lifecycleFromSpecs,
            status: String(asset.status || '').toLowerCase(),
        });
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to fetch lifecycle outcome', error: error.message });
    }
});

app.patch('/api/assets/:id/lifecycle-outcome', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const asset = await AssetService.getAssetByCustomId(id);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });

        const payload: LifecycleOutcomePayload = {
            purchaseDate: req.body?.purchaseDate ?? null,
            commissionedAt: req.body?.commissionedAt ?? null,
            failureDate: req.body?.failureDate ?? null,
            replacementDate: req.body?.replacementDate ?? null,
            retiredAt: req.body?.retiredAt ?? null,
            failureType: req.body?.failureType ?? null,
            replacementCost: req.body?.replacementCost ?? null,
            actualLifespanYears: req.body?.actualLifespanYears ?? null,
            finalOutcome: req.body?.finalOutcome ?? null,
            notes: req.body?.notes ?? null,
            reviewer: req.body?.reviewer ?? 'inventory-admin',
        };

        const updatedLifecycle = await upsertLifecycleOutcome(asset, payload);
        await HistoryService.createHistory({
            assetId: id,
            action: 'Lifecycle Outcome Updated',
            details: `Outcome: ${payload.finalOutcome || 'active'} by ${payload.reviewer || 'inventory-admin'}`,
        });

        const latestAsset = await AssetService.getAssetByCustomId(id);
        res.json({
            status: 'ok',
            asset: latestAsset,
            lifecycle: updatedLifecycle,
        });
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to save lifecycle outcome', error: error.message });
    }
});

app.post('/api/assets/:id/lifespan-prediction', async (req: Request, res: Response) => {
    const { id } = req.params;
    const requestId = req.header('x-request-id') || crypto.randomUUID();
    const persistSnapshot = String(req.query.persist || 'false').toLowerCase() === 'true';

    try {
        const asset = await AssetService.getAssetByCustomId(id);
        if (!asset) return res.status(404).json({ message: 'Asset not found', requestId });

        const bodyBase = Number(req.body?.baseLifespanYears);
        const baseLifespanYears = Number.isFinite(bodyBase) && bodyBase > 0 ? bodyBase : 5;
        if (!persistSnapshot) {
            const { prediction, requestId: aiRequestId, durationMs } = await requestAssetLifespanPrediction(asset, {
                requestId,
                baseLifespanYears,
            });
            console.log(`[InventoryAI] requestId=${aiRequestId} assetId=${id} status=ok durationMs=${durationMs} persist=false`);
            return res.json({
                ...prediction,
                requestId: aiRequestId,
                observedBy: 'inventory-backend',
                durationMs,
                persisted: false,
                persistSkippedReason: 'display_only_request',
            });
        }

        const refresh = await refreshAndPersistAssetLifespan(id, {
            reason: 'manual_request',
            forcePersist: true,
            requestId,
            baseLifespanYears,
        });
        if (!refresh.prediction) {
            return res.status(502).json({
                message: 'Inventory AI service unavailable',
                requestId,
            });
        }
        console.log(`[InventoryAI] requestId=${refresh.requestId || requestId} assetId=${id} status=ok durationMs=${refresh.durationMs || 0}`);

        return res.json({
            ...refresh.prediction,
            requestId: refresh.requestId || requestId,
            observedBy: 'inventory-backend',
            durationMs: refresh.durationMs || 0,
            persisted: refresh.persisted,
            persistSkippedReason: refresh.skippedReason || null,
        });
    } catch (error: any) {
        console.error(`[InventoryAI] requestId=${requestId} assetId=${id} status=error error=${error.message}`);
        return res.status(502).json({
            message: 'Failed to retrieve lifespan prediction',
            requestId,
            error: error.message,
        });
    }
});

app.patch('/api/assets/:id/details', async (req: Request, res: Response) => {
    try {
        const {
            name,
            type,
            department,
            quantity,
            specifications,
            admin,
            serialNumber,
            assetTag,
            manufacturerPartNumber,
            category,
            lifecycleStatus,
            assignedToName,
            assignedToUserId,
            assignedDepartment,
            checkoutDate,
            expectedReturnDate,
            returnedDate,
            custodyStatus,
            purchaseDate,
            vendor,
            purchaseCost,
            invoiceNumber,
            purchaseOrderNumber,
            warrantyStartDate,
            warrantyEndDate,
            replacementCost,
        } = req.body;
        const existing = await AssetService.getAssetByCustomId(req.params.id);
        if (!existing) return res.status(404).json({ message: "Asset not found" });

        const updateData: any = {};
        if (name) updateData.name = name;
        if (type) updateData.type = mapToAssetType(type);
        if (department) updateData.department = mapToAssetDepartment(department);
        if (typeof quantity !== 'undefined') {
            const normalizedQuantity = parseRequestedQuantity(quantity);
            if (normalizedQuantity !== 1) {
                return res.status(400).json({
                    message: 'Direct quantity edits greater than 1 are not allowed. Create additional units instead.',
                });
            }
            updateData.quantity = 1;
        }
        if (specifications) updateData.specifications = specifications;
        if (typeof serialNumber !== 'undefined') updateData.serialNumber = normalizeSerialValue(serialNumber);
        if (typeof assetTag !== 'undefined') updateData.assetTag = normalizeSerialValue(assetTag);
        if (typeof manufacturerPartNumber !== 'undefined') updateData.manufacturerPartNumber = normalizeSerialValue(manufacturerPartNumber);
        if (typeof category !== 'undefined') updateData.category = mapToAssetCategory(category);
        if (typeof lifecycleStatus !== 'undefined') updateData.lifecycleStatus = mapToLifecycleStatus(lifecycleStatus);
        if (typeof assignedToName !== 'undefined') updateData.assignedToName = normalizeSerialValue(assignedToName);
        if (typeof assignedToUserId !== 'undefined') updateData.assignedToUserId = normalizeSerialValue(assignedToUserId);
        if (typeof assignedDepartment !== 'undefined') updateData.assignedDepartment = normalizeSerialValue(assignedDepartment);
        if (typeof checkoutDate !== 'undefined') updateData.checkoutDate = parseOptionalDateInput(checkoutDate);
        if (typeof expectedReturnDate !== 'undefined') updateData.expectedReturnDate = parseOptionalDateInput(expectedReturnDate);
        if (typeof returnedDate !== 'undefined') updateData.returnedDate = parseOptionalDateInput(returnedDate);
        if (typeof custodyStatus !== 'undefined') updateData.custodyStatus = mapToCustodyStatus(custodyStatus);
        if (typeof purchaseDate !== 'undefined') updateData.purchaseDate = parseOptionalDateInput(purchaseDate);
        if (typeof vendor !== 'undefined') updateData.vendor = normalizeSerialValue(vendor);
        if (typeof purchaseCost !== 'undefined') updateData.purchaseCost = parseOptionalNumberInput(purchaseCost);
        if (typeof invoiceNumber !== 'undefined') updateData.invoiceNumber = normalizeSerialValue(invoiceNumber);
        if (typeof purchaseOrderNumber !== 'undefined') updateData.purchaseOrderNumber = normalizeSerialValue(purchaseOrderNumber);
        if (typeof warrantyStartDate !== 'undefined') updateData.warrantyStartDate = parseOptionalDateInput(warrantyStartDate);
        if (typeof warrantyEndDate !== 'undefined') updateData.warrantyEndDate = parseOptionalDateInput(warrantyEndDate);
        if (typeof replacementCost !== 'undefined') updateData.replacementCost = parseOptionalNumberInput(replacementCost);

        const updatedAsset = await AssetService.updateAsset(req.params.id, updateData);
        if (!updatedAsset) return res.status(404).json({ message: "Asset not found" });

        if (Object.prototype.hasOwnProperty.call(updateData, 'serialNumber')) {
            await recordHistoryEvent({
                assetId: updatedAsset.customId,
                action: 'Serial Number Updated',
                details: `Serial changed from "${existing.serialNumber || 'empty'}" to "${updatedAsset.serialNumber || 'empty'}"`,
            });
            await recordLifecycleEvent({
                assetId: updatedAsset.customId,
                eventType: 'serial_number_changed',
                oldValue: { serialNumber: existing.serialNumber || null },
                newValue: { serialNumber: updatedAsset.serialNumber || null },
                actor: String(admin?.email || admin?.name || ''),
            });
        }
        if (Object.prototype.hasOwnProperty.call(updateData, 'lifecycleStatus')) {
            await recordLifecycleEvent({
                assetId: updatedAsset.customId,
                eventType: 'lifecycle_status_changed',
                oldValue: { lifecycleStatus: String((existing as any).lifecycleStatus || '') },
                newValue: { lifecycleStatus: String((updatedAsset as any).lifecycleStatus || '') },
                actor: String(admin?.email || admin?.name || ''),
            });
        }
        if (
            Object.prototype.hasOwnProperty.call(updateData, 'assignedToName')
            || Object.prototype.hasOwnProperty.call(updateData, 'assignedToUserId')
            || Object.prototype.hasOwnProperty.call(updateData, 'checkoutDate')
            || Object.prototype.hasOwnProperty.call(updateData, 'returnedDate')
            || Object.prototype.hasOwnProperty.call(updateData, 'custodyStatus')
        ) {
            await recordLifecycleEvent({
                assetId: updatedAsset.customId,
                eventType: 'custody_updated',
                oldValue: {
                    assignedToName: (existing as any).assignedToName || null,
                    assignedToUserId: (existing as any).assignedToUserId || null,
                    custodyStatus: String((existing as any).custodyStatus || ''),
                },
                newValue: {
                    assignedToName: (updatedAsset as any).assignedToName || null,
                    assignedToUserId: (updatedAsset as any).assignedToUserId || null,
                    custodyStatus: String((updatedAsset as any).custodyStatus || ''),
                },
                actor: String(admin?.email || admin?.name || ''),
            });
        }
        if (
            Object.prototype.hasOwnProperty.call(updateData, 'vendor')
            || Object.prototype.hasOwnProperty.call(updateData, 'purchaseDate')
            || Object.prototype.hasOwnProperty.call(updateData, 'warrantyEndDate')
            || Object.prototype.hasOwnProperty.call(updateData, 'purchaseCost')
        ) {
            await recordLifecycleEvent({
                assetId: updatedAsset.customId,
                eventType: 'purchase_warranty_updated',
                oldValue: {
                    vendor: (existing as any).vendor || null,
                    purchaseDate: (existing as any).purchaseDate || null,
                    warrantyEndDate: (existing as any).warrantyEndDate || null,
                },
                newValue: {
                    vendor: (updatedAsset as any).vendor || null,
                    purchaseDate: (updatedAsset as any).purchaseDate || null,
                    warrantyEndDate: (updatedAsset as any).warrantyEndDate || null,
                },
                actor: String(admin?.email || admin?.name || ''),
            });
        }

        await EventBus.publish(TOPICS.ASSET_UPDATED, {
            customId: updatedAsset.customId,
            fields: Object.keys(updateData),
            status: String(updatedAsset.status),
            timestamp: new Date().toISOString(),
            source: 'inventory-backend',
            historyAction: 'Details Updated',
            historyDetails: `Fields changed: ${Object.keys(updateData).join(', ') || 'details'}`,
        });

        if (updateData.specifications) {
            try {
                await refreshAndPersistAssetLifespan(updatedAsset.customId, {
                    reason: 'asset_updated',
                    forcePersist: true,
                });
            } catch (error: any) {
                console.warn(`[InventoryAI] details lifespan refresh failed for ${updatedAsset.customId}: ${error.message}`);
            }
        }

        if (typeof quantity !== 'undefined' && Number(quantity) === 5) {
            await publishLowStockEvent({
                itemId: updatedAsset.customId,
                itemName: updatedAsset.name,
                admin,
            });
        }

        const refreshed = await AssetService.getAssetByCustomId(updatedAsset.customId);
        res.json(refreshed || updatedAsset);
    } catch (error: any) {
        if (error instanceof RequestValidationError) {
            return res.status(400).json({ message: error.message });
        }
        console.error("Details Update Error:", error.message);
        res.status(500).json({ message: "Update failed", error: error.message });
    }
});

// --- DELETE LOGIC ---
app.delete('/api/assets/:id', inventoryAdminGuard, async (req: Request, res: Response) => {
    try {
        console.log(`📤 DELETE /api/assets/${req.params.id} from ${req.ip} - headers: ${JSON.stringify(req.headers)}`);
        const id = req.params.id;

        const deleted = await AssetService.deleteAsset(id);

        if (deleted) {
            await EventBus.publish(TOPICS.ASSET_DELETED, { customId: deleted.customId });
            return res.json({ success: true });
        }
        res.status(404).json({ message: 'Asset not found' });
    } catch (error) { 
        res.status(500).json({ message: 'Server error' }); 
    }
});

const startServer = async () => {
    try {
        console.log("🔌 Connecting to RabbitMQ...");
        await EventBus.connect();
        await InventoryAiJobQueue.connect();
        console.log("✅ [EventBus] RabbitMQ Connected Successfully!");
    } catch (err: any) {
        console.error("❌ [EventBus] Connection FAILED.");
        console.error(`   Error: ${err.message}`);
    }

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n---------------------------------------------------`);
        console.log(`🚀 API Service is RUNNING on port ${PORT}`);
        console.log(`---------------------------------------------------\n`);
    });
};

startServer();
