-- CreateEnum
CREATE TYPE "ProcurementRequestType" AS ENUM ('replacement', 'spare_stock', 'consumable_restock', 'license_renewal', 'new_purchase', 'maintenance_related', 'audit_related', 'other');

-- CreateEnum
CREATE TYPE "ProcurementRequestPriority" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "ProcurementRequestStatus" AS ENUM ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'ordered', 'partially_received', 'received', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "ProcurementRequestSource" AS ENUM ('manual', 'ai_recommendation', 'low_stock', 'eol', 'audit', 'maintenance', 'import');

-- CreateEnum
CREATE TYPE "ProcurementApprovalDecision" AS ENUM ('submit', 'approve', 'reject', 'cancel', 'reopen', 'mark_ordered', 'mark_received', 'close', 'update');

-- CreateEnum
CREATE TYPE "VendorQuoteStatus" AS ENUM ('pending', 'selected', 'rejected');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('draft', 'issued', 'partially_received', 'received', 'cancelled');

-- CreateEnum
CREATE TYPE "ReceivingCondition" AS ENUM ('good', 'damaged', 'partial', 'needs_inspection');

-- CreateEnum
CREATE TYPE "ProcurementAssetRelationshipType" AS ENUM ('replaces', 'requested_for', 'related_to', 'caused_by_audit', 'caused_by_maintenance', 'eol_replacement', 'low_stock_restock', 'license_renewal');

-- CreateEnum
CREATE TYPE "ProcurementRecommendationReviewStatus" AS ENUM ('new', 'reviewed', 'converted', 'ignored');

