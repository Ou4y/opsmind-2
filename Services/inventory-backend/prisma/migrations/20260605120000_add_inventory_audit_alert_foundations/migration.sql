-- Add durable Inventory audit/cycle-count sessions and smart alert foundations.
-- Safe/additive only: no existing tables or data are modified.

CREATE TABLE "inventory_audit_sessions" (
    "id" TEXT NOT NULL,
    "sessionNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "building" TEXT,
    "room" TEXT,
    "department" TEXT,
    "category" TEXT,
    "assetType" TEXT,
    "auditor" TEXT,
    "notes" TEXT,
    "summary" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_audit_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_audit_session_items" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetTag" TEXT,
    "serialNumber" TEXT,
    "assetName" TEXT,
    "expectedLocation" TEXT,
    "expectedDepartment" TEXT,
    "expectedStatus" TEXT,
    "auditStatus" TEXT NOT NULL DEFAULT 'pending',
    "observedLocation" TEXT,
    "condition" TEXT,
    "notes" TEXT,
    "auditor" TEXT,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_audit_session_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_alert_rules" (
    "id" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "threshold" JSONB,
    "recipientRole" TEXT,
    "cooldownHours" INTEGER NOT NULL DEFAULT 24,
    "lastTriggeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_alert_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_alert_events" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT,
    "ruleKey" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_alert_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inventory_audit_sessions_sessionNumber_key" ON "inventory_audit_sessions"("sessionNumber");
CREATE INDEX "inventory_audit_sessions_status_startedAt_idx" ON "inventory_audit_sessions"("status", "startedAt");
CREATE INDEX "inventory_audit_sessions_building_department_idx" ON "inventory_audit_sessions"("building", "department");
CREATE INDEX "inventory_audit_sessions_category_assetType_idx" ON "inventory_audit_sessions"("category", "assetType");

CREATE UNIQUE INDEX "inventory_audit_session_items_sessionId_assetId_key" ON "inventory_audit_session_items"("sessionId", "assetId");
CREATE INDEX "inventory_audit_session_items_assetId_idx" ON "inventory_audit_session_items"("assetId");
CREATE INDEX "inventory_audit_session_items_assetTag_idx" ON "inventory_audit_session_items"("assetTag");
CREATE INDEX "inventory_audit_session_items_auditStatus_idx" ON "inventory_audit_session_items"("auditStatus");

CREATE UNIQUE INDEX "inventory_alert_rules_ruleKey_key" ON "inventory_alert_rules"("ruleKey");
CREATE INDEX "inventory_alert_rules_enabled_alertType_idx" ON "inventory_alert_rules"("enabled", "alertType");

CREATE UNIQUE INDEX "inventory_alert_events_dedupeKey_key" ON "inventory_alert_events"("dedupeKey");
CREATE INDEX "inventory_alert_events_status_severity_triggeredAt_idx" ON "inventory_alert_events"("status", "severity", "triggeredAt");
CREATE INDEX "inventory_alert_events_ruleKey_triggeredAt_idx" ON "inventory_alert_events"("ruleKey", "triggeredAt");
CREATE INDEX "inventory_alert_events_entityType_entityId_idx" ON "inventory_alert_events"("entityType", "entityId");

ALTER TABLE "inventory_audit_session_items"
ADD CONSTRAINT "inventory_audit_session_items_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "inventory_audit_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_alert_events"
ADD CONSTRAINT "inventory_alert_events_ruleId_fkey"
FOREIGN KEY ("ruleId") REFERENCES "inventory_alert_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
