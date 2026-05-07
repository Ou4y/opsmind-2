import { Request, Response } from 'express';
import { EscalationService } from '../services/EscalationService';
import { EscalationTrigger, UserRole } from '../interfaces/types';
import { TechnicianRepository } from '../repositories/TechnicianRepository';

/**
 * Escalation Controller (TypeScript)
 */
export class EscalationController {
  private escalationService = new EscalationService();
  private technicianRepo = new TechnicianRepository();

  /** POST /workflow/escalate/:ticketId */
  escalateTicket = async (req: Request, res: Response): Promise<void> => {
    try {
      const ticketId = req.params.ticketId;
      // Frontend sends: { reason, escalated_by, userRole }
      // Legacy payloads: { triggerType, performedBy }
      const triggerType = String(req.body.triggerType || 'MANUAL').toUpperCase() as EscalationTrigger;
      const reason = typeof req.body.reason === 'string' ? req.body.reason : undefined;

      let performedBy = this.toNumeric(req.body.escalated_by ?? req.body.performedBy);
      let userRole = this.normalizeRole(req.body.userRole);

      if (req.user?.userId) {
        const workflowTechnician = await this.technicianRepo.getByAuthUserId(req.user.userId);

        if (workflowTechnician) {
          performedBy = workflowTechnician.user_id;
          userRole = this.normalizeRole(workflowTechnician.level) || userRole;
        } else if (performedBy === null) {
          performedBy = this.toNumeric(req.user.userId);
        }

        if (!userRole) {
          userRole =
            this.normalizeRole(req.user.technicianLevel) ||
            this.normalizeRole(req.user.role);
        }
      }

      let result;

      if (triggerType === 'MANUAL') {
        result = await this.escalationService.manualEscalate(
          ticketId,
          performedBy,
          userRole as UserRole,
          reason || '',
        );
      } else {
        result = await this.escalationService.escalateTicket(
          ticketId,
          triggerType as EscalationTrigger,
          performedBy ?? null,
          userRole,
          reason,
        );
      }

      res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      console.error('Escalation error:', error);

      if (error.message.includes('not found')) {
        res.status(404).json({ success: false, message: error.message });
        return;
      }

      if (
        error.message.includes('can only') ||
        error.message.includes('highest escalation level') ||
        error.message.includes('Invalid manual escalation role')
      ) {
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

  private toNumeric(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private normalizeRole(value: unknown): UserRole | undefined {
    const normalized = String(value || '').toUpperCase();
    if (!normalized) {
      return undefined;
    }

    if (normalized === 'TECHNICIAN') {
      return 'JUNIOR';
    }

    if (normalized === 'HEAD_OF_IT') {
      return 'ADMIN';
    }

    if (normalized === 'JUNIOR' || normalized === 'SENIOR' || normalized === 'SUPERVISOR' || normalized === 'ADMIN') {
      return normalized;
    }

    return undefined;
  }
}
