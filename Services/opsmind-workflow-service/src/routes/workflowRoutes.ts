import { Router, Request, Response } from 'express';
import { RoutingController } from '../controllers/RoutingController';
import { ClaimController } from '../controllers/ClaimController';
import { ReassignmentController } from '../controllers/ReassignmentController';
import { EscalationController } from '../controllers/EscalationController';
import { MonitoringController } from '../controllers/MonitoringController';
import { TechnicianController } from '../controllers/TechnicianController';
import { LoggingService } from '../services/LoggingService';
import { TicketRoutingStateRepository } from '../repositories/TicketRoutingStateRepository';
import { SlaTrackingRepository } from '../repositories/SlaTrackingRepository';
import { MetricsService } from '../services/MetricsService';
import { optionalAuth } from '../middlewares/auth';
import { validateBody, updateTechnicianLocationSchema } from '../middlewares/validation';

const router = Router();

// ── Controller instances ──
const routingCtrl = new RoutingController();
const claimCtrl = new ClaimController();
const reassignCtrl = new ReassignmentController();
const escalationCtrl = new EscalationController();
const monitorCtrl = new MonitoringController();
const technicianCtrl = new TechnicianController();

// ── Service / Repo instances for new endpoints ──
const loggingService = new LoggingService();
const routingRepo = new TicketRoutingStateRepository();
const slaRepo = new SlaTrackingRepository();
const metricsService = new MetricsService();

// Apply optional auth to all routes (extracts user if token present)
router.use(optionalAuth);

