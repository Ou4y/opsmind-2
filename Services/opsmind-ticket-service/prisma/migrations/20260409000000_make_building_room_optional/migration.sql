-- Make building and room nullable.
-- These fields are now optional UI-display fields only.
-- Assignment logic uses latitude/longitude instead.

ALTER TABLE `Ticket` MODIFY COLUMN `building` VARCHAR(191) NULL;
ALTER TABLE `Ticket` MODIFY COLUMN `room` VARCHAR(191) NULL;
