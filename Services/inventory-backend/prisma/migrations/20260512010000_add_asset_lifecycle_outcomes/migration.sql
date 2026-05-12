-- CreateTable
CREATE TABLE "asset_lifecycle_outcomes" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "purchaseDate" TIMESTAMP(3),
    "commissionedAt" TIMESTAMP(3),
    "failureDate" TIMESTAMP(3),
    "replacementDate" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "failureType" TEXT,
    "replacementCost" DECIMAL(65,30),
    "actualLifespanYears" DOUBLE PRECISION,
    "finalOutcome" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_lifecycle_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "asset_lifecycle_outcomes_assetId_key" ON "asset_lifecycle_outcomes"("assetId");

-- AddForeignKey
ALTER TABLE "asset_lifecycle_outcomes" ADD CONSTRAINT "asset_lifecycle_outcomes_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("customId") ON DELETE CASCADE ON UPDATE CASCADE;

