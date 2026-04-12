-- ═══════════════════════════════════════════════════════════════
--  OpsMind Workflow Service — Hierarchy Seed Data (Updated)
-- ═══════════════════════════════════════════════════════════════
--
--  Hierarchy Structure (Admin-Managed, Flexible):
--    - 1 ADMIN (user_id 101)
--    - 1 SUPERVISOR (user_id 100) → reports to ADMIN
--    - 5 SENIORS (user_ids 1-5) → report to SUPERVISOR
--    - 44 JUNIORS (user_ids 6-49) → distributed among SENIORS
--
--  Reporting Structure:
--    ADMIN (101)
--      └── SUPERVISOR (100)
--            ├── Senior M (1) — manages 8 juniors (6-13)
--            ├── Senior N (2) — manages 8 juniors (14-21)
--            ├── Senior S (3) — manages 8 juniors (22-29)
--            ├── Senior R (4) — manages 10 juniors (30-39)
--            └── Senior Pharmacy (5) — manages 10 juniors (40-49)
--
--  Note: No hardcoded limits enforced in code — this is just one
--        example distribution that admins can modify freely.
-- ═══════════════════════════════════════════════════════════════

USE workflow_db;

-- ── Ensure enum includes ADMIN and SUPERVISOR ──────────────────
ALTER TABLE group_members
  MODIFY COLUMN role ENUM('JUNIOR', 'SENIOR', 'SUPERVISOR', 'ADMIN') NOT NULL;

-- ── Clean existing data (respect FK order) ──────────────────────
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE reporting_relationships;
TRUNCATE TABLE sla_tracking;
TRUNCATE TABLE ticket_routing_state;
TRUNCATE TABLE workflow_logs;
TRUNCATE TABLE escalation_rules;
TRUNCATE TABLE group_members;
TRUNCATE TABLE technicians;
TRUNCATE TABLE tickets;
TRUNCATE TABLE support_groups;
SET FOREIGN_KEY_CHECKS = 1;


-- ═══════════════════════════════════════════════════════════════
--  0. TECHNICIANS (with user_id and email)
-- ═══════════════════════════════════════════════════════════════

-- Admin
INSERT INTO technicians (id, user_id, name, email, level, latitude, longitude, status, is_active) VALUES
  (1, 101, 'System Admin', 'admin@opsmind.edu', 'ADMIN', 31.9954, 35.8464, 'ACTIVE', TRUE);

-- Supervisor
INSERT INTO technicians (id, user_id, name, email, level, latitude, longitude, status, is_active) VALUES
  (2, 100, 'Supervisor Chief', 'supervisor@opsmind.edu', 'SUPERVISOR', 31.9954, 35.8464, 'ACTIVE', TRUE);

-- Senior technicians (one per building)
INSERT INTO technicians (id, user_id, name, email, level, latitude, longitude, status, is_active) VALUES
  (3,  1, 'Senior M',        'senior.m@opsmind.edu',        'SENIOR', 31.9960, 35.8460, 'ACTIVE', TRUE),
  (4,  2, 'Senior N',        'senior.n@opsmind.edu',        'SENIOR', 31.9950, 35.8470, 'ACTIVE', TRUE),
  (5,  3, 'Senior S',        'senior.s@opsmind.edu',        'SENIOR', 31.9945, 35.8455, 'ACTIVE', TRUE),
  (6,  4, 'Senior R',        'senior.r@opsmind.edu',        'SENIOR', 31.9955, 35.8450, 'ACTIVE', TRUE),
  (7,  5, 'Senior Pharmacy', 'senior.pharmacy@opsmind.edu', 'SENIOR', 31.9940, 35.8465, 'ACTIVE', TRUE);

