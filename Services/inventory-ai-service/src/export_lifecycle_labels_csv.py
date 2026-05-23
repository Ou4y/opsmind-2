"""
Export lifecycle outcome labels to CSV for local training import.

This script creates a small CSV that includes:
  - asset_id
  - finalOutcome (normalized: active|retired|replaced|failed|...)
  - actualLifespanYears (if available/derivable)
  - optional lifecycle dates/costs so PATCH can persist richer labels

It is intended to support the workflow:
  1) Train + label locally (via inventory-backend PATCH endpoint)
  2) Re-export labels / training dataset
  3) Train models using the updated data

Usage:
  python -m src.export_lifecycle_labels_csv \
    --database-url "postgresql://user:pass@host:5432/db" \
    --output /app/data/lifecycle_outcomes_labels.csv \
    --limit 200
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import pandas as pd
import psycopg


EXPORT_SQL = """
WITH parsed AS (
  SELECT
    a."customId" AS asset_id,
    -- Source of truth for AI training labels:
    -- - Prefer asset_lifecycle_outcomes.finalOutcome if present
    -- - Fallback to specifications.lifecycle.finalOutcome
    COALESCE(
      NULLIF(lower(o."finalOutcome"), ''),
      NULLIF(lower(a.specifications#>>'{lifecycle,finalOutcome}'), '')
    ) AS final_outcome,

    -- Prefer explicit years from asset_lifecycle_outcomes / specs.lifecycle.actualLifespanYears
    COALESCE(
      NULLIF(regexp_replace(COALESCE(o."actualLifespanYears"::text, a.specifications#>>'{lifecycle,actualLifespanYears}', ''), '[^0-9.]', '', 'g'), ''),
      NULL
    )::double precision AS actual_lifespan_years,

    o."purchaseDate" AS purchase_date,
    o."commissionedAt" AS commissioned_at,
    o."failureDate" AS failure_date,
    o."replacementDate" AS replacement_date,
    o."retiredAt" AS retired_at,
    o."failureType" AS failure_type,
    o."replacementCost" AS replacement_cost,
    o."notes" AS notes
  FROM assets a
  LEFT JOIN asset_lifecycle_outcomes o ON o."assetId" = a."customId"
)
SELECT
  asset_id,
  NULLIF(final_outcome, '') AS finalOutcome,
  actual_lifespan_years,
  purchase_date AS purchaseDate,
  commissioned_at AS commissionedAt,
  failure_date AS failureDate,
  replacement_date AS replacementDate,
  retired_at AS retiredAt,
  failure_type AS failureType,
  replacement_cost AS replacementCost,
  notes
FROM parsed
WHERE asset_id IS NOT NULL
  AND (final_outcome IS NOT NULL AND final_outcome <> '')
ORDER BY asset_id
LIMIT %s;
"""


def export_labels(database_url: str, output_csv: Path, limit: int) -> int:
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(EXPORT_SQL, (limit,))
            rows = cur.fetchall()
            columns = [desc.name for desc in cur.description]

    df = pd.DataFrame(rows, columns=columns)

    # Ensure consistent columns even if the query returns no rows
    expected_cols = [
        "asset_id",
        "finalOutcome",
        "actual_lifespan_years",
        "purchaseDate",
        "commissionedAt",
        "failureDate",
        "replacementDate",
        "retiredAt",
        "failureType",
        "replacementCost",
        "notes",
    ]
    for col in expected_cols:
        if col not in df.columns:
            df[col] = pd.NA

    # PATCH endpoint expects keys like actualLifespanYears; we keep CSV column naming aligned to JS/Python importer.
    # We'll write CSV with:
    #   actualLifespanYears column name (not actual_lifespan_years)
    if "actual_lifespan_years" in df.columns:
        df["actualLifespanYears"] = df["actual_lifespan_years"]
        df = df.drop(columns=["actual_lifespan_years"])

    output_csv.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_csv, index=False)

    return int(len(df))


def main() -> None:
    parser = argparse.ArgumentParser(description="Export lifecycle outcome labels to CSV")
    parser.add_argument(
        "--database-url",
        default=os.getenv("INVENTORY_DATABASE_URL") or os.getenv("DATABASE_URL"),
        help="Inventory PostgreSQL connection URL",
    )
    parser.add_argument(
        "--output",
        default="/app/data/lifecycle_outcomes_labels.csv",
        help="Output CSV path for lifecycle outcome labels",
    )
    parser.add_argument("--limit", type=int, default=200, help="Max rows to export")
    args = parser.parse_args()

    if not args.database_url:
        raise SystemExit("Missing --database-url (or INVENTORY_DATABASE_URL / DATABASE_URL env var)")

    count = export_labels(args.database_url, Path(args.output), args.limit)
    print(f"Exported {count} lifecycle label rows -> {args.output}")


if __name__ == "__main__":
    main()