// ══════════════════════════════════════
//  Health Check
// ══════════════════════════════════════
router.get('/health', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { pool } = await import('../config/database');
    await pool.execute('SELECT 1');
    res.status(200).json({
      status: 'OK',
      service: 'opsmind-workflow',
      database: 'connected',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  } catch (error: any) {
    res.status(500).json({
      status: 'ERROR',
      service: 'opsmind-workflow',
      database: 'disconnected',
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// ══════════════════════════════════════
//  Debug — Connectivity Check
//  Calls downstream services and reports reachability
// ══════════════════════════════════════
router.get('/debug/connectivity', async (_req: Request, res: Response): Promise<void> => {
  const services: Record<string, any> = {};

  // 1. Check ticket-service
  try {
    const { ticketServiceClient } = await import('../config/externalServices');
    const start = Date.now();
    const response = await ticketServiceClient.get('/health');
    const latency = Date.now() - start;
    services.ticketService = {
      status: 'reachable',
      url: 'http://opsmind-ticket-service:3000/health',
      httpStatus: response.status,
      latencyMs: latency,
      data: response.data,
    };
  } catch (error: any) {
    services.ticketService = {
      status: 'unreachable',
      url: 'http://opsmind-ticket-service:3000/health',
      error: error.code || error.message,
    };
  }

  // 2. Check auth-service
  try {
    const { authServiceClient } = await import('../config/externalServices');
    const start = Date.now();
    const response = await authServiceClient.get('/health');
    const latency = Date.now() - start;
    services.authService = {
      status: 'reachable',
      url: 'http://opsmind-auth-service:3002/health',
      httpStatus: response.status,
      latencyMs: latency,
      data: response.data,
    };
  } catch (error: any) {
    services.authService = {
      status: 'reachable-unknown',
      url: 'http://opsmind-auth-service:3002/health',
      error: error.code || error.message,
    };
  }

  // 3. Check own database
  try {
    const { pool } = await import('../config/database');
    const start = Date.now();
    await pool.execute('SELECT 1');
    const latency = Date.now() - start;
    services.database = {
      status: 'connected',
      latencyMs: latency,
    };
  } catch (error: any) {
    services.database = {
      status: 'disconnected',
      error: error.code || error.message,
    };
  }

  const allOk = Object.values(services).every((s: any) =>
    s.status === 'reachable' || s.status === 'connected',
  );

  res.status(allOk ? 200 : 503).json({
    success: allOk,
    timestamp: new Date().toISOString(),
    services,
  });
});

// ══════════════════════════════════════
//  Routing
// ══════════════════════════════════════
router.post('/route-ticket', routingCtrl.routeTicket);
router.get('/ticket/:ticketId/routing', routingCtrl.getTicketRouting);
router.get('/group/:groupId/queue', routingCtrl.getGroupQueue);
router.get('/group/:groupId/info', routingCtrl.getGroupInfo);

// ══════════════════════════════════════
//  Claim-on-Open
// ══════════════════════════════════════
router.post('/claim/:ticketId', claimCtrl.claimTicket);
router.get('/claim/:ticketId/status', claimCtrl.getClaimStatus);
router.get('/group/:groupId/unclaimed', claimCtrl.getUnclaimedTickets);

// ══════════════════════════════════════
//  Reassignment
// ══════════════════════════════════════
router.post('/reassign/:ticketId', reassignCtrl.reassignTicket);
router.get('/reassign/:ticketId/targets', reassignCtrl.getReassignmentTargets);

// ══════════════════════════════════════
//  Escalation
// ══════════════════════════════════════
router.post('/escalate/:ticketId', escalationCtrl.escalateTicket);
router.get('/escalate/:ticketId/history', escalationCtrl.getEscalationHistory);
router.get('/group/:groupId/escalation-path', escalationCtrl.getEscalationPath);

// ══════════════════════════════════════
//  Dashboards & Monitoring (existing)
// ══════════════════════════════════════
router.get('/dashboard/audit/:ticketId', monitorCtrl.getAuditTrail);
router.get('/dashboard/building/:buildingId', monitorCtrl.getBuildingDashboard);
router.get('/dashboard/member/:memberId', monitorCtrl.getMemberDashboard);
router.get('/dashboard/group/:groupId/metrics', monitorCtrl.getGroupMetrics);
router.get('/dashboard/activity/recent', monitorCtrl.getRecentActivity);

// ══════════════════════════════════════
//  Workflow Logs (NEW — frontend calls this)
//  GET /workflow/logs/:ticketId
// ══════════════════════════════════════
router.get('/logs/:ticketId', async (req: Request, res: Response): Promise<void> => {
  try {
    const ticketId = req.params.ticketId;
    const trail = await loggingService.getTicketAuditTrail(ticketId);
    res.status(200).json({ success: true, data: trail });
  } catch (error: any) {
    console.error('Error fetching workflow logs:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ══════════════════════════════════════
//  Group Tickets (NEW — frontend calls this)
//  GET /workflow/group/:groupId/tickets?status=&building=&technicianLevel=
// ══════════════════════════════════════
router.get('/group/:groupId/tickets', async (req: Request, res: Response): Promise<void> => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    const { status, building } = req.query;

    const tickets = await routingRepo.getGroupTicketsFiltered(groupId, {
      status: status as string | undefined,
      building: building as string | undefined,
    });

    res.status(200).json({ success: true, data: tickets });
  } catch (error: any) {
    console.error('Error fetching group tickets:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ══════════════════════════════════════
//  Technician Tickets (NEW — frontend calls this)
//  GET /workflow/technician/:technicianId/tickets?status=
// ══════════════════════════════════════
router.get('/technician/:technicianId/tickets', async (req: Request, res: Response): Promise<void> => {
  try {
    const technicianId = parseInt(req.params.technicianId, 10);
    const { status } = req.query;

    const tickets = await routingRepo.getTechnicianTickets(
      technicianId,
      status as string | undefined,
    );

    res.status(200).json({ success: true, data: tickets });
  } catch (error: any) {
    console.error('Error fetching technician tickets:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ══════════════════════════════════════
// ------------------------------
//  Technician Location Update (NEW)
//  PUT /workflow/technicians/location
// ------------------------------
router.put(
  '/technicians/location',
  validateBody(updateTechnicianLocationSchema),
  technicianCtrl.updateLocation,
);

//  SLA Status (NEW — frontend calls this)
//  POST /workflow/sla/status  body: { ticket_ids: [...] }
// ══════════════════════════════════════
router.post('/sla/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const { ticket_ids } = req.body;
    if (!ticket_ids || !Array.isArray(ticket_ids)) {
      res.status(400).json({ success: false, message: 'Missing required field: ticket_ids (array)' });
      return;
    }

    const slaRecords = await slaRepo.getByTicketIds(ticket_ids);

    // Build a map of ticket_id → SLA status
    const slaMap: Record<string, any> = {};
    for (const record of slaRecords) {
      const now = new Date();
      const deadline = new Date(record.sla_deadline);
      const timeRemaining = Math.max(0, deadline.getTime() - now.getTime());
      const timeRemainingMinutes = Math.round(timeRemaining / 1000 / 60);

      slaMap[record.ticket_id] = {
        ticket_id: record.ticket_id,
        priority: record.priority,
        sla_deadline: record.sla_deadline,
        sla_breached: record.sla_breached,
        breached_at: record.breached_at,
        at_risk: !record.sla_breached && timeRemainingMinutes <= 30 && timeRemainingMinutes > 0,
        time_remaining: timeRemainingMinutes,
        assigned_at: record.assigned_at,
      };
    }

    // For tickets not in sla_tracking, return null
    const result: Record<string, any> = {};
    for (const id of ticket_ids) {
      result[id] = slaMap[id] || null;
    }

    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    console.error('Error fetching SLA status:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ══════════════════════════════════════
//  Metrics (NEW — frontend calls this)
//  GET /workflow/metrics?start_date=&end_date=
// ══════════════════════════════════════
router.get('/metrics', async (req: Request, res: Response): Promise<void> => {
  try {
    const { start_date, end_date } = req.query;
    const metrics = await metricsService.getOverviewMetrics(
      start_date as string | undefined,
      end_date as string | undefined,
    );
    res.status(200).json({ success: true, data: metrics });
  } catch (error: any) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ══════════════════════════════════════
//  Team Metrics (NEW — frontend calls this)
//  GET /workflow/metrics/team/:groupId?start_date=&end_date=
// ══════════════════════════════════════
router.get('/metrics/team/:groupId', async (req: Request, res: Response): Promise<void> => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    const { start_date, end_date } = req.query;
    const metrics = await metricsService.getTeamMetrics(
      groupId,
      start_date as string | undefined,
      end_date as string | undefined,
    );
    res.status(200).json({ success: true, data: metrics });
  } catch (error: any) {
    console.error('Error fetching team metrics:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ══════════════════════════════════════
//  SLA Report (NEW — frontend calls this)
//  GET /workflow/reports/sla?start_date=&end_date=
// ══════════════════════════════════════
router.get('/reports/sla', async (req: Request, res: Response): Promise<void> => {
  try {
    const { start_date, end_date } = req.query;
    const report = await metricsService.getSLAReport(
      start_date as string | undefined,
      end_date as string | undefined,
    );
    res.status(200).json({ success: true, data: report });
  } catch (error: any) {
    console.error('Error fetching SLA report:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ══════════════════════════════════════
//  Escalation Report (NEW — frontend calls this)
//  GET /workflow/reports/escalations?start_date=&end_date=
// ══════════════════════════════════════
router.get('/reports/escalations', async (req: Request, res: Response): Promise<void> => {
  try {
    const { start_date, end_date } = req.query;
    const report = await metricsService.getEscalationReport(
      start_date as string | undefined,
      end_date as string | undefined,
    );
    res.status(200).json({ success: true, data: report });
  } catch (error: any) {
    console.error('Error fetching escalation report:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
