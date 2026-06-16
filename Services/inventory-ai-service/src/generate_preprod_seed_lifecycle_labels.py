"""
Generate a realistic pre-production lifecycle label CSV from current assets.

Purpose:
- Bootstrap diverse local labels before production usage starts.
- Keep outcomes non-destructive (finalOutcome=active) while providing
  plausible actualLifespanYears for training.

Output columns are compatible with:
  python -m src.batch_import_lifecycle_outcomes --csv <output>
"""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path

import pandas as pd
import psycopg


ASSET_EXPORT_SQL = """
SELECT
  a."customId" AS asset_id,
  a."name" AS asset_name,
  lower(a."type"::text) AS asset_type,
  a."createdAt" AS created_at,
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
  ) AS model
FROM assets a
WHERE a."customId" IS NOT NULL
ORDER BY a."createdAt" ASC;
"""


def _norm(value: str | None) -> str:
    return "".join(ch for ch in str(value or "").lower() if ch.isalnum())


def _base_years(asset_type: str, brand: str, model: str) -> float:
    t = _norm(asset_type)
    b = _norm(brand)
    m = _norm(model)

    if t == "laptop":
        base = 5.0
    elif t == "desktop":
        base = 5.8
    elif t == "tablet":
        base = 4.0
    elif t == "server":
        base = 7.2
    else:
        base = 5.0

    if "latitude" in m or "thinkpad" in m or "elitebook" in m:
        base += 1.1
    if "macbookpro" in m:
        base += 1.4
    if "g15" in m or "gaming" in m or "predator" in m:
        base -= 0.5

    if b in {"apple"}:
        base += 0.3
    elif b in {"dell", "lenovo", "hp"}:
        base += 0.1
    elif b in {"acer", "generic", "unknown"}:
        base -= 0.2

    return base


def _deterministic_delta(asset_id: str) -> tuple[float, str]:
    digest = hashlib.sha1(asset_id.encode("utf-8")).hexdigest()
    seed = int(digest[:8], 16)
    bucket = seed % 4
    noise = ((seed // 7) % 17 - 8) / 20.0  # [-0.4, +0.4]

    if bucket == 0:
        scenario = "healthy_long"
        delta = 0.8 + noise
    elif bucket == 1:
        scenario = "normal"
        delta = 0.2 + noise
    elif bucket == 2:
        scenario = "moderate_wear"
        delta = -0.5 + noise
    else:
        scenario = "heavy_wear"
        delta = -1.0 + noise

    return delta, scenario


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def generate_seed_csv(database_url: str, output_csv: Path, limit: int | None = None) -> int:
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(ASSET_EXPORT_SQL)
            rows = cur.fetchall()
            columns = [d.name for d in cur.description]

    assets_df = pd.DataFrame(rows, columns=columns)
    if limit is not None and limit > 0:
        assets_df = assets_df.head(limit)

    seed_rows: list[dict[str, str | float]] = []
    for row in assets_df.to_dict(orient="records"):
        asset_id = str(row.get("asset_id") or "").strip()
        if not asset_id:
            continue

        brand = str(row.get("brand") or "")
        model = str(row.get("model") or "")
        asset_type = str(row.get("asset_type") or "")
        created_at = pd.to_datetime(row.get("created_at"), errors="coerce", utc=True)

        base = _base_years(asset_type, brand, model)
        delta, scenario = _deterministic_delta(asset_id)
        lifespan_years = round(_clamp(base + delta, 2.0, 9.5), 2)

        purchase_date = ""
        commissioned_date = ""
        if pd.notna(created_at):
            purchase_date = created_at.strftime("%Y-%m-%d")
            commissioned_date = (created_at + pd.Timedelta(days=14)).strftime("%Y-%m-%d")

        seed_rows.append(
            {
                "asset_id": asset_id,
                "finalOutcome": "active",
                "actualLifespanYears": lifespan_years,
                "purchaseDate": purchase_date,
                "commissionedAt": commissioned_date,
                "failureDate": "",
                "replacementDate": "",
                "retiredAt": "",
                "failureType": "",
                "replacementCost": "",
                "notes": f"seed_preprod_v1 scenario={scenario} base={base:.2f}",
            }
        )

    output_csv.parent.mkdir(parents=True, exist_ok=True)
    out_df = pd.DataFrame(
        seed_rows,
        columns=[
            "asset_id",
            "finalOutcome",
            "actualLifespanYears",
            "purchaseDate",
            "commissionedAt",
            "failureDate",
            "replacementDate",
            "retiredAt",
            "failureType",
            "replacementCost",
            "notes",
        ],
    )
    out_df.to_csv(output_csv, index=False)
    return int(len(out_df))


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate deterministic pre-prod seed lifecycle labels CSV")
    parser.add_argument(
        "--database-url",
        default=os.getenv("INVENTORY_DATABASE_URL") or os.getenv("DATABASE_URL"),
        help="Inventory PostgreSQL connection URL",
    )
    parser.add_argument(
        "--output",
        default="/app/data/lifecycle_outcomes_labels.csv",
        help="Output CSV path (compatible with batch importer)",
    )
    parser.add_argument("--limit", type=int, default=None, help="Optional max assets to include")
    args = parser.parse_args()

    if not args.database_url:
        raise SystemExit("Missing --database-url (or INVENTORY_DATABASE_URL / DATABASE_URL env var)")

    count = generate_seed_csv(
        database_url=str(args.database_url),
        output_csv=Path(args.output),
        limit=args.limit,
    )
    print(f"Generated {count} seed lifecycle rows -> {args.output}")


if __name__ == "__main__":
    main()

