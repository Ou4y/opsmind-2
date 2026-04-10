import { Request, Response } from 'express';
import { EscalationService } from '../services/EscalationService';
import { EscalationTrigger, UserRole } from '../interfaces/types';

/**
 * Escalation Controller (TypeScript)
 */
export class EscalationController {
  private escalationService = new EscalationService();

  /** POST /workflow/escalate/:ticketId */
  escalateTicket = async (req: Request, res: Response): Promise<void> => {
    try {
      const ticketId = req.params.ticketId;
      // Frontend sends: { reason, escalated_by }
      // Support legacy: { triggerType, performedBy, userRole }
      const triggerType = req.body.triggerType || 'MANUAL';
      const performedBy = req.body.escalated_by || req.body.performedBy;
      const userRole = req.body.userRole || req.user?.role || 'SENIOR';

      let result;

      if (triggerType === 'MANUAL') {
        result = await this.escalationService.manualEscalate(
          ticketId,
          performedBy ?? null,
          userRole as UserRole,
        );
      } else {
        result = await this.escalationService.escalateTicket(
          ticketId,
          triggerType as EscalationTrigger,
          performedBy ?? null,
        );
      }

      res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      console.error('Escalation error:', error);

      if (error.message.includes('does not have')) {
        res.status(403).json({ success: false, message: error.message });
        return;
      }

      res.status(400).json({ success: false, message: error.message });
    }
  };

  /** GET /workflow/escalate/:ticketId/history */
  getEscalationHistory = async (req: Request, res: Response): Promise<void> => {
    try {
      const ticketId = req.params.ticketId;
      const history = await this.escalationService.getEscalationHistory(ticketId);
      res.status(200).json({ success: true, data: { ticketId, escalations: history, count: history.length } });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  /** GET /workflow/group/:groupId/escalation-path */
  getEscalationPath = async (req: Request, res: Response): Promise<void> => {
    try {
      const groupId = parseInt(req.params.groupId, 10);
      const path = await this.escalationService.getEscalationPath(groupId);
      res.status(200).json({ success: true, data: { groupId, escalationRules: path } });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };
}
