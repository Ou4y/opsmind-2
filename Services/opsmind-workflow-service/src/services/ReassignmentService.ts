import { TicketRoutingStateRepository } from '../repositories/TicketRoutingStateRepository';
import { SupportGroupRepository } from '../repositories/SupportGroupRepository';
import { GroupMemberRepository } from '../repositories/GroupMemberRepository';
import { WorkflowLogRepository } from '../repositories/WorkflowLogRepository';
import { ReassignTicketResponse, UserRole, GroupMemberRow } from '../interfaces/types';

/**
 * Reassignment Service (TypeScript)
 *
 * Authority Levels:
 *  JUNIOR     → Cannot reassign
 *  SENIOR     → Within same building
 *  SUPERVISOR → Across buildings
 */
export class ReassignmentService {
  private routingRepo = new TicketRoutingStateRepository();
  private groupRepo = new SupportGroupRepository();
  private memberRepo = new GroupMemberRepository();
  private logRepo = new WorkflowLogRepository();

  async reassignTicket(
    ticketId: string,
    fromUserId: number,
    toMemberId: number,
    userRole: UserRole,
    _userBuildingOrId?: string,
  ): Promise<ReassignTicketResponse> {
    const routingState = await this.routingRepo.getByTicketId(ticketId);
    if (!routingState) throw new Error(`Ticket ${ticketId} not found`);

    const currentGroup = await this.groupRepo.getGroupById(routingState.current_group_id);
    if (!currentGroup) throw new Error('Current group not found');

    const targetMember = await this.memberRepo.getMemberById(toMemberId);
    if (!targetMember) throw new Error(`Target member ${toMemberId} not found`);

    const targetGroup = await this.groupRepo.getGroupById(targetMember.group_id);
    if (!targetGroup) throw new Error('Target group not found');

    // ── Authority check ──
    if (userRole === 'SENIOR') {
      if (currentGroup.building !== targetGroup.building) {
        throw new Error(
          `Senior can only reassign within same building. Current: ${currentGroup.building}, Target: ${targetGroup.building}`,
        );
      }
    } else if (userRole !== 'SUPERVISOR' && userRole !== 'HEAD_OF_IT') {
      throw new Error(`User role '${userRole}' does not have reassignment permission`);
    }

    // ── Update routing ──
    await this.routingRepo.reassignTicket(ticketId, toMemberId, targetGroup.id);

    // ── Notify Ticket Service ──
    // Ticket service only knows OPEN|IN_PROGRESS|RESOLVED|CLOSED.
    // On reassignment we keep IN_PROGRESS and update the assignee.
    try {
      const { assignTicket: assignTicketFn, toSupportLevel } = await import('../config/externalServices');
      await assignTicketFn(
        ticketId,
        targetMember.user_id,
        toSupportLevel(targetMember.role),
        'IN_PROGRESS',
      );
    } catch (err: any) {
      console.error('Ticket Service PATCH failed on reassignment:', err.response?.data || err.message);
    }

    // ── Audit log ──
    await this.logRepo.logAction(ticketId, 'REASSIGNED', {
      from_group_id: routingState.current_group_id,
      to_group_id: targetGroup.id,
      to_member_id: toMemberId,
      performed_by: fromUserId,
      reason: `Reassigned by ${userRole} from ${currentGroup.name} to ${targetGroup.name}`,
    });

    return {
      success: true,
      ticketId,
      fromGroup: currentGroup.name,
      toGroup: targetGroup.name,
      toMember: toMemberId,
      performedBy: fromUserId,
      message: `Ticket reassigned to member ${toMemberId} in group ${targetGroup.name}`,
    };
  }

  async getAvailableTargets(
    currentGroupId: number,
    userRole: UserRole,
    _userBuilding?: string,
  ): Promise<GroupMemberRow[]> {
    if (userRole === 'SENIOR') {
      const currentGroup = await this.groupRepo.getGroupById(currentGroupId);
      if (!currentGroup) return [];

      const buildingGroups = await this.groupRepo.getGroupsByBuilding(currentGroup.building);
      const allTargets: GroupMemberRow[] = [];

      for (const group of buildingGroups) {
        const members = await this.groupRepo.getGroupMembers(group.id);
        allTargets.push(...members.filter((m) => m.role === 'JUNIOR'));
      }
      return allTargets;
    }

    // SUPERVISOR can see all (not scoped in this sample)
    return [];
  }
}
