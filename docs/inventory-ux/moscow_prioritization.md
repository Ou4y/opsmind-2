# OpsMind Inventory MoSCoW Prioritization

Rule used:
- Must have = product fails without it.

## Must Have
- Asset CRUD and grouped views.
- CSV import preview and gated commit.
- Validation for duplicate serial/tag and parent linkage.
- AI repair suggestions review flow with explicit user action.
- Parent-component/accessory/license relationship integrity.
- Transfer flow with related-item controls.
- CMDB core views and lifecycle/audit event trail.
- Audit board, loaner workflow, bulk checkout baseline.
- Core AI workflows (assistant, daily brief, executive dashboard, monthly report) with safe fallback behavior.
- UX documentation package required for thesis planning and validation.

## Should Have
- Accessibility hardening across dynamic controls and markers.
- Consistent UX wording and step guidance across import flow.
- Improved import completion summary (counts, warnings, batch metadata).
- Better table ordering/readability and clearer action grouping.
- Persona journey and domain storytelling artifacts.
- Structured UX testing plan with SUS.

## Could Have
- Light gamification for audit freshness/completion.
- Advanced post-production KPI dashboards.
- Deeper micro-interaction polish on dense workflows.

## Won't Have Right Now
- Full rollback/undo for import batches in this pass.
- Full XLSX import pipeline in this pass.
- Smart-locker hardware integration.
- AR/camera-dependent features.
- Heavy redesign of Inventory UI architecture.

## Priority Rationale Notes
- Safety, correctness, and lifecycle integrity are prioritized over cosmetic expansion.
- AI remains assistive and review-first for data mutation paths.
- Rollback is deferred until dependency-safe design is implemented.
