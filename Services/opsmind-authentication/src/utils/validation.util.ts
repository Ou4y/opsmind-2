export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const extractEmailDomain = (email: string): string => {
  const [, domain = ''] = email.split('@');
  return domain.trim().toLowerCase();
};

export const validateAllowedEmailDomain = (email: string, allowedDomains: string[]): boolean => {
  if (!Array.isArray(allowedDomains) || allowedDomains.length === 0) {
    return false;
  }

  const emailDomain = extractEmailDomain(email);
  if (!emailDomain) {
    return false;
  }

  return allowedDomains
    .map((domain) => domain.toLowerCase())
    .includes(emailDomain);
};

export const validatePassword = (password: string): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

export const sanitizeUser = (user: any) => ({
  id: user.id,
  email: user.email,
  firstName: user.first_name,
  lastName: user.last_name,
  name: user.name, // Concatenated full name from SQL
  isVerified: user.is_verified,
  isActive: user.is_active,
  role: user.role, // Single role name from SQL JOIN
  technicianLevel: user.technicianLevel,
  roles: user.roles || [],
  createdAt: user.created_at,
});