-- CreateTable
CREATE TABLE "procurement_requests" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "requestType" "ProcurementRequestType" NOT NULL DEFAULT 'other',
    "priority" "ProcurementRequestPriority" NOT NULL DEFAULT 'medium',
    "status" "ProcurementRequestStatus" NOT NULL DEFAULT 'draft',
    "reason" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "department" TEXT,
    "building" TEXT,
    "room" TEXT,
    "neededByDate" TIMESTAMP(3),
    "estimatedBudget" DECIMAL(65,30),
    "actualCost" DECIMAL(65,30),
    "source" "ProcurementRequestSource" NOT NULL DEFAULT 'manual',
    "aiRecommendationId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_request_items" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "category" TEXT,
    "assetType" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "specifications" JSONB,
    "quantityRequested" INTEGER NOT NULL,
    "quantityApproved" INTEGER,
    "quantityOrdered" INTEGER,
    "quantityReceived" INTEGER NOT NULL DEFAULT 0,
    "unitEstimatedCost" DECIMAL(65,30),
    "unitActualCost" DECIMAL(65,30),
    "linkedAssetTag" TEXT,
    "linkedSpareStockId" TEXT,
    "linkedConsumableId" TEXT,
    "linkedLicenseId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_approvals" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fromStatus" "ProcurementRequestStatus",
    "toStatus" "ProcurementRequestStatus" NOT NULL,
    "decision" "ProcurementApprovalDecision" NOT NULL,
    "decidedBy" TEXT NOT NULL,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procurement_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_vendors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "reliabilityScore" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_vendor_quotes" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "vendorId" TEXT,
    "vendorName" TEXT NOT NULL,
    "quotedItem" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(65,30),
    "totalPrice" DECIMAL(65,30),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "warrantyMonths" INTEGER,
    "deliveryDays" INTEGER,
    "validUntil" TIMESTAMP(3),
    "status" "VendorQuoteStatus" NOT NULL DEFAULT 'pending',
    "rejectionReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_vendor_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_purchase_orders" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "vendorId" TEXT,
    "vendorName" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'draft',
    "expectedDeliveryDate" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_purchase_order_items" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "requestItemId" TEXT,
    "itemName" TEXT NOT NULL,
    "quantityOrdered" INTEGER NOT NULL,
    "quantityReceived" INTEGER NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(65,30),
    "totalPrice" DECIMAL(65,30),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_receiving_records" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "receivedBy" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "condition" "ReceivingCondition" NOT NULL DEFAULT 'good',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procurement_receiving_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_receiving_record_items" (
    "id" TEXT NOT NULL,
    "receivingRecordId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT,
    "requestItemId" TEXT,
    "itemName" TEXT NOT NULL,
    "quantityReceived" INTEGER NOT NULL,
    "createdAssetIds" JSONB,
    "spareStockUpdated" BOOLEAN NOT NULL DEFAULT false,
    "spareStockId" TEXT,
    "consumableUpdated" BOOLEAN NOT NULL DEFAULT false,
    "consumableId" TEXT,
    "licenseCreatedOrUpdated" BOOLEAN NOT NULL DEFAULT false,
    "licenseId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procurement_receiving_record_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_asset_links" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "assetId" TEXT,
    "assetTag" TEXT,
    "relationshipType" "ProcurementAssetRelationshipType" NOT NULL DEFAULT 'related_to',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procurement_asset_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_recommendation_reviews" (
    "id" TEXT NOT NULL,
    "recommendationKey" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "evidence" JSONB,
    "status" "ProcurementRecommendationReviewStatus" NOT NULL DEFAULT 'new',
    "convertedRequestId" TEXT,
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_recommendation_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "procurement_requests_requestNumber_key" ON "procurement_requests"("requestNumber");

-- CreateIndex
CREATE INDEX "procurement_requests_status_createdAt_idx" ON "procurement_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "procurement_requests_priority_createdAt_idx" ON "procurement_requests"("priority", "createdAt");

-- CreateIndex
CREATE INDEX "procurement_requests_source_createdAt_idx" ON "procurement_requests"("source", "createdAt");

-- CreateIndex
CREATE INDEX "procurement_requests_department_idx" ON "procurement_requests"("department");

-- CreateIndex
CREATE INDEX "procurement_requests_building_idx" ON "procurement_requests"("building");

-- CreateIndex
CREATE INDEX "procurement_request_items_requestId_createdAt_idx" ON "procurement_request_items"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "procurement_request_items_linkedAssetTag_idx" ON "procurement_request_items"("linkedAssetTag");

-- CreateIndex
CREATE INDEX "procurement_request_items_linkedSpareStockId_idx" ON "procurement_request_items"("linkedSpareStockId");

-- CreateIndex
CREATE INDEX "procurement_request_items_category_idx" ON "procurement_request_items"("category");

-- CreateIndex
CREATE INDEX "procurement_approvals_requestId_createdAt_idx" ON "procurement_approvals"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "procurement_approvals_toStatus_createdAt_idx" ON "procurement_approvals"("toStatus", "createdAt");

-- CreateIndex
CREATE INDEX "procurement_vendors_name_idx" ON "procurement_vendors"("name");

-- CreateIndex
CREATE INDEX "procurement_vendor_quotes_requestId_status_idx" ON "procurement_vendor_quotes"("requestId", "status");

-- CreateIndex
CREATE INDEX "procurement_vendor_quotes_vendorId_idx" ON "procurement_vendor_quotes"("vendorId");

-- CreateIndex
CREATE INDEX "procurement_vendor_quotes_createdAt_idx" ON "procurement_vendor_quotes"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_purchase_orders_poNumber_key" ON "procurement_purchase_orders"("poNumber");

-- CreateIndex
CREATE INDEX "procurement_purchase_orders_requestId_status_idx" ON "procurement_purchase_orders"("requestId", "status");

-- CreateIndex
CREATE INDEX "procurement_purchase_orders_vendorId_idx" ON "procurement_purchase_orders"("vendorId");

-- CreateIndex
CREATE INDEX "procurement_purchase_orders_createdAt_idx" ON "procurement_purchase_orders"("createdAt");

-- CreateIndex
CREATE INDEX "procurement_purchase_order_items_purchaseOrderId_idx" ON "procurement_purchase_order_items"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "procurement_purchase_order_items_requestItemId_idx" ON "procurement_purchase_order_items"("requestItemId");

-- CreateIndex
CREATE INDEX "procurement_receiving_records_requestId_receivedAt_idx" ON "procurement_receiving_records"("requestId", "receivedAt");

-- CreateIndex
CREATE INDEX "procurement_receiving_records_purchaseOrderId_receivedAt_idx" ON "procurement_receiving_records"("purchaseOrderId", "receivedAt");

-- CreateIndex
CREATE INDEX "procurement_receiving_record_items_receivingRecordId_idx" ON "procurement_receiving_record_items"("receivingRecordId");

-- CreateIndex
CREATE INDEX "procurement_receiving_record_items_purchaseOrderItemId_idx" ON "procurement_receiving_record_items"("purchaseOrderItemId");

-- CreateIndex
CREATE INDEX "procurement_receiving_record_items_requestItemId_idx" ON "procurement_receiving_record_items"("requestItemId");

-- CreateIndex
CREATE INDEX "procurement_asset_links_requestId_idx" ON "procurement_asset_links"("requestId");

-- CreateIndex
CREATE INDEX "procurement_asset_links_assetId_idx" ON "procurement_asset_links"("assetId");

-- CreateIndex
CREATE INDEX "procurement_asset_links_assetTag_idx" ON "procurement_asset_links"("assetTag");

-- CreateIndex
CREATE INDEX "procurement_asset_links_relationshipType_idx" ON "procurement_asset_links"("relationshipType");

-- CreateIndex
CREATE INDEX "procurement_recommendation_reviews_status_createdAt_idx" ON "procurement_recommendation_reviews"("status", "createdAt");

-- CreateIndex
CREATE INDEX "procurement_recommendation_reviews_source_idx" ON "procurement_recommendation_reviews"("source");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_recommendation_reviews_recommendationKey_key" ON "procurement_recommendation_reviews"("recommendationKey");

-- AddForeignKey
ALTER TABLE "procurement_request_items" ADD CONSTRAINT "procurement_request_items_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "procurement_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_approvals" ADD CONSTRAINT "procurement_approvals_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "procurement_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_vendor_quotes" ADD CONSTRAINT "procurement_vendor_quotes_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "procurement_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_vendor_quotes" ADD CONSTRAINT "procurement_vendor_quotes_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "procurement_vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_purchase_orders" ADD CONSTRAINT "procurement_purchase_orders_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "procurement_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_purchase_orders" ADD CONSTRAINT "procurement_purchase_orders_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "procurement_vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_purchase_order_items" ADD CONSTRAINT "procurement_purchase_order_items_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "procurement_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_purchase_order_items" ADD CONSTRAINT "procurement_purchase_order_items_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "procurement_request_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_receiving_records" ADD CONSTRAINT "procurement_receiving_records_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "procurement_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_receiving_records" ADD CONSTRAINT "procurement_receiving_records_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "procurement_purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_receiving_record_items" ADD CONSTRAINT "procurement_receiving_record_items_receivingRecordId_fkey" FOREIGN KEY ("receivingRecordId") REFERENCES "procurement_receiving_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_receiving_record_items" ADD CONSTRAINT "procurement_receiving_record_items_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "procurement_purchase_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_receiving_record_items" ADD CONSTRAINT "procurement_receiving_record_items_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "procurement_request_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_asset_links" ADD CONSTRAINT "procurement_asset_links_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "procurement_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_recommendation_reviews" ADD CONSTRAINT "procurement_recommendation_reviews_convertedRequestId_fkey" FOREIGN KEY ("convertedRequestId") REFERENCES "procurement_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
