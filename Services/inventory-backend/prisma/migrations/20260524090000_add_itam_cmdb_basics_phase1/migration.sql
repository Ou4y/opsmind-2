-- ITAM/CMDB additive foundations (safe, backward-compatible)

-- CreateEnum
CREATE TYPE "AssetCategory" AS ENUM (
    'asset',
    'component',
    'accessory',
    'consumable',
    'license',
    'spare_part'
);

-- CreateEnum
CREATE TYPE "AssetLifecycleStatus" AS ENUM (
    'in_stock',
    'assigned',
    'in_use',
    'under_maintenance',
    'pending_repair',
    'in_transit',
    'reserved',
    'retired',
    'disposed',
    'lost_stolen',
    'eol_expired'
);

-- CreateEnum
CREATE TYPE "AssetCustodyStatus" AS ENUM (
    'unassigned',
    'checked_out',
    'returned'
);

-- AlterTable
ALTER TABLE "assets"
ADD COLUMN "lifecycleStatus" "AssetLifecycleStatus" NOT NULL DEFAULT 'in_stock',
ADD COLUMN "category" "AssetCategory" NOT NULL DEFAULT 'asset',
ADD COLUMN "serialNumber" TEXT,
ADD COLUMN "assetTag" TEXT,
ADD COLUMN "manufacturerPartNumber" TEXT,
ADD COLUMN "assignedToName" TEXT,
ADD COLUMN "assignedToUserId" TEXT,
ADD COLUMN "assignedDepartment" TEXT,
ADD COLUMN "checkoutDate" TIMESTAMP(3),
ADD COLUMN "expectedReturnDate" TIMESTAMP(3),
ADD COLUMN "returnedDate" TIMESTAMP(3),
ADD COLUMN "custodyStatus" "AssetCustodyStatus" NOT NULL DEFAULT 'unassigned',
ADD COLUMN "purchaseDate" TIMESTAMP(3),
ADD COLUMN "vendor" TEXT,
ADD COLUMN "purchaseCost" DECIMAL(65,30),
ADD COLUMN "invoiceNumber" TEXT,
ADD COLUMN "purchaseOrderNumber" TEXT,
ADD COLUMN "warrantyStartDate" TIMESTAMP(3),
ADD COLUMN "warrantyEndDate" TIMESTAMP(3),
ADD COLUMN "replacementCost" DECIMAL(65,30);

-- CreateIndex
CREATE INDEX "assets_serialNumber_idx" ON "assets"("serialNumber");

-- CreateIndex
CREATE INDEX "assets_assetTag_idx" ON "assets"("assetTag");

-- CreateIndex
CREATE INDEX "assets_lifecycleStatus_idx" ON "assets"("lifecycleStatus");

-- CreateIndex
CREATE INDEX "assets_category_idx" ON "assets"("category");

-- CreateIndex
CREATE INDEX "assets_custodyStatus_idx" ON "assets"("custodyStatus");

-- CreateIndex
CREATE INDEX "assets_warrantyEndDate_idx" ON "assets"("warrantyEndDate");

-- CreateTable
CREATE TABLE "asset_components" (
    "id" TEXT NOT NULL,
    "parentAssetId" TEXT NOT NULL,
    "childAssetId" TEXT,
    "componentName" TEXT NOT NULL,
    "componentType" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "partNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'installed',
    "condition" TEXT,
    "installedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "reason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_lifecycle_events" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "componentId" TEXT,
    "eventType" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,
    "notes" TEXT,
    "actor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_lifecycle_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_maintenance_records" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "componentId" TEXT,
    "maintenanceType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "performedBy" TEXT,
    "performedAt" TIMESTAMP(3),
    "nextMaintenanceDate" TIMESTAMP(3),
    "cost" DECIMAL(65,30),
    "reason" TEXT,
    "notes" TEXT,
    "linkedTicketId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_maintenance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_custody_events" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "assignedToName" TEXT,
    "assignedToUserId" TEXT,
    "assignedDepartment" TEXT,
    "checkoutDate" TIMESTAMP(3),
    "expectedReturnDate" TIMESTAMP(3),
    "returnedDate" TIMESTAMP(3),
    "conditionOut" TEXT,
    "conditionIn" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "actor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_custody_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_relationships" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "relatedAssetId" TEXT NOT NULL,
    "relationshipType" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_components_parentAssetId_status_idx" ON "asset_components"("parentAssetId", "status");
CREATE INDEX "asset_components_childAssetId_idx" ON "asset_components"("childAssetId");
CREATE INDEX "asset_components_serialNumber_idx" ON "asset_components"("serialNumber");

-- CreateIndex
CREATE INDEX "asset_lifecycle_events_assetId_createdAt_idx" ON "asset_lifecycle_events"("assetId", "createdAt");
CREATE INDEX "asset_lifecycle_events_componentId_createdAt_idx" ON "asset_lifecycle_events"("componentId", "createdAt");
CREATE INDEX "asset_lifecycle_events_eventType_createdAt_idx" ON "asset_lifecycle_events"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "asset_maintenance_records_assetId_createdAt_idx" ON "asset_maintenance_records"("assetId", "createdAt");
CREATE INDEX "asset_maintenance_records_componentId_createdAt_idx" ON "asset_maintenance_records"("componentId", "createdAt");
CREATE INDEX "asset_maintenance_records_status_nextMaintenanceDate_idx" ON "asset_maintenance_records"("status", "nextMaintenanceDate");

-- CreateIndex
CREATE INDEX "asset_custody_events_assetId_createdAt_idx" ON "asset_custody_events"("assetId", "createdAt");
CREATE INDEX "asset_custody_events_action_createdAt_idx" ON "asset_custody_events"("action", "createdAt");

-- CreateIndex
CREATE INDEX "asset_relationships_assetId_relationshipType_idx" ON "asset_relationships"("assetId", "relationshipType");
CREATE INDEX "asset_relationships_relatedAssetId_relationshipType_idx" ON "asset_relationships"("relatedAssetId", "relationshipType");
CREATE UNIQUE INDEX "asset_relationships_assetId_relatedAssetId_relationshipType_key" ON "asset_relationships"("assetId", "relatedAssetId", "relationshipType");

-- AddForeignKey
ALTER TABLE "asset_components" ADD CONSTRAINT "asset_components_parentAssetId_fkey" FOREIGN KEY ("parentAssetId") REFERENCES "assets"("customId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asset_components" ADD CONSTRAINT "asset_components_childAssetId_fkey" FOREIGN KEY ("childAssetId") REFERENCES "assets"("customId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_lifecycle_events" ADD CONSTRAINT "asset_lifecycle_events_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("customId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asset_lifecycle_events" ADD CONSTRAINT "asset_lifecycle_events_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "asset_components"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_maintenance_records" ADD CONSTRAINT "asset_maintenance_records_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("customId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asset_maintenance_records" ADD CONSTRAINT "asset_maintenance_records_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "asset_components"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_custody_events" ADD CONSTRAINT "asset_custody_events_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("customId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_relationships" ADD CONSTRAINT "asset_relationships_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("customId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asset_relationships" ADD CONSTRAINT "asset_relationships_relatedAssetId_fkey" FOREIGN KEY ("relatedAssetId") REFERENCES "assets"("customId") ON DELETE CASCADE ON UPDATE CASCADE;
