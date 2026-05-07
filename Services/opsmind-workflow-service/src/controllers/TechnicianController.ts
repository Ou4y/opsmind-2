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

  /** PUT /workflow/technicians/location */
  updateLocation = async (req: Request, res: Response): Promise<void> => {
    try {
      const { technician_id, latitude, longitude } = req.body;

      const result = await this.technicianService.updateLocation(
        Number(technician_id),
        Number(latitude),
        Number(longitude),
      );

      res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      console.error('Error updating technician location:', error);

      if (error.message?.includes('not found')) {
        res.status(404).json({ success: false, message: error.message });
        return;
      }

      res.status(500).json({ success: false, message: 'Failed to update technician location' });
    }
  };
}
