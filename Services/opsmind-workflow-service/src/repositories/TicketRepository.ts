import { RowDataPacket } from 'mysql2/promise';
import { execute, query } from '../config/database';

interface WorkloadRow extends RowDataPacket {
  technician_id: number;
  workload_count: number;
}

/**
 * Ticket Repository
 *
 * Thin wrapper over ticket table for workload & assignment.
 * Assumes tickets table has columns: id, assigned_to, status.
 */
export class TicketRepository {
  /**
   * Ensure ticket exists locally so workload calculations work.
   * Only stores id/status to match minimal tickets schema.
   */
  async upsertTicket(ticketId: string): Promise<void> {
    await execute(
      `
        INSERT INTO tickets (id, status)
        VALUES (?, 'OPEN')
        ON DUPLICATE KEY UPDATE
          updated_at = CURRENT_TIMESTAMP
      `,
      [ticketId],
    );
  }

  async getWorkloadMap(): Promise<Record<number, number>> {
    const rows = await query<WorkloadRow[]>(
      `
        SELECT assigned_to AS technician_id, COUNT(*) AS workload_count
        FROM tickets
        WHERE assigned_to IS NOT NULL
          AND status IN ('OPEN', 'IN_PROGRESS')
        GROUP BY assigned_to
      `,
    );

    const map: Record<number, number> = {};
    rows.forEach((r) => {
      if (r.technician_id !== null) {
        map[r.technician_id] = r.workload_count;
      }
    });
    return map;
  }

  /**
   * Check if ticket is already assigned.
   * Returns ticket info if assigned (assigned_to set OR status not OPEN),
   * otherwise returns null.
   */
  async isAlreadyAssigned(ticketId: string): Promise<{ assigned_to: number | null; status: string } | null> {
    const rows = await query<RowDataPacket[]>(
      `SELECT assigned_to, status FROM tickets WHERE id = ? LIMIT 1`,
      [ticketId],
    );
    
    if (rows.length === 0) {
      return null; // Ticket doesn't exist yet
    }

    const ticket = rows[0];
    // Consider assigned if either:
    // 1. assigned_to is set, OR
    // 2. status is not OPEN (IN_PROGRESS, RESOLVED, CLOSED)
    if (ticket.assigned_to !== null || ticket.status !== 'OPEN') {
      return {
        assigned_to: ticket.assigned_to,
        status: ticket.status,
      };
    }

    return null; // Not assigned
  }

  /**
   * Assign ticket to technician.
   * Only updates if ticket is currently OPEN and unassigned (race-condition safe).
   * Throws error if ticket not found or already assigned.
   */
  async assignTicket(ticketId: string, technicianId: number): Promise<void> {
    const result = await execute(
      `
        UPDATE tickets
        SET assigned_to = ?, status = 'IN_PROGRESS'
        WHERE id = ? AND assigned_to IS NULL AND status = 'OPEN'
      `,
      [technicianId, ticketId],
    );

    if (result.affectedRows === 0) {
      // Check why update failed
      const existing = await query<RowDataPacket[]>(
        `SELECT id, assigned_to, status FROM tickets WHERE id = ?`,
        [ticketId],
      );
      
      if (existing.length === 0) {
        throw new Error(`Ticket ${ticketId} not found`);
      }
      
      const ticket = existing[0];
      if (ticket.assigned_to !== null) {
        console.warn(
          `[TicketRepository] Assignment blocked: ticket ${ticketId} already assigned to ${ticket.assigned_to}`,
        );
        throw new Error(`Ticket ${ticketId} already assigned to technician ${ticket.assigned_to}`);
      }
      
      if (ticket.status !== 'OPEN') {
        console.warn(
          `[TicketRepository] Assignment blocked: ticket ${ticketId} status is ${ticket.status} (not OPEN)`,
        );
        throw new Error(`Ticket ${ticketId} status is ${ticket.status}, cannot assign`);
      }
      
      throw new Error(`Failed to assign ticket ${ticketId} for unknown reason`);
    }

    console.log(
      `[TicketRepository] ✔ Ticket ${ticketId} assigned to technician ${technicianId}, status → IN_PROGRESS`,
    );
  }
}
