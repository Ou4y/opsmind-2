import { domainRepository } from '@modules/admin/domain.repository';
import bcrypt from 'bcrypt';
import { userRepository } from '@modules/users/user.repository';
import { otpService } from '@modules/otp/otp.service';
import { generateToken } from '@utils/jwt.util';
import { validateAllowedEmailDomain, validatePassword, sanitizeUser } from '@utils/validation.util';
import { SignupDTO, LoginDTO, VerifyOTPDTO, AuthResponse, RoleName } from '@/types';
import { logger } from '@config/logger';

type WorkflowFallbackUser = {
  id: string;
  name: string;
  email: string;
  role?: string;
};

/**
 * Temporary compatibility layer for workflow-service numeric technician IDs.
 * This keeps SLA enrichment working until all services use auth UUIDs consistently.
 */
function getWorkflowFallbackUser(userId: string): WorkflowFallbackUser | null {
  const numericId = Number(userId);

  if (!Number.isInteger(numericId)) {
    return null;
  }

  if (numericId === 100) {
    return {
      id: userId,
      name: 'Supervisor Admin',
      email: 'supervisor.admin@opsmind.local',
      role: 'SUPERVISOR',
    };
  }

  const seniors = [
    { id: 1, name: 'Senior M', email: 'senior.m@opsmind.local' },
    { id: 2, name: 'Senior N', email: 'senior.n@opsmind.local' },
    { id: 3, name: 'Senior S', email: 'senior.s@opsmind.local' },
    { id: 4, name: 'Senior R', email: 'senior.r@opsmind.local' },
    { id: 5, name: 'Senior Pharmacy', email: 'senior.pharmacy@opsmind.local' },
  ];

  const senior = seniors.find((entry) => entry.id === numericId);
  if (senior) {
    return {
      id: userId,
      name: senior.name,
      email: senior.email,
      role: 'TECHNICIAN',
    };
  }

  const juniorRanges = [
    { start: 6, end: 13, building: 'M', floors: 4, prefix: 'm' },
    { start: 14, end: 21, building: 'N', floors: 4, prefix: 'n' },
    { start: 22, end: 29, building: 'S', floors: 4, prefix: 's' },
    { start: 30, end: 39, building: 'R', floors: 5, prefix: 'r' },
    { start: 40, end: 49, building: 'PH', floors: 5, prefix: 'ph' },
  ];

  for (const range of juniorRanges) {
    if (numericId >= range.start && numericId <= range.end) {
      const zeroBased = numericId - range.start;
      const floor = Math.floor(zeroBased / 2) + 1;
      const techNumber = (zeroBased % 2) + 1;
      const labelBuilding = range.building === 'PH' ? 'PH' : range.building;

      return {
        id: userId,
        name: `${labelBuilding}-F${floor} Tech ${techNumber}`,
        email: `${range.prefix}-f${floor}-tech${techNumber}@opsmind.local`,
        role: 'TECHNICIAN',
      };
    }
  }

  return null;
}

export class AuthService {
  async getAllowedDomains(): Promise<string[]> {
    const allowedDomains = await domainRepository.getActiveDomains();
    return allowedDomains.map((domain) => domain.toLowerCase());
  }

  async getUserById(userId: string): Promise<{
    id: string;
    name: string;
    email: string;
    role?: string;
  } | null> {
    const user = await userRepository.findByIdWithRoles(userId);
    if (!user) {
      const fallbackUser = getWorkflowFallbackUser(userId);
      if (fallbackUser) {
        logger.warn(`Using temporary workflow fallback identity for user lookup`, {
          userId,
          fallbackEmail: fallbackUser.email,
        });
        return fallbackUser;
      }

      return null;
    }

    return {
      id: user.id,
      name: `${user.first_name} ${user.last_name}`.trim(),
      email: user.email,
      role: user.roles[0]?.name,
    };
  }

