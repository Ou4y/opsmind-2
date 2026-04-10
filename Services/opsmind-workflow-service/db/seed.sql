-- ═══════════════════════════════════════════════════════════════
--  OpsMind Workflow Service — University Structure Seed Data
-- ═══════════════════════════════════════════════════════════════
--
--  Hierarchy:
--    UNIVERSITY-SUPERVISOR  (global, floor=0, building='GLOBAL')
--      ├── M-SENIOR         (building='M', floor=0)
--      │    ├── M-F1-ROOM   (building='M', floor=1)
--      │    ├── M-F2-ROOM   …
--      │    ├── M-F3-ROOM
--      │    └── M-F4-ROOM
--      ├── N-SENIOR         (building='N', floor=0)
--      │    └── … (4 floors)
--      ├── S-SENIOR         (building='S', floor=0)
--      │    └── … (4 floors)
--      ├── R-SENIOR         (building='R', floor=0)
--      │    └── … (5 floors)
--      └── PHARMACY-SENIOR  (building='Pharmacy', floor=0)
--           └── … (5 floors)
--
--  Escalation chain (2-tier):
--    Floor Room → Building Senior  (SLA trigger, tier 1)
--    Building Senior → UNIVERSITY-SUPERVISOR  (SLA trigger, tier 2)
--
--  Groups:   1 supervisor + 5 senior + 22 rooms = 28
--  Members:  1 supervisor + 5 seniors + 44 juniors = 50
--  Rules:    22 (room→senior) + 5 (senior→supervisor) = 27
-- ═══════════════════════════════════════════════════════════════

USE workflow_db;

-- ── Ensure group_members role ENUM includes SUPERVISOR ──────
ALTER TABLE group_members
  MODIFY COLUMN role ENUM('JUNIOR', 'SENIOR', 'SUPERVISOR') NOT NULL;

-- ── Clean existing data (respect FK order) ──────────────────
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE sla_tracking;
TRUNCATE TABLE ticket_routing_state;
TRUNCATE TABLE workflow_logs;
TRUNCATE TABLE escalation_rules;
TRUNCATE TABLE group_members;
TRUNCATE TABLE support_groups;
SET FOREIGN_KEY_CHECKS = 1;


-- ═══════════════════════════════════════════════════════════════
--  1. SUPPORT GROUPS
-- ═══════════════════════════════════════════════════════════════

-- ── Global Supervisor Group (no parent) ──
-- id = 1
INSERT INTO support_groups (name, building, floor, parent_group_id) VALUES
  ('UNIVERSITY-SUPERVISOR', 'GLOBAL', 0, NULL);

-- ── Building Senior Groups (parent = 1, UNIVERSITY-SUPERVISOR) ──
-- ids 2–6
INSERT INTO support_groups (name, building, floor, parent_group_id) VALUES
  ('M-SENIOR',        'M',        0, 1),   -- id = 2
  ('N-SENIOR',        'N',        0, 1),   -- id = 3
  ('S-SENIOR',        'S',        0, 1),   -- id = 4
  ('R-SENIOR',        'R',        0, 1),   -- id = 5
  ('PHARMACY-SENIOR', 'Pharmacy', 0, 1);   -- id = 6

-- ── Building M — Floor Room Groups (4 floors), parent = 2 ──
INSERT INTO support_groups (name, building, floor, parent_group_id) VALUES
  ('M-F1-ROOM', 'M', 1, 2),   -- id = 7
  ('M-F2-ROOM', 'M', 2, 2),   -- id = 8
  ('M-F3-ROOM', 'M', 3, 2),   -- id = 9
  ('M-F4-ROOM', 'M', 4, 2);   -- id = 10

