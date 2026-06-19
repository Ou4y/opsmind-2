"""
Batch-import lifecycle outcome labels into inventory-backend.

Reads a local CSV file (exported by export_lifecycle_labels_csv.py or user-provided),
then calls:

  PATCH http://<inventory-backend>/api/assets/:id/lifecycle-outcome

Expected CSV columns:
  - asset_id (required)
  - finalOutcome (required; e.g. active|retired|replaced|failed; case-insensitive)
Optional:
  - actualLifespanYears
  - purchaseDate, commissionedAt, failureDate, replacementDate, retiredAt (ISO / date strings)
  - failureType
  - replacementCost (number)
  - notes

Usage:
  python -m src.batch_import_lifecycle_outcomes \
    --csv /app/data/lifecycle_outcomes_labels.csv \
    --inventory-backend-url http://localhost:5000 \
    --limit 200 \
    --dry-run
"""

from __future__ import annotations

import argparse
import csv
import os
from pathlib import Path
from typing import Any, Dict

import urllib.request
import urllib.error
import json


def _parse_optional_float(value: str) -> float | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _clean_outcome(value: str) -> str:
    # inventory-backend normalizes, but we also clean common variants.
    v = str(value or "").strip().lower()
    if v in {"active", "running"}:
        return "active"
    if v in {"retired", "retire"}:
        return "retired"
    if v in {"replaced", "replacement"}:
        return "replaced"
    if v in {"failed", "failure"}:
        return "failed"
    return v


def _request_patch(
    url: str,
    payload: Dict[str, Any],
    *,
    timeout_seconds: int = 20,
) -> Dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="PATCH",
    )
    with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
        text = resp.read().decode("utf-8", errors="ignore")
        if not text.strip():
            return {}
        return json.loads(text)


def import_lifecycle_outcomes(
    *,
    csv_path: Path,
    inventory_backend_url: str,
    limit: int | None,
    dry_run: bool,
) -> int:
    if not csv_path.exists():
        raise SystemExit(f"CSV not found: {csv_path}")

    count = 0
    total = 0

    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise SystemExit("CSV has no header row.")

        required = {"asset_id", "finalOutcome"}
        missing = [c for c in required if c not in reader.fieldnames]
        if missing:
            raise SystemExit(f"CSV missing required columns: {missing}. Has: {reader.fieldnames}")

        for row in reader:
            total += 1
            if limit is not None and count >= limit:
                break

            asset_id = str(row.get("asset_id") or "").strip()
            final_outcome_raw = row.get("finalOutcome")
            if not asset_id:
                continue
            if final_outcome_raw is None or str(final_outcome_raw).strip() == "":
                continue

            payload: Dict[str, Any] = {
                "finalOutcome": _clean_outcome(str(final_outcome_raw)),
            }

            # Optional richer fields (only include if present)
            actual_years = _parse_optional_float(str(row.get("actualLifespanYears") or "").strip())
            if actual_years is not None:
                payload["actualLifespanYears"] = actual_years

            for key in [
                "purchaseDate",
                "commissionedAt",
                "failureDate",
                "replacementDate",
                "retiredAt",
                "failureType",
                "replacementCost",
                "notes",
            ]:
                if key not in row:
                    continue
                v = row.get(key)
                if v is None:
                    continue
                v_str = str(v).strip()
                if not v_str:
                    continue
                # numeric fields
                if key == "replacementCost":
                    num = _parse_optional_float(v_str)
                    if num is not None:
                        payload["replacementCost"] = num
                    continue
                payload[key] = v_str

            url = f"{inventory_backend_url.rstrip('/')}/api/assets/{asset_id}/lifecycle-outcome"

            if dry_run:
                print(f"[DRY-RUN] PATCH {url} payload.finalOutcome={payload['finalOutcome']}")
            else:
                resp = _request_patch(url, payload)
                # keep quiet unless failure
                if resp.get("status") != "ok":
                    print(f"Warning: unexpected response for {asset_id}: {resp}")

            count += 1

    print(f"Import complete. CSV rows={total}, imported={count}, dry_run={dry_run}")
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description="Batch import lifecycle outcomes into inventory-backend")
    parser.add_argument(
        "--csv",
        default=os.getenv("LIFECYCLE_LABELS_CSV") or "/app/data/lifecycle_outcomes_labels.csv",
        help="CSV path containing asset_id + finalOutcome (+ optional fields)",
    )
    parser.add_argument(
        "--inventory-backend-url",
        default=os.getenv("INVENTORY_BACKEND_URL") or "http://localhost:5000",
        help="Base URL for inventory-backend (no trailing slash)",
    )
    parser.add_argument("--limit", type=int, default=None, help="Optional max rows to import")
    parser.add_argument("--dry-run", action="store_true", help="Print PATCH calls without executing them")
    args = parser.parse_args()

    import_lifecycle_outcomes(
        csv_path=Path(args.csv),
        inventory_backend_url=str(args.inventory_backend_url),
        limit=args.limit,
        dry_run=bool(args.dry_run),
    )


if __name__ == "__main__":
    main()
