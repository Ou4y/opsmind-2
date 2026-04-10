import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { query, execute, getConnection } from '../config/database';
import { TicketRoutingStateRow, RoutingStatus } from '../interfaces/types';

interface RoutingStateRowData extends TicketRoutingStateRow, RowDataPacket {}

/**
 * Ticket Routing State Repository (TypeScript)
 *
 * Tracks workflow state of each ticket.
 * NOT the ticket details (owned by Ticket Service).
 */
export class TicketRoutingStateRepository {
  async createRoutingState(
    ticketId: string,
    groupId: number,
  ): Promise<{ id: number; ticket_id: string; current_group_id: number }> {
    const sql = `
      INSERT INTO ticket_routing_state (ticket_id, current_group_id, status)
      VALUES (?, ?, 'UNASSIGNED')
    `;
    const result = await execute(sql, [ticketId, groupId]);
    return { id: result.insertId, ticket_id: ticketId, current_group_id: groupId };
  }

  async getByTicketId(ticketId: string): Promise<TicketRoutingStateRow | null> {
    const sql = `SELECT * FROM ticket_routing_state WHERE ticket_id = ?`;
    const rows = await query<RoutingStateRowData[]>(sql, [ticketId]);
    return rows[0] ?? null;
  }

  /**
   * Claim ticket (CONCURRENCY-SAFE)
   * Atomic UPDATE with WHERE status = 'UNASSIGNED' prevents race conditions.
   */
  async claimTicket(ticketId: string, memberId: number): Promise<boolean> {
    const connection = await getConnection();

    try {
      await connection.beginTransaction();

      const updateSql = `
        UPDATE ticket_routing_state
        SET assigned_member_id = ?, status = 'ASSIGNED', claimed_at = CURRENT_TIMESTAMP
        WHERE ticket_id = ? AND status = 'UNASSIGNED'
      `;

      const [result] = await connection.execute<ResultSetHeader>(updateSql, [memberId, ticketId]);

      if (result.affectedRows === 0) {
        await connection.rollback();
        throw new Error('Ticket already claimed or does not exist');
      }

      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async reassignTicket(ticketId: string, toMemberId: number, toGroupId: number): Promise<void> {
    const sql = `
      UPDATE ticket_routing_state
      SET assigned_member_id = ?, current_group_id = ?, status = 'ASSIGNED', updated_at = CURRENT_TIMESTAMP
      WHERE ticket_id = ?
    `;
    await execute(sql, [toMemberId, toGroupId, ticketId]);
  }

  async escalateTicket(ticketId: string, toGroupId: number): Promise<boolean> {
    const sql = `
      UPDATE ticket_routing_state
      SET current_group_id = ?, status = 'ESCALATED',
          escalation_count = escalation_count + 1,
          last_escalated_at = CURRENT_TIMESTAMP,
          assigned_member_id = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE ticket_id = ?
    `;
    const result = await execute(sql, [toGroupId, ticketId]);
    return result.affectedRows > 0;
  }

  async updateStatus(ticketId: string, status: RoutingStatus): Promise<void> {
    const sql = `
      UPDATE ticket_routing_state
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE ticket_id = ?
    `;
    await execute(sql, [status, ticketId]);
  }

  async getEscalationCount(ticketId: string): Promise<number> {
    const sql = `SELECT escalation_count FROM ticket_routing_state WHERE ticket_id = ?`;
    const rows = await query<RoutingStateRowData[]>(sql, [ticketId]);
    return rows[0]?.escalation_count ?? 0;
  }

  async getGroupTickets(groupId: number): Promise<TicketRoutingStateRow[]> {
    const sql = `
      SELECT * FROM ticket_routing_state
      WHERE current_group_id = ?
      ORDER BY updated_at DESC
    `;
    return query<RoutingStateRowData[]>(sql, [groupId]);
  }

  async getMemberTickets(memberId: number): Promise<TicketRoutingStateRow[]> {
    const sql = `
      SELECT * FROM ticket_routing_state
      WHERE assigned_member_id = ? AND status = 'ASSIGNED'
      ORDER BY claimed_at DESC
    `;
    return query<RoutingStateRowData[]>(sql, [memberId]);
  }

  /** Get group tickets with optional filters */
  async getGroupTicketsFiltered(
    groupId: number,
    filters: { status?: string; building?: string },
  ): Promise<TicketRoutingStateRow[]> {
    let sql = `SELECT * FROM ticket_routing_state WHERE current_group_id = ?`;
    const params: any[] = [groupId];

    if (filters.status) {
      sql += ` AND status = ?`;
      params.push(filters.status);
    }

    sql += ` ORDER BY updated_at DESC`;
    return query<RoutingStateRowData[]>(sql, params);
  }

  /** Get technician's tickets with optional status filter */
  async getTechnicianTickets(
    technicianUserId: number,
    status?: string,
  ): Promise<TicketRoutingStateRow[]> {
    // Find the member record for this user
    let sql = `
      SELECT trs.* FROM ticket_routing_state trs
      JOIN group_members gm ON trs.assigned_member_id = gm.id
      WHERE gm.user_id = ?
    `;
    const params: any[] = [technicianUserId];

    if (status) {
      sql += ` AND trs.status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY trs.updated_at DESC`;
    return query<RoutingStateRowData[]>(sql, params);
  }

  /** Count tickets by status for metrics */
  async getTicketCountsByStatus(startDate?: string, endDate?: string): Promise<any> {
    let whereClause = '1=1';
    const params: any[] = [];
    if (startDate) { whereClause += ` AND updated_at >= ?`; params.push(startDate); }
    if (endDate) { whereClause += ` AND updated_at <= ?`; params.push(endDate); }

    const sql = `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'ASSIGNED' THEN 1 ELSE 0 END) as assigned,
        SUM(CASE WHEN status = 'UNASSIGNED' THEN 1 ELSE 0 END) as unassigned,
        SUM(CASE WHEN status = 'ESCALATED' THEN 1 ELSE 0 END) as escalated
      FROM ticket_routing_state 
      WHERE ${whereClause}
    `;
    const rows = await query<RowDataPacket[]>(sql, params);
    return rows[0] ?? { total: 0, assigned: 0, unassigned: 0, escalated: 0 };
  }

  /** Get all tickets (for metrics calculations) */
  async getAllTickets(startDate?: string, endDate?: string): Promise<TicketRoutingStateRow[]> {
    let sql = `SELECT * FROM ticket_routing_state WHERE 1=1`;
    const params: any[] = [];
    if (startDate) { sql += ` AND updated_at >= ?`; params.push(startDate); }
    if (endDate) { sql += ` AND updated_at <= ?`; params.push(endDate); }
    sql += ` ORDER BY updated_at DESC`;
    return query<RoutingStateRowData[]>(sql, params);
  }
}
