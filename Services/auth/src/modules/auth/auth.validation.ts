import { body } from 'express-validator';
import { config } from '@config/index';

export const signupValidation = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/)
    .withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/)
    .withMessage('Password must contain at least one lowercase letter')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one number')
    .matches(/[!@#$%^&*(),.?":{}|<>]/)
    .withMessage('Password must contain at least one special character'),
  body('firstName')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('First name must be between 2 and 100 characters'),
  body('lastName')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Last name must be between 2 and 100 characters'),
  body('role')
    .isIn(['DOCTOR', 'STUDENT'])
    .withMessage('Role must be either DOCTOR or STUDENT'),
];

export const loginValidation = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
];

export const verifyOTPValidation = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
  body('otp')
    .isLength({ min: 6, max: 6 })
    .withMessage(`OTP must be ${config.otp.length} digits`)
    .isNumeric()
    .withMessage('OTP must contain only numbers'),
  body('purpose')
    .isIn(['VERIFICATION', 'LOGIN'])
    .withMessage('Purpose must be either VERIFICATION or LOGIN'),
];

export const resendOTPValidation = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
  body('purpose')
    .isIn(['VERIFICATION', 'LOGIN'])
    .withMessage('Purpose must be either VERIFICATION or LOGIN'),
];
