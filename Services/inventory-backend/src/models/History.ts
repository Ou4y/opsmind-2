import { prisma } from '../lib/prisma';
import { AssetHistory } from '@prisma/client';

export interface IHistory {
  id: string;
  assetId: string;
  action: string;
  details: string;
  timestamp: Date;
}

// History service functions
export class HistoryService {
  // Create a new history record
  static async createHistory(data: {
    assetId: string;
    action: string;
    details: string;
  }): Promise<AssetHistory> {
    return await prisma.assetHistory.create({
      data: {
        assetId: data.assetId,
        event: data.action, // Map action to event
        details: data.details,
      },
    });
  }

  // Get history records for an asset
  static async getHistoryForAsset(assetId: string): Promise<AssetHistory[]> {
    return await prisma.assetHistory.findMany({
      where: { assetId },
      orderBy: { date: 'desc' },
    });
  }

  // Get all history records with optional filters
  static async getAllHistory(filters?: {
    assetId?: string;
    event?: string;
  }): Promise<AssetHistory[]> {
    return await prisma.assetHistory.findMany({
      where: filters,
      orderBy: { date: 'desc' },
    });
  }

  // Delete history record
  static async deleteHistory(id: string): Promise<AssetHistory> {
    return await prisma.assetHistory.delete({
      where: { id },
    });
  }
}

// Export the service class as default
export default HistoryService;
