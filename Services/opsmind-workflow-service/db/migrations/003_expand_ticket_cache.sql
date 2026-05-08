-- ═══════════════════════════════════════════════════════════════
--  Migration: Expand Workflow Ticket Cache
--  Date: 2026-05-08
--  Description: Adds ticket lifecycle and assignment fields to workflow_db.tickets
-- ═══════════════════════════════════════════════════════════════

USE workflow_db;

SET @current_schema := DATABASE();

-- Add requester_id
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @current_schema
    AND TABLE_NAME = 'tickets'
    AND COLUMN_NAME = 'requester_id'
);
SET @ddl := IF(
  @col_exists = 0,
  "ALTER TABLE tickets ADD COLUMN requester_id VARCHAR(36) NULL AFTER id",
  "SELECT 'tickets.requester_id already exists' AS migration_info"
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add title
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @current_schema
    AND TABLE_NAME = 'tickets'
    AND COLUMN_NAME = 'title'
);
SET @ddl := IF(
  @col_exists = 0,
  "ALTER TABLE tickets ADD COLUMN title VARCHAR(255) NULL AFTER requester_id",
  "SELECT 'tickets.title already exists' AS migration_info"
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add description
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @current_schema
    AND TABLE_NAME = 'tickets'
    AND COLUMN_NAME = 'description'
);
SET @ddl := IF(
  @col_exists = 0,
  "ALTER TABLE tickets ADD COLUMN description TEXT NULL AFTER title",
  "SELECT 'tickets.description already exists' AS migration_info"
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add type_of_request
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @current_schema
    AND TABLE_NAME = 'tickets'
    AND COLUMN_NAME = 'type_of_request'
);
SET @ddl := IF(
  @col_exists = 0,
  "ALTER TABLE tickets ADD COLUMN type_of_request VARCHAR(50) NULL AFTER description",
  "SELECT 'tickets.type_of_request already exists' AS migration_info"
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add assigned_to_level
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @current_schema
    AND TABLE_NAME = 'tickets'
    AND COLUMN_NAME = 'assigned_to_level'
);
SET @ddl := IF(
  @col_exists = 0,
  "ALTER TABLE tickets ADD COLUMN assigned_to_level ENUM('L1','L2','L3','L4') NULL AFTER assigned_to",
  "SELECT 'tickets.assigned_to_level already exists' AS migration_info"
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add priority
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @current_schema
    AND TABLE_NAME = 'tickets'
    AND COLUMN_NAME = 'priority'
);
SET @ddl := IF(
  @col_exists = 0,
  "ALTER TABLE tickets ADD COLUMN priority VARCHAR(20) NULL AFTER assigned_to_level",
  "SELECT 'tickets.priority already exists' AS migration_info"
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add support_level
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @current_schema
    AND TABLE_NAME = 'tickets'
    AND COLUMN_NAME = 'support_level'
);
SET @ddl := IF(
  @col_exists = 0,
  "ALTER TABLE tickets ADD COLUMN support_level ENUM('L1','L2','L3','L4') NULL AFTER priority",
  "SELECT 'tickets.support_level already exists' AS migration_info"
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add escalation_count
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @current_schema
    AND TABLE_NAME = 'tickets'
    AND COLUMN_NAME = 'escalation_count'
);
SET @ddl := IF(
  @col_exists = 0,
  "ALTER TABLE tickets ADD COLUMN escalation_count INT DEFAULT 0 AFTER status",
  "SELECT 'tickets.escalation_count already exists' AS migration_info"
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add resolution_summary
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @current_schema
    AND TABLE_NAME = 'tickets'
    AND COLUMN_NAME = 'resolution_summary'
);
SET @ddl := IF(
  @col_exists = 0,
  "ALTER TABLE tickets ADD COLUMN resolution_summary TEXT NULL AFTER escalation_count",
  "SELECT 'tickets.resolution_summary already exists' AS migration_info"
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add resolved_at
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @current_schema
    AND TABLE_NAME = 'tickets'
    AND COLUMN_NAME = 'resolved_at'
);
SET @ddl := IF(
  @col_exists = 0,
  "ALTER TABLE tickets ADD COLUMN resolved_at TIMESTAMP NULL AFTER resolution_summary",
  "SELECT 'tickets.resolved_at already exists' AS migration_info"
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add closed_at
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @current_schema
    AND TABLE_NAME = 'tickets'
    AND COLUMN_NAME = 'closed_at'
);
SET @ddl := IF(
  @col_exists = 0,
  "ALTER TABLE tickets ADD COLUMN closed_at TIMESTAMP NULL AFTER resolved_at",
  "SELECT 'tickets.closed_at already exists' AS migration_info"
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════
--  Migration Complete
-- ═══════════════════════════════════════════════════════════════
