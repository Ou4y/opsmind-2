import mysql, { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

/**
 * MySQL Connection Pool (TypeScript)
 *
 * - Uses connection pooling for performance
 * - Typed query results with generics
 * - Transaction support for concurrency-safe operations
 * - Retry logic for Docker environments (no depends_on across compose files)
 */

const pool: Pool = mysql.createPool({
  host: process.env.DB_HOST || 'opsmind-mysql',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'workflow_db',
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
  waitForConnections: process.env.DB_WAIT_FOR_CONNECTIONS !== 'false',
  queueLimit: parseInt(process.env.DB_QUEUE_LIMIT || '0', 10),
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  charset: 'utf8mb4',
});

/**
 * Wait for MySQL to be ready (retry with exponential backoff).
 * Essential in Docker: MySQL container may still be initializing
 * when workflow-service starts, especially across separate compose files.
 */
async function waitForDatabase(maxRetries: number = 10, baseDelay: number = 2000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const connection = await pool.getConnection();
      console.log(`✅ MySQL connection established (attempt ${attempt})`);
      connection.release();
      return;
    } catch (error: any) {
      const delay = baseDelay * Math.min(attempt, 5); // cap at 10s
      console.warn(
        `⏳ MySQL not ready (attempt ${attempt}/${maxRetries}): ${error.code || error.message}. Retrying in ${delay / 1000}s...`,
      );
      if (attempt === maxRetries) {
        throw new Error(`❌ Could not connect to MySQL after ${maxRetries} attempts: ${error.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Execute a SELECT query and return typed rows
 */
async function query<T extends RowDataPacket[]>(sql: string, values: any[] = []): Promise<T> {
  const [rows] = await pool.execute<T>(sql, values);
  return rows;
}

/**
 * Execute an INSERT / UPDATE / DELETE and return result metadata
 */
async function execute(sql: string, values: any[] = []): Promise<ResultSetHeader> {
  const [result] = await pool.execute<ResultSetHeader>(sql, values);
  return result;
}

/**
 * Get a raw connection from the pool (for transactions)
 */
async function getConnection(): Promise<PoolConnection> {
  return pool.getConnection();
}

/**
 * Begin a transaction and return the connection
 */
async function beginTransaction(): Promise<PoolConnection> {
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  return connection;
}

export { pool, query, execute, getConnection, beginTransaction, waitForDatabase };
