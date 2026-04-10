import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { adminService } from './admin.service';
import { logger } from '@config/logger';

export class AdminController {
  async createUser(req: Request, res: Response): Promise<void> {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
        return;
      }

      const {
        email,
        password,
        firstName,
        lastName,
        role,
        isVerified,
        isActive,
      } = req.body;

      const result = await adminService.createUser({
        email,
        password,
        firstName,
        lastName,
        role,
        isVerified,
        isActive,
      });

      if (!result.success) {
        res.status(400).json({
          success: false,
          message: result.message,
        });
        return;
      }

      res.status(201).json({
        success: true,
        message: result.message,
        data: result.user,
      });
    } catch (error) {
      logger.error('Create user error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  async createTechnician(req: Request, res: Response): Promise<void> {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
        return;
      }

      const {
        email,
        password,
        firstName,
        lastName,
        employeeId,
        department,
        specialization,
        buildingIds,
      } = req.body;

      const result = await adminService.createTechnician({
        email,
        password,
        firstName,
        lastName,
        employeeId,
        department,
        specialization,
        buildingIds,
      });

      if (!result.success) {
        res.status(400).json({
          success: false,
          message: result.message,
        });
        return;
      }

      res.status(201).json({
        success: true,
        message: result.message,
        data: result.technician,
      });
    } catch (error) {
      logger.error('Create technician error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  async updateUserStatus(req: Request, res: Response): Promise<void> {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
        return;
      }

      const { id } = req.params;
      const { isActive } = req.body;

      const result = await adminService.updateUserStatus(id, isActive);

      if (!result.success) {
        res.status(400).json({
          success: false,
          message: result.message,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.user,
      });
    } catch (error) {
      logger.error('Update user status error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  async getAllUsers(req: Request, res: Response): Promise<void> {
    try {
      const users = await adminService.getAllUsers();

      res.status(200).json({
        success: true,
        message: 'Users retrieved successfully',
        data: users,
      });
    } catch (error) {
      logger.error('Get all users error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  async getAllTechnicians(req: Request, res: Response): Promise<void> {
    try {
      const technicians = await adminService.getAllTechnicians();

      res.status(200).json({
        success: true,
        message: 'Technicians retrieved successfully',
        data: technicians,
      });
    } catch (error) {
      logger.error('Get all technicians error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  async getAllBuildings(req: Request, res: Response): Promise<void> {
    try {
      const buildings = await adminService.getAllBuildings();

      res.status(200).json({
        success: true,
        message: 'Buildings retrieved successfully',
        data: buildings,
      });
    } catch (error) {
      logger.error('Get all buildings error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  async createBuilding(req: Request, res: Response): Promise<void> {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
        return;
      }

      const { name, code, address } = req.body;
      const result = await adminService.createBuilding({ name, code, address });

      if (!result.success) {
        res.status(400).json({
          success: false,
          message: result.message,
        });
        return;
      }

      res.status(201).json({
        success: true,
        message: result.message,
        data: result.building,
      });
    } catch (error) {
      logger.error('Create building error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  async deleteUser(req: Request, res: Response): Promise<void> {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
        return;
      }

      const { id } = req.params;

      const result = await adminService.deleteUser(id);

      if (!result.success) {
        const statusCode = result.message === 'User not found' ? 404 : 400;
        res.status(statusCode).json({
          success: false,
          message: result.message,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      logger.error('Delete user error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }
}

export const adminController = new AdminController();
