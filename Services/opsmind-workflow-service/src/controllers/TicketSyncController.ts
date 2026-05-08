import { Request, Response } from 'express';
import { TicketRepository } from '../repositories/TicketRepository';
import { TicketSyncPayload } from '../interfaces/types';

/**
 * Internal Ticket Sync Controller
 */
export class TicketSyncController {
  private ticketRepo = new TicketRepository();

  /** POST /workflow/internal/tickets/sync */
  syncTicket = async (req: Request, res: Response): Promise<void> => {
    try {
      const source = String(req.body?.source || 'ticket-service');
      const ticket = (req.body?.ticket || req.body) as TicketSyncPayload;

      if (!ticket?.id) {
        res.status(400).json({ success: false, message: 'Missing required field: ticket.id' });
        return;
      }

      await this.ticketRepo.syncTicketFromSource(ticket);

      res.status(200).json({
        success: true,
        data: {
          ticketId: ticket.id,
          source,
        },
      });
    } catch (error: any) {
      console.error('Ticket sync error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  };
}
