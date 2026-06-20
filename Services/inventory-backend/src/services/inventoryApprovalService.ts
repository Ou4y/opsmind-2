import axios from 'axios';
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Prisma, PrismaClient } from '@prisma/client';

export type InventoryRole =
  | 'ADMIN'
  | 'SUPERVISOR_CHIEF'
  | 'BUILDING_SUPERVISOR'
  | 'SENIOR'
  | 'JUNIOR';

export type InventoryScopeType = 'GLOBAL' | 'BUILDING' | 'WAREHOUSE' | 'OWN_ASSIGNMENTS';
export type InventoryRiskLevel = 'L0_ROUTINE' | 'L1_OPERATIONAL' | 'L2_CONTROLLED' | 'L3_HIGH_IMPACT' | 'L4_SYSTEM_CRITICAL';

export type InventoryUserContext = {
  userId: string;
  displayName?: string;
  role: InventoryRole;
  buildingCode?: string | null;
  scopeType: InventoryScopeType;
  reportsToUserId?: string | null;
  authSource: 'jwt' | 'headers' | 'demo_fallback';
};

export type InventoryActionContext = {
  actionType: string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  buildingCode?: string | null;
  targetBuildingCode?: string | null;
  amount?: number | null;
  quantity?: number | null;
  assetCriticality?: string | null;
  reason?: string | null;
  payloadJson?: Record<string, unknown> | null;
};

export type InventoryApprovalEvaluation = {
  actionAllowed: boolean;
  autoApprove: boolean;
  approvalRequired: boolean;
  notifyOnly: boolean;
  riskLevel: InventoryRiskLevel;
  scopeType: InventoryScopeType;
  approverRole?: InventoryRole | null;
  requiresDualApproval: boolean;
  reason: string;
  policyKey: string;
};

export type MaintenanceApprovalClassification = {
  actionType: string;
  typeCandidate: string;
  statusCandidate: string;
  notesCandidate: string;
  normalizedSignal: string;
  approvalReason: string;
};

const ROLE_RANK: Record<InventoryRole, number> = {
  JUNIOR: 10,
  SENIOR: 20,
  BUILDING_SUPERVISOR: 30,
  SUPERVISOR_CHIEF: 40,
  ADMIN: 50,
};

const BUILDINGS = ['MAIN', 'N', 'K', 'S', 'R', 'PHARMACY', 'CENTRAL_WAREHOUSE'];
const JWT_SECRET = process.env.JWT_SECRET || 'opsmind-local-jwt';
const INVENTORY_ENFORCE_AUTH = String(process.env.INVENTORY_ENFORCE_AUTH || 'false').toLowerCase() === 'true';

type InventoryJwtClaims = {
  userId?: string;
  id?: string;
  sub?: string;
  email?: string;
  name?: string;
  displayName?: string;
  role?: string;
  roles?: string[];
  technicianLevel?: string;
  technician_level?: string;
  level?: string;
  supportLevel?: string;
  support_level?: string;
  buildingCode?: string;
  building?: string;
  location?: string;
  reportsToUserId?: string;
};

const LOCAL_QA_INVENTORY_CONTEXT: Record<string, {
  role: InventoryRole;
  buildingCode: string | null;
  displayName: string;
}> = {
  'qa.junior@opsmind.local': {
    role: 'JUNIOR',
    buildingCode: 'MAIN',
    displayName: 'QA Junior',
  },
  'qa.senior@opsmind.local': {
    role: 'SENIOR',
    buildingCode: 'MAIN',
    displayName: 'QA Senior',
  },
  'qa.supervisor@opsmind.local': {
    role: 'BUILDING_SUPERVISOR',
    buildingCode: 'MAIN',
    displayName: 'QA Building Supervisor',
  },
  'qa.chief@opsmind.local': {
    role: 'SUPERVISOR_CHIEF',
    buildingCode: null,
    displayName: 'QA Supervisor Chief',
  },
  'qa.admin@opsmind.local': {
    role: 'ADMIN',
    buildingCode: null,
    displayName: 'QA Admin',
  },
};

