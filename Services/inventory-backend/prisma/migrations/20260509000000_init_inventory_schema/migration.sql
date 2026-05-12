-- CreateEnum
CREATE TYPE "AssetType" AS ENUM (
    'laptop',
    'desktop',
    'tablet',
    'server',
    'monitor',
    'peripheral',
    'keyboard',
    'electronics',
    'projector',
    'smartboard',
    'camera',
    'speaker',
    'microphone',
    'router',
    'switch',
    'access_point',
    'firewall',
    'printer',
    'scanner',
    'desk',
    'chair',
    'whiteboard',
    'filing_cabinet',
    'furniture',
    'microscope',
    'centrifuge',
    'oscilloscope',
    '3d_printer',
    'lab_bench',
    'vehicle',
    'generator',
    'hvac',
    'maintenance_tool'
);

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM (
    'active',
    'repair',
    'retired',
    'assigned',
    'maintenance'
);

-- CreateEnum
CREATE TYPE "AssetLocation" AS ENUM (
    'Central Warehouse',
    'Main Building',
    'K Building',
    'N Building',
    'S Building',
    'R Building',
    'Pharmacy Building'
);

-- CreateEnum
CREATE TYPE "AssetDepartment" AS ENUM (
    'Computer Science',
    'Engineering',
    'Architecture',
    'Business',
    'Mass Comm',
    'Alsun',
    'Pharmacy',
    'Dentistry',
    'Unassigned',
    'General'
);

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM (
    'Open',
    'In Progress',
    'Resolved',
    'Closed'
);

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM (
    'Low',
    'Medium',
    'High',
    'Critical'
);

-- CreateEnum
CREATE TYPE "TicketType" AS ENUM (
    'Hardware',
    'Software',
    'Network',
    'Access',
    'Other'
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "customId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AssetType" NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'active',
    "value" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "assignedUser" TEXT,
    "location" "AssetLocation" NOT NULL,
    "department" "AssetDepartment" NOT NULL,
    "specifications" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_embedded_history" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_embedded_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'Open',
    "priority" "TicketPriority" NOT NULL DEFAULT 'Medium',
    "type" "TicketType" NOT NULL DEFAULT 'Other',
    "assignedTo" TEXT,
    "relatedAsset" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_tickets" (
    "assetId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,

    CONSTRAINT "asset_tickets_pkey" PRIMARY KEY ("assetId","ticketId")
);

-- CreateIndex
CREATE UNIQUE INDEX "assets_customId_key" ON "assets"("customId");

-- AddForeignKey
ALTER TABLE "asset_embedded_history" ADD CONSTRAINT "asset_embedded_history_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("customId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_relatedAsset_fkey" FOREIGN KEY ("relatedAsset") REFERENCES "assets"("customId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_tickets" ADD CONSTRAINT "asset_tickets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("customId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_tickets" ADD CONSTRAINT "asset_tickets_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
