import dotenv from 'dotenv';
dotenv.config();

<<<<<<< Updated upstream
import express, { Request, Response, NextFunction } from 'express';
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
import { notificationService } from './services/NotificationService';
import { AssetType, AssetStatus, AssetLocation, AssetDepartment } from '@prisma/client';
import { requireInventoryAdminAccess, requireInventoryReadAccess } from './middlewares/inventoryAuth';
=======
import express, { Request, Response, NextFunction } from 'express';
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
import { Asset, AssetType, AssetStatus, AssetLocation, AssetDepartment } from '@prisma/client';
>>>>>>> Stashed changes

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const INVENTORY_AI_SERVICE_URL = process.env.INVENTORY_AI_SERVICE_URL || 'http://localhost:8002';
const SPEC_VERIFICATION_CONFIDENCE_THRESHOLD = Number(process.env.SPEC_VERIFICATION_CONFIDENCE_THRESHOLD || 0.85);
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3002';
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || '';
const LIFESPAN_IMPACT_MIN_HOURS = Math.max(0.5, Number(process.env.LIFESPAN_IMPACT_MIN_HOURS || 2));
const LIFESPAN_IMPACT_MIN_YEAR_DELTA = Math.max(0.05, Number(process.env.LIFESPAN_IMPACT_MIN_YEAR_DELTA || 0.1));
const LIFESPAN_IMPACT_MIN_RISK_DELTA = Math.max(0.01, Number(process.env.LIFESPAN_IMPACT_MIN_RISK_DELTA || 0.03));

class RequestValidationError extends Error {}

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
    const typeMap: Record<string, AssetType> = {
        'laptop': 'LAPTOP', 'Laptop': 'LAPTOP',
        'desktop': 'DESKTOP', 'Desktop': 'DESKTOP',
        'tablet': 'TABLET', 'Tablet': 'TABLET',
        'server': 'SERVER', 'Server': 'SERVER',
        'monitor': 'MONITOR', 'Monitor': 'MONITOR',
        'peripheral': 'PERIPHERAL', 'Peripheral': 'PERIPHERAL',
        'keyboard': 'KEYBOARD', 'Keyboard': 'KEYBOARD',
        'electronics': 'ELECTRONICS', 'Electronics': 'ELECTRONICS',
        'projector': 'PROJECTOR', 'Projector': 'PROJECTOR',
        'smartboard': 'SMARTBOARD', 'Smartboard': 'SMARTBOARD',
        'camera': 'CAMERA', 'Camera': 'CAMERA',
        'speaker': 'SPEAKER', 'Speaker': 'SPEAKER',
        'microphone': 'MICROPHONE', 'Microphone': 'MICROPHONE',
        'router': 'ROUTER', 'Router': 'ROUTER',
        'switch': 'SWITCH', 'Switch': 'SWITCH',
        'access_point': 'ACCESS_POINT', 'Access_Point': 'ACCESS_POINT',
        'firewall': 'FIREWALL', 'Firewall': 'FIREWALL',
        'printer': 'PRINTER', 'Printer': 'PRINTER',
        'scanner': 'SCANNER', 'Scanner': 'SCANNER',
        'desk': 'DESK', 'Desk': 'DESK',
        'chair': 'CHAIR', 'Chair': 'CHAIR',
        'whiteboard': 'WHITEBOARD', 'Whiteboard': 'WHITEBOARD',
        'filing_cabinet': 'FILING_CABINET', 'Filing_Cabinet': 'FILING_CABINET',
        'furniture': 'FURNITURE', 'Furniture': 'FURNITURE',
        'microscope': 'MICROSCOPE', 'Microscope': 'MICROSCOPE',
        'centrifuge': 'CENTRIFUGE', 'Centrifuge': 'CENTRIFUGE',
        'oscilloscope': 'OSCILLOSCOPE', 'Oscilloscope': 'OSCILLOSCOPE',
        '3d_printer': 'THREE_D_PRINTER', '3D_Printer': 'THREE_D_PRINTER',
        'lab_bench': 'LAB_BENCH', 'Lab_Bench': 'LAB_BENCH',
        'vehicle': 'VEHICLE', 'Vehicle': 'VEHICLE',
        'generator': 'GENERATOR', 'Generator': 'GENERATOR',
        'hvac': 'HVAC', 'HVAC': 'HVAC',
        'maintenance_tool': 'MAINTENANCE_TOOL', 'Maintenance_Tool': 'MAINTENANCE_TOOL',
    };
    return typeMap[value] || 'ELECTRONICS';
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
    offline: 0
};

