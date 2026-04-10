-- Workflow Service Database Schema
-- Database: workflow_db

CREATE DATABASE IF NOT EXISTS workflow_db;
USE workflow_db;

-- Support Groups Table
-- Represents floor-based technician teams
CREATE TABLE IF NOT EXISTS support_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  building VARCHAR(255) NOT NULL,
  floor INT NOT NULL,
  parent_group_id INT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_building_floor (building, floor),
  FOREIGN KEY (parent_group_id) REFERENCES support_groups(id),
  INDEX idx_building (building),
  INDEX idx_building_floor (building, floor),
  INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Group Members Table
-- Technicians assigned to support groups
CREATE TABLE IF NOT EXISTS group_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  group_id INT NOT NULL,
  role ENUM('JUNIOR', 'SENIOR', 'SUPERVISOR') NOT NULL,
  can_assign BOOLEAN DEFAULT FALSE,
  can_escalate BOOLEAN DEFAULT FALSE,
  status ENUM('ACTIVE', 'INACTIVE', 'ON_LEAVE') DEFAULT 'ACTIVE',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_group (user_id, group_id),
  FOREIGN KEY (group_id) REFERENCES support_groups(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_group_id (group_id),
  INDEX idx_role (role),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Workflow Logs Table
-- Immutable audit trail of all workflow actions
CREATE TABLE IF NOT EXISTS workflow_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id VARCHAR(36) NOT NULL,
  action ENUM('CREATED', 'ROUTED', 'CLAIMED', 'REASSIGNED', 'ESCALATED', 'RESOLVED', 'CLOSED', 'REOPENED') NOT NULL,
  from_group_id INT,
  to_group_id INT,
  from_member_id INT,
  to_member_id INT,
  performed_by INT,
  reason VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ticket_id (ticket_id),
  INDEX idx_action (action),
  INDEX idx_created_at (created_at),
  INDEX idx_ticket_action (ticket_id, action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Escalation Rules Table
-- Defines escalation paths and triggers
CREATE TABLE IF NOT EXISTS escalation_rules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  source_group_id INT NOT NULL,
  target_group_id INT NOT NULL,
  trigger_type ENUM('SLA', 'MANUAL', 'CRITICAL', 'REOPEN_COUNT') NOT NULL,
  delay_minutes INT DEFAULT 0,
  reopen_threshold INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  priority INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (source_group_id) REFERENCES support_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (target_group_id) REFERENCES support_groups(id) ON DELETE CASCADE,
  INDEX idx_source_group (source_group_id),
  INDEX idx_target_group (target_group_id),
  INDEX idx_trigger_type (trigger_type),
  INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ticket Routing Cache Table
-- Tracks current routing state (not the actual ticket)
CREATE TABLE IF NOT EXISTS ticket_routing_state (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id VARCHAR(36) NOT NULL UNIQUE,
  current_group_id INT NOT NULL,
  assigned_member_id INT,
  status ENUM('UNASSIGNED', 'ASSIGNED', 'ESCALATED') DEFAULT 'UNASSIGNED',
  escalation_count INT DEFAULT 0,
  last_escalated_at TIMESTAMP NULL,
  claimed_at TIMESTAMP NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (current_group_id) REFERENCES support_groups(id),
  FOREIGN KEY (assigned_member_id) REFERENCES group_members(id),
  INDEX idx_ticket_id (ticket_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SLA Tracking Table
-- Monitors SLA compliance
CREATE TABLE IF NOT EXISTS sla_tracking (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id VARCHAR(36) NOT NULL UNIQUE,
  priority VARCHAR(50),
  created_at TIMESTAMP,
  assigned_at TIMESTAMP NULL,
  sla_deadline TIMESTAMP,
  sla_breached BOOLEAN DEFAULT FALSE,
  breached_at TIMESTAMP NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ticket_id (ticket_id),
  INDEX idx_sla_deadline (sla_deadline),
  INDEX idx_sla_breached (sla_breached)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
