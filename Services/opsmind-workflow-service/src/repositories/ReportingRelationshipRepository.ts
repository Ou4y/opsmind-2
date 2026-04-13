import { RowDataPacket } from 'mysql2/promise';
import { execute, query } from '../config/database';
import { ReportingRelationshipRow } from '../interfaces/types';

interface ReportingRelationshipRowData extends ReportingRelationshipRow, RowDataPacket {}

/**
 * Reporting Relationships Repository
 *
 * Manages the flexible technician hierarchy.
 * No hardcoded limits - fully admin-managed.
 */
export class ReportingRelationshipRepository {
  /**
   * Get all direct reports for a given parent user
   */
  async getDirectReports(parentUserId: number): Promise<ReportingRelationshipRow[]> {
    return query<ReportingRelationshipRowData[]>(
      `
        SELECT *
        FROM reporting_relationships
        WHERE parent_user_id = ? AND is_active = TRUE
      `,
      [parentUserId],
    );
  }

  /**
   * Get the direct manager for a given user
   */
  async getManager(childUserId: number): Promise<ReportingRelationshipRow | null> {
    const rows = await query<ReportingRelationshipRowData[]>(
      `
        SELECT *
        FROM reporting_relationships
        WHERE child_user_id = ? AND is_active = TRUE
        LIMIT 1
      `,
      [childUserId],
    );
    return rows[0] ?? null;
  }

  /**
   * Get all juniors reporting to a specific senior
   */
  async getJuniorsForSenior(seniorUserId: number): Promise<number[]> {
    const rows = await query<ReportingRelationshipRowData[]>(
      `
        SELECT child_user_id
        FROM reporting_relationships
        WHERE parent_user_id = ?
          AND relationship_type = 'JUNIOR_TO_SENIOR'
          AND is_active = TRUE
      `,
      [seniorUserId],
    );
    return rows.map(row => row.child_user_id);
  }

  /**
   * Get all seniors reporting to a specific supervisor
   */
  async getSeniorsForSupervisor(supervisorUserId: number): Promise<number[]> {
    const rows = await query<ReportingRelationshipRowData[]>(
      `
        SELECT child_user_id
        FROM reporting_relationships
        WHERE parent_user_id = ?
          AND relationship_type = 'SENIOR_TO_SUPERVISOR'
          AND is_active = TRUE
      `,
      [supervisorUserId],
    );
    return rows.map(row => row.child_user_id);
  }

  /**
   * Get the full hierarchy chain for a user (all ancestors)
   */
  async getHierarchyChain(userId: number): Promise<number[]> {
    const chain: number[] = [];
    let currentUserId: number | null = userId;

    // Walk up the hierarchy (max 10 levels to prevent infinite loops)
    for (let i = 0; i < 10 && currentUserId; i++) {
      const manager = await this.getManager(currentUserId);
      if (!manager) break;
      
      chain.push(manager.parent_user_id);
      currentUserId = manager.parent_user_id;
    }

    return chain;
  }

  /**
   * Create a new reporting relationship
   */
  async create(
    childUserId: number,
    parentUserId: number,
    relationshipType: 'JUNIOR_TO_SENIOR' | 'SENIOR_TO_SUPERVISOR' | 'SUPERVISOR_TO_ADMIN',
  ): Promise<void> {
    await execute(
      `
        INSERT INTO reporting_relationships (child_user_id, parent_user_id, relationship_type, is_active)
        VALUES (?, ?, ?, TRUE)
        ON DUPLICATE KEY UPDATE
          relationship_type = VALUES(relationship_type),
          is_active = TRUE,
          updated_at = CURRENT_TIMESTAMP
      `,
      [childUserId, parentUserId, relationshipType],
    );
  }

  /**
   * Deactivate a reporting relationship (soft delete)
   */
  async deactivate(childUserId: number, parentUserId: number): Promise<void> {
    await execute(
      `
        UPDATE reporting_relationships
        SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
        WHERE child_user_id = ? AND parent_user_id = ?
      `,
      [childUserId, parentUserId],
    );
  }

  /**
   * Get all active relationships (for admin dashboard)
   */
  async getAllActive(): Promise<ReportingRelationshipRow[]> {
    return query<ReportingRelationshipRowData[]>(
      `
        SELECT *
        FROM reporting_relationships
        WHERE is_active = TRUE
        ORDER BY relationship_type, parent_user_id, child_user_id
      `,
    );
  }
}
