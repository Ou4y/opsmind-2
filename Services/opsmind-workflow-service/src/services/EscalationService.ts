import { ReportingRelationshipRepository } from '../repositories/ReportingRelationshipRepository';
import { TechnicianRepository } from '../repositories/TechnicianRepository';
import { WorkflowLogRepository } from '../repositories/WorkflowLogRepository';
import { EscalationRuleRepository } from '../repositories/EscalationRuleRepository';
import { TicketRepository } from '../repositories/TicketRepository';
import { TicketRoutingStateRepository } from '../repositories/TicketRoutingStateRepository';
import {
  EscalateTicketResponse,
  EscalationTrigger,
  UserRole,
  WorkflowLogRow,
  EscalationRuleRow,
} from '../interfaces/types';
import { assignTicket, escalateTicketInService, getTicket, toSupportLevel } from '../config/externalServices';

type HierarchyRelationshipType = 'JUNIOR_TO_SENIOR' | 'SENIOR_TO_SUPERVISOR' | 'SUPERVISOR_TO_ADMIN';
type EscalationRole = 'JUNIOR' | 'SENIOR' | 'SUPERVISOR' | 'ADMIN';

interface EscalationTarget {
  sourceUserId: number;
  targetRole: EscalationRole;
  relationshipType: HierarchyRelationshipType;
}

/**
 * Escalation Service (TypeScript)
 *
 * Hierarchy-based escalation chain:
 *   JUNIOR -> SENIOR
 *   SENIOR -> SUPERVISOR
 *   SUPERVISOR -> ADMIN
 *
 * On each escalation the service:
 *  1. Validates ticket status and current assignee
 *  2. Resolves target manager via reporting_relationships
 *  3. Records escalation in ticket-service and reassigns assignee/level
 *  4. Logs the ESCALATED action in workflow_logs
 */
export class EscalationService {
  private relationshipRepo = new ReportingRelationshipRepository();
  private technicianRepo = new TechnicianRepository();
  private logRepo = new WorkflowLogRepository();
  private ruleRepo = new EscalationRuleRepository();
  private ticketRepo = new TicketRepository();
  private routingRepo = new TicketRoutingStateRepository();

