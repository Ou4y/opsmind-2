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

const getRoleId = async (roleName: string): Promise<string | null> => {
  const [role] = await query<any[]>(
    `SELECT id FROM roles WHERE name = ?`,
    [roleName]
  );
  return role?.id || null;
};

const getBuildingId = async (buildingCode: string): Promise<string | null> => {
  const [building] = await query<any[]>(
    `SELECT id FROM buildings WHERE code = ?`,
    [buildingCode]
  );
  return building?.id || null;
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

type LocalQaInventoryUser = {
  email: string;
  firstName: string;
  lastName: string;
  role: 'ADMIN' | 'TECHNICIAN';
  technicianLevel?: 'JUNIOR' | 'SENIOR' | 'SUPERVISOR' | 'ADMIN';
  buildingCode?: string;
};

const syncLocalQaWorkflowProfile = async (qaUser: LocalQaInventoryUser, userId: string): Promise<void> => {
  if (qaUser.role !== 'TECHNICIAN' || !qaUser.technicianLevel) {
    return;
  }

  const workflowServiceUrl = String(process.env.WORKFLOW_SERVICE_URL || '').trim();
  if (!workflowServiceUrl) {
    return;
  }

  try {
    const response = await fetch(`${workflowServiceUrl}/workflow/admin/hierarchy/technicians/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authUserId: userId,
        firstName: qaUser.firstName,
        lastName: qaUser.lastName,
        email: qaUser.email,
        authRole: qaUser.role,
        technicianLevel: qaUser.technicianLevel,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: string } | null;
      logger.warn(`Local QA workflow profile sync skipped for ${qaUser.email}: ${body?.message || response.statusText}`);
      return;
    }

    logger.info(`Local QA workflow profile synced: ${qaUser.email}`);
  } catch (error: any) {
    logger.warn(`Local QA workflow profile sync unavailable for ${qaUser.email}: ${error?.message || error}`);
  }
};

const shouldSeedLocalQaInventoryUsers = (): boolean => {
  const nodeEnv = String(process.env.NODE_ENV || 'development').toLowerCase();
  const disabled = String(process.env.OPSMIND_DISABLE_LOCAL_QA_USERS || '').toLowerCase() === 'true';
  return nodeEnv !== 'production' && !disabled;
};

const seedLocalQaInventoryUsers = async (): Promise<void> => {
  if (!shouldSeedLocalQaInventoryUsers()) {
    logger.info('Local QA Inventory users seed skipped outside local/dev mode');
    return;
  }

  const passwordHash = await bcrypt.hash('Qa@123456', 12);
  const qaUsers: LocalQaInventoryUser[] = [
    {
      email: 'qa.junior@opsmind.local',
      firstName: 'QA',
      lastName: 'Junior',
      role: 'TECHNICIAN',
      technicianLevel: 'JUNIOR',
      buildingCode: 'MAIN',
    },
    {
      email: 'qa.senior@opsmind.local',
      firstName: 'QA',
      lastName: 'Senior',
      role: 'TECHNICIAN',
      technicianLevel: 'SENIOR',
      buildingCode: 'MAIN',
    },
    {
      email: 'qa.supervisor@opsmind.local',
      firstName: 'QA',
      lastName: 'Building Supervisor',
      role: 'TECHNICIAN',
      technicianLevel: 'SUPERVISOR',
      buildingCode: 'MAIN',
    },
    {
      email: 'qa.chief@opsmind.local',
      firstName: 'QA',
      lastName: 'Supervisor Chief',
      role: 'TECHNICIAN',
      technicianLevel: 'SUPERVISOR',
    },
    {
      email: 'qa.admin@opsmind.local',
      firstName: 'QA',
      lastName: 'Admin',
      role: 'ADMIN',
      technicianLevel: 'ADMIN',
    },
  ];

  for (const qaUser of qaUsers) {
    const roleId = await getRoleId(qaUser.role);
    if (!roleId) {
      logger.warn(`Skipping local QA user ${qaUser.email}: role ${qaUser.role} is not available`);
      continue;
    }

    const [existingUser] = await query<any[]>(
      `SELECT id FROM users WHERE email = ?`,
      [qaUser.email]
    );
    const userId = existingUser?.id || uuidv4();

    if (existingUser?.id) {
      await query(
        `UPDATE users
         SET password_hash = ?, first_name = ?, last_name = ?, is_verified = TRUE, is_active = TRUE
         WHERE id = ?`,
        [passwordHash, qaUser.firstName, qaUser.lastName, userId]
      );
    } else {
      await query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, is_verified, is_active)
         VALUES (?, ?, ?, ?, ?, TRUE, TRUE)`,
        [userId, qaUser.email, passwordHash, qaUser.firstName, qaUser.lastName]
      );
    }

    await query(`DELETE FROM user_roles WHERE user_id = ?`, [userId]);
    await query(
      `INSERT INTO user_roles (id, user_id, role_id) VALUES (?, ?, ?)`,
      [uuidv4(), userId, roleId]
    );

    if (qaUser.role === 'TECHNICIAN') {
      const [existingTechnician] = await query<any[]>(
        `SELECT id FROM technicians WHERE user_id = ?`,
        [userId]
      );
      const technicianId = existingTechnician?.id || uuidv4();

      if (existingTechnician?.id) {
        await query(
          `UPDATE technicians
           SET technicianLevel = ?, department = ?, specialization = ?
           WHERE id = ?`,
          [
            qaUser.technicianLevel || 'JUNIOR',
            'Inventory QA',
            'Local browser approval testing',
            technicianId,
          ]
        );
      } else {
        await query(
          `INSERT INTO technicians (id, user_id, employee_id, department, specialization, technicianLevel)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            technicianId,
            userId,
            `QA-${qaUser.email.split('@')[0].replace(/\W+/g, '-').toUpperCase()}`,
            'Inventory QA',
            'Local browser approval testing',
            qaUser.technicianLevel || 'JUNIOR',
          ]
        );
      }

      if (qaUser.buildingCode) {
        const buildingId = await getBuildingId(qaUser.buildingCode);
        if (buildingId) {
          await query(
            `UPDATE technician_buildings SET is_primary = FALSE WHERE technician_id = ?`,
            [technicianId]
          );
          await query(
            `INSERT INTO technician_buildings (id, technician_id, building_id, is_primary)
             VALUES (?, ?, ?, TRUE)
             ON DUPLICATE KEY UPDATE is_primary = TRUE`,
            [uuidv4(), technicianId, buildingId]
          );
        }
      }

      await syncLocalQaWorkflowProfile(qaUser, userId);
    }

    logger.info(`Local QA Inventory user ready: ${qaUser.email}`);
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

    // Seed local-only Inventory/Procurement QA users for browser approval testing.
    await seedLocalQaInventoryUsers();

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