const ACTION_RISK: Record<string, InventoryRiskLevel> = {
  'inventory.view': 'L0_ROUTINE',
  'asset.search': 'L0_ROUTINE',
  'asset.qr.scan': 'L0_ROUTINE',
  'asset.note.add': 'L0_ROUTINE',
  'asset.photo.add': 'L0_ROUTINE',
  'asset.minor_status.update': 'L0_ROUTINE',
  'audit.task.complete': 'L0_ROUTINE',
  'label.print': 'L0_ROUTINE',
  'asset.maintenance.routine': 'L0_ROUTINE',
  'asset.create': 'L1_OPERATIONAL',
  'asset.update': 'L1_OPERATIONAL',
  'asset.condition.report_damaged': 'L1_OPERATIONAL',
  'asset.condition.report_missing': 'L1_OPERATIONAL',
  'asset.repair.request': 'L1_OPERATIONAL',
  'consumable.request.small': 'L1_OPERATIONAL',
  'audit.discrepancy.submit': 'L1_OPERATIONAL',
  'asset.assignment.request': 'L1_OPERATIONAL',
  'warehouse.receiving.quantity_draft': 'L1_OPERATIONAL',
  'warehouse.stock.mismatch_report': 'L1_OPERATIONAL',
  'warehouse.dispatch.small': 'L1_OPERATIONAL',
  'warehouse.stock.issue.small': 'L1_OPERATIONAL',
  'asset.assignment.change': 'L2_CONTROLLED',
  'asset.internal_transfer.medium_or_valuable': 'L2_CONTROLLED',
  'asset.condition.mark_unusable': 'L2_CONTROLLED',
  'asset.replacement.request': 'L2_CONTROLLED',
  'procurement.request.medium_value': 'L2_CONTROLLED',
  'warehouse.stock.issue.medium': 'L2_CONTROLLED',
  'warehouse.receiving.confirm': 'L2_CONTROLLED',
  'warehouse.dispatch.medium': 'L2_CONTROLLED',
  'warehouse.stock.correction.medium': 'L2_CONTROLLED',
  'receiving.inventory_impact': 'L2_CONTROLLED',
  'warranty.claim.start': 'L2_CONTROLLED',
  'stock.quantity.adjustment.medium': 'L2_CONTROLLED',
  'asset.cross_building_transfer': 'L3_HIGH_IMPACT',
  'asset.bulk_transfer': 'L3_HIGH_IMPACT',
  'procurement.request.high_value': 'L3_HIGH_IMPACT',
  'critical_asset.replacement': 'L3_HIGH_IMPACT',
  'warehouse.dispatch.large': 'L3_HIGH_IMPACT',
  'warehouse.stock.issue.large': 'L3_HIGH_IMPACT',
  'warehouse.stock.correction.large': 'L3_HIGH_IMPACT',
  'warehouse.cross_building.dispatch': 'L3_HIGH_IMPACT',
  'vendor.exception': 'L3_HIGH_IMPACT',
  'emergency.shortage_resolution': 'L3_HIGH_IMPACT',
  'major_asset_loss': 'L3_HIGH_IMPACT',
  'receiving.high_value': 'L3_HIGH_IMPACT',
  'asset.delete.permanent': 'L4_SYSTEM_CRITICAL',
  'asset.dispose.write_off': 'L4_SYSTEM_CRITICAL',
  'approval.policy.change': 'L4_SYSTEM_CRITICAL',
  'role.permission.change': 'L4_SYSTEM_CRITICAL',
  'procurement.request.very_high_value': 'L4_SYSTEM_CRITICAL',
  'financial.override': 'L4_SYSTEM_CRITICAL',
  'approval.override': 'L4_SYSTEM_CRITICAL',
  'system_wide_stock_correction': 'L4_SYSTEM_CRITICAL',
  'vendor.blacklist': 'L4_SYSTEM_CRITICAL',
  'destructive.bulk_action': 'L4_SYSTEM_CRITICAL',
};

