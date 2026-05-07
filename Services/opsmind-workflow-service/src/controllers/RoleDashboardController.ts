import { Request, Response } from 'express';
import { RoleDashboardService, DashboardFilters } from '../services/RoleDashboardService';
import { TechnicianRepository } from '../repositories/TechnicianRepository';

export class RoleDashboardController {
  private service = new RoleDashboardService();
  private technicianRepo = new TechnicianRepository();

  getAdminOverview = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!this.isAdmin(req)) {
        res.status(403).json({ success: false, message: 'Admin access required' });
        return;
      }
      const filters = this.parseFilters(req);
      const data = await this.service.getAdminOverview(filters);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  getAdminTickets = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!this.isAdmin(req)) {
        res.status(403).json({ success: false, message: 'Admin access required' });
        return;
      }
      const filters = this.parseFilters(req);
      const data = await this.service.getAdminTickets(filters);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  getAdminTicketDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!this.isAdmin(req)) {
        res.status(403).json({ success: false, message: 'Admin access required' });
        return;
      }
      const ticketId = req.params.ticketId;
      const data = await this.service.getAdminTicketDetails(ticketId);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(403).json({ success: false, message: error.message });
    }
  };

  getSupervisorOverview = async (req: Request, res: Response): Promise<void> => {
    try {
      const supervisorUserId = this.parseUserId(req.params.workflowUserId, res);
      if (supervisorUserId === null) return;
      const viewer = await this.resolveViewer(req);
      if (!viewer.allowed) {
        res.status(viewer.status).json({ success: false, message: viewer.message });
        return;
      }
      if (!this.isRoleAllowed(viewer.level, 'SUPERVISOR') && !viewer.isAdmin) {
        res.status(403).json({ success: false, message: 'Supervisor access required' });
        return;
      }
      if (!viewer.isAdmin && viewer.workflowUserId !== supervisorUserId) {
        res.status(403).json({ success: false, message: 'Access denied for this supervisor' });
        return;
      }
      const filters = this.parseFilters(req);
      const data = await this.service.getSupervisorOverview(supervisorUserId, filters);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  getSupervisorTickets = async (req: Request, res: Response): Promise<void> => {
    try {
      const supervisorUserId = this.parseUserId(req.params.workflowUserId, res);
      if (supervisorUserId === null) return;
      const viewer = await this.resolveViewer(req);
      if (!viewer.allowed) {
        res.status(viewer.status).json({ success: false, message: viewer.message });
        return;
      }
      if (!this.isRoleAllowed(viewer.level, 'SUPERVISOR') && !viewer.isAdmin) {
        res.status(403).json({ success: false, message: 'Supervisor access required' });
        return;
      }
      if (!viewer.isAdmin && viewer.workflowUserId !== supervisorUserId) {
        res.status(403).json({ success: false, message: 'Access denied for this supervisor' });
        return;
      }
      const filters = this.parseFilters(req);
      const data = await this.service.getSupervisorTickets(supervisorUserId, filters);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  getSupervisorTicketDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const supervisorUserId = this.parseUserId(req.params.workflowUserId, res);
      if (supervisorUserId === null) return;
      const viewer = await this.resolveViewer(req);
      if (!viewer.allowed) {
        res.status(viewer.status).json({ success: false, message: viewer.message });
        return;
      }
      if (!this.isRoleAllowed(viewer.level, 'SUPERVISOR') && !viewer.isAdmin) {
        res.status(403).json({ success: false, message: 'Supervisor access required' });
        return;
      }
      if (!viewer.isAdmin && viewer.workflowUserId !== supervisorUserId) {
        res.status(403).json({ success: false, message: 'Access denied for this supervisor' });
        return;
      }
      const ticketId = req.params.ticketId;
      const data = await this.service.getSupervisorTicketDetails(supervisorUserId, ticketId);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(403).json({ success: false, message: error.message });
    }
  };

  getSeniorOverview = async (req: Request, res: Response): Promise<void> => {
    try {
      const seniorUserId = this.parseUserId(req.params.workflowUserId, res);
      if (seniorUserId === null) return;
      const viewer = await this.resolveViewer(req);
      if (!viewer.allowed) {
        res.status(viewer.status).json({ success: false, message: viewer.message });
        return;
      }
      if (!this.isRoleAllowed(viewer.level, 'SENIOR') && !viewer.isAdmin) {
        res.status(403).json({ success: false, message: 'Senior access required' });
        return;
      }
      if (!viewer.isAdmin && viewer.workflowUserId !== seniorUserId) {
        res.status(403).json({ success: false, message: 'Access denied for this senior' });
        return;
      }
      const filters = this.parseFilters(req);
      const data = await this.service.getSeniorOverview(seniorUserId, filters);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  getSeniorTickets = async (req: Request, res: Response): Promise<void> => {
    try {
      const seniorUserId = this.parseUserId(req.params.workflowUserId, res);
      if (seniorUserId === null) return;
      const viewer = await this.resolveViewer(req);
      if (!viewer.allowed) {
        res.status(viewer.status).json({ success: false, message: viewer.message });
        return;
      }
      if (!this.isRoleAllowed(viewer.level, 'SENIOR') && !viewer.isAdmin) {
        res.status(403).json({ success: false, message: 'Senior access required' });
        return;
      }
      if (!viewer.isAdmin && viewer.workflowUserId !== seniorUserId) {
        res.status(403).json({ success: false, message: 'Access denied for this senior' });
        return;
      }
      const filters = this.parseFilters(req);
      const data = await this.service.getSeniorTickets(seniorUserId, filters);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  getSeniorTicketDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const seniorUserId = this.parseUserId(req.params.workflowUserId, res);
      if (seniorUserId === null) return;
      const viewer = await this.resolveViewer(req);
      if (!viewer.allowed) {
        res.status(viewer.status).json({ success: false, message: viewer.message });
        return;
      }
      if (!this.isRoleAllowed(viewer.level, 'SENIOR') && !viewer.isAdmin) {
        res.status(403).json({ success: false, message: 'Senior access required' });
        return;
      }
      if (!viewer.isAdmin && viewer.workflowUserId !== seniorUserId) {
        res.status(403).json({ success: false, message: 'Access denied for this senior' });
        return;
      }
      const ticketId = req.params.ticketId;
      const data = await this.service.getSeniorTicketDetails(seniorUserId, ticketId);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(403).json({ success: false, message: error.message });
    }
  };

  getJuniorOverview = async (req: Request, res: Response): Promise<void> => {
    try {
      const juniorUserId = this.parseUserId(req.params.workflowUserId, res);
      if (juniorUserId === null) return;
      const viewer = await this.resolveViewer(req);
      if (!viewer.allowed) {
        res.status(viewer.status).json({ success: false, message: viewer.message });
        return;
      }
      if (!this.isRoleAllowed(viewer.level, 'JUNIOR') && !viewer.isAdmin) {
        res.status(403).json({ success: false, message: 'Junior access required' });
        return;
      }
      if (!viewer.isAdmin && viewer.workflowUserId !== juniorUserId) {
        res.status(403).json({ success: false, message: 'Access denied for this junior' });
        return;
      }
      const filters = this.parseFilters(req);
      const data = await this.service.getJuniorOverview(juniorUserId, filters);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  getJuniorTickets = async (req: Request, res: Response): Promise<void> => {
    try {
      const juniorUserId = this.parseUserId(req.params.workflowUserId, res);
      if (juniorUserId === null) return;
      const viewer = await this.resolveViewer(req);
      if (!viewer.allowed) {
        res.status(viewer.status).json({ success: false, message: viewer.message });
        return;
      }
      if (!this.isRoleAllowed(viewer.level, 'JUNIOR') && !viewer.isAdmin) {
        res.status(403).json({ success: false, message: 'Junior access required' });
        return;
      }
      if (!viewer.isAdmin && viewer.workflowUserId !== juniorUserId) {
        res.status(403).json({ success: false, message: 'Access denied for this junior' });
        return;
      }
      const filters = this.parseFilters(req);
      const data = await this.service.getJuniorTickets(juniorUserId, filters);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  getJuniorTicketDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const juniorUserId = this.parseUserId(req.params.workflowUserId, res);
      if (juniorUserId === null) return;
      const viewer = await this.resolveViewer(req);
      if (!viewer.allowed) {
        res.status(viewer.status).json({ success: false, message: viewer.message });
        return;
      }
      if (!this.isRoleAllowed(viewer.level, 'JUNIOR') && !viewer.isAdmin) {
        res.status(403).json({ success: false, message: 'Junior access required' });
        return;
      }
      if (!viewer.isAdmin && viewer.workflowUserId !== juniorUserId) {
        res.status(403).json({ success: false, message: 'Access denied for this junior' });
        return;
      }
      const ticketId = req.params.ticketId;
      const data = await this.service.getJuniorTicketDetails(juniorUserId, ticketId);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(403).json({ success: false, message: error.message });
    }
  };

  private parseUserId(value: string, res: Response): number | null {
    const userId = Number(value);
    if (!Number.isFinite(userId)) {
      res.status(400).json({ success: false, message: 'Invalid workflow user id' });
      return null;
    }
    return userId;
  }

  private parseFilters(req: Request): DashboardFilters {
    const query = req.query;
    const limit = query.limit ? Number(query.limit) : undefined;
    const offset = query.offset ? Number(query.offset) : undefined;
    const status = typeof query.status === 'string' ? query.status : undefined;
    const priority = typeof query.priority === 'string' ? query.priority : undefined;
    const assignedTo = typeof query.assignedTo === 'string'
      ? query.assignedTo
      : typeof query.assigned_to === 'string'
      ? query.assigned_to
      : undefined;
    const level = typeof query.level === 'string' ? query.level : undefined;
    const seniorId = typeof query.seniorId === 'string' ? Number(query.seniorId) : undefined;
    const supervisorId = typeof query.supervisorId === 'string' ? Number(query.supervisorId) : undefined;
    const dateFrom = typeof query.dateFrom === 'string' ? query.dateFrom : undefined;
    const dateTo = typeof query.dateTo === 'string' ? query.dateTo : undefined;
    const escalatedOnly = String(query.escalatedOnly || query.escalated_only || '').toLowerCase() === 'true';

    return {
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
      status,
      priority,
      assignedTo,
      level,
      seniorId: Number.isFinite(seniorId) ? seniorId : undefined,
      supervisorId: Number.isFinite(supervisorId) ? supervisorId : undefined,
      dateFrom,
      dateTo,
      escalatedOnly,
    };
  }

  private isAdmin(req: Request) {
    const roles = req.user?.roles || [];
    const role = req.user?.role;
    const techLevel = req.user?.technicianLevel;
    return roles.includes('ADMIN') || roles.includes('HEAD_OF_IT') || role === 'ADMIN' || role === 'HEAD_OF_IT' || techLevel === 'ADMIN';
  }

  private isRoleAllowed(level: string | null, required: 'JUNIOR' | 'SENIOR' | 'SUPERVISOR') {
    if (!level) return false;
    if (required === 'JUNIOR') return level === 'JUNIOR';
    if (required === 'SENIOR') return level === 'SENIOR';
    if (required === 'SUPERVISOR') return level === 'SUPERVISOR';
    return false;
  }

  private async resolveViewer(req: Request) {
    if (!req.user?.userId) {
      return { allowed: false, status: 401, message: 'Authentication required', workflowUserId: null, level: null, isAdmin: false };
    }

    const isAdmin = this.isAdmin(req);
    if (isAdmin) {
      return { allowed: true, status: 200, message: '', workflowUserId: null, level: 'ADMIN', isAdmin: true };
    }

    const workflowTechnician = await this.technicianRepo.getByAuthUserId(req.user.userId);
    if (!workflowTechnician) {
      return { allowed: false, status: 404, message: 'Technician profile not found', workflowUserId: null, level: null, isAdmin: false };
    }

    const level = workflowTechnician.level || req.user.technicianLevel || null;
    return { allowed: true, status: 200, message: '', workflowUserId: workflowTechnician.user_id, level, isAdmin: false };
  }
}
