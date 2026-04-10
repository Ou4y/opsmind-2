import { TechnicianRepository } from '../repositories/TechnicianRepository';
import { TechnicianStatus } from '../interfaces/types';

/**
 * Technician Service
 *
 * Contains business logic for technician profile & location updates.
 */
export class TechnicianService {
  private technicianRepo = new TechnicianRepository();

  async updateLocation(
    technicianId: number,
    latitude: number,
    longitude: number,
  ): Promise<{
    technician_id: number;
    latitude: number;
    longitude: number;
    status?: TechnicianStatus;
  }> {
    await this.technicianRepo.updateLocation(technicianId, latitude, longitude);
    const refreshed = await this.technicianRepo.getById(technicianId);

    return {
      technician_id: technicianId,
      latitude,
      longitude,
      status: refreshed?.status,
    };
  }
}
