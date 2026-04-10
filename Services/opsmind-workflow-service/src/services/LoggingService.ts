import { WorkflowLogRepository } from '../repositories/WorkflowLogRepository';
import { WorkflowAction, WorkflowLogData, WorkflowLogRow } from '../interfaces/types';

/**
 * Logging Service (TypeScript)
 *
 * Immutable audit trail for compliance and debugging.
 */
export class LoggingService {
  private logRepo = new WorkflowLogRepository();

  async logAction(ticketId: string, action: WorkflowAction, data: WorkflowLogData = {}): Promise<{ id: number }> {
    return this.logRepo.logAction(ticketId, action, data);
  }

  async getTicketAuditTrail(ticketId: string) {
    const logs = await this.logRepo.getTicketLogs(ticketId);
    return {
      ticketId,
      totalActions: logs.length,
      logs: logs.map((l) => ({
        id: l.id,
        action: l.action,
        timestamp: l.created_at,
        performedBy: l.performed_by,
        fromGroup: l.from_group_id,
        toGroup: l.to_group_id,
        reason: l.reason,
      })),
    };
  }

  async getMemberActivityHistory(memberId: number, limit: number = 50) {
    const logs = await this.logRepo.getMemberLogs(memberId, limit);
    return {
      memberId,
      totalActions: logs.length,
      logs: logs.map((l) => ({
        ticketId: l.ticket_id,
        action: l.action,
        timestamp: l.created_at,
        description: this.formatLogDescription(l),
      })),
    };
  }

  async getGroupActivityHistory(groupId: number, limit: number = 50) {
    const logs = await this.logRepo.getGroupLogs(groupId, limit);
    return {
      groupId,
      totalActions: logs.length,
      logs: logs.map((l) => ({
        ticketId: l.ticket_id,
        action: l.action,
        timestamp: l.created_at,
        description: this.formatLogDescription(l),
      })),
    };
  }

  async getRecentActivity(limitLogs: number = 50, minutesBack: number = 60) {
    const logs = await this.logRepo.getRecentLogs(limitLogs, minutesBack);
    return {
      period: `Last ${minutesBack} minutes`,
      totalActions: logs.length,
      logs: logs.map((l) => ({
        ticketId: l.ticket_id,
        action: l.action,
        timestamp: l.created_at,
        description: this.formatLogDescription(l),
      })),
    };
  }

  private formatLogDescription(log: WorkflowLogRow): string {
    switch (log.action) {
      case 'CLAIMED':
        return `Ticket claimed by member ${log.to_member_id}`;
      case 'REASSIGNED':
        return `Reassigned from group ${log.from_group_id} to group ${log.to_group_id}`;
      case 'ESCALATED':
        return `Escalated from group ${log.from_group_id} to group ${log.to_group_id}`;
      case 'ROUTED':
        return `Auto-routed to group ${log.to_group_id}`;
      default:
        return `Action: ${log.action}`;
    }
  }
}
