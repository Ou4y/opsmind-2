import { RowDataPacket } from 'mysql2/promise';
import { execute, query } from '../config/database';
import { TechnicianRow } from '../interfaces/types';

interface TechnicianRowData extends TechnicianRow, RowDataPacket {}

/**
 * Technicians Repository
 *
 * Handles CRUD operations for the technicians table.
 * Updated: Now includes user_id, email, level, and is_active fields
 */
export class TechnicianRepository {
  async getAvailableTechnicians(): Promise<TechnicianRow[]> {
    return query<TechnicianRowData[]>(
      `
        SELECT id, user_id, name, email, level, latitude, longitude, status, is_active
        FROM technicians
        WHERE status = 'ACTIVE'
          AND is_active = TRUE
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
      `,
    );
  }

  async getById(id: number): Promise<TechnicianRow | null> {
    const rows = await query<TechnicianRowData[]>(
      'SELECT * FROM technicians WHERE id = ? AND is_active = TRUE',
      [id],
    );
    return rows[0] ?? null;
  }

  async getByUserId(userId: number): Promise<TechnicianRow | null> {
    const rows = await query<TechnicianRowData[]>(
      'SELECT * FROM technicians WHERE user_id = ? AND is_active = TRUE',
      [userId],
    );
    return rows[0] ?? null;
  }

  async updateLocation(id: number, latitude: number, longitude: number): Promise<void> {
    const result = await execute(
      `
        UPDATE technicians
        SET latitude = ?, longitude = ?, last_location_update = CURRENT_TIMESTAMP
        WHERE id = ? AND is_active = TRUE
      `,
      [latitude, longitude, id],
    );

    if (result.affectedRows === 0) {
      throw new Error(`Technician ${id} not found or inactive`);
    }
  }

  /**
   * Get a supervisor (any ACTIVE technician with level 'SUPERVISOR')
   * Returns the first supervisor found, typically used for notifications
   */
  async getSupervisor(): Promise<TechnicianRow | null> {
    const rows = await query<TechnicianRowData[]>(
      `
        SELECT id, user_id, name, email, level, latitude, longitude, status, is_active
        FROM technicians
        WHERE level = 'SUPERVISOR' AND status = 'ACTIVE' AND is_active = TRUE
        LIMIT 1
      `,
    );
    return rows[0] ?? null;
  }

  /**
   * Get all technicians by level
   */
  async getByLevel(level: 'JUNIOR' | 'SENIOR' | 'SUPERVISOR' | 'ADMIN'): Promise<TechnicianRow[]> {
    return query<TechnicianRowData[]>(
      `
        SELECT *
        FROM technicians
        WHERE level = ? AND is_active = TRUE
        ORDER BY name
      `,
      [level],
    );
  }

  /**
   * Get technicians by their user_ids (batch fetch)
   */
  async getByUserIds(userIds: number[]): Promise<TechnicianRow[]> {
    if (userIds.length === 0) return [];
    
    const placeholders = userIds.map(() => '?').join(',');
    return query<TechnicianRowData[]>(
      `
        SELECT *
        FROM technicians
        WHERE user_id IN (${placeholders}) AND is_active = TRUE
      `,
      userIds,
    );
  }
}
