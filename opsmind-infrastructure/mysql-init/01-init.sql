-- Create databases
CREATE DATABASE IF NOT EXISTS Tickets;
CREATE DATABASE IF NOT EXISTS opsmind_ai;

-- Ensure the application users exist (MySQL 8)
CREATE USER IF NOT EXISTS 'opsmind'@'%' IDENTIFIED BY 'opsmind';
CREATE USER IF NOT EXISTS 'opsmind'@'localhost' IDENTIFIED BY 'opsmind';
CREATE USER IF NOT EXISTS 'root'@'%' IDENTIFIED BY 'root';

-- Grant ALL privileges to opsmind user on ALL databases (localhost)
GRANT ALL PRIVILEGES ON *.* TO 'opsmind'@'localhost' WITH GRANT OPTION;

-- Grant ALL privileges to opsmind user on ALL databases (remote)
GRANT ALL PRIVILEGES ON *.* TO 'opsmind'@'%' WITH GRANT OPTION;

-- Grant ALL privileges to root user on ALL databases (remote)
GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;

-- Grant SUPER privilege for advanced operations
GRANT SUPER ON *.* TO 'opsmind'@'localhost';
GRANT SUPER ON *.* TO 'opsmind'@'%';
GRANT SUPER ON *.* TO 'root'@'%';

FLUSH PRIVILEGES;

-- Switch to the AI database
USE opsmind_ai;

-- Create the sla_feedback table
CREATE TABLE IF NOT EXISTS sla_feedback (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ticket_id VARCHAR(255) NOT NULL,
    ai_probability DECIMAL(5,4) NOT NULL,
    admin_decision TINYINT NOT NULL CHECK (admin_decision IN (0, 1)),
    final_outcome TINYINT NOT NULL CHECK (final_outcome IN (0, 1)),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ticket_id (ticket_id),
    INDEX idx_created_at (created_at)
);

-- Create the model_training_meta table
CREATE TABLE IF NOT EXISTS model_training_meta (
    id INT AUTO_INCREMENT PRIMARY KEY,
    model_name VARCHAR(255) NOT NULL UNIQUE,
    last_trained_feedback_id INT NOT NULL DEFAULT 0,
    last_trained_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    training_count INT DEFAULT 0,
    INDEX idx_model_name (model_name)
);

-- Insert initial metadata for the SLA model
INSERT IGNORE INTO model_training_meta (model_name, last_trained_feedback_id) 
VALUES ('sla_model_v1', 0);

-- Optional: Create some sample data for testing
INSERT IGNORE INTO sla_feedback (ticket_id, ai_probability, admin_decision, final_outcome) VALUES
('TICKET-001', 0.8500, 1, 1),
('TICKET-002', 0.3200, 0, 0),
('TICKET-003', 0.7800, 1, 1),
('TICKET-004', 0.2100, 0, 0),
('TICKET-005', 0.9200, 1, 1);