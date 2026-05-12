-- Align ticket history reason columns with the current Prisma schema.
-- These tables are created by 20260508000000_add_ticket_history.

ALTER TABLE `TicketAssignmentHistory` MODIFY `reason` VARCHAR(191) NULL;
ALTER TABLE `TicketStatusHistory` MODIFY `reason` VARCHAR(191) NULL;
