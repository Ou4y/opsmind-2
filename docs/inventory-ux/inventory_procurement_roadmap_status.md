# Inventory and Procurement Roadmap Status

_Last updated: June 14, 2026_

This document tracks the final OpsMind Inventory / Procurement / Inventory AI roadmap against the current implementation. It is intentionally evidence-based: items are marked complete only where code or documented backend/frontend behavior exists.

## Stage 1: Core Operations

| Item | Status | Notes |
| --- | --- | --- |
| Today's Priorities handled/dismissed state | Implemented | Inventory Command Center supports Done, Dismiss with reason, Restore, and a session-scoped Handled Today drawer. Critical/high-priority dismissals require an explicit reason category. |
| Risk Radar weighted formula | Implemented | Building/department cards now use a 0-100 score: missing data 25%, EOL/high risk 25%, low stock 20%, stale telemetry 15%, open audit issues 15%. Evidence and missing-input confidence are shown in drawers. |
| Data Quality inline fix flow | Implemented | Command Center opens an in-app editable table for missing serial, department, location, purchase date, warranty end, and purchase cost. Saves use `/api/assets/:id/details`, which already records asset lifecycle/history updates. |
| Asset 360 maintenance tab | Existing | CMDB / Asset 360 already has Maintenance tab, add-maintenance modal, maintenance records, cost fields, and backend `AssetMaintenanceRecord`. |
| Custody chain / transfer history | Existing | Backend has `AssetCustodyEvent`; transfer, bulk checkout, check-in, loaner checkout/return write lifecycle/custody events. CMDB shows custody history. |
| Inventory/Procurement approval governance | Implemented foundation | `InventoryApprovalPolicy`, `InventoryApprovalRequest`, `InventoryApprovalDecision`, and `InventoryAuditLog` support role/scope/action-risk approval, notification-service events, and explicit approved-action retry with `approvalRequestId`. Workflow-service generic Inventory approval tasks and concrete auth approver lookup remain future work. |

## Stage 2: Control and Lifecycle

| Item | Status | Notes |
| --- | --- | --- |
| Retire / disposal workflow | Implemented | Asset 360/CMDB exposes a review-first Retire / Write-off flow. Backend retire/dispose routes preserve structured disposal evidence, write-off/book values, reviewer state, lifecycle events, and history. |
| Physical audit / cycle count sessions | Implemented foundation | Audit Board now includes named physical audit sessions with scoped checklist generation, persisted session/item records, confirm/mismatch/not-found/damaged actions, and close/reconciliation summary. |
| Checkout / loaner tracking | Existing / verified | Bulk checkout, loaner checkout, loaner return, and custody events are implemented with in-app forms and backend records. Loaner checkout now stores assigned department and condition-out evidence. |
| Health score | Implemented | Asset 360/CMDB and group unit rows show a deterministic 0-100 health score with age, warranty/EOL, maintenance, and data-completeness evidence confidence. |

## Stage 3: Finance, Forecasting, and Comparison

| Item | Status | Notes |
| --- | --- | --- |
| Inventory 360 cost estimates | Existing | Inventory 360 summarizes purchase/replacement/maintenance/stock value where explicit cost data exists and labels missing coverage. |
| EOL budget forecast | Implemented | `/api/inventory/eol-budget-report`, Inventory reports export, and Command Center 12/24/36 month timeline forecast use available cost data and label missing costs. |
| Department budget allocation vs procurement spend | Implemented | Procurement finance foundation supports cost centers, allocations, usage, budget pressure summaries, and department-level allocation/spend cards. |
| Receiving impact preview | Implemented | Receiving flow uses `previewOnly=true` first, displays before/after impact diff, and requires explicit confirmation before inventory impact. |
| Group 360 comparison | Implemented | Group CMDB supports side-by-side unit comparison and related maintenance/custody/lifecycle evidence. |
| Vendor scoring | Implemented | Procurement quote comparison uses price, warranty, delivery, MOQ, reliability, and radar-style score bars/cards. |

## Stage 4: Intelligence and Reporting

| Item | Status | Notes |
| --- | --- | --- |
| Smart alerts engine | Implemented foundation | Durable alert rules/events tables and backend evaluator exist for stock thresholds, EOL/warranty, stuck procurement, budget pressure, overdue loaners, and data quality. Command Center can evaluate and show persisted alerts. |
| Natural-language inventory search | Implemented | Inventory toolbar has an explicit AI search action. It calls `/api/inventory/ai/search`, validates interpreted filters, and applies only matching UI filters/tabs. |
| Reporting/export foundation | Implemented foundation | Inventory Reports modal exports CSV presets for asset inventory, procurement spend, warranty expiry, EOL forecast, data quality, and audit reconciliation. PDF/labels/monthly/executive reports remain available. |

## Stage 5: UX Guardrails Verified

| Guardrail | Status | Notes |
| --- | --- | --- |
| Guided tour visible and non-mutating | Existing | Inventory Command Center, Inventory 360, and Procurement have guided tour/read-only demo paths. |
| No fake deterministic typing | Existing | Copilot rendering uses quick reveal/fade instead of simulated character-by-character typing. |
| Friendly AI source labels | Existing | Public labels use AI insight, System data, Estimated, or Fallback, with technical source in tooltips. |
| Non-disruptive auto-refresh | Existing | Auto-refresh pauses during modal/form/Copilot/hidden-tab use and restores scroll during background refresh. |
| Asset Map remains functional | Existing | Asset Map remains a primary shortcut and uses real inventory/map registry data. |

## Deferred Phase 2 Items

- Audit scheduling, auditor assignment routing, and recurring cycle-count templates.
- Smart-alert notification-service routing, read/unread ownership, and role-based subscriptions.
- Full row-level health gauge across every Inventory category table beyond group and CMDB contexts.
- Consolidated report builder with saved presets, PDFs/Excel templates, and scheduled delivery.
- Rich chart-library vendor radar if visual chart dependencies are adopted later.

## Safety Notes

- No destructive database or Docker operation is required for the current enhancements.
- Data Quality fixes are review-first in a modal and only save explicitly changed rows.
- Natural-language search applies only validated frontend filters; it does not execute database mutations.
- AI must remain evidence-grounded and must not invent asset facts, prices, vendors, approvals, payments, or budgets.
