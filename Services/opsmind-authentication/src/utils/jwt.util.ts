import jwt from 'jsonwebtoken';
import { config } from '@config/index';
import { AuthTokenPayload } from '@/types';

export const generateToken = (payload: AuthTokenPayload): string => {
  return jwt.sign(
    payload as object, 
    config.jwt.secret, 
    { expiresIn: config.jwt.expiresIn } as jwt.SignOptions
  );
};

export const verifyToken = (token: string): AuthTokenPayload => {
  return jwt.verify(token, config.jwt.secret) as AuthTokenPayload;
};

export const decodeToken = (token: string): AuthTokenPayload | null => {
  try {
    return jwt.decode(token) as AuthTokenPayload;
  } catch {
    return null;
  }
};
