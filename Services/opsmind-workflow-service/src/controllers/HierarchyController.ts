import { Request, Response } from 'express';
import { TechnicianRepository } from '../repositories/TechnicianRepository';
import { ReportingRelationshipRepository } from '../repositories/ReportingRelationshipRepository';
import { SyncTechnicianFromAuthRequest } from '../interfaces/types';

/**
 * Hierarchy Controller
 *
 * Admin-only controller for managing technician reporting relationships.
 * No hardcoded limits - fully flexible hierarchy management.
 */
export class HierarchyController {
  private techRepo = new TechnicianRepository();
  private relationshipRepo = new ReportingRelationshipRepository();

  /**
   * GET /workflow/admin/hierarchy/technicians
   * List all technicians by level (optional filter)
   * 
   * Query: ?level=JUNIOR|SENIOR|SUPERVISOR|ADMIN
   * 
   * Response: {
   *   success: true,
   *   data: TechnicianRow[]
   * }
   */
  async listTechnicians(req: Request, res: Response): Promise<void> {
    try {
      const level = req.query.level as string | undefined;
      
      let technicians;
      if (level && ['JUNIOR', 'SENIOR', 'SUPERVISOR', 'ADMIN'].includes(level)) {
        technicians = await this.techRepo.getByLevel(level as any);
      } else {
        // Get all levels
        const juniors = await this.techRepo.getByLevel('JUNIOR');
        const seniors = await this.techRepo.getByLevel('SENIOR');
        const supervisors = await this.techRepo.getByLevel('SUPERVISOR');
        const admins = await this.techRepo.getByLevel('ADMIN');
        technicians = [...juniors, ...seniors, ...supervisors, ...admins];
      }

      res.status(200).json({
        success: true,
        data: technicians,
      });
    } catch (error: any) {
      console.error('[HierarchyController] Error listing technicians:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to list technicians',
      });
    }
  }

  /**
   * POST /workflow/admin/hierarchy/technicians/sync
   * Sync an auth user identity into workflow technicians model.
   */
  async syncTechnicianFromAuth(req: Request, res: Response): Promise<void> {
    try {
      const payload = req.body as SyncTechnicianFromAuthRequest;

      if (payload.authRole === 'DOCTOR' || payload.authRole === 'STUDENT') {
        res.status(400).json({
          success: false,
          message: `Role conflict: ${payload.authRole} users are not part of workflow technicians hierarchy`,
        });
        return;
      }

      const technicianLevel = payload.authRole === 'ADMIN' ? 'ADMIN' : payload.technicianLevel;
      if (!technicianLevel) {
        res.status(400).json({
          success: false,
          message: 'Role conflict: technicianLevel is required for TECHNICIAN users',
        });
        return;
      }

      const synced = await this.techRepo.upsertFromAuth({
        authUserId: payload.authUserId,
        firstName: payload.firstName,
        lastName: payload.lastName,
        email: payload.email,
        authRole: payload.authRole,
        technicianLevel,
      });

      res.status(200).json({
        success: true,
        message: 'Workflow technician identity synced successfully',
        data: {
          workflowUserId: synced.user_id,
          authUserId: synced.auth_user_id,
          level: synced.level,
          email: synced.email,
          name: synced.name,
        },
      });
    } catch (error: any) {
      console.error('[HierarchyController] Error syncing technician identity:', error);

      const databaseConflict = typeof error?.message === 'string' &&
        (error.message.includes('Duplicate entry') || error.message.includes('constraint'));

      res.status(databaseConflict ? 400 : 500).json({
        success: false,
        message: databaseConflict
          ? `Workflow identity conflict: ${error.message}`
          : (error.message || 'Failed to sync workflow technician identity'),
      });
    }
  }

  /**
   * POST /workflow/admin/hierarchy/relationships
   * Create a reporting relationship
   * 
   * Body: {
   *   childUserId: number,
   *   parentUserId: number,
   *   relationshipType: 'JUNIOR_TO_SENIOR' | 'SENIOR_TO_SUPERVISOR' | 'SUPERVISOR_TO_ADMIN'
   * }
   * 
   * Response: {
   *   success: true,
   *   message: string
   * }
   */
  async createRelationship(req: Request, res: Response): Promise<void> {
    try {
      const { childUserId, parentUserId, relationshipType } = req.body;

      // Validate users exist
      const child = await this.techRepo.getByUserId(childUserId);
      const parent = await this.techRepo.getByUserId(parentUserId);

      if (!child) {
        res.status(404).json({
          success: false,
          message: `Child user ${childUserId} not found`,
        });
        return;
      }

      if (!parent) {
        res.status(404).json({
          success: false,
          message: `Parent user ${parentUserId} not found`,
        });
        return;
      }

      // Validate relationship type matches user levels
      const validations: Record<string, { child: string; parent: string }> = {
        JUNIOR_TO_SENIOR: { child: 'JUNIOR', parent: 'SENIOR' },
        SENIOR_TO_SUPERVISOR: { child: 'SENIOR', parent: 'SUPERVISOR' },
        SUPERVISOR_TO_ADMIN: { child: 'SUPERVISOR', parent: 'ADMIN' },
      };

      const validation = validations[relationshipType];
      if (!validation) {
        res.status(400).json({
          success: false,
          message: `Invalid relationship type: ${relationshipType}`,
        });
        return;
      }

      if (child.level !== validation.child) {
        res.status(400).json({
          success: false,
          message: `Child user must be ${validation.child}, got ${child.level}`,
        });
        return;
      }

      if (parent.level !== validation.parent) {
        res.status(400).json({
          success: false,
          message: `Parent user must be ${validation.parent}, got ${parent.level}`,
        });
        return;
      }

      // Create the relationship
      await this.relationshipRepo.create(childUserId, parentUserId, relationshipType);

      res.status(201).json({
        success: true,
        message: `Assigned ${child.name} (${child.level}) to ${parent.name} (${parent.level})`,
        data: {
          child: { userId: child.user_id, name: child.name, level: child.level },
          parent: { userId: parent.user_id, name: parent.name, level: parent.level },
          relationshipType,
        },
      });
    } catch (error: any) {
      console.error('[HierarchyController] Error creating relationship:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to create relationship',
      });
    }
  }

  /**
   * PUT /workflow/admin/hierarchy/relationships
   * Update an existing relationship (same as create, uses ON DUPLICATE KEY UPDATE)
   * 
   * Body: {
   *   childUserId: number,
   *   parentUserId: number,
   *   relationshipType: 'JUNIOR_TO_SENIOR' | 'SENIOR_TO_SUPERVISOR' | 'SUPERVISOR_TO_ADMIN'
   * }
   */
  async updateRelationship(req: Request, res: Response): Promise<void> {
    // Same logic as create - the repository uses ON DUPLICATE KEY UPDATE
    await this.createRelationship(req, res);
  }

  /**
   * DELETE /workflow/admin/hierarchy/relationships
   * Remove a reporting relationship
   * 
   * Body: {
   *   childUserId: number,
   *   parentUserId: number
   * }
   * 
   * Response: {
   *   success: true,
   *   message: string
   * }
   */
  async deleteRelationship(req: Request, res: Response): Promise<void> {
    try {
      const { childUserId, parentUserId } = req.body;

      // Validate users exist
      const child = await this.techRepo.getByUserId(childUserId);
      const parent = await this.techRepo.getByUserId(parentUserId);

      if (!child || !parent) {
        res.status(404).json({
          success: false,
          message: 'Child or parent user not found',
        });
        return;
      }

      // Deactivate the relationship
      await this.relationshipRepo.deactivate(childUserId, parentUserId);

      res.status(200).json({
        success: true,
        message: `Removed relationship: ${child.name} → ${parent.name}`,
      });
    } catch (error: any) {
      console.error('[HierarchyController] Error deleting relationship:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to delete relationship',
      });
    }
  }

  /**
   * GET /workflow/admin/hierarchy/tree
   * Get the full hierarchy tree structure
   * 
   * Response: {
   *   success: true,
   *   data: {
   *     relationships: ReportingRelationshipRow[],
   *     technicians: TechnicianRow[]
   *   }
   * }
   */
  async getHierarchyTree(req: Request, res: Response): Promise<void> {
    try {
      const relationships = await this.relationshipRepo.getAllActive();
      
      // Get all technicians involved in relationships
      const allUserIds = new Set<number>();
      relationships.forEach(rel => {
        allUserIds.add(rel.child_user_id);
        allUserIds.add(rel.parent_user_id);
      });

      const technicians = await this.techRepo.getByUserIds(Array.from(allUserIds));

      res.status(200).json({
        success: true,
        data: {
          relationships,
          technicians,
        },
      });
    } catch (error: any) {
      console.error('[HierarchyController] Error getting hierarchy tree:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get hierarchy tree',
      });
    }
  }

  /**
   * GET /workflow/admin/hierarchy/user/:userId/reports
   * Get direct reports for a specific user
   * 
   * Response: {
   *   success: true,
   *   data: {
   *     userId: number,
   *     userName: string,
   *     level: string,
   *     directReports: TechnicianRow[]
   *   }
   * }
   */
  async getDirectReports(req: Request, res: Response): Promise<void> {
    try {
      const userId = parseInt(req.params.userId, 10);
      
      const user = await this.techRepo.getByUserId(userId);
      if (!user) {
        res.status(404).json({
          success: false,
          message: `User ${userId} not found`,
        });
        return;
      }

      const relationships = await this.relationshipRepo.getDirectReports(userId);
      const reportUserIds = relationships.map(rel => rel.child_user_id);
      const directReports = await this.techRepo.getByUserIds(reportUserIds);

      res.status(200).json({
        success: true,
        data: {
          userId: user.user_id,
          userName: user.name,
          level: user.level,
          directReports,
        },
      });
    } catch (error: any) {
      console.error('[HierarchyController] Error getting direct reports:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get direct reports',
      });
    }
  }

  /**
   * GET /workflow/admin/hierarchy/user/:userId/manager
   * Get the direct manager for a specific user
   * 
   * Response: {
   *   success: true,
   *   data: {
   *     userId: number,
   *     userName: string,
   *     level: string,
   *     manager: TechnicianRow | null
   *   }
   * }
   */
  async getManager(req: Request, res: Response): Promise<void> {
    try {
      const userId = parseInt(req.params.userId, 10);
      
      const user = await this.techRepo.getByUserId(userId);
      if (!user) {
        res.status(404).json({
          success: false,
          message: `User ${userId} not found`,
        });
        return;
      }

      const relationship = await this.relationshipRepo.getManager(userId);
      let manager = null;
      
      if (relationship) {
        manager = await this.techRepo.getByUserId(relationship.parent_user_id);
      }

      res.status(200).json({
        success: true,
        data: {
          userId: user.user_id,
          userName: user.name,
          level: user.level,
          manager,
        },
      });
    } catch (error: any) {
      console.error('[HierarchyController] Error getting manager:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get manager',
      });
    }
  }
}
