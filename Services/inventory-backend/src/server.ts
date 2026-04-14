import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import Asset from './models/Asset';
import { EventBus } from './services/EventBus';
import { TOPICS } from './events/assetEvents';
import ticketRoutes from './routes/ticketRoutes'; 
import configRoutes from './routes/configRoutes'; // ✅ Added the config routes import
import { notificationService } from './services/NotificationService';

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
const MONGO_URI = process.env.MONGO_URI || 'mongodb://opsmind-mongodb:27017/opsmind_assets';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ [API] Connected to MongoDB'))
    .catch((err: any) => console.error('❌ [API] DB Connection Error:', err));

// --- MOUNT ROUTERS ---
app.use('/api/tickets', ticketRoutes);
app.use('/api/config', configRoutes); // ✅ Added the config route to the Express app


// --- ASSET ROUTES ---

app.get('/api/assets', async (req: Request, res: Response) => {
    try {
        const assets = await Asset.find().sort({ createdAt: -1 });
        res.json(assets);
    } catch (err) { res.status(500).json({ error: 'Failed to fetch assets' }); }
});

// --- QR CODE & DIRECT SEARCH ENDPOINT ---
app.get('/api/assets/single/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        console.log(`🔍 Searching for single asset: "${id}"`);

        // 1. Try finding by Custom ID
        let asset = await Asset.findOne({ customId: id });
        
        // 2. Fallback: If not found, check if it's a MongoDB _id
        if (!asset && mongoose.Types.ObjectId.isValid(id)) {
             asset = await Asset.findById(id);
        }

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
        const results = await Asset.find({
            $or: [
                { customId: { $regex: query as string, $options: 'i' } }, 
                { name: { $regex: query as string, $options: 'i' } }      
            ]
        }).limit(50);
        res.json(results);
    } catch (err) {
        res.status(500).json({ message: "Search failed" });
    }
});

// --- CATCH-ALL FETCH ROUTE ---
app.get('/api/assets/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        let asset = await Asset.findOne({ customId: id });
        
        if (!asset && mongoose.Types.ObjectId.isValid(id)) {
            asset = await Asset.findById(id);
        }

        if (!asset) return res.status(404).json({ message: "Asset not found" });
        res.json(asset);
    } catch (err) {
        res.status(500).json({ message: "Server error fetching asset" });
    }
});

// --- CREATE LOGIC ---
app.post('/api/assets', async (req: Request, res: Response) => {
  try {
    // Log request origin and body for debugging frontend create issues
    console.log(`📥 POST /api/assets from ${req.ip} - headers: ${JSON.stringify(req.headers)}`);
    console.log('📦 Payload:', JSON.stringify(req.body));

    const { name, type, value, customId, location, department, quantity, specifications } = req.body;
    
    const qty = Number(quantity) || 1;
    const baseCustomId = customId || `ASSET-${Date.now()}`; 

    const assetsToCreate = [];

    for (let i = 0; i < qty; i++) {
        const uniqueSuffix = qty > 1 ? `${baseCustomId}-${i + 1}` : baseCustomId;

        assetsToCreate.push({
            customId: uniqueSuffix, 
            name: name,             
            type: type,             
            value: value || 0,
            location: location || 'Central Warehouse',
            department: department || 'Unassigned',
            quantity: 1,
            status: 'active',
            specifications: specifications || {}, 
            history: [{ 
                event: 'Created', 
                details: qty > 1 ? `Batch item ${i+1} of ${qty}` : 'Asset Created', 
                date: new Date() 
            }]
        });
    }

    const createdAssets = await Asset.insertMany(assetsToCreate);

    // Log created IDs so we can correlate with DB and later deletes
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
    if (error.code === 11000) return res.status(400).json({ message: "Asset ID conflict. Try a different base ID." });
    res.status(500).json({ message: error.message });
  }
});

