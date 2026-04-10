import { initializeDatabase } from './connection';
import { runMigrations } from './migrations';
import { logger } from '@config/logger';

const migrate = async () => {
  try {
    await initializeDatabase();
    await runMigrations();
    logger.info('Database migration completed');
    process.exit(0);
  } catch (error) {
    logger.error('Database migration failed:', error);
    process.exit(1);
  }
};

migrate();
