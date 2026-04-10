import { RowDataPacket } from 'mysql2/promise';
import { execute, query } from '../config/database';
import { TechnicianRow } from '../interfaces/types';

interface TechnicianRowData extends TechnicianRow, RowDataPacket {}

/**
 * Technicians Repository
 *
 * Handles CRUD operations for the technicians table.
 */
export class TechnicianRepository {
  async getAvailableTechnicians(): Promise<TechnicianRow[]> {
    return query<TechnicianRowData[]>(
      `
        SELECT id, name, latitude, longitude, status
        FROM technicians
        WHERE status = 'ONLINE'
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
      `,
    );
  }

  async getById(id: number): Promise<TechnicianRow | null> {
    const rows = await query<TechnicianRowData[]>(
      'SELECT * FROM technicians WHERE id = ?',
      [id],
    );
    return rows[0] ?? null;
  }

  async updateLocation(id: number, latitude: number, longitude: number): Promise<void> {
    const result = await execute(
      `
        UPDATE technicians
        SET latitude = ?, longitude = ?, last_location_update = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [latitude, longitude, id],
    );

    if (result.affectedRows === 0) {
      throw new Error(`Technician ${id} not found`);
    }
  }
}
