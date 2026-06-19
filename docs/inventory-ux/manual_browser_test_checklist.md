# Manual Browser Test Checklist - Inventory Module

Use this checklist in a real browser session against local services.

## Local QA Login Accounts for Approval Testing

These accounts are local-only browser QA accounts seeded by the auth-service development seed. They are not production approver accounts and do not imply concrete auth-service approver lookup is implemented.

Use the local QA password convention: `Qa@123456`.

| Login email | Expected Inventory role from `/api/inventory/rbac/me` | Expected scope |
| --- | --- | --- |
| `qa.junior@opsmind.local` | `JUNIOR` | `MAIN` building |
| `qa.senior@opsmind.local` | `SENIOR` | `MAIN` building |
| `qa.supervisor@opsmind.local` | `BUILDING_SUPERVISOR` | `MAIN` building |
| `qa.chief@opsmind.local` | `SUPERVISOR_CHIEF` | Global scope |
| `qa.admin@opsmind.local` | `ADMIN` | Global scope |

Login still uses the normal auth-service OTP flow. In local development, OTPs are printed by the auth-service logs instead of being sent through real SMTP.

Recommended local role checks:

1. Login as `qa.junior@opsmind.local`, open Inventory or Procurement, and call `/api/inventory/rbac/me`; confirm `JUNIOR` / `MAIN`.
2. Trigger a junior damage/missing/repair/discrepancy action; confirm Senior approval is required.
3. Login as `qa.senior@opsmind.local`; confirm `SENIOR` / `MAIN` and review Junior pending approvals.
4. Trigger medium procurement; confirm Building Supervisor approval is required.
5. Login as `qa.supervisor@opsmind.local`; confirm `BUILDING_SUPERVISOR` / `MAIN`.
6. Trigger cross-building or high-impact action; confirm Supervisor Chief approval is required.
7. Login as `qa.chief@opsmind.local`; confirm `SUPERVISOR_CHIEF` / global scope.
8. Trigger write-off/destructive/system-critical action; confirm Admin approval is required.
9. Login as `qa.admin@opsmind.local`; confirm `ADMIN` / global scope and audit logging for Admin-level decisions.

1. Import full kit CSV with parent + components + accessories + licenses.
2. Confirm parent CMDB shows components.
3. Confirm parent relationships show accessories/licenses.
4. Confirm Components page shows imported components if intended.
5. Confirm Accessories/Licenses pages show linked items.
6. Transfer parent with related items.
7. Confirm transfer history/timeline updates.
8. Confirm map marker updates for location changes.
9. Confirm telemetry hide/show behavior (Central Warehouse vs deployed locations).
10. Test AI Assistant outputs:
- missing serials
- low stock
- duplicates
- daily brief
- executive dashboard
- monthly report
- digital twin
- black box timeline
11. Test AI repair import errors workflow end-to-end.
12. Test audit board actions (verify/missing) and state updates.
13. Test loaners checkout/return flow.
14. Test bulk checkout flow (validate then confirm).
15. Check browser console for errors/warnings during all above steps.
16. Verify no action silently modifies committed data without explicit confirmation.

## Approval Workflow Browser Checks
17. Trigger a junior-level damage or missing report and confirm the UI explains Senior approval is required.
18. Trigger a medium procurement request and confirm Building Supervisor approval is required.
19. Trigger a high-value procurement request and confirm Supervisor Chief/Admin escalation according to amount.
20. Trigger or inspect a Central Warehouse dispatch/receiving action and confirm warehouse role routing is clear.
21. Confirm approval request responses show request code, approver role/scope, and next step.
22. Open Procurement Approval Center and confirm pending/submitted/approved/rejected sections are understandable.
23. Approve or reject a request using in-app UI only; confirm no native browser alert/confirm/prompt appears.
24. Confirm requester notification/feedback appears after approval or rejection where notification-service is available.
25. Confirm approved controlled actions require explicit retry/execution with `approvalRequestId`; they must not silently replay.
26. Confirm audit/history reflects approval request and decision activity.

## Result Capture Template
- Pass/Fail:
- Repro steps for failures:
- Screenshots/log snippets:
- Severity:
- Suggested fix:
