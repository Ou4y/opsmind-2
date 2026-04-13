-- ═══════════════════════════════════════════════════════════════
--  Migration: Add Technician Hierarchy Support
--  Date: 2026-04-12
--  Description: Adds user_id, email to technicians table and creates
--               reporting_relationships table for flexible hierarchy
-- ═══════════════════════════════════════════════════════════════

USE workflow_db;

-- ── Step 1: Update technicians table ──────────────────────────
-- Add new columns for user identity and hierarchy support

ALTER TABLE technicians
  ADD COLUMN user_id INT NOT NULL UNIQUE AFTER id,
  ADD COLUMN email VARCHAR(255) NULL AFTER name,
  ADD COLUMN level ENUM('JUNIOR', 'SENIOR', 'SUPERVISOR', 'ADMIN') NOT NULL DEFAULT 'JUNIOR' AFTER email,
  MODIFY COLUMN status ENUM('ACTIVE', 'OFFLINE', 'INACTIVE', 'ON_LEAVE') DEFAULT 'ACTIVE',
  ADD COLUMN is_active BOOLEAN DEFAULT TRUE AFTER status,
  ADD COLUMN last_location_update TIMESTAMP NULL AFTER is_active,
  ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER last_location_update,
  ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at,
  ADD INDEX idx_user_id (user_id),
  ADD INDEX idx_level (level),
  ADD INDEX idx_is_active (is_active);

-- ── Step 2: Create reporting_relationships table ──────────────
-- Supports flexible, admin-managed technician hierarchy

CREATE TABLE IF NOT EXISTS reporting_relationships (
  id INT AUTO_INCREMENT PRIMARY KEY,
  child_user_id INT NOT NULL COMMENT 'Technician who reports to parent',
  parent_user_id INT NOT NULL COMMENT 'Manager/supervisor of child',
  relationship_type ENUM('JUNIOR_TO_SENIOR', 'SENIOR_TO_SUPERVISOR', 'SUPERVISOR_TO_ADMIN') NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- Constraints
  UNIQUE KEY unique_child_parent (child_user_id, parent_user_id),
  INDEX idx_child_user (child_user_id),
  INDEX idx_parent_user (parent_user_id),
  INDEX idx_relationship_type (relationship_type),
  INDEX idx_is_active (is_active),
  
  -- Foreign keys (soft - references user_id in technicians)
  -- We don't enforce FK because user_id might come from external auth service
  CHECK (child_user_id != parent_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Flexible technician hierarchy - fully admin-managed, no hardcoded limits';

-- ═══════════════════════════════════════════════════════════════
--  Migration Complete
-- ═══════════════════════════════════════════════════════════════
