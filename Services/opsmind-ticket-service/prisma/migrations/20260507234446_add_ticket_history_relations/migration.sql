/*
  Warnings:

  - You are about to alter the column `reason` on the `TicketAssignmentHistory` table. The data in that column could be lost. The data in that column will be cast from `VarChar(500)` to `VarChar(191)`.
  - You are about to alter the column `reason` on the `TicketStatusHistory` table. The data in that column could be lost. The data in that column will be cast from `VarChar(500)` to `VarChar(191)`.

*/
-- AlterTable
ALTER TABLE `TicketAssignmentHistory` MODIFY `reason` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `TicketStatusHistory` MODIFY `reason` VARCHAR(191) NULL;
