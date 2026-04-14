// File: src/services/history-service/index.ts

// 1. Fix the Import Paths (Go up one level with "..")
import { EventBus } from '../EventBus'; 
import { TOPICS } from '../../events/assetEvents';

// 2. Fix the Model Import (Go up two levels with "../..")
// Ensure you actually created the file at src/models/History.ts
import History from '../../models/History'; 

const startHistoryService = async () => {
  console.log("👂 History Service Listening for events...");

  // 3. Fix 'implicitly has any type' by adding ': any'
  await EventBus.subscribe(TOPICS.ASSET_CREATED, async (data: any) => {
    console.log(`[EVENT RECEIVED] Asset Created: ${data.customId}`);
    
    await History.create({
      assetId: data.customId,
      action: 'CREATED',
      details: `Initial batch of ${data.quantity} created at ${data.location}`,
      timestamp: data.timestamp || new Date()
    });
  });

  await EventBus.subscribe(TOPICS.ASSET_DELETED, async (data: any) => {
    console.log(`[EVENT RECEIVED] Asset Deleted: ${data.customId}`);
    
    await History.create({
      assetId: data.customId,
      action: 'DELETED',
      details: `Permanently removed from database`,
      timestamp: data.timestamp || new Date()
    });
  });

  // Add listeners for TRANSFERRED and UPDATED here as needed...
};

export default startHistoryService;
