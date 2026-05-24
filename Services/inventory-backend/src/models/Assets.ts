import { prisma } from '../lib/prisma';
import {
  Asset,
  AssetType,
  AssetStatus,
  AssetLocation,
  AssetDepartment,
  AssetCategory,
  AssetLifecycleStatus,
  AssetCustodyStatus,
} from '@prisma/client';

// TypeScript interfaces for API compatibility
export type Location = 'Central Warehouse' | 'Main Building' | 'K Building' | 'N Building' | 'S Building' | 'R Building' | 'Pharmacy Building';
export type Department = 'Computer Science' | 'Engineering' | 'Architecture' | 'Business' | 'Mass Comm' | 'Alsun' | 'Pharmacy' | 'Dentistry' | 'Unassigned' | 'General';

export interface IAsset {
  id: string;
  customId: string;
  name: string;
  type: AssetType;
  status: AssetStatus;
  lifecycleStatus: AssetLifecycleStatus;
  category: AssetCategory;
  value: number;
  quantity: number;
  assignedUser?: string | null;
  serialNumber?: string | null;
  assetTag?: string | null;
  manufacturerPartNumber?: string | null;
  location: AssetLocation;
  department: AssetDepartment;
  assignedToName?: string | null;
  assignedToUserId?: string | null;
  assignedDepartment?: string | null;
  checkoutDate?: Date | null;
  expectedReturnDate?: Date | null;
  returnedDate?: Date | null;
  custodyStatus: AssetCustodyStatus;
  purchaseDate?: Date | null;
  vendor?: string | null;
  purchaseCost?: number | null;
  invoiceNumber?: string | null;
  purchaseOrderNumber?: string | null;
  warrantyStartDate?: Date | null;
  warrantyEndDate?: Date | null;
  replacementCost?: number | null;
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
    lifecycleStatus?: AssetLifecycleStatus;
    category?: AssetCategory;
    value?: number;
    quantity?: number;
    assignedUser?: string;
    serialNumber?: string | null;
    assetTag?: string | null;
    manufacturerPartNumber?: string | null;
    location: AssetLocation;
    department: AssetDepartment;
    assignedToName?: string | null;
    assignedToUserId?: string | null;
    assignedDepartment?: string | null;
    checkoutDate?: Date | null;
    expectedReturnDate?: Date | null;
    returnedDate?: Date | null;
    custodyStatus?: AssetCustodyStatus;
    purchaseDate?: Date | null;
    vendor?: string | null;
    purchaseCost?: number | null;
    invoiceNumber?: string | null;
    purchaseOrderNumber?: string | null;
    warrantyStartDate?: Date | null;
    warrantyEndDate?: Date | null;
    replacementCost?: number | null;
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
          lifecycleStatus: assetData.lifecycleStatus || 'IN_STOCK',
          category: assetData.category || 'ASSET',
          value: assetData.value || 0,
          quantity: assetData.quantity || 1,
          assignedUser: assetData.assignedUser,
          serialNumber: assetData.serialNumber ?? null,
          assetTag: assetData.assetTag ?? null,
          manufacturerPartNumber: assetData.manufacturerPartNumber ?? null,
          location: assetData.location,
          department: assetData.department,
          assignedToName: assetData.assignedToName ?? null,
          assignedToUserId: assetData.assignedToUserId ?? null,
          assignedDepartment: assetData.assignedDepartment ?? null,
          checkoutDate: assetData.checkoutDate ?? null,
          expectedReturnDate: assetData.expectedReturnDate ?? null,
          returnedDate: assetData.returnedDate ?? null,
          custodyStatus: assetData.custodyStatus || 'UNASSIGNED',
          purchaseDate: assetData.purchaseDate ?? null,
          vendor: assetData.vendor ?? null,
          purchaseCost: assetData.purchaseCost ?? null,
          invoiceNumber: assetData.invoiceNumber ?? null,
          purchaseOrderNumber: assetData.purchaseOrderNumber ?? null,
          warrantyStartDate: assetData.warrantyStartDate ?? null,
          warrantyEndDate: assetData.warrantyEndDate ?? null,
          replacementCost: assetData.replacementCost ?? null,
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
    lifecycleStatus?: AssetLifecycleStatus;
    category?: AssetCategory;
    value?: number;
    quantity?: number;
    assignedUser?: string;
    serialNumber?: string | null;
    assetTag?: string | null;
    manufacturerPartNumber?: string | null;
    location: AssetLocation;
    department: AssetDepartment;
    assignedToName?: string | null;
    assignedToUserId?: string | null;
    assignedDepartment?: string | null;
    checkoutDate?: Date | null;
    expectedReturnDate?: Date | null;
    returnedDate?: Date | null;
    custodyStatus?: AssetCustodyStatus;
    purchaseDate?: Date | null;
    vendor?: string | null;
    purchaseCost?: number | null;
    invoiceNumber?: string | null;
    purchaseOrderNumber?: string | null;
    warrantyStartDate?: Date | null;
    warrantyEndDate?: Date | null;
    replacementCost?: number | null;
    specifications?: Record<string, any>;
  }): Promise<Asset> {
    return await prisma.asset.create({
      data: {
        customId: data.customId,
        name: data.name,
        type: data.type,
        status: data.status || 'ACTIVE',
        lifecycleStatus: data.lifecycleStatus || 'IN_STOCK',
        category: data.category || 'ASSET',
        value: data.value || 0,
        quantity: data.quantity || 1,
        assignedUser: data.assignedUser,
        serialNumber: data.serialNumber ?? null,
        assetTag: data.assetTag ?? null,
        manufacturerPartNumber: data.manufacturerPartNumber ?? null,
        location: data.location,
        department: data.department,
        assignedToName: data.assignedToName ?? null,
        assignedToUserId: data.assignedToUserId ?? null,
        assignedDepartment: data.assignedDepartment ?? null,
        checkoutDate: data.checkoutDate ?? null,
        expectedReturnDate: data.expectedReturnDate ?? null,
        returnedDate: data.returnedDate ?? null,
        custodyStatus: data.custodyStatus || 'UNASSIGNED',
        purchaseDate: data.purchaseDate ?? null,
        vendor: data.vendor ?? null,
        purchaseCost: data.purchaseCost ?? null,
        invoiceNumber: data.invoiceNumber ?? null,
        purchaseOrderNumber: data.purchaseOrderNumber ?? null,
        warrantyStartDate: data.warrantyStartDate ?? null,
        warrantyEndDate: data.warrantyEndDate ?? null,
        replacementCost: data.replacementCost ?? null,
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
      purchaseCost: asset.purchaseCost === null ? null : Number(asset.purchaseCost),
      replacementCost: asset.replacementCost === null ? null : Number(asset.replacementCost),
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
    lifecycleStatus?: AssetLifecycleStatus;
    category?: AssetCategory;
    custodyStatus?: AssetCustodyStatus;
    location?: AssetLocation;
    assignedUser?: string;
    assignedToName?: string;
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
    lifecycleStatus: AssetLifecycleStatus;
    category: AssetCategory;
    value: number;
    quantity: number;
    assignedUser: string | null;
    serialNumber: string | null;
    assetTag: string | null;
    manufacturerPartNumber: string | null;
    location: AssetLocation;
    department: AssetDepartment;
    assignedToName: string | null;
    assignedToUserId: string | null;
    assignedDepartment: string | null;
    checkoutDate: Date | null;
    expectedReturnDate: Date | null;
    returnedDate: Date | null;
    custodyStatus: AssetCustodyStatus;
    purchaseDate: Date | null;
    vendor: string | null;
    purchaseCost: number | null;
    invoiceNumber: string | null;
    purchaseOrderNumber: string | null;
    warrantyStartDate: Date | null;
    warrantyEndDate: Date | null;
    replacementCost: number | null;
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
