import { TicketRoutingStateRepository } from '../repositories/TicketRoutingStateRepository';
import { SupportGroupRepository } from '../repositories/SupportGroupRepository';
import { WorkflowLogRepository } from '../repositories/WorkflowLogRepository';
import { EscalationRuleRepository } from '../repositories/EscalationRuleRepository';
import {
  EscalateTicketResponse,
  EscalationTrigger,
  UserRole,
  WorkflowLogRow,
  EscalationRuleRow,
} from '../interfaces/types';
import { ticketServiceClient, toSupportLevel, escalateTicketInService } from '../config/externalServices';
import { query } from '../config/database';
import { RowDataPacket } from 'mysql2/promise';

/**
 * Escalation Service (TypeScript)
 *
 * Two-tier escalation chain:
 *   Tier 1: Floor Room → Building Senior   (SLA / MANUAL / CRITICAL / REOPEN_COUNT)
 *   Tier 2: Building Senior → UNIVERSITY-SUPERVISOR
 *
 * On each escalation the service:
 *  1. Finds the escalation rule for the current group
 *  2. Selects the least-loaded SENIOR (or SUPERVISOR) in the target group
 *  3. PATCHes the ticket service with assigned_to + assigned_to_level
 *  4. Updates routing state
 *  5. Logs the ESCALATED action
 */
export class EscalationService {
  private routingRepo = new TicketRoutingStateRepository();
  private groupRepo = new SupportGroupRepository();
  private logRepo = new WorkflowLogRepository();
  private ruleRepo = new EscalationRuleRepository();

  async escalateTicket(
    ticketId: string,
    triggerType: EscalationTrigger,
    performedBy: number | null,
  ): Promise<EscalateTicketResponse> {
    const routingState = await this.routingRepo.getByTicketId(ticketId);
    if (!routingState) throw new Error(`Ticket ${ticketId} not found`);

    const currentGroup = await this.groupRepo.getGroupById(routingState.current_group_id);
    if (!currentGroup) throw new Error('Current group not found');

    const rule = await this.ruleRepo.getRuleByTrigger(currentGroup.id, triggerType);
    if (!rule) {
      throw new Error(`No escalation rule for group ${currentGroup.id} with trigger ${triggerType}`);
    }

    const targetGroup = await this.groupRepo.getGroupById(rule.target_group_id);
    if (!targetGroup) throw new Error('Target escalation group not found');

    // Determine target role by tier
    // Tier 1 (room→senior) assigns to a SENIOR; Tier 2 (senior→supervisor) to a SUPERVISOR
    const targetRole = rule.priority >= 2 ? 'SUPERVISOR' : 'SENIOR';

    // Determine the current support level (from) based on what group type the ticket is in
    const currentLevel = currentGroup.parent_group_id === null
      ? toSupportLevel('SUPERVISOR')   // top-level group
      : currentGroup.floor === 0
        ? toSupportLevel('SENIOR')     // building senior group
        : toSupportLevel('JUNIOR');    // floor room group
    const targetLevel = toSupportLevel(targetRole);

    // Select the least-loaded member of the target role in the target group
    const techSql = `
      SELECT gm.id AS member_id, gm.user_id
      FROM group_members gm
      LEFT JOIN (
        SELECT assigned_member_id, COUNT(*) AS ticket_count
        FROM ticket_routing_state
        WHERE status IN ('ASSIGNED', 'ESCALATED')
        GROUP BY assigned_member_id
      ) tc ON gm.id = tc.assigned_member_id
      WHERE gm.group_id = ? AND gm.role = ? AND gm.status = 'ACTIVE'
      ORDER BY COALESCE(tc.ticket_count, 0) ASC
      LIMIT 1
    `;
    const techs = await query<RowDataPacket[]>(techSql, [targetGroup.id, targetRole]);

    // Escalate routing state to target group
    await this.routingRepo.escalateTicket(ticketId, targetGroup.id);

    // If a target member was found, assign them and update ticket service
    if (techs.length) {
      const assignee = techs[0];

      // Update routing state with the assigned member
      const updateSql = `
        UPDATE ticket_routing_state
        SET assigned_member_id = ?, status = 'ESCALATED'
        WHERE ticket_id = ?
      `;
      const { execute } = await import('../config/database');
      await execute(updateSql, [assignee.member_id, ticketId]);

      // 1. POST /tickets/:id/escalate — record the escalation in ticket service
      try {
        await escalateTicketInService(
          ticketId,
          currentLevel,
          targetLevel,
          `Escalated (${triggerType}) from ${currentGroup.name} to ${targetGroup.name}`,
        );
      } catch (err: any) {
        console.error('Ticket Service escalate call failed:', err.response?.data || err.message);
      }

      // 2. PATCH /tickets/:id — assign to the new member with correct level
      try {
        await ticketServiceClient.patch(`/tickets/${ticketId}`, {
          assigned_to: String(assignee.user_id),
          assigned_to_level: targetLevel,
        });
      } catch (err: any) {
        console.error('Ticket Service assignment PATCH failed during escalation:', err.response?.data || err.message);
      }
    }

    await this.logRepo.logAction(ticketId, 'ESCALATED', {
      from_group_id: currentGroup.id,
      to_group_id: targetGroup.id,
      performed_by: performedBy,
      to_member_id: techs.length ? techs[0].member_id : null,
      reason: `Escalated (${triggerType}) from ${currentGroup.name} to ${targetGroup.name}${techs.length ? ` — assigned to user ${techs[0].user_id} (${targetRole})` : ''}`,
    });

    const escalationCount = await this.routingRepo.getEscalationCount(ticketId);

    return {
      success: true,
      ticketId,
      fromGroup: currentGroup.name,
      toGroup: targetGroup.name,
      escalationCount,
      triggerType,
      message: `Ticket escalated to ${targetGroup.name}${techs.length ? ` and assigned to ${targetRole} (user ${techs[0].user_id})` : ''}`,
    };
  }