  async escalateTicket(
    ticketId: string,
    triggerType: EscalationTrigger,
    performedBy: number | null,
    userRole?: UserRole,
    reason?: string,
  ): Promise<EscalateTicketResponse> {
    const ticket = await getTicket(ticketId);
    if (!ticket) {
      throw new Error(`Ticket ${ticketId} not found`);
    }

    const ticketStatus = String(ticket.status || '').toUpperCase();
    if (ticketStatus === 'RESOLVED' || ticketStatus === 'CLOSED') {
      throw new Error(`Cannot escalate ticket ${ticketId} because it is ${ticketStatus}`);
    }

    const assignedToUserId = this.toNumericUserId(ticket.assigned_to);
    if (assignedToUserId === null) {
      throw new Error('Cannot escalate an unassigned ticket');
    }

    const assignedTechnician = await this.technicianRepo.getByUserId(assignedToUserId);
    const assignedRole = this.resolveAssignedRole(assignedTechnician?.level, ticket.assigned_to_level ?? null);
    if (!assignedRole) {
      throw new Error(`Unable to resolve assigned technician level for ticket ${ticketId}`);
    }

    let target: EscalationTarget;
    if (triggerType === 'MANUAL') {
      if (performedBy === null) {
        throw new Error('Manual escalation requires performer identity');
      }

      const normalizedRole = this.normalizeRole(userRole);
      if (!normalizedRole) {
        throw new Error(`Invalid manual escalation role: ${String(userRole ?? 'UNKNOWN')}`);
      }

      target = await this.resolveManualTarget(normalizedRole, performedBy, assignedToUserId);
    } else {
      target = this.resolveAutomaticTarget(assignedToUserId, assignedRole);
    }

    const relationship = await this.relationshipRepo.getManagerByRelationshipType(
      target.sourceUserId,
      target.relationshipType,
    );

    if (!relationship) {
      throw new Error(
        `No active ${target.relationshipType} relationship found for user ${target.sourceUserId}`,
      );
    }

    const targetUserId = relationship.parent_user_id;
    const targetTechnician = await this.technicianRepo.getByUserId(targetUserId);
    if (!targetTechnician) {
      throw new Error(`Escalation target technician ${targetUserId} was not found`);
    }

    if (targetTechnician.level !== target.targetRole) {
      throw new Error(
        `Escalation target level mismatch: expected ${target.targetRole}, found ${targetTechnician.level}`,
      );
    }

    const fromLevel = ticket.assigned_to_level || toSupportLevel(assignedRole);
    const toLevel = toSupportLevel(target.targetRole);
    const escalationReason = this.buildReason(
      reason,
      triggerType,
      assignedToUserId,
      targetUserId,
      assignedRole,
      target.targetRole,
    );

    console.log(
      `[EscalationService] Resolved escalation target | ticket=${ticketId} | trigger=${triggerType} | performer=${performedBy ?? 'system'} | from_user=${assignedToUserId}(${assignedRole}) | to_user=${targetUserId}(${target.targetRole})`,
    );

    console.log(
      `[EscalationService] Ticket-service escalation payload | ticket=${ticketId} | from_level=${fromLevel} | to_level=${toLevel}`,
    );

    let escalatedTicket: any;
    try {
      escalatedTicket = await escalateTicketInService(ticketId, fromLevel, toLevel, escalationReason);
    } catch (error: unknown) {
      throw new Error(this.formatTicketServiceError('Failed to create escalation record in ticket service', error));
    }


    console.log(
      `[EscalationService] Ticket-service assignment payload | ticket=${ticketId} | assigned_to=${targetUserId} | assigned_to_level=${toLevel}`,
    );

    let assignmentResult: any;
    try {
      assignmentResult = await assignTicket(ticketId, targetUserId, toLevel, undefined, {
        assignmentMethod: 'ESCALATION',
        assignmentReason: escalationReason,
        performedBy: performedBy,
        performedByRole: userRole || null,
        statusReason: 'Escalated ticket',
      });
    } catch (error: unknown) {
      throw new Error(this.formatTicketServiceError('Failed to update escalated assignment in ticket service', error));
    }

    const authoritativeStatus = String(assignmentResult?.status || ticket.status || 'OPEN').toUpperCase();

    console.log(
      `[EscalationService] Workflow DB sync payload | ticket=${ticketId} | assigned_to=${targetUserId} | status=${authoritativeStatus}`,
    );

    try {
      await this.ticketRepo.syncOwnership(ticketId, targetUserId, authoritativeStatus);
    } catch (error: any) {
      throw new Error(
        `Failed to sync workflow ticket ownership after escalation: ${error.message || String(error)}`,
      );
    }

    try {
      const routingSync = await this.routingRepo.syncEscalationAssignment(ticketId, targetUserId);
      if (routingSync.rowExists) {
        console.log(
          `[EscalationService] Routing state synced | ticket=${ticketId} | assigned_member_id=${routingSync.assignedMemberId}`,
        );
      } else {
        console.log(
          `[EscalationService] Routing state not present for ticket=${ticketId}; skipped routing assignment sync`,
        );
      }
    } catch (error: any) {
      throw new Error(
        `Failed to sync workflow routing state after escalation: ${error.message || String(error)}`,
      );
    }

    await this.logRepo.logAction(ticketId, 'ESCALATED', {
      performed_by: performedBy,
      to_member_id: targetUserId,
      reason: escalationReason,
    });

    const escalationCount = Number(
      escalatedTicket?.escalation_count ?? ticket.escalation_count + 1,
    );

    return {
      success: true,
      ticketId,
      fromGroup: `${assignedRole}:${assignedToUserId}`,
      toGroup: `${target.targetRole}:${targetUserId}`,
      escalationCount,
      triggerType,
      message: `Ticket escalated from ${assignedRole} (${assignedToUserId}) to ${target.targetRole} (${targetUserId})`,
    };
  }

