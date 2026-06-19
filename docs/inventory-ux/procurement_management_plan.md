# Inventory Procurement Management Plan (ITIL/ITAM-Aligned)

## Scope
This plan is limited to OpsMind Inventory, Procurement, and Inventory AI integration.
It does not implement ERP accounting, payments, or external vendor-system integrations.

## Service Architecture (Current)
### Dedicated Main Service Area
- Procurement is now a dedicated main page: `/pages/procurement.html`.
- Sidebar navigation includes a first-class `Procurement` entry.
- Inventory keeps a shortcut button that opens the dedicated Procurement page (instead of keeping the full workflow in a small modal).

### Backend Placement
- Procurement remains inside `Services/inventory-backend` as a production-safe architecture choice for now.
- This keeps deep access to Inventory/CMDB lifecycle, stock, EOL/risk, and AI signals without cross-service complexity.

### Future Service Split (Optional)
- Phase 3 can extract Procurement into a standalone service only when scale/compliance/integration needs justify it.

## Database-Backed Procurement (Implemented)
### Migration
- Migration created: `20260601123000_add_procurement_management`.
- Migration is additive and non-destructive:
  - no reset
  - no drop of existing inventory tables
  - no legacy JSON deletion

### Procurement Tables/Models
- `ProcurementRequest`
- `ProcurementRequestItem`
- `ProcurementApproval`
- `Vendor`
- `VendorQuote`
- `PurchaseOrder`
- `PurchaseOrderItem`
- `ReceivingRecord`
- `ReceivingRecordItem`
- `ProcurementAssetLink`
- `ProcurementRecommendationReview`

### Persistence Guarantee
- Procurement data now persists in DB across backend restarts.
- Old file-backed procurement remains as legacy source for safe import compatibility.

## Legacy File-Backed Migration Compatibility
### Legacy Source
- Legacy path uses `procurement_requests.json` discovery candidates.

### Import Behavior
- Backend performs idempotent import from legacy file into DB.
- Deduplication key: `requestNumber`/legacy request ID.
- Import creates request/items/links/approvals/quotes/PO/receipts where possible.
- Import does not delete legacy file.

### Safety
- Malformed legacy rows are skipped safely.
- Import failures do not crash the backend process.

## Procurement API (DB-Backed)
### Core Routes
- `GET /api/inventory/procurement/board`
- `GET /api/inventory/procurement/requests`
- `GET /api/inventory/procurement/requests/:requestId`
- `POST /api/inventory/procurement/requests`
- `PATCH /api/inventory/procurement/requests/:requestId/status`
- `POST /api/inventory/procurement/requests/:requestId/vendor-quotes`
- `PATCH /api/inventory/procurement/requests/:requestId/vendor-quotes/:quoteId`
- `POST /api/inventory/procurement/requests/:requestId/purchase-order`
- `POST /api/inventory/procurement/requests/:requestId/receive`
- `PATCH /api/inventory/procurement/recommendations/:recommendationKey/status`

### Route Compatibility
- Existing route shape is preserved for current Inventory workflows.
- Request IDs continue to use user-facing request numbers (`PR-YYYYMMDD-XXXXXX`).

## Request Lifecycle / ITIL-Friendly Status Model
- `Draft`
- `Submitted`
- `Under Review`
- `Approved`
- `Rejected`
- `Ordered`
- `Partially Received`
- `Received`
- `Closed`
- `Cancelled`

Each status change is traceable through `ProcurementApproval` records.

## Procurement Approval Governance (Implemented Foundation)
Procurement approval is now aligned with the Inventory RBAC approval foundation. Procurement requests are evaluated by actor role, building/scope, estimated cost, asset criticality, vendor exception signals, emergency context, and inventory impact.

### Approval Thresholds
- EGP `0-1,000`: auto-approved or Senior approval depending actor/request type; audit is always required.
- EGP `1,001-5,000`: Building Supervisor approval.
- EGP `5,001-25,000`: Supervisor Chief approval.
- EGP `25,001+`: Admin approval.
- Critical/security/server/network assets escalate to Supervisor Chief or Admin depending amount and criticality.
- New vendor exceptions and emergency high-value purchases require Supervisor Chief/Admin review depending impact.

