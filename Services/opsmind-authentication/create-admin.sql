-- Create Admin User
-- Email: mohamed2208868@miuegypt.edu.eg
-- Password: Admin123!
-- First Name: System
-- Last Name: Admin

USE authentication;

-- Step 1: Insert admin user
INSERT INTO users (
  id,
  email,
  password_hash,
  first_name,
  last_name,
  is_verified,
  is_active,
  created_at,
  updated_at
) VALUES (
  UUID(),
  'mohamed2208868@miuegypt.edu.eg',
  '$2b$10$hidq.olnfBOvE/V5OZ9cL.AtlJuvx6WslDGvRJ8Xhppe2r9ZyRtui',
  'System',
  'Admin',
  1,  -- Already verified
  1,  -- Active account
  NOW(),
  NOW()
)
ON DUPLICATE KEY UPDATE 
  email = email; -- Don't update if already exists

-- Step 2: Assign ADMIN role to the user
INSERT INTO user_roles (id, user_id, role_id, created_at)
SELECT 
  UUID(),
  u.id,
  r.id,
  NOW()
FROM users u
CROSS JOIN roles r
WHERE u.email = 'mohamed2208868@miuegypt.edu.eg'
  AND r.name = 'ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur2 
    WHERE ur2.user_id = u.id AND ur2.role_id = r.id
  );

-- Step 3: Verify the admin user was created
SELECT 
  u.id,
  u.email,
  u.first_name,
  u.last_name,
  r.name as role,
  u.is_verified,
  u.is_active,
  u.created_at
FROM users u
JOIN user_roles ur ON u.id = ur.user_id
JOIN roles r ON ur.role_id = r.id
WHERE u.email = 'mohamed2208868@miuegypt.edu.eg';
