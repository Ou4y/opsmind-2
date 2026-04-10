import { TicketRoutingStateRepository } from '../repositories/TicketRoutingStateRepository';
import { SupportGroupRepository } from '../repositories/SupportGroupRepository';
import { GroupMemberRepository } from '../repositories/GroupMemberRepository';
import { WorkflowLogRepository } from '../repositories/WorkflowLogRepository';
import { SlaTrackingRepository } from '../repositories/SlaTrackingRepository';

/**
 * Metrics & Reports Service
 *
 * Provides supervisor-level metrics, team performance, SLA reports,
 * and escalation statistics matching the frontend's expected response shapes.
 */
export class MetricsService {
  private routingRepo = new TicketRoutingStateRepository();
  private groupRepo = new SupportGroupRepository();
  private memberRepo = new GroupMemberRepository();
  private logRepo = new WorkflowLogRepository();
  private slaRepo = new SlaTrackingRepository();

  /**
   * GET /workflow/metrics — Comprehensive metrics for supervisor dashboard
   *
   * Frontend expects:
   * { total_tickets, resolved_tickets, avg_resolution_time, active_tickets,
   *   ticket_trend, by_priority, by_status, team_performance, top_performers,
   *   workload_balance, efficiency }
   */
  async getOverviewMetrics(startDate?: string, endDate?: string): Promise<any> {
    const counts = await this.routingRepo.getTicketCountsByStatus(startDate, endDate);
    const allTickets = await this.routingRepo.getAllTickets(startDate, endDate);

    const resolvedCount = await this.logRepo.getActionCount('RESOLVED', startDate, endDate);
    const escalatedCount = await this.logRepo.getActionCount('ESCALATED', startDate, endDate);

    // Calculate average resolution time from tickets that have claimed_at
    const resolvedTickets = allTickets.filter(t => t.claimed_at && t.status === 'ASSIGNED');
    let avgResolutionTime = 0;
    if (resolvedTickets.length > 0) {
      const totalMs = resolvedTickets.reduce((sum, t) => {
        return sum + (new Date(t.updated_at).getTime() - new Date(t.claimed_at!).getTime());
      }, 0);
      avgResolutionTime = Math.round(totalMs / resolvedTickets.length / 1000 / 60); // minutes
    }

    // Group performance
    const groups = await this.groupRepo.getAllGroups();
    const teamPerformance: any[] = [];
    const workloadBalance: any[] = [];

    for (const group of groups) {
      const groupTickets = await this.routingRepo.getGroupTickets(group.id);
      const members = await this.groupRepo.getGroupMembers(group.id);

      const assigned = groupTickets.filter(t => t.status === 'ASSIGNED').length;
      const unassigned = groupTickets.filter(t => t.status === 'UNASSIGNED').length;
      const escalated = groupTickets.filter(t => t.status === 'ESCALATED').length;

      teamPerformance.push({
        group_id: group.id,
        group_name: group.name,
        building: group.building,
        floor: group.floor,
        total_tickets: groupTickets.length,
        assigned,
        unassigned,
        escalated,
        member_count: members.length,
        escalation_rate: groupTickets.length > 0 ? (escalated / groupTickets.length) : 0,
      });

      // Per-member workload
      for (const member of members) {
        const memberTickets = await this.routingRepo.getMemberTickets(member.id);
        workloadBalance.push({
          member_id: member.id,
          user_id: member.user_id,
          group_id: group.id,
          group_name: group.name,
          role: member.role,
          assigned_tickets: memberTickets.length,
        });
      }
    }

    // Top performers (sorted by assigned ticket count desc)
    const topPerformers = [...workloadBalance]
      .sort((a, b) => b.assigned_tickets - a.assigned_tickets)
      .slice(0, 10);

    return {
      total_tickets: Number(counts.total) || 0,
      resolved_tickets: resolvedCount,
      avg_resolution_time: avgResolutionTime,
      active_tickets: (Number(counts.assigned) || 0) + (Number(counts.unassigned) || 0),
      escalated_tickets: Number(counts.escalated) || 0,
      ticket_trend: [],
      by_priority: {},
      by_status: {
        assigned: Number(counts.assigned) || 0,
        unassigned: Number(counts.unassigned) || 0,
        escalated: Number(counts.escalated) || 0,
      },
      team_performance: teamPerformance,
      top_performers: topPerformers,
      workload_balance: workloadBalance,
      efficiency: {
        avg_resolution_time: avgResolutionTime,
        escalation_rate: allTickets.length > 0
          ? (Number(counts.escalated) || 0) / allTickets.length
          : 0,
        first_response_time: 0,
      },
    };
  }

