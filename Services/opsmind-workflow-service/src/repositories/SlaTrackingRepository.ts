import { RowDataPacket } from 'mysql2/promise';
import { query, execute } from '../config/database';
import { SlaTrackingRow } from '../interfaces/types';

interface SlaTrackingRowData extends SlaTrackingRow, RowDataPacket {}

/**
 * SLA Tracking Repository
 *
 * Manages SLA deadlines and breach tracking.
 */
export class SlaTrackingRepository {
  async createTracking(
    ticketId: string,
    priority: string,
    slaDeadline: Date,
  ): Promise<{ id: number }> {
    const sql = `
      INSERT INTO sla_tracking (ticket_id, priority, created_at, sla_deadline)
      VALUES (?, ?, NOW(), ?)
    `;
    const result = await execute(sql, [ticketId, priority, slaDeadline]);
    return { id: result.insertId };
  }

  async getByTicketId(ticketId: string): Promise<SlaTrackingRow | null> {
    const sql = `SELECT * FROM sla_tracking WHERE ticket_id = ?`;
    const rows = await query<SlaTrackingRowData[]>(sql, [ticketId]);
    return rows[0] ?? null;
  }

  async getByTicketIds(ticketIds: string[]): Promise<SlaTrackingRow[]> {
    if (ticketIds.length === 0) return [];
    const placeholders = ticketIds.map(() => '?').join(',');
    const sql = `SELECT * FROM sla_tracking WHERE ticket_id IN (${placeholders})`;
    return query<SlaTrackingRowData[]>(sql, ticketIds);
  }

  async markBreached(ticketId: string): Promise<void> {
    const sql = `
      UPDATE sla_tracking 
      SET sla_breached = TRUE, breached_at = NOW(), updated_at = NOW()
      WHERE ticket_id = ?
    `;
    await execute(sql, [ticketId]);
  }

  async markAssigned(ticketId: string): Promise<void> {
    const sql = `
      UPDATE sla_tracking 
      SET assigned_at = NOW(), updated_at = NOW()
      WHERE ticket_id = ?
    `;
    await execute(sql, [ticketId]);
  }

  async getBreachedCount(startDate?: string, endDate?: string): Promise<number> {
    let sql = `SELECT COUNT(*) as count FROM sla_tracking WHERE sla_breached = TRUE`;
    const params: any[] = [];
    if (startDate) { sql += ` AND created_at >= ?`; params.push(startDate); }
    if (endDate) { sql += ` AND created_at <= ?`; params.push(endDate); }
    const rows = await query<RowDataPacket[]>(sql, params);
    return rows[0]?.count ?? 0;
  }

  async getTotalCount(startDate?: string, endDate?: string): Promise<number> {
    let sql = `SELECT COUNT(*) as count FROM sla_tracking WHERE 1=1`;
    const params: any[] = [];
    if (startDate) { sql += ` AND created_at >= ?`; params.push(startDate); }
    if (endDate) { sql += ` AND created_at <= ?`; params.push(endDate); }
    const rows = await query<RowDataPacket[]>(sql, params);
    return rows[0]?.count ?? 0;
  }

  async getAtRiskTickets(): Promise<SlaTrackingRow[]> {
    const sql = `
      SELECT * FROM sla_tracking 
      WHERE sla_breached = FALSE 
        AND sla_deadline > NOW() 
        AND sla_deadline < DATE_ADD(NOW(), INTERVAL 30 MINUTE)
    `;
    return query<SlaTrackingRowData[]>(sql, []);
  }

  async getSLAReport(startDate?: string, endDate?: string): Promise<any> {
    let whereClause = '1=1';
    const params: any[] = [];
    if (startDate) { whereClause += ` AND s.created_at >= ?`; params.push(startDate); }
    if (endDate) { whereClause += ` AND s.created_at <= ?`; params.push(endDate); }

    const sql = `
      SELECT 
        COUNT(*) as total_tickets,
        SUM(CASE WHEN s.sla_breached = TRUE THEN 1 ELSE 0 END) as breached,
        SUM(CASE WHEN s.sla_breached = FALSE AND s.sla_deadline > NOW() THEN 1 ELSE 0 END) as on_track,
        SUM(CASE WHEN s.sla_breached = FALSE AND s.sla_deadline <= NOW() THEN 1 ELSE 0 END) as at_risk,
        s.priority,
        AVG(TIMESTAMPDIFF(MINUTE, s.created_at, COALESCE(s.assigned_at, NOW()))) as avg_response_minutes
      FROM sla_tracking s
      WHERE ${whereClause}
      GROUP BY s.priority
    `;
    return query<RowDataPacket[]>(sql, params);
  }
}
