# Inventory, Auth, Workflow, and Notification Bridge Review

## Purpose

This review records how OpsMind should connect Inventory and Procurement approvals to the existing authentication, workflow, hierarchy, and notification services after the interrupted demo-account implementation was rolled back.

The target is practical ITAM governance: Inventory evaluates inventory-specific risk, Auth remains the identity owner, Workflow remains the workflow/hierarchy owner where it is already capable, and Notification remains the delivery owner.

## Marker Classification From Recovery

The interrupted auth demo-account implementation is not active in auth-service. The remaining risky seed/JWT/demo markers were removed from deployment documentation.

Inventory backend still has an optional reporting-manager reference in its approval fallback metadata. That is preserved because it belongs to Inventory approval display/testing fallback, not to auth-service login/JWT generation and not to a duplicated global user hierarchy.

## Existing Auth-Service Capabilities

The authentication service owns user identity and login. Current implementation uses MySQL tables for:

- `users`
- `roles`
- `user_roles`
- `buildings`
- `technicians`
- `technician_buildings`

Current login/JWT behavior is intentionally narrower than the interrupted demo-account attempt. The JWT utility signs the current auth payload, and the stable payload is user-focused rather than a full Inventory hierarchy context.

Original committed JWT/session shape:

- token payload includes `userId`, `email`, and `roles`
- frontend stores token under `opsmind_token`
- frontend stores user profile under `opsmind_user`
- frontend role checks normalize `role`, `roles`, and technician-level aliases already present in the existing user object
- no committed auth-service code currently emits a complete Inventory-specific approval hierarchy payload

Useful existing behavior:

- Users and roles are centralized in auth-service.
- Technician aliases are supported through the existing admin flow.
- Technician building assignment exists through `technician_buildings`.
- Auth admin creation can sync technician identity into workflow-service through `/workflow/admin/hierarchy/technicians/sync`.
- Auth-service exposes `/internal/admin-users`, but this is not a concrete role/building approver resolver.

Current gaps for Inventory approvals:

- Auth-service does not currently expose a stable concrete approver lookup by role and building.
- The stable auth/session payload does not yet provide a complete Inventory approval context for role, building, reporting manager, and permissions.
- The richer demo-account seed/JWT/resolver changes were incomplete and were intentionally rolled back.

Concrete approver lookup verdict:

- Not currently possible from auth-service without adding a new internal lookup API.
- Inventory must not duplicate auth users/roles/hierarchy to compensate.
- Role-scoped notification recipients remain the safe bridge for now.

## Existing Workflow-Service Capabilities

Workflow-service currently specializes in ticket workflow routing, assignment, escalation, and technician hierarchy support.

Useful existing behavior:

- Ticket routing through `/workflow/route-ticket`.
- Ticket claim, reassignment, escalation, and workflow logs.
- Support groups and group membership.
- Technician hierarchy sync from auth-service.
- Reporting relationships through hierarchy endpoints:
  - `/workflow/admin/hierarchy/technicians/sync`
  - `/workflow/admin/hierarchy/relationships`
  - `/workflow/admin/hierarchy/tree`
  - `/workflow/admin/hierarchy/user/:userId/reports`
  - `/workflow/admin/hierarchy/user/:userId/manager`
- Dashboard views by hierarchy role for ticket work.

How workflow-service receives work today:

- ticket-service calls `/workflow/route-ticket` after ticket creation
- workflow-service also consumes ticket sync/assignment events
- workflow-service stores routing state, workflow logs, ticket cache data, technicians, support groups, and reporting relationships
- workflow-service can escalate/reassign ticket work, but the routes and payloads are ticket-specific

Existing hierarchy/reporting model:

- workflow-service has `reporting_relationships`
- relationship types include Junior-to-Senior, Senior-to-Supervisor, and Supervisor-to-Admin style chains
- auth-service admin flows can sync technician identity into workflow-service
- hierarchy endpoints can return direct reports, manager, and full tree

Current gaps for Inventory approvals:

- No generic approval-task or workflow-instance API was found for arbitrary Inventory/Procurement actions.
- Existing workflow execution is ticket-centric, not a general approval engine.
- There is no stable endpoint to create an Inventory approval task, bind it to an InventoryApprovalRequest, and drive approve/reject lifecycle from workflow-service.

