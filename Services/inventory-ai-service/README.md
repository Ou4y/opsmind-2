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
- `GET /metrics`
  - Exposes in-memory Prometheus-style endpoint metrics (latency/counters).

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

- `LLM_PROVIDER` (`ollama` or `gemini`, default `ollama`)
- `OLLAMA_BASE_URL` (default `http://host.docker.internal:11434`)
- `OLLAMA_MODEL` (default `gemma3:4b`)
- `OLLAMA_TIMEOUT_SECONDS` (default `45`)
- `OLLAMA_TIMEOUT_MS` (optional compatibility alias used by ticket service; e.g. `45000`)
- `SERPAPI_API_KEY` (required for live catalog lookup)
- `SERPAPI_ENDPOINT` (default `https://serpapi.com/search.json`)
- `GEMINI_API_KEY` (enables Gemini structured inference)
- `GEMINI_MODEL` (default `gemini-2.0-flash`)
- `SPEC_LOOKUP_TIMEOUT_SECONDS` (default `8`)
- `SPEC_HTTP_RETRY_ATTEMPTS` (default `3`)
- `SPEC_HTTP_BACKOFF_SECONDS` (default `0.35`)
- `SPEC_LOOKUP_CIRCUIT_FAILURES` (default `4`)
- `SPEC_LOOKUP_CIRCUIT_RESET_SECONDS` (default `90`)
- `SPEC_RULE_VERSION_CONTROL` / `SPEC_RULE_VERSION_CANDIDATE`
- `SPEC_AB_ROLLOUT_PERCENT` (A/B rollout)
- `SPEC_FORCE_VARIANT` (`control` / `candidate`, optional override)
- `SPEC_VERIFICATION_CONFIDENCE_THRESHOLD` (default `0.85`)
- `SPEC_VARIANT_POLICY_PATH` (default `/app/data/spec_variant_policy.json`)
- `SPEC_PROMOTION_MIN_EVALS` (default `40`)
- `SPEC_PROMOTION_MIN_IMPROVEMENT` (default `0.01`)
- `INVENTORY_AI_DATA_DIR` (default `/app/data`)
- `SCHEDULER_POLL_SECONDS` (default `60`)
- `SPEC_DAILY_HOUR_UTC` / `SPEC_DAILY_MINUTE_UTC`
- `LIFESPAN_MONTHLY_DAY_UTC` / `LIFESPAN_MONTHLY_HOUR_UTC` / `LIFESPAN_MONTHLY_MINUTE_UTC`

## Free local LLM (Ollama)

Run Ollama on your host machine:

```bash
ollama serve
ollama pull gemma3:4b
```

Then start this service with:

```bash
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_MODEL=gemma3:4b
```

Health endpoint will show LLM state:
- `llm_provider`
- `llm_status`
- `llm_last_error` (if any)

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