const DEFAULT_POLICY_ROWS = [
  ['default:l0:junior', 'inventory.view', 'L0_ROUTINE', 'BUILDING', 'JUNIOR', null, null, false, null, false, true, false],
  ['default:l0:senior', 'inventory.view', 'L0_ROUTINE', 'BUILDING', 'SENIOR', null, null, false, null, false, true, false],
  ['default:l0:building-supervisor', 'inventory.view', 'L0_ROUTINE', 'BUILDING', 'BUILDING_SUPERVISOR', null, null, false, null, false, true, false],
  ['default:l1:junior', 'asset.condition.report_damaged', 'L1_OPERATIONAL', 'BUILDING', 'JUNIOR', null, null, true, 'SENIOR', false, false, false],
  ['default:l1:missing-report', 'asset.condition.report_missing', 'L1_OPERATIONAL', 'BUILDING', 'JUNIOR', null, null, true, 'SENIOR', false, false, false],
  ['default:l1:repair-request', 'asset.repair.request', 'L1_OPERATIONAL', 'BUILDING', 'JUNIOR', null, null, true, 'SENIOR', false, false, false],
  ['default:l1:audit-discrepancy', 'audit.discrepancy.submit', 'L1_OPERATIONAL', 'BUILDING', 'JUNIOR', null, null, true, 'SENIOR', false, false, false],
  ['default:l1:assignment-request', 'asset.assignment.request', 'L1_OPERATIONAL', 'BUILDING', 'JUNIOR', null, null, true, 'SENIOR', false, false, false],
  ['default:l1:senior', 'asset.condition.report_damaged', 'L1_OPERATIONAL', 'BUILDING', 'SENIOR', null, null, false, null, false, true, false],
  ['default:l1:warehouse-junior-dispatch', 'warehouse.dispatch.small', 'L1_OPERATIONAL', 'WAREHOUSE', 'JUNIOR', null, 1000, true, 'SENIOR', false, false, false],
  ['default:l2:warehouse-receiving-confirm', 'warehouse.receiving.confirm', 'L2_CONTROLLED', 'WAREHOUSE', 'SENIOR', null, 5000, true, 'BUILDING_SUPERVISOR', false, false, false],
  ['default:l2:warehouse-medium-issue', 'warehouse.stock.issue.medium', 'L2_CONTROLLED', 'WAREHOUSE', 'SENIOR', 1001, 5000, true, 'BUILDING_SUPERVISOR', false, false, false],
  ['default:l3:warehouse-large-dispatch', 'warehouse.dispatch.large', 'L3_HIGH_IMPACT', 'WAREHOUSE', 'BUILDING_SUPERVISOR', 5001, 25000, true, 'SUPERVISOR_CHIEF', false, false, false],
  ['default:l2:senior', 'procurement.request.medium_value', 'L2_CONTROLLED', 'BUILDING', 'SENIOR', 1001, 5000, true, 'BUILDING_SUPERVISOR', false, false, false],
  ['default:l2:building-supervisor', 'asset.assignment.change', 'L2_CONTROLLED', 'BUILDING', 'BUILDING_SUPERVISOR', null, null, false, null, false, true, false],
  ['default:l3:building-supervisor', 'asset.cross_building_transfer', 'L3_HIGH_IMPACT', 'BUILDING', 'BUILDING_SUPERVISOR', null, null, true, 'SUPERVISOR_CHIEF', false, false, false],
  ['default:l3:procurement-high', 'procurement.request.high_value', 'L3_HIGH_IMPACT', 'BUILDING', 'BUILDING_SUPERVISOR', 5001, 25000, true, 'SUPERVISOR_CHIEF', false, false, false],
  ['default:l4:supervisor-chief-writeoff', 'asset.dispose.write_off', 'L4_SYSTEM_CRITICAL', 'GLOBAL', 'SUPERVISOR_CHIEF', null, null, true, 'ADMIN', false, false, false],
  ['default:l4:very-high-procurement', 'procurement.request.very_high_value', 'L4_SYSTEM_CRITICAL', 'GLOBAL', 'SUPERVISOR_CHIEF', 25001, null, true, 'ADMIN', false, false, false],
] as const;

