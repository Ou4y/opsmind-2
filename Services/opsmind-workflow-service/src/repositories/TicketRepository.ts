import { RowDataPacket } from 'mysql2/promise';
import { execute, query } from '../config/database';
import { TicketSyncPayload } from '../interfaces/types';

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
        SET assigned_to = ?
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
      `[TicketRepository] ✔ Ticket ${ticketId} assigned to technician ${technicianId}, status remains OPEN`,
    );
  }

  /**
   * Force-sync local workflow ticket ownership to match authoritative ticket-service.
   * Used by escalation/reassignment flows where ticket is already assigned.
   */
  async syncOwnership(ticketId: string, technicianId: number, status?: string): Promise<void> {
    const normalizedStatus = (() => {
      const candidate = String(status || '').toUpperCase();
      if (candidate === 'OPEN' || candidate === 'IN_PROGRESS' || candidate === 'RESOLVED' || candidate === 'CLOSED') {
        return candidate;
      }
      return 'OPEN';
    })();

    await execute(
      `
        INSERT INTO tickets (id, assigned_to, status)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          assigned_to = VALUES(assigned_to),
          status = VALUES(status),
          updated_at = CURRENT_TIMESTAMP
      `,
      [ticketId, technicianId, normalizedStatus],
    );

    console.log(
      `[TicketRepository] ✔ Synced workflow ticket ownership | ticket=${ticketId} | assigned_to=${technicianId} | status=${normalizedStatus}`,
    );
  }

  /**
   * Sync workflow ticket cache with authoritative ticket-service snapshot.
   * Idempotent upsert: inserts new ticket or updates existing fields.
   */
  async syncTicketFromSource(ticket: TicketSyncPayload): Promise<void> {
    const assignedTo = this.toNumericUserId(ticket.assigned_to);
    const normalizedStatus = this.normalizeStatus(ticket.status);
    const assignedToLevel = this.normalizeSupportLevel(ticket.assigned_to_level);
    const supportLevel = this.normalizeSupportLevel(ticket.support_level);
    const priority = ticket.priority ? String(ticket.priority).toUpperCase() : null;
    const typeOfRequest = ticket.type_of_request ? String(ticket.type_of_request).toUpperCase() : null;
    const escalationCount = Number.isFinite(Number(ticket.escalation_count))
      ? Number(ticket.escalation_count)
      : 0;
    const createdAt = this.parseDate(ticket.created_at);
    const updatedAt = this.parseDate(ticket.updated_at);
    const resolvedAt = this.parseDate(ticket.resolved_at);
    const closedAt = this.parseDate(ticket.closed_at);

    await execute(
      `
        INSERT INTO tickets (
          id,
          requester_id,
          title,
          description,
          type_of_request,
          latitude,
          longitude,
          assigned_to,
          assigned_to_level,
          priority,
          support_level,
          status,
          escalation_count,
          resolution_summary,
          resolved_at,
          closed_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          requester_id = VALUES(requester_id),
          title = VALUES(title),
          description = VALUES(description),
          type_of_request = VALUES(type_of_request),
          latitude = VALUES(latitude),
          longitude = VALUES(longitude),
          assigned_to = VALUES(assigned_to),
          assigned_to_level = VALUES(assigned_to_level),
          priority = VALUES(priority),
          support_level = VALUES(support_level),
          status = VALUES(status),
          escalation_count = COALESCE(VALUES(escalation_count), escalation_count),
          resolution_summary = VALUES(resolution_summary),
          resolved_at = VALUES(resolved_at),
          closed_at = VALUES(closed_at),
          created_at = COALESCE(VALUES(created_at), created_at),
          updated_at = COALESCE(VALUES(updated_at), updated_at)
      `,
      [
        ticket.id,
        ticket.requester_id ?? null,
        ticket.title ?? null,
        ticket.description ?? null,
        typeOfRequest,
        ticket.latitude ?? null,
        ticket.longitude ?? null,
        assignedTo,
        assignedToLevel,
        priority,
        supportLevel,
        normalizedStatus,
        escalationCount,
        ticket.resolution_summary ?? null,
        resolvedAt,
        closedAt,
        createdAt,
        updatedAt,
      ],
    );

    console.log(
      `[TicketRepository] ✔ Synced workflow ticket snapshot | ticket=${ticket.id} | status=${normalizedStatus} | assigned_to=${assignedTo ?? 'null'}`,
    );
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

  private normalizeStatus(status?: string | null): string {
    const normalized = String(status || '').toUpperCase();
    if (['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(normalized)) {
      return normalized;
    }
    return 'OPEN';
  }

  private normalizeSupportLevel(level?: string | null): string | null {
    const normalized = String(level || '').toUpperCase();
    if (['L1', 'L2', 'L3', 'L4'].includes(normalized)) {
      return normalized;
    }
    return null;
  }

  private parseDate(value?: string | Date | null): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }
}
