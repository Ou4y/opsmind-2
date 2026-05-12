import dotenv from 'dotenv';
dotenv.config();

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

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const INVENTORY_AI_SERVICE_URL = process.env.INVENTORY_AI_SERVICE_URL || 'http://localhost:8002';
const SPEC_VERIFICATION_CONFIDENCE_THRESHOLD = Number(process.env.SPEC_VERIFICATION_CONFIDENCE_THRESHOLD || 0.85);

// ✅ FIXED: REMOVED HARDCODED OVERRIDE
if (!process.env.RABBITMQ_URI) {
    console.warn("⚠️ No RABBITMQ_URI found in ENV. Defaulting to localhost.");
    process.env.RABBITMQ_URI = "amqp://admin:password123@localhost:5672";
}

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type']
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

const OPERATIONAL_STATE_RATES: Record<string, number> = {
    online_in_use: 1,
    online_idle: 0.2,
    offline: 0
};

function resolveTelemetryState(isOnline: boolean, isActive: boolean): string {
    if (!isOnline) return 'offline';
    return isActive ? 'online_in_use' : 'online_idle';
}

function getTelemetryAdjustedHours(specifications: Record<string, any>): number {
    const storedHours = Number(specifications.workingHours || 0);
    const previousState = String(specifications.operationalState || 'offline');
    const previousUpdate = specifications.operationalStateUpdatedAt
        ? new Date(specifications.operationalStateUpdatedAt)
        : null;

    if (!previousUpdate || Number.isNaN(previousUpdate.getTime())) return storedHours;

    const elapsedHours = Math.max(0, (Date.now() - previousUpdate.getTime()) / 36e5);
    return storedHours + elapsedHours * (OPERATIONAL_STATE_RATES[previousState] ?? 0);
}

