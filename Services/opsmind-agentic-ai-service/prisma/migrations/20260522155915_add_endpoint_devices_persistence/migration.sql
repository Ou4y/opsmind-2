-- CreateTable
CREATE TABLE `EndpointDevice` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `device_name` VARCHAR(191) NOT NULL,
    `os_type` VARCHAR(191) NOT NULL DEFAULT 'UNKNOWN',
    `agent_version` VARCHAR(191) NULL,
    `agent_status` ENUM('ONLINE', 'OFFLINE', 'DISABLED') NOT NULL DEFAULT 'OFFLINE',
    `last_seen_at` DATETIME(3) NULL,
    `registered_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `is_agent_enabled` BOOLEAN NOT NULL DEFAULT true,

    INDEX `EndpointDevice_user_id_idx`(`user_id`),
    INDEX `EndpointDevice_agent_status_idx`(`agent_status`),
    INDEX `EndpointDevice_last_seen_at_idx`(`last_seen_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
