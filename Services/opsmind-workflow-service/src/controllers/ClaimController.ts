import { Request, Response } from 'express';
import { ClaimService } from '../services/ClaimService';

/**
 * Claim Controller (TypeScript)
 */
export class ClaimController {
  private claimService = new ClaimService();

  /** POST /workflow/claim/:ticketId */
  claimTicket = async (req: Request, res: Response): Promise<void> => {
    try {
      const ticketId = req.params.ticketId;
      // Frontend sends { technician_id }, support legacy { userId } too
      const userId = req.body.technician_id || req.body.userId;

      if (!userId) {
        res.status(400).json({ success: false, message: 'Missing required field: technician_id' });
        return;
      }

      const result = await this.claimService.claimTicket(ticketId, userId);
      res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      console.error('Claim error:', error);

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