  async signup(data: SignupDTO): Promise<AuthResponse> {
    const { email, password, firstName, lastName, role } = data;

    // Validate role - only DOCTOR and STUDENT can self-signup
    if (!['DOCTOR', 'STUDENT'].includes(role)) {
      return {
        message: 'Only doctors and students can self-register',
      };
    }

    const allowedDomains = await this.getAllowedDomains();

    if (allowedDomains.length === 0) {
      return {
        message: 'Registration is currently unavailable. No allowed email domains are configured.',
      };
    }

    if (!validateAllowedEmailDomain(email, allowedDomains)) {
      return {
        message: `Email domain is not allowed. Allowed domains: ${allowedDomains.map((domain) => `@${domain}`).join(', ')}`,
      };
    }

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return {
        message: 'Password does not meet requirements',
      };
    }

    // Check if user already exists
    const existingUser = await userRepository.findByEmail(email);
    if (existingUser) {
      return {
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
      isVerified: false,
    });

    // Assign role
    await userRepository.assignRole(user.id, role as RoleName);

    // Send verification OTP
    await otpService.generateAndSendOTP(user.id, email, 'VERIFICATION');

    logger.info(`New user registered: ${email} with role ${role}`);

    return {
      message: 'Registration successful. Please check your email for verification OTP.',
      user: sanitizeUser({ ...user, roles: [role] }),
      requiresOTP: true,
    };
  }

  async login(data: LoginDTO): Promise<AuthResponse> {
    const { email, password } = data;

    // Find user with roles
    const user = await userRepository.findByEmailWithRoles(email);
    if (!user) {
      return {
        message: 'Invalid email or password',
      };
    }

    // Check if user is active
    if (!user.is_active) {
      return {
        message: 'Your account has been deactivated. Please contact an administrator.',
      };
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return {
        message: 'Invalid email or password',
      };
    }

    // Check if user is verified
    if (!user.is_verified) {
      // Send verification OTP again
      await otpService.generateAndSendOTP(user.id, email, 'VERIFICATION');
      return {
        message: 'Please verify your account first. A new verification OTP has been sent.',
        requiresOTP: true,
      };
    }

    // Send login OTP (mandatory for every login)
    await otpService.generateAndSendOTP(user.id, email, 'LOGIN');

    logger.info(`Login OTP sent to: ${email}`);

    return {
      message: 'Please enter the OTP sent to your email to complete login.',
      requiresOTP: true,
    };
  }

  async verifyOTP(data: VerifyOTPDTO): Promise<AuthResponse> {
    const { email, otp, purpose } = data;

    const result = await otpService.verifyOTP(email, otp, purpose);
    if (!result.valid) {
      return {
        message: result.error || 'OTP verification failed',
      };
    }

    const user = await userRepository.findByIdWithRoles(result.userId!);
    if (!user) {
      return {
        message: 'User not found',
      };
    }

    // For verification purpose, just confirm success
    if (purpose === 'VERIFICATION') {
      // Now send login OTP to complete authentication
      await otpService.generateAndSendOTP(user.id, email, 'LOGIN');
      
      return {
        message: 'Account verified successfully. Please check your email for login OTP.',
        user: sanitizeUser({ ...user, roles: user.roles.map(r => r.name) }),
        requiresOTP: true,
      };
    }

    // For login purpose, generate JWT token
    const roles = user.roles.map(r => r.name);
    const token = generateToken({
      userId: user.id,
      email: user.email,
      roles,
    });

    logger.info(`User logged in successfully: ${email}`);

    return {
      message: 'Login successful',
      user: sanitizeUser({ ...user, roles }),
      token,
    };
  }

  async resendOTP(email: string, purpose: 'VERIFICATION' | 'LOGIN'): Promise<AuthResponse> {
    const user = await userRepository.findByEmail(email);
    if (!user) {
      return {
        message: 'If the email exists, an OTP will be sent.',
      };
    }

    await otpService.generateAndSendOTP(user.id, email, purpose);

    return {
      message: 'If the email exists, an OTP will be sent.',
    };
  }
}

export const authService = new AuthService();
