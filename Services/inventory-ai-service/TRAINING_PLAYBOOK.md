# Inventory AI Training Playbook

This playbook covers training and continuous improvement for all inventory AI features.

## 1. Real spec detection model/rules

### Data sources
- Primary: OEM and trusted reseller pages (weighted by source trust).
- Human corrections from verification queue (`approve` / `correct`).

### Active-learning loop
1. Create asset -> AI predicts specs.
2. If low confidence, asset enters pending verification queue.
3. Reviewer approves/corrects.
4. Feedback is written to:
   - `/app/data/spec_feedback.jsonl`
   - `/app/data/spec_golden_dataset.jsonl` (approved/corrected only)
5. Rebuild cache:
```bash
python -m src.train_spec_feedback_cache --golden /app/data/spec_golden_dataset.jsonl --output /app/data/spec_feedback_cache.json
```

### Evaluation
```bash
python -m src.evaluate_spec_inference --golden /app/data/spec_golden_dataset.jsonl
```
Or API:
- `GET /metrics/spec-inference`
- `GET /metrics/spec-inference?variant=control`
- `GET /metrics/spec-inference?variant=candidate`

Target KPIs (example):
- RAM precision >= 0.95
- CPU precision >= 0.92
- Storage precision >= 0.93

## 2. A/B rule version promotion

- Set control/candidate versions via env:
  - `SPEC_RULE_VERSION_CONTROL`
  - `SPEC_RULE_VERSION_CANDIDATE`
- Rollout candidate traffic via:
  - `SPEC_AB_ROLLOUT_PERCENT`
- Compare precision/recall per variant.
- Promote candidate only if metrics improve and false-positive rate does not regress.

## 3. Lifespan prediction model

### Training data requirements
- Asset profile fields (`type`, `brand`, `model`, specs)
- Telemetry (`working_hours`, `operational_state`)
- Outcomes (`lifespan_years` or replacement/failure signals)

### Train baseline
```bash
python -m src.train_asset_lifespan --data path/to/asset_lifespan_history.csv --model-dir /app/models
```

### Monthly recalibration
```bash
python -m src.recalibrate_lifespan_monthly --data path/to/monthly_telemetry_outcomes.csv --model-dir /app/models --metadata-path /app/data/lifespan_recalibration_metadata.json
```

In Docker automation, monthly recalibration runs automatically when:
- `Services/inventory-ai-service/data/lifespan_training.csv` exists and has data.
- `inventory-ai-scheduler` reaches the configured monthly UTC schedule.

Recommended continuous feed:
1. Export latest telemetry/outcome rows daily from inventory DB.
2. Append/merge into `Services/inventory-ai-service/data/lifespan_training.csv`.
3. Let monthly scheduler retrain automatically.

Review monthly:
- prediction error drift
- failure-risk calibration
- feature coverage (missing telemetry rate)

### Automated bootstrap pipeline

Use this when you want a fast warm-start model with both local inventory signals
and public benchmark datasets:

```bash
python -m src.auto_train_inventory_lifespan \
  --database-url "postgresql://postgres:IS1234567@postgres-inventory:5432/opsmind_assets" \
  --combined-training-csv /app/data/lifespan_training.csv \
  --model-dir /app/models
```

For a faster bootstrap while still training end-to-end:

```bash
python -m src.auto_train_inventory_lifespan \
  --database-url "postgresql://postgres:IS1234567@postgres-inventory:5432/opsmind_assets" \
  --combined-training-csv /app/data/lifespan_training.csv \
  --model-dir /app/models \
  --skip-backblaze
```

For meaningful/realistic evaluation in production, prefer local labels only:

```bash
python -m src.auto_train_inventory_lifespan \
  --database-url "postgresql://postgres:IS1234567@postgres-inventory:5432/opsmind_assets" \
  --combined-training-csv /app/data/lifespan_training.csv \
  --model-dir /app/models \
  --local-only
```

What it does:
1. Exports local labelled rows from inventory DB.
2. Pulls AI4I (UCI), NASA C-MAPSS, and latest Backblaze Drive Stats ZIP.
3. Maps them to the unified lifespan schema.
4. Trains `asset_lifespan_model.pkl`.

Important:
- AI4I and C-MAPSS are warm-start data and include synthetic/simulated signals.
- Treat local labelled inventory data as highest-priority ground truth.
- Promote models only after validating with your production outcomes.

## 4. Governance checklist

- Keep source trace (`source_urls`, `lookup_mode`, `rule_version`, `variant`).
- Keep confidence threshold strict (`SPEC_VERIFICATION_CONFIDENCE_THRESHOLD`).
- Never auto-promote candidate without evaluated golden-dataset gains.
