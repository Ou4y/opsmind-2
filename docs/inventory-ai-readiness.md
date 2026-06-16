# Inventory AI Readiness Guide

This document defines the non-destructive readiness layer for production-grade Inventory AI and EOL behavior.

## What this phase adds

- Asset intelligence profile registry per asset type
- Telemetry source registry contracts
- Spec source registry contracts
- Category-specific consumption scoring rule contracts
- Dataset template pack for future data imports
- Backend readiness report endpoint:
  - `GET /api/inventory-ai/readiness`
- Optional CLI mirror:
  - `npm --prefix Services/inventory-backend run readiness:report`

No schema changes are required in this phase.

## Core rules

- LLM may reason only from real collected evidence.
- Missing telemetry must never be presented as fake `offline`.
- LLM-only or heuristic-only spec output must remain low confidence and review-required.
- Procurement recommendations must remain confidence-gated.

## Readiness endpoint output sections

- `capabilities`:
  - `specLookup`
  - `telemetry`
  - `consumption`
  - `eol`
  - `procurement`
  - `durableAiJobs`
- `registries`:
  - profile coverage
  - telemetry source coverage
  - spec source coverage
- `datasets`:
  - template file existence and required-column checks
- `environment`:
  - required/optional variable names (no values)
- `coverage`:
  - canonical table coverage counts
- `warnings` and `nextSteps`

## Future integration targets (not implemented in this phase)

- Real telemetry providers (`device_agent`, `snmp`, `mdm`, `network_controller`, `building_management_system`)
- Durable AI job orchestration with retry + DLQ
- Vendor/source connectors with credentialed fetchers
- Procurement dashboard and workflow actions

## Dataset templates

Templates are located in:

- `Services/inventory-backend/datasets/templates`

Files:

- `asset_master_data.csv`
- `verified_specs_dataset.csv`
- `lifespan_history_dataset.csv`
- `maintenance_ticket_history.csv`
- `telemetry_samples_dataset.csv`
- `procurement_vendor_dataset.csv`
- `spec_source_registry.csv`
- `asset_type_profile_dataset.csv`

## Validation checklist

1. Required columns exist exactly as defined.
2. Enum values align with registry vocab.
3. JSON columns are valid JSON.
4. URL/domain fields are sanitized and trusted.
5. Timestamps are ISO-8601.
6. Confidence values are in `[0,1]`.
