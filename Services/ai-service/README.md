# OpsMind AI Service

AI microservice for OpsMind ITSM.
Predicts ticket priority (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) and estimated resolution time.

## Workflow Assumption (Important)

New OpsMind tickets always start at **L1**. Escalation to L2/L3/L4 happens later.

Because of that, `support_level` is **not** a valid initial-prediction feature and is removed from model training/inference features.

## Project Structure

```text
ai-service/
├── src/
│   ├── main.py
│   ├── train.py
│   ├── preprocess.py
│   ├── models.py
│   ├── schemas.py
│   └── __init__.py
├── models/
│   ├── priority_pipeline.pkl
│   ├── est_pipeline.pkl
│   ├── model_metadata.pkl
│   └── metrics.json
├── ITSM_Dataset.csv
├── requirements.txt
└── README.md
```

## Feature Policy

### Priority target

Priority remains a 4-class target:
- `LOW`
- `MEDIUM`
- `HIGH`
- `CRITICAL`

CSV mapping:
- `Low -> LOW`
- `Medium -> MEDIUM`
- `High -> HIGH`
- `Critical -> CRITICAL`

Priority target encoding:
- label encoding only (`PRIORITY_TO_INT`, `INT_TO_PRIORITY`)
- no one-hot encoding for `y_priority`

### Production-safe input features used for training and inference

- `topic`
- `source`
- `product_group`
- `country`
- `created_hour`
- `created_weekday`
- `is_weekend`
- `is_out_of_hours`

### Explicitly removed features

- `Support Level`
- `Latitude`, `Longitude`
- `Agent Group`, `Agent Name`
- `Status`, `Ticket ID`
- `Expected SLA to resolve`
- `Expected SLA to first response`
- `First response time`
- `SLA For first response`
- `SLA For Resolution`
- `Resolution time`
- `Survey results`
- `Agent interactions`
- `Close time` as a feature

`Close time` is used only to compute the regression target:
`resolution_time_hours = close_time - created_time`

## Why These Features

- `support_level` is removed to avoid training/inference mismatch (historical escalation state vs new-ticket state).
- `latitude/longitude` are removed because they are sparse/noisy and not reliable for initial triage quality in this dataset.
- SLA columns are removed because they are lifecycle outcomes and leakage-prone.
- `CRITICAL` is kept separate because merging it into `HIGH` damages class signal.

## Model Training Strategy

### Split

- train: `70%`
- validation: `15%`
- test: `15%`

Implementation:
1. `train_valid/test = 85/15`
2. `train/validation = 70/15` via relative split of `train_valid`

Stratification is attempted on priority labels for both splits and falls back safely if class counts are too small.

### Priority models compared

- `DummyClassifier` baseline
- `LogisticRegression(max_iter=2000)`
- `RandomForestClassifier`
- `HistGradientBoostingClassifier`

Selection rule:
1. highest validation macro F1
2. tie-breaker: highest validation accuracy

### Resolution-time models compared

- `DummyRegressor` baseline
- `RandomForestRegressor`
- `HistGradientBoostingRegressor`

Selection rule:
1. lowest validation RMSE
2. tie-breaker: lowest validation MAE

## Metrics and Artifacts

Saved artifacts:
- `models/priority_pipeline.pkl`
- `models/est_pipeline.pkl`
- `models/model_metadata.pkl`
- `models/metrics.json`

`metrics.json` includes:
- selected model names
- feature list and removed feature list
- train/validation/test metrics
- class distributions
- baseline comparison
- warning entries when selected model is close to baseline

## Run Locally

### 1) Install dependencies

```bash
pip install -r requirements.txt
```

### 2) Train pipelines

```bash
python -m src.train --data ITSM_Dataset.csv --model-dir models
```

### 3) Run API

```bash
uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

### 4) Open Swagger

[http://localhost:8000/docs](http://localhost:8000/docs)

## Core Endpoints

- `GET /health`
- `POST /predict`
- `POST /ai/recommendations`
- `GET /ai/insights`
- `POST /ai/suggest-category`
- `POST /ai/suggest-priority`
- `GET /ai/similar-tickets/{ticket_id}`
- `GET /ai/activity-summary/{ticket_id}`
- `POST /ai/predict-resolution`
- `GET /ai/suggested-responses/{ticket_id}`

## Example `/predict` Request

```json
{
  "title": "Major outage: all users cannot access VPN",
  "description": "Users across two branches cannot connect.",
  "type_of_request": "INCIDENT",
  "topic": "Network Issue",
  "source": "Portal",
  "product_group": "Network",
  "country": "UAE",
  "support_level": "L1",
  "latitude": 25.2048,
  "longitude": 55.2708,
  "created_at": "2026-05-11T09:30:00Z"
}
```

## Accuracy Note

Current accuracy can remain modest because this dataset does not include strong triage predictors like:
- title/description embeddings
- structured impact and urgency
- affected users count
- service criticality context

So the current model is intentionally leakage-safe, but signal-limited.