  async manualEscalate(
    ticketId: string,
    userId: number | null,
    userRole: UserRole,
    reason: string,
  ): Promise<EscalateTicketResponse> {
    if (userId === null) {
      throw new Error('Manual escalation requires performer identity');
    }

    return this.escalateTicket(ticketId, 'MANUAL', userId, userRole, reason);
  }

  async escalateIfCritical(
    ticketId: string,
    isCritical: boolean,
  ): Promise<EscalateTicketResponse | { success: false; message: string }> {
    if (!isCritical) return { success: false, message: 'Ticket is not critical' };
    return this.escalateTicket(ticketId, 'CRITICAL', null, undefined, undefined);
  }

  async escalateOnSLABreach(
    ticketId: string,
    slaBreached: boolean,
  ): Promise<EscalateTicketResponse | { success: false; message: string }> {
    if (!slaBreached) return { success: false, message: 'SLA not breached' };
    return this.escalateTicket(ticketId, 'SLA', null, undefined, undefined);
  }

  async escalateOnReopenThreshold(
    ticketId: string,
    reopenCount: number,
    threshold: number = 3,
  ): Promise<EscalateTicketResponse | { success: false; message: string }> {
    if (reopenCount < threshold) {
      return { success: false, message: `Reopen count ${reopenCount} below threshold ${threshold}` };
    }
    return this.escalateTicket(ticketId, 'REOPEN_COUNT', null, undefined, undefined);
  }

  async getEscalationPath(groupId: number): Promise<EscalationRuleRow[]> {
    return this.ruleRepo.getRulesForGroup(groupId);
  }

  async getEscalationHistory(ticketId: string): Promise<WorkflowLogRow[]> {
    const logs = await this.logRepo.getTicketLogs(ticketId);
    return logs.filter((l) => l.action === 'ESCALATED');
  }

  private toNumericUserId(value: number | string | null | undefined): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private normalizeRole(userRole: UserRole | undefined): EscalationRole | null {
    const normalized = String(userRole || '').toUpperCase();
    if (normalized === 'HEAD_OF_IT') return 'ADMIN';
    if (normalized === 'TECHNICIAN') return 'JUNIOR';
    if (normalized === 'JUNIOR' || normalized === 'SENIOR' || normalized === 'SUPERVISOR' || normalized === 'ADMIN') {
      return normalized;
    }
    return null;
  }

  private resolveAssignedRole(
    technicianLevel: string | undefined,
    assignedLevel: 'L1' | 'L2' | 'L3' | 'L4' | null,
  ): EscalationRole | null {
    const fromTechnician = String(technicianLevel || '').toUpperCase();
    if (fromTechnician === 'JUNIOR' || fromTechnician === 'SENIOR' || fromTechnician === 'SUPERVISOR' || fromTechnician === 'ADMIN') {
      return fromTechnician;
    }

    const bySupportLevel: Record<'L1' | 'L2' | 'L3' | 'L4', EscalationRole> = {
      L1: 'JUNIOR',
      L2: 'SENIOR',
      L3: 'SUPERVISOR',
      L4: 'ADMIN',
    };

    if (assignedLevel && bySupportLevel[assignedLevel]) {
      return bySupportLevel[assignedLevel];
    }

    return null;
  }