-- Junior technicians — Building M (8 juniors, user_ids 6-13)
INSERT INTO technicians (id, user_id, name, email, level, latitude, longitude, status, is_active) VALUES
  ( 8,  6, 'M-F1 Tech 1', 'tech.m.f1.1@opsmind.edu', 'JUNIOR', 31.9961, 35.8458, 'ACTIVE', TRUE),
  ( 9,  7, 'M-F1 Tech 2', 'tech.m.f1.2@opsmind.edu', 'JUNIOR', 31.9962, 35.8459, 'ACTIVE', TRUE),
  (10,  8, 'M-F2 Tech 1', 'tech.m.f2.1@opsmind.edu', 'JUNIOR', 31.9963, 35.8460, 'ACTIVE', TRUE),
  (11,  9, 'M-F2 Tech 2', 'tech.m.f2.2@opsmind.edu', 'JUNIOR', 31.9964, 35.8461, 'ACTIVE', TRUE),
  (12, 10, 'M-F3 Tech 1', 'tech.m.f3.1@opsmind.edu', 'JUNIOR', 31.9965, 35.8462, 'ACTIVE', TRUE),
  (13, 11, 'M-F3 Tech 2', 'tech.m.f3.2@opsmind.edu', 'JUNIOR', 31.9966, 35.8463, 'ACTIVE', TRUE),
  (14, 12, 'M-F4 Tech 1', 'tech.m.f4.1@opsmind.edu', 'JUNIOR', 31.9967, 35.8464, 'ACTIVE', TRUE),
  (15, 13, 'M-F4 Tech 2', 'tech.m.f4.2@opsmind.edu', 'JUNIOR', 31.9968, 35.8465, 'ACTIVE', TRUE);

-- Junior technicians — Building N (8 juniors, user_ids 14-21)
INSERT INTO technicians (id, user_id, name, email, level, latitude, longitude, status, is_active) VALUES
  (16, 14, 'N-F1 Tech 1', 'tech.n.f1.1@opsmind.edu', 'JUNIOR', 31.9951, 35.8471, 'ACTIVE', TRUE),
  (17, 15, 'N-F1 Tech 2', 'tech.n.f1.2@opsmind.edu', 'JUNIOR', 31.9952, 35.8472, 'ACTIVE', TRUE),
  (18, 16, 'N-F2 Tech 1', 'tech.n.f2.1@opsmind.edu', 'JUNIOR', 31.9953, 35.8473, 'ACTIVE', TRUE),
  (19, 17, 'N-F2 Tech 2', 'tech.n.f2.2@opsmind.edu', 'JUNIOR', 31.9954, 35.8474, 'ACTIVE', TRUE),
  (20, 18, 'N-F3 Tech 1', 'tech.n.f3.1@opsmind.edu', 'JUNIOR', 31.9955, 35.8475, 'ACTIVE', TRUE),
  (21, 19, 'N-F3 Tech 2', 'tech.n.f3.2@opsmind.edu', 'JUNIOR', 31.9956, 35.8476, 'ACTIVE', TRUE),
  (22, 20, 'N-F4 Tech 1', 'tech.n.f4.1@opsmind.edu', 'JUNIOR', 31.9957, 35.8477, 'ACTIVE', TRUE),
  (23, 21, 'N-F4 Tech 2', 'tech.n.f4.2@opsmind.edu', 'JUNIOR', 31.9958, 35.8478, 'ACTIVE', TRUE);

-- Junior technicians — Building S (8 juniors, user_ids 22-29)
INSERT INTO technicians (id, user_id, name, email, level, latitude, longitude, status, is_active) VALUES
  (24, 22, 'S-F1 Tech 1', 'tech.s.f1.1@opsmind.edu', 'JUNIOR', 31.9946, 35.8453, 'ACTIVE', TRUE),
  (25, 23, 'S-F1 Tech 2', 'tech.s.f1.2@opsmind.edu', 'JUNIOR', 31.9947, 35.8454, 'ACTIVE', TRUE),
  (26, 24, 'S-F2 Tech 1', 'tech.s.f2.1@opsmind.edu', 'JUNIOR', 31.9948, 35.8455, 'ACTIVE', TRUE),
  (27, 25, 'S-F2 Tech 2', 'tech.s.f2.2@opsmind.edu', 'JUNIOR', 31.9949, 35.8456, 'ACTIVE', TRUE),
  (28, 26, 'S-F3 Tech 1', 'tech.s.f3.1@opsmind.edu', 'JUNIOR', 31.9950, 35.8457, 'ACTIVE', TRUE),
  (29, 27, 'S-F3 Tech 2', 'tech.s.f3.2@opsmind.edu', 'JUNIOR', 31.9951, 35.8458, 'ACTIVE', TRUE),
  (30, 28, 'S-F4 Tech 1', 'tech.s.f4.1@opsmind.edu', 'JUNIOR', 31.9952, 35.8459, 'ACTIVE', TRUE),
  (31, 29, 'S-F4 Tech 2', 'tech.s.f4.2@opsmind.edu', 'JUNIOR', 31.9953, 35.8460, 'ACTIVE', TRUE);

