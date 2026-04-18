import { Router, Request, Response } from 'express';
import { SupportGroupRepository } from '../repositories/SupportGroupRepository';
import { GroupMemberRepository } from '../repositories/GroupMemberRepository';
import { EscalationRuleRepository } from '../repositories/EscalationRuleRepository';
import { HierarchyController } from '../controllers/HierarchyController';
import { MemberRole, EscalationTrigger } from '../interfaces/types';
import {
  validateBody,
  createRelationshipSchema,
  deleteRelationshipSchema,
  syncTechnicianFromAuthSchema,
} from '../middlewares/validation';

/**
 * Admin Routes
 *
 * Mounted at /workflow/admin in app.ts
 * Frontend calls:
 *   GET    /workflow/admin/support-groups
 *   POST   /workflow/admin/support-groups
 *   PUT    /workflow/admin/support-groups/:groupId
 *   DELETE /workflow/admin/support-groups/:groupId
 *   GET    /workflow/admin/support-groups/:groupId/members
 *   POST   /workflow/admin/support-groups/:groupId/members
 *   DELETE /workflow/admin/support-groups/:groupId/members/:memberId
 *   
 *   Hierarchy Management:
 *   GET    /workflow/admin/hierarchy/technicians
 *   POST   /workflow/admin/hierarchy/relationships
 *   PUT    /workflow/admin/hierarchy/relationships
 *   DELETE /workflow/admin/hierarchy/relationships
 *   GET    /workflow/admin/hierarchy/tree
 *   GET    /workflow/admin/hierarchy/user/:userId/reports
 *   GET    /workflow/admin/hierarchy/user/:userId/manager
 */

const router = Router();
const groupRepo = new SupportGroupRepository();
const memberRepo = new GroupMemberRepository();
const ruleRepo = new EscalationRuleRepository();
const hierarchyController = new HierarchyController();

// ══════════════════════════════════════
//  Support Groups CRUD
// ══════════════════════════════════════

