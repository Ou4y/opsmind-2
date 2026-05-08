import { Router, Request, Response } from 'express';
import AssetService from '../models/Asset';
import HistoryService from '../models/History';
import { AssetType, AssetLocation, AssetDepartment } from '@prisma/client';

const router = Router();

// Helper functions for enum mapping
function mapToAssetType(value: string): AssetType {
    const typeMap: Record<string, AssetType> = {
        'laptop': 'LAPTOP', 'Laptop': 'LAPTOP',
        'desktop': 'DESKTOP', 'Desktop': 'DESKTOP',
        'tablet': 'TABLET', 'Tablet': 'TABLET',
        'server': 'SERVER', 'Server': 'SERVER',
        'monitor': 'MONITOR', 'Monitor': 'MONITOR',
        'peripheral': 'PERIPHERAL', 'Peripheral': 'PERIPHERAL',
    };
    return typeMap[value] || 'ELECTRONICS';
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

// 1. GET ALL ASSETS (For the main table)
router.get('/', async (req: Request, res: Response) => {
    try {
        const assets = await AssetService.getAssets();
        res.json(assets);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// 2. GET SINGLE ASSET (For the Spec Modal / QR Search)
router.get('/single/:customId', async (req: Request, res: Response) => {
    try {
        const asset = await AssetService.getAssetByCustomId(req.params.customId);
        if (!asset) return res.status(404).json({ message: "Asset not found" });
        res.json(asset);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// 3. UPDATE SPECIFICATIONS
router.patch('/:customId/details', async (req: Request, res: Response) => {
    try {
        const { customId } = req.params;
        const { specifications } = req.body;

        const updatedAsset = await AssetService.updateAsset(customId, {
            specifications: specifications || {}
        });

        if (!updatedAsset) return res.status(404).json({ message: "Asset not found" });
        res.json(updatedAsset);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// 4. TRANSFER ASSET
router.patch('/:customId/transfer', async (req: Request, res: Response) => {
    try {
        const { customId } = req.params;
        const { destination, destType } = req.body;

        const updateData: any = {};
        if (destType === 'building') {
            updateData.location = mapToAssetLocation(destination);
        } else if (destType === 'department') {
            updateData.department = mapToAssetDepartment(destination);
        }

        const asset = await AssetService.updateAsset(customId, updateData);

        if (!asset) return res.status(404).json({ message: "Asset not found" });

        await HistoryService.createHistory({
            assetId: customId,
            action: 'Transfer',
            details: `Moved to ${destination} (${destType})`
        });

        res.json(asset);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

export default router;
