-- CreateTable
CREATE TABLE `Ticket` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `requester_id` VARCHAR(191) NOT NULL,
    `assigned_to` VARCHAR(191) NULL,
    `assigned_to_level` ENUM('L1', 'L2', 'L3', 'L4') NOT NULL,
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH') NOT NULL,
    `support_level` ENUM('L1', 'L2', 'L3', 'L4') NOT NULL,
    `status` ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED') NOT NULL,
    `escalation_count` INTEGER NOT NULL DEFAULT 0,
    `resolution_summary` TEXT NULL,
    `building` VARCHAR(191) NOT NULL,
    `room` VARCHAR(191) NOT NULL,
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `closed_at` DATETIME(3) NULL,

    INDEX `Ticket_status_idx`(`status`),
    INDEX `Ticket_priority_idx`(`priority`),
    INDEX `Ticket_assigned_to_idx`(`assigned_to`),
    INDEX `Ticket_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TicketEscalation` (
    `id` VARCHAR(191) NOT NULL,
    `ticket_id` VARCHAR(191) NOT NULL,
    `from_level` ENUM('L1', 'L2', 'L3', 'L4') NOT NULL,
    `to_level` ENUM('L1', 'L2', 'L3', 'L4') NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TicketEscalation` ADD CONSTRAINT `TicketEscalation_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `Ticket`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