// --- TRANSFER & SPLIT LOGIC ---
app.patch('/api/assets/:id/transfer', async (req: Request, res: Response) => {
  const { destType, destination, quantityToMove } = req.body; 
  console.log(`📦 Attempting transfer for ID: ${req.params.id}`);

  try {
    const asset = await Asset.findOne({ customId: req.params.id });
    
    if (!asset) {
      return res.status(404).json({ message: "Asset not found" });
    }

    let updateData: any = {};
    if (destType === 'building') {
        updateData.location = destination;
        updateData.status = 'active'; 
        updateData.assignedUser = null; 
    } else if (destType === 'department') {
        updateData.department = destination;
    } else if (destType === 'user') {
        updateData.assignedUser = destination;
        updateData.status = 'assigned';
    }

    const moveQty = Number(quantityToMove) || asset.quantity;
    if (moveQty > asset.quantity) return res.status(400).json({ message: "Not enough quantity." });

    if (moveQty === asset.quantity) {
      Object.assign(asset, updateData); 
      asset.history.push({ 
        event: 'Transfer', 
        details: `Moved to ${destType}: ${destination}`, 
        date: new Date() 
      });
      await asset.save();
      return res.json(asset);
    }

    asset.quantity -= moveQty;

    const LOW_STOCK_THRESHOLD = 5;
    if (asset.quantity <= LOW_STOCK_THRESHOLD) {
        // Send notification to admin about low stock
        await notificationService.notifyLowStock(
            asset.customId,
            asset.name,
            asset.quantity,
            'admin1',  // or pass from request if you have admin info
            'admin@email.com'  // or fetch from config/env
        );

        await EventBus.publish(TOPICS.ASSET_LOW_STOCK, {
            event: 'Low_Stock_Warning',
            assetId: asset.customId,
            name: asset.name,
            currentQuantity: asset.quantity,
            location: asset.location,
            timestamp: new Date()
        });
    }

    asset.history.push({ 
      event: 'Distributed', 
      details: `Sent ${moveQty} units to ${destination}`, 
      date: new Date() 
    });
    await asset.save();

    const newSplitId = `${asset.customId}-SPLIT-${Math.floor(1000 + Math.random() * 9000)}`;
    const newBatch = await Asset.create({
      customId: newSplitId,
      name: asset.name,
      type: asset.type,
      value: asset.value,
      quantity: moveQty,
      ...updateData,
      specifications: asset.specifications, 
      history: [{ 
        event: 'Received_Distribution', 
        details: `Split from ${asset.customId}`, 
        date: new Date() 
      }]
    });

    res.json({ original: asset, newBatch });
  } catch (error: any) {
    console.error("❌ Transfer Route Error:", error.message);
    res.status(500).json({ message: "Transfer failed", error: error.message });
  }
});

// --- STATUS & DETAILS UPDATE ---
app.patch('/api/assets/:id/status', async (req: Request, res: Response) => {
    try {
        const { status } = req.body;
        const updated = await Asset.findOneAndUpdate(
            { customId: req.params.id }, 
            { $set: { status } },
            { new: true }
        );
        res.json(updated);
    } catch (err) {
        res.status(500).json({ message: "Status update failed" });
    }
});

app.patch('/api/assets/:id/details', async (req: Request, res: Response) => {
  try {
    const { name, type, department, quantity, specifications } = req.body;
    
    const updatedAsset = await Asset.findOneAndUpdate(
      { customId: req.params.id }, 
      { 
        $set: { name, type, department, quantity, specifications },
        $push: { 
          history: { 
            event: 'Details Updated', 
            details: 'Specs modified', 
            date: new Date() 
          } 
        }
      },
      { new: true }
    );

    if (!updatedAsset) return res.status(404).json({ message: "Asset not found" });
    res.json(updatedAsset);
  } catch (error: any) {
    console.error("❌ Details Update Error:", error.message);
    res.status(500).json({ message: "Update failed", error: error.message });
  }
});

// --- DELETE LOGIC ---
app.delete('/api/assets/:id', async (req: Request, res: Response) => {
  try {
    // Log delete request origin for tracing unexpected deletes
    console.log(`📤 DELETE /api/assets/${req.params.id} from ${req.ip} - headers: ${JSON.stringify(req.headers)}`);
    const id = req.params.id;
    let deletedAsset = await Asset.findOneAndDelete({ customId: id });
    if (!deletedAsset && mongoose.Types.ObjectId.isValid(id)) {
        deletedAsset = await Asset.findByIdAndDelete(id);
    }

    if (deletedAsset) {
        await EventBus.publish(TOPICS.ASSET_DELETED, { customId: deletedAsset.customId });
        return res.json({ success: true });
    }
    res.status(404).json({ message: 'Asset not found' });
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

const startServer = async () => {
  try {
    console.log("🔌 Connecting to RabbitMQ...");
    // Attempt real connection with credentials from ENV
    await EventBus.connect();
    console.log("✅ [EventBus] RabbitMQ Connected Successfully!");
  } catch (err: any) {
    console.error("❌ [EventBus] Connection FAILED.");
    console.error(`   Error: ${err.message}`);
    // We let the API start even if MQ fails, but for now we expect success!
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n---------------------------------------------------`);
    console.log(`🚀 API Service is RUNNING on port ${PORT}`);
    console.log(`---------------------------------------------------\n`);
  });
};

startServer();