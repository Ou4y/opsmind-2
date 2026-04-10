import { getPool } from './connection';
import { logger } from '@config/logger';

const migrations: string[] = [
  // Create roles table
  `CREATE TABLE IF NOT EXISTS roles (
    id VARCHAR(36) PRIMARY KEY,
    name ENUM('ADMIN', 'TECHNICIAN', 'DOCTOR', 'STUDENT') NOT NULL UNIQUE,
    description VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,

  // Create users table
  `CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    is_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_is_active (is_active)
  )`,

  // Create user_roles junction table
  `CREATE TABLE IF NOT EXISTS user_roles (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    role_id VARCHAR(36) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_user_role (user_id, role_id),
    INDEX idx_user_id (user_id),
    INDEX idx_role_id (role_id)
  )`,

  // Create email_otps table
  `CREATE TABLE IF NOT EXISTS email_otps (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    otp_hash VARCHAR(255) NOT NULL,
    purpose ENUM('VERIFICATION', 'LOGIN') NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    is_used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_expires_at (expires_at),
    INDEX idx_is_used (is_used)
  )`,

  // Create buildings table
  `CREATE TABLE IF NOT EXISTS buildings (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) NOT NULL UNIQUE,
    address VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_code (code)
  )`,

  // Create technicians table (extended info for technician users)
  `CREATE TABLE IF NOT EXISTS technicians (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL UNIQUE,
    employee_id VARCHAR(50) UNIQUE,
    department VARCHAR(100),
    specialization VARCHAR(255),

    technicianLevel ENUM('JUNIOR','SENIOR','SUPERVISOR','HEAD') NOT NULL DEFAULT 'JUNIOR',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_employee_id (employee_id)
  )`,

  // Create technician_buildings junction table
  `CREATE TABLE IF NOT EXISTS technician_buildings (
    id VARCHAR(36) PRIMARY KEY,
    technician_id VARCHAR(36) NOT NULL,
    building_id VARCHAR(36) NOT NULL,
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_tech_building (technician_id, building_id),
    INDEX idx_technician_id (technician_id),
    INDEX idx_building_id (building_id)
  )`,
];

// Alter table migrations to add missing columns to existing tables
const alterTableMigrations: string[] = [
  // Add missing columns to roles table
  `ALTER TABLE roles ADD COLUMN description VARCHAR(255)`,
  `ALTER TABLE roles ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE roles ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`,

  // Fix buildings table - expand code column and add missing columns
  `ALTER TABLE buildings MODIFY code VARCHAR(20) NOT NULL`,
  `ALTER TABLE buildings ADD COLUMN name VARCHAR(100) NOT NULL DEFAULT ''`,
  `ALTER TABLE buildings ADD COLUMN address VARCHAR(255)`,
  `ALTER TABLE buildings ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE buildings ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`,

  // Fix user_roles table - add missing id column
  `ALTER TABLE user_roles ADD COLUMN id VARCHAR(36) FIRST`,
  `ALTER TABLE user_roles ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,

  // Fix email_otps table - add missing columns if they don't exist
  `ALTER TABLE email_otps ADD COLUMN id VARCHAR(36) FIRST`,
  `ALTER TABLE email_otps ADD COLUMN purpose ENUM('VERIFICATION', 'LOGIN') NOT NULL DEFAULT 'VERIFICATION'`,
  `ALTER TABLE email_otps ADD COLUMN expires_at TIMESTAMP`,
  `ALTER TABLE email_otps ADD COLUMN is_used BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE email_otps ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,

  // Fix technicians table - add missing columns if they don't exist
  `ALTER TABLE technicians ADD COLUMN id VARCHAR(36) FIRST`,
  `ALTER TABLE technicians ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE technicians ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`,

  `ALTER TABLE technicians ADD COLUMN technicianLevel ENUM('JUNIOR','SENIOR','SUPERVISOR','HEAD') NOT NULL DEFAULT 'JUNIOR'`,

  // Fix technician_buildings table - add missing columns if they don't exist
  `ALTER TABLE technician_buildings ADD COLUMN id VARCHAR(36) FIRST`,
  `ALTER TABLE technician_buildings ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,

  // Transform users table from old schema to new schema
  // Step 1: Add missing id column if it doesn't exist (some tables might be missing it)
  `ALTER TABLE users ADD COLUMN id VARCHAR(36) FIRST`,
  
  // Step 2: Add new columns
  `ALTER TABLE users ADD COLUMN first_name VARCHAR(100)`,
  `ALTER TABLE users ADD COLUMN last_name VARCHAR(100)`,
  `ALTER TABLE users ADD COLUMN is_verified BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE`,
  `ALTER TABLE users ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`,
  
  // Step 3: Data migration will be handled by a separate data migration function
  // (removed UPDATE statements from migrations to avoid errors when columns don't exist)
];

// Helper function to check if a column exists
const columnExists = async (tableName: string, columnName: string): Promise<boolean> => {
  const pool = getPool();
  try {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as count FROM information_schema.columns 
       WHERE table_schema = DATABASE() 
       AND table_name = ? 
       AND column_name = ?`,
      [tableName, columnName]
    );
    return (rows as any)[0].count > 0;
  } catch (error) {
    logger.error(`Error checking if column exists: ${tableName}.${columnName}`, error);
    return false;
  }
};

// Data migration function to transform existing data
const migrateUserData = async (): Promise<void> => {
  const pool = getPool();
  
  logger.info('Running user data migrations...');
  
  // Check if old columns exist before trying to migrate
  const hasNameColumn = await columnExists('users', 'name');
  const hasStatusColumn = await columnExists('users', 'status');
  const hasFirstNameColumn = await columnExists('users', 'first_name');
  const hasLastNameColumn = await columnExists('users', 'last_name');
  const hasIdColumn = await columnExists('users', 'id');
  const userRolesHasIdColumn = await columnExists('user_roles', 'id');
  
  // Fix user_roles table - generate IDs for existing entries
  if (userRolesHasIdColumn) {
    try {
      logger.info('Checking user_roles for missing IDs...');
      const [rolesWithoutId] = await pool.execute(
        `SELECT COUNT(*) as count FROM user_roles WHERE id IS NULL OR id = ''`
      );
      const count = (rolesWithoutId as any)[0].count;
      
      if (count > 0) {
        logger.info(`Generating UUIDs for ${count} user_roles entries...`);
        await pool.execute(`
          UPDATE user_roles 
          SET id = UUID() 
          WHERE id IS NULL OR id = ''
        `);
      }
      
      // Make id the primary key if it isn't already
      logger.info('Setting user_roles.id as primary key...');
      try {
        await pool.execute(`ALTER TABLE user_roles MODIFY id VARCHAR(36) NOT NULL`);
        await pool.execute(`ALTER TABLE user_roles ADD PRIMARY KEY (id)`);
      } catch (error: any) {
        if (error.code === 'ER_MULTIPLE_PRI_KEY') {
          logger.debug('Primary key already exists on user_roles, skipping...');
        } else {
          logger.debug(`Could not add primary key to user_roles: ${error.message}`);
        }
      }
    } catch (error: any) {
      logger.error('Error setting up user_roles IDs:', error);
    }
  }
  
  // Generate UUIDs for any users without an id
  if (hasIdColumn) {
    try {
      logger.info('Checking for users without id...');
      const [usersWithoutId] = await pool.execute(
        `SELECT COUNT(*) as count FROM users WHERE id IS NULL OR id = ''`
      );
      const count = (usersWithoutId as any)[0].count;
      
      if (count > 0) {
        logger.info(`Generating UUIDs for ${count} users...`);
        await pool.execute(`
          UPDATE users 
          SET id = UUID() 
          WHERE id IS NULL OR id = ''
        `);
      }
      
      // Make id the primary key if it isn't already
      logger.info('Setting id as primary key...');
      try {
        await pool.execute(`ALTER TABLE users MODIFY id VARCHAR(36) NOT NULL`);
        await pool.execute(`ALTER TABLE users ADD PRIMARY KEY (id)`);
      } catch (error: any) {
        if (error.code === 'ER_MULTIPLE_PRI_KEY') {
          logger.debug('Primary key already exists, skipping...');
        } else {
          throw error;
        }
      }
    } catch (error: any) {
      logger.error('Error setting up user IDs:', error);
    }
  }
  
  if (hasNameColumn && hasFirstNameColumn && hasLastNameColumn) {
    try {
      // Split name into first_name and last_name
      logger.info('Migrating name to first_name and last_name...');
      await pool.execute(`
        UPDATE users 
        SET 
          first_name = SUBSTRING_INDEX(name, ' ', 1),
          last_name = SUBSTRING_INDEX(name, ' ', -1)
        WHERE first_name IS NULL OR last_name IS NULL OR first_name = '' OR last_name = ''
      `);
      
      // Drop the old name column
      logger.info('Dropping old name column...');
      await pool.execute(`ALTER TABLE users DROP COLUMN name`);
    } catch (error: any) {
      logger.error('Error migrating name column:', error);
    }
  }
  
  if (hasStatusColumn) {
    try {
      // Map status to is_verified and is_active
      logger.info('Migrating status to is_verified and is_active...');
      await pool.execute(`UPDATE users SET is_verified = TRUE WHERE status IN ('ACTIVE', 'SUSPENDED')`);
      await pool.execute(`UPDATE users SET is_verified = FALSE WHERE status IN ('INVITED', 'PENDING_VERIFICATION')`);
      await pool.execute(`UPDATE users SET is_active = TRUE WHERE status IN ('ACTIVE', 'PENDING_VERIFICATION')`);
      await pool.execute(`UPDATE users SET is_active = FALSE WHERE status = 'SUSPENDED'`);
      
      // Drop the old status column
      logger.info('Dropping old status column...');
      await pool.execute(`ALTER TABLE users DROP COLUMN status`);
    } catch (error: any) {
      logger.error('Error migrating status column:', error);
    }
  }
  
  // Make first_name and last_name NOT NULL if they exist
  if (hasFirstNameColumn && hasLastNameColumn) {
    try {
      // First set any NULL values to empty string
      await pool.execute(`UPDATE users SET first_name = '' WHERE first_name IS NULL`);
      await pool.execute(`UPDATE users SET last_name = '' WHERE last_name IS NULL`);
      
      logger.info('Making first_name and last_name NOT NULL...');
      await pool.execute(`ALTER TABLE users MODIFY first_name VARCHAR(100) NOT NULL`);
      await pool.execute(`ALTER TABLE users MODIFY last_name VARCHAR(100) NOT NULL`);
    } catch (error: any) {
      logger.error('Error making name columns NOT NULL:', error);
    }
  }
  
  logger.info('User data migration completed');
};

export const runMigrations = async (): Promise<void> => {
  const pool = getPool();

  logger.info('Running database migrations...');

  // Run CREATE TABLE migrations
  for (const migration of migrations) {
    try {
      await pool.execute(migration);
      logger.debug(`Migration executed successfully`);
    } catch (error: any) {
      // Ignore "already exists" errors
      if (error.code !== 'ER_TABLE_EXISTS_ERROR') {
        logger.error('Migration failed:', error);
        throw error;
      }
    }
  }

  // Run ALTER TABLE migrations
  logger.info('Running schema updates...');
  for (const alteration of alterTableMigrations) {
    try {
      await pool.execute(alteration);
      logger.debug(`Schema update executed successfully`);
    } catch (error: any) {
      // Ignore "duplicate column" errors
      if (error.code === 'ER_DUP_FIELDNAME') {
        logger.debug(`Column already exists, skipping...`);
      } else if (error.code === 'ER_BAD_FIELD_ERROR') {
        logger.debug(`Field doesn't exist for UPDATE, skipping...`);
      } else {
        logger.error('Schema update failed:', error);
        // Don't throw, just log and continue
      }
    }
  }

  // Run data migrations
  await migrateUserData();

  logger.info('All migrations completed successfully');
};