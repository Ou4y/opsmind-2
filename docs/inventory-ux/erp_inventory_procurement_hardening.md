# OpsMind ERP/ITAM Enhancement Status (Inventory + Procurement)

## Scope
This document covers only OpsMind Inventory, Procurement, and Inventory AI integrations.
No destructive migration/reset/drop operations are included.

## Feature Status
- `Done`: Procurement dedicated page + DB-backed lifecycle routes.
- `Done`: ABC analysis endpoint and Procurement UI tab.
- `Done`: EOQ/MOQ endpoint and Procurement UI tab.
- `Done`: FIFO batch and movement foundation (spare stock) + UI tab.
- `Done`: Finance foundation models/routes/UI section.
- `Done`: Supplier catalog + RFQ foundation models/routes/UI section.
- `Done`: Quote comparison deterministic scoring endpoint.
- `Done`: Procurement diagnostics endpoint for production-readiness checks.
- `Partial`: Consumable lot/FIFO deep issuance automation.
- `Partial`: External finance provider integration.
- `Partial`: External supplier API integration.

## ITIL/ITAM Traceability Mapping
- `ITAM`: Assets and stock are linked to procurement requests and receiving history.
- `Configuration/CMDB`: Procurement links to asset tags/IDs and lifecycle events.
- `Change enablement`: Receiving uses preview + explicit confirmation for inventory impact.
- `Service request`: Procurement requests, approvals, RFQs, quotes, POs, receiving tracked with status.
- `Problem/Incident support`: Maintenance/audit/EOL/risk inputs can drive procurement priorities.

## Safety and Security Notes
- No native browser `alert/confirm/prompt` required for procurement actions.
- No secrets are hardcoded for finance/supplier integrations.
- External integrations remain `manual`/`mock` mode by default and require env-driven adapters.

## Monitoring and Diagnostics
- Procurement diagnostics: `GET /api/inventory/procurement/diagnostics`
- AI diagnostics: Inventory AI service health + diagnostics endpoints remain required for Gemma readiness checks.

## Backup and Restore Guidance (Non-destructive)
- Database backup (example):
```powershell
pg_dump -h 127.0.0.1 -p 5433 -U postgres -d opsmind_assets -F c -f opsmind_assets_backup.dump
```
- Database restore should only be performed in controlled environments and with explicit approval.
- Do not drop/recreate production-like databases as part of regular feature deployment.

## Phase 2 Recommendations
- Add consumable-specific lot tracking and FIFO issue workflows.
- Add budget reservation/commit transitions on approval/order states.
- Add invoice-to-PO auto-match suggestions with review gate.
- Add richer supplier scorecards from lead-time and quote outcomes.
- Add role-aware finance/procurement permission granularity if central auth policy is available.
