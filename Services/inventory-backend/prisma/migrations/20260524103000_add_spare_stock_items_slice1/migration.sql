-- Slice 1: dedicated spare stock inventory table (additive, backward compatible)

CREATE TABLE "spare_stock_items" (
    "id" TEXT NOT NULL,
    "partName" TEXT NOT NULL,
    "componentType" TEXT NOT NULL,
    "category" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "partNumber" TEXT,
    "quantityAvailable" INTEGER NOT NULL DEFAULT 0,
    "minimumStockLevel" INTEGER NOT NULL DEFAULT 0,
    "reorderPoint" INTEGER,
    "location" TEXT,
    "vendor" TEXT,
    "unitCost" DECIMAL(65,30),
    "compatibleAssetTypes" JSONB,
    "compatibleBrandsModels" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spare_stock_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "spare_stock_items_componentType_idx" ON "spare_stock_items"("componentType");
CREATE INDEX "spare_stock_items_partNumber_idx" ON "spare_stock_items"("partNumber");
CREATE INDEX "spare_stock_items_quantityAvailable_minimumStockLevel_idx" ON "spare_stock_items"("quantityAvailable", "minimumStockLevel");
