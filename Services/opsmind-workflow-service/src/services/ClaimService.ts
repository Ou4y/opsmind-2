import { TicketRoutingStateRepository } from '../repositories/TicketRoutingStateRepository';
import { GroupMemberRepository } from '../repositories/GroupMemberRepository';
import { WorkflowLogRepository } from '../repositories/WorkflowLogRepository';
import { assignTicket } from '../config/externalServices';
import { ClaimTicketResponse, TicketRoutingStateRow } from '../interfaces/types';


/**
 * Claim Service (TypeScript)
 *
 * Handles claim-on-open logic with concurrency safety.
 * Database-level atomic UPDATE prevents race conditions.
 */
export class ClaimService {
  private routingRepo = new TicketRoutingStateRepository();
  private memberRepo = new GroupMemberRepository();
  private logRepo = new WorkflowLogRepository();

  async claimTicket(ticketId: string, userId: number): Promise<ClaimTicketResponse> {
    // 1. Check routing state
    const routingState = await this.routingRepo.getByTicketId(ticketId);
    if (!routingState) {
      throw new Error(`Ticket ${ticketId} not found in workflow system`);
    }

    if (routingState.status !== 'UNASSIGNED') {
      throw new Error(
        `Ticket ${ticketId} is already claimed or escalated. Current status: ${routingState.status}`,
      );
    }

    // 2. Verify member belongs to group
    const member = await this.memberRepo.getMemberByUserAndGroup(userId, routingState.current_group_id);
    if (!member) {
      throw new Error(`User ${userId} is not a member of group ${routingState.current_group_id}`);
    }

    if (member.role !== 'JUNIOR') {
      throw new Error(`Only juniors can claim tickets. User role: ${member.role}`);
    }

    // 3. ATOMIC CLAIM — race-condition safe
    await this.routingRepo.claimTicket(ticketId, member.id);

    // 4. Notify Ticket Service (L1 = JUNIOR level)
    await assignTicket(ticketId, userId, 'L1', 'IN_PROGRESS');

    // 5. Audit log
    await this.logRepo.logAction(ticketId, 'CLAIMED', {
      to_group_id: routingState.current_group_id,
      to_member_id: member.id,
      performed_by: userId,
      reason: `Claimed by ${member.role} (User ID: ${userId})`,
    });

    return {
      success: true,
      ticketId,
      claimedBy: userId,
      memberId: member.id,
      groupId: routingState.current_group_id,
      message: `Ticket successfully claimed by user ${userId}`,
    };
  }

  async isTicketClaimed(ticketId: string): Promise<boolean> {
    const state = await this.routingRepo.getByTicketId(ticketId);
    return !!state && state.status !== 'UNASSIGNED';
  }

  async getUnclaimedTickets(groupId: number): Promise<TicketRoutingStateRow[]> {
    const allTickets = await this.routingRepo.getGroupTickets(groupId);
    return allTickets.filter((t) => t.status === 'UNASSIGNED');
  }
}