### Approval Records
- Inventory-specific approval control is stored through:
  - `InventoryApprovalPolicy`
  - `InventoryApprovalRequest`
  - `InventoryApprovalDecision`
  - `InventoryAuditLog`
- Procurement status history remains traceable through `ProcurementApproval`.
- Approved controlled actions require explicit retry/execution with a matching `approvalRequestId`; they are not silently replayed.

### Notification Bridge
- Approval requests publish `inventory.notification.*` events through notification-service.
- Current stable recipients are role-scoped, for example:
  - `role:BUILDING_SUPERVISOR:MAIN`
  - `role:SUPERVISOR_CHIEF:GLOBAL`
  - `role:ADMIN:GLOBAL`
- Concrete auth-service approver lookup by role/building remains future work.

## Inventory + CMDB Linking
### Linked Scope
- Procurement requests can link assets/tags and department/building context.
- Requests can represent replacement, spare stock, consumables, license, maintenance, audit, or other demand.

### Traceability
- Procurement status/receiving events append to linked asset history and lifecycle events in Inventory.
- Procurement request context remains visible by request, quote, PO, and receiving records.

## Receiving Workflow Safety
### No Silent Inventory Mutations
- Receiving route now supports **preview-first** behavior:
  - `previewOnly=true` returns an impact summary.
  - applying receiving with inventory impact requires explicit `confirmInventoryImpact=true`.

### Current Impact Types
- Optional spare-stock quantity updates are supported after explicit confirmation.
- Asset-type receiving is recorded with follow-up guidance (review-first intake behavior).

## AI Recommendations as First-Class Procurement Input
### Recommendation Evidence
- Board recommendations are built from real inventory signals:
  - low stock
  - EOL/procurement windows
  - risk
  - maintenance
  - audit evidence

### Recommendation Lifecycle
- Each recommendation has a deterministic `recommendationKey`.
- Review status is tracked in `ProcurementRecommendationReview`:
  - `new`
  - `reviewed`
  - `ignored`
  - `converted`

### Convert-to-Request
- Converting an AI recommendation to a request stores AI linkage metadata and marks recommendation as converted.

## Dedicated Procurement Page UX Structure
The dedicated Procurement page includes:
- Dashboard
- AI Recommendations
- Requests
- Vendor Quotes
- Purchase Orders
- Receiving
- Analytics

All actions use in-app modal flows (no browser-native alert/confirm/prompt popups).

## ITIL/ITAM Practical Mapping
- IT Asset Management: demand from stock/lifecycle/risk/maintenance evidence.
- Service Configuration Management: request-to-asset linkage retained.
- Change Enablement: explicit status transitions and decision history.
- Governance: controlled procurement and inventory-impact actions create approval requests, approval decisions, and audit logs.
- Incident/Problem alignment: audit/maintenance findings can drive procurement demand.
- Traceability: receiving and procurement decision events are auditable end-to-end.

## Phase 2 (Recommended Next)
- Add structured receiving impact preview cards for consumables/licenses/asset-intake draft flows.
- Add richer approval timeline UI with role-based approver metadata.
- Add concrete auth-service approver lookup by role/building once auth-service exposes a stable internal resolver.
- Add workflow-service generic approval-task integration once workflow-service supports Inventory approval tasks.
- Add vendor comparison scoring/rationale UI.
- Add procurement analytics trends (aging buckets, recurring shortages, demand heatmaps).

## Phase 3 (Optional Advanced)
- Evaluate extracting Procurement into a dedicated service.
- Add budget forecasting and vendor performance intelligence.
- Add integration endpoints for ERP/finance systems (still no payment processing in OpsMind core).

## Guardrails
- No native browser popups for procurement workflows.
- No destructive or inventory-impacting action without explicit in-app confirmation.
- AI suggestions must remain evidence-based and source-labeled.

## ERP Enhancement Pass (June 1, 2026)
### ABC Analysis (Phase 1 Implemented)
- Added deterministic ABC analysis endpoint: `GET /api/inventory/procurement/abc-analysis`.
- Classification covers:
  - parent assets
  - components/accessories/licenses/consumables
  - spare stock items
