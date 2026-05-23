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
import { EOL_METRICS } from './config/constants';
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
import { Asset, AssetType, AssetStatus, AssetLocation, AssetDepartment } from '@prisma/client';
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

function parseBooleanFlag(value: unknown): boolean {
    if (value === true) return true;
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
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
        reasonParts.push('Lifecycle start date is missing; EOL date confidence is reduced.');
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

// --- ASSET ROUTES ---

app.get('/api/assets', async (req: Request, res: Response) => {
    try {
        const assets = await AssetService.getAssets();
        res.json(assets.map((asset) => annotateAssetWithTruthfulSignals(asset)));
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
        );
        const enrichedSpecifications = {
            ...enrichedSpecificationsBase,
            trackWorkingHours: trackTelemetry,
            telemetryEnabled: trackTelemetry,
            telemetryStatus: trackTelemetry ? 'insufficient_data' : 'not_monitored',
            telemetryConfidence: 'low',
            telemetryReason: trackTelemetry
                ? 'Telemetry monitoring enabled, but no live signal has been received yet.'
                : 'Telemetry monitoring disabled for this asset.',
            operationalState: trackTelemetry
                ? (String(enrichedSpecificationsBase.operationalState || '').trim() || 'insufficient_data')
                : 'not_monitored',
            operationalStateUpdatedAt: trackTelemetry
                ? (String(enrichedSpecificationsBase.operationalStateUpdatedAt || '').trim() || new Date().toISOString())
                : undefined,
            lastTelemetryAt: trackTelemetry ? (enrichedSpecificationsBase.lastTelemetryAt || undefined) : undefined,
            workingHours: Number(enrichedSpecificationsBase.workingHours || 0),
        };

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
