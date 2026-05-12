# Inventory Backend

Inventory API for OpsMind assets, telemetry, lifecycle prediction, and AI spec governance.

## Key integration points

- Talks to `inventory-ai-service` via `INVENTORY_AI_SERVICE_URL`.
- Uses backend-mediated AI calls for observability and control.
- Stores AI traceability fields in `Asset.specifications`.

## Environment

- `DATABASE_URL`
- `RABBITMQ_URI`
- `INVENTORY_AI_SERVICE_URL` (Docker default: `http://inventory-ai-service:8000`)
- `SPEC_VERIFICATION_CONFIDENCE_THRESHOLD` (default `0.85`)

## API summary

- `GET /api/assets`
- `GET /api/assets/:id`
- `GET /api/assets/single/:id`
- `GET /api/assets/search?query=...`
- `POST /api/assets`
  - Auto-enriches specs via `inventory-ai-service`.
  - Marks low-confidence detections as `specVerificationStatus: pending`.
- `PATCH /api/assets/:id/transfer`
- `PATCH /api/assets/:id/status`
- `PATCH /api/assets/:id/details`
- `DELETE /api/assets/:id`

### AI + governance endpoints

- `POST /api/assets/:id/lifespan-prediction`
- `GET /api/assets/:id/lifecycle-outcome`
- `PATCH /api/assets/:id/lifecycle-outcome`
- `GET /api/assets/spec-verification/pending`
- `PATCH /api/assets/:id/spec-verification` (`approve | correct | reject`)
- `GET /api/assets/spec-verification/metrics` (optional `?variant=control|candidate`)

## AI trace fields saved in `specifications`

- `aiDetectedSpecs`
- `aiSpecConfidence`
- `aiSpecSource`
- `aiSpecSourceUrls`
- `aiSpecLookupMode`
- `aiSpecRuleVersion`
- `aiSpecVariant`
- `aiSpecDetectedAt`
- `specVerificationStatus`
- `specVerificationUpdatedAt`

## Lifespan training export

The inventory AI service includes a SQL template and exporter script for generating
lifespan training rows from this DB schema:

- `../inventory-ai-service/sql/export_lifespan_training.sql`
- `python -m src.export_lifespan_training_dataset` (from `inventory-ai-service`)

Example lifecycle label payload (real local outcome):

```json
{
  "purchaseDate": "2023-01-10T00:00:00Z",
  "commissionedAt": "2023-01-15T00:00:00Z",
  "failureDate": "2026-04-20T00:00:00Z",
  "replacementDate": "2026-04-30T00:00:00Z",
  "failureType": "motherboard_failure",
  "replacementCost": 1150,
  "actualLifespanYears": 3.29,
  "finalOutcome": "replaced",
  "notes": "Replaced after repeated POST failures.",
  "reviewer": "inventory-admin"
}
```
