import { body, param } from 'express-validator';

export const createTechnicianValidation = [
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
  body('technicianLevel')
    .optional()
    .isIn(['JUNIOR', 'SENIOR', 'SUPERVISOR'])
    .withMessage('technicianLevel must be one of: JUNIOR, SENIOR, SUPERVISOR'),
  body('employeeId')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Employee ID must not exceed 50 characters'),
  body('department')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Department must not exceed 100 characters'),
  body('specialization')
    .optional()
    .trim()
    .isLength({ max: 255 })
    .withMessage('Specialization must not exceed 255 characters'),
  body('buildingIds')
    .optional()
    .isArray()
    .withMessage('Building IDs must be an array'),
  body('buildingIds.*')
    .optional()
    .isUUID()
    .withMessage('Each building ID must be a valid UUID'),
];

export const updateUserStatusValidation = [
  param('id')
    .isUUID()
    .withMessage('User ID must be a valid UUID'),
  body('isActive')
    .isBoolean()
    .withMessage('isActive must be a boolean value'),
];

export const createBuildingValidation = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Building name must be between 2 and 100 characters'),
  body('code')
    .trim()
    .isLength({ min: 2, max: 20 })
    .withMessage('Building code must be between 2 and 20 characters')
    .isAlphanumeric()
    .withMessage('Building code must contain only letters and numbers'),
  body('address')
    .optional()
    .trim()
    .isLength({ max: 255 })
    .withMessage('Address must not exceed 255 characters'),
];

export const createUserValidation = [
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
    .isIn(['ADMIN', 'TECHNICIAN', 'DOCTOR', 'STUDENT', 'JUNIOR', 'SENIOR', 'SUPERVISOR'])
    .withMessage('Role must be one of: ADMIN, TECHNICIAN, DOCTOR, STUDENT, JUNIOR, SENIOR, SUPERVISOR'),
  body('technicianLevel')
    .optional()
    .isIn(['JUNIOR', 'SENIOR', 'SUPERVISOR', 'ADMIN'])
    .withMessage('technicianLevel must be one of: JUNIOR, SENIOR, SUPERVISOR, ADMIN'),
  body('technicianLevel').custom((value, { req }) => {
    const role = String(req.body.role || '').toUpperCase();
    const level = value ? String(value).toUpperCase() : undefined;

    if (['JUNIOR', 'SENIOR', 'SUPERVISOR'].includes(role)) {
      if (level && level !== role) {
        throw new Error(`technicianLevel must match role when role is ${role}`);
      }
      return true;
    }

    if (role === 'TECHNICIAN') {
      if (!level) {
        throw new Error('technicianLevel is required when role is TECHNICIAN');
      }
      if (level === 'ADMIN') {
        throw new Error('TECHNICIAN role cannot use ADMIN technicianLevel');
      }
      return true;
    }

    if (role === 'ADMIN') {
      if (level && level !== 'ADMIN') {
        throw new Error('ADMIN role can only use ADMIN technicianLevel');
      }
      return true;
    }

    if ((role === 'DOCTOR' || role === 'STUDENT') && level) {
      throw new Error(`${role} users cannot include technicianLevel`);
    }

    return true;
  }),
  body('isVerified')
    .optional()
    .isBoolean()
    .withMessage('isVerified must be a boolean value'),
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean value'),
];

export const deleteUserValidation = [
  param('id')
    .isUUID()
    .withMessage('User ID must be a valid UUID'),
];