  private resolveAutomaticTarget(sourceUserId: number, sourceRole: EscalationRole): EscalationTarget {
    switch (sourceRole) {
      case 'JUNIOR':
        return {
          sourceUserId,
          targetRole: 'SENIOR',
          relationshipType: 'JUNIOR_TO_SENIOR',
        };
      case 'SENIOR':
        return {
          sourceUserId,
          targetRole: 'SUPERVISOR',
          relationshipType: 'SENIOR_TO_SUPERVISOR',
        };
      case 'SUPERVISOR':
        return {
          sourceUserId,
          targetRole: 'ADMIN',
          relationshipType: 'SUPERVISOR_TO_ADMIN',
        };
      case 'ADMIN':
      default:
        throw new Error('Ticket is already at highest escalation level');
    }
  }

  private async resolveManualTarget(
    actingRole: EscalationRole,
    actingUserId: number,
    assignedToUserId: number,
  ): Promise<EscalationTarget> {
    if (actingRole === 'JUNIOR') {
      if (assignedToUserId !== actingUserId) {
        throw new Error('Juniors can only escalate tickets assigned to themselves');
      }

      return {
        sourceUserId: actingUserId,
        targetRole: 'SENIOR',
        relationshipType: 'JUNIOR_TO_SENIOR',
      };
    }

    if (actingRole === 'SENIOR') {
      await this.assertSeniorScope(actingUserId, assignedToUserId);
      return {
        sourceUserId: actingUserId,
        targetRole: 'SUPERVISOR',
        relationshipType: 'SENIOR_TO_SUPERVISOR',
      };
    }

    if (actingRole === 'SUPERVISOR') {
      await this.assertSupervisorScope(actingUserId, assignedToUserId);
      return {
        sourceUserId: actingUserId,
        targetRole: 'ADMIN',
        relationshipType: 'SUPERVISOR_TO_ADMIN',
      };
    }

    throw new Error('Admins are already at the highest escalation level');
  }

  private async assertSeniorScope(seniorUserId: number, assignedToUserId: number): Promise<void> {
    if (assignedToUserId === seniorUserId) {
      return;
    }

    const juniors = await this.relationshipRepo.getJuniorsForSenior(seniorUserId);
    if (!juniors.includes(assignedToUserId)) {
      throw new Error('Senior can only escalate their own tickets or tickets assigned to direct juniors');
    }
  }

  private async assertSupervisorScope(supervisorUserId: number, assignedToUserId: number): Promise<void> {
    if (assignedToUserId === supervisorUserId) {
      return;
    }

    const seniors = await this.relationshipRepo.getSeniorsForSupervisor(supervisorUserId);
    if (seniors.includes(assignedToUserId)) {
      return;
    }

    const juniorsBySenior = await Promise.all(
      seniors.map((seniorUserId) => this.relationshipRepo.getJuniorsForSenior(seniorUserId)),
    );
    const allJuniors = juniorsBySenior.flat();

    if (!allJuniors.includes(assignedToUserId)) {
      throw new Error(
        'Supervisor can only escalate tickets in their hierarchy (direct seniors and their juniors)',
      );
    }
  }

  private buildReason(
    inputReason: string | undefined,
    triggerType: EscalationTrigger,
    fromUserId: number,
    toUserId: number,
    fromRole: EscalationRole,
    toRole: EscalationRole,
  ): string {
    const trimmed = (inputReason || '').trim();
    if (trimmed) {
      return trimmed;
    }

    return `Escalated (${triggerType}) from ${fromRole} user ${fromUserId} to ${toRole} user ${toUserId}`;
  }

  private formatTicketServiceError(prefix: string, error: unknown): string {
    const errorWithResponse = error as {
      response?: { status?: number; data?: unknown };
      message?: string;
    };

    const status = errorWithResponse.response?.status;
    const responseData = errorWithResponse.response?.data;
    const responseMessage =
      typeof responseData === 'object' && responseData !== null && 'message' in responseData
        ? String((responseData as Record<string, unknown>).message)
        : undefined;

    const details = responseMessage || errorWithResponse.message || 'Unknown ticket-service error';

    return status ? `${prefix}: HTTP ${status} - ${details}` : `${prefix}: ${details}`;
  }
}