-- ── Building N — Floor Room Groups (4 floors), parent = 3 ──
INSERT INTO support_groups (name, building, floor, parent_group_id) VALUES
  ('N-F1-ROOM', 'N', 1, 3),   -- id = 11
  ('N-F2-ROOM', 'N', 2, 3),   -- id = 12
  ('N-F3-ROOM', 'N', 3, 3),   -- id = 13
  ('N-F4-ROOM', 'N', 4, 3);   -- id = 14

-- ── Building S — Floor Room Groups (4 floors), parent = 4 ──
INSERT INTO support_groups (name, building, floor, parent_group_id) VALUES
  ('S-F1-ROOM', 'S', 1, 4),   -- id = 15
  ('S-F2-ROOM', 'S', 2, 4),   -- id = 16
  ('S-F3-ROOM', 'S', 3, 4),   -- id = 17
  ('S-F4-ROOM', 'S', 4, 4);   -- id = 18

-- ── Building R — Floor Room Groups (5 floors), parent = 5 ──
INSERT INTO support_groups (name, building, floor, parent_group_id) VALUES
  ('R-F1-ROOM', 'R', 1, 5),   -- id = 19
  ('R-F2-ROOM', 'R', 2, 5),   -- id = 20
  ('R-F3-ROOM', 'R', 3, 5),   -- id = 21
  ('R-F4-ROOM', 'R', 4, 5),   -- id = 22
  ('R-F5-ROOM', 'R', 5, 5);   -- id = 23

-- ── Building Pharmacy — Floor Room Groups (5 floors), parent = 6 ──
INSERT INTO support_groups (name, building, floor, parent_group_id) VALUES
  ('PHARMACY-F1-ROOM', 'Pharmacy', 1, 6),   -- id = 24
  ('PHARMACY-F2-ROOM', 'Pharmacy', 2, 6),   -- id = 25
  ('PHARMACY-F3-ROOM', 'Pharmacy', 3, 6),   -- id = 26
  ('PHARMACY-F4-ROOM', 'Pharmacy', 4, 6),   -- id = 27
  ('PHARMACY-F5-ROOM', 'Pharmacy', 5, 6);   -- id = 28


-- ═══════════════════════════════════════════════════════════════
--  2. GROUP MEMBERS
-- ═══════════════════════════════════════════════════════════════
--  user_id layout:
--    100   → Supervisor
--    1–5   → Senior technicians (building managers)
--    6–49  → Junior technicians (2 per floor room)

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

