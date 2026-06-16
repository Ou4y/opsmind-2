# OpsMind Inventory Persona Journey Map

## Persona 1: Inventory Admin
### Goals
- Keep inventory clean and complete.
- Import large batches without errors.
- Maintain parent-related structure integrity.

### Pain Points
- Manual correction overhead.
- Mixed-source CSV quality.
- Risk of accidental destructive actions.

### Journey Steps
1. Open import and run preview.
2. Fix errors (manual + AI repair).
3. Confirm import and review summary.
4. Validate CMDB links and timeline events.

### Pains and Gains
- Pains: duplicate serial/tag conflicts, linkage errors.
- Gains: gated import, AI suggestions, batch-level summary and IDs.

### Priority Opportunities
- Must: maintain validation-first commit gate.
- Should: add batch history and safe rollback workflow.

## Persona 2: Technician
### Goals
- Execute transfers and checkouts quickly.
- Diagnose status issues using CMDB/timeline/map.
- Keep telemetry and location data useful.

### Pain Points
- High task switching between flows.
- Incomplete field data from handoffs.

### Journey Steps
1. Search/filter for target assets.
2. Transfer with related items.
3. Verify via timeline and map.
4. Use AI for quick diagnostics.

### Pains and Gains
- Pains: inconsistent source data quality.
- Gains: related transfer controls, map visibility, AI quick prompts.

### Priority Opportunities
- Must: preserve workflow speed with clear feedback.
- Should: continue keyboard and accessibility validation.

## Persona 3: Supervisor / Senior Admin
### Goals
- Ensure process compliance and operational reliability.
- Review risk and replacement posture.

### Pain Points
- Hard to aggregate multiple operations quickly.
- Need high-trust summaries.

### Journey Steps
1. Review executive/dashboard summaries.
2. Spot high-risk clusters.
3. Verify transfer and audit evidence.
4. Approve corrective actions.

### Pains and Gains
- Pains: over-reliance on manual review when data quality drops.
- Gains: executive dashboard, daily brief, black box timeline.

### Priority Opportunities
- Must: keep summaries tied to verifiable data.
- Should: add post-production KPI dashboarding.

## Persona 4: Procurement Officer
### Goals
- Identify what to buy, when, and why.
- Balance stock, risk, and reuse before purchase.

### Pain Points
- Delayed or inconsistent spare stock updates.
- Low confidence in incomplete records.

### Journey Steps
1. Check spare stock and low-stock indicators.
2. Review AI procurement/reallocation suggestions.
3. Validate risk/EOL evidence.
4. Prepare purchase recommendations.

### Pains and Gains
- Pains: poor upstream data quality can distort priorities.
- Gains: spare stock workflows plus AI planning assistance.

### Priority Opportunities
- Must: maintain accurate stock and EOL inputs.
- Could: add approval-ready export templates.

## Persona 5: Auditor
### Goals
- Verify physical and logical asset truth.
- Track missing assets and location mismatch.

### Pain Points
- Verification can be slow at scale.
- Historical context is often fragmented.

### Journey Steps
1. Open audit board.
2. Mark verification/missing results.
3. Check timeline for movement context.
4. Confirm closure state.

### Pains and Gains
- Pains: large volume checks.
- Gains: audit board and black box timeline make events traceable.

### Priority Opportunities
- Must: maintain explicit confirmation and event logging.
- Should: improve audit throughput with lightweight guidance nudges.

## Cross-Persona Opportunity Backlog
- Must: validation and confirmation safety must remain non-negotiable.
- Should: import history + controlled rollback design.
- Should: release-based UX regression checklist.
- Could: light gamification around verification completion and audit freshness.
