# Manual Browser Test Checklist - Inventory Module

Use this checklist in a real browser session against local services.

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

## Result Capture Template
- Pass/Fail:
- Repro steps for failures:
- Screenshots/log snippets:
- Severity:
- Suggested fix:
