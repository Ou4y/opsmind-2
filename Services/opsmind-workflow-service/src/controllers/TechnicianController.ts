import { Request, Response } from 'express';
import { TechnicianService } from '../services/TechnicianService';

/**
 * Technician Controller
 */
export class TechnicianController {
  private technicianService = new TechnicianService();

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
