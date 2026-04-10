import { RowDataPacket } from 'mysql2/promise';
import { query, execute } from '../config/database';
import { EscalationRuleRow, EscalationTrigger } from '../interfaces/types';

interface EscalationRuleRowData extends EscalationRuleRow, RowDataPacket {}

interface EscalationRuleWithNames extends EscalationRuleRow, RowDataPacket {
  source_group_name: string;
  target_group_name: string;
}

/**
 * Escalation Rules Repository (TypeScript)
 */
export class EscalationRuleRepository {
  async getRulesForGroup(groupId: number): Promise<EscalationRuleRow[]> {
    const sql = `
      SELECT * FROM escalation_rules
      WHERE source_group_id = ? AND is_active = TRUE
      ORDER BY priority DESC
    `;
    return query<EscalationRuleRowData[]>(sql, [groupId]);
  }

  async getRuleByTrigger(sourceGroupId: number, triggerType: EscalationTrigger): Promise<EscalationRuleRow | null> {
    const sql = `
      SELECT * FROM escalation_rules
      WHERE source_group_id = ? AND trigger_type = ? AND is_active = TRUE
      LIMIT 1
    `;
    const rows = await query<EscalationRuleRowData[]>(sql, [sourceGroupId, triggerType]);
    return rows[0] ?? null;
  }

  async getRulesByTriggers(sourceGroupId: number, triggerTypes: EscalationTrigger[]): Promise<EscalationRuleRow[]> {
    const placeholders = triggerTypes.map(() => '?').join(',');
    const sql = `
      SELECT * FROM escalation_rules
      WHERE source_group_id = ? AND trigger_type IN (${placeholders}) AND is_active = TRUE
      ORDER BY priority DESC
    `;
    return query<EscalationRuleRowData[]>(sql, [sourceGroupId, ...triggerTypes]);
  }

  async createRule(
    sourceGroupId: number,
    targetGroupId: number,
    triggerType: EscalationTrigger,
    delayMinutes: number = 0,
    priority: number = 0,
  ): Promise<{ id: number }> {
    const sql = `
      INSERT INTO escalation_rules
        (source_group_id, target_group_id, trigger_type, delay_minutes, priority, is_active)
      VALUES (?, ?, ?, ?, ?, TRUE)
    `;
    const result = await execute(sql, [sourceGroupId, targetGroupId, triggerType, delayMinutes, priority]);
    return { id: result.insertId };
  }

  async getAllRules(): Promise<EscalationRuleWithNames[]> {
    const sql = `
      SELECT er.*, sg.name AS source_group_name, tg.name AS target_group_name
      FROM escalation_rules er
      LEFT JOIN support_groups sg ON er.source_group_id = sg.id
      LEFT JOIN support_groups tg ON er.target_group_id = tg.id
      WHERE er.is_active = TRUE
    `;
    return query<EscalationRuleWithNames[]>(sql, []);
  }
}
