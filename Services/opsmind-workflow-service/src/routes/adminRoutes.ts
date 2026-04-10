import { Router, Request, Response } from 'express';
import { SupportGroupRepository } from '../repositories/SupportGroupRepository';
import { GroupMemberRepository } from '../repositories/GroupMemberRepository';
import { EscalationRuleRepository } from '../repositories/EscalationRuleRepository';
import { MemberRole, EscalationTrigger } from '../interfaces/types';

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
 */

const router = Router();
const groupRepo = new SupportGroupRepository();
const memberRepo = new GroupMemberRepository();
const ruleRepo = new EscalationRuleRepository();

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

export default router;
