import bcrypt from 'bcrypt';
import { userRepository } from '@modules/users/user.repository';
import { technicianRepository, buildingRepository } from './admin.repository';
import { domainRepository } from './domain.repository';
import { validateAllowedEmailDomain, validatePassword, sanitizeUser } from '@utils/validation.util';
import { CreateTechnicianDTO, TechnicianLevel, UserResponse, RoleName } from '@/types';
import { logger } from '@config/logger';
import { config } from '@config/index';

type CreateUserRoleInput = RoleName | 'JUNIOR' | 'SENIOR' | 'SUPERVISOR';
type WorkflowSyncRole = 'ADMIN' | 'TECHNICIAN';

export interface CreateUserDTO {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: CreateUserRoleInput;
  technicianLevel?: TechnicianLevel;
  isVerified?: boolean;
  isActive?: boolean;
}

export class AdminService {
  private resolveRoleAndTechnicianLevel(
    roleInput: CreateUserRoleInput,
    providedTechnicianLevel?: TechnicianLevel
  ): { valid: boolean; message?: string; role?: RoleName; technicianLevel?: TechnicianLevel } {
    const normalizedRole = String(roleInput || '').toUpperCase() as CreateUserRoleInput;
    const normalizedLevel = providedTechnicianLevel
      ? (String(providedTechnicianLevel).toUpperCase() as TechnicianLevel)
      : undefined;

    if (['JUNIOR', 'SENIOR', 'SUPERVISOR'].includes(normalizedRole)) {
      if (normalizedLevel && normalizedLevel !== normalizedRole) {
        return {
          valid: false,
          message: `technicianLevel must match role when role is ${normalizedRole}`,
        };
      }

      return {
        valid: true,
        role: 'TECHNICIAN',
        technicianLevel: normalizedRole as TechnicianLevel,
      };
    }

    if (normalizedRole === 'TECHNICIAN') {
      if (!normalizedLevel) {
        return {
          valid: false,
          message: 'technicianLevel is required when role is TECHNICIAN',
        };
      }

      if (!['JUNIOR', 'SENIOR', 'SUPERVISOR'].includes(normalizedLevel)) {
        return {
          valid: false,
          message: 'TECHNICIAN role supports only JUNIOR, SENIOR, or SUPERVISOR technician levels',
        };
      }

      return {
        valid: true,
        role: 'TECHNICIAN',
        technicianLevel: normalizedLevel,
      };
    }

    if (normalizedRole === 'ADMIN') {
      if (normalizedLevel && normalizedLevel !== 'ADMIN') {
        return {
          valid: false,
          message: 'ADMIN role can only use ADMIN technicianLevel',
        };
      }

      return {
        valid: true,
        role: 'ADMIN',
        technicianLevel: 'ADMIN',
      };
    }

    if ((normalizedRole === 'DOCTOR' || normalizedRole === 'STUDENT') && normalizedLevel) {
      return {
        valid: false,
        message: `${normalizedRole} users cannot include technicianLevel`,
      };
    }

    return {
      valid: true,
      role: normalizedRole as RoleName,
    };
  }

