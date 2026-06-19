import { Request, Response } from 'express';
import { ReassignmentService } from '../services/ReassignmentService';
import { UserRole } from '../interfaces/types';

/**
 * Reassignment Controller (TypeScript)
 */
export class ReassignmentController {
  private reassignmentService = new ReassignmentService();

  /** POST /workflow/reassign/:ticketId */
  reassignTicket = async (req: Request, res: Response): Promise<void> => {
    try {
      const ticketId = req.params.ticketId;
      // Frontend sends: { to_technician_id, reason, reassigned_by }
      // Support legacy: { toMemberId, userBuilding }
      const toMemberId = req.body.to_technician_id || req.body.toMemberId;
      const userId = req.user?.userId;
      const userRole = req.user?.technicianLevel || req.user?.role || 'SENIOR';
      const userBuilding = req.body.userBuilding;

      if (!toMemberId) {
        res.status(400).json({ success: false, message: 'Missing required field: to_technician_id' });
        return;
      }

      if (!userId) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }

      const actorWorkflowUserId = Number.parseInt(String(userId), 10);
      if (!Number.isFinite(actorWorkflowUserId)) {
        res.status(400).json({ success: false, message: 'Authenticated workflow user id must be numeric' });
        return;
      }

      const result = await this.reassignmentService.reassignTicket(
        ticketId,
        actorWorkflowUserId,
        toMemberId,
        userRole as UserRole,
        userBuilding,
      );

      res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      console.error('Reassignment error:', error);

      if (error.message.includes('can only reassign')) {
        res.status(403).json({ success: false, message: error.message });
        return;
      }

      res.status(400).json({ success: false, message: error.message });
    }
  };

  /** GET /workflow/reassign/:ticketId/targets */
  getReassignmentTargets = async (req: Request, res: Response): Promise<void> => {
    try {
      const ticketId = req.params.ticketId;
      const { groupId, userBuilding } = req.query;
      const userRole = req.user?.technicianLevel || req.user?.role;

      if (!groupId) {
        res.status(400).json({ success: false, message: 'Missing required query param: groupId' });
        return;
      }

      if (!userRole) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }

      const targets = await this.reassignmentService.getAvailableTargets(
        parseInt(groupId as string, 10),
        userRole as UserRole,
        userBuilding as string | undefined,
      );

      res.status(200).json({ success: true, data: { ticketId, availableTargets: targets, count: targets.length } });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };
}