-- Junior technicians — Building R (10 juniors, user_ids 30-39)
INSERT INTO technicians (id, user_id, name, email, level, latitude, longitude, status, is_active) VALUES
  (32, 30, 'R-F1 Tech 1', 'tech.r.f1.1@opsmind.edu', 'JUNIOR', 31.9956, 35.8448, 'ACTIVE', TRUE),
  (33, 31, 'R-F1 Tech 2', 'tech.r.f1.2@opsmind.edu', 'JUNIOR', 31.9957, 35.8449, 'ACTIVE', TRUE),
  (34, 32, 'R-F2 Tech 1', 'tech.r.f2.1@opsmind.edu', 'JUNIOR', 31.9958, 35.8450, 'ACTIVE', TRUE),
  (35, 33, 'R-F2 Tech 2', 'tech.r.f2.2@opsmind.edu', 'JUNIOR', 31.9959, 35.8451, 'ACTIVE', TRUE),
  (36, 34, 'R-F3 Tech 1', 'tech.r.f3.1@opsmind.edu', 'JUNIOR', 31.9960, 35.8452, 'ACTIVE', TRUE),
  (37, 35, 'R-F3 Tech 2', 'tech.r.f3.2@opsmind.edu', 'JUNIOR', 31.9961, 35.8453, 'ACTIVE', TRUE),
  (38, 36, 'R-F4 Tech 1', 'tech.r.f4.1@opsmind.edu', 'JUNIOR', 31.9962, 35.8454, 'ACTIVE', TRUE),
  (39, 37, 'R-F4 Tech 2', 'tech.r.f4.2@opsmind.edu', 'JUNIOR', 31.9963, 35.8455, 'ACTIVE', TRUE),
  (40, 38, 'R-F5 Tech 1', 'tech.r.f5.1@opsmind.edu', 'JUNIOR', 31.9964, 35.8456, 'ACTIVE', TRUE),
  (41, 39, 'R-F5 Tech 2', 'tech.r.f5.2@opsmind.edu', 'JUNIOR', 31.9965, 35.8457, 'ACTIVE', TRUE);

-- Junior technicians — Building Pharmacy (10 juniors, user_ids 40-49)
INSERT INTO technicians (id, user_id, name, email, level, latitude, longitude, status, is_active) VALUES
  (42, 40, 'PH-F1 Tech 1', 'tech.ph.f1.1@opsmind.edu', 'JUNIOR', 31.9941, 35.8463, 'ACTIVE', TRUE),
  (43, 41, 'PH-F1 Tech 2', 'tech.ph.f1.2@opsmind.edu', 'JUNIOR', 31.9942, 35.8464, 'ACTIVE', TRUE),
  (44, 42, 'PH-F2 Tech 1', 'tech.ph.f2.1@opsmind.edu', 'JUNIOR', 31.9943, 35.8465, 'ACTIVE', TRUE),
  (45, 43, 'PH-F2 Tech 2', 'tech.ph.f2.2@opsmind.edu', 'JUNIOR', 31.9944, 35.8466, 'ACTIVE', TRUE),
  (46, 44, 'PH-F3 Tech 1', 'tech.ph.f3.1@opsmind.edu', 'JUNIOR', 31.9945, 35.8467, 'ACTIVE', TRUE),
  (47, 45, 'PH-F3 Tech 2', 'tech.ph.f3.2@opsmind.edu', 'JUNIOR', 31.9946, 35.8468, 'ACTIVE', TRUE),
  (48, 46, 'PH-F4 Tech 1', 'tech.ph.f4.1@opsmind.edu', 'JUNIOR', 31.9947, 35.8469, 'ACTIVE', TRUE),
  (49, 47, 'PH-F4 Tech 2', 'tech.ph.f4.2@opsmind.edu', 'JUNIOR', 31.9948, 35.8470, 'ACTIVE', TRUE),
  (50, 48, 'PH-F5 Tech 1', 'tech.ph.f5.1@opsmind.edu', 'JUNIOR', 31.9949, 35.8471, 'ACTIVE', TRUE),
  (51, 49, 'PH-F5 Tech 2', 'tech.ph.f5.2@opsmind.edu', 'JUNIOR', 31.9950, 35.8472, 'ACTIVE', TRUE);