Readiness verdict:

- Workflow-service is not ready to own Inventory approval execution yet without new generic approval-task APIs.
- Inventory should keep local approval request/decision records for now.
- Future integration should add a workflow task ID/link when workflow-service supports generic approvals.

## Existing Notification-Service Capabilities

Notification-service owns notification persistence and delivery. It exposes the existing event route:

- `POST /api/notifications/events`

It publishes and consumes RabbitMQ notification events. Ticket notification consumers already exist, and the Inventory approval foundation adds an `inventory.notification.*` consumer.

How notification-service receives events:

- services post to `POST /api/notifications/events` with a `routingKey` and `payload`
- notification-service publishes the event to RabbitMQ
- consumers bind to routing keys such as `ticket.notification.*` and `inventory.notification.*`
- in-app notifications are persisted through notification-service models or in-memory test fallback

Current Inventory notification behavior:

- Inventory backend publishes approval events to notification-service.
- Notification-service creates in-app notifications for direct users and role-scoped recipient keys.
- Role-scoped keys remain explicit until auth-service exposes concrete recipient lookup.

Examples:

- `role:SENIOR:MAIN`
- `role:BUILDING_SUPERVISOR:MAIN`
- `role:BUILDING_SUPERVISOR:CENTRAL_WAREHOUSE`
- `role:SUPERVISOR_CHIEF:GLOBAL`
- `role:ADMIN:GLOBAL`

## Correct Integration Seam

Auth-service should own:

- users
- roles
- login/session/JWT identity
- building assignment
- reporting hierarchy identity data
- future role/building recipient lookup

Workflow-service should own:

- generic workflow/approval execution once available
- task assignment, escalation, and workflow state
- workflow audit trail for workflow-owned tasks

Inventory backend should own:

- inventory/procurement action context
- risk classification
- cost, quantity, criticality, reversibility, and cross-building impact evaluation
- InventoryApprovalPolicy defaults
- InventoryApprovalRequest records
- InventoryApprovalDecision records
- InventoryAuditLog records
- entity links to assets, procurement requests, purchase orders, receiving records, and stock movement
- optional Inventory-local reporting fallback metadata for approval display/testing only; this must not become a duplicate auth hierarchy

Notification-service should own:

- notification delivery
- notification persistence
- event consumption
- in-app notification creation

Inventory should not own:

- global auth user tables
- full role hierarchy
- full workflow engine semantics
- notification persistence tables outside Inventory audit logs

Inventory backend clean seam:

- Inventory can call notification-service today through the stable event route.
- Inventory can later call workflow-service when a generic approval-task endpoint exists.
- Inventory should keep the local `InventoryApprovalRequest` record even after workflow integration, because it contains Inventory entity context, cost, quantity, criticality, and replay/audit metadata that workflow-service should not have to understand deeply.

## Current Decision

Inventory keeps its local approval engine as a practical bridge because workflow-service is not yet a generic approval engine and auth-service does not yet expose concrete role/building recipient lookup.

This is intentionally temporary but safe:

1. Inventory evaluates action risk.
2. Inventory auto-approves routine actions and writes audit logs.
3. Inventory creates approval requests for controlled/high/system-critical actions.
4. Inventory publishes notification events through notification-service.
5. Notification-service records direct or role-scoped in-app notifications.
6. Approved actions require explicit retry with `approvalRequestId`; no irreversible action silently executes after approval.

## Future Work

Auth-service future work:

- Add a protected internal recipient resolver by role/building.
- Include stable Inventory role/building context in JWT/login response.
- Keep demo accounts behind a local-only seed flag if reintroduced later.

Workflow-service future work:

- Add generic approval-task APIs.
- Allow InventoryApprovalRequest to link to a workflow task or instance.
- Support approve/reject/escalate callbacks for Inventory actions.
- Keep ticket routing behavior unchanged.

Notification future work:

- Expand role-scoped recipients into concrete auth users once auth-service resolver is stable.
- Keep role-scoped fallback for local/dev and partial outages.

Inventory future work:

- Add admin-managed approval policy UI.
- Add optional dual-approval for the highest-risk procurement and financial override cases.
- Add richer source/target stakeholder notifications for cross-building transfers.
