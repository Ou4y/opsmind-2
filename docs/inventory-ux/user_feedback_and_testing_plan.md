# OpsMind Inventory User Feedback and Testing Plan

## 1) Usability Test Objectives
- Validate that users can complete core inventory operations without guidance.
- Measure error prevention effectiveness in import flow.
- Confirm discoverability of CMDB, related transfers, map, and AI report actions.
- Assess confidence/trust in AI assistive workflows and fallback messaging.

## 2) Target Testers
- 2 Inventory Admin users.
- 2 Technicians.
- 1 Supervisor/Senior Admin.
- 1 Procurement-facing stakeholder.
- 1 Auditor.

## 3) 30-Minute Session Plan
- Minute 0-3: Context and role setup.
- Minute 3-5: Baseline orientation (no feature coaching).
- Minute 5-25: Task execution.
- Minute 25-28: SUS survey.
- Minute 28-30: Open feedback and friction points.

## 4) Task Script
1. Import a parent kit CSV.
2. Fix import errors using AI repair suggestions.
3. Open parent CMDB and identify linked components.
4. Transfer parent asset with related items.
5. Open Asset Map and verify location marker context.
6. Ask Inventory AI for Daily Brief.
7. Generate Executive Dashboard summary.

## 5) Measures to Record
- Task completion time (per task).
- Task success/failure.
- Error count and type.
- Recovery count (how many retries/fixes needed).
- User confidence and satisfaction comments.
- SUS score.

## 6) Pass/Fail Heuristics
- Critical tasks (1-4) should pass for at least 85 percent of participants.
- Median completion time should trend down between rounds.
- SUS target: >= 68 as baseline acceptable usability.

## 7) Feedback Capture Template
For each task capture:
- Outcome: success/partial/fail.
- Time spent.
- What confused user first.
- What unlocked progress.
- Suggested wording/control changes.

## 8) Post-Production Metrics Recommendation
Future recurring metrics:
- Feature adoption rate (by workflow).
- Import success and failed-row rates.
- AI repair usage and accepted-fix rates.
- Asset Map usage count.
- CMDB open count.
- Transfer completion rate.
- Bug frequency and support ticket counts.
- Core task completion time trends.
- SUS score trend by release.

## 9) Lightweight Logging Guidance
Before adding new tracking systems, reuse existing inventory lifecycle and workflow events from backend routes to compute aggregate UX metrics. Keep data minimal and avoid personal-data-heavy instrumentation.
