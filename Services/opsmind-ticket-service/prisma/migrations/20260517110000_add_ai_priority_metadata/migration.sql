-- Ensure ticket priority supports CRITICAL everywhere.
ALTER TABLE `Ticket`
  MODIFY COLUMN `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL;

-- Add AI decision metadata columns.
ALTER TABLE `Ticket`
  ADD COLUMN `ai_prediction_status` VARCHAR(191) NOT NULL DEFAULT 'SKIPPED',
  ADD COLUMN `rule_priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NULL,
  ADD COLUMN `ai_priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NULL,
  ADD COLUMN `ai_confidence` DOUBLE NULL,
  ADD COLUMN `ai_decision_source` VARCHAR(191) NULL,
  ADD COLUMN `ai_explanation` JSON NULL,
  ADD COLUMN `ai_model_name` VARCHAR(191) NULL,
  ADD COLUMN `ai_model_version` VARCHAR(191) NULL,
  ADD COLUMN `ai_predicted_at` DATETIME(3) NULL,
  ADD COLUMN `ai_priority_score` DOUBLE NULL;