-- ── Junior Members — Building M (groups 7–10) ──
INSERT INTO group_members (user_id, group_id, role, can_assign, can_escalate, status) VALUES
  ( 6,  7, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- M-F1 tech 1
  ( 7,  7, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- M-F1 tech 2
  ( 8,  8, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- M-F2 tech 1
  ( 9,  8, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- M-F2 tech 2
  (10,  9, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- M-F3 tech 1
  (11,  9, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- M-F3 tech 2
  (12, 10, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- M-F4 tech 1
  (13, 10, 'JUNIOR', TRUE, FALSE, 'ACTIVE');   -- M-F4 tech 2

-- ── Junior Members — Building N (groups 11–14) ──
INSERT INTO group_members (user_id, group_id, role, can_assign, can_escalate, status) VALUES
  (14, 11, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- N-F1 tech 1
  (15, 11, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- N-F1 tech 2
  (16, 12, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- N-F2 tech 1
  (17, 12, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- N-F2 tech 2
  (18, 13, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- N-F3 tech 1
  (19, 13, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- N-F3 tech 2
  (20, 14, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- N-F4 tech 1
  (21, 14, 'JUNIOR', TRUE, FALSE, 'ACTIVE');   -- N-F4 tech 2

-- ── Junior Members — Building S (groups 15–18) ──
INSERT INTO group_members (user_id, group_id, role, can_assign, can_escalate, status) VALUES
  (22, 15, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- S-F1 tech 1
  (23, 15, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- S-F1 tech 2
  (24, 16, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- S-F2 tech 1
  (25, 16, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- S-F2 tech 2
  (26, 17, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- S-F3 tech 1
  (27, 17, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- S-F3 tech 2
  (28, 18, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- S-F4 tech 1
  (29, 18, 'JUNIOR', TRUE, FALSE, 'ACTIVE');   -- S-F4 tech 2

-- ── Junior Members — Building R (groups 19–23) ──
INSERT INTO group_members (user_id, group_id, role, can_assign, can_escalate, status) VALUES
  (30, 19, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- R-F1 tech 1
  (31, 19, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- R-F1 tech 2
  (32, 20, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- R-F2 tech 1
  (33, 20, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- R-F2 tech 2
  (34, 21, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- R-F3 tech 1
  (35, 21, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- R-F3 tech 2
  (36, 22, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- R-F4 tech 1
  (37, 22, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- R-F4 tech 2
  (38, 23, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- R-F5 tech 1
  (39, 23, 'JUNIOR', TRUE, FALSE, 'ACTIVE');   -- R-F5 tech 2

-- ── Junior Members — Building Pharmacy (groups 24–28) ──
INSERT INTO group_members (user_id, group_id, role, can_assign, can_escalate, status) VALUES
  (40, 24, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- Pharmacy-F1 tech 1
  (41, 24, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- Pharmacy-F1 tech 2
  (42, 25, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- Pharmacy-F2 tech 1
  (43, 25, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- Pharmacy-F2 tech 2
  (44, 26, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- Pharmacy-F3 tech 1
  (45, 26, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- Pharmacy-F3 tech 2
  (46, 27, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- Pharmacy-F4 tech 1
  (47, 27, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- Pharmacy-F4 tech 2
  (48, 28, 'JUNIOR', TRUE, FALSE, 'ACTIVE'),   -- Pharmacy-F5 tech 1
  (49, 28, 'JUNIOR', TRUE, FALSE, 'ACTIVE');   -- Pharmacy-F5 tech 2


-- ═══════════════════════════════════════════════════════════════
--  3. ESCALATION RULES — 2-TIER CHAIN
-- ═══════════════════════════════════════════════════════════════

-- ────────────────────────────────────
-- TIER 1:  Floor Room → Building Senior  (SLA breach)
-- ────────────────────────────────────

-- Building M
INSERT INTO escalation_rules (source_group_id, target_group_id, trigger_type, delay_minutes, is_active, priority) VALUES
  ( 7, 2, 'SLA', 0, TRUE, 1),   -- M-F1-ROOM → M-SENIOR
  ( 8, 2, 'SLA', 0, TRUE, 1),   -- M-F2-ROOM → M-SENIOR
  ( 9, 2, 'SLA', 0, TRUE, 1),   -- M-F3-ROOM → M-SENIOR
  (10, 2, 'SLA', 0, TRUE, 1);   -- M-F4-ROOM → M-SENIOR

-- Building N
INSERT INTO escalation_rules (source_group_id, target_group_id, trigger_type, delay_minutes, is_active, priority) VALUES
  (11, 3, 'SLA', 0, TRUE, 1),   -- N-F1-ROOM → N-SENIOR
  (12, 3, 'SLA', 0, TRUE, 1),   -- N-F2-ROOM → N-SENIOR
  (13, 3, 'SLA', 0, TRUE, 1),   -- N-F3-ROOM → N-SENIOR
  (14, 3, 'SLA', 0, TRUE, 1);   -- N-F4-ROOM → N-SENIOR

-- Building S
INSERT INTO escalation_rules (source_group_id, target_group_id, trigger_type, delay_minutes, is_active, priority) VALUES
  (15, 4, 'SLA', 0, TRUE, 1),   -- S-F1-ROOM → S-SENIOR
  (16, 4, 'SLA', 0, TRUE, 1),   -- S-F2-ROOM → S-SENIOR
  (17, 4, 'SLA', 0, TRUE, 1),   -- S-F3-ROOM → S-SENIOR
  (18, 4, 'SLA', 0, TRUE, 1);   -- S-F4-ROOM → S-SENIOR

-- Building R
INSERT INTO escalation_rules (source_group_id, target_group_id, trigger_type, delay_minutes, is_active, priority) VALUES
  (19, 5, 'SLA', 0, TRUE, 1),   -- R-F1-ROOM → R-SENIOR
  (20, 5, 'SLA', 0, TRUE, 1),   -- R-F2-ROOM → R-SENIOR
  (21, 5, 'SLA', 0, TRUE, 1),   -- R-F3-ROOM → R-SENIOR
  (22, 5, 'SLA', 0, TRUE, 1),   -- R-F4-ROOM → R-SENIOR
  (23, 5, 'SLA', 0, TRUE, 1);   -- R-F5-ROOM → R-SENIOR

-- Building Pharmacy
INSERT INTO escalation_rules (source_group_id, target_group_id, trigger_type, delay_minutes, is_active, priority) VALUES
  (24, 6, 'SLA', 0, TRUE, 1),   -- PHARMACY-F1-ROOM → PHARMACY-SENIOR
  (25, 6, 'SLA', 0, TRUE, 1),   -- PHARMACY-F2-ROOM → PHARMACY-SENIOR
  (26, 6, 'SLA', 0, TRUE, 1),   -- PHARMACY-F3-ROOM → PHARMACY-SENIOR
  (27, 6, 'SLA', 0, TRUE, 1),   -- PHARMACY-F4-ROOM → PHARMACY-SENIOR
  (28, 6, 'SLA', 0, TRUE, 1);   -- PHARMACY-F5-ROOM → PHARMACY-SENIOR

-- ────────────────────────────────────
-- TIER 2:  Building Senior → UNIVERSITY-SUPERVISOR  (second SLA breach)
-- ────────────────────────────────────
INSERT INTO escalation_rules (source_group_id, target_group_id, trigger_type, delay_minutes, is_active, priority) VALUES
  (2, 1, 'SLA', 0, TRUE, 2),   -- M-SENIOR → UNIVERSITY-SUPERVISOR
  (3, 1, 'SLA', 0, TRUE, 2),   -- N-SENIOR → UNIVERSITY-SUPERVISOR
  (4, 1, 'SLA', 0, TRUE, 2),   -- S-SENIOR → UNIVERSITY-SUPERVISOR
  (5, 1, 'SLA', 0, TRUE, 2),   -- R-SENIOR → UNIVERSITY-SUPERVISOR
  (6, 1, 'SLA', 0, TRUE, 2);   -- PHARMACY-SENIOR → UNIVERSITY-SUPERVISOR


-- ═══════════════════════════════════════════════════════════════
--  4. VERIFICATION
-- ═══════════════════════════════════════════════════════════════

SELECT '=== SEED SUMMARY ===' AS info;
SELECT COUNT(*) AS total_groups FROM support_groups;
SELECT COUNT(*) AS total_members FROM group_members;
SELECT COUNT(*) AS total_escalation_rules FROM escalation_rules;

SELECT '=== HIERARCHY ===' AS info;
SELECT 
  sg.id,
  sg.name,
  sg.building,
  sg.floor,
  p.name AS parent_group
FROM support_groups sg
LEFT JOIN support_groups p ON sg.parent_group_id = p.id
ORDER BY sg.id;

SELECT '=== MEMBERS BY ROLE ===' AS info;
SELECT role, COUNT(*) AS count FROM group_members GROUP BY role;

SELECT '=== ESCALATION CHAIN (2-TIER) ===' AS info;
SELECT 
  src.name AS source_group,
  tgt.name AS target_group,
  er.trigger_type,
  er.priority AS tier
FROM escalation_rules er
JOIN support_groups src ON er.source_group_id = src.id
JOIN support_groups tgt ON er.target_group_id = tgt.id
ORDER BY er.priority, src.building, src.floor;