-- ═══════════════════════════════════════════════════════════════
--  1. REPORTING RELATIONSHIPS (Hierarchy)
-- ═══════════════════════════════════════════════════════════════

-- Supervisor (100) reports to Admin (101)
INSERT INTO reporting_relationships (child_user_id, parent_user_id, relationship_type, is_active) VALUES
  (100, 101, 'SUPERVISOR_TO_ADMIN', TRUE);

-- Senior technicians report to Supervisor
INSERT INTO reporting_relationships (child_user_id, parent_user_id, relationship_type, is_active) VALUES
  (1, 100, 'SENIOR_TO_SUPERVISOR', TRUE),  -- Senior M
  (2, 100, 'SENIOR_TO_SUPERVISOR', TRUE),  -- Senior N
  (3, 100, 'SENIOR_TO_SUPERVISOR', TRUE),  -- Senior S
  (4, 100, 'SENIOR_TO_SUPERVISOR', TRUE),  -- Senior R
  (5, 100, 'SENIOR_TO_SUPERVISOR', TRUE);  -- Senior Pharmacy

-- Junior technicians report to their respective Seniors
-- Building M juniors (6-13) → Senior M (1)
INSERT INTO reporting_relationships (child_user_id, parent_user_id, relationship_type, is_active) VALUES
  ( 6, 1, 'JUNIOR_TO_SENIOR', TRUE),
  ( 7, 1, 'JUNIOR_TO_SENIOR', TRUE),
  ( 8, 1, 'JUNIOR_TO_SENIOR', TRUE),
  ( 9, 1, 'JUNIOR_TO_SENIOR', TRUE),
  (10, 1, 'JUNIOR_TO_SENIOR', TRUE),
  (11, 1, 'JUNIOR_TO_SENIOR', TRUE),
  (12, 1, 'JUNIOR_TO_SENIOR', TRUE),
  (13, 1, 'JUNIOR_TO_SENIOR', TRUE);

-- Building N juniors (14-21) → Senior N (2)
INSERT INTO reporting_relationships (child_user_id, parent_user_id, relationship_type, is_active) VALUES
  (14, 2, 'JUNIOR_TO_SENIOR', TRUE),
  (15, 2, 'JUNIOR_TO_SENIOR', TRUE),
  (16, 2, 'JUNIOR_TO_SENIOR', TRUE),
  (17, 2, 'JUNIOR_TO_SENIOR', TRUE),
  (18, 2, 'JUNIOR_TO_SENIOR', TRUE),
  (19, 2, 'JUNIOR_TO_SENIOR', TRUE),
  (20, 2, 'JUNIOR_TO_SENIOR', TRUE),
  (21, 2, 'JUNIOR_TO_SENIOR', TRUE);