/** GET /workflow/admin/support-groups — List all groups with member_count */
router.get('/support-groups', async (_req: Request, res: Response): Promise<void> => {
  try {
    const groups = await groupRepo.getAllGroupsWithMemberCount();
    res.status(200).json({ success: true, data: groups });
  } catch (error: any) {
    console.error('Error fetching support groups:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/** POST /workflow/admin/support-groups — Create a new group */
router.post('/support-groups', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, building, floor, parentGroupId } = req.body;
    if (!name || !building || floor === undefined) {
      res.status(400).json({ success: false, message: 'Missing required fields: name, building, floor' });
      return;
    }
    const group = await groupRepo.createGroup(name, building, floor, parentGroupId ?? null);
    res.status(201).json({ success: true, data: group });
  } catch (error: any) {
    console.error('Error creating support group:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

/** PUT /workflow/admin/support-groups/:groupId — Update a group */
router.put('/support-groups/:groupId', async (req: Request, res: Response): Promise<void> => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    const existing = await groupRepo.getGroupById(groupId);
    if (!existing) {
      res.status(404).json({ success: false, message: 'Group not found' });
      return;
    }
    await groupRepo.updateGroup(groupId, req.body);
    const updated = await groupRepo.getGroupById(groupId);
    res.status(200).json({ success: true, data: updated });
  } catch (error: any) {
    console.error('Error updating support group:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

/** DELETE /workflow/admin/support-groups/:groupId — Soft-delete a group */
router.delete('/support-groups/:groupId', async (req: Request, res: Response): Promise<void> => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    const existing = await groupRepo.getGroupById(groupId);
    if (!existing) {
      res.status(404).json({ success: false, message: 'Group not found' });
      return;
    }
    await groupRepo.deleteGroup(groupId);
    res.status(200).json({ success: true, message: 'Group deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting support group:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// ══════════════════════════════════════
//  Group Members
// ══════════════════════════════════════

/** GET /workflow/admin/support-groups/:groupId/members — List group members */
router.get('/support-groups/:groupId/members', async (req: Request, res: Response): Promise<void> => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    const members = await memberRepo.getGroupMembersWithInfo(groupId);
    res.status(200).json({ success: true, data: members });
  } catch (error: any) {
    console.error('Error fetching group members:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/** POST /workflow/admin/support-groups/:groupId/members — Add a member to group */
router.post('/support-groups/:groupId/members', async (req: Request, res: Response): Promise<void> => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    const { userId, role, canAssign, canEscalate } = req.body;
    if (!userId || !role) {
      res.status(400).json({ success: false, message: 'Missing required fields: userId, role' });
      return;
    }
    const member = await memberRepo.addMember(
      userId,
      groupId,
      role as MemberRole,
      canAssign ?? false,
      canEscalate ?? false,
    );
    res.status(201).json({ success: true, data: member });
  } catch (error: any) {
    console.error('Error adding group member:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

/** DELETE /workflow/admin/support-groups/:groupId/members/:memberId — Remove a member */
router.delete('/support-groups/:groupId/members/:memberId', async (req: Request, res: Response): Promise<void> => {
  try {
    const memberId = parseInt(req.params.memberId, 10);
    const member = await memberRepo.getMemberById(memberId);
    if (!member) {
      res.status(404).json({ success: false, message: 'Member not found' });
      return;
    }
    await memberRepo.removeMember(memberId);
    res.status(200).json({ success: true, message: 'Member removed successfully' });
  } catch (error: any) {
    console.error('Error removing group member:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// ══════════════════════════════════════
//  Escalation Rules (kept for admin use)
// ══════════════════════════════════════

router.post('/escalation-rules', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sourceGroupId, targetGroupId, triggerType, delayMinutes, priority } = req.body;
    if (!sourceGroupId || !targetGroupId || !triggerType) {
      res.status(400).json({ success: false, message: 'Missing: sourceGroupId, targetGroupId, triggerType' });
      return;
    }
    const rule = await ruleRepo.createRule(
      sourceGroupId,
      targetGroupId,
      triggerType as EscalationTrigger,
      delayMinutes ?? 0,
      priority ?? 0,
    );
    res.status(201).json({ success: true, data: rule });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/escalation-rules', async (_req: Request, res: Response): Promise<void> => {
  try {
    const rules = await ruleRepo.getAllRules();
    res.status(200).json({ success: true, data: rules });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ══════════════════════════════════════
//  Legacy admin endpoints (backward compat)
// ══════════════════════════════════════

router.get('/groups/building/:building', async (req: Request, res: Response): Promise<void> => {
  try {
    const groups = await groupRepo.getGroupsByBuilding(req.params.building);
    res.status(200).json({ success: true, data: groups });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/groups/:groupId', async (req: Request, res: Response): Promise<void> => {
  try {
    const group = await groupRepo.getGroupById(parseInt(req.params.groupId, 10));
    if (!group) { res.status(404).json({ success: false, message: 'Group not found' }); return; }
    res.status(200).json({ success: true, data: group });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ══════════════════════════════════════
//  Hierarchy Management
// ══════════════════════════════════════

/**
 * POST /workflow/admin/hierarchy/technicians/sync
 * Sync auth identity (UUID + auth role) into workflow technician model
 */
router.post(
  '/hierarchy/technicians/sync',
  validateBody(syncTechnicianFromAuthSchema),
  (req: Request, res: Response) => {
    hierarchyController.syncTechnicianFromAuth(req, res);
  }
);

/**
 * GET /workflow/admin/hierarchy/technicians
 * List all technicians, optionally filtered by level
 * Query: ?level=JUNIOR|SENIOR|SUPERVISOR|ADMIN
 */
router.get('/hierarchy/technicians', (req: Request, res: Response) => {
  hierarchyController.listTechnicians(req, res);
});

/**
 * POST /workflow/admin/hierarchy/relationships
 * Create a new reporting relationship
 * Body: { childUserId, parentUserId, relationshipType }
 */
router.post(
  '/hierarchy/relationships',
  validateBody(createRelationshipSchema),
  (req: Request, res: Response) => {
    hierarchyController.createRelationship(req, res);
  }
);

/**
 * PUT /workflow/admin/hierarchy/relationships
 * Update an existing reporting relationship
 * Body: { childUserId, parentUserId, relationshipType }
 */
router.put(
  '/hierarchy/relationships',
  validateBody(createRelationshipSchema),
  (req: Request, res: Response) => {
    hierarchyController.updateRelationship(req, res);
  }
);

/**
 * DELETE /workflow/admin/hierarchy/relationships
 * Remove a reporting relationship
 * Body: { childUserId, parentUserId }
 */
router.delete(
  '/hierarchy/relationships',
  validateBody(deleteRelationshipSchema),
  (req: Request, res: Response) => {
    hierarchyController.deleteRelationship(req, res);
  }
);

/**
 * GET /workflow/admin/hierarchy/tree
 * Get the full hierarchy tree structure
 */
router.get('/hierarchy/tree', (req: Request, res: Response) => {
  hierarchyController.getHierarchyTree(req, res);
});

/**
 * GET /workflow/admin/hierarchy/user/:userId/reports
 * Get direct reports for a specific user
 */
router.get('/hierarchy/user/:userId/reports', (req: Request, res: Response) => {
  hierarchyController.getDirectReports(req, res);
});

/**
 * GET /workflow/admin/hierarchy/user/:userId/manager
 * Get the direct manager for a specific user
 */
router.get('/hierarchy/user/:userId/manager', (req: Request, res: Response) => {
  hierarchyController.getManager(req, res);
});

export default router;
