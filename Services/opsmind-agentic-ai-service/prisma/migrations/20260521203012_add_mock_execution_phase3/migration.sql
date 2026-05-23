-- CreateTable
CREATE TABLE `AgenticMockExecution` (
    `id` VARCHAR(191) NOT NULL,
    `plan_id` VARCHAR(191) NOT NULL,
    `ticket_id` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `started_by_user_id` VARCHAR(191) NULL,
    `started_by_role` VARCHAR(191) NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `failure_reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `AgenticMockExecution_plan_id_idx`(`plan_id`),
    INDEX `AgenticMockExecution_ticket_id_idx`(`ticket_id`),
    INDEX `AgenticMockExecution_status_idx`(`status`),
    INDEX `AgenticMockExecution_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AgenticMockExecutionStep` (
    `id` VARCHAR(191) NOT NULL,
    `execution_id` VARCHAR(191) NOT NULL,
    `step_order` INTEGER NOT NULL,
    `action_key` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `status` ENUM('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `output` TEXT NULL,
    `error_message` TEXT NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `AgenticMockExecutionStep_execution_id_idx`(`execution_id`),
    INDEX `AgenticMockExecutionStep_action_key_idx`(`action_key`),
    INDEX `AgenticMockExecutionStep_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AgenticMockExecutionStep` ADD CONSTRAINT `AgenticMockExecutionStep_execution_id_fkey` FOREIGN KEY (`execution_id`) REFERENCES `AgenticMockExecution`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