-- Building S juniors (22-29) → Senior S (3)
INSERT INTO reporting_relationships (child_user_id, parent_user_id, relationship_type, is_active) VALUES
  (22, 3, 'JUNIOR_TO_SENIOR', TRUE),
  (23, 3, 'JUNIOR_TO_SENIOR', TRUE),
  (24, 3, 'JUNIOR_TO_SENIOR', TRUE),
  (25, 3, 'JUNIOR_TO_SENIOR', TRUE),
  (26, 3, 'JUNIOR_TO_SENIOR', TRUE),
  (27, 3, 'JUNIOR_TO_SENIOR', TRUE),
  (28, 3, 'JUNIOR_TO_SENIOR', TRUE),
  (29, 3, 'JUNIOR_TO_SENIOR', TRUE);

-- Building R juniors (30-39) → Senior R (4)
INSERT INTO reporting_relationships (child_user_id, parent_user_id, relationship_type, is_active) VALUES
  (30, 4, 'JUNIOR_TO_SENIOR', TRUE),
  (31, 4, 'JUNIOR_TO_SENIOR', TRUE),
  (32, 4, 'JUNIOR_TO_SENIOR', TRUE),
  (33, 4, 'JUNIOR_TO_SENIOR', TRUE),
  (34, 4, 'JUNIOR_TO_SENIOR', TRUE),
  (35, 4, 'JUNIOR_TO_SENIOR', TRUE),
  (36, 4, 'JUNIOR_TO_SENIOR', TRUE),
  (37, 4, 'JUNIOR_TO_SENIOR', TRUE),
  (38, 4, 'JUNIOR_TO_SENIOR', TRUE),
  (39, 4, 'JUNIOR_TO_SENIOR', TRUE);

-- Building Pharmacy juniors (40-49) → Senior Pharmacy (5)
INSERT INTO reporting_relationships (child_user_id, parent_user_id, relationship_type, is_active) VALUES
  (40, 5, 'JUNIOR_TO_SENIOR', TRUE),
  (41, 5, 'JUNIOR_TO_SENIOR', TRUE),
  (42, 5, 'JUNIOR_TO_SENIOR', TRUE),
  (43, 5, 'JUNIOR_TO_SENIOR', TRUE),
  (44, 5, 'JUNIOR_TO_SENIOR', TRUE),
  (45, 5, 'JUNIOR_TO_SENIOR', TRUE),
  (46, 5, 'JUNIOR_TO_SENIOR', TRUE),
  (47, 5, 'JUNIOR_TO_SENIOR', TRUE),
  (48, 5, 'JUNIOR_TO_SENIOR', TRUE),
  (49, 5, 'JUNIOR_TO_SENIOR', TRUE);


-- ═══════════════════════════════════════════════════════════════
--  2. SUPPORT GROUPS (unchanged from original)
-- ═══════════════════════════════════════════════════════════════

-- ── Global Supervisor Group (no parent) ──
INSERT INTO support_groups (name, building, floor, parent_group_id) VALUES
  ('UNIVERSITY-SUPERVISOR', 'GLOBAL', 0, NULL);

-- ── Building Senior Groups (parent = 1, UNIVERSITY-SUPERVISOR) ──
INSERT INTO support_groups (name, building, floor, parent_group_id) VALUES
  ('M-SENIOR',        'M',        0, 1),
  ('N-SENIOR',        'N',        0, 1),
  ('S-SENIOR',        'S',        0, 1),
  ('R-SENIOR',        'R',        0, 1),
  ('PHARMACY-SENIOR', 'Pharmacy', 0, 1);

-- ── Building M — Floor Room Groups (4 floors), parent = 2 ──
INSERT INTO support_groups (name, building, floor, parent_group_id) VALUES
  ('M-F1-ROOM', 'M', 1, 2),
  ('M-F2-ROOM', 'M', 2, 2),
  ('M-F3-ROOM', 'M', 3, 2),
  ('M-F4-ROOM', 'M', 4, 2);

-- ── Building N — Floor Room Groups (4 floors), parent = 3 ──
INSERT INTO support_groups (name, building, floor, parent_group_id) VALUES
  ('N-F1-ROOM', 'N', 1, 3),
  ('N-F2-ROOM', 'N', 2, 3),
  ('N-F3-ROOM', 'N', 3, 3),
  ('N-F4-ROOM', 'N', 4, 3);

