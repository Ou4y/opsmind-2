# Wireframe Notes (Low-Fidelity)

Note: Text-only wireframe guidance for thesis documentation. No image assets were generated in this pass.

## A) Inventory Home
### Layout blocks
- Top toolbar: search + primary operations (import, map, checkout, loaners, audit, create).
- View tabs: Parent Assets, Components, Accessories, Consumables, Spare Stock, Licenses.
- Filters row: building, department, type, lifecycle, reset.
- Main table: grouped rows + actions.
- Pager: page indicator and previous/next.

### Flow
1. User lands on grouped parent view.
2. User switches view tabs.
3. User filters and opens detail actions.

## B) Import CSV Flow
### Layout blocks
- Import modal title (CSV).
- Template/help panel and step guidance.
- Upload/drop zone and file hint.
- AI actions (map columns, repair errors, invoice match).
- Preview table.
- Commit summary + post-commit actions.

### Flow
1. Upload CSV.
2. Preview rows.
3. Repair/adjust.
4. Confirm import.
5. Review batch summary.

## C) AI Repair Suggestions
### Layout blocks
- Suggestions meta summary.
- Suggestions table (row, field, old/new, reason, confidence, status).
- Actions: Apply Safe, Apply Selected, Ignore, Re-run Preview.

### Flow
1. Generate suggestions.
2. Select/inspect.
3. Apply and revalidate.
4. Confirm import.

## D) Parent CMDB
### Layout blocks
- Header with parent identity.
- Tabs/panels: components, relationships, maintenance/custody, AI summary.
- Context cards for Digital Twin and Black Box Timeline.

### Flow
1. Open CMDB from asset row.
2. Inspect links and lifecycle evidence.
3. Execute focused follow-up actions.

## E) Asset Map
### Layout blocks
- Map controls and filters.
- Main map canvas with markers.
- Side panel (location assets and unmapped list).
- Footer legend.
- Calibration panel (when enabled).

### Flow
1. Open map.
2. Apply filters.
3. Select marker.
4. Review location details.
5. Optional calibration.

## F) Transfer with Related Items
### Layout blocks
- Destination selectors.
- Related-item toggles and counts.
- Confirm transfer action.

### Flow
1. Open transfer modal.
2. Choose destination.
3. Toggle related-item scope.
4. Confirm transfer.
5. Validate in history/timeline/map.

## Wireframe Follow-Up Recommendation
Create click-through low-fidelity prototypes in next thesis iteration using these documented blocks and flows before high-fidelity visual polish.
