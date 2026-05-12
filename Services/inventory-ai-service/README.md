# Inventory AI Service

Inventory-focused AI microservice for OpsMind.

## What it does

- `POST /predict-asset-lifespan`
  - Predicts lifespan using type/brand/model/specs + telemetry-adjusted working hours.
- `POST /infer-asset-specs`
  - Looks up specs from authoritative OEM/trusted reseller sources (via SerpAPI).
  - Falls back to heuristic inference if live lookup fails.
  - Returns source traceability (`source_urls`, `rule_version`, `variant`, `lookup_mode`).
- `POST /feedback/spec-verification`
  - Accepts human verification/corrections and stores training feedback.
- `GET /metrics/spec-inference`
  - Computes field-level precision/recall from the golden dataset.
  - Supports `?variant=control|candidate` for A/B evaluation.

## Docker

This service is orchestrated from repo root `docker-compose.yml` as `inventory-ai-service`.
The continuous jobs runner is `inventory-ai-scheduler`.

Standalone:

```bash
cd Services/inventory-ai-service
docker compose up -d --build
```

This starts both:
- `inventory-ai-service` (API)
- `inventory-ai-scheduler` (daily/monthly jobs)

## Environment

- `SERPAPI_API_KEY` (required for live catalog lookup)
- `SERPAPI_ENDPOINT` (default `https://serpapi.com/search.json`)
- `SPEC_LOOKUP_TIMEOUT_SECONDS` (default `8`)
- `SPEC_RULE_VERSION_CONTROL` / `SPEC_RULE_VERSION_CANDIDATE`
- `SPEC_AB_ROLLOUT_PERCENT` (A/B rollout)
- `SPEC_FORCE_VARIANT` (`control` / `candidate`, optional override)
- `SPEC_VERIFICATION_CONFIDENCE_THRESHOLD` (default `0.85`)
- `INVENTORY_AI_DATA_DIR` (default `/app/data`)
- `SCHEDULER_POLL_SECONDS` (default `60`)
- `SPEC_DAILY_HOUR_UTC` / `SPEC_DAILY_MINUTE_UTC`
- `LIFESPAN_MONTHLY_DAY_UTC` / `LIFESPAN_MONTHLY_HOUR_UTC` / `LIFESPAN_MONTHLY_MINUTE_UTC`

## Training workflow

1. Collect human feedback via `/feedback/spec-verification`.
2. Build/update golden dataset in `/app/data/spec_golden_dataset.jsonl`.
3. Monitor `/metrics/spec-inference` (precision/recall by field).
4. Promote candidate rule version only after metric improvement.
5. Recalibrate lifespan monthly with fresh telemetry/failure outcomes:

```bash
python -m src.train_asset_lifespan --data path/to/asset_lifespan_history.csv
```

6. Build active-learning cache and evaluate spec quality:

```bash
python -m src.train_spec_feedback_cache --golden /app/data/spec_golden_dataset.jsonl --output /app/data/spec_feedback_cache.json
python -m src.evaluate_spec_inference --golden /app/data/spec_golden_dataset.jsonl
```

7. Continuous scheduler behavior:
- Daily: rebuild feedback cache + write latest metrics snapshot
- Monthly: run lifespan recalibration if `/app/data/lifespan_training.csv` exists

## Lifespan dataset export (inventory DB -> CSV)

Use the exporter to generate the exact schema expected by `train_asset_lifespan.py`:

```bash
python -m src.export_lifespan_training_dataset \
  --database-url "postgresql://postgres:IS1234567@postgres-inventory:5432/opsmind_assets" \
  --output /app/data/lifespan_training_local.csv \
  --candidates-output /app/data/lifespan_training_candidates.csv
```

SQL template used by this exporter is also available at:

- `sql/export_lifespan_training.sql`

## One-command auto bootstrap + train

This command exports local labelled rows, fetches external warm-start datasets
(AI4I, NASA C-MAPSS, Backblaze), builds `/app/data/lifespan_training.csv`, and trains
`/app/models/asset_lifespan_model.pkl`:

```bash
python -m src.auto_train_inventory_lifespan \
  --database-url "postgresql://postgres:IS1234567@postgres-inventory:5432/opsmind_assets" \
  --combined-training-csv /app/data/lifespan_training.csv \
  --model-dir /app/models
```

Faster run (skips large Backblaze ZIP download):

```bash
python -m src.auto_train_inventory_lifespan \
  --database-url "postgresql://postgres:IS1234567@postgres-inventory:5432/opsmind_assets" \
  --combined-training-csv /app/data/lifespan_training.csv \
  --model-dir /app/models \
  --skip-backblaze
```

Reliable production-focused run (local labels only):

```bash
python -m src.auto_train_inventory_lifespan \
  --database-url "postgresql://postgres:IS1234567@postgres-inventory:5432/opsmind_assets" \
  --combined-training-csv /app/data/lifespan_training.csv \
  --model-dir /app/models \
  --local-only
```

Artifacts generated:
- `/app/data/lifespan_training_local.csv`
- `/app/data/lifespan_training.csv`
- `/app/data/lifespan_bootstrap_summary.json`
- `/app/models/asset_lifespan_model.pkl`