function resolveTelemetryState(isOnline: boolean, isActive: boolean): string {
    if (!isOnline) return 'offline';
    return isActive ? 'online_in_use' : 'online_idle';
}

function isTelemetryTracked(specifications: Record<string, any>): boolean {
    return specifications.trackWorkingHours === true || String(specifications.trackWorkingHours || '').toLowerCase() === 'true';
}

function getTelemetryAdjustedHours(specifications: Record<string, any>, measuredAt: Date = new Date()): number {
    const storedHours = isTelemetryTracked(specifications) ? Number(specifications.workingHours || 0) : 0;
    const previousState = String(specifications.operationalState || 'offline');
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

function stripLifecycleManagedSpecFields(specs: Record<string, any>): Record<string, any> {
    const safeSpecs: Record<string, any> = {};
    for (const key of Object.keys(specs || {})) {
        if (!AI_SPEC_PROTECTED_FIELDS.has(normalizeValue(key))) {
            safeSpecs[key] = specs[key];
        }
    }
    return safeSpecs;
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
    const state = String(specs.operationalState || 'offline');
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
    const workingHours = Math.round(getEffectiveWorkingHours(specs, opts.asOf || new Date()));
    const operationalState = String(specs.operationalState || 'offline');

    const payload = {
        assetId: asset.customId,
        type: canonicalAssetType(asset.type),
        brand: String(specs.brand || specs.Brand || '').trim(),
        model: String(specs.version || specs.Version || specs.model || specs.Model || '').trim(),
        specifications: specs,
        baseLifespanYears,
        workingHours,
        operationalState,
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
    const previousSnapshot = readLifespanSnapshot(specs);
    const asOf = options.asOf || new Date();
    const currentWorkingHours = Math.round(getEffectiveWorkingHours(specs, asOf));
    const currentState = String(specs.operationalState || 'offline');
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
    const looksFallback = lookupMode.includes('fallback') || lookupMode.includes('low_confidence');
    return confidence < SPEC_VERIFICATION_CONFIDENCE_THRESHOLD || !hasSources || looksFallback;
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

    if (!brand && !model && !params.name) return existing;

    try {
        const response = await fetch(`${INVENTORY_AI_SERVICE_URL}/infer-asset-specs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: params.name,
                type: canonicalAssetType(params.type),
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
<<<<<<< Updated upstream
        merged.aiSpecConfidence = Number(data.confidence || 0);
        merged.aiSpecSource = data.source || 'inventory-ai-spec-inference-v1';
        merged.aiSpecLookupMode = data.lookup_mode || 'heuristic_fallback';
        merged.aiSpecSourceUrls = Array.isArray(data.source_urls) ? data.source_urls : [];
        merged.aiSpecRuleVersion = data.rule_version || 'spec-rules-v1';
        merged.aiSpecVariant = data.variant || 'control';
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
app.use('/api/config', requireInventoryReadAccess);
app.use('/api/assets', requireInventoryReadAccess);
app.use('/api/tickets', ticketRoutes);
app.use('/api/config', configRoutes);
=======
        merged.aiSpecFieldConfidence = fieldConfidence;
        merged.aiSpecConfidence = Number(data.confidence || 0);
        merged.aiSpecSource = data.source || 'inventory-ai-spec-inference-v1';
        merged.aiSpecLookupMode = data.lookup_mode || 'heuristic_fallback';
        merged.aiSpecSourceUrls = Array.isArray(data.source_urls) ? data.source_urls : [];
        merged.aiSpecRuleVersion = data.rule_version || 'spec-rules-v1';
        merged.aiSpecVariant = data.variant || 'control';
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
app.use('/api/tickets', ticketRoutes);
app.use('/api/config', configRoutes);
>>>>>>> Stashed changes

// --- ASSET ROUTES ---

app.get('/api/assets', async (req: Request, res: Response) => {
    try {
        const assets = await AssetService.getAssets();
        res.json(assets);
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
        res.json(asset);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Search failed" });
    }
});

// --- GENERAL SEARCH ENDPOINT ---
app.get('/api/assets/search', async (req: Request, res: Response) => {
    const { query } = req.query;
    try {
        const results = await prisma.asset.findMany({
            where: {
                OR: [
                    { customId: { contains: query as string, mode: 'insensitive' } },
                    { name: { contains: query as string, mode: 'insensitive' } }
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

app.patch('/api/assets/:id/spec-verification', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { action, correctedSpecifications = {}, reviewer = 'inventory-admin' } = req.body;
        const asset = await AssetService.getAssetByCustomId(id);
        if (!asset) return res.status(404).json({ message: 'Asset not found' });

        const specs = ((asset.specifications as Record<string, any>) || {});
        const normalizedAction = String(action || '').toLowerCase();
        if (!['approve', 'correct', 'reject'].includes(normalizedAction)) {
            return res.status(400).json({ message: 'action must be approve, correct, or reject' });
        }

        const nextSpecs = { ...specs };
        if (normalizedAction === 'approve') {
            nextSpecs.specVerificationStatus = 'verified';
        } else if (normalizedAction === 'correct') {
            Object.assign(nextSpecs, correctedSpecifications || {});
            nextSpecs.specVerificationStatus = 'corrected';
        } else {
            nextSpecs.specVerificationStatus = 'rejected';
        }
        nextSpecs.specVerificationReviewedBy = reviewer;
        nextSpecs.specVerificationReviewedAt = new Date().toISOString();
        nextSpecs.specVerificationAction = normalizedAction;
        if (normalizedAction === 'correct') {
            nextSpecs.specVerificationCorrections = correctedSpecifications || {};
        }

        const updated = await AssetService.updateAsset(id, { specifications: nextSpecs });

        await HistoryService.createHistory({
            assetId: id,
            action: 'Spec Verification',
            details: `Action: ${normalizedAction} by ${reviewer}`
        });

        await submitSpecVerificationFeedback({
            assetId: id,
            action: normalizedAction,
            name: String(asset.name || ''),
            type: canonicalAssetType(asset.type),
            brand: String(specs.brand || specs.Brand || ''),
            model: String(specs.version || specs.Version || specs.model || specs.Model || ''),
            predicted_specifications: specs.aiDetectedSpecs || {},
            corrected_specifications: normalizedAction === 'correct' ? (correctedSpecifications || {}) : (specs.aiDetectedSpecs || {}),
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

        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to update spec verification status', error: error.message });
    }
});

// --- GET ASSET HISTORY ---
app.get('/api/assets/:id/history', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const history = await HistoryService.getHistoryForAsset(id);
        res.json(history);
    } catch (err) {
        console.error('Error fetching history:', err);
        res.status(500).json({ message: "Failed to fetch history" });
    }
});

// --- CATCH-ALL FETCH ROUTE ---
app.get('/api/assets/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const asset = await AssetService.getAssetByCustomId(id);

        if (!asset) return res.status(404).json({ message: "Asset not found" });
        res.json(asset);
    } catch (err) {
        res.status(500).json({ message: "Server error fetching asset" });
    }
});

// --- CREATE LOGIC ---
app.post('/api/assets', requireInventoryAdminAccess, async (req: Request, res: Response) => {
    try {
        console.log(`📥 POST /api/assets from ${req.ip} - headers: ${JSON.stringify(req.headers)}`);
        console.log('📦 Payload:', JSON.stringify(req.body));

        const { name, type, value, customId, location, department, quantity, specifications, admin } = req.body;
        if (!String(name || '').trim()) {
            return res.status(400).json({ message: 'Asset name is required.' });
        }
        if (!String(type || '').trim()) {
            return res.status(400).json({ message: 'Asset type is required.' });
        }
        const inputSpecifications = (specifications && typeof specifications === 'object') ? specifications : {};
        const enrichedSpecifications = await enrichAssetSpecificationsWithAI({
            name: String(name || ''),
            type: String(type || ''),
            existingSpecs: inputSpecifications
        });

        const qty = parseRequestedQuantity(quantity ?? 1);
        const assetGroupId = String(customId || `ASSET-${Date.now()}`).trim();
        const unitIds = buildUnitAssetIds(assetGroupId, qty);
        console.log(`[AssetCreateDebug] quantityRequested=${qty} generatedUnitIds=${unitIds.length}`);

        const createdAssets = await AssetService.createAssets(
            unitIds.map((unitId) => ({
                customId: unitId,
                name: String(name),
                type: mapToAssetType(type),
                status: 'ACTIVE',
                value: value || 0,
                location: mapToAssetLocation(location || 'Central Warehouse'),
                department: mapToAssetDepartment(department || 'Unassigned'),
                quantity: 1,
                specifications: enrichedSpecifications,
            }))
        );
        console.log(`[AssetCreateDebug] insertedRecords=${createdAssets.length} requestedQuantity=${qty}`);

        for (const createdAsset of createdAssets) {
            try {
                const creationRefresh = await refreshAndPersistAssetLifespan(createdAsset.customId, {
                    reason: 'asset_created',
                    forcePersist: true,
                });
                if (!creationRefresh.persisted) {
                    console.warn(`[InventoryAI] initial lifespan snapshot skipped for ${createdAsset.customId}: ${creationRefresh.skippedReason}`);
                }
            } catch (error: any) {
                console.warn(`[InventoryAI] initial lifespan snapshot failed for ${createdAsset.customId}: ${error.message}`);
            }
        }

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

        res.status(201).json({
            message: `Successfully created ${createdAssets.length} asset unit(s).`,
            quantityRequested: qty,
            createdCount: createdAssets.length,
            assetGroupId,
            asset: createdAssets[0],
            assets: createdAssets
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
// --- TRANSFER & SPLIT LOGIC ---
app.patch('/api/assets/:id/transfer', async (req: Request, res: Response) => {
    const { destType, destination, quantityToMove, admin } = req.body;
    console.log(`📦 Attempting transfer for ID: ${req.params.id}`);

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
        } else if (destType === 'department') {
            updateData.department = mapToAssetDepartment(destination);
        } else if (destType === 'user') {
            updateData.assignedUser = destination;
            updateData.status = 'ASSIGNED';
        }

        const parsedMoveQty = Number(quantityToMove);
        const moveQty = Number.isFinite(parsedMoveQty) && parsedMoveQty > 0 ? parsedMoveQty : asset.quantity;
        if (!Number.isInteger(moveQty) || moveQty <= 0) {
            return res.status(400).json({ message: "quantityToMove must be a positive integer." });
        }
        if (moveQty > asset.quantity) return res.status(400).json({ message: "Not enough quantity." });

        if (moveQty === asset.quantity) {
            const updated = await AssetService.updateAsset(req.params.id, updateData);
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
            try {
                await refreshAndPersistAssetLifespan(updated.customId, {
                    reason: 'asset_transferred',
                    forcePersist: true,
                });
            } catch (error: any) {
                console.warn(`[InventoryAI] transfer lifespan refresh failed for ${updated.customId}: ${error.message}`);
            }
            const refreshed = await AssetService.getAssetByCustomId(updated.customId);
            return res.json(refreshed || updated);
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
            try {
                await refreshAndPersistAssetLifespan(newBatch.customId, {
                    reason: 'asset_transferred',
                    forcePersist: true,
                });
            } catch (error: any) {
                console.warn(`[InventoryAI] split transfer lifespan refresh failed for ${newBatch.customId}: ${error.message}`);
            }
        }
        const refreshedOriginal = await AssetService.getAssetByCustomId(updated.customId);
        const refreshedSplits = await Promise.all(newBatches.map((newBatch) => AssetService.getAssetByCustomId(newBatch.customId)));

        res.json({
            original: refreshedOriginal || updated,
            newBatch: refreshedSplits[0] || newBatches[0],
            newBatches: refreshedSplits.filter((entry): entry is Asset => Boolean(entry)),
        });
    } catch (error: any) {
        console.error("❌ Transfer Route Error:", error.message);
        res.status(500).json({ message: "Transfer failed", error: error.message });
    }
});

// --- STATUS & DETAILS UPDATE ---
app.patch('/api/assets/:id/status', async (req: Request, res: Response) => {
    try {
        const { status } = req.body;
        const updated = await AssetService.updateAsset(req.params.id, {
            status: mapToAssetStatus(status)
        });
        await EventBus.publish(TOPICS.ASSET_UPDATED, {
            customId: updated.customId,
            fields: ['status'],
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

        res.json(updatedAsset);
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
    const persistSnapshot = String(req.query.persist || 'true').toLowerCase() !== 'false';

    try {
        const asset = await AssetService.getAssetByCustomId(id);
        if (!asset) return res.status(404).json({ message: 'Asset not found', requestId });

        const bodyBase = Number(req.body?.baseLifespanYears);
        const baseLifespanYears = Number.isFinite(bodyBase) && bodyBase > 0 ? bodyBase : 5;
        const refresh = await refreshAndPersistAssetLifespan(id, {
            reason: 'manual_request',
            forcePersist: persistSnapshot,
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
        const { name, type, department, quantity, specifications, admin } = req.body;

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

        const updatedAsset = await AssetService.updateAsset(req.params.id, updateData);
        if (!updatedAsset) return res.status(404).json({ message: "Asset not found" });

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
app.delete('/api/assets/:id', requireInventoryAdminAccess, async (req: Request, res: Response) => {
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

<<<<<<< Updated upstream
startServer();
=======
startServer();

>>>>>>> Stashed changes
