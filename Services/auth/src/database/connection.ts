import mysql from 'mysql2/promise';
import { config } from '@config/index';
import { logger } from '@config/logger';

export interface DatabasePool {
  pool: mysql.Pool;
  query: <T = any>(sql: string, params?: any[]) => Promise<T>;
  getConnection: () => Promise<mysql.PoolConnection>;
}

let pool: mysql.Pool;

export const initializeDatabase = async (): Promise<DatabasePool> => {
  pool = mysql.createPool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  });

  // Test connection
  try {
    const connection = await pool.getConnection();
    logger.info('Database connected successfully');
    connection.release();
  } catch (error) {
    logger.error('Database connection failed:', error);
    throw error;
  }

  return {
    pool,
    query: async <T = any>(sql: string, params?: any[]): Promise<T> => {
      const [rows] = await pool.execute(sql, params);
      return rows as T;
    },
    getConnection: () => pool.getConnection(),
  };
};

export const getPool = (): mysql.Pool => {
  if (!pool) {
    throw new Error('Database not initialized. Call initializeDatabase first.');
  }
  return pool;
};

export const query = async <T = any>(sql: string, params?: any[]): Promise<T> => {
  const [rows] = await getPool().execute(sql, params);
  return rows as T;
};

export const closeDatabase = async (): Promise<void> => {
  if (pool) {
    await pool.end();
    logger.info('Database connection closed');
  }
};
