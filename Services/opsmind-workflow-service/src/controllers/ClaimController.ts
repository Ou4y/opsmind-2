import { Request, Response } from 'express';
import { ClaimService } from '../services/ClaimService';
import { TechnicianRepository } from '../repositories/TechnicianRepository';

/**
 * Claim Controller (TypeScript)
 */
export class ClaimController {
  private claimService = new ClaimService();
  private technicianRepo = new TechnicianRepository();

  /** POST /workflow/claim/:ticketId */
  claimTicket = async (req: Request, res: Response): Promise<void> => {
    try {
      const ticketId = req.params.ticketId;
      const authUserId = req.user?.userId;

      if (!authUserId) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }

      // Security: never trust frontend-supplied technician IDs for protected actions.
      // Resolve the workflow user from authenticated token context.
      let technician = await this.technicianRepo.getByAuthUserId(authUserId);

      if (!technician) {
        const numericUserId = Number(authUserId);
        if (Number.isInteger(numericUserId)) {
          technician = await this.technicianRepo.getByUserId(numericUserId);
        }
      }

      if (!technician) {
        res.status(403).json({
          success: false,
          message: 'Authenticated user is not mapped to an active workflow technician profile',
        });
        return;
      }

      res.status(403).json({
        success: false,
        message: 'Manual ticket claiming is disabled. Tickets are assigned automatically by workflow rules.',
        data: {
          ticketId,
          technicianUserId: technician.user_id,
        },
      });
      return;
    } catch (error: any) {
      console.error('Claim error:', error);

      if (error.message.includes('disabled')) {
        res.status(403).json({ success: false, message: error.message });
        return;
      }

      if (error.message.includes('already claimed')) {
        res.status(409).json({ success: false, message: error.message });
        return;
      }

      res.status(400).json({ success: false, message: error.message });
    }
  };

  /** GET /workflow/claim/:ticketId/status */
  getClaimStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const ticketId = req.params.ticketId;
      const claimed = await this.claimService.isTicketClaimed(ticketId);
      res.status(200).json({ success: true, data: { ticketId, claimed } });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  /** GET /workflow/group/:groupId/unclaimed */
  getUnclaimedTickets = async (req: Request, res: Response): Promise<void> => {
    try {
      const groupId = parseInt(req.params.groupId, 10);
      const tickets = await this.claimService.getUnclaimedTickets(groupId);
      res.status(200).json({ success: true, data: { groupId, unclaimedTickets: tickets, count: tickets.length } });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };
}
