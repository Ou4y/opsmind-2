import { RowDataPacket } from 'mysql2/promise';
import { execute, query } from '../config/database';
import { AuthRole, TechnicianRow } from '../interfaces/types';

interface TechnicianRowData extends TechnicianRow, RowDataPacket {}

interface AuthIdentityMapRow extends RowDataPacket {
  workflow_user_id: number;
  auth_user_id: string;
  auth_role: AuthRole;
}

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
        SELECT id, user_id, auth_user_id, name, email, level, latitude, longitude, status, is_active, last_location_update, created_at, updated_at
        FROM technicians
        WHERE status = 'ACTIVE'
          AND is_active = TRUE
          AND level = 'JUNIOR'
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
        SELECT id, user_id, auth_user_id, name, email, level, latitude, longitude, status, is_active, last_location_update, created_at, updated_at
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

  async getByAuthUserId(authUserId: string): Promise<TechnicianRow | null> {
    const rows = await query<TechnicianRowData[]>(
      'SELECT * FROM technicians WHERE auth_user_id = ? AND is_active = TRUE',
      [authUserId],
    );
    return rows[0] ?? null;
  }

  private async getOrCreateWorkflowUserId(authUserId: string, authRole: AuthRole): Promise<number> {
    const existing = await query<AuthIdentityMapRow[]>(
      'SELECT workflow_user_id FROM auth_user_identity_map WHERE auth_user_id = ? LIMIT 1',
      [authUserId],
    );

    if (existing[0]) {
      await execute(
        'UPDATE auth_user_identity_map SET auth_role = ?, updated_at = CURRENT_TIMESTAMP WHERE auth_user_id = ?',
        [authRole, authUserId],
      );
      return existing[0].workflow_user_id;
    }

    await execute(
      'INSERT INTO auth_user_identity_map (auth_user_id, auth_role) VALUES (?, ?)',
      [authUserId, authRole],
    );

    const created = await query<AuthIdentityMapRow[]>(
      'SELECT workflow_user_id FROM auth_user_identity_map WHERE auth_user_id = ? LIMIT 1',
      [authUserId],
    );

    if (!created[0]) {
      throw new Error('Failed to reserve workflow user identity');
    }

    return created[0].workflow_user_id;
  }

  async upsertFromAuth(data: {
    authUserId: string;
    firstName: string;
    lastName: string;
    email: string;
    authRole: AuthRole;
    technicianLevel: 'JUNIOR' | 'SENIOR' | 'SUPERVISOR' | 'ADMIN';
  }): Promise<TechnicianRow> {
    const workflowUserId = await this.getOrCreateWorkflowUserId(data.authUserId, data.authRole);
    const displayName = `${data.firstName} ${data.lastName}`.trim();

    await execute(
      `INSERT INTO technicians (user_id, auth_user_id, name, email, level, status, is_active)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE', TRUE)
       ON DUPLICATE KEY UPDATE
         user_id = VALUES(user_id),
         auth_user_id = VALUES(auth_user_id),
         name = VALUES(name),
         email = VALUES(email),
         level = VALUES(level),
         is_active = TRUE,
         updated_at = CURRENT_TIMESTAMP`,
      [workflowUserId, data.authUserId, displayName, data.email, data.technicianLevel],
    );

    const synced = await this.getByAuthUserId(data.authUserId);
    if (!synced) {
      throw new Error('Technician sync succeeded but no technician row was found');
    }

    return synced;
  }
}