-- ── Building S — Floor Room Groups (4 floors), parent = 4 ──
INSERT INTO support_groups (name, building, floor, parent_group_id) VALUES
  ('S-F1-ROOM', 'S', 1, 4),
  ('S-F2-ROOM', 'S', 2, 4),
  ('S-F3-ROOM', 'S', 3, 4),
  ('S-F4-ROOM', 'S', 4, 4);

-- ── Building R — Floor Room Groups (5 floors), parent = 5 ──
INSERT INTO support_groups (name, building, floor, parent_group_id) VALUES
  ('R-F1-ROOM', 'R', 1, 5),
  ('R-F2-ROOM', 'R', 2, 5),
  ('R-F3-ROOM', 'R', 3, 5),
  ('R-F4-ROOM', 'R', 4, 5),
  ('R-F5-ROOM', 'R', 5, 5);

-- ── Building Pharmacy — Floor Room Groups (5 floors), parent = 6 ──
INSERT INTO support_groups (name, building, floor, parent_group_id) VALUES
  ('PHARMACY-F1-ROOM', 'Pharmacy', 1, 6),
  ('PHARMACY-F2-ROOM', 'Pharmacy', 2, 6),
  ('PHARMACY-F3-ROOM', 'Pharmacy', 3, 6),
  ('PHARMACY-F4-ROOM', 'Pharmacy', 4, 6),
  ('PHARMACY-F5-ROOM', 'Pharmacy', 5, 6);


-- ═══════════════════════════════════════════════════════════════
--  3. GROUP MEMBERS (using user_id from technicians)
-- ═══════════════════════════════════════════════════════════════

-- ── Admin (UNIVERSITY-SUPERVISOR, group 1) ──
INSERT INTO group_members (user_id, group_id, role, can_assign, can_escalate, status) VALUES
  (101, 1, 'ADMIN', TRUE, TRUE, 'ACTIVE');

-- ── Supervisor (UNIVERSITY-SUPERVISOR, group 1) ──
INSERT INTO group_members (user_id, group_id, role, can_assign, can_escalate, status) VALUES
  (100, 1, 'SUPERVISOR', TRUE, TRUE, 'ACTIVE');

-- ── Senior Members (1 per building senior group) ──
INSERT INTO group_members (user_id, group_id, role, can_assign, can_escalate, status) VALUES
  (1, 2, 'SENIOR', TRUE, TRUE, 'ACTIVE'),   -- M-SENIOR
  (2, 3, 'SENIOR', TRUE, TRUE, 'ACTIVE'),   -- N-SENIOR
  (3, 4, 'SENIOR', TRUE, TRUE, 'ACTIVE'),   -- S-SENIOR
  (4, 5, 'SENIOR', TRUE, TRUE, 'ACTIVE'),   -- R-SENIOR
  (5, 6, 'SENIOR', TRUE, TRUE, 'ACTIVE');   -- PHARMACY-SENIOR

-- ── Junior Members — Building M (8 juniors in 4 floor groups) ──
INSERT INTO group_members (user_id, group_id, role, can_assign, can_escalate, status) VALUES
  ( 6, 7, 'JUNIOR', FALSE, FALSE, 'ACTIVE'),  -- M-F1-ROOM
  ( 7, 7, 'JUNIOR', FALSE, FALSE, 'ACTIVE'),
  ( 8, 8, 'JUNIOR', FALSE, FALSE, 'ACTIVE'),  -- M-F2-ROOM
  ( 9, 8, 'JUNIOR', FALSE, FALSE, 'ACTIVE'),
  (10, 9, 'JUNIOR', FALSE, FALSE, 'ACTIVE'),  -- M-F3-ROOM
  (11, 9, 'JUNIOR', FALSE, FALSE, 'ACTIVE'),
  (12, 10, 'JUNIOR', FALSE, FALSE, 'ACTIVE'), -- M-F4-ROOM
  (13, 10, 'JUNIOR', FALSE, FALSE, 'ACTIVE');

