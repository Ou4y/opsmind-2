import {
  canUserDecideInventoryApproval,
  classifyMaintenanceApprovalAction,
  createInventoryApprovalRequest,
  evaluateInventoryApprovalPolicy,
  getCurrentInventoryUserContext,
  hasApprovedInventoryRequest,
  InventoryActionContext,
  InventoryUserContext,
  normalizeInventoryRole,
  requireApprovalOrRespond,
} from '../src/services/inventoryApprovalService';

function user(role: InventoryUserContext['role'], buildingCode = 'MAIN'): InventoryUserContext {
  return {
    userId: `${role.toLowerCase()}-test`,
    displayName: `${role} Test`,
    role,
    buildingCode,
    scopeType: role === 'ADMIN' || role === 'SUPERVISOR_CHIEF'
      ? 'GLOBAL'
      : buildingCode === 'CENTRAL_WAREHOUSE'
        ? 'WAREHOUSE'
        : 'BUILDING',
    reportsToUserId: null,
    authSource: 'headers',
  };
}

function action(overrides: Partial<InventoryActionContext>): InventoryActionContext {
  return {
    actionType: 'inventory.view',
    entityType: 'asset',
    entityId: 'UX-1',
    entityLabel: 'UX Test Asset',
    buildingCode: 'MAIN',
    ...overrides,
  };
}

