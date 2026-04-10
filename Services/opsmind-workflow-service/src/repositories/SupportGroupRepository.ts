import { RowDataPacket } from 'mysql2/promise';
import { query, execute } from '../config/database';
import { SupportGroupRow, GroupMemberRow } from '../interfaces/types';

/**
 * Support Groups Repository (TypeScript)
 */

// Extend RowDataPacket for mysql2 type compatibility
interface SupportGroupRowData extends SupportGroupRow, RowDataPacket {}
interface GroupMemberRowData extends GroupMemberRow, RowDataPacket {}

export class SupportGroupRepository {
  async getGroupByBuildingAndFloor(building: string, floor: number): Promise<SupportGroupRow | null> {
    const sql = `
      SELECT * FROM support_groups
      WHERE building = ? AND floor = ? AND is_active = TRUE
    `;
    const rows = await query<SupportGroupRowData[]>(sql, [building, floor]);
    return rows[0] ?? null;
  }

  async getGroupsByBuilding(building: string): Promise<SupportGroupRow[]> {
    const sql = `
      SELECT * FROM support_groups
      WHERE building = ? AND is_active = TRUE
      ORDER BY floor ASC
    `;
    return query<SupportGroupRowData[]>(sql, [building]);
  }

  async getGroupById(groupId: number): Promise<SupportGroupRow | null> {
    const sql = `SELECT * FROM support_groups WHERE id = ?`;
    const rows = await query<SupportGroupRowData[]>(sql, [groupId]);
    return rows[0] ?? null;
  }

  async createGroup(
    name: string,
    building: string,
    floor: number,
    parentGroupId: number | null = null,
  ): Promise<{ id: number; name: string; building: string; floor: number; parent_group_id: number | null }> {
    const sql = `
      INSERT INTO support_groups (name, building, floor, parent_group_id, is_active)
      VALUES (?, ?, ?, ?, TRUE)
    `;
    const result = await execute(sql, [name, building, floor, parentGroupId]);
    return { id: result.insertId, name, building, floor, parent_group_id: parentGroupId };
  }

  async getGroupMembers(groupId: number): Promise<GroupMemberRow[]> {
    const sql = `
      SELECT * FROM group_members
      WHERE group_id = ? AND status = 'ACTIVE'
      ORDER BY role DESC, joined_at ASC
    `;
    return query<GroupMemberRowData[]>(sql, [groupId]);
  }

  async getGroupSenior(groupId: number): Promise<GroupMemberRow | null> {
    const sql = `
      SELECT * FROM group_members
      WHERE group_id = ? AND role = 'SENIOR' AND status = 'ACTIVE'
      LIMIT 1
    `;
    const rows = await query<GroupMemberRowData[]>(sql, [groupId]);
    return rows[0] ?? null;
  }

  async getGroupJuniors(groupId: number): Promise<GroupMemberRow[]> {
    const sql = `
      SELECT * FROM group_members
      WHERE group_id = ? AND role = 'JUNIOR' AND status = 'ACTIVE'
      ORDER BY joined_at ASC
    `;
    return query<GroupMemberRowData[]>(sql, [groupId]);
  }

  /** Get all active support groups with member count */
  async getAllGroupsWithMemberCount(): Promise<any[]> {
    const sql = `
      SELECT sg.*, 
        (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = sg.id AND gm.status = 'ACTIVE') as member_count
      FROM support_groups sg
      WHERE sg.is_active = TRUE
      ORDER BY sg.building ASC, sg.floor ASC
    `;
    return query<RowDataPacket[]>(sql, []);
  }

  /** Get all active support groups */
  async getAllGroups(): Promise<SupportGroupRow[]> {
    const sql = `SELECT * FROM support_groups WHERE is_active = TRUE ORDER BY building ASC, floor ASC`;
    return query<SupportGroupRowData[]>(sql, []);
  }

  /** Update a support group */
  async updateGroup(
    groupId: number,
    data: { name?: string; building?: string; floor?: number; parent_group_id?: number | null },
  ): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.building !== undefined) { fields.push('building = ?'); values.push(data.building); }
    if (data.floor !== undefined) { fields.push('floor = ?'); values.push(data.floor); }
    if (data.parent_group_id !== undefined) { fields.push('parent_group_id = ?'); values.push(data.parent_group_id); }

    if (fields.length === 0) return;

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(groupId);

    const sql = `UPDATE support_groups SET ${fields.join(', ')} WHERE id = ?`;
    await execute(sql, values);
  }

  /** Soft-delete a support group */
  async deleteGroup(groupId: number): Promise<void> {
    const sql = `UPDATE support_groups SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
    await execute(sql, [groupId]);
  }
}