function normalizeToken(value: unknown): string {
  return String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeMaintenanceSignalToken(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function includesMaintenanceKeyword(signal: string, keywords: string[]): boolean {
  return keywords.some((keyword) => signal.includes(keyword));
}

export function classifyMaintenanceApprovalAction(
  payload: Record<string, unknown> = {},
  userRole?: InventoryRole,
): MaintenanceApprovalClassification {
  const typeCandidate = normalizeMaintenanceSignalToken(
    payload.maintenanceType
    || payload.maintenance_type
    || payload.type
    || payload.category
    || '',
  );
  const statusCandidate = normalizeMaintenanceSignalToken(
    payload.status
    || payload.maintenanceStatus
    || payload.maintenance_status
    || '',
  );
  const notesCandidate = normalizeMaintenanceSignalToken(
    payload.notes
    || payload.description
    || payload.comments
    || payload.details
    || payload.reason
    || '',
  );
  const normalizedSignal = [typeCandidate, statusCandidate, notesCandidate].filter(Boolean).join(' ');
  const controlledKeywords = [
    'corrective',
    'corrective_maintenance',
    'repair',
    'damage',
    'damaged',
    'missing',
    'lost',
    'audit',
    'audit_discrepancy',
    'discrepancy',
    'under_repair',
    'needs_repair',
    'broken',
    'failed',
    'failure',
    'issue',
    'problem',
  ];
  const routineKeywords = ['preventive_maintenance', 'preventive', 'routine', 'scheduled'];

  if (includesMaintenanceKeyword(normalizedSignal, ['missing', 'lost'])) {
    return { actionType: 'asset.condition.report_missing', typeCandidate, statusCandidate, notesCandidate, normalizedSignal, approvalReason: 'maintenance_missing_or_lost_signal' };
  }
  if (includesMaintenanceKeyword(normalizedSignal, ['damage', 'damaged', 'broken', 'failed', 'failure'])) {
    return { actionType: 'asset.condition.report_damaged', typeCandidate, statusCandidate, notesCandidate, normalizedSignal, approvalReason: 'maintenance_damage_signal' };
  }
  if (includesMaintenanceKeyword(normalizedSignal, ['audit', 'audit_discrepancy', 'discrepancy'])) {
    return { actionType: 'audit.discrepancy.submit', typeCandidate, statusCandidate, notesCandidate, normalizedSignal, approvalReason: 'maintenance_audit_discrepancy_signal' };
  }
  if (includesMaintenanceKeyword(normalizedSignal, controlledKeywords)) {
    return { actionType: 'asset.repair.request', typeCandidate, statusCandidate, notesCandidate, normalizedSignal, approvalReason: 'maintenance_controlled_keyword_signal' };
  }

  const isClearlyRoutine = includesMaintenanceKeyword(typeCandidate, routineKeywords)
    && !includesMaintenanceKeyword(notesCandidate, controlledKeywords);
  if (userRole === 'JUNIOR' && statusCandidate === 'in_progress' && !isClearlyRoutine) {
    return { actionType: 'asset.repair.request', typeCandidate, statusCandidate, notesCandidate, normalizedSignal, approvalReason: 'junior_ambiguous_in_progress_maintenance' };
  }

  return { actionType: 'asset.maintenance.routine', typeCandidate, statusCandidate, notesCandidate, normalizedSignal, approvalReason: 'routine_maintenance' };
}

function getBearerToken(req: Request): string | null {
  const authHeader = String(req.headers.authorization || '').trim();
  if (!authHeader.toLowerCase().startsWith('bearer ')) return null;
  return authHeader.slice('bearer '.length).trim() || null;
}

function resolveJwtClaimsFromRequest(req: Request): InventoryJwtClaims | null {
  const token = getBearerToken(req);
  if (!token) return null;

  try {
    return jwt.verify(token, JWT_SECRET) as InventoryJwtClaims;
  } catch {
    // In local non-enforced mode, use decoded claims only as persona context.
    // Enforced routes still require middleware verification before reaching this resolver.
    if (!INVENTORY_ENFORCE_AUTH) {
      return jwt.decode(token) as InventoryJwtClaims | null;
    }
    return null;
  }
}

function resolveLocalQaInventoryContext(email: unknown) {
  if (String(process.env.NODE_ENV || 'development').toLowerCase() === 'production') {
    return null;
  }
  return LOCAL_QA_INVENTORY_CONTEXT[normalizeEmail(email)] || null;
}

function resolveTechnicianLevel(user: any): string | null {
  return String(
    user?.technicianLevel ||
    user?.technician_level ||
    user?.level ||
    user?.supportLevel ||
    user?.support_level ||
    ''
  ).trim() || null;
}

export function normalizeInventoryRole(value: unknown, technicianLevel?: unknown): InventoryRole {
  const raw = normalizeToken(value);
  const level = normalizeToken(technicianLevel);
  if (raw === 'ADMIN' || level === 'ADMIN') return 'ADMIN';
  if (raw === 'SUPERVISOR_CHIEF' || raw === 'CHIEF' || level === 'SUPERVISOR_CHIEF' || level === 'CHIEF') return 'SUPERVISOR_CHIEF';
  if (raw === 'BUILDING_SUPERVISOR' || raw === 'SUPERVISOR' || level === 'BUILDING_SUPERVISOR' || level === 'SUPERVISOR') return 'BUILDING_SUPERVISOR';
  if (raw === 'SENIOR' || level === 'SENIOR') return 'SENIOR';
  if (raw === 'JUNIOR' || raw === 'TECHNICIAN' || level === 'JUNIOR') return 'JUNIOR';
  // Unknown identities must never gain elevated Inventory authority.
  return 'JUNIOR';
}

export function normalizeBuildingCode(value: unknown): string | null {
  const normalized = normalizeToken(value);
  if (!normalized) return null;
  if (normalized === 'M' || normalized === 'MAIN_BUILDING') return 'MAIN';
  if (normalized === 'PH' || normalized === 'PHARMACY_BUILDING') return 'PHARMACY';
  if (normalized === 'WAREHOUSE' || normalized === 'CENTRAL') return 'CENTRAL_WAREHOUSE';
  return BUILDINGS.includes(normalized) ? normalized : normalized;
}

export function normalizeKnownBuildingCode(value: unknown): string | null {
  const normalized = normalizeBuildingCode(value);
  if (!normalized) return null;
  if (normalized === 'GLOBAL') return 'GLOBAL';
  return BUILDINGS.includes(normalized) ? normalized : null;
}

function inferScopeType(context: InventoryUserContext): InventoryScopeType {
  if (context.role === 'ADMIN' || context.role === 'SUPERVISOR_CHIEF') return 'GLOBAL';
  if (context.buildingCode === 'CENTRAL_WAREHOUSE') return 'WAREHOUSE';
  return context.buildingCode ? 'BUILDING' : 'OWN_ASSIGNMENTS';
}

export function getCurrentInventoryUserContext(req: Request): InventoryUserContext {
  const jwtClaims = resolveJwtClaimsFromRequest(req);
  const reqUser = (req as any).user || jwtClaims || {};
  const headerRole = req.headers['x-user-role'];
  const headerBuilding = req.headers['x-user-building'];
  const email = reqUser.email || jwtClaims?.email || req.headers['x-user-email'];
  const qaContext = resolveLocalQaInventoryContext(email);
  const technicianLevel = resolveTechnicianLevel(reqUser);
  const hasJwtContext = Boolean(reqUser.userId || reqUser.id || reqUser.sub || jwtClaims?.userId || jwtClaims?.email);
  const hasHeaderContext = Boolean(req.headers['x-user-id'] || req.headers['x-user-email'] || req.headers['x-user-role']);
  const hasAnyAuthContext = Boolean(qaContext || hasJwtContext || hasHeaderContext);
  const role = hasAnyAuthContext
    ? (qaContext?.role || normalizeInventoryRole(headerRole || reqUser.role || reqUser.roles?.[0], technicianLevel))
    : 'ADMIN';
  const buildingSource = qaContext
    ? qaContext.buildingCode
    : (headerBuilding || reqUser.buildingCode || reqUser.building || reqUser.location || 'MAIN');
  const buildingCode = qaContext?.buildingCode === null ? null : normalizeBuildingCode(buildingSource);
  const context: InventoryUserContext = {
    userId: String(req.headers['x-user-id'] || reqUser.userId || reqUser.id || reqUser.sub || 'demo-admin'),
    displayName: String(req.headers['x-user-name'] || qaContext?.displayName || reqUser.displayName || reqUser.name || email || 'Demo Admin'),
    role,
    buildingCode,
    scopeType: 'GLOBAL',
    reportsToUserId: String(req.headers['x-reports-to-user-id'] || reqUser.reportsToUserId || '') || null,
    authSource: hasJwtContext ? 'jwt' : (hasHeaderContext ? 'headers' : 'demo_fallback'),
  };
  context.scopeType = inferScopeType(context);
  return context;
}

function riskRank(level: InventoryRiskLevel): number {
  return Number(level.slice(1, 2)) || 0;
}

function inferRiskLevel(action: InventoryActionContext): InventoryRiskLevel {
  const amount = Number(action.amount || 0);
  const criticality = normalizeToken(action.assetCriticality);
  if (ACTION_RISK[action.actionType]) return ACTION_RISK[action.actionType];
  if (amount > 25000) return 'L4_SYSTEM_CRITICAL';
  if (amount > 5000 || criticality === 'CRITICAL' || criticality === 'SECURITY' || criticality === 'NETWORK' || criticality === 'SERVER') return 'L3_HIGH_IMPACT';
  if (amount > 1000) return 'L2_CONTROLLED';
  return 'L1_OPERATIONAL';
}

function inferApproverRole(actorRole: InventoryRole, riskLevel: InventoryRiskLevel, amount = 0, assetCriticality?: string | null): InventoryRole | null {
  const criticality = normalizeToken(assetCriticality);
  if (riskLevel === 'L0_ROUTINE') return null;
  if (amount > 25000 || riskLevel === 'L4_SYSTEM_CRITICAL') return actorRole === 'ADMIN' ? null : 'ADMIN';
  if (amount > 5000 || riskLevel === 'L3_HIGH_IMPACT' || ['CRITICAL', 'SECURITY', 'NETWORK', 'SERVER'].includes(criticality)) {
    return ROLE_RANK[actorRole] >= ROLE_RANK.SUPERVISOR_CHIEF ? null : 'SUPERVISOR_CHIEF';
  }
  if (amount > 1000 || riskLevel === 'L2_CONTROLLED') {
    return ROLE_RANK[actorRole] >= ROLE_RANK.BUILDING_SUPERVISOR ? null : 'BUILDING_SUPERVISOR';
  }
  if (actorRole === 'JUNIOR') return 'SENIOR';
  return null;
}

function isWarehouseAction(action: InventoryActionContext, user: InventoryUserContext): boolean {
  const source = normalizeBuildingCode(action.buildingCode || user.buildingCode);
  return source === 'CENTRAL_WAREHOUSE'
    || user.scopeType === 'WAREHOUSE'
    || String(action.actionType || '').startsWith('warehouse.')
    || action.actionType === 'receiving.inventory_impact';
}

function inferWarehouseApproverRole(
  user: InventoryUserContext,
  action: InventoryActionContext,
  riskLevel: InventoryRiskLevel,
): InventoryRole | null {
  if (!isWarehouseAction(action, user)) return null;

  const amount = Number(action.amount || 0);
  const quantity = Number(action.quantity || 0);
  const criticality = normalizeToken(action.assetCriticality);
  const largeOrCritical = quantity > 50
    || amount > 5000
    || riskRank(riskLevel) >= 3
    || ['CRITICAL', 'SECURITY', 'NETWORK', 'SERVER'].includes(criticality);

  if (largeOrCritical) {
    if (ROLE_RANK[user.role] >= ROLE_RANK.BUILDING_SUPERVISOR) {
      return ROLE_RANK[user.role] >= ROLE_RANK.SUPERVISOR_CHIEF ? null : 'SUPERVISOR_CHIEF';
    }
    return 'BUILDING_SUPERVISOR';
  }

  if (riskLevel === 'L1_OPERATIONAL' && user.role === 'JUNIOR') return 'SENIOR';
  if (riskLevel === 'L2_CONTROLLED' && ROLE_RANK[user.role] < ROLE_RANK.BUILDING_SUPERVISOR) return 'BUILDING_SUPERVISOR';
  return null;
}

export function evaluateInventoryApprovalPolicy(user: InventoryUserContext, action: InventoryActionContext): InventoryApprovalEvaluation {
  const amount = Number(action.amount || 0);
  let riskLevel = inferRiskLevel(action);
  if (action.actionType === 'procurement.request.medium_value' || action.actionType === 'procurement.request.high_value' || action.actionType === 'procurement.request.very_high_value') {
    if (amount > 25000) riskLevel = 'L4_SYSTEM_CRITICAL';
    else if (amount > 5000) riskLevel = 'L3_HIGH_IMPACT';
    else if (amount > 1000) riskLevel = 'L2_CONTROLLED';
    else riskLevel = user.role === 'JUNIOR' ? 'L1_OPERATIONAL' : 'L0_ROUTINE';
  }

  const source = normalizeBuildingCode(action.buildingCode || user.buildingCode);
  const target = normalizeBuildingCode(action.targetBuildingCode);
  const crossBuilding = Boolean(source && target && source !== target);
  if (crossBuilding && riskRank(riskLevel) < 3) riskLevel = 'L3_HIGH_IMPACT';

  const approverRole = inferWarehouseApproverRole(user, action, riskLevel)
    || inferApproverRole(user.role, riskLevel, amount, action.assetCriticality);
  const approvalRequired = Boolean(approverRole);
  return {
    actionAllowed: true,
    autoApprove: !approvalRequired,
    approvalRequired,
    notifyOnly: riskLevel === 'L0_ROUTINE',
    riskLevel,
    scopeType: user.scopeType,
    approverRole,
    requiresDualApproval: false,
    reason: approvalRequired
      ? `Approval required from ${String(approverRole).replace(/_/g, ' ')}.`
      : 'Completed - audit logged.',
    policyKey: `runtime:${action.actionType}:${user.role}:${riskLevel}`,
  };
}

export function canUserDecideInventoryApproval(
  user: InventoryUserContext,
  request: { requestedByUserId: string; approverRole?: string | null; approverBuildingCode?: string | null },
): { allowed: boolean; reason?: string } {
  if (request.requestedByUserId === user.userId) {
    return { allowed: false, reason: 'Requesters cannot approve their own controlled Inventory action.' };
  }

  if (!request.approverRole) {
    return { allowed: false, reason: 'Approval request has no approver role.' };
  }

  const approverRole = normalizeInventoryRole(request.approverRole || '');
  if (ROLE_RANK[user.role] < ROLE_RANK[approverRole]) {
    return { allowed: false, reason: `Approval requires ${String(approverRole).replace(/_/g, ' ')} authority.` };
  }

  const approverBuilding = normalizeBuildingCode(request.approverBuildingCode);
  if (
    approverBuilding
    && approverBuilding !== 'GLOBAL'
    && user.role !== 'ADMIN'
    && user.role !== 'SUPERVISOR_CHIEF'
    && normalizeBuildingCode(user.buildingCode) !== approverBuilding
  ) {
    return { allowed: false, reason: `Approval is scoped to ${approverBuilding}.` };
  }

  return { allowed: true };
}

export async function ensureDefaultInventoryApprovalPolicies(prisma: PrismaClient): Promise<void> {
  await Promise.all(DEFAULT_POLICY_ROWS.map(([policyKey, actionType, riskLevel, scopeType, actorRole, minAmount, maxAmount, requiresApproval, approverRole, requiresDualApproval, autoApprove, notifyOnly]) => (
    prisma.inventoryApprovalPolicy.upsert({
      where: { policyKey },
      create: {
        policyKey,
        actionType,
        riskLevel,
        scopeType,
        actorRole,
        minAmount,
        maxAmount,
        requiresApproval,
        approverRole,
        requiresDualApproval,
        autoApprove,
        notifyOnly,
      },
      update: {
        actionType,
        riskLevel,
        scopeType,
        actorRole,
        minAmount,
        maxAmount,
        requiresApproval,
        approverRole,
        requiresDualApproval,
        autoApprove,
        notifyOnly,
        isActive: true,
      },
    })
  )));
}

export async function writeInventoryAuditLog(
  prisma: PrismaClient,
  user: InventoryUserContext,
  action: InventoryActionContext,
  evaluation: Pick<InventoryApprovalEvaluation, 'riskLevel'>,
  approvalRequestId?: string | null,
  metadataJson?: Record<string, unknown>,
): Promise<void> {
  await prisma.inventoryAuditLog.create({
    data: {
      entityType: action.entityType,
      entityId: action.entityId || null,
      actionType: action.actionType,
      riskLevel: evaluation.riskLevel,
      performedByUserId: user.userId,
      performedByRole: user.role,
      buildingCode: normalizeBuildingCode(action.buildingCode || user.buildingCode),
      targetBuildingCode: normalizeBuildingCode(action.targetBuildingCode),
      approvalRequestId: approvalRequestId || null,
      metadataJson: (metadataJson || {}) as Prisma.InputJsonObject,
    },
  });
}

function buildRequestCode(): string {
  return `INV-APR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
}

export async function createInventoryApprovalRequest(
  prisma: PrismaClient,
  user: InventoryUserContext,
  action: InventoryActionContext,
  evaluation: InventoryApprovalEvaluation,
): Promise<any> {
  const requestBuildingCode = normalizeKnownBuildingCode(action.buildingCode)
    || normalizeKnownBuildingCode(user.buildingCode)
    || normalizeBuildingCode(action.buildingCode || user.buildingCode);
  const approverBuildingCode = evaluation.approverRole === 'ADMIN' || evaluation.approverRole === 'SUPERVISOR_CHIEF'
    ? 'GLOBAL'
    : (normalizeKnownBuildingCode(action.buildingCode) || normalizeKnownBuildingCode(user.buildingCode) || requestBuildingCode);
  const request = await prisma.inventoryApprovalRequest.create({
    data: {
      requestCode: buildRequestCode(),
      actionType: action.actionType,
      riskLevel: evaluation.riskLevel,
      status: 'PENDING',
      entityType: action.entityType,
      entityId: action.entityId || null,
      entityLabel: action.entityLabel || null,
      buildingCode: requestBuildingCode,
      targetBuildingCode: normalizeBuildingCode(action.targetBuildingCode),
      amount: action.amount ?? null,
      quantity: action.quantity ?? null,
      assetCriticality: action.assetCriticality || null,
      requestedByUserId: user.userId,
      requestedByRole: user.role,
      requestedByName: user.displayName || null,
      approverRole: evaluation.approverRole || null,
      approverBuildingCode,
      reason: action.reason || evaluation.reason,
      payloadJson: (action.payloadJson || {}) as Prisma.InputJsonObject,
    },
  });
  await writeInventoryAuditLog(prisma, user, action, evaluation, request.id, {
    approvalStatus: 'requested',
    approverRole: evaluation.approverRole,
  });
  return request;
}

export async function hasApprovedInventoryRequest(
  prisma: PrismaClient,
  approvalRequestId: unknown,
  actionType: string,
  action?: Pick<InventoryActionContext, 'entityType' | 'entityId'>,
): Promise<boolean> {
  const id = String(approvalRequestId || '').trim();
  if (!id) return false;
  const request = await prisma.inventoryApprovalRequest.findUnique({ where: { id } });
  if (!request || request.actionType !== actionType || request.status !== 'APPROVED') return false;
  if (action?.entityType && request.entityType !== action.entityType) return false;
  if (action?.entityId && request.entityId !== action.entityId) return false;
  return true;
}

export async function sendInventoryApprovalNotification(
  type: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; warning?: string }> {
  if (String(process.env.INVENTORY_APPROVAL_NOTIFICATION_ENABLED || 'true').toLowerCase() === 'false') {
    return { ok: true };
  }
  const baseUrl = process.env.NOTIFICATION_SERVICE_URL || process.env.NOTIFICATION_API_URL || 'http://notification-service:3000/api/notifications';
  try {
    await axios.post(`${baseUrl.replace(/\/$/, '')}/events`, {
      routingKey: `inventory.notification.${type}`,
      payload,
    }, {
      timeout: 5000,
      headers: { 'Content-Type': 'application/json' },
    });
    return { ok: true };
  } catch (error: any) {
    return { ok: false, warning: error?.message || 'notification_failed' };
  }
}

export async function requireApprovalOrRespond(
  prisma: PrismaClient,
  req: Request,
  res: Response,
  action: InventoryActionContext,
): Promise<{ allowed: true; user: InventoryUserContext; evaluation: InventoryApprovalEvaluation; approvalRequestId?: string | null } | { allowed: false }> {
  const user = getCurrentInventoryUserContext(req);
  const evaluation = evaluateInventoryApprovalPolicy(user, action);
  if (!evaluation.actionAllowed) {
    await writeInventoryAuditLog(prisma, user, action, evaluation, null, { denied: true, reason: evaluation.reason });
    res.status(403).json({ approvalRequired: false, allowed: false, message: evaluation.reason, evaluation });
    return { allowed: false };
  }
  if (evaluation.approvalRequired && !(await hasApprovedInventoryRequest(prisma, (req.body as any)?.approvalRequestId, action.actionType, action))) {
    const approvalRequest = await createInventoryApprovalRequest(prisma, user, action, evaluation);
    const notify = await sendInventoryApprovalNotification('approval_requested', {
      approvalRequestId: approvalRequest.id,
      requestCode: approvalRequest.requestCode,
      approverRole: evaluation.approverRole,
      buildingCode: approvalRequest.approverBuildingCode || approvalRequest.buildingCode,
      approverBuildingCode: approvalRequest.approverBuildingCode,
      recipientType: 'ROLE_SCOPE',
      recipientRole: evaluation.approverRole,
      recipientBuildingCode: approvalRequest.approverBuildingCode || approvalRequest.buildingCode,
      requester: { userId: user.userId, name: user.displayName, role: user.role },
      actionType: action.actionType,
      entityLabel: action.entityLabel,
      amount: action.amount,
      quantity: action.quantity,
      message: `Approval requested for ${action.entityLabel || action.actionType}`,
    });
    if (!notify.ok) {
      await prisma.inventoryApprovalRequest.update({
        where: { id: approvalRequest.id },
        data: { notificationWarnings: { warning: notify.warning } },
      });
    }
    res.status(202).json({
      approvalRequired: true,
      approvalRequestId: approvalRequest.id,
      requestCode: approvalRequest.requestCode,
      approverRole: evaluation.approverRole,
      message: `Approval request sent to ${String(evaluation.approverRole).replace(/_/g, ' ')}.`,
      notificationWarning: notify.warning || null,
      evaluation,
    });
    return { allowed: false };
  }
  await writeInventoryAuditLog(prisma, user, action, evaluation, (req.body as any)?.approvalRequestId || null, {
    autoApproved: evaluation.autoApprove,
  });
  return { allowed: true, user, evaluation, approvalRequestId: (req.body as any)?.approvalRequestId || null };
}