describe('Inventory approval policy evaluator', () => {
  it('auto-approves routine junior QR work', () => {
    const result = evaluateInventoryApprovalPolicy(user('JUNIOR'), action({ actionType: 'asset.qr.scan' }));
    expect(result.actionAllowed).toBe(true);
    expect(result.approvalRequired).toBe(false);
    expect(result.riskLevel).toBe('L0_ROUTINE');
  });

  it('routes junior damage reports to a senior', () => {
    const result = evaluateInventoryApprovalPolicy(user('JUNIOR'), action({ actionType: 'asset.condition.report_damaged' }));
    expect(result.approvalRequired).toBe(true);
    expect(result.approverRole).toBe('SENIOR');
  });

  it('routes junior missing reports, repair requests, and audit discrepancies to senior', () => {
    for (const actionType of ['asset.condition.report_missing', 'asset.repair.request', 'audit.discrepancy.submit']) {
      const result = evaluateInventoryApprovalPolicy(user('JUNIOR'), action({ actionType }));
      expect(result.approvalRequired).toBe(true);
      expect(result.approverRole).toBe('SENIOR');
      expect(result.riskLevel).toBe('L1_OPERATIONAL');
    }
  });

  it('routes junior CMDB component edits, replacements, relationships, and custody assignment to senior', () => {
    for (const entityType of ['asset_component', 'asset_relationship', 'asset']) {
      const result = evaluateInventoryApprovalPolicy(user('JUNIOR'), action({
        actionType: 'asset.assignment.request',
        entityType,
      }));
      expect(result.approvalRequired).toBe(true);
      expect(result.approverRole).toBe('SENIOR');
      expect(result.riskLevel).toBe('L1_OPERATIONAL');
    }
  });

  it('routes junior component failure to senior and destructive component actions to admin', () => {
    const failed = evaluateInventoryApprovalPolicy(user('JUNIOR'), action({
      actionType: 'asset.condition.report_damaged',
      entityType: 'asset_component',
    }));
    expect(failed.approverRole).toBe('SENIOR');

    for (const role of ['JUNIOR', 'SENIOR', 'BUILDING_SUPERVISOR', 'SUPERVISOR_CHIEF'] as const) {
      const destructive = evaluateInventoryApprovalPolicy(user(role), action({
        actionType: 'asset.dispose.write_off',
        entityType: 'asset_component',
      }));
      expect(destructive.approvalRequired).toBe(true);
      expect(destructive.approverRole).toBe('ADMIN');
    }
  });

  it('routes exact browser corrective maintenance payload from junior to senior before save', () => {
    const browserPayload = {
      scope: 'Whole Asset',
      componentId: null,
      maintenanceType: 'corrective_maintenance',
      status: 'in_progress',
      cost: 0,
      performedBy: 'QA junior',
      date: '2026-06-15',
      notes: '',
    };
    const classification = classifyMaintenanceApprovalAction(browserPayload, 'JUNIOR');
    expect(classification.actionType).toBe('asset.repair.request');
    expect(classification.approvalReason).toBe('maintenance_controlled_keyword_signal');

    const result = evaluateInventoryApprovalPolicy(user('JUNIOR'), action({
      actionType: classification.actionType,
      entityType: 'asset_maintenance',
    }));
    expect(result.approvalRequired).toBe(true);
    expect(result.approverRole).toBe('SENIOR');
  });

  it('allows junior routine preventive completed maintenance to save directly', () => {
    const classification = classifyMaintenanceApprovalAction({
      maintenanceType: 'preventive_maintenance',
      status: 'completed',
      notes: 'routine check',
    }, 'JUNIOR');
    expect(classification.actionType).toBe('asset.maintenance.routine');

    const result = evaluateInventoryApprovalPolicy(user('JUNIOR'), action({
      actionType: classification.actionType,
      entityType: 'asset_maintenance',
    }));
    expect(result.approvalRequired).toBe(false);
    expect(result.autoApprove).toBe(true);
  });

  it('routes junior repair and controlled maintenance notes to senior', () => {
    const cases = [
      { maintenanceType: 'repair', status: 'in_progress', notes: '' },
      { maintenanceType: 'preventive_maintenance', status: 'completed', notes: 'Found damaged hinge' },
      { maintenanceType: 'preventive_maintenance', status: 'completed', notes: 'Asset missing from lab' },
    ];

    for (const payload of cases) {
      const classification = classifyMaintenanceApprovalAction(payload, 'JUNIOR');
      const result = evaluateInventoryApprovalPolicy(user('JUNIOR'), action({
        actionType: classification.actionType,
        entityType: 'asset_maintenance',
      }));
      expect(result.approvalRequired).toBe(true);
      expect(result.approverRole).toBe('SENIOR');
    }
  });

  it('returns approval-required response for exact junior corrective maintenance gate before persistence', async () => {
    const oldNotificationFlag = process.env.INVENTORY_APPROVAL_NOTIFICATION_ENABLED;
    process.env.INVENTORY_APPROVAL_NOTIFICATION_ENABLED = 'false';
    const prisma = {
      inventoryApprovalRequest: {
        create: jest.fn().mockResolvedValue({
          id: 'approval-1',
          requestCode: 'INV-APR-1',
          buildingCode: 'MAIN',
        }),
      },
      inventoryAuditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      assetMaintenanceRecord: {
        create: jest.fn(),
      },
    } as any;
    const req = {
      headers: {
        'x-user-id': 'qa-junior',
        'x-user-email': 'qa.junior@opsmind.local',
        'x-user-role': 'JUNIOR',
        'x-user-building': 'MAIN',
      },
      body: {
        scope: 'Whole Asset',
        componentId: null,
        maintenanceType: 'corrective_maintenance',
        status: 'in_progress',
        cost: 0,
        performedBy: 'QA junior',
        date: '2026-06-15',
        notes: '',
      },
    } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as any;
    const classification = classifyMaintenanceApprovalAction(req.body, 'JUNIOR');
    const gate = await requireApprovalOrRespond(prisma, req, res, {
      actionType: classification.actionType,
      entityType: 'asset_maintenance',
      entityId: 'UX-1',
      entityLabel: 'UX Test Asset',
      buildingCode: 'MAIN',
      amount: 0,
      quantity: 1,
      reason: req.body.maintenanceType,
      payloadJson: req.body,
    });

    expect(gate.allowed).toBe(false);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      approvalRequired: true,
      approverRole: 'SENIOR',
      approvalRequestId: 'approval-1',
    }));
    expect(prisma.inventoryApprovalRequest.create).toHaveBeenCalled();
    expect(prisma.assetMaintenanceRecord.create).not.toHaveBeenCalled();
    process.env.INVENTORY_APPROVAL_NOTIFICATION_ENABLED = oldNotificationFlag;
  });

  it('lets seniors complete minor operational work without disturbing supervisors', () => {
    const result = evaluateInventoryApprovalPolicy(user('SENIOR'), action({ actionType: 'asset.condition.report_damaged' }));
    expect(result.approvalRequired).toBe(false);
  });

  it('routes medium procurement to building supervisor', () => {
    const result = evaluateInventoryApprovalPolicy(user('SENIOR'), action({
      actionType: 'procurement.request.medium_value',
      amount: 2500,
    }));
    expect(result.approvalRequired).toBe(true);
    expect(result.approverRole).toBe('BUILDING_SUPERVISOR');
    expect(result.riskLevel).toBe('L2_CONTROLLED');
  });

  it('routes high-value procurement to supervisor chief', () => {
    const result = evaluateInventoryApprovalPolicy(user('BUILDING_SUPERVISOR'), action({
      actionType: 'procurement.request.high_value',
      amount: 12000,
    }));
    expect(result.approvalRequired).toBe(true);
    expect(result.approverRole).toBe('SUPERVISOR_CHIEF');
  });

  it('routes very high-value procurement to admin', () => {
    const result = evaluateInventoryApprovalPolicy(user('SUPERVISOR_CHIEF'), action({
      actionType: 'procurement.request.very_high_value',
      amount: 30000,
    }));
    expect(result.approvalRequired).toBe(true);
    expect(result.approverRole).toBe('ADMIN');
    expect(result.riskLevel).toBe('L4_SYSTEM_CRITICAL');
  });

  it.each([
    [1000, 'SENIOR', false, null],
    [1001, 'SENIOR', true, 'BUILDING_SUPERVISOR'],
    [5000, 'SENIOR', true, 'BUILDING_SUPERVISOR'],
    [5001, 'BUILDING_SUPERVISOR', true, 'SUPERVISOR_CHIEF'],
    [25000, 'BUILDING_SUPERVISOR', true, 'SUPERVISOR_CHIEF'],
    [25001, 'SUPERVISOR_CHIEF', true, 'ADMIN'],
  ] as const)('enforces procurement boundary EGP %s', (amount, role, approvalRequired, approverRole) => {
    const result = evaluateInventoryApprovalPolicy(user(role), action({
      actionType: amount > 25000
        ? 'procurement.request.very_high_value'
        : amount > 5000
          ? 'procurement.request.high_value'
          : 'procurement.request.medium_value',
      amount,
    }));
    expect(result.approvalRequired).toBe(approvalRequired);
    expect(result.approverRole || null).toBe(approverRole);
  });

  it('routes warehouse small dispatch from junior to Central Warehouse senior', () => {
    const result = evaluateInventoryApprovalPolicy(user('JUNIOR', 'CENTRAL_WAREHOUSE'), action({
      actionType: 'warehouse.dispatch.small',
      buildingCode: 'CENTRAL_WAREHOUSE',
      quantity: 4,
      amount: 600,
    }));
    expect(result.approvalRequired).toBe(true);
    expect(result.approverRole).toBe('SENIOR');
    expect(result.scopeType).toBe('WAREHOUSE');
  });

  it('routes warehouse large dispatch from senior to warehouse supervisor', () => {
    const result = evaluateInventoryApprovalPolicy(user('SENIOR', 'CENTRAL_WAREHOUSE'), action({
      actionType: 'warehouse.dispatch.large',
      buildingCode: 'CENTRAL_WAREHOUSE',
      quantity: 60,
      amount: 6000,
    }));
    expect(result.approvalRequired).toBe(true);
    expect(result.approverRole).toBe('BUILDING_SUPERVISOR');
    expect(result.riskLevel).toBe('L3_HIGH_IMPACT');
  });

  it('routes warehouse critical/high-value dispatch from warehouse supervisor to supervisor chief', () => {
    const result = evaluateInventoryApprovalPolicy(user('BUILDING_SUPERVISOR', 'CENTRAL_WAREHOUSE'), action({
      actionType: 'warehouse.dispatch.large',
      buildingCode: 'CENTRAL_WAREHOUSE',
      quantity: 20,
      amount: 12000,
      assetCriticality: 'network',
    }));
    expect(result.approvalRequired).toBe(true);
    expect(result.approverRole).toBe('SUPERVISOR_CHIEF');
  });

  it('routes warehouse receiving confirmation with inventory impact to warehouse supervisor', () => {
    const result = evaluateInventoryApprovalPolicy(user('SENIOR', 'CENTRAL_WAREHOUSE'), action({
      actionType: 'warehouse.receiving.confirm',
      buildingCode: 'CENTRAL_WAREHOUSE',
      quantity: 12,
      amount: 2400,
    }));
    expect(result.approvalRequired).toBe(true);
    expect(result.approverRole).toBe('BUILDING_SUPERVISOR');
    expect(result.riskLevel).toBe('L2_CONTROLLED');
  });

  it('routes junior or senior cross-building execution to supervisor chief without mutating first', () => {
    const result = evaluateInventoryApprovalPolicy(user('SENIOR', 'MAIN'), action({
      actionType: 'asset.cross_building_transfer',
      buildingCode: 'MAIN',
      targetBuildingCode: 'N',
    }));
    expect(result.actionAllowed).toBe(true);
    expect(result.approvalRequired).toBe(true);
    expect(result.approverRole).toBe('SUPERVISOR_CHIEF');
  });

  it('routes building supervisor cross-building transfer to supervisor chief', () => {
    const result = evaluateInventoryApprovalPolicy(user('BUILDING_SUPERVISOR', 'MAIN'), action({
      actionType: 'asset.cross_building_transfer',
      buildingCode: 'MAIN',
      targetBuildingCode: 'N',
    }));
    expect(result.actionAllowed).toBe(true);
    expect(result.approvalRequired).toBe(true);
    expect(result.approverRole).toBe('SUPERVISOR_CHIEF');
  });

  it('requires admin approval for permanent delete by supervisor chief', () => {
    const result = evaluateInventoryApprovalPolicy(user('SUPERVISOR_CHIEF'), action({ actionType: 'asset.delete.permanent' }));
    expect(result.approvalRequired).toBe(true);
    expect(result.approverRole).toBe('ADMIN');
  });

  it.each(['JUNIOR', 'SENIOR', 'BUILDING_SUPERVISOR', 'SUPERVISOR_CHIEF'] as const)(
    'requires admin approval for retire/write-off by %s',
    (role) => {
      const result = evaluateInventoryApprovalPolicy(user(role), action({ actionType: 'asset.dispose.write_off' }));
      expect(result.actionAllowed).toBe(true);
      expect(result.approvalRequired).toBe(true);
      expect(result.approverRole).toBe('ADMIN');
      expect(result.riskLevel).toBe('L4_SYSTEM_CRITICAL');
    },
  );

  it('allows admin permanent delete with audit-only result', () => {
    const result = evaluateInventoryApprovalPolicy(user('ADMIN'), action({ actionType: 'asset.delete.permanent' }));
    expect(result.actionAllowed).toBe(true);
    expect(result.approvalRequired).toBe(false);
    expect(result.autoApprove).toBe(true);
  });

  it('allows admin retire/write-off with audit-only result', () => {
    const result = evaluateInventoryApprovalPolicy(user('ADMIN'), action({ actionType: 'asset.dispose.write_off' }));
    expect(result.actionAllowed).toBe(true);
    expect(result.approvalRequired).toBe(false);
    expect(result.autoApprove).toBe(true);
  });

  it('does not elevate unknown roles to admin', () => {
    expect(normalizeInventoryRole('unknown-role')).toBe('JUNIOR');
    expect(normalizeInventoryRole(undefined)).toBe('JUNIOR');
  });

  it('resolves dynamic x-user headers instead of demo-admin fallback', () => {
    const req = {
      headers: {
        'x-user-id': 'qa-junior-id',
        'x-user-email': 'qa.junior@opsmind.local',
        'x-user-role': 'JUNIOR',
        'x-user-building': 'MAIN',
        'x-user-name': 'QA Junior',
      },
    } as any;
    const context = getCurrentInventoryUserContext(req);
    expect(context.userId).toBe('qa-junior-id');
    expect(context.role).toBe('JUNIOR');
    expect(context.buildingCode).toBe('MAIN');
    expect(context.authSource).toBe('headers');
  });

  it('uses demo-admin fallback only when no auth context exists', () => {
    const context = getCurrentInventoryUserContext({ headers: {} } as any);
    expect(context.userId).toBe('demo-admin');
    expect(context.role).toBe('ADMIN');
    expect(context.authSource).toBe('demo_fallback');
  });

  it('blocks wrong-role approval and requester self-approval', () => {
    const approval = {
      requestedByUserId: 'junior-test',
      approverRole: 'SENIOR',
      approverBuildingCode: 'MAIN',
    };
    expect(canUserDecideInventoryApproval(user('JUNIOR'), approval).allowed).toBe(false);
    expect(canUserDecideInventoryApproval({ ...user('SENIOR'), userId: 'junior-test' }, approval).allowed).toBe(false);
    expect(canUserDecideInventoryApproval(user('SENIOR'), approval).allowed).toBe(true);
  });

  it('blocks cross-building approver when approval is building scoped', () => {
    const approval = {
      requestedByUserId: 'junior-test',
      approverRole: 'SENIOR',
      approverBuildingCode: 'MAIN',
    };
    expect(canUserDecideInventoryApproval(user('SENIOR', 'N'), approval).allowed).toBe(false);
  });

  it('keeps approver scope on a known building when asset location is a room label', async () => {
    const prisma = {
      inventoryApprovalRequest: {
        create: jest.fn().mockResolvedValue({
          id: 'approval-room',
          requestCode: 'INV-APR-ROOM',
          buildingCode: 'MAIN',
          approverBuildingCode: 'MAIN',
        }),
      },
      inventoryAuditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const actor = user('JUNIOR', 'MAIN');
    await createInventoryApprovalRequest(prisma, actor, action({
      actionType: 'asset.repair.request',
      entityType: 'asset_maintenance',
      buildingCode: 'Room 101',
    }), {
      actionAllowed: true,
      autoApprove: false,
      approvalRequired: true,
      notifyOnly: false,
      riskLevel: 'L1_OPERATIONAL',
      scopeType: 'BUILDING',
      approverRole: 'SENIOR',
      requiresDualApproval: false,
      reason: 'Approval required from SENIOR.',
      policyKey: 'test',
    });
    expect(prisma.inventoryApprovalRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        buildingCode: 'MAIN',
        approverBuildingCode: 'MAIN',
      }),
    }));
  });

  it('allows role-scoped approval visibility when approver building is null', () => {
    const approval = {
      requestedByUserId: 'junior-test',
      approverRole: 'SENIOR',
      approverBuildingCode: null,
    };
    expect(canUserDecideInventoryApproval(user('SENIOR', 'MAIN'), approval).allowed).toBe(true);
  });

  it('only accepts explicit approved retry when approvalRequestId matches the action type', async () => {
    const prisma = {
      inventoryApprovalRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'apr-1',
          actionType: 'procurement.request.high_value',
          entityType: 'procurement_request',
          entityId: 'PR-1',
          status: 'APPROVED',
        }),
      },
    } as any;

    await expect(hasApprovedInventoryRequest(prisma, 'apr-1', 'procurement.request.high_value')).resolves.toBe(true);
    await expect(hasApprovedInventoryRequest(prisma, 'apr-1', 'procurement.request.high_value', {
      entityType: 'procurement_request',
      entityId: 'PR-1',
    })).resolves.toBe(true);
    await expect(hasApprovedInventoryRequest(prisma, 'apr-1', 'procurement.request.high_value', {
      entityType: 'procurement_request',
      entityId: 'PR-2',
    })).resolves.toBe(false);
    await expect(hasApprovedInventoryRequest(prisma, 'apr-1', 'asset.delete.permanent')).resolves.toBe(false);
    await expect(hasApprovedInventoryRequest(prisma, '', 'procurement.request.high_value')).resolves.toBe(false);
  });
});
