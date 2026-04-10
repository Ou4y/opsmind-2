import { Request, Response } from 'express';
import { RoutingService } from '../services/RoutingService';
import { AssignmentService } from '../services/AssignmentService';

/**
 * Routing Controller (TypeScript)
 *
 * Handles ticket assignment and routing state queries.
 * Assignment is location-based (coordinates + workload), not building/floor-based.
 */
export class RoutingController {
  private routingService = new RoutingService();
  private assignmentService = new AssignmentService();

  /** POST /workflow/route-ticket */
  routeTicket = async (req: Request, res: Response): Promise<void> => {
    try {
      const { ticketId, latitude, longitude, priority } = req.body;

      if (!ticketId || latitude === undefined || longitude === undefined) {
        res.status(400).json({ success: false, message: 'Missing required fields: ticketId, latitude, longitude' });
        return;
      }

      const result = await this.assignmentService.assignForTicket({
        ticket_id: ticketId,
        latitude: Number(latitude),
        longitude: Number(longitude),
        priority,
      });

      if (result === null) {
        res.status(200).json({ success: true, message: 'Ticket already assigned — skipped.' });
        return;
      }

      res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      console.error('Routing error:', error);
      res.status(400).json({ success: false, message: error.message });
    }
  };

  /** GET /workflow/ticket/:ticketId/routing */
  getTicketRouting = async (req: Request, res: Response): Promise<void> => {
    try {
      const ticketId = req.params.ticketId;
      const routing = await this.routingService.getTicketRouting(ticketId);

      if (!routing) {
        res.status(404).json({ success: false, message: `Ticket ${ticketId} not found in workflow system` });
        return;
      }

      res.status(200).json({ success: true, data: routing });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  /** GET /workflow/group/:groupId/queue */
  getGroupQueue = async (req: Request, res: Response): Promise<void> => {
    try {
      const groupId = parseInt(req.params.groupId, 10);
      const queue = await this.routingService.getGroupQueue(groupId);
      res.status(200).json({ success: true, data: { groupId, tickets: queue } });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  /** GET /workflow/group/:groupId/info */
  getGroupInfo = async (req: Request, res: Response): Promise<void> => {
    try {
      const groupId = parseInt(req.params.groupId, 10);
      const info = await this.routingService.getGroupInfo(groupId);

      if (!info) {
        res.status(404).json({ success: false, message: `Group ${groupId} not found` });
        return;
      }

      res.status(200).json({ success: true, data: info });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };
}
