# OpsMind AI Service

Production-ready AI microservice for the OpsMind ITSM platform.  
Predicts **ticket priority** (`LOW` / `MEDIUM` / `HIGH`) and **estimated resolution time** using trained Random Forest models.

---

## Project Structure

```
ai-service/
├── src/
│   ├── main.py                  # FastAPI application & endpoints
│   ├── train.py                 # Model training script
│   ├── preprocess.py            # Feature engineering (shared)
│   ├── models.py                # Model loading & management
│   ├── schemas.py               # Pydantic request/response schemas
│   └── generate_sample_data.py  # Synthetic data generator (optional)
├── models/                      # Trained model artefacts (.pkl)
│   ├── priority_model.pkl
│   ├── est_model.pkl
│   └── model_metadata.pkl
├── ITSM_Dataset.csv             # Training data
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## Schema Alignment

The training dataset (`ITSM_Dataset.csv`) has different column names than the
production Ticket schema.  The preprocessing module handles the mapping:

| CSV Column       | Internal Name      | Notes                                    |
|------------------|--------------------|------------------------------------------|
| `Topic`          | `type_of_request`  | Categorical feature                      |
| `Support Level`  | `support_level`    | L1 / L2 / L3                             |
| `Source`         | `source`           | Chat / Email / Phone / Portal            |
| `Product group`  | `product_group`    | Cloud / Hardware / Network / Software    |
| `Country`        | `country`          | GCC countries                            |
| `Created time`   | `created_at`       | → `created_hour` + `created_weekday`     |
| `Close time`     | `closed_at`        | Used only to compute resolution target   |
| `Priority`       | `priority`         | Critical merged → HIGH (schema has 3)    |

The API accepts the exact fields the Ticket Service sends at creation time:
`title`, `description`, `building`, `room`, `type_of_request`, `support_level`, `created_at`.

Fields not in the training data (`title`, `description`, `building`, `room`) are
dropped during inference.  The model relies on `type_of_request`, `support_level`,
`created_hour`, and `created_weekday`.

## Quick Start

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Train models

```bash
python -m src.train --data ITSM_Dataset.csv --model-dir models
```

### 3. Run the service

```bash
uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
```

### 4. Open Swagger UI

Navigate to [http://localhost:8000/docs](http://localhost:8000/docs)

---

## Docker

### Build & run with Docker Compose

```bash
# Create the network if it doesn't exist
docker network create opsmind-net

# Build and start
docker compose up --build -d
```

### Build & run manually

```bash
docker build -t opsmind-ai-service .
docker run -d -p 8000:8000 --network opsmind-net --name opsmind-ai-service opsmind-ai-service
```

---

## API Reference

### `POST /predict`

**Request:**

```json
{
  "title": "VPN not connecting",
  "description": "User reports VPN client fails after update.",
  "support_level": "L1",
  "building": "Main",
  "room": "101",
  "type_of_request": "INCIDENT",
  "created_at": "2026-02-18T10:00:00"
}
```

**Response:**

```json
{
  "suggested_priority": "HIGH",
  "priority_confidence": 0.39,
  "estimated_resolution_hours": 2.36
}
```

### `GET /health`

Returns service status and whether models are loaded.

---

## Models

| Model    | Algorithm                | Target                                          |
|----------|--------------------------|--------------------------------------------------|
| Priority | RandomForestClassifier   | `priority` (LOW, MEDIUM, HIGH)                   |
| EST      | RandomForestRegressor    | `resolution_time_hours` (closed_at − created_at) |

Only ticket-creation-time fields are used as features to prevent data leakage.
