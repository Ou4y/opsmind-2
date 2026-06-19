# Inventory and Procurement RBAC Approval Workflow

## Purpose

OpsMind Inventory and Procurement use a backend-enforced approval policy foundation. This is not only frontend button hiding. High-impact inventory, warehouse, and procurement actions are evaluated server-side before mutation.

The design follows a practical ITAM pattern: do not disturb senior users for routine work, but require approval when an action creates cost, loss, cross-scope impact, security/compliance risk, or irreversible change.

## Ownership Boundaries

Auth service owns:

- users
- login/session/JWT identity
- global roles
- building assignments
- reporting hierarchy identity data

Inventory backend owns:

- inventory/procurement action context
- action risk classification
- approval policy mapping
- InventoryApprovalRequest records
- InventoryApprovalDecision records
- InventoryAuditLog records
- links to assets, procurement, PO, receiving, stock, and CMDB entities

Workflow service owns:

- ticket routing and technician hierarchy today
- future generic approval-task execution when that capability exists

Notification Service owns:

- notification delivery
- notification persistence
- RabbitMQ event consumers

## Current Architecture Decision

Inventory currently keeps a local approval request/decision engine because workflow-service is ticket-centric and does not yet expose a stable generic approval-task API for Inventory actions.

Inventory still uses the existing service architecture:

1. Inventory evaluates risk and approval need.
2. Inventory writes approval/audit records.
3. Inventory publishes `inventory.notification.*` events to notification-service.
4. Notification-service creates direct or role-scoped in-app notifications.
5. Approved actions require explicit retry with `approvalRequestId`; irreversible actions are not replayed silently.

Concrete auth-service recipient lookup by role/building is future work. Until then, notification-service keeps role-scoped recipients such as `role:SENIOR:MAIN`.

## Intended Hierarchy

OpsMind Inventory hierarchy:

- Admin
- Supervisor Chief
- Building Supervisor
- Senior
- Junior

Building scopes:

- `MAIN`
- `N`
- `K`
- `S`
- `R`
- `PHARMACY`
- `CENTRAL_WAREHOUSE`

Each building follows this operating chain:

- 2 Juniors -> 1 Senior -> 1 Building Supervisor -> Supervisor Chief -> Admin

Central Warehouse follows the same chain but has special stock, receiving, and dispatch authority.

## Roles

`JUNIOR` is field execution:

- can view own building assets
- can scan QR
- can add notes/photos
- can update minor condition/status notes
- can complete assigned audits
- can report damage/missing/discrepancy
- can request repair/replacement/consumables
- cannot delete assets
- cannot approve procurement
- cannot transfer valuable assets
- cannot dispose/write off
- cannot edit financial/vendor fields

`SENIOR` is building operational validation:

- can validate junior work
- can approve junior audit/damage/discrepancy reports
- can update low-risk internal location/assignment changes
- can request procurement
- can approve small consumable requests
- needs Building Supervisor for controlled cost/ownership/stock actions

`BUILDING_SUPERVISOR` is building approval:

- can approve building-level requests
- can approve internal building transfers
- can approve medium procurement
- can approve stock requests from Central Warehouse
- needs Supervisor Chief for high-value, cross-building, bulk, critical, or major-loss actions

`SUPERVISOR_CHIEF` is cross-building/high-impact approval:

- can approve cross-building transfers
- can approve high-impact procurement
- can approve major stock movements
- can resolve supervisor conflicts
- needs Admin for destructive, policy, very high-cost, financial override, role/permission, permanent deletion, disposal/write-off

`ADMIN` is system-critical authority:

- has full authority
- can manage policies/roles/system-critical actions
- all overrides must be audited

## Risk Levels

- `L0_ROUTINE`: no approval, audit only.
- `L1_OPERATIONAL`: Senior approval when initiated by Junior.
- `L2_CONTROLLED`: Building Supervisor approval.
- `L3_HIGH_IMPACT`: Supervisor Chief approval.
- `L4_SYSTEM_CRITICAL`: Admin approval.

## Core Do-Not-Disturb Rule

Only escalate when the action creates one or more of these risks:

- financial cost
- asset loss
- cross-building or cross-scope impact
- security/compliance impact
- critical asset impact
- high quantity movement
- irreversible mutation
- policy, role, vendor, or financial override

Routine work should be audit-only so supervisors are not flooded.

## Actions by Approval Level

No approval / audit only:

- view/search asset
- scan QR
- add note/photo
- update minor condition note
- complete assigned audit
- view own building stock
- print/download QR labels

Senior approval:

- junior damage report
- junior missing asset report
- junior repair request
- junior audit discrepancy
- junior small consumables request
- junior item assignment request
- Central Warehouse junior small dispatch or receiving draft confirmation

Building Supervisor approval:

- valuable internal transfer
- ownership/assignment change
- replacement request
- medium procurement
- warehouse stock issue
- unusable condition downgrade
- warranty/service claim
- medium stock correction
- PO receiving inventory impact inside normal thresholds

Supervisor Chief approval:

- cross-building transfer
- bulk movement
- high-value procurement
- critical replacement
- large warehouse dispatch
- major asset loss
- vendor exception
- emergency shortage resolution
- critical/security/network/server asset movement when impact is high

Admin approval:

- permanent delete
- dispose/write-off
- approval policy change
- role/permission change
- very high-cost procurement
- rejected-approval override
- financial override
- system-wide stock correction
- vendor blacklist
- destructive bulk action

## Central Warehouse Special Cases

Central Warehouse Junior:

- pick items
- scan items
- prepare dispatch
- report stock mismatch
- draft receiving quantity
- needs Senior approval for quantity confirmation/damage/adjustment

