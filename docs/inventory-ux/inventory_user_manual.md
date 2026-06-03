# OpsMind Inventory User Manual

## 1) Inventory Overview
OpsMind Inventory is used to create, import, organize, monitor, transfer, and audit university assets. It combines operational workflows (CRUD, transfer, checkout, audit) with CMDB relationships, map visibility, telemetry-aware signals, and AI assistance.

Main screen capabilities:
- Grouped inventory views.
- Search and filters (building, department, type, lifecycle).
- Import workflow.
- Asset Map, Loaners, Audit Board, Bulk Checkout.
- AI assistant and AI report actions.

## 2) Asset Data Model: Parent Assets vs Related Categories
Use these categories consistently:
- Parent Asset: main device/equipment record (for example, laptop, desktop, projector).
- Component: part installed in or linked to a parent (RAM, SSD, NIC, etc.).
- Accessory: assigned/related item (dock, adapter, external peripheral).
- Consumable: consumable inventory line (toner, paper, disposable items).
- Spare Stock: spare parts inventory with stock levels and reorder controls.
- License: software or entitlement records, optionally linked to a parent asset.

## 3) How to Import a CSV
1. Open `Import Assets (CSV)`.
2. Upload a `.csv` file.
3. Optional: click `AI Map Columns` if headers do not match exactly.
4. Click `Preview`.
5. Review row status, warnings, and errors.
6. Fix blocking issues manually or with `AI Fix Import Errors`.
7. Click `Confirm Import` when `Can Import` is enabled.

Important:
- CSV is supported now.
- XLSX is intentionally blocked in this pass.

## 4) How to Import a Full Kit (Parent + Components + Accessories + Licenses)
Use one parent row plus related rows:
- Parent row uses `record type = parent_asset`.
- Component rows use `component` (alias) or `component_asset`.
- Accessory rows use `accessory`.
- License rows use `license`.

Link related rows by setting `Parent Asset Tag` to the parent row tag.

Recommended order in CSV:
1. Parent asset row.
2. Component rows.
3. Accessory rows.
4. License rows.

The backend also re-validates linkage before commit.

## 5) How AI Fix Import Errors Works
Flow:
1. Run `Preview` first.
2. Click `AI Fix Import Errors`.
3. Review suggestions table:
   - Confidence
   - Reason
   - Safe-to-apply status
4. Click `Apply All Safe Fixes` for low-risk fixes.
5. For non-safe fixes, review and use `Apply` or `Ignore` row-by-row.
6. Click `Re-run Preview` to validate current rows again.
7. Confirm import only when blocking errors are cleared.

Behavior safety:
- AI fixes update preview rows only.
- No DB write happens until `Confirm Import`.

## 6) View Parent Asset Details (CMDB + Relationships + Licenses)
1. Find a parent asset.
2. Open `CMDB Details` from row actions.
3. Check components tab for installed/linked components.
4. Check relationships tab for accessories/licenses and related assets.
5. Use AI CMDB panels (health summary, risk, digital twin, timeline) as needed.

## 7) Transfer an Asset with Related Items
1. Open transfer action for a parent asset.
2. Choose destination (building and/or department).
3. Keep `Also transfer related installed/assigned items` enabled when required.
4. Select related categories (components/accessories/licenses/consumables) as needed.
5. Confirm transfer.

Tip:
- Use transfer summary in modal to review related-item counts before confirming.

## 8) Telemetry Behavior
Operational rule in this implementation:
- Electronic assets are telemetry-capable by type/profile.
- In Central Warehouse, telemetry is treated as not actively monitored for deployment context.
- After deployment outside Central Warehouse and signal updates, telemetry status appears in lifecycle context.

## 9) Asset Map Usage
1. Open `Asset Map`.
2. Filter by category, lifecycle, telemetry, risk, maintenance, and text fields.
3. Click a location marker to inspect assets in that location.
4. Use side panel for mapped and unmapped location insight.

## 10) Map Calibration
1. Click `Calibrate`.
2. Drag yellow calibration markers to align to visible building centers.
3. Click `Copy Coords` to copy JSON coordinates.
4. Save coordinates through your configuration/change workflow.

Notes:
- Calibration uses final display coordinate space.
- Keep calibration updates controlled and versioned.

## 11) Digital Twin
Digital Twin summarizes selected asset health:
- Risk/EOL posture.
- Warranty and telemetry state.
- Related-item counts.
- Last transfer and maintenance context.
- Recommended action text.

Use it for technical triage and lifecycle decisions.

## 12) Black Box Timeline
Black Box Timeline aggregates chronological events for the selected asset (and related items if included):
- Transfer events.
- Maintenance events.
- Component events.
- Audit events.
- Loaner events.
- AI risk/EOL related events.
- Telemetry-related changes.

Use filters by event group for focused investigations.

## 13) Daily Brief, Executive Dashboard, Monthly Report
Available through Inventory AI quick actions:
- Daily Brief: recent changes and daily health snapshot.
- Executive Dashboard: management-ready cross-section by risk, stock, and operations.
- Monthly Report: monthly-level summary with recommendations.

These actions provide deterministic output and/or LLM-assisted output with fallback metadata.

## 14) Audit Board, Loaners, Bulk Checkout
Audit Board:
- Review stale verifications, mismatches, and missing assets.
- Mark verify/missing actions with explicit confirmation.

Loaners:
- Track checkout/return state in software.
- Designed for process control without requiring smart-locker hardware.

Bulk Checkout:
- Validate IDs first.
- Confirm checkout destination.
- Optional inclusion of related items with parent assets.

## 15) Known Limitations
Current limitations in this pass:
- XLSX import is not enabled end-to-end; use CSV.
- PDF/invoice extraction is assistive and requires manual review before commit.
- Smart-locker hardware integration is future work.
- AR/camera-dependent workflows are not required by this module.
- AI/LLM paths may fall back to deterministic mode when unavailable.

## 16) Troubleshooting
### Invalid category
- Cause: category value not supported.
- Fix: use supported category vocabulary from template/manual.

### Missing Parent Asset Tag
- Cause: related item row has no parent tag.
- Fix: set `Parent Asset Tag` to a valid parent tag in file or existing inventory.

### Duplicate serial or asset tag
- Cause: duplicate in same file or already in DB.
- Fix: deduplicate CSV; update existing assets instead of re-creating.

### Unrecognized asset type warnings
- Meaning: import can continue using nearest/compatible backend mapping.
- Action: verify mapped type post-import if strict classification matters.

### AI service fallback mode
- Meaning: LLM was unavailable/slow or disabled.
- Behavior: deterministic fallback still returns safe operational guidance.
- Action: continue workflow; retry AI action later for richer language output.

## Import Completion Summary (What to Expect)
After a successful confirm:
- Batch ID and timestamp are shown.
- Parent assets created.
- Components linked.
- Accessories created and linked.
- Licenses created and linked.
- Consumables created.
- Spare stock updated/created.
- Warning count and failed row count.
- Actions: `View Imported Assets`, `Import Another File`, `Close`.
