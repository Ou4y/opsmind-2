import { otpRepository } from './otp.repository';
import { userRepository } from '@modules/users/user.repository';
import { sendOTPEmail } from '@/services/email.service';
import { verifyOTP, isOTPExpired } from '@utils/otp.util';
import { OTPPurpose } from '@/types';
import { logger } from '@config/logger';

export class OTPService {
  async generateAndSendOTP(userId: string, email: string, purpose: OTPPurpose): Promise<boolean> {
    try {
      const { otp } = await otpRepository.create(userId, purpose);
      const sent = await sendOTPEmail(email, otp, purpose);
      
      if (!sent) {
        logger.error(`Failed to send OTP email to ${email}`);
        return false;
      }

      logger.info(`OTP sent to ${email} for ${purpose}`);
      return true;
    } catch (error) {
      logger.error('Error generating OTP:', error);
      return false;
    }
  }

  async verifyOTP(email: string, otp: string, purpose: OTPPurpose): Promise<{
    valid: boolean;
    userId?: string;
    error?: string;
  }> {
    try {
      const user = await userRepository.findByEmail(email);
      if (!user) {
        return { valid: false, error: 'User not found' };
      }

      const otpRecord = await otpRepository.findLatestValid(user.id, purpose);
      if (!otpRecord) {
        return { valid: false, error: 'No valid OTP found. Please request a new one.' };
      }

      if (isOTPExpired(otpRecord.expires_at)) {
        return { valid: false, error: 'OTP has expired. Please request a new one.' };
      }

      const isValid = await verifyOTP(otp, otpRecord.otp_hash);
      if (!isValid) {
        return { valid: false, error: 'Invalid OTP' };
      }

      // Mark OTP as used (single-use)
      await otpRepository.markAsUsed(otpRecord.id);

      // If verification purpose, update user verification status
      if (purpose === 'VERIFICATION') {
        await userRepository.updateVerificationStatus(user.id, true);
      }

      return { valid: true, userId: user.id };
    } catch (error) {
      logger.error('Error verifying OTP:', error);
      return { valid: false, error: 'Failed to verify OTP' };
    }
  }

  async cleanupExpiredOTPs(): Promise<void> {
    const deleted = await otpRepository.cleanupExpired();
    logger.info(`Cleaned up ${deleted} expired OTP records`);
  }
}

export const otpService = new OTPService();