function normalizeValue(value: unknown): string {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
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

function getEffectiveWorkingHours(specs: Record<string, any>): number {
    const storedHours = Math.max(0, getSpecNumber(specs, ['workingHours', 'Working Hours'], 0));
    const state = String(specs.operationalState || 'offline');
    const stateUpdatedAt = specs.operationalStateUpdatedAt ? new Date(specs.operationalStateUpdatedAt) : null;

    if (!stateUpdatedAt || Number.isNaN(stateUpdatedAt.getTime())) return storedHours;
    const elapsedHours = Math.max(0, (Date.now() - stateUpdatedAt.getTime()) / 36e5);
    return storedHours + (elapsedHours * (OPERATIONAL_STATE_RATES[state] ?? 0));
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
            confidence?: number;
            source?: string;
            source_urls?: string[];
            lookup_mode?: string;
            rule_version?: string;
            variant?: string;
        };

        const inferred = data.inferred_specifications || {};
        const merged: Record<string, any> = { ...inferred, ...existing };
        merged.aiDetectedSpecs = inferred;
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
app.post('/api/assets', async (req: Request, res: Response) => {
    try {
        console.log(`📥 POST /api/assets from ${req.ip} - headers: ${JSON.stringify(req.headers)}`);
        console.log('📦 Payload:', JSON.stringify(req.body));

        const { name, type, value, customId, location, department, quantity, specifications } = req.body;
        const inputSpecifications = (specifications && typeof specifications === 'object') ? specifications : {};
        const enrichedSpecifications = await enrichAssetSpecificationsWithAI({
            name: String(name || ''),
            type: String(type || ''),
            existingSpecs: inputSpecifications
        });

        const qty = Number(quantity) || 1;
        const baseCustomId = customId || `ASSET-${Date.now()}`;

        const createdAssets = [];

        for (let i = 0; i < qty; i++) {
            const uniqueSuffix = qty > 1 ? `${baseCustomId}-${i + 1}` : baseCustomId;

            const asset = await AssetService.createAsset({
                customId: uniqueSuffix,
                name: name,
                type: mapToAssetType(type),
                status: 'ACTIVE',
                value: value || 0,
                location: mapToAssetLocation(location || 'Central Warehouse'),
                department: mapToAssetDepartment(department || 'Unassigned'),
                quantity: 1,
                specifications: enrichedSpecifications,
            });

            // Add creation history
            await HistoryService.createHistory({
                assetId: uniqueSuffix,
                action: 'Created',
                details: qty > 1 ? `Batch item ${i + 1} of ${qty}` : 'Asset Created'
            });

            createdAssets.push(asset);
        }

        console.log('✅ Created assets (customIds):', createdAssets.map(a => a.customId));

        await EventBus.publish(TOPICS.ASSET_CREATED, {
            summary: `Batch created: ${qty} x ${name}`,
            firstId: createdAssets[0].customId,
            totalQuantity: qty,
            timestamp: new Date()
        });

        res.status(201).json({
            message: `Successfully created ${qty} individual assets`,
            assets: createdAssets
        });

    } catch (error: any) {
        console.error("❌ POST Error:", error.message);
        if (error.code === 'P2002') return res.status(400).json({ message: "Asset ID already exists. Try a different ID." });
        res.status(500).json({ message: error.message });
    }
});

// --- TRANSFER & SPLIT LOGIC ---
app.patch('/api/assets/:id/transfer', async (req: Request, res: Response) => {
    const { destType, destination, quantityToMove } = req.body;
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

        const moveQty = Number(quantityToMove) || asset.quantity;
        if (moveQty > asset.quantity) return res.status(400).json({ message: "Not enough quantity." });

        if (moveQty === asset.quantity) {
            const updated = await AssetService.updateAsset(req.params.id, updateData);
            await HistoryService.createHistory({
                assetId: req.params.id,
                action: 'Transfer',
                details: `Moved to ${destType}: ${destination}`
            });
            return res.json(updated);
        }

        // Partial transfer - reduce original quantity
        const updated = await AssetService.updateAsset(req.params.id, {
            quantity: asset.quantity - moveQty
        });

        const LOW_STOCK_THRESHOLD = 5;
        if (updated.quantity <= LOW_STOCK_THRESHOLD) {
            await notificationService.notifyLowStock(
                asset.customId,
                asset.name,
                updated.quantity,
                'admin1',
                'admin@email.com'
            );

            await EventBus.publish(TOPICS.ASSET_LOW_STOCK, {
                event: 'Low_Stock_Warning',
                assetId: asset.customId,
                name: asset.name,
                currentQuantity: updated.quantity,
                location: asset.location,
                timestamp: new Date()
            });
        }

        await HistoryService.createHistory({
            assetId: req.params.id,
            action: 'Distributed',
            details: `Sent ${moveQty} units to ${destination}`
        });

        // Create new batch for transferred quantity
        const newSplitId = `${asset.customId}-SPLIT-${Math.floor(1000 + Math.random() * 9000)}`;
        const newBatch = await AssetService.createAsset({
            customId: newSplitId,
            name: asset.name,
            type: asset.type,
            status: asset.status,
            value: Number(asset.value),
            quantity: moveQty,
            location: updateData.location || asset.location,
            department: updateData.department || asset.department,
            assignedUser: updateData.assignedUser,
            specifications: (asset.specifications as Record<string, any>) || {}
        });

        await HistoryService.createHistory({
            assetId: newSplitId,
            action: 'Received_Distribution',
            details: `Split from ${asset.customId}`
        });

        res.json({ original: updated, newBatch });
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
        const adjustedHours = getTelemetryAdjustedHours(currentSpecs);
        const timestamp = reportedAt ? new Date(reportedAt) : new Date();

        const updatedSpecifications = {
            ...currentSpecs,
            trackWorkingHours: true,
            workingHours: Math.round(adjustedHours),
            operationalState: nextState,
            operationalStateUpdatedAt: timestamp.toISOString(),
            lastTelemetryAt: timestamp.toISOString()
        };

        const updatedAsset = await AssetService.updateAsset(req.params.id, {
            specifications: updatedSpecifications
        });

        await HistoryService.createHistory({
            assetId: req.params.id,
            action: 'Telemetry Updated',
            details: `Detected state: ${nextState}`
        });

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
    const startedAt = Date.now();

    try {
        const asset = await AssetService.getAssetByCustomId(id);
        if (!asset) return res.status(404).json({ message: 'Asset not found', requestId });

        const specs = ((asset.specifications as Record<string, any>) || {});
        const bodyBase = Number(req.body?.baseLifespanYears);
        const baseLifespanYears = Number.isFinite(bodyBase) && bodyBase > 0 ? bodyBase : 5;
        const payload = {
            assetId: asset.customId,
            type: canonicalAssetType(asset.type),
            brand: String(specs.brand || specs.Brand || '').trim(),
            model: String(specs.version || specs.Version || specs.model || specs.Model || '').trim(),
            specifications: specs,
            baseLifespanYears,
            workingHours: Math.round(getEffectiveWorkingHours(specs)),
            operationalState: String(specs.operationalState || 'offline')
        };

        const aiResponse = await fetch(`${INVENTORY_AI_SERVICE_URL}/predict-asset-lifespan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-request-id': requestId
            },
            body: JSON.stringify(payload)
        });

        if (!aiResponse.ok) {
            const errorText = await aiResponse.text();
            console.error(`[InventoryAI] requestId=${requestId} status=${aiResponse.status} body=${errorText}`);
            return res.status(502).json({
                message: 'Inventory AI service unavailable',
                requestId,
                upstreamStatus: aiResponse.status
            });
        }

        const prediction = await aiResponse.json();
        const durationMs = Date.now() - startedAt;
        console.log(`[InventoryAI] requestId=${requestId} assetId=${id} status=ok durationMs=${durationMs}`);

        return res.json({
            ...prediction,
            requestId,
            observedBy: 'inventory-backend',
            durationMs
        });
    } catch (error: any) {
        const durationMs = Date.now() - startedAt;
        console.error(`[InventoryAI] requestId=${requestId} assetId=${id} status=error durationMs=${durationMs} error=${error.message}`);
        return res.status(500).json({
            message: 'Failed to retrieve lifespan prediction',
            requestId
        });
    }
});

app.patch('/api/assets/:id/details', async (req: Request, res: Response) => {
    try {
        const { name, type, department, quantity, specifications } = req.body;

        const updateData: any = {};
        if (name) updateData.name = name;
        if (type) updateData.type = mapToAssetType(type);
        if (department) updateData.department = mapToAssetDepartment(department);
        if (quantity) updateData.quantity = Number(quantity);
        if (specifications) updateData.specifications = specifications;

        const updatedAsset = await AssetService.updateAsset(req.params.id, updateData);

        if (!updatedAsset) return res.status(404).json({ message: "Asset not found" });

        await HistoryService.createHistory({
            assetId: req.params.id,
            action: 'Details Updated',
            details: 'Specs modified'
        });

        res.json(updatedAsset);
    } catch (error: any) {
        console.error("❌ Details Update Error:", error.message);
        res.status(500).json({ message: "Update failed", error: error.message });
    }
});

// --- DELETE LOGIC ---
app.delete('/api/assets/:id', async (req: Request, res: Response) => {
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

startServer();