-- ── Junior Members — Building N (8 juniors in 4 floor groups) ──
INSERT INTO group_members (user_id, group_id, role, can_assign, can_escalate, status) VALUES
  (14, 11, 'JUNIOR', FALSE, FALSE, 'ACTIVE'), -- N-F1-ROOM
  (15, 11, 'JUNIOR', FALSE, FALSE, 'ACTIVE'),
  (16, 12, 'JUNIOR', FALSE, FALSE, 'ACTIVE'), -- N-F2-ROOM
  (17, 12, 'JUNIOR', FALSE, FALSE, 'ACTIVE'),
  (18, 13, 'JUNIOR', FALSE, FALSE, 'ACTIVE'), -- N-F3-ROOM
  (19, 13, 'JUNIOR', FALSE, FALSE, 'ACTIVE'),
  (20, 14, 'JUNIOR', FALSE, FALSE, 'ACTIVE'), -- N-F4-ROOM
  (21, 14, 'JUNIOR', FALSE, FALSE, 'ACTIVE');

-- ── Junior Members — Building S (8 juniors in 4 floor groups) ──
INSERT INTO group_members (user_id, group_id, role, can_assign, can_escalate, status) VALUES
  (22, 15, 'JUNIOR', FALSE, FALSE, 'ACTIVE'), -- S-F1-ROOM
  (23, 15, 'JUNIOR', FALSE, FALSE, 'ACTIVE'),
  (24, 16, 'JUNIOR', FALSE, FALSE, 'ACTIVE'), -- S-F2-ROOM
  (25, 16, 'JUNIOR', FALSE, FALSE, 'ACTIVE'),
  (26, 17, 'JUNIOR', FALSE, FALSE, 'ACTIVE'), -- S-F3-ROOM
  (27, 17, 'JUNIOR', FALSE, FALSE, 'ACTIVE'),
  (28, 18, 'JUNIOR', FALSE, FALSE, 'ACTIVE'), -- S-F4-ROOM
  (29, 18, 'JUNIOR', FALSE, FALSE, 'ACTIVE');

-- ── Junior Members — Building R (10 juniors in 5 floor groups) ──
INSERT INTO group_members (user_id, group_id, role, can_assign, can_escalate, status) VALUES
  (30, 19, 'JUNIOR', FALSE, FALSE, 'ACTIVE'), -- R-F1-ROOM
  (31, 19, 'JUNIOR', FALSE, FALSE, 'ACTIVE'),
  (32, 20, 'JUNIOR', FALSE, FALSE, 'ACTIVE'), -- R-F2-ROOM
  (33, 20, 'JUNIOR', FALSE, FALSE, 'ACTIVE'),
  (34, 21, 'JUNIOR', FALSE, FALSE, 'ACTIVE'), -- R-F3-ROOM
  (35, 21, 'JUNIOR', FALSE, FALSE, 'ACTIVE'),
  (36, 22, 'JUNIOR', FALSE, FALSE, 'ACTIVE'), -- R-F4-ROOM
  (37, 22, 'JUNIOR', FALSE, FALSE, 'ACTIVE'),
  (38, 23, 'JUNIOR', FALSE, FALSE, 'ACTIVE'), -- R-F5-ROOM
  (39, 23, 'JUNIOR', FALSE, FALSE, 'ACTIVE');

