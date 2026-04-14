import { Router, Request, Response } from 'express';
import Asset from '../models/Asset'; 

const router = Router();

// 1. GET ALL ASSETS (For the main table)
router.get('/', async (req: Request, res: Response) => {
    try {
        const assets = await Asset.find().sort({ createdAt: -1 });
        res.json(assets);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// 2. GET SINGLE ASSET (For the Spec Modal / QR Search)
router.get('/single/:customId', async (req: Request, res: Response) => {
    try {
        const asset = await Asset.findOne({ customId: req.params.customId });
        if (!asset) return res.status(404).json({ message: "Asset not found" });
        res.json(asset);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// 3. UPDATE SPECIFICATIONS (The logic we just added)
router.patch('/:customId/details', async (req: Request, res: Response) => {
    try {
        const { customId } = req.params;
        const { specifications } = req.body;

        const updatedAsset = await Asset.findOneAndUpdate(
            { customId },
            { $set: { specifications } },
            { new: true }
        );

        if (!updatedAsset) return res.status(404).json({ message: "Asset not found" });
        res.json(updatedAsset);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// 4. TRANSFER ASSET (Fixes the 500 error in your screenshot)
router.patch('/:customId/transfer', async (req: Request, res: Response) => {
    try {
        const { customId } = req.params;
        const { destination, destType } = req.body;

        // Prepare the update object
        const updateData: any = { location: destination };
        if (destType === 'department') {
            updateData.department = destination;
        }

        const asset = await Asset.findOneAndUpdate(
            { customId },
            { 
                $set: updateData,
                $push: { 
                    history: { 
                        event: 'Transfer', 
                        date: new Date(), 
                        details: `Moved to ${destination} (${destType})` 
                    } 
                } 
            },
            { new: true }
        );

        if (!asset) return res.status(404).json({ message: "Asset not found" });
        res.json(asset);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

export default router;
