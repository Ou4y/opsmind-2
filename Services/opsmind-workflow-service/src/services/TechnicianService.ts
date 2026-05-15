import { TechnicianRepository } from '../repositories/TechnicianRepository';
import { TechnicianRow, TechnicianStatus } from '../interfaces/types';

/**
 * Technician Service
 *
 * Contains business logic for technician profile & location updates.
 */
export class TechnicianService {
  private technicianRepo = new TechnicianRepository();

  async getByAuthUserId(authUserId: string): Promise<TechnicianRow | null> {
    return this.technicianRepo.getByAuthUserId(authUserId);
  }

  async updateLocation(
    technicianId: number,
    latitude: number,
    longitude: number,
  ): Promise<{
    technician_id: number;
    workflow_user_id?: number;
    latitude: number;
    longitude: number;
    last_location_update?: Date | null;
    status?: TechnicianStatus;
  }> {
    // Legacy path: historically accepted workflow user_id. Route wrappers
    // should prefer updateLocationByWorkflowUserId for explicit behavior.
    await this.technicianRepo.updateLocationByUserId(technicianId, latitude, longitude);
    const refreshed = await this.technicianRepo.getByUserId(technicianId);

    return {
      technician_id: refreshed?.id ?? technicianId,
      workflow_user_id: refreshed?.user_id ?? technicianId,
      latitude,
      longitude,
      last_location_update: refreshed?.last_location_update ?? null,
      status: refreshed?.status as TechnicianStatus | undefined,
    };
  }

  async updateLocationByWorkflowUserId(
    workflowUserId: number,
    latitude: number,
    longitude: number,
  ): Promise<{
    technician_id: number;
    workflow_user_id: number;
    latitude: number;
    longitude: number;
    last_location_update?: Date | null;
    status?: TechnicianStatus;
  }> {
    await this.technicianRepo.updateLocationByUserId(workflowUserId, latitude, longitude);
    const refreshed = await this.technicianRepo.getByUserId(workflowUserId);

    if (!refreshed) {
      throw new Error(`Technician with workflow user_id ${workflowUserId} not found or inactive`);
    }

    return {
      technician_id: refreshed.id,
      workflow_user_id: refreshed.user_id,
      latitude,
      longitude,
      last_location_update: refreshed.last_location_update ?? null,
      status: refreshed.status as TechnicianStatus | undefined,
    };
  }
}
