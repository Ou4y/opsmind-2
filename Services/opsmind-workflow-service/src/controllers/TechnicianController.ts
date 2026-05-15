import { Request, Response } from 'express';
import { TechnicianService } from '../services/TechnicianService';

/**
 * Technician Controller
 */
export class TechnicianController {
  private technicianService = new TechnicianService();

  /** GET /workflow/technicians/me */
  getCurrentTechnician = async (req: Request, res: Response): Promise<void> => {
    try {
      const authUserId = req.user?.userId;

      if (!authUserId) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }

      const technician = await this.technicianService.getByAuthUserId(authUserId);

      if (!technician) {
        res.status(404).json({
          success: false,
          message: 'Technician profile not found for authenticated user',
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          authUserId: technician.auth_user_id || authUserId,
          workflowUserId: technician.user_id,
          technicianId: technician.id,
          level: technician.level,
          name: technician.name,
          email: technician.email,
          status: technician.status,
          isActive: technician.is_active,
        },
      });
    } catch (error: any) {
      console.error('Error fetching technician profile:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch technician profile' });
    }
  };

  /** PATCH /workflow/technicians/:technicianId/location */
  updateLocationByPath = async (req: Request, res: Response): Promise<void> => {
    try {
      const technicianId = Number(req.params.technicianId);
      const { latitude, longitude } = req.body;
      if (!Number.isFinite(technicianId)) {
        res.status(400).json({ success: false, message: 'Invalid technicianId path parameter' });
        return;
      }

      const auth = await this.authorizeLocationUpdate(req, technicianId);
      if (!auth.allowed) {
        res.status(auth.status).json({ success: false, message: auth.message });
        return;
      }

      const result = await this.technicianService.updateLocationByWorkflowUserId(technicianId, Number(latitude), Number(longitude));

      res.status(200).json({
        success: true,
        data: {
          technicianId: result.workflow_user_id ?? technicianId,
          latitude: result.latitude,
          longitude: result.longitude,
          lastLocationUpdate: result.last_location_update ?? null,
          status: result.status,
        },
      });
    } catch (error: any) {
      console.error('Error updating technician location by path:', error);

      if (error.message?.includes('not found')) {
        res.status(404).json({ success: false, message: error.message });
        return;
      }

      res.status(500).json({ success: false, message: 'Failed to update technician location' });
    }
  };

  /** PUT /workflow/technicians/location (legacy compatibility) */
  updateLocation = async (req: Request, res: Response): Promise<void> => {
    try {
      const { technician_id, latitude, longitude } = req.body;
      const technicianId = Number(technician_id);
      if (!Number.isFinite(technicianId)) {
        res.status(400).json({ success: false, message: 'Invalid technician_id in request body' });
        return;
      }

      const auth = await this.authorizeLocationUpdate(req, technicianId);
      if (!auth.allowed) {
        res.status(auth.status).json({ success: false, message: auth.message });
        return;
      }

      const result = await this.technicianService.updateLocationByWorkflowUserId(
        technicianId,
        Number(latitude),
        Number(longitude),
      );

      res.status(200).json({
        success: true,
        data: {
          technician_id: result.workflow_user_id ?? technicianId,
          latitude: result.latitude,
          longitude: result.longitude,
          last_location_update: result.last_location_update ?? null,
          status: result.status,
        },
      });
    } catch (error: any) {
      console.error('Error updating technician location:', error);

      if (error.message?.includes('not found')) {
        res.status(404).json({ success: false, message: error.message });
        return;
      }

      res.status(500).json({ success: false, message: 'Failed to update technician location' });
    }
  };

  private isAdmin(req: Request): boolean {
    const normalizedRoles = (req.user?.roles || []).map((role) => String(role).toUpperCase());
    const normalizedRole = String(req.user?.role || '').toUpperCase();
    const normalizedTechLevel = String(req.user?.technicianLevel || '').toUpperCase();

    return (
      normalizedRoles.includes('ADMIN') ||
      normalizedRoles.includes('HEAD_OF_IT') ||
      normalizedRole === 'ADMIN' ||
      normalizedRole === 'HEAD_OF_IT' ||
      normalizedTechLevel === 'ADMIN'
    );
  }

  private async authorizeLocationUpdate(
    req: Request,
    targetWorkflowUserId: number,
  ): Promise<{ allowed: boolean; status: number; message: string }> {
    const authUserId = req.user?.userId;
    if (!authUserId) {
      return { allowed: false, status: 401, message: 'Authentication required' };
    }

    if (this.isAdmin(req)) {
      return { allowed: true, status: 200, message: '' };
    }

    const actor = await this.technicianService.getByAuthUserId(authUserId);
    if (!actor) {
      return { allowed: false, status: 404, message: 'Technician profile not found for authenticated user' };
    }

    if (actor.user_id !== targetWorkflowUserId) {
      return { allowed: false, status: 403, message: 'You can only update your own location' };
    }

    return { allowed: true, status: 200, message: '' };
  }
}
