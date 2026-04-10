import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { config } from '@config/index';

export const generateOTP = (): string => {
  const length = config.otp.length;
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += crypto.randomInt(0, 10).toString();
  }
  return otp;
};

export const hashOTP = async (otp: string): Promise<string> => {
  return bcrypt.hash(otp, 10);
};

export const verifyOTP = async (otp: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(otp, hash);
};

export const getOTPExpiryDate = (): Date => {
  const now = new Date();
  now.setMinutes(now.getMinutes() + config.otp.expiryMinutes);
  return now;
};

export const isOTPExpired = (expiryDate: Date): boolean => {
  return new Date() > new Date(expiryDate);
};
