-- CreateTable
CREATE TABLE `AgentTask` (
    `id` VARCHAR(191) NOT NULL,
    `plan_id` VARCHAR(191) NOT NULL,
    `ticket_id` VARCHAR(191) NOT NULL,
    `device_id` VARCHAR(191) NOT NULL,
    `status` ENUM('QUEUED', 'CLAIMED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'QUEUED',
    `created_by_user_id` VARCHAR(191) NULL,
    `created_by_role` VARCHAR(191) NULL,
    `claimed_at` DATETIME(3) NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `failure_reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `AgentTask_plan_id_idx`(`plan_id`),
    INDEX `AgentTask_ticket_id_idx`(`ticket_id`),
    INDEX `AgentTask_device_id_idx`(`device_id`),
    INDEX `AgentTask_status_idx`(`status`),
    INDEX `AgentTask_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AgentTaskStep` (
    `id` VARCHAR(191) NOT NULL,
    `task_id` VARCHAR(191) NOT NULL,
    `step_order` INTEGER NOT NULL,
    `action_key` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `params` JSON NULL,
    `status` ENUM('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `output` TEXT NULL,
    `error_message` TEXT NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `AgentTaskStep_task_id_idx`(`task_id`),
    INDEX `AgentTaskStep_action_key_idx`(`action_key`),
    INDEX `AgentTaskStep_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AgentTaskStep` ADD CONSTRAINT `AgentTaskStep_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `AgentTask`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
