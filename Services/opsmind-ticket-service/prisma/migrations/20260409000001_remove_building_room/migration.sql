-- Remove building and room columns from Ticket table.
-- Location is now represented exclusively by latitude and longitude.

ALTER TABLE `Ticket` DROP COLUMN `building`;
ALTER TABLE `Ticket` DROP COLUMN `room`;