  async manualEscalate(ticketId: string, userId: number, userRole: UserRole): Promise<EscalateTicketResponse> {
    if (userRole !== 'SENIOR' && userRole !== 'SUPERVISOR') {
      throw new Error(`Only Seniors and Supervisors can escalate. User role: ${userRole}`);
    }
    return this.escalateTicket(ticketId, 'MANUAL', userId);
  }

  async escalateIfCritical(
    ticketId: string,
    isCritical: boolean,
  ): Promise<EscalateTicketResponse | { success: false; message: string }> {
    if (!isCritical) return { success: false, message: 'Ticket is not critical' };
    return this.escalateTicket(ticketId, 'CRITICAL', null);
  }

  async escalateOnSLABreach(
    ticketId: string,
    slaBreached: boolean,
  ): Promise<EscalateTicketResponse | { success: false; message: string }> {
    if (!slaBreached) return { success: false, message: 'SLA not breached' };
    return this.escalateTicket(ticketId, 'SLA', null);
  }

  async escalateOnReopenThreshold(
    ticketId: string,
    reopenCount: number,
    threshold: number = 3,
  ): Promise<EscalateTicketResponse | { success: false; message: string }> {
    if (reopenCount < threshold) {
      return { success: false, message: `Reopen count ${reopenCount} below threshold ${threshold}` };
    }
    return this.escalateTicket(ticketId, 'REOPEN_COUNT', null);
  }

  async getEscalationPath(groupId: number): Promise<EscalationRuleRow[]> {
    return this.ruleRepo.getRulesForGroup(groupId);
  }

  async getEscalationHistory(ticketId: string): Promise<WorkflowLogRow[]> {
    const logs = await this.logRepo.getTicketLogs(ticketId);
    return logs.filter((l) => l.action === 'ESCALATED');
  }
}
