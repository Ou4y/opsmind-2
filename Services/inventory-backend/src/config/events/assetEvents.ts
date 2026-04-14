// File: opsmind-backend/src/events/assetEvents.ts

export const TOPICS = {
  ASSET_CREATED: 'asset.created',
  ASSET_UPDATED: 'asset.updated',
  ASSET_DELETED: 'asset.deleted',
  ASSET_TRANSFERRED: 'asset.transferred',
  ASSET_LOW_STOCK: 'asset.low_stock'
};

// Optional: You can export interfaces here if you want strict typing later
export interface AssetEvent {
  topic: string;
  data: any;
}
