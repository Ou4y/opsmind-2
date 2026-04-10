import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { TicketRoutingStateRepository } from '../repositories/TicketRoutingStateRepository';
import { GroupMemberRepository } from '../repositories/GroupMemberRepository';
import { WorkflowLogRepository } from '../repositories/WorkflowLogRepository';
import { assignTicket } from '../config/externalServices';
import { getConnection } from '../config/database';
import { ClaimTicketResponse, TicketRoutingStateRow } from '../interfaces/types';


/**
 * Claim Service (TypeScript)
 *
 * Handles claim-on-open logic with concurrency safety.
 * Uses SELECT … FOR UPDATE inside a transaction to prevent race conditions.
 */
export class ClaimService {
  private routingRepo = new TicketRoutingStateRepository();
  private memberRepo = new GroupMemberRepository();
  private logRepo = new WorkflowLogRepository();

  async claimTicket(ticketId: string, userId: number): Promise<ClaimTicketResponse> {
    let member: any;
    let routingState: any;

    // ── Phase 1: DB Transaction with FOR UPDATE ──────────────────────
    const connection = await getConnection();
    try {
      await connection.beginTransaction();
      console.log(`[CLAIM] Transaction started for ticket=${ticketId}, userId=${userId}`);

      // SELECT … FOR UPDATE — locks the routing-state row
      const [rows] = await connection.execute<RowDataPacket[]>(
        'SELECT * FROM ticket_routing_state WHERE ticket_id = ? FOR UPDATE',
        [ticketId],
      );
      routingState = rows[0];

      if (!routingState) {
        throw new Error(`Ticket ${ticketId} not found in workflow system`);
      }
      console.log(`[CLAIM] Routing state locked: status=${routingState.status}, group=${routingState.current_group_id}`);

      // Prevent double claim
      if (routingState.status !== 'UNASSIGNED') {
        throw new Error(
          `Ticket ${ticketId} is already claimed or escalated. Current status: ${routingState.status}`,
        );
      }

      // Verify member belongs to the group
      const [memberRows] = await connection.execute<RowDataPacket[]>(
        "SELECT * FROM group_members WHERE user_id = ? AND group_id = ? AND status = 'ACTIVE'",
        [userId, routingState.current_group_id],
      );
      member = memberRows[0];

      if (!member) {
        throw new Error(`User ${userId} is not a member of group ${routingState.current_group_id}`);
      }
      if (member.role !== 'JUNIOR') {
        throw new Error(`Only juniors can claim tickets. User role: ${member.role}`);
      }

      // UPDATE routing state (still inside transaction)
      await connection.execute<ResultSetHeader>(
        `UPDATE ticket_routing_state
         SET assigned_member_id = ?, status = 'ASSIGNED', claimed_at = CURRENT_TIMESTAMP
         WHERE ticket_id = ?`,
        [member.id, ticketId],
      );
      console.log(`[CLAIM] Routing state updated: assigned_member_id=${member.id}`);

      await connection.commit();
      console.log(`[CLAIM] Transaction committed successfully`);
    } catch (error) {
      await connection.rollback();
      console.error(`[CLAIM] Transaction rolled back: ${(error as Error).message}`);
      throw error;
    } finally {
      connection.release();
    }

    // ── Phase 2: External PATCH + Audit Logs ─────────────────────────
    // PRE-PATCH log
    console.log(
      `[CLAIM] PRE-PATCH: Calling PATCH /tickets/${ticketId} { assigned_to: ${userId}, assigned_to_level: L1, status: IN_PROGRESS }`,
    );
    await this.logRepo.logAction(ticketId, 'CLAIMED', {
      to_group_id: routingState.current_group_id,
      to_member_id: member.id,
      performed_by: userId,
      reason: `[PRE-PATCH] Claiming ticket — sending to ticket-service`,
    });

    // PATCH ticket-service
    await assignTicket(ticketId, userId, 'L1', 'IN_PROGRESS');

    // POST-PATCH log
    console.log(`[CLAIM] POST-PATCH: Ticket-service confirmed assignment for ticket=${ticketId}`);
    await this.logRepo.logAction(ticketId, 'CLAIMED', {
      to_group_id: routingState.current_group_id,
      to_member_id: member.id,
      performed_by: userId,
      reason: `[POST-PATCH] Ticket-service confirmed: assigned_to=${userId}, assigned_to_level=L1, status=IN_PROGRESS`,
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
