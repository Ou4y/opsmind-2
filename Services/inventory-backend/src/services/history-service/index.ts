// File: src/services/history-service/index.ts

import { EventBus } from '../EventBus'; 
import { TOPICS } from '../../events/assetEvents';
import HistoryService from '../../models/History'; 

const startHistoryService = async () => {
  console.log("👂 History Service Listening for events...");

  await EventBus.subscribe(TOPICS.ASSET_CREATED, async (data: any) => {
    console.log(`[EVENT RECEIVED] Asset Created: ${data.customId}`);
    
    await HistoryService.createHistory({
      assetId: data.customId,
      action: 'CREATED',
      details: `Initial batch of ${data.quantity} created at ${data.location}`
    });
  });

  await EventBus.subscribe(TOPICS.ASSET_DELETED, async (data: any) => {
    console.log(`[EVENT RECEIVED] Asset Deleted: ${data.customId}`);
    
    await HistoryService.createHistory({
      assetId: data.customId,
      action: 'DELETED',
      details: `Permanently removed from database`
    });
  });

  // Add listeners for TRANSFERRED and UPDATED here as needed...
};

export default startHistoryService;
