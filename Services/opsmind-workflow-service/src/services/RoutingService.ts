import { SupportGroupRepository } from '../repositories/SupportGroupRepository';
import { TicketRoutingStateRepository } from '../repositories/TicketRoutingStateRepository';
import { WorkflowLogRepository } from '../repositories/WorkflowLogRepository';
import { TicketRoutingStateRow, SupportGroupRow } from '../interfaces/types';

/**
 * Routing Service (TypeScript)
 *
 * Provides read-only access to ticket routing state and support group information.
 * NOTE: Assignment is handled by AssignmentService (location-based, not building/floor-based).
 * This service supports claim/escalation/reassignment workflows that still use group structures.
 */
export class RoutingService {
  private groupRepo = new SupportGroupRepository();
  private routingRepo = new TicketRoutingStateRepository();
  private logRepo = new WorkflowLogRepository();

  async getTicketRouting(ticketId: string): Promise<TicketRoutingStateRow | null> {
    return this.routingRepo.getByTicketId(ticketId);
  }

  async getGroupQueue(groupId: number): Promise<TicketRoutingStateRow[]> {
    return this.routingRepo.getGroupTickets(groupId);
  }

  async getGroupInfo(groupId: number): Promise<SupportGroupRow | null> {
    return this.groupRepo.getGroupById(groupId);
  }
}
