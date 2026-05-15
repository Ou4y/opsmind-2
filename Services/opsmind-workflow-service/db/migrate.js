#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const MIGRATIONS_TABLE = 'schema_migrations';

const DB_HOST = process.env.DB_HOST || 'mysql';
const DB_PORT = Number.parseInt(process.env.DB_PORT || '3306', 10);
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || 'root';
const DB_NAME = process.env.DB_NAME || 'workflow_db';

const DB_CONNECT_RETRIES = Number.parseInt(process.env.DB_CONNECT_RETRIES || '20', 10);
const DB_CONNECT_RETRY_DELAY_MS = Number.parseInt(process.env.DB_CONNECT_RETRY_DELAY_MS || '3000', 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeId(identifier) {
  return `\`${String(identifier).replace(/`/g, '``')}\``;
}

function checksum(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

async function connectWithRetry() {
  let lastError = null;

  for (let attempt = 1; attempt <= DB_CONNECT_RETRIES; attempt++) {
    try {
      const conn = await mysql.createConnection({
        host: DB_HOST,
        port: DB_PORT,
        user: DB_USER,
        password: DB_PASSWORD,
        multipleStatements: true,
        charset: 'utf8mb4',
      });
      console.log(`[Migrate] Connected to MySQL on attempt ${attempt}.`);
      return conn;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[Migrate] MySQL connection attempt ${attempt}/${DB_CONNECT_RETRIES} failed (${message}). Retrying in ${DB_CONNECT_RETRY_DELAY_MS}ms...`,
      );
      if (attempt < DB_CONNECT_RETRIES) {
        await sleep(DB_CONNECT_RETRY_DELAY_MS);
      }
    }
  }

  throw new Error(
    `[Migrate] Could not connect to MySQL after ${DB_CONNECT_RETRIES} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function tableExists(conn, tableName) {
  const [rows] = await conn.query(
    `
      SELECT COUNT(*) AS count
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
    `,
    [tableName],
  );
  return Number(rows[0].count) > 0;
}

async function columnExists(conn, tableName, columnName) {
  const [rows] = await conn.query(
    `
      SELECT COUNT(*) AS count
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
    `,
    [tableName, columnName],
  );
  return Number(rows[0].count) > 0;
}

async function columnsExist(conn, tableName, columnNames) {
  for (const columnName of columnNames) {
    if (!(await columnExists(conn, tableName, columnName))) {
      return false;
    }
  }
  return true;
}

async function isMigrationSatisfied(conn, migrationFileName) {
  if (migrationFileName === '001_add_technician_hierarchy.sql') {
    const hasTechniciansTable = await tableExists(conn, 'technicians');
    const hasReportingRelationships = await tableExists(conn, 'reporting_relationships');
    const hasIdentityMap = await tableExists(conn, 'auth_user_identity_map');

    if (!hasTechniciansTable || !hasReportingRelationships || !hasIdentityMap) {
      return false;
    }

    return columnsExist(conn, 'technicians', [
      'user_id',
      'auth_user_id',
      'email',
      'level',
      'is_active',
      'last_location_update',
      'created_at',
      'updated_at',
    ]);
  }

  if (migrationFileName === '002_add_auth_identity_bridge.sql') {
    const hasIdentityMap = await tableExists(conn, 'auth_user_identity_map');
    const hasAuthUserColumn = await columnExists(conn, 'technicians', 'auth_user_id');
    return hasIdentityMap && hasAuthUserColumn;
  }

  if (migrationFileName === '003_expand_ticket_cache.sql') {
    const hasTicketsTable = await tableExists(conn, 'tickets');
    if (!hasTicketsTable) {
      return false;
    }

    return columnsExist(conn, 'tickets', [
      'requester_id',
      'title',
      'description',
      'type_of_request',
      'assigned_to_level',
      'priority',
      'support_level',
      'escalation_count',
      'resolution_summary',
      'resolved_at',
      'closed_at',
    ]);
  }

  return false;
}

async function ensureMigrationsTable(conn) {
  await conn.query(
    `
      CREATE TABLE IF NOT EXISTS ${escapeId(MIGRATIONS_TABLE)} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        checksum VARCHAR(64) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'applied',
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
  );
}

async function getAppliedMigrations(conn) {
  const [rows] = await conn.query(`SELECT filename FROM ${escapeId(MIGRATIONS_TABLE)}`);
  return new Set(rows.map((row) => String(row.filename)));
}

async function markMigrationApplied(conn, fileName, fileChecksum, status) {
  await conn.query(
    `
      INSERT INTO ${escapeId(MIGRATIONS_TABLE)} (filename, checksum, status)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        checksum = VALUES(checksum),
        status = VALUES(status),
        applied_at = CURRENT_TIMESTAMP
    `,
    [fileName, fileChecksum, status],
  );
}

async function applyMigrations(conn) {
  const migrationFileNames = (await fs.readdir(MIGRATIONS_DIR))
    .filter((fileName) => fileName.toLowerCase().endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  const applied = await getAppliedMigrations(conn);

  for (const fileName of migrationFileNames) {
    const filePath = path.join(MIGRATIONS_DIR, fileName);
    const sql = await fs.readFile(filePath, 'utf8');
    const fileChecksum = checksum(sql);

    if (applied.has(fileName)) {
      console.log(`[Migrate] Skipping already-applied migration: ${fileName}`);
      continue;
    }

    if (await isMigrationSatisfied(conn, fileName)) {
      await markMigrationApplied(conn, fileName, fileChecksum, 'baseline');
      console.log(`[Migrate] Baseline satisfied for ${fileName}; marked as applied.`);
      continue;
    }

    console.log(`[Migrate] Applying migration: ${fileName}`);
    try {
      await conn.query(sql);
      await markMigrationApplied(conn, fileName, fileChecksum, 'applied');
      console.log(`[Migrate] Applied migration: ${fileName}`);
    } catch (error) {
      const nowSatisfied = await isMigrationSatisfied(conn, fileName);
      if (nowSatisfied) {
        await markMigrationApplied(conn, fileName, fileChecksum, 'applied_after_recovery');
        console.warn(`[Migrate] Migration ${fileName} reported an error but schema is satisfied. Marked as applied.`);
        continue;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`[Migrate] Failed migration ${fileName}: ${message}`);
    }
  }
}

async function main() {
  let conn = null;
  try {
    conn = await connectWithRetry();

    await conn.query(`CREATE DATABASE IF NOT EXISTS ${escapeId(DB_NAME)}`);
    await conn.query(`USE ${escapeId(DB_NAME)}`);

    await ensureMigrationsTable(conn);
    await applyMigrations(conn);

    console.log('[Migrate] Workflow migrations completed successfully.');
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  } finally {
    if (conn) {
      await conn.end();
    }
  }
}

main();
