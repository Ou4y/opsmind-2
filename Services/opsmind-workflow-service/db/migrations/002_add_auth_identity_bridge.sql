-- ═══════════════════════════════════════════════════════════════
--  Migration: Add Auth Identity Bridge
--  Date: 2026-04-18
--  Description: Adds auth UUID mapping support to workflow technicians
--               to resolve auth role vs workflow hierarchy conflicts.
-- ═══════════════════════════════════════════════════════════════

USE workflow_db;

-- Add auth_user_id column to technicians (idempotent, MySQL-compatible)
SET @current_schema := DATABASE();

SET @auth_user_id_column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @current_schema
    AND TABLE_NAME = 'technicians'
    AND COLUMN_NAME = 'auth_user_id'
);

SET @ddl := IF(
  @auth_user_id_column_exists = 0,
  "ALTER TABLE technicians ADD COLUMN auth_user_id VARCHAR(36) NULL COMMENT 'Auth service UUID (source-of-truth identity)' AFTER user_id",
  "SELECT 'technicians.auth_user_id already exists' AS migration_info"
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Ensure auth_user_id has a UNIQUE index (required for deterministic upsert)
SET @auth_user_id_unique_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @current_schema
    AND TABLE_NAME = 'technicians'
    AND COLUMN_NAME = 'auth_user_id'
    AND NON_UNIQUE = 0
);

SET @ddl := IF(
  @auth_user_id_unique_exists = 0,
  'ALTER TABLE technicians ADD UNIQUE INDEX uq_technicians_auth_user_id (auth_user_id)',
  "SELECT 'Unique index on technicians.auth_user_id already exists' AS migration_info"
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Keep a named lookup index for existing query patterns/documentation
SET @auth_user_id_lookup_index_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @current_schema
    AND TABLE_NAME = 'technicians'
    AND INDEX_NAME = 'idx_auth_user_id'
);

SET @ddl := IF(
  @auth_user_id_lookup_index_exists = 0,
  'ALTER TABLE technicians ADD INDEX idx_auth_user_id (auth_user_id)',
  "SELECT 'Index technicians.idx_auth_user_id already exists' AS migration_info"
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Create UUID -> numeric workflow identity map
CREATE TABLE IF NOT EXISTS auth_user_identity_map (
  workflow_user_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  auth_user_id VARCHAR(36) NOT NULL UNIQUE,
  auth_role ENUM('ADMIN', 'TECHNICIAN', 'DOCTOR', 'STUDENT') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_auth_role (auth_role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci AUTO_INCREMENT=100000;

-- ═══════════════════════════════════════════════════════════════
--  Migration Complete
-- ═══════════════════════════════════════════════════════════════
