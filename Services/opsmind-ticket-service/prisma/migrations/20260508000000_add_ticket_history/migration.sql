-- CreateTable
CREATE TABLE `TicketAssignmentHistory` (
    `id` VARCHAR(191) NOT NULL,
    `ticket_id` VARCHAR(191) NOT NULL,
    `previous_assignee` VARCHAR(191) NULL,
    `new_assignee` VARCHAR(191) NULL,
    `previous_level` ENUM('L1', 'L2', 'L3', 'L4') NULL,
    `new_level` ENUM('L1', 'L2', 'L3', 'L4') NULL,
    `method` ENUM('AUTOMATIC', 'MANUAL', 'ADMIN', 'ESCALATION', 'WORKFLOW', 'SYSTEM') NOT NULL,
    `reason` VARCHAR(500) NULL,
    `performed_by` VARCHAR(191) NULL,
    `performed_by_role` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TicketAssignmentHistory_ticket_id_idx`(`ticket_id`),
    INDEX `TicketAssignmentHistory_new_assignee_idx`(`new_assignee`),
    INDEX `TicketAssignmentHistory_performed_by_idx`(`performed_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TicketStatusHistory` (
    `id` VARCHAR(191) NOT NULL,
    `ticket_id` VARCHAR(191) NOT NULL,
    `old_status` ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED') NOT NULL,
    `new_status` ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED') NOT NULL,
    `performed_by` VARCHAR(191) NULL,
    `performed_by_role` VARCHAR(191) NULL,
    `reason` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TicketStatusHistory_ticket_id_idx`(`ticket_id`),
    INDEX `TicketStatusHistory_new_status_idx`(`new_status`),
    INDEX `TicketStatusHistory_performed_by_idx`(`performed_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TicketAssignmentHistory` ADD CONSTRAINT `TicketAssignmentHistory_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `Ticket`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketStatusHistory` ADD CONSTRAINT `TicketStatusHistory_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `Ticket`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
