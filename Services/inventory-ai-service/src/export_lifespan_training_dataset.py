"""
Export lifespan training rows from inventory PostgreSQL into CSV files.

Primary output schema:
  type, brand, model, ram_gb, storage_gb, working_hours, operational_state, lifespan_years
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import pandas as pd
import psycopg


TRAINING_EXPORT_SQL = """
WITH parsed AS (
  SELECT
    a."customId" AS asset_id,
    lower(a."type"::text) AS type,
    COALESCE(
      NULLIF(a.specifications->>'brand', ''),
      NULLIF(a.specifications->>'Brand', ''),
      'unknown'
    ) AS brand,
    COALESCE(
      NULLIF(a.specifications->>'version', ''),
      NULLIF(a.specifications->>'Version', ''),
      NULLIF(a.specifications->>'model', ''),
      NULLIF(a.specifications->>'Model', ''),
      'unknown'
    ) AS model,
    NULLIF(
      regexp_replace(
        COALESCE(
          a.specifications->>'RAM',
          a.specifications->>'ram',
          a.specifications->>'Memory',
          a.specifications->>'memory',
          ''
        ),
        '[^0-9.]',
        '',
        'g'
      ),
      ''
    )::double precision AS ram_raw,
    COALESCE(
      a.specifications->>'Storage',
      a.specifications->>'storage',
      a.specifications->>'Disk',
      a.specifications->>'disk',
      a.specifications->>'SSD',
      a.specifications->>'ssd',
      ''
    ) AS storage_text,
    NULLIF(
      regexp_replace(
        COALESCE(
          a.specifications->>'Storage',
          a.specifications->>'storage',
          a.specifications->>'Disk',
          a.specifications->>'disk',
          a.specifications->>'SSD',
          a.specifications->>'ssd',
          ''
        ),
        '[^0-9.]',
        '',
        'g'
      ),
      ''
    )::double precision AS storage_raw,
    COALESCE(
      NULLIF(
        regexp_replace(
          COALESCE(
            a.specifications->>'workingHours',
            a.specifications->>'Working Hours',
            '0'
          ),
          '[^0-9.]',
          '',
          'g'
        ),
        ''
      )::double precision,
      0
    ) AS working_hours,
    COALESCE(
      NULLIF(lower(a.specifications->>'operationalState'), ''),
      'offline'
    ) AS operational_state,
    NULLIF(
      regexp_replace(
        COALESCE(
          o."actualLifespanYears"::text,
          a.specifications->>'lifespanYears',
          a.specifications->>'actualLifespanYears',
          a.specifications#>>'{lifecycle,actualLifespanYears}',
          ''
        ),
        '[^0-9.]',
        '',
        'g'
      ),
      ''
    )::double precision AS explicit_lifespan_years,
    o."purchaseDate" AS outcome_purchase_date,
    o."commissionedAt" AS outcome_commissioned_at,
    o."failureDate" AS outcome_failure_date,
    o."replacementDate" AS outcome_replacement_date,
    o."retiredAt" AS outcome_retired_at,
    COALESCE(NULLIF(lower(o."finalOutcome"), ''), NULLIF(lower(a.specifications#>>'{lifecycle,finalOutcome}'), '')) AS outcome_final,
    lower(a.status::text) AS status,
    a."createdAt" AS created_at,
    a."updatedAt" AS updated_at
  FROM assets a
  LEFT JOIN asset_lifecycle_outcomes o ON o."assetId" = a."customId"
),
scored AS (
  SELECT
    asset_id,
    type,
    brand,
    model,
    GREATEST(COALESCE(ram_raw, 0), 0) AS ram_gb,
    GREATEST(
      CASE
        WHEN storage_text ~* 'tb' THEN COALESCE(storage_raw, 0) * 1024
        ELSE COALESCE(storage_raw, 0)
      END,
      0
    ) AS storage_gb,
    GREATEST(COALESCE(working_hours, 0), 0) AS working_hours,
    CASE
      WHEN operational_state IN ('online_in_use', 'online_idle', 'offline') THEN operational_state
      ELSE 'offline'
    END AS operational_state,
    CASE
      WHEN explicit_lifespan_years IS NOT NULL AND explicit_lifespan_years > 0 THEN explicit_lifespan_years
      WHEN COALESCE(outcome_final, '') IN ('retired', 'replaced', 'failed')
        THEN EXTRACT(
            EPOCH FROM (
                COALESCE(outcome_replacement_date, outcome_retired_at, outcome_failure_date, updated_at, now())
                - COALESCE(outcome_commissioned_at, outcome_purchase_date, created_at)
            )
        ) / 31557600.0
      WHEN status = 'retired' THEN EXTRACT(EPOCH FROM (COALESCE(updated_at, now()) - COALESCE(outcome_commissioned_at, outcome_purchase_date, created_at))) / 31557600.0
      ELSE NULL
    END AS lifespan_years,
    status
  FROM parsed
)
SELECT
  type,
  brand,
  model,
  ram_gb,
  storage_gb,
  working_hours,
  operational_state,
  lifespan_years
FROM scored
WHERE lifespan_years IS NOT NULL
  AND lifespan_years > 0;
"""


CANDIDATES_SQL = """
WITH parsed AS (
  SELECT
    a."customId" AS asset_id,
    lower(a."type"::text) AS type,
    COALESCE(
      NULLIF(a.specifications->>'brand', ''),
      NULLIF(a.specifications->>'Brand', ''),
      'unknown'
    ) AS brand,
    COALESCE(
      NULLIF(a.specifications->>'version', ''),
      NULLIF(a.specifications->>'Version', ''),
      NULLIF(a.specifications->>'model', ''),
      NULLIF(a.specifications->>'Model', ''),
      'unknown'
    ) AS model,
    COALESCE(
      NULLIF(
        regexp_replace(
          COALESCE(
            a.specifications->>'workingHours',
            a.specifications->>'Working Hours',
            '0'
          ),
          '[^0-9.]',
          '',
          'g'
        ),
        ''
      )::double precision,
      0
    ) AS working_hours,
    lower(a.status::text) AS status,
    a."createdAt" AS created_at,
    a."updatedAt" AS updated_at,
    NULLIF(
      regexp_replace(
        COALESCE(
          o."actualLifespanYears"::text,
          a.specifications->>'lifespanYears',
          a.specifications->>'actualLifespanYears',
          a.specifications#>>'{lifecycle,actualLifespanYears}',
          ''
        ),
        '[^0-9.]',
        '',
        'g'
      ),
      ''
    )::double precision AS explicit_lifespan_years,
    o."purchaseDate" AS outcome_purchase_date,
    o."commissionedAt" AS outcome_commissioned_at,
    o."failureDate" AS outcome_failure_date,
    o."replacementDate" AS outcome_replacement_date,
    o."retiredAt" AS outcome_retired_at,
    COALESCE(NULLIF(lower(o."finalOutcome"), ''), NULLIF(lower(a.specifications#>>'{lifecycle,finalOutcome}'), '')) AS outcome_final
  FROM assets a
  LEFT JOIN asset_lifecycle_outcomes o ON o."assetId" = a."customId"
)
SELECT
  asset_id,
  type,
  brand,
  model,
  status,
  working_hours,
  created_at,
  updated_at,
  explicit_lifespan_years,
  CASE
    WHEN explicit_lifespan_years IS NOT NULL AND explicit_lifespan_years > 0 THEN 'explicit_label'
    WHEN COALESCE(outcome_final, '') IN ('retired', 'replaced', 'failed') THEN 'lifecycle_outcome_derived'
    WHEN status = 'retired' THEN 'retired_derived'
    ELSE 'unlabeled'
  END AS label_source
FROM parsed
ORDER BY created_at DESC;
"""


def _fetch_dataframe(database_url: str, sql: str) -> pd.DataFrame:
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
            rows = cur.fetchall()
            columns = [desc.name for desc in cur.description]
    return pd.DataFrame(rows, columns=columns)


def export_training_csv(database_url: str, output_csv: Path, candidates_csv: Path | None = None) -> tuple[int, int]:
    try:
        training_df = _fetch_dataframe(database_url, TRAINING_EXPORT_SQL)
    except Exception as exc:
        if "asset_lifecycle_outcomes" in str(exc):
            raise RuntimeError(
                "Lifecycle outcomes table is missing. Apply inventory-backend migrations before exporting labels."
            ) from exc
        raise
    training_df = training_df.dropna(subset=["lifespan_years"])
    training_df = training_df[training_df["lifespan_years"] > 0]

    output_csv.parent.mkdir(parents=True, exist_ok=True)
    training_df.to_csv(output_csv, index=False)

    candidate_count = 0
    if candidates_csv is not None:
        candidates_df = _fetch_dataframe(database_url, CANDIDATES_SQL)
        candidate_count = int(len(candidates_df))
        candidates_csv.parent.mkdir(parents=True, exist_ok=True)
        candidates_df.to_csv(candidates_csv, index=False)

    return int(len(training_df)), candidate_count


def main() -> None:
    parser = argparse.ArgumentParser(description="Export lifespan training CSV from inventory PostgreSQL")
    parser.add_argument(
        "--database-url",
        default=os.getenv("INVENTORY_DATABASE_URL") or os.getenv("DATABASE_URL"),
        help="Inventory PostgreSQL connection URL",
    )
    parser.add_argument(
        "--output",
        default="/app/data/lifespan_training_local.csv",
        help="Output CSV path for labelled training rows",
    )
    parser.add_argument(
        "--candidates-output",
        default="/app/data/lifespan_training_candidates.csv",
        help="Optional CSV path for all candidate assets and label-source diagnostics",
    )
    args = parser.parse_args()

    if not args.database_url:
        raise SystemExit("Missing --database-url (or INVENTORY_DATABASE_URL / DATABASE_URL env var)")

    output_csv = Path(args.output)
    candidates_csv = Path(args.candidates_output) if args.candidates_output else None
    rows, candidate_rows = export_training_csv(args.database_url, output_csv, candidates_csv)

    print(f"Exported labelled rows: {rows}")
    print(f"Saved labelled training CSV: {output_csv}")
    if candidates_csv:
        print(f"Saved candidates CSV ({candidate_rows} rows): {candidates_csv}")


if __name__ == "__main__":
    main()
