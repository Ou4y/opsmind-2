-- Create databases
CREATE DATABASE IF NOT EXISTS Tickets;
CREATE DATABASE IF NOT EXISTS opsmind_ai;
CREATE DATABASE IF NOT EXISTS agentic_ai_db;
CREATE DATABASE IF NOT EXISTS authentication;
CREATE DATABASE IF NOT EXISTS sla_db;

-- The opsmind account is created by MYSQL_USER/MYSQL_PASSWORD from docker-compose.
-- Keep grants database-scoped and avoid hard-coded passwords or remote root users.
GRANT ALL PRIVILEGES ON Tickets.* TO 'opsmind'@'%';
GRANT ALL PRIVILEGES ON opsmind_ai.* TO 'opsmind'@'%';
GRANT ALL PRIVILEGES ON agentic_ai_db.* TO 'opsmind'@'%';
GRANT ALL PRIVILEGES ON authentication.* TO 'opsmind'@'%';
GRANT ALL PRIVILEGES ON workflow_db.* TO 'opsmind'@'%';
GRANT ALL PRIVILEGES ON sla_db.* TO 'opsmind'@'%';

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
