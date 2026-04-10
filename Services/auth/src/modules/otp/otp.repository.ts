import { v4 as uuidv4 } from 'uuid';
import { query } from '@database/connection';
import { EmailOTP, OTPPurpose } from '@/types';
import { generateOTP, hashOTP, getOTPExpiryDate } from '@utils/otp.util';

export class OTPRepository {
  async create(userId: string, purpose: OTPPurpose): Promise<{ otp: string; record: EmailOTP }> {
    // Invalidate any existing unused OTPs for this user and purpose
    await this.invalidateExisting(userId, purpose);

    const otp = generateOTP();
    const otpHash = await hashOTP(otp);
    const expiresAt = getOTPExpiryDate();
    const id = uuidv4();

    await query(
      `INSERT INTO email_otps (id, user_id, otp_hash, purpose, expires_at, is_used)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, userId, otpHash, purpose, expiresAt, false]
    );

    const record = await this.findById(id);
    return { otp, record: record! };
  }

  async findById(id: string): Promise<EmailOTP | null> {
    const otps = await query<EmailOTP[]>(
      'SELECT * FROM email_otps WHERE id = ?',
      [id]
    );
    return otps[0] || null;
  }

  async findLatestValid(userId: string, purpose: OTPPurpose): Promise<EmailOTP | null> {
    const otps = await query<EmailOTP[]>(
      `SELECT * FROM email_otps 
       WHERE user_id = ? AND purpose = ? AND is_used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [userId, purpose]
    );
    return otps[0] || null;
  }

  async markAsUsed(id: string): Promise<void> {
    await query(
      'UPDATE email_otps SET is_used = TRUE WHERE id = ?',
      [id]
    );
  }

  async invalidateExisting(userId: string, purpose: OTPPurpose): Promise<void> {
    await query(
      `UPDATE email_otps SET is_used = TRUE 
       WHERE user_id = ? AND purpose = ? AND is_used = FALSE`,
      [userId, purpose]
    );
  }

  async cleanupExpired(): Promise<number> {
    const result = await query<any>(
      'DELETE FROM email_otps WHERE expires_at < NOW() OR is_used = TRUE'
    );
    return result.affectedRows || 0;
  }
}

export const otpRepository = new OTPRepository();
