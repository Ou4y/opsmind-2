import { TicketRoutingStateRepository } from '../repositories/TicketRoutingStateRepository';
import { SupportGroupRepository } from '../repositories/SupportGroupRepository';
import { GroupMemberRepository } from '../repositories/GroupMemberRepository';
import {
  BuildingDashboard,
  BuildingGroupSummary,
  MemberDashboard,
  GroupMetrics,
  TicketRoutingStateRow,
} from '../interfaces/types';

/**
 * Dashboard Service (TypeScript)
 *
 * Monitoring & analytics for Building / Supervisor / Global views.
 */
export class DashboardService {
  private routingRepo = new TicketRoutingStateRepository();
  private groupRepo = new SupportGroupRepository();
  private memberRepo = new GroupMemberRepository();

  async getBuildingDashboard(building: string): Promise<BuildingDashboard> {
    const groups = await this.groupRepo.getGroupsByBuilding(building);

    const dashboard: BuildingDashboard = {
      building,
      groups: [],
      totalTickets: 0,
      unassignedTickets: 0,
      escalatedTickets: 0,
    };

    for (const group of groups) {
      const members = await this.groupRepo.getGroupMembers(group.id);
      const tickets = await this.routingRepo.getGroupTickets(group.id);

      const assigned = tickets.filter((t) => t.status === 'ASSIGNED').length;
      const unassigned = tickets.filter((t) => t.status === 'UNASSIGNED').length;
      const escalated = tickets.filter((t) => t.status === 'ESCALATED').length;

      const groupSummary: BuildingGroupSummary = {
        groupId: group.id,
        groupName: group.name,
        floor: group.floor,
        members: members.map((m) => ({
          id: m.id,
          user_id: m.user_id,
          role: m.role,
          status: m.status,
        })),
        tickets: { total: tickets.length, assigned, unassigned, escalated },
      };

      dashboard.groups.push(groupSummary);
      dashboard.totalTickets += tickets.length;
      dashboard.unassignedTickets += unassigned;
      dashboard.escalatedTickets += escalated;
    }

    return dashboard;
  }

  async getMemberDashboard(memberId: number): Promise<MemberDashboard> {
    const member = await this.memberRepo.getMemberById(memberId);
    if (!member) throw new Error(`Member ${memberId} not found`);

    const tickets = await this.routingRepo.getMemberTickets(memberId);

    return {
      memberId,
      memberRole: member.role,
      groupId: member.group_id,
      assignedTickets: tickets.length,
      escalationCount: 0,
      joinedAt: member.joined_at,
      status: member.status,
      permissions: {
        canAssign: !!member.can_assign,
        canEscalate: !!member.can_escalate,
      },
    };
  }

  async getGroupMetrics(groupId: number): Promise<GroupMetrics> {
    const group = await this.groupRepo.getGroupById(groupId);
    if (!group) throw new Error(`Group ${groupId} not found`);

    const members = await this.groupRepo.getGroupMembers(groupId);
    const tickets = await this.routingRepo.getGroupTickets(groupId);

    const assigned = tickets.filter((t) => t.status === 'ASSIGNED').length;
    const unassigned = tickets.filter((t) => t.status === 'UNASSIGNED').length;
    const escalated = tickets.filter((t) => t.status === 'ESCALATED').length;

    return {
      groupId,
      groupName: group.name,
      building: group.building,
      floor: group.floor,
      members: members.length,
      tickets: { total: tickets.length, assigned, unassigned, escalated },
      metrics: {
        averageResolutionTime: this.calculateAverageResolution(tickets),
        escalationRate: tickets.length > 0 ? escalated / tickets.length : 0,
      },
    };
  }

  private calculateAverageResolution(tickets: TicketRoutingStateRow[]): number {
    const resolved = tickets.filter((t) => t.claimed_at && t.updated_at);
    if (resolved.length === 0) return 0;

    const totalMs = resolved.reduce((sum, t) => {
      return sum + (new Date(t.updated_at).getTime() - new Date(t.claimed_at!).getTime());
    }, 0);

    return Math.round(totalMs / resolved.length / 1000 / 60); // minutes
  }
}
