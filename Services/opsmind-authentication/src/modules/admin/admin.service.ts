import bcrypt from 'bcrypt';
import { userRepository } from '@modules/users/user.repository';
import { technicianRepository, buildingRepository } from './admin.repository';
import { otpService } from '@modules/otp/otp.service';
import { validatePassword, sanitizeUser } from '@utils/validation.util';
import { CreateTechnicianDTO, UserResponse, RoleName } from '@/types';
import { logger } from '@config/logger';

export interface CreateUserDTO {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: RoleName;
  isVerified?: boolean;
  isActive?: boolean;
}

export class AdminService {
  async createUser(data: CreateUserDTO): Promise<{
    success: boolean;
    message: string;
    user?: any;
  }> {
    const {
      email,
      password,
      firstName,
      lastName,
      role,
      isVerified = true, // Default to verified since admin creates them
      isActive = true,   // Default to active
    } = data;

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return {
        success: false,
        message: `Password validation failed: ${passwordValidation.errors.join(', ')}`,
      };
    }

    // Check if user already exists
    const existingUser = await userRepository.findByEmail(email);
    if (existingUser) {
      return {
        success: false,
        message: 'User with this email already exists',
      };
    }

    // Hash password and create user
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await userRepository.create({
      email,
      passwordHash,
      firstName,
      lastName,
      isVerified,
      isActive,
    });

    // Assign role
    await userRepository.assignRole(user.id, role);

    // Get user with roles
    const userWithRoles = await userRepository.findByIdWithRoles(user.id);

    logger.info(`Admin created new user: ${email} with role ${role}`);

    return {
      success: true,
      message: 'User created successfully',
      user: sanitizeUser({
        ...userWithRoles!,
        roles: userWithRoles!.roles.map(r => r.name),
      }),
    };
  }

  async createTechnician(data: CreateTechnicianDTO): Promise<{
    success: boolean;
    message: string;
    technician?: any;
  }> {
    const {
      email,
      password,
      firstName,
      lastName,
      employeeId,
      department,
      specialization,
      buildingIds,
    } = data;

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return {
        success: false,
        message: `Password validation failed: ${passwordValidation.errors.join(', ')}`,
      };
    }

    // Check if user already exists
    const existingUser = await userRepository.findByEmail(email);
    if (existingUser) {
      return {
        success: false,
        message: 'User with this email already exists',
      };
    }

    // Check if employee ID is already used
    if (employeeId) {
      const existingTech = await technicianRepository.findByEmployeeId(employeeId);
      if (existingTech) {
        return {
          success: false,
          message: 'Employee ID is already assigned to another technician',
        };
      }
    }

    // Validate building IDs if provided
    if (buildingIds && buildingIds.length > 0) {
      for (const buildingId of buildingIds) {
        const building = await buildingRepository.findById(buildingId);
        if (!building) {
          return {
            success: false,
            message: `Building with ID ${buildingId} not found`,
          };
        }
      }
    }

    // Hash password and create user
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await userRepository.create({
      email,
      passwordHash,
      firstName,
      lastName,
      isVerified: true, // Technicians are pre-verified since admin creates them
    });

    // Assign technician role
    await userRepository.assignRole(user.id, 'TECHNICIAN');

    // Create technician profile
    const technician = await technicianRepository.create({
      userId: user.id,
      employeeId,
      department,
      specialization,
    });

    // Assign buildings
    if (buildingIds && buildingIds.length > 0) {
      for (let i = 0; i < buildingIds.length; i++) {
        await technicianRepository.assignBuilding(
          technician.id,
          buildingIds[i],
          i === 0 // First building is primary
        );
      }
    }

    const buildings = await technicianRepository.getTechnicianBuildings(technician.id);

    logger.info(`Technician created: ${email} by admin`);

    return {
      success: true,
      message: 'Technician created successfully',
      technician: {
        id: technician.id,
        userId: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        employeeId: technician.employee_id,
        department: technician.department,
        specialization: technician.specialization,
        buildings,
        isActive: user.is_active,
        createdAt: technician.created_at,
      },
    };
  }

  async updateUserStatus(userId: string, isActive: boolean): Promise<{
    success: boolean;
    message: string;
    user?: UserResponse;
  }> {
    const user = await userRepository.findByIdWithRoles(userId);
    if (!user) {
      return {
        success: false,
        message: 'User not found',
      };
    }

    // Prevent deactivating admin users (safety check)
    const isAdmin = user.roles.some(r => r.name === 'ADMIN');
    if (isAdmin && !isActive) {
      return {
        success: false,
        message: 'Cannot deactivate admin users',
      };
    }

    await userRepository.updateActiveStatus(userId, isActive);

    const updatedUser = await userRepository.findByIdWithRoles(userId);
    
    logger.info(`User ${userId} status updated to ${isActive ? 'active' : 'inactive'}`);

    return {
      success: true,
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
      user: sanitizeUser({
        ...updatedUser,
        roles: updatedUser!.roles.map(r => r.name),
      }),
    };
  }

  async getAllUsers(): Promise<UserResponse[]> {
    const users = await userRepository.findAll();
    return users.map(user => sanitizeUser({
      ...user,
      roles: user.roles.map(r => r.name),
    }));
  }

  async getAllTechnicians(): Promise<any[]> {
    const technicians = await technicianRepository.findAll();
    
    return Promise.all(
      technicians.map(async (tech) => {
        const buildings = await technicianRepository.getTechnicianBuildings(tech.id);
        return {
          id: tech.id,
          userId: tech.user_id,
          email: tech.email,
          firstName: tech.first_name,
          lastName: tech.last_name,
          employeeId: tech.employee_id,
          department: tech.department,
          specialization: tech.specialization,
          buildings,
          isActive: tech.is_active,
          createdAt: tech.created_at,
        };
      })
    );
  }

  async getAllBuildings(): Promise<any[]> {
    return buildingRepository.findAll();
  }

  async createBuilding(data: { name: string; code: string; address?: string }): Promise<{
    success: boolean;
    message: string;
    building?: any;
  }> {
    const existing = await buildingRepository.findByCode(data.code);
    if (existing) {
      return {
        success: false,
        message: 'Building with this code already exists',
      };
    }

    const building = await buildingRepository.create(data);
    
    return {
      success: true,
      message: 'Building created successfully',
      building,
    };
  }

  async deleteUser(userId: string): Promise<{
    success: boolean;
    message: string;
  }> {
    // Check if user exists
    const user = await userRepository.findByIdWithRoles(userId);
    if (!user) {
      return {
        success: false,
        message: 'User not found',
      };
    }

    // Prevent deleting admin users (safety check)
    const isAdmin = user.roles.some(r => r.name === 'ADMIN');
    if (isAdmin) {
      return {
        success: false,
        message: 'Cannot delete admin users',
      };
    }

    // Delete the user and all associated data
    await userRepository.delete(userId);

    logger.info(`User ${userId} (${user.email}) deleted by admin`);

    return {
      success: true,
      message: 'User deleted successfully',
    };
  }
}

export const adminService = new AdminService();
