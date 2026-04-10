import bcrypt from 'bcrypt';
import { userRepository } from '@modules/users/user.repository';
import { otpService } from '@modules/otp/otp.service';
import { generateToken } from '@utils/jwt.util';
import { validateOrganizationEmail, validatePassword, sanitizeUser } from '@utils/validation.util';
import { SignupDTO, LoginDTO, VerifyOTPDTO, AuthResponse, RoleName } from '@/types';
import { logger } from '@config/logger';
import { config } from '@config/index';

export class AuthService {
  async signup(data: SignupDTO): Promise<AuthResponse> {
    const { email, password, firstName, lastName, role } = data;

    // Validate role - only DOCTOR and STUDENT can self-signup
    if (!['DOCTOR', 'STUDENT'].includes(role)) {
      return {
        message: 'Only doctors and students can self-register',
      };
    }

    // Validate organization email for doctors and students
    if (!validateOrganizationEmail(email)) {
      return {
        message: `Email must be from the organization domain: @${config.allowedDomain}`,
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