  private async syncWorkflowTechnicianIdentity(data: {
    authUserId: string;
    firstName: string;
    lastName: string;
    email: string;
    authRole: WorkflowSyncRole;
    technicianLevel: TechnicianLevel;
  }): Promise<{ success: boolean; message?: string }> {
    const endpoint = `${config.workflow.serviceUrl}/workflow/admin/hierarchy/technicians/sync`;
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), config.workflow.syncTimeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        signal: abortController.signal,
      });

      const responseBody = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        return {
          success: false,
          message: responseBody?.message || `Workflow service responded with status ${response.status}`,
        };
      }

      return { success: true };
    } catch (error) {
      const err = error as Error;
      if (err.name === 'AbortError') {
        return {
          success: false,
          message: `Workflow sync timed out after ${config.workflow.syncTimeoutMs}ms`,
        };
      }

      const connectionFailed = (err.message || '').toLowerCase().includes('fetch failed')
        || (err.message || '').toLowerCase().includes('econnrefused');

      if (connectionFailed) {
        return {
          success: false,
          message: `Unable to reach workflow service at ${endpoint}. Check WORKFLOW_SERVICE_URL and service health.`,
        };
      }

      return {
        success: false,
        message: err.message || 'Workflow sync request failed',
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private async ensureAllowedEmailDomain(email: string): Promise<{ valid: boolean; message?: string }> {
    const allowedDomains = (await domainRepository.getActiveDomains()).map((domain) => domain.toLowerCase());

    if (allowedDomains.length === 0) {
      return {
        valid: false,
        message: 'No allowed email domains are configured. Add at least one allowed domain first.',
      };
    }

    if (!validateAllowedEmailDomain(email, allowedDomains)) {
      return {
        valid: false,
        message: `Email domain is not allowed. Allowed domains: ${allowedDomains.map((domain) => `@${domain}`).join(', ')}`,
      };
    }

    return { valid: true };
  }

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
      technicianLevel,
      isVerified = true, // Default to verified since admin creates them
      isActive = true,   // Default to active
    } = data;

    const roleResolution = this.resolveRoleAndTechnicianLevel(role, technicianLevel);
    if (!roleResolution.valid) {
      return {
        success: false,
        message: roleResolution.message || 'Invalid role/technician level configuration',
      };
    }

    const resolvedRole = roleResolution.role!;
    const resolvedTechnicianLevel = roleResolution.technicianLevel;

    const emailValidation = await this.ensureAllowedEmailDomain(email);
    if (!emailValidation.valid) {
      return {
        success: false,
        message: emailValidation.message || 'Email domain is not allowed',
      };
    }

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
    await userRepository.assignRole(user.id, resolvedRole);

    if (resolvedRole === 'TECHNICIAN') {
      await technicianRepository.create({
        userId: user.id,
        technicianLevel: resolvedTechnicianLevel,
      });
    }

    if ((resolvedRole === 'TECHNICIAN' || resolvedRole === 'ADMIN') && resolvedTechnicianLevel) {
      const syncResult = await this.syncWorkflowTechnicianIdentity({
        authUserId: user.id,
        firstName,
        lastName,
        email,
        authRole: resolvedRole as WorkflowSyncRole,
        technicianLevel: resolvedTechnicianLevel,
      });

      if (!syncResult.success) {
        logger.error('Workflow identity sync failed during admin user creation', {
          email,
          role: resolvedRole,
          technicianLevel: resolvedTechnicianLevel,
          error: syncResult.message,
        });

        try {
          await userRepository.delete(user.id);
        } catch (rollbackError) {
          logger.error('Rollback failed after workflow identity sync error', rollbackError);
        }

        return {
          success: false,
          message: `Workflow schema conflict detected: ${syncResult.message}`,
        };
      }
    }

    // Get user with roles
    const userWithRoles = await userRepository.findByIdWithRoles(user.id);

    logger.info(`Admin created new user: ${email} with role ${resolvedRole}`);

    return {
      success: true,
      message: 'User created successfully',
      user: sanitizeUser({
        ...userWithRoles!,
        technicianLevel: resolvedTechnicianLevel,
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
      technicianLevel = 'JUNIOR',
      employeeId,
      department,
      specialization,
      buildingIds,
    } = data;

    const emailValidation = await this.ensureAllowedEmailDomain(email);
    if (!emailValidation.valid) {
      return {
        success: false,
        message: emailValidation.message || 'Email domain is not allowed',
      };
    }

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
      technicianLevel,
      employeeId,
      department,
      specialization,
    });

    const syncResult = await this.syncWorkflowTechnicianIdentity({
      authUserId: user.id,
      firstName,
      lastName,
      email,
      authRole: 'TECHNICIAN',
      technicianLevel,
    });

    if (!syncResult.success) {
      logger.error('Workflow identity sync failed during technician creation', {
        email,
        technicianLevel,
        error: syncResult.message,
      });

      try {
        await userRepository.delete(user.id);
      } catch (rollbackError) {
        logger.error('Rollback failed after technician workflow sync error', rollbackError);
      }

      return {
        success: false,
        message: `Workflow schema conflict detected: ${syncResult.message}`,
      };
    }

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
        technicianLevel: technician.technicianLevel,
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
      role: user.role, // Single role name for display
      roles: user.roles.map(r => r.name), // Array of role names for compatibility
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
