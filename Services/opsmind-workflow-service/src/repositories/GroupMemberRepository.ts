import { RowDataPacket } from 'mysql2/promise';
import { query, execute } from '../config/database';
import { GroupMemberRow, MemberRole, MemberStatus, SupportGroupRow } from '../interfaces/types';

interface GroupMemberRowData extends GroupMemberRow, RowDataPacket {}
interface MemberWithGroupRow extends GroupMemberRow, SupportGroupRow, RowDataPacket {}

/**
 * Group Members Repository (TypeScript)
 */
export class GroupMemberRepository {
  async addMember(
    userId: number,
    groupId: number,
    role: MemberRole,
    canAssign: boolean = false,
    canEscalate: boolean = false,
  ): Promise<{ id: number; user_id: number; group_id: number; role: MemberRole }> {
    const sql = `
      INSERT INTO group_members (user_id, group_id, role, can_assign, can_escalate, status)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE')
    `;
    const result = await execute(sql, [userId, groupId, role, canAssign ? 1 : 0, canEscalate ? 1 : 0]);
    return { id: result.insertId, user_id: userId, group_id: groupId, role };
  }

  async getMemberById(memberId: number): Promise<GroupMemberRow | null> {
    const sql = `SELECT * FROM group_members WHERE id = ?`;
    const rows = await query<GroupMemberRowData[]>(sql, [memberId]);
    return rows[0] ?? null;
  }

  async getMemberByUserAndGroup(userId: number, groupId: number): Promise<GroupMemberRow | null> {
    const sql = `
      SELECT * FROM group_members
      WHERE user_id = ? AND group_id = ?
    `;
    const rows = await query<GroupMemberRowData[]>(sql, [userId, groupId]);
    return rows[0] ?? null;
  }

  async updateMemberStatus(memberId: number, status: MemberStatus): Promise<void> {
    const sql = `
      UPDATE group_members
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
    await execute(sql, [status, memberId]);
  }

  async canAssign(memberId: number): Promise<boolean> {
    const sql = `SELECT can_assign FROM group_members WHERE id = ?`;
    const rows = await query<GroupMemberRowData[]>(sql, [memberId]);
    return !!rows[0]?.can_assign;
  }

  async canEscalate(memberId: number): Promise<boolean> {
    const sql = `SELECT can_escalate FROM group_members WHERE id = ?`;
    const rows = await query<GroupMemberRowData[]>(sql, [memberId]);
    return !!rows[0]?.can_escalate;
  }

  async getMemberGroups(userId: number): Promise<MemberWithGroupRow[]> {
    const sql = `
      SELECT gm.*, sg.*
      FROM group_members gm
      JOIN support_groups sg ON gm.group_id = sg.id
      WHERE gm.user_id = ? AND gm.status = 'ACTIVE'
    `;
    return query<MemberWithGroupRow[]>(sql, [userId]);
  }

  /** Remove a member from a group */
  async removeMember(memberId: number): Promise<void> {
    const sql = `DELETE FROM group_members WHERE id = ?`;
    await execute(sql, [memberId]);
  }

  /** Get members with user info for a specific group */
  async getGroupMembersWithInfo(groupId: number): Promise<any[]> {
    // Since we don't have user table here, return member data
    // The username can be fetched from auth service if needed
    const sql = `
      SELECT gm.id, gm.user_id, gm.group_id, gm.role, 
             gm.can_assign, gm.can_escalate, gm.status, 
             gm.joined_at, gm.updated_at
      FROM group_members gm
      WHERE gm.group_id = ? AND gm.status = 'ACTIVE'
      ORDER BY gm.role DESC, gm.joined_at ASC
    `;
    return query<RowDataPacket[]>(sql, [groupId]);
  }
}
