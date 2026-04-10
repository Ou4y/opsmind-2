import { RowDataPacket } from 'mysql2/promise';
import { SupportGroupRepository } from '../repositories/SupportGroupRepository';
import { TicketRoutingStateRepository } from '../repositories/TicketRoutingStateRepository';
import { WorkflowLogRepository } from '../repositories/WorkflowLogRepository';
import { TicketRoutingStateRow, SupportGroupRow } from '../interfaces/types';
import { query, execute } from '../config/database';
import { ticketServiceClient } from '../config/externalServices';

/**
 * Routing Service (TypeScript)
 *
 * Auto-routes tickets based on building + floor → support group mapping.
 * Selects an available JUNIOR technician, calls Ticket Service to assign,
 * persists routing state, and logs the action.
 */
export class RoutingService {
  private groupRepo = new SupportGroupRepository();
  private routingRepo = new TicketRoutingStateRepository();
  private logRepo = new WorkflowLogRepository();

  /**
   * Route a ticket:
   *  1. Find SupportGroup by building + floor
   *  2. Select the least-loaded ACTIVE JUNIOR technician in that group
   *  3. PATCH ticket-service to set assigned_to + status=ASSIGNED
   *  4. Save routing_state with the assigned member
   *  5. Create workflow_log entry
   *  6. Return the assigned technician info
   */
  async routeTicket(
    ticketId: string,
    building: string,
    floor: number,
    priority?: string,
  ): Promise<any> {
    // 1. Find matching support group
    const group = await this.groupRepo.getGroupByBuildingAndFloor(building, floor);
    if (!group) {
      throw new Error(`No support group found for building: ${building}, floor: ${floor}`);
    }

    // 2. Select an available JUNIOR technician (least current assignments)
    const techSql = `
      SELECT gm.id AS member_id, gm.user_id
      FROM group_members gm
      LEFT JOIN (
        SELECT assigned_member_id, COUNT(*) AS ticket_count
        FROM ticket_routing_state
        WHERE status = 'ASSIGNED'
        GROUP BY assigned_member_id
      ) tc ON gm.id = tc.assigned_member_id
      WHERE gm.group_id = ? AND gm.role = 'JUNIOR' AND gm.status = 'ACTIVE'
      ORDER BY COALESCE(tc.ticket_count, 0) ASC
      LIMIT 1
    `;
    const techs = await query<RowDataPacket[]>(techSql, [group.id]);

    if (!techs.length) {
      throw new Error(
        `No available JUNIOR technician in group "${group.name}" (Building: ${building}, Floor: ${floor})`,
      );
    }

    const technician = techs[0];

    // 3. Call Ticket Service: PATCH /tickets/{id}
    //    Maps: JUNIOR → L1, status ASSIGNED → IN_PROGRESS
    try {
      await ticketServiceClient.patch(`/tickets/${ticketId}`, {
        assigned_to: String(technician.user_id),
        assigned_to_level: 'L1',
        status: 'IN_PROGRESS',
      });
    } catch (err: any) {
      const detail = err.response?.data?.message || err.message;
      throw new Error(`Failed to update ticket in Ticket Service: ${detail}`);
    }

    // 4. Save routing state (ASSIGNED with the chosen member)
    const insertSql = `
      INSERT INTO ticket_routing_state
        (ticket_id, current_group_id, assigned_member_id, status, claimed_at)
      VALUES (?, ?, ?, 'ASSIGNED', CURRENT_TIMESTAMP)
    `;
    const result = await execute(insertSql, [ticketId, group.id, technician.member_id]);

    // 5. Create workflow_log entry
    await this.logRepo.logAction(ticketId, 'ROUTED', {
      to_group_id: group.id,
      to_member_id: technician.member_id,
      reason: `Auto-routed to ${group.name} and assigned to technician (user ${technician.user_id})${priority ? ` | priority: ${priority}` : ''}`,
    });

    // 6. Return result
    return {
      ticketId,
      groupId: group.id,
      groupName: group.name,
      building: group.building,
      floor: group.floor,
      assignedTechnician: {
        memberId: technician.member_id,
        userId: technician.user_id,
      },
      priority: priority || null,
      status: 'ASSIGNED',
      routing_state: {
        id: result.insertId,
        ticket_id: ticketId,
        current_group_id: group.id,
        assigned_member_id: technician.member_id,
        status: 'ASSIGNED',
      },
    };
  }

  async getTicketRouting(ticketId: string): Promise<TicketRoutingStateRow | null> {
    return this.routingRepo.getByTicketId(ticketId);
  }

  async getGroupQueue(groupId: number): Promise<TicketRoutingStateRow[]> {
    return this.routingRepo.getGroupTickets(groupId);
  }

  async getGroupInfo(groupId: number): Promise<SupportGroupRow | null> {
    return this.groupRepo.getGroupById(groupId);
  }
}