- Scoring factors include:
  - estimated value
  - lifecycle/risk indicators
  - maintenance frequency
  - shortage pressure
  - department criticality
  - procurement history signals
- Procurement page now has an **ABC Analysis** tab with class filtering and control guidance.

### EOQ / MOQ Decision Support (Phase 1 Implemented)
- Added EOQ/MOQ endpoint: `GET /api/inventory/procurement/eoq-moq`.
- EOQ formula used: `sqrt((2 * D * S) / H)`.
- Added data fields for repeatable stock items and request items:
  - `annualDemand`, `orderingCost`, `holdingCost`
  - `minimumOrderQuantity`, `minimumOrderValue`, `packSize`, `leadTimeDays`
  - `calculatedEoq`, `recommendedOrderQuantity`, `safetyStock`, `dataQuality`
- If required inputs are missing, endpoint returns explicit missing-data warnings (no fake EOQ values).
- Procurement page now has an **EOQ/MOQ** tab.

### FIFO Stock Foundation (Phase 1 Implemented)
- Added batch/movement tracking tables:
  - `inventory_stock_batches`
  - `inventory_stock_movements`
- FIFO behavior:
  - receiving to spare stock creates receipt batches
  - stock issue/install/replace consumes oldest available batch first
  - FIFO override allowed only with explicit reason in dedicated FIFO issue API
- Added endpoints:
  - `GET /api/inventory/procurement/fifo/batches`
  - `POST /api/inventory/procurement/fifo/issue`
- Procurement page now has a **FIFO** tab for visibility.

### Finance Integration Foundation (Phase 1 Implemented)
- Added finance foundation tables:
  - `finance_cost_centers`
  - `finance_budget_periods`
  - `finance_budget_allocations`
  - `finance_budget_usages`
  - `procurement_invoices`
  - `procurement_invoice_lines`
- Added procurement finance fields:
  - `financeStatus`, `costCenterId`, `budgetAllocationId`, `budgetAmountReserved`, `financeNotes`
- Added finance endpoints:
  - `GET /api/inventory/procurement/finance/summary`
  - `GET/POST /api/inventory/procurement/finance/cost-centers`
  - `GET/POST /api/inventory/procurement/finance/budget-periods`
  - `GET/POST /api/inventory/procurement/finance/budget-allocations`
  - `PATCH /api/inventory/procurement/requests/:requestId/finance`
  - `GET/POST /api/inventory/procurement/invoices`
- Procurement page now has a **Finance** tab.

### Supplier Integration Foundation (Phase 1 Implemented)
- Extended supplier model and added:
  - `procurement_supplier_catalog_items`
  - `procurement_rfqs`
  - `procurement_rfq_invitations`
- Added supplier/RFQ endpoints:
  - `GET/POST /api/inventory/procurement/suppliers`
  - `GET/POST /api/inventory/procurement/suppliers/catalog`
  - `GET /api/inventory/procurement/rfqs`
  - `POST /api/inventory/procurement/requests/:requestId/rfqs`
  - `POST /api/inventory/procurement/rfqs/:rfqId/invitations`
  - `GET /api/inventory/procurement/requests/:requestId/quote-comparison`
- Procurement page now has a **Suppliers** tab.

### Diagnostics / Production Hardening Basics
- Added procurement diagnostics endpoint:
  - `GET /api/inventory/procurement/diagnostics`
- Returns DB readiness signal and adapter mode metadata:
  - finance provider mode (`manual` by default)
  - supplier provider mode (`manual` by default)
  - AI provider/model labels

### ITIL / ITAM Practical Alignment in this Pass
- Procurement lifecycle remains status-driven and approval-traceable.
- Receiving remains confirmation-first for inventory-impact operations.
- FIFO movement history improves traceability of stock issue/receipt events.
- Finance status and budget links improve decision auditability without forcing full ERP complexity.

## Current Limits (Intentional)
- No payment execution or legal accounting posting.
- Finance is internal tracking/foundation, not full accounting ERP.
- Supplier API integration remains manual/mock unless credentials are configured.
- Consumable FIFO is partially prepared (batch model available); advanced consumable lot issuance and expiry policy remains Phase 2.
