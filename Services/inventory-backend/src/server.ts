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

function mapToAssetLocation(value: string): AssetLocation {
    const locationMap: Record<string, AssetLocation> = {
        'Central Warehouse': 'CENTRAL_WAREHOUSE',
        'Main Building': 'MAIN_BUILDING',
        'K Building': 'K_BUILDING',
        'N Building': 'N_BUILDING',
        'S Building': 'S_BUILDING',
        'R Building': 'R_BUILDING',
        'Pharmacy Building': 'PHARMACY_BUILDING'
    };
    return locationMap[value] || 'CENTRAL_WAREHOUSE';
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

const IMPORT_ACCESSORY_TYPE_ALLOWED = new Set(
    ACCESSORY_TYPES.map((entry: string) => String(entry || '').trim().toLowerCase().replace(/[\s-]+/g, '_'))
);

const IMPORT_CONSUMABLE_TYPE_ALLOWED = new Set(
    CONSUMABLE_TYPES.map((entry: string) => String(entry || '').trim().toLowerCase().replace(/[\s-]+/g, '_'))
);

const IMPORT_SPARE_STOCK_TYPE_ALLOWED = new Set(
    SPARE_STOCK_TYPES.map((entry: string) => String(entry || '').trim().toLowerCase().replace(/[\s-]+/g, '_'))
);

const IMPORT_LICENSE_TYPE_ALLOWED = new Set(
    LICENSE_TYPES.map((entry: string) => String(entry || '').trim().toLowerCase().replace(/[\s-]+/g, '_'))
);

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
    return IMPORT_RECORD_TYPES.includes(normalized as ImportRecordType)
        ? (normalized as ImportRecordType)
        : '';
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
            lifecycleStatus: String(raw.lifecycleStatus || '').trim(),
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
            const lifecycle = String(row.lifecycleStatus).trim().toLowerCase().replace(/[\s-]+/g, '_');
            if (!IMPORT_LIFECYCLE_ALLOWED.has(lifecycle)) {
                row.errors.push(`Invalid lifecycle status (${row.lifecycleStatus})`);
            }
        }
        if (row.category) {
            const category = String(row.category).trim().toLowerCase().replace(/[\s-]+/g, '_');
            if (!IMPORT_CATEGORY_ALLOWED.has(category)) {
                row.errors.push(`Invalid category (${row.category})`);
            }
        }
        if (row.assetType) {
            const normalizedAssetType = String(row.assetType).trim().toLowerCase().replace(/[\s-]+/g, '_');
            if (!IMPORT_PARENT_ASSET_TYPE_ALLOWED.has(normalizedAssetType)) {
                row.warnings.push(`Unrecognized asset type in registry (${row.assetType}). It will map to nearest supported backend type.`);
            }
        }
        if (row.recordType === 'component_asset' || row.recordType === 'embedded_component') {
            const normalizedComponentType = String(row.componentType || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
            if (normalizedComponentType && !IMPORT_COMPONENT_TYPE_ALLOWED.has(normalizedComponentType)) {
                row.warnings.push(`Component type (${row.componentType}) is not in current registry; keeping as custom component type.`);
            }
        }
        if (row.recordType === 'accessory') {
            const normalizedAccessoryType = String(row.assetType || row.category || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
            if (normalizedAccessoryType && !IMPORT_ACCESSORY_TYPE_ALLOWED.has(normalizedAccessoryType)) {
                row.warnings.push(`Accessory type (${row.assetType || row.category}) is outside the standard accessory registry.`);
            }
        }
        if (row.recordType === 'consumable') {
            const normalizedConsumableType = String(row.assetType || row.category || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
            if (normalizedConsumableType && !IMPORT_CONSUMABLE_TYPE_ALLOWED.has(normalizedConsumableType)) {
                row.warnings.push(`Consumable type (${row.assetType || row.category}) is outside the standard consumable registry.`);
            }
        }
        if (row.recordType === 'spare_stock') {
            const normalizedSpareType = String(row.componentType || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
            if (normalizedSpareType && !IMPORT_SPARE_STOCK_TYPE_ALLOWED.has(normalizedSpareType)) {
                row.warnings.push(`Spare stock type (${row.componentType}) is outside the standard spare-stock registry.`);
            }
        }
        if (row.recordType === 'license') {
            const normalizedLicenseType = String(row.assetType || row.assetName || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
            if (normalizedLicenseType && !IMPORT_LICENSE_TYPE_ALLOWED.has(normalizedLicenseType)) {
                row.warnings.push(`License type (${row.assetType || row.assetName}) is outside the standard license registry.`);
            }
        }

        if ((row.recordType === 'parent_asset' || row.recordType === 'accessory' || row.recordType === 'consumable' || row.recordType === 'license' || row.recordType === 'component_asset') && !row.assetName) {
            row.errors.push('Asset Name is required');
        }
        if (row.recordType === 'embedded_component' && !row.assetName) row.errors.push('Asset Name is required for embedded component');
        if (row.recordType === 'embedded_component' && !row.parentAssetTag) row.errors.push('Parent Asset Tag is required for embedded component');
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

        if ((row.recordType === 'embedded_component' || (row.recordType === 'component_asset' && row.parentAssetTag)) && row.parentAssetTag) {
            const key = row.parentAssetTag.toLowerCase();
            if (!existingParentTags.has(key) && !parentTagsDefinedInFile.has(key)) {
                row.errors.push(`Unknown Parent Asset Tag (${row.parentAssetTag})`);
            }
        }

        switch (row.recordType) {
            case 'parent_asset':
                row.proposedAction = 'create_parent_asset';
                break;
            case 'embedded_component':
                row.proposedAction = 'create_embedded_component';
                break;
            case 'component_asset':
                row.proposedAction = row.parentAssetTag ? 'create_component_asset_and_link' : 'create_component_asset';
                break;
            case 'spare_stock':
                row.proposedAction = 'create_or_update_spare_stock';
                break;
            case 'accessory':
            case 'consumable':
            case 'license':
                row.proposedAction = 'create_asset';
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
        console.warn(`[InventoryAIHelpers] ${path} request failed: ${error?.message || error}`);
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
    const q = String(query || '').toLowerCase();
    if (!q.trim()) return 'unknown';
    if ((q.includes('missing') || q.includes('without')) && q.includes('serial')) return 'missing_serial';
    if (q.includes('duplicate')) return 'duplicates';
    if (q.includes('warranty') && (q.includes('expired') || q.includes('expire'))) return 'warranty_expiry';
    if (q.includes('maintenance')) return 'maintenance';
    if (q.includes('component') && (q.includes('fail') || q.includes('replace') || q.includes('repair'))) return 'component_failures';
    if (q.includes('low stock') || q.includes('reorder') || q.includes('spare')) return 'low_stock';
    if (q.includes('buy') || q.includes('procurement') || q.includes('purchase')) return 'procurement';
    if (q.includes('eol') || q.includes('end of life')) return 'eol';
    if (q.includes('license') && q.includes('expir')) return 'license_expiry';
    return 'unknown';
}

function normalizeLifecycleKey(value: unknown): string {
    return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function deterministicAssistantAnswer(snapshot: InventoryAiSnapshot, query: string): {
    answer: string;
    matchedItems: InventoryAiMatchedItem[];
    filtersUsed: Record<string, any>;
    confidence: 'low' | 'medium' | 'high';
    missingData: string[];
    suggestedActions: string[];
    supported: boolean;
} {
    const intent = classifyAiQueryIntent(query);
    const now = new Date();
    const matchedItems: InventoryAiMatchedItem[] = [];
    const suggestedActions: string[] = [];
    const missingData: string[] = [];
    const filtersUsed: Record<string, any> = { intent };

    if (intent === 'missing_serial') {
        snapshot.assets.forEach((asset) => {
            const category = String(asset.category || '').toLowerCase();
            if (['consumable', 'spare_part'].includes(category)) return;
            if (!normalizeSerialValue(asset.serialNumber)) {
                matchedItems.push(buildAiMatchedItem(asset, 'Missing serial number'));
            }
        });
        suggestedActions.push('Backfill serial numbers for high-priority and assigned assets first.');
    } else if (intent === 'warranty_expiry') {
        const soonDays = 90;
        filtersUsed.windowDays = soonDays;
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
        suggestedActions.push('Create purchase requests for low-stock spare parts.');
    } else if (intent === 'procurement') {
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
        suggestedActions.push('Prioritize procurement by stock criticality and failure trends.');
    } else if (intent === 'eol') {
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
        snapshot.assets.forEach((asset) => {
            if (String(asset.category || '').toLowerCase() !== 'license') return;
            if (!asset.warrantyEndDate) return;
            const diff = (asset.warrantyEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
            if (diff <= 90) {
                const reason = diff < 0 ? 'License expired' : `License expires in ${Math.ceil(diff)} day(s)`;
                matchedItems.push(buildAiMatchedItem(asset, reason));
            }
        });
        suggestedActions.push('Renew or reassign expiring licenses before service interruption.');
    } else if (intent === 'duplicates') {
        const serialMap = new Map<string, Asset[]>();
        snapshot.assets.forEach((asset) => {
            const serial = normalizeSerialValue(asset.serialNumber);
            if (!serial) return;
            const key = serial.toLowerCase();
            serialMap.set(key, [...(serialMap.get(key) || []), asset]);
        });
        serialMap.forEach((rows) => {
            if (rows.length <= 1) return;
            rows.forEach((asset) => matchedItems.push(buildAiMatchedItem(asset, `Duplicate serial (${asset.serialNumber})`)));
        });
        suggestedActions.push('Merge or correct duplicate records after verification.');
    } else {
        return {
            answer: INVENTORY_AI_SUPPORTED_HINT,
            matchedItems: [],
            filtersUsed,
            confidence: 'low',
            missingData: [],
            suggestedActions: ['Ask about missing serials, warranty expiry, maintenance, stock, duplicates, EOL, or procurement.'],
            supported: false,
        };
    }

    if (!snapshot.assets.length) missingData.push('assets');
    if (!snapshot.components.length) missingData.push('components');
    if (!snapshot.maintenance.length) missingData.push('maintenanceRecords');
    if (!snapshot.lifecycleEvents.length) missingData.push('lifecycleEvents');
    if (!snapshot.spareStock.length) missingData.push('spareStockItems');

    const answer = matchedItems.length
        ? `Found ${matchedItems.length} matching item(s) for "${query}".`
        : `No matching records were found for "${query}" in the current dataset.`;
    const confidence: 'low' | 'medium' | 'high' = matchedItems.length > 20
        ? 'high'
        : matchedItems.length > 0
            ? 'medium'
            : 'low';

    return {
        answer,
        matchedItems: matchedItems.slice(0, 120),
        filtersUsed,
        confidence,
        missingData,
        suggestedActions,
        supported: true,
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
    const aliases: Record<string, string> = {
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
    const raw = String(type || '');
    return aliases[raw.toUpperCase()] || raw.toLowerCase();
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
    'network_switch',
    'access_point',
    'firewall_appliance',
    'ip_phone',
    'cctv_camera',
    'nvr_dvr',
    'ups',
    'nas_storage',
    'external_storage_device',
    'lab_computer',
    'biometric_attendance_device',
    'monitor',
    'scanner',
]);

function isTelemetryCapableAsset(params: { type?: unknown; category?: unknown }): boolean {
    const category = String(params.category || '').trim().toLowerCase();
    if (['license', 'consumable', 'spare_part', 'component'].includes(category)) return false;
    return TELEMETRY_CAPABLE_ASSET_TYPES.has(canonicalAssetType(params.type));
}

function buildTelemetryDefaultsForAsset(params: {
    type?: unknown;
    category?: unknown;
    existingSpecs?: Record<string, any>;
    location?: unknown;
}): Record<string, any> {
    const specs = params.existingSpecs || {};
    const telemetryExplicit = (
        specs.trackWorkingHours === true
        || String(specs.trackWorkingHours || '').toLowerCase() === 'true'
        || specs.telemetryEnabled === true
        || String(specs.telemetryEnabled || '').toLowerCase() === 'true'
    );
    const telemetryCapable = isTelemetryCapableAsset({ type: params.type, category: params.category });
    const telemetryEnabled = telemetryExplicit || telemetryCapable;
    const locationLabel = String(params.location || '').trim().toLowerCase();
    const inWarehouse = !locationLabel || locationLabel === 'central warehouse';
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
    const specs = ((asset.specifications as Record<string, any>) || {});
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
                            location: mapToAssetLocation(row.location || 'Central Warehouse'),
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
                                location: row.location || 'Central Warehouse',
                                existingSpecs: buildImportSpecifications({
                                    brand: row.brand || undefined,
                                    version: row.model || undefined,
                                    autoComponentsFromSpecs: false,
                                }),
                            }),
                        }
                    });
                    createdAssets.push(created.customId);
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

            for (const row of revalidated.normalizedRows) {
                if (row.recordType === 'parent_asset') continue;
                try {
                    if (row.recordType === 'embedded_component') {
                        const parentId = parentTagToCustomId.get(String(row.parentAssetTag || '').toLowerCase());
                        if (!parentId) {
                            skippedRows.push({ rowNumber: row.rowNumber, reason: `Parent not found for tag ${row.parentAssetTag}` });
                            continue;
                        }
                        const parentAssetRef = await tx.asset.findUnique({
                            where: { customId: parentId },
                            select: { customId: true, name: true, assetTag: true, location: true, department: true },
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
                            const generatedCustomId = componentTag || await generateComponentAssetCustomId(parentId, row.componentType || 'component');
                            childAsset = await tx.asset.create({
                                data: {
                                    customId: generatedCustomId,
                                    name: row.assetName,
                                    type: mapToAssetType(row.assetType || row.componentType || 'electronics'),
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
                                        componentType: row.componentType || 'component',
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
                                        componentType: row.componentType || 'component',
                                    }),
                                }
                            });
                        }

                        const component = await tx.assetComponent.create({
                            data: {
                                parentAssetId: parentId,
                                childAssetId: childAsset.customId,
                                componentName: row.assetName,
                                componentType: row.componentType || 'component',
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
                        const parentId = row.parentAssetTag
                            ? parentTagToCustomId.get(String(row.parentAssetTag || '').toLowerCase()) || null
                            : null;
                        const parentAssetRef = parentId
                            ? await tx.asset.findUnique({
                                where: { customId: parentId },
                                select: { customId: true, name: true, assetTag: true },
                            })
                            : null;
                        const customId = normalizeSerialValue(row.assetTag) || `IMPORTED-COMP-${Date.now()}-${row.rowNumber}`;
                        const child = await tx.asset.create({
                            data: {
                                customId,
                                name: row.assetName,
                                type: mapToAssetType(row.assetType || row.componentType || 'electronics'),
                                status: mapToAssetStatus(row.status || 'active'),
                                lifecycleStatus: parentId ? 'IN_USE' : mapToLifecycleStatus(row.lifecycleStatus || 'in_stock'),
                                category: 'COMPONENT',
                                value: row.purchaseCost || 0,
                                quantity: 1,
                                serialNumber: normalizeSerialValue(row.serialNumber),
                                assetTag: normalizeSerialValue(row.assetTag),
                                manufacturerPartNumber: normalizeSerialValue(row.manufacturerPartNumber),
                                location: mapToAssetLocation(row.location || 'Central Warehouse'),
                                department: mapToAssetDepartment(row.department || 'Unassigned'),
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
                                    } : {}),
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
                                    componentType: row.componentType || 'component',
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
                        const qty = Number.isFinite(Number(row.quantity)) && Number(row.quantity) > 0
                            ? Math.trunc(Number(row.quantity))
                            : 1;
                        const baseId = normalizeSerialValue(row.assetTag) || `IMPORTED-${Date.now()}-${row.rowNumber}`;
                        const unitIds = buildUnitAssetIds(baseId, qty);
                        for (let unitIdx = 0; unitIdx < unitIds.length; unitIdx += 1) {
                            const unitId = unitIds[unitIdx];
                            const created = await tx.asset.create({
                                data: {
                                    customId: unitId,
                                    name: row.assetName,
                                    type: mapToAssetType(row.assetType || 'electronics'),
                                    status: mapToAssetStatus(row.status || 'active'),
                                    lifecycleStatus: mapToLifecycleStatus(row.lifecycleStatus || 'in_stock'),
                                    category: mapToAssetCategory(row.recordType),
                                    value: row.purchaseCost || 0,
                                    quantity: 1,
                                    serialNumber: unitIdx === 0 ? normalizeSerialValue(row.serialNumber) : null,
                                    assetTag: unitIdx === 0 ? normalizeSerialValue(row.assetTag) : null,
                                    manufacturerPartNumber: normalizeSerialValue(row.manufacturerPartNumber),
                                    location: mapToAssetLocation(row.location || 'Central Warehouse'),
                                    department: mapToAssetDepartment(row.department || 'Unassigned'),
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
                                        location: row.location || 'Central Warehouse',
                                        existingSpecs: buildImportSpecifications({
                                            brand: row.brand || undefined,
                                            version: row.model || undefined,
                                        }),
                                    }),
                                }
                            });
                            createdAssets.push(created.customId);
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
            };
        });

        const success = errors.length === 0;
        res.json({
            success,
            importBatchId,
            createdAssets: result.createdAssets.length,
            createdComponents: result.createdComponents.length,
            createdSpareStockItems: result.createdSpareStockItems.length,
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
        const snapshot = await buildInventoryAiSnapshot();
        const deterministic = deterministicAssistantAnswer(snapshot, query);
        const ai = await callInventoryAiHelper('/inventory-assistant', {
            query,
            deterministicResult: deterministic,
            contextSummary: {
                assets: snapshot.assets.length,
                components: snapshot.components.length,
                maintenance: snapshot.maintenance.length,
                lifecycleEvents: snapshot.lifecycleEvents.length,
                spareStock: snapshot.spareStock.length,
            },
        }, 11_000);
        const answer = String(ai?.answer || deterministic.answer || INVENTORY_AI_SUPPORTED_HINT);
        const suggestedActions = Array.isArray(ai?.suggested_actions)
            ? ai.suggested_actions.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 12)
            : deterministic.suggestedActions;
        return res.json({
            answer,
            matchedItems: deterministic.matchedItems,
            filtersUsed: deterministic.filtersUsed,
            confidence: String(ai?.confidence || deterministic.confidence || 'low'),
            missingData: Array.isArray(ai?.missing_data)
                ? ai.missing_data.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 24)
                : deterministic.missingData,
            suggestedActions,
            fallbackUsed: !ai,
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
            location: AssetLocation;
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
                    location: parentAsset.location,
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
            const installedParentLocation = linkedComponent?.parentAsset?.location || relationshipParent?.location || null;
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

        const enrichedSpecificationsBase: Record<string, any> = {
            ...inputSpecifications,
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
        ) || isTelemetryCapableAsset({ type, category: normalizedCategory });
        const enrichedSpecifications = buildTelemetryDefaultsForAsset({
            type,
            category: normalizedCategory,
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
                location: mapToAssetLocation(location || 'Central Warehouse'),
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
            updateData.location = mapToAssetLocation(destination);
            updateData.status = 'ACTIVE';
            updateData.assignedUser = null;
            updateData.lifecycleStatus = 'IN_TRANSIT';
            updateData.custodyStatus = 'UNASSIGNED';
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
                specifications: (asset.specifications as Record<string, any>) || {}
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
