import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import { initializeDatabase, query } from './connection';
import { runMigrations } from './migrations';
import { logger } from '@config/logger';

interface Role {
  id: string;
  name: string;
}

const seedRoles = async (): Promise<Role[]> => {
  const roles = [
    { id: uuidv4(), name: 'ADMIN', description: 'System administrator with full access' },
    { id: uuidv4(), name: 'TECHNICIAN', description: 'IT support technician' },
    { id: uuidv4(), name: 'DOCTOR', description: 'Faculty member / Doctor' },
    { id: uuidv4(), name: 'STUDENT', description: 'Student user' },
  ];

  const insertedRoles: Role[] = [];

  for (const role of roles) {
    try {
      await query(
        `INSERT INTO roles (id, name, description) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE description = VALUES(description)`,
        [role.id, role.name, role.description]
      );
      
      // Get the actual role ID (might be existing)
      const [existing] = await query<any[]>(
        `SELECT id, name FROM roles WHERE name = ?`,
        [role.name]
      );
      insertedRoles.push(existing);
      logger.info(`Role seeded: ${role.name}`);
    } catch (error) {
      logger.error(`Failed to seed role ${role.name}:`, error);
    }
  }

  return insertedRoles;
};

const seedAdminUser = async (adminRoleId: string): Promise<void> => {
  const adminEmail = 'admin@opsmind.com';
  const adminPassword = 'Admin@123456';

  // Check if admin exists
  const existingAdmin = await query<any[]>(
    `SELECT id FROM users WHERE email = ?`,
    [adminEmail]
  );

  if (existingAdmin.length > 0) {
    logger.info('Admin user already exists');
    return;
  }

  const adminId = uuidv4();
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  await query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, is_verified, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [adminId, adminEmail, passwordHash, 'System', 'Admin', true, true]
  );

  // Assign admin role
  await query(
    `INSERT INTO user_roles (id, user_id, role_id) VALUES (?, ?, ?)`,
    [uuidv4(), adminId, adminRoleId]
  );

  logger.info(`Admin user created: ${adminEmail}`);
  logger.info('Default admin password: Admin@123456 (CHANGE THIS IN PRODUCTION!)');
};

const seedBuildings = async (): Promise<void> => {
  const buildings = [
    { id: uuidv4(), name: 'Main Building', code: 'MAIN', address: 'Campus Main Entrance' },
    { id: uuidv4(), name: 'Engineering Building', code: 'ENG', address: 'East Wing' },
    { id: uuidv4(), name: 'Science Building', code: 'SCI', address: 'West Wing' },
    { id: uuidv4(), name: 'Library', code: 'LIB', address: 'Central Campus' },
    { id: uuidv4(), name: 'Administration', code: 'ADM', address: 'North Entrance' },
  ];

  for (const building of buildings) {
    try {
      await query(
        `INSERT INTO buildings (id, name, code, address) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), address = VALUES(address)`,
        [building.id, building.name, building.code, building.address]
      );
      logger.info(`Building seeded: ${building.name}`);
    } catch (error) {
      logger.error(`Failed to seed building ${building.name}:`, error);
    }
  }
};

const seed = async () => {
  try {
    logger.info('Starting database seed...');

    // Seed roles and get their IDs
    const roles = await seedRoles();
    const adminRole = roles.find(r => r.name === 'ADMIN');

    if (adminRole) {
      await seedAdminUser(adminRole.id);
    }

    // Seed buildings
    await seedBuildings();

    logger.info('Database seed completed successfully');
  } catch (error) {
    logger.error('Database seed failed:', error);
    throw error;
  }
};

// Export the seed function for programmatic use
export const seedDatabase = seed;

// Only run if this file is executed directly
if (require.main === module) {
  (async () => {
    try {
      await initializeDatabase();
      await runMigrations();
      await seed();
      process.exit(0);
    } catch (error) {
      logger.error('Seed script failed:', error);
      process.exit(1);
    }
  })();
}