Central Warehouse Senior:

- validate receiving
- confirm spare stock counts
- approve small stock issue
- prepare stock transfer
- needs Warehouse Supervisor approval for large stock issue, high-value spare part dispatch, bulk transfer, or stock correction

Central Warehouse Supervisor:

- approve stock fulfillment
- approve PO receiving impact
- approve warehouse-to-building dispatch
- manage warehouse stock levels
- needs Supervisor Chief approval for large cross-building allocation, critical shortage decision, emergency distribution, or high-value movement

Current implementation treats `CENTRAL_WAREHOUSE` building scope as `WAREHOUSE` for policy evaluation.

## Procurement Thresholds

Demo thresholds:

- EGP `0-1,000`: auto-approved or Senior approval depending actor/request type.
- EGP `1,001-5,000`: Building Supervisor.
- EGP `5,001-25,000`: Supervisor Chief.
- EGP `25,001+`: Admin.

Additional escalation rules:

- Critical/security/server/network assets escalate to Supervisor Chief or Admin depending amount and reversibility.
- New vendor exceptions should go to Supervisor Chief/Admin.
- Emergency high-value purchase should go to Supervisor Chief, then Admin above threshold.

## Approval Chain Examples

1. Junior marks mouse as working:

- no approval
- audit log only

2. Junior reports laptop damaged:

- Senior approval
- if repair/replacement is needed, Building Supervisor approval

3. Senior requests monitors:

- Building Supervisor approval
- Supervisor Chief if high amount
- Admin if very high amount

4. N Building to K Building transfer:

- source/target supervisor awareness
- Supervisor Chief approval

5. Warehouse sends spare stock to R Building:

- R Building Supervisor approval for request side
- Warehouse Supervisor fulfillment for stock side
- Supervisor Chief only if large/critical/high value

## Best Policy Fields

Recommended approval policy fields:

- `actionType`
- `minimumRole`
- `scopeType`
- `riskLevel`
- `amountMin`
- `amountMax`
- `quantityMin`
- `quantityMax`
- `assetCriticality`
- `requiresApproval`
- `approverRole`
- `requiresDualApproval`
- `autoApprove`
- `notifyOnly`
- `isActive`

The current Prisma model includes the stable core fields and can be extended with quantity/criticality ranges later if policy editing becomes richer.

## Recommended Approval Matrix

| Actor / Action Class | Routine | L1 Operational | L2 Controlled | L3 High Impact | L4 System Critical |
| --- | --- | --- | --- | --- | --- |
| Junior | Audit only | Senior | Building Supervisor | Supervisor Chief or denied for execution | Admin, usually denied for execution |
| Senior | Audit only | Audit only | Building Supervisor | Supervisor Chief | Admin |
| Building Supervisor | Audit only | Audit only | Audit only or notify | Supervisor Chief | Admin |
| Supervisor Chief | Audit only | Audit only | Audit only | Audit only or notify | Admin |
| Admin | Audit only | Audit only | Audit only | Audit only | Audit only with override audit |

## Backend Endpoints

- `GET /api/inventory/rbac/me`
- `POST /api/inventory/approval/evaluate`
- `POST /api/inventory/approvals`
- `GET /api/inventory/approvals`
- `GET /api/inventory/approvals/:id`
- `POST /api/inventory/approvals/:id/approve`
- `POST /api/inventory/approvals/:id/reject`
- `POST /api/inventory/approvals/:id/escalate`
- `GET /api/inventory/approval-policies`
- `GET /api/inventory/audit-log`

## Notification Behavior

Approval events use routing keys:

- `inventory.notification.approval_requested`
- `inventory.notification.approval_approved`
- `inventory.notification.approval_rejected`
- `inventory.notification.approval_escalated`
- `inventory.notification.approval_completed`

The notification-service consumer creates in-app notifications for direct users and role-scoped recipients such as:

- `role:SENIOR:MAIN`
- `role:BUILDING_SUPERVISOR:N`
- `role:BUILDING_SUPERVISOR:CENTRAL_WAREHOUSE`
- `role:SUPERVISOR_CHIEF:GLOBAL`
- `role:ADMIN:GLOBAL`

If notification-service fails, Inventory should not crash the business action. It should log a warning and return notification warning metadata where useful.

## Frontend Behavior

The Procurement page includes an Approval Center showing pending approvals and requester-owned approval requests. Approve/reject actions use in-app confirmation modals and do not use native browser prompts.

Inventory/Procurement actions should show clear outcomes:

- `Completed - audit logged` for routine auto-approved work.
- `Approval required` with the approver role/scope for controlled actions.
- `Approved - re-run the original action with approvalRequestId` for approved requests.

## Migration Safety

The migration is additive only:

- no drops
- no truncates
- no resets
- no existing inventory/procurement data deletion

Migration name:

- `20260612120000_add_inventory_rbac_approval_workflow`

## Known Limitations

- Concrete auth-service recipient lookup by role/building is future work.
- Workflow-service is not yet used for generic Inventory approval execution.
- Header/demo fallback remains only for local API smoke testing when `INVENTORY_ENFORCE_AUTH=false`.
- Approved actions require explicit retry with `approvalRequestId`; automatic action replay is intentionally not implemented.
- Policy defaults are seeded in Inventory backend startup and can later be replaced by admin-managed policy UI.

## Validation Checklist

- Prisma schema validates with backend-local Prisma.
- TypeScript compiles.
- Approval evaluator tests cover role/risk escalation.
- Inventory import fixture test still passes.
- Notification consumer syntax checks.
- Frontend Inventory/Procurement JavaScript syntax checks.
