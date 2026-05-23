import { prisma } from '../lib/prisma';
import { Asset, AssetType, AssetStatus, AssetLocation, AssetDepartment } from '@prisma/client';

// TypeScript interfaces for API compatibility
export type Location = 'Central Warehouse' | 'Main Building' | 'K Building' | 'N Building' | 'S Building' | 'R Building' | 'Pharmacy Building';
export type Department = 'Computer Science' | 'Engineering' | 'Architecture' | 'Business' | 'Mass Comm' | 'Alsun' | 'Pharmacy' | 'Dentistry' | 'Unassigned' | 'General';

export interface IAsset {
  id: string;
  customId: string;
  name: string;
  type: AssetType;
  status: AssetStatus;
  value: number;
  quantity: number;
  assignedUser?: string | null;
  location: AssetLocation;
  department: AssetDepartment;
  specifications: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  histories?: Array<{
    id: string;
    event: string;
    details: string;
    date: Date;
  }>;
  tickets?: Array<{
    id: string;
    title: string;
    status: string;
  }>;
}

// Asset service functions
export class AssetService {
  static async createAssets(data: Array<{
    customId: string;
    name: string;
    type: AssetType;
    status?: AssetStatus;
    value?: number;
    quantity?: number;
    assignedUser?: string;
    location: AssetLocation;
    department: AssetDepartment;
    specifications?: Record<string, any>;
  }>): Promise<Asset[]> {
    if (!Array.isArray(data) || data.length === 0) return [];
    return await prisma.$transaction(
      data.map((assetData) => prisma.asset.create({
        data: {
          customId: assetData.customId,
          name: assetData.name,
          type: assetData.type,
          status: assetData.status || 'ACTIVE',
          value: assetData.value || 0,
          quantity: assetData.quantity || 1,
          assignedUser: assetData.assignedUser,
          location: assetData.location,
          department: assetData.department,
          specifications: assetData.specifications || {},
        },
      }))
    );
  }

  // Create a new asset
  static async createAsset(data: {
    customId: string;
    name: string;
    type: AssetType;
    status?: AssetStatus;
    value?: number;
    quantity?: number;
    assignedUser?: string;
    location: AssetLocation;
    department: AssetDepartment;
    specifications?: Record<string, any>;
  }): Promise<Asset> {
    return await prisma.asset.create({
      data: {
        customId: data.customId,
        name: data.name,
        type: data.type,
        status: data.status || 'ACTIVE',
        value: data.value || 0,
        quantity: data.quantity || 1,
        assignedUser: data.assignedUser,
        location: data.location,
        department: data.department,
        specifications: data.specifications || {},
      },
    });
  }

  // Get asset by customId
  static async getAssetByCustomId(customId: string): Promise<Asset | null> {
    return await prisma.asset.findUnique({
      where: { customId },
    });
  }

  // Get asset with full details (histories and tickets)
  static async getAssetWithDetails(customId: string): Promise<IAsset | null> {
    const asset = await prisma.asset.findUnique({
      where: { customId },
      include: {
        histories: {
          orderBy: { date: 'desc' },
        },
        assetTickets: {
          include: {
            ticket: true,
          },
        },
      },
    });

    if (!asset) return null;

    return {
      ...asset,
      value: Number(asset.value),
      specifications: (asset.specifications as Record<string, any>) || {},
      tickets: asset.assetTickets.map(at => ({
        id: at.ticket.id,
        title: at.ticket.title,
        status: at.ticket.status,
      })),
    };
  }

  // Get all assets with optional filters
  static async getAssets(filters?: {
    department?: AssetDepartment;
    status?: AssetStatus;
    location?: AssetLocation;
    assignedUser?: string;
  }): Promise<Asset[]> {
    return await prisma.asset.findMany({
      where: filters,
      orderBy: { createdAt: 'desc' },
    });
  }

  // Update asset
  static async updateAsset(customId: string, data: Partial<{
    name: string;
    type: AssetType;
    status: AssetStatus;
    value: number;
    quantity: number;
    assignedUser: string | null;
    location: AssetLocation;
    department: AssetDepartment;
    specifications: Record<string, any>;
  }>): Promise<Asset> {
    return await prisma.asset.update({
      where: { customId },
      data,
    });
  }

  // Delete asset
  static async deleteAsset(customId: string): Promise<Asset> {
    return await prisma.asset.delete({
      where: { customId },
    });
  }

  // Add history record to asset
  static async addHistoryToAsset(customId: string, event: string, details: string): Promise<void> {
    await prisma.assetHistory.create({
      data: {
        assetId: customId,
        event,
        details,
      },
    });
  }

  // Assign ticket to asset
  static async assignTicketToAsset(assetCustomId: string, ticketId: string): Promise<void> {
    await prisma.assetTicket.create({
      data: {
        assetId: assetCustomId,
        ticketId,
      },
    });
  }

  // Remove ticket from asset
  static async removeTicketFromAsset(assetCustomId: string, ticketId: string): Promise<void> {
    await prisma.assetTicket.delete({
      where: {
        assetId_ticketId: {
          assetId: assetCustomId,
          ticketId,
        },
      },
    });
  }
}

// Export the service class as default
export default AssetService;
