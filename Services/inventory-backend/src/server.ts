import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { prisma } from './lib/prisma';
import AssetService from './models/Asset';
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
                specifications: specifications || {},
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
