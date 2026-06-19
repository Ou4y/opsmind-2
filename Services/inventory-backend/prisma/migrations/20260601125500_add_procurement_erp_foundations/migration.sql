-- CreateEnum
CREATE TYPE "InventoryAbcClass" AS ENUM ('a', 'b', 'c', 'unclassified');

-- CreateEnum
CREATE TYPE "ProcurementFinanceStatus" AS ENUM ('not_submitted', 'pending_budget_review', 'budget_approved', 'budget_rejected', 'invoiced', 'payment_pending', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "ProcurementRfqStatus" AS ENUM ('draft', 'sent', 'closed', 'cancelled');

-- AlterTable
ALTER TABLE "procurement_request_items" ADD COLUMN     "abcClass" "InventoryAbcClass" NOT NULL DEFAULT 'unclassified',
ADD COLUMN     "abcReason" TEXT,
ADD COLUMN     "annualDemand" INTEGER,
ADD COLUMN     "calculatedEoq" DECIMAL(65,30),
ADD COLUMN     "dataQuality" TEXT,
ADD COLUMN     "demandSource" TEXT,
ADD COLUMN     "holdingCost" DECIMAL(65,30),
ADD COLUMN     "leadTimeDays" INTEGER,
ADD COLUMN     "minimumOrderQuantity" INTEGER,
ADD COLUMN     "minimumOrderValue" DECIMAL(65,30),
ADD COLUMN     "orderingCost" DECIMAL(65,30),
ADD COLUMN     "packSize" INTEGER,
ADD COLUMN     "recommendedOrderQuantity" INTEGER,
ADD COLUMN     "reorderPointValue" INTEGER,
ADD COLUMN     "safetyStock" INTEGER;

-- AlterTable
ALTER TABLE "procurement_requests" ADD COLUMN     "abcClass" "InventoryAbcClass" NOT NULL DEFAULT 'unclassified',
ADD COLUMN     "abcReason" TEXT,
ADD COLUMN     "budgetAllocationId" TEXT,
ADD COLUMN     "budgetAmountReserved" DECIMAL(65,30),
ADD COLUMN     "controlLevel" TEXT,
ADD COLUMN     "costCenterId" TEXT,
ADD COLUMN     "financeMetadata" JSONB,
ADD COLUMN     "financeNotes" TEXT,
ADD COLUMN     "financeStatus" "ProcurementFinanceStatus" NOT NULL DEFAULT 'not_submitted';

-- AlterTable
ALTER TABLE "procurement_vendor_quotes" ADD COLUMN     "bulkDiscountAvailable" BOOLEAN,
ADD COLUMN     "leadTimeDays" INTEGER,
ADD COLUMN     "minimumOrderQuantity" INTEGER,
ADD COLUMN     "minimumOrderValue" DECIMAL(65,30),
ADD COLUMN     "packSize" INTEGER;

-- AlterTable
ALTER TABLE "procurement_vendors" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "categoriesSupplied" JSONB,
ADD COLUMN     "leadTimeAverageDays" INTEGER,
ADD COLUMN     "warrantyQualityScore" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "spare_stock_items" ADD COLUMN     "abcClass" "InventoryAbcClass" NOT NULL DEFAULT 'unclassified',
ADD COLUMN     "abcReason" TEXT,
ADD COLUMN     "annualDemand" INTEGER,
ADD COLUMN     "holdingCost" DECIMAL(65,30),
ADD COLUMN     "leadTimeDays" INTEGER,
ADD COLUMN     "minimumOrderQuantity" INTEGER,
ADD COLUMN     "minimumOrderValue" DECIMAL(65,30),
ADD COLUMN     "orderingCost" DECIMAL(65,30),
ADD COLUMN     "packSize" INTEGER,
ADD COLUMN     "safetyStock" INTEGER;

-- CreateTable
CREATE TABLE "inventory_stock_batches" (
    "id" TEXT NOT NULL,
    "itemKind" TEXT NOT NULL,
    "spareStockItemId" TEXT,
    "consumableAssetId" TEXT,
    "itemName" TEXT NOT NULL,
    "batchCode" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quantityReceived" INTEGER NOT NULL,
    "quantityAvailable" INTEGER NOT NULL,
    "unitCost" DECIMAL(65,30),
    "vendor" TEXT,
    "location" TEXT,
    "warrantyEndDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "sourceRequestId" TEXT,
    "sourcePurchaseOrderId" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_stock_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_stock_movements" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "movementType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "actor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_cost_centers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT,
    "owner" TEXT,
    "annualBudget" DECIMAL(65,30),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_budget_periods" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_budget_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_budget_allocations" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "department" TEXT,
    "building" TEXT,
    "allocatedAmount" DECIMAL(65,30) NOT NULL,
    "reservedAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "committedAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "spentAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_budget_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_budget_usages" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "requestId" TEXT,
    "usageType" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "note" TEXT,
    "actor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_budget_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_invoices" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "vendorId" TEXT,
    "vendorName" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "totalAmount" DECIMAL(65,30),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paymentStatus" TEXT NOT NULL DEFAULT 'not_submitted',
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_invoice_lines" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "requestItemId" TEXT,
    "purchaseOrderItemId" TEXT,
    "itemName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(65,30),
    "totalPrice" DECIMAL(65,30),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_supplier_catalog_items" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "category" TEXT,
    "assetType" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "specifications" JSONB,
    "unitPrice" DECIMAL(65,30),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "minimumOrderQuantity" INTEGER,
    "minimumOrderValue" DECIMAL(65,30),
    "packSize" INTEGER,
    "leadTimeDays" INTEGER,
    "warrantyMonths" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_supplier_catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_rfqs" (
    "id" TEXT NOT NULL,
    "rfqNumber" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "quoteDueDate" TIMESTAMP(3),
    "status" "ProcurementRfqStatus" NOT NULL DEFAULT 'draft',
    "createdBy" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_rfqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_rfq_invitations" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "vendorId" TEXT,
    "vendorName" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseStatus" TEXT NOT NULL DEFAULT 'pending',
    "submittedQuoteId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_rfq_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_stock_batches_itemKind_receivedAt_idx" ON "inventory_stock_batches"("itemKind", "receivedAt");

-- CreateIndex
CREATE INDEX "inventory_stock_batches_spareStockItemId_receivedAt_idx" ON "inventory_stock_batches"("spareStockItemId", "receivedAt");

-- CreateIndex
CREATE INDEX "inventory_stock_batches_consumableAssetId_receivedAt_idx" ON "inventory_stock_batches"("consumableAssetId", "receivedAt");

-- CreateIndex
CREATE INDEX "inventory_stock_batches_quantityAvailable_idx" ON "inventory_stock_batches"("quantityAvailable");

-- CreateIndex
CREATE INDEX "inventory_stock_movements_batchId_createdAt_idx" ON "inventory_stock_movements"("batchId", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_stock_movements_movementType_createdAt_idx" ON "inventory_stock_movements"("movementType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "finance_cost_centers_code_key" ON "finance_cost_centers"("code");

-- CreateIndex
CREATE INDEX "finance_cost_centers_active_idx" ON "finance_cost_centers"("active");

-- CreateIndex
CREATE INDEX "finance_cost_centers_department_idx" ON "finance_cost_centers"("department");

-- CreateIndex
CREATE UNIQUE INDEX "finance_budget_periods_label_key" ON "finance_budget_periods"("label");

-- CreateIndex
CREATE INDEX "finance_budget_periods_status_idx" ON "finance_budget_periods"("status");

-- CreateIndex
CREATE INDEX "finance_budget_allocations_periodId_costCenterId_idx" ON "finance_budget_allocations"("periodId", "costCenterId");

-- CreateIndex
CREATE INDEX "finance_budget_allocations_department_building_idx" ON "finance_budget_allocations"("department", "building");

-- CreateIndex
CREATE INDEX "finance_budget_usages_allocationId_createdAt_idx" ON "finance_budget_usages"("allocationId", "createdAt");

-- CreateIndex
CREATE INDEX "finance_budget_usages_usageType_idx" ON "finance_budget_usages"("usageType");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_invoices_invoiceNumber_key" ON "procurement_invoices"("invoiceNumber");

-- CreateIndex
CREATE INDEX "procurement_invoices_requestId_idx" ON "procurement_invoices"("requestId");

-- CreateIndex
CREATE INDEX "procurement_invoices_purchaseOrderId_idx" ON "procurement_invoices"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "procurement_invoices_vendorId_idx" ON "procurement_invoices"("vendorId");

-- CreateIndex
CREATE INDEX "procurement_invoices_paymentStatus_idx" ON "procurement_invoices"("paymentStatus");

-- CreateIndex
CREATE INDEX "procurement_invoice_lines_invoiceId_idx" ON "procurement_invoice_lines"("invoiceId");

-- CreateIndex
CREATE INDEX "procurement_invoice_lines_requestItemId_idx" ON "procurement_invoice_lines"("requestItemId");

-- CreateIndex
CREATE INDEX "procurement_invoice_lines_purchaseOrderItemId_idx" ON "procurement_invoice_lines"("purchaseOrderItemId");

-- CreateIndex
CREATE INDEX "procurement_supplier_catalog_items_vendorId_active_idx" ON "procurement_supplier_catalog_items"("vendorId", "active");

-- CreateIndex
CREATE INDEX "procurement_supplier_catalog_items_category_itemName_idx" ON "procurement_supplier_catalog_items"("category", "itemName");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_rfqs_rfqNumber_key" ON "procurement_rfqs"("rfqNumber");

-- CreateIndex
CREATE INDEX "procurement_rfqs_requestId_status_idx" ON "procurement_rfqs"("requestId", "status");

-- CreateIndex
CREATE INDEX "procurement_rfq_invitations_rfqId_responseStatus_idx" ON "procurement_rfq_invitations"("rfqId", "responseStatus");

-- CreateIndex
CREATE INDEX "procurement_rfq_invitations_vendorId_idx" ON "procurement_rfq_invitations"("vendorId");

-- CreateIndex
CREATE INDEX "procurement_request_items_abcClass_idx" ON "procurement_request_items"("abcClass");

-- CreateIndex
CREATE INDEX "procurement_requests_abcClass_idx" ON "procurement_requests"("abcClass");

-- CreateIndex
CREATE INDEX "procurement_requests_financeStatus_idx" ON "procurement_requests"("financeStatus");

-- CreateIndex
CREATE INDEX "procurement_requests_costCenterId_idx" ON "procurement_requests"("costCenterId");

-- CreateIndex
CREATE INDEX "procurement_requests_budgetAllocationId_idx" ON "procurement_requests"("budgetAllocationId");

-- CreateIndex
CREATE INDEX "procurement_vendors_active_idx" ON "procurement_vendors"("active");

-- CreateIndex
CREATE INDEX "spare_stock_items_abcClass_idx" ON "spare_stock_items"("abcClass");

-- AddForeignKey
ALTER TABLE "procurement_requests" ADD CONSTRAINT "procurement_requests_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "finance_cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_requests" ADD CONSTRAINT "procurement_requests_budgetAllocationId_fkey" FOREIGN KEY ("budgetAllocationId") REFERENCES "finance_budget_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock_batches" ADD CONSTRAINT "inventory_stock_batches_spareStockItemId_fkey" FOREIGN KEY ("spareStockItemId") REFERENCES "spare_stock_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock_movements" ADD CONSTRAINT "inventory_stock_movements_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "inventory_stock_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_budget_allocations" ADD CONSTRAINT "finance_budget_allocations_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "finance_budget_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_budget_allocations" ADD CONSTRAINT "finance_budget_allocations_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "finance_cost_centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_budget_usages" ADD CONSTRAINT "finance_budget_usages_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "finance_budget_allocations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_invoices" ADD CONSTRAINT "procurement_invoices_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "procurement_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_invoices" ADD CONSTRAINT "procurement_invoices_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "procurement_purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_invoices" ADD CONSTRAINT "procurement_invoices_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "procurement_vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_invoice_lines" ADD CONSTRAINT "procurement_invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "procurement_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_invoice_lines" ADD CONSTRAINT "procurement_invoice_lines_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "procurement_request_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_invoice_lines" ADD CONSTRAINT "procurement_invoice_lines_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "procurement_purchase_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_supplier_catalog_items" ADD CONSTRAINT "procurement_supplier_catalog_items_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "procurement_vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_rfqs" ADD CONSTRAINT "procurement_rfqs_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "procurement_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_rfq_invitations" ADD CONSTRAINT "procurement_rfq_invitations_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "procurement_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_rfq_invitations" ADD CONSTRAINT "procurement_rfq_invitations_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "procurement_vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "asset_eol_assessments_procurementRecommended_procurementWindowM" RENAME TO "asset_eol_assessments_procurementRecommended_procurementWin_idx";
