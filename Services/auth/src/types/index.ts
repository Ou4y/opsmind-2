// User related types
export interface User {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  is_verified: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface UserWithRoles extends User {
  roles: Role[];
}

export interface CreateUserDTO {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: RoleName;
}

export interface UserResponse {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isVerified: boolean;
  isActive: boolean;
  roles: string[];
  createdAt: Date;
}

// Role related types
export type RoleName = 'ADMIN' | 'TECHNICIAN' | 'DOCTOR' | 'STUDENT';

export interface Role {
  id: string;
  name: RoleName;
  description?: string;
  created_at: Date;
  updated_at: Date;
}

export interface UserRole {
  id: string;
  user_id: string;
  role_id: string;
  created_at: Date;
}

// OTP related types
export type OTPPurpose = 'VERIFICATION' | 'LOGIN';

export interface EmailOTP {
  id: string;
  user_id: string;
  otp_hash: string;
  purpose: OTPPurpose;
  expires_at: Date;
  is_used: boolean;
  created_at: Date;
}

export interface CreateOTPDTO {
  userId: string;
  purpose: OTPPurpose;
}

// Technician related types
export interface Technician {
  id: string;
  user_id: string;
  employee_id?: string;
  department?: string;
  specialization?: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateTechnicianDTO {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  employeeId?: string;
  department?: string;
  specialization?: string;
  buildingIds?: string[];
}

// Building related types
export interface Building {
  id: string;
  name: string;
  code: string;
  address?: string;
  created_at: Date;
  updated_at: Date;
}

export interface TechnicianBuilding {
  id: string;
  technician_id: string;
  building_id: string;
  is_primary: boolean;
  created_at: Date;
}

// Auth related types
export interface SignupDTO {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'DOCTOR' | 'STUDENT';
}

export interface LoginDTO {
  email: string;
  password: string;
}

export interface VerifyOTPDTO {
  email: string;
  otp: string;
  purpose: OTPPurpose;
}

export interface AuthTokenPayload {
  userId: string;
  email: string;
  roles: string[];
}

export interface AuthResponse {
  message: string;
  user?: UserResponse;
  token?: string;
  requiresOTP?: boolean;
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  errors?: any[];
}
