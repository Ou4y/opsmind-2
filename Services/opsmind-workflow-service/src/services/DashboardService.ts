import { TicketRoutingStateRepository } from '../repositories/TicketRoutingStateRepository';
import { SupportGroupRepository } from '../repositories/SupportGroupRepository';
import { GroupMemberRepository } from '../repositories/GroupMemberRepository';
import { TechnicianRepository } from '../repositories/TechnicianRepository';
import { ReportingRelationshipRepository } from '../repositories/ReportingRelationshipRepository';
import { getTicketsByAssignedUsers } from '../config/externalServices';
import {
  BuildingDashboard,
  BuildingGroupSummary,
  MemberDashboard,
  GroupMetrics,
  TicketRoutingStateRow,
  SeniorDashboard,
  SupervisorDashboard,
  JuniorSummary,
  TicketSummary,
  WorkloadSummary,
  TeamStructure,
  SeniorTeamMember,
  JuniorTeamMember,
  TeamMetrics,
} from '../interfaces/types';

/**
 * Dashboard Service (TypeScript)
 *
 * Monitoring & analytics for Building / Supervisor / Senior / Global views.
 * Updated: Added hierarchy-based dashboards for SENIOR and SUPERVISOR roles.
 */
export class DashboardService {
  private routingRepo = new TicketRoutingStateRepository();
  private groupRepo = new SupportGroupRepository();
  private memberRepo = new GroupMemberRepository();
  private techRepo = new TechnicianRepository();
  private relationshipRepo = new ReportingRelationshipRepository();

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

  /**
   * Get SENIOR dashboard
   * Shows only the juniors assigned to this senior and their tickets
   * 
   * @param seniorUserId - The user_id of the senior (from auth service)
   * @returns SeniorDashboard with juniors, tickets, and workload
   */
  async getSeniorDashboard(seniorUserId: number): Promise<SeniorDashboard> {
    // 1. Validate senior exists
    const senior = await this.techRepo.getByUserId(seniorUserId);
    if (!senior) {
      throw new Error(`Senior user ${seniorUserId} not found`);
    }

    if (senior.level !== 'SENIOR') {
      throw new Error(`User ${seniorUserId} is not a SENIOR (level: ${senior.level})`);
    }

    // 2. Get all juniors reporting to this senior
    const juniorUserIds = await this.relationshipRepo.getJuniorsForSenior(seniorUserId);
    const juniors = await this.techRepo.getByUserIds(juniorUserIds);

    // 3. Get all tickets assigned to these juniors
    const tickets = await getTicketsByAssignedUsers(juniorUserIds);

    // 4. Build junior summaries with ticket counts
    const juniorSummaries: JuniorSummary[] = juniors.map((junior) => {
      const assignedTickets = tickets.filter(
        (t) => String(t.assigned_to) === String(junior.user_id),
      ).length;

      return {
        userId: junior.user_id,
        name: junior.name,
        email: junior.email,
        status: junior.status,
        location: {
          latitude: junior.latitude,
          longitude: junior.longitude,
        },
        assignedTickets,
      };
    });

    // 5. Build ticket summaries
    const ticketSummaries: TicketSummary[] = tickets.map((ticket) => {
      const assignedJunior = juniors.find(
        (j) => String(j.user_id) === String(ticket.assigned_to),
      );

      const summary: TicketSummary = {
        ticketId: String(ticket.id),
        assignedTo: ticket.assigned_to ? Number(ticket.assigned_to) : null,
        assignedToName: assignedJunior?.name || null,
        status: ticket.status || 'UNKNOWN',
        priority: ticket.priority || null,
        createdAt: ticket.created_at ? new Date(ticket.created_at) : new Date(),
      };

      // Add location if available
      if (ticket.latitude != null && ticket.longitude != null) {
        summary.location = {
          latitude: ticket.latitude,
          longitude: ticket.longitude,
        };
      }

      return summary;
    });

    // 6. Calculate workload summary
    const workload: WorkloadSummary = {
      totalTickets: tickets.length,
      byStatus: this.groupBy(tickets, 'status'),
      byPriority: this.groupBy(tickets, 'priority'),
      byJunior: this.groupByAssigned(tickets),
    };

    return {
      seniorUserId: senior.user_id,
      seniorName: senior.name,
      juniors: juniorSummaries,
      tickets: ticketSummaries,
      workload,
    };
  }

  /**
   * Get SUPERVISOR dashboard
   * Shows seniors under this supervisor, their juniors, and all tickets
   * 
   * @param supervisorUserId - The user_id of the supervisor (from auth service)
   * @returns SupervisorDashboard with team structure, tickets, and metrics
   */
  async getSupervisorDashboard(supervisorUserId: number): Promise<SupervisorDashboard> {
    // 1. Validate supervisor exists
    const supervisor = await this.techRepo.getByUserId(supervisorUserId);
    if (!supervisor) {
      throw new Error(`Supervisor user ${supervisorUserId} not found`);
    }

    if (supervisor.level !== 'SUPERVISOR') {
      throw new Error(`User ${supervisorUserId} is not a SUPERVISOR (level: ${supervisor.level})`);
    }

    // 2. Get all seniors reporting to this supervisor
    const seniorUserIds = await this.relationshipRepo.getSeniorsForSupervisor(supervisorUserId);
    const seniors = await this.techRepo.getByUserIds(seniorUserIds);

    // 3. Get all juniors under these seniors
    const allJuniorUserIds: number[] = [];
    const juniorsBySenior: Record<number, number[]> = {};

    for (const seniorUserId of seniorUserIds) {
      const juniorIds = await this.relationshipRepo.getJuniorsForSenior(seniorUserId);
      juniorsBySenior[seniorUserId] = juniorIds;
      allJuniorUserIds.push(...juniorIds);
    }

    const juniors = await this.techRepo.getByUserIds(allJuniorUserIds);

    // 4. Get all tickets for all juniors
    const tickets = await getTicketsByAssignedUsers(allJuniorUserIds);

    // 5. Build senior team members with ticket counts
    const seniorTeamMembers: SeniorTeamMember[] = seniors.map((senior) => {
      const seniorJuniorIds = juniorsBySenior[senior.user_id] || [];
      const seniorTickets = tickets.filter((t) =>
        seniorJuniorIds.includes(Number(t.assigned_to)),
      );

      return {
        userId: senior.user_id,
        name: senior.name,
        email: senior.email,
        status: senior.status,
        juniorCount: seniorJuniorIds.length,
        assignedTickets: seniorTickets.length,
      };
    });

    // 6. Build junior team members with senior info
    const juniorTeamMembers: JuniorTeamMember[] = juniors.map((junior) => {
      // Find which senior this junior reports to
      let seniorUserId = 0;
      let seniorName = 'Unknown';

      for (const [sId, jIds] of Object.entries(juniorsBySenior)) {
        if (jIds.includes(junior.user_id)) {
          seniorUserId = Number(sId);
          const seniorInfo = seniors.find((s) => s.user_id === seniorUserId);
          seniorName = seniorInfo?.name || 'Unknown';
          break;
        }
      }

      const assignedTickets = tickets.filter(
        (t) => String(t.assigned_to) === String(junior.user_id),
      ).length;

      return {
        userId: junior.user_id,
        name: junior.name,
        email: junior.email,
        status: junior.status,
        seniorUserId,
        seniorName,
        assignedTickets,
      };
    });

    // 7. Build ticket summaries
    const ticketSummaries: TicketSummary[] = tickets.map((ticket) => {
      const assignedJunior = juniors.find(
        (j) => String(j.user_id) === String(ticket.assigned_to),
      );

      const summary: TicketSummary = {
        ticketId: String(ticket.id),
        assignedTo: ticket.assigned_to ? Number(ticket.assigned_to) : null,
        assignedToName: assignedJunior?.name || null,
        status: ticket.status || 'UNKNOWN',
        priority: ticket.priority || null,
        createdAt: ticket.created_at ? new Date(ticket.created_at) : new Date(),
      };

      // Add location if available
      if (ticket.latitude != null && ticket.longitude != null) {
        summary.location = {
          latitude: ticket.latitude,
          longitude: ticket.longitude,
        };
      }

      return summary;
    });

    // 8. Calculate workload summary
    const workload: WorkloadSummary = {
      totalTickets: tickets.length,
      byStatus: this.groupBy(tickets, 'status'),
      byPriority: this.groupBy(tickets, 'priority'),
      byJunior: this.groupByAssigned(tickets),
    };

    // 9. Calculate team metrics
    const totalJuniors = juniors.length;
    const totalSeniors = seniors.length;
    const avgTicketsPerJunior = totalJuniors > 0 ? tickets.length / totalJuniors : 0;
    const avgJuniorsPerSenior = totalSeniors > 0 ? totalJuniors / totalSeniors : 0;

    const metrics: TeamMetrics = {
      totalTechnicians: totalSeniors + totalJuniors,
      totalSeniors,
      totalJuniors,
      averageTicketsPerJunior: Math.round(avgTicketsPerJunior * 10) / 10,
      averageJuniorsPerSenior: Math.round(avgJuniorsPerSenior * 10) / 10,
    };

    return {
      supervisorUserId: supervisor.user_id,
      supervisorName: supervisor.name,
      teamStructure: {
        seniors: seniorTeamMembers,
        juniors: juniorTeamMembers,
      },
      tickets: ticketSummaries,
      workload,
      metrics,
    };
  }

  /**
   * Helper: Group tickets by a field (status, priority)
   */
  private groupBy(tickets: any[], field: string): Record<string, number> {
    const grouped: Record<string, number> = {};
    tickets.forEach((ticket) => {
      const key = ticket[field] || 'UNKNOWN';
      grouped[key] = (grouped[key] || 0) + 1;
    });
    return grouped;
  }

  /**
   * Helper: Group tickets by assigned user
   */
  private groupByAssigned(tickets: any[]): Record<number, number> {
    const grouped: Record<number, number> = {};
    tickets.forEach((ticket) => {
      if (ticket.assigned_to) {
        const userId = Number(ticket.assigned_to);
        grouped[userId] = (grouped[userId] || 0) + 1;
      }
    });
    return grouped;
  }
}
