-- Inventory RBAC / approval workflow foundations.
-- Safe additive migration: no existing tables or data are dropped or modified.

CREATE TABLE IF NOT EXISTS "inventory_approval_policies" (
  "id" TEXT NOT NULL,
  "policyKey" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "riskLevel" TEXT NOT NULL,
  "scopeType" TEXT NOT NULL,
  "actorRole" TEXT NOT NULL,
  "minAmount" DECIMAL(65,30),
  "maxAmount" DECIMAL(65,30),
  "minQuantity" INTEGER,
  "maxQuantity" INTEGER,
  "assetCriticality" TEXT,
  "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
  "approverRole" TEXT,
  "requiresDualApproval" BOOLEAN NOT NULL DEFAULT false,
  "autoApprove" BOOLEAN NOT NULL DEFAULT false,
  "notifyOnly" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_approval_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_approval_policies_policyKey_key" ON "inventory_approval_policies"("policyKey");
CREATE INDEX IF NOT EXISTS "inventory_approval_policies_actionType_idx" ON "inventory_approval_policies"("actionType");
CREATE INDEX IF NOT EXISTS "inventory_approval_policies_riskLevel_idx" ON "inventory_approval_policies"("riskLevel");
CREATE INDEX IF NOT EXISTS "inventory_approval_policies_scopeType_idx" ON "inventory_approval_policies"("scopeType");
CREATE INDEX IF NOT EXISTS "inventory_approval_policies_actorRole_idx" ON "inventory_approval_policies"("actorRole");
CREATE INDEX IF NOT EXISTS "inventory_approval_policies_approverRole_idx" ON "inventory_approval_policies"("approverRole");
CREATE INDEX IF NOT EXISTS "inventory_approval_policies_isActive_idx" ON "inventory_approval_policies"("isActive");

CREATE TABLE IF NOT EXISTS "inventory_approval_requests" (
  "id" TEXT NOT NULL,
  "requestCode" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "riskLevel" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "entityLabel" TEXT,
  "buildingCode" TEXT,
  "targetBuildingCode" TEXT,
  "amount" DECIMAL(65,30),
  "quantity" INTEGER,
  "assetCriticality" TEXT,
  "requestedByUserId" TEXT NOT NULL,
  "requestedByRole" TEXT NOT NULL,
  "requestedByName" TEXT,
  "approverRole" TEXT,
  "approverUserId" TEXT,
  "approverBuildingCode" TEXT,
  "reason" TEXT,
  "payloadJson" JSONB,
  "notificationWarnings" JSONB,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_approval_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_approval_requests_requestCode_key" ON "inventory_approval_requests"("requestCode");
CREATE INDEX IF NOT EXISTS "inventory_approval_requests_actionType_idx" ON "inventory_approval_requests"("actionType");
CREATE INDEX IF NOT EXISTS "inventory_approval_requests_status_idx" ON "inventory_approval_requests"("status");
CREATE INDEX IF NOT EXISTS "inventory_approval_requests_buildingCode_idx" ON "inventory_approval_requests"("buildingCode");
CREATE INDEX IF NOT EXISTS "inventory_approval_requests_targetBuildingCode_idx" ON "inventory_approval_requests"("targetBuildingCode");
CREATE INDEX IF NOT EXISTS "inventory_approval_requests_requestedByUserId_idx" ON "inventory_approval_requests"("requestedByUserId");
CREATE INDEX IF NOT EXISTS "inventory_approval_requests_approverRole_idx" ON "inventory_approval_requests"("approverRole");
CREATE INDEX IF NOT EXISTS "inventory_approval_requests_approverUserId_idx" ON "inventory_approval_requests"("approverUserId");
CREATE INDEX IF NOT EXISTS "inventory_approval_requests_entityType_entityId_idx" ON "inventory_approval_requests"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "inventory_approval_requests_createdAt_idx" ON "inventory_approval_requests"("createdAt");

CREATE TABLE IF NOT EXISTS "inventory_approval_decisions" (
  "id" TEXT NOT NULL,
  "approvalRequestId" TEXT NOT NULL,
  "decidedByUserId" TEXT NOT NULL,
  "decidedByRole" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_approval_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_approval_decisions_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "inventory_approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "inventory_approval_decisions_approvalRequestId_createdAt_idx" ON "inventory_approval_decisions"("approvalRequestId", "createdAt");
CREATE INDEX IF NOT EXISTS "inventory_approval_decisions_decision_createdAt_idx" ON "inventory_approval_decisions"("decision", "createdAt");

CREATE TABLE IF NOT EXISTS "inventory_audit_logs" (
  "id" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "actionType" TEXT NOT NULL,
  "riskLevel" TEXT,
  "performedByUserId" TEXT NOT NULL,
  "performedByRole" TEXT NOT NULL,
  "buildingCode" TEXT,
  "targetBuildingCode" TEXT,
  "approvalRequestId" TEXT,
  "beforeJson" JSONB,
  "afterJson" JSONB,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_audit_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_audit_logs_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "inventory_approval_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "inventory_audit_logs_entityType_entityId_idx" ON "inventory_audit_logs"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "inventory_audit_logs_actionType_idx" ON "inventory_audit_logs"("actionType");
CREATE INDEX IF NOT EXISTS "inventory_audit_logs_riskLevel_idx" ON "inventory_audit_logs"("riskLevel");
CREATE INDEX IF NOT EXISTS "inventory_audit_logs_performedByUserId_idx" ON "inventory_audit_logs"("performedByUserId");
CREATE INDEX IF NOT EXISTS "inventory_audit_logs_performedByRole_idx" ON "inventory_audit_logs"("performedByRole");
CREATE INDEX IF NOT EXISTS "inventory_audit_logs_buildingCode_idx" ON "inventory_audit_logs"("buildingCode");
CREATE INDEX IF NOT EXISTS "inventory_audit_logs_targetBuildingCode_idx" ON "inventory_audit_logs"("targetBuildingCode");
CREATE INDEX IF NOT EXISTS "inventory_audit_logs_approvalRequestId_idx" ON "inventory_audit_logs"("approvalRequestId");
CREATE INDEX IF NOT EXISTS "inventory_audit_logs_createdAt_idx" ON "inventory_audit_logs"("createdAt");

CREATE TABLE IF NOT EXISTS "inventory_user_scopes" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "buildingCode" TEXT,
  "reportsToUserId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "source" TEXT NOT NULL DEFAULT 'demo_fallback',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_user_scopes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_user_scopes_userId_role_buildingCode_key" ON "inventory_user_scopes"("userId", "role", "buildingCode");
CREATE INDEX IF NOT EXISTS "inventory_user_scopes_role_idx" ON "inventory_user_scopes"("role");
CREATE INDEX IF NOT EXISTS "inventory_user_scopes_buildingCode_idx" ON "inventory_user_scopes"("buildingCode");
CREATE INDEX IF NOT EXISTS "inventory_user_scopes_reportsToUserId_idx" ON "inventory_user_scopes"("reportsToUserId");
CREATE INDEX IF NOT EXISTS "inventory_user_scopes_isActive_idx" ON "inventory_user_scopes"("isActive");
