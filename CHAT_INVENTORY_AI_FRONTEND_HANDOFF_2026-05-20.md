# Inventory AI + Frontend Handoff

Date: 2026-05-20
Repo: `C:\Projects\opsmind-2`

## Goal

Make `inventory-ai-service` use Gemini 2.5 Flash for inventory intelligence, improve the inventory AI flow, fix frontend/runtime issues, and clean up Assets page behavior.

## Gemini / Inventory AI Status

- `inventory-ai-service` is wired to use Gemini 2.5 Flash.
- Relevant runtime config was moved toward root `.env` usage:
  - `GEMINI_API_KEY`
  - `GEMINI_API_URL`
  - `LLM_PROVIDER=gemini`
  - `GEMINI_MODEL=gemini-2.5-flash`
- The service health showed Gemini selected, but Gemini auth previously returned `401 UNAUTHENTICATED`.
- Main remaining blocker for real LLM quality is key validity/auth, not the code wiring.
- Live spec lookup also depends on `SERPAPI_API_KEY`; if empty, live web lookup quality is limited.

## Inventory AI Flow Fixes

Implemented backend automation matching the desired flow:

- On asset creation:
  - enrich specs automatically
  - calculate/persist lifecycle prediction
  - reason recorded as `asset_created`

- On asset transfer:
  - update destination/user/location
  - trigger lifecycle refresh
  - reason recorded as `asset_transferred`

- On telemetry/state updates:
  - track operational state
  - accumulate working hours only while asset is on
  - use different consumption rates:
    - `online_in_use`: higher consumption
    - `online_idle`: lower consumption
    - `offline`: no consumption
  - recalculate lifespan when consumption meaningfully affects the asset

## Backend Quality Fixes

- Fixed event payload mismatch between producer and history worker.
- History worker now subscribes to created/transferred/updated/deleted asset topics.
- Fixed partial transfer status issue so split assets get the intended status.
- Fixed telemetry timestamp handling to reduce drift from out-of-order timestamps.
- Protected lifecycle fields from being overwritten by AI spec inference.
- Added/kept smoke validation around core create, telemetry, transfer, and cleanup flows.

## Verified Backend Behavior

Smoke-tested:

- Create asset -> lifecycle prediction persisted.
- Telemetry active/idle -> working hours changed as expected.
- Transfer asset -> assigned/transferred status and lifecycle refresh worked.
- Quantity smoke test:
  - created test asset with quantity `11`
  - transferred `4`
  - backend showed `7` in warehouse and `4` transferred
  - total remained `11`
  - test records were cleaned up.

## Frontend Auth Fix

Issue:

- Login showed `Failed to fetch`.
- Frontend was calling `http://localhost:3002`, but Docker exposed auth-service on `http://localhost:3012`.

Fixes:

- Updated frontend/auth config to use `http://localhost:3012`.
- Updated:
  - `.env`
  - `.env.example`
  - `opsmind_frontend/assets/js/config.js`
  - `opsmind_frontend/docker-entrypoint.sh`
  - `opsmind_frontend/docker-compose.yml`
- Rebuilt/restarted frontend.
- Verified served config points to `http://localhost:3012`.

## Assets Page UI Fixes

Requested:

- Remove horizontal scrollbar on Assets page.
- Add button to delete all assets at once with confirmation.

Implemented:

- Removed page-level horizontal overflow by tightening layout/table CSS.
- Added Delete All Assets button with confirmation.
- Button disables when there are no assets.
- Delete-all counts total units, not only rows.
- Frontend cache-busted inventory page JS/CSS.

## Quantity Bug Fix

Issue:

- Creating an asset with quantity greater than `1` displayed as quantity `1`.
- Transfer could make the number appear wrong, e.g. becoming `3` regardless of original quantity.

Root cause:

- Frontend grouped table counted asset rows/batches instead of summing `asset.quantity`.
- Bulk transfer treated each grouped row as one unit.

Fix:

- Added frontend quantity helpers:
  - `getAssetQuantity(asset)`
  - `getAssetsTotalQuantity(assets)`
- Table now displays summed quantity.
- View modal now shows total units and per-batch quantity.
- Individual transfer uses real batch quantity.
- Bulk transfer distributes requested quantity across batches correctly.
- Delete-all confirmation and success messages use total units.

Verified:

- `node --check opsmind_frontend\assets\js\pages\inventory.js` passed.
- Served frontend uses `inventory.js?v=5`.
- Docker frontend and backend are running.

## Useful Commands

```powershell
docker compose ps
docker compose up -d --build opsmind-frontend
docker compose up -d --build inventory-backend inventory-backend-worker inventory-ai-service inventory-ai-scheduler
```

Hard refresh frontend after asset page JS/CSS changes:

```text
Ctrl + F5
```

## Remaining Caveats

- Gemini needs a valid API credential for real LLM responses.
- SerpAPI needs a valid key for strong live web spec lookup.
- If both building and department transfer destinations are selected together, review whether that should be allowed as one combined transfer action or forced to one destination type.