  /**
   * GET /workflow/metrics/team/:groupId — Team-specific metrics
   */
  async getTeamMetrics(groupId: number, startDate?: string, endDate?: string): Promise<any> {
    const group = await this.groupRepo.getGroupById(groupId);
    if (!group) throw new Error(`Group ${groupId} not found`);

    const tickets = await this.routingRepo.getGroupTickets(groupId);
    const members = await this.groupRepo.getGroupMembers(groupId);

    const assigned = tickets.filter(t => t.status === 'ASSIGNED').length;
    const unassigned = tickets.filter(t => t.status === 'UNASSIGNED').length;
    const escalated = tickets.filter(t => t.status === 'ESCALATED').length;

    // Per-member stats
    const memberStats: any[] = [];
    for (const member of members) {
      const memberTickets = await this.routingRepo.getMemberTickets(member.id);
      memberStats.push({
        member_id: member.id,
        user_id: member.user_id,
        role: member.role,
        assigned_tickets: memberTickets.length,
        status: member.status,
      });
    }

    return {
      group_id: group.id,
      group_name: group.name,
      building: group.building,
      floor: group.floor,
      total_tickets: tickets.length,
      assigned,
      unassigned,
      escalated,
      member_count: members.length,
      members: memberStats,
      escalation_rate: tickets.length > 0 ? escalated / tickets.length : 0,
    };
  }

  /**
   * GET /workflow/reports/sla — SLA compliance report
   */
  async getSLAReport(startDate?: string, endDate?: string): Promise<any> {
    const slaData = await this.slaRepo.getSLAReport(startDate, endDate);
    const totalTracked = await this.slaRepo.getTotalCount(startDate, endDate);
    const breachedCount = await this.slaRepo.getBreachedCount(startDate, endDate);

    return {
      total_tracked: totalTracked,
      breached: breachedCount,
      compliance_rate: totalTracked > 0 ? ((totalTracked - breachedCount) / totalTracked) * 100 : 100,
      by_priority: slaData.map((row: any) => ({
        priority: row.priority,
        total: Number(row.total_tickets),
        breached: Number(row.breached),
        on_track: Number(row.on_track),
        at_risk: Number(row.at_risk),
        avg_response_minutes: Math.round(Number(row.avg_response_minutes) || 0),
      })),
    };
  }

  /**
   * GET /workflow/reports/escalations — Escalation statistics report
   */
  async getEscalationReport(startDate?: string, endDate?: string): Promise<any> {
    const escalationStats = await this.logRepo.getEscalationStats(startDate, endDate);
    const totalEscalations = await this.logRepo.getActionCount('ESCALATED', startDate, endDate);

    // Enrich with group names
    const enrichedStats: any[] = [];
    for (const stat of escalationStats) {
      const fromGroup = stat.from_group_id ? await this.groupRepo.getGroupById(stat.from_group_id) : null;
      const toGroup = stat.to_group_id ? await this.groupRepo.getGroupById(stat.to_group_id) : null;

      enrichedStats.push({
        from_group_id: stat.from_group_id,
        from_group_name: fromGroup?.name ?? 'Unknown',
        to_group_id: stat.to_group_id,
        to_group_name: toGroup?.name ?? 'Unknown',
        count: Number(stat.count),
        first_escalation: stat.first_escalation,
        last_escalation: stat.last_escalation,
      });
    }

    return {
      total_escalations: totalEscalations,
      paths: enrichedStats,
    };
  }
}