-- ── Junior Members — Building Pharmacy (10 juniors in 5 floor groups) ──
INSERT INTO group_members (user_id, group_id, role, can_assign, can_escalate, status) VALUES
  (40, 24, 'JUNIOR', FALSE, FALSE, 'ACTIVE'), -- PHARMACY-F1-ROOM
  (41, 24, 'JUNIOR', FALSE, FALSE, 'ACTIVE'),
  (42, 25, 'JUNIOR', FALSE, FALSE, 'ACTIVE'), -- PHARMACY-F2-ROOM
  (43, 25, 'JUNIOR', FALSE, FALSE, 'ACTIVE'),
  (44, 26, 'JUNIOR', FALSE, FALSE, 'ACTIVE'), -- PHARMACY-F3-ROOM
  (45, 26, 'JUNIOR', FALSE, FALSE, 'ACTIVE'),
  (46, 27, 'JUNIOR', FALSE, FALSE, 'ACTIVE'), -- PHARMACY-F4-ROOM
  (47, 27, 'JUNIOR', FALSE, FALSE, 'ACTIVE'),
  (48, 28, 'JUNIOR', FALSE, FALSE, 'ACTIVE'), -- PHARMACY-F5-ROOM
  (49, 28, 'JUNIOR', FALSE, FALSE, 'ACTIVE');


-- ═══════════════════════════════════════════════════════════════
--  4. ESCALATION RULES (unchanged from original)
-- ═══════════════════════════════════════════════════════════════

-- Tier 1: Floor → Senior (22 rules, 60 min SLA)
INSERT INTO escalation_rules (source_group_id, target_group_id, trigger_type, delay_minutes, priority, is_active) VALUES
  -- M building
  (7,  2, 'SLA', 60, 1, TRUE),
  (8,  2, 'SLA', 60, 1, TRUE),
  (9,  2, 'SLA', 60, 1, TRUE),
  (10, 2, 'SLA', 60, 1, TRUE),
  -- N building
  (11, 3, 'SLA', 60, 1, TRUE),
  (12, 3, 'SLA', 60, 1, TRUE),
  (13, 3, 'SLA', 60, 1, TRUE),
  (14, 3, 'SLA', 60, 1, TRUE),
  -- S building
  (15, 4, 'SLA', 60, 1, TRUE),
  (16, 4, 'SLA', 60, 1, TRUE),
  (17, 4, 'SLA', 60, 1, TRUE),
  (18, 4, 'SLA', 60, 1, TRUE),
  -- R building
  (19, 5, 'SLA', 60, 1, TRUE),
  (20, 5, 'SLA', 60, 1, TRUE),
  (21, 5, 'SLA', 60, 1, TRUE),
  (22, 5, 'SLA', 60, 1, TRUE),
  (23, 5, 'SLA', 60, 1, TRUE),
  -- Pharmacy building
  (24, 6, 'SLA', 60, 1, TRUE),
  (25, 6, 'SLA', 60, 1, TRUE),
  (26, 6, 'SLA', 60, 1, TRUE),
  (27, 6, 'SLA', 60, 1, TRUE),
  (28, 6, 'SLA', 60, 1, TRUE);

-- Tier 2: Senior → Supervisor (5 rules, 120 min SLA)
INSERT INTO escalation_rules (source_group_id, target_group_id, trigger_type, delay_minutes, priority, is_active) VALUES
  (2, 1, 'SLA', 120, 2, TRUE),  -- M-SENIOR → SUPERVISOR
  (3, 1, 'SLA', 120, 2, TRUE),  -- N-SENIOR → SUPERVISOR
  (4, 1, 'SLA', 120, 2, TRUE),  -- S-SENIOR → SUPERVISOR
  (5, 1, 'SLA', 120, 2, TRUE),  -- R-SENIOR → SUPERVISOR
  (6, 1, 'SLA', 120, 2, TRUE);  -- PHARMACY-SENIOR → SUPERVISOR


-- ═══════════════════════════════════════════════════════════════
--  Seed Complete
-- ═══════════════════════════════════════════════════════════════
--
--  Summary:
--    - 51 Technicians (1 ADMIN + 1 SUPERVISOR + 5 SENIORS + 44 JUNIORS)
--    - 50 Reporting Relationships (hierarchy linkages)
--    - 28 Support Groups (1 supervisor + 5 senior + 22 room groups)
--    - 52 Group Members (includes admin)
--    - 27 Escalation Rules (22 tier-1 + 5 tier-2)
--
--  Note: Assignment remains scoring-based for JUNIOR technicians.
--        Hierarchy is for visibility/escalation only.
-- ═══════════════════════════════════════════════════════════════
