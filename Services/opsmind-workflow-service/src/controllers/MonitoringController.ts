import { Request, Response } from 'express';
import { LoggingService } from '../services/LoggingService';
import { DashboardService } from '../services/DashboardService';

/**
 * Monitoring Controller (TypeScript)
 *
 * Dashboards for Building (Senior), Supervisor, and Global (Head of IT).
 */
export class MonitoringController {
  private loggingService = new LoggingService();
  private dashboardService = new DashboardService();

  /** GET /workflow/dashboard/audit/:ticketId */
  getAuditTrail = async (req: Request, res: Response): Promise<void> => {
    try {
      const ticketId = req.params.ticketId;
      const trail = await this.loggingService.getTicketAuditTrail(ticketId);
      res.status(200).json({ success: true, data: trail });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  /** GET /workflow/dashboard/building/:buildingId */
  getBuildingDashboard = async (req: Request, res: Response): Promise<void> => {
    try {
      const { buildingId } = req.params;
      const dashboard = await this.dashboardService.getBuildingDashboard(buildingId);
      res.status(200).json({ success: true, data: dashboard });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  /** GET /workflow/dashboard/member/:memberId */
  getMemberDashboard = async (req: Request, res: Response): Promise<void> => {
    try {
      const memberId = parseInt(req.params.memberId, 10);
      const dashboard = await this.dashboardService.getMemberDashboard(memberId);
      res.status(200).json({ success: true, data: dashboard });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  /** GET /workflow/dashboard/group/:groupId/metrics */
  getGroupMetrics = async (req: Request, res: Response): Promise<void> => {
    try {
      const groupId = parseInt(req.params.groupId, 10);
      const metrics = await this.dashboardService.getGroupMetrics(groupId);
      res.status(200).json({ success: true, data: metrics });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  /** GET /workflow/dashboard/activity/recent */
  getRecentActivity = async (req: Request, res: Response): Promise<void> => {
    try {
      const limit = parseInt((req.query.limit as string) || '50', 10);
      const minutes = parseInt((req.query.minutes as string) || '60', 10);
      const activity = await this.loggingService.getRecentActivity(limit, minutes);
      res.status(200).json({ success: true, data: activity });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };
}
