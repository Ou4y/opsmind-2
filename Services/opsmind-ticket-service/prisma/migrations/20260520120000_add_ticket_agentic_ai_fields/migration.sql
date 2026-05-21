-- Add endpoint soft-reference and Agentic AI eligibility metadata.
-- No endpoint registry table or foreign keys are introduced in this migration.
ALTER TABLE `Ticket`
  ADD COLUMN `affected_device_id` VARCHAR(191) NULL,
  ADD COLUMN `affected_device_name` VARCHAR(191) NULL,
  ADD COLUMN `os_type` ENUM('WINDOWS', 'MACOS', 'LINUX', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN `issue_scope` ENUM('MY_DEVICE', 'ROOM_DEVICE', 'MULTIPLE_DEVICES', 'BUILDING_WIDE', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN `remote_support_consent` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `remote_support_consent_at` DATETIME(3) NULL,
  ADD COLUMN `remote_support_consent_by` VARCHAR(191) NULL,
  ADD COLUMN `ai_agent_eligible` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `ai_agent_eligibility_reason` VARCHAR(191) NULL;

CREATE INDEX `Ticket_affected_device_id_idx` ON `Ticket`(`affected_device_id`);
CREATE INDEX `Ticket_ai_agent_eligible_idx` ON `Ticket`(`ai_agent_eligible`);
CREATE INDEX `Ticket_issue_scope_idx` ON `Ticket`(`issue_scope`);
