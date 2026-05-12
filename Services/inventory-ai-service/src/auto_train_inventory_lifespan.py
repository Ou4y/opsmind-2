"""
End-to-end bootstrap for inventory lifespan training.

Pipeline:
1) Export local labelled data from inventory PostgreSQL.
2) Fetch external warm-start datasets (AI4I, NASA C-MAPSS, Backblaze Drive Stats).
3) Convert to unified training schema.
4) Merge, deduplicate, and train asset lifespan model.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import urllib.request
import zipfile
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

from src.export_lifespan_training_dataset import export_training_csv
from src.train_asset_lifespan import train


AI4I_UCI_ID = 601
CMAPSS_ZIP_URL = "https://data.nasa.gov/docs/legacy/CMAPSSData.zip"
BACKBLAZE_INDEX_URL = "https://www.backblaze.com/cloud-storage/resources/hard-drive-test-data"

TRAINING_COLUMNS = [
    "type",
    "brand",
    "model",
    "ram_gb",
    "storage_gb",
    "working_hours",
    "operational_state",
    "lifespan_years",
]


def _download_file(url: str, destination: Path, timeout_seconds: int = 120) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "OpsMindInventoryAI/1.0",
            "Accept": "*/*",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
        data = response.read()
    destination.write_bytes(data)
    return destination


def _fetch_text(url: str, timeout_seconds: int = 120) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "OpsMindInventoryAI/1.0",
            "Accept": "text/html,application/json,*/*;q=0.8",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
        return response.read().decode("utf-8", errors="ignore")


def _coerce_training_frame(df: pd.DataFrame, source_label: str) -> pd.DataFrame:
    frame = df.copy()
    for column in TRAINING_COLUMNS:
        if column not in frame.columns:
            frame[column] = np.nan

    frame = frame[TRAINING_COLUMNS].copy()
    frame["type"] = frame["type"].astype(str).str.strip().str.lower().replace({"": "unknown"})
    frame["brand"] = frame["brand"].astype(str).str.strip().str.lower().replace({"": "unknown"})
    frame["model"] = frame["model"].astype(str).str.strip().replace({"": "unknown"})
    frame["operational_state"] = (
        frame["operational_state"]
        .astype(str)
        .str.strip()
        .str.lower()
        .where(lambda s: s.isin(["online_in_use", "online_idle", "offline"]), "offline")
    )

    for numeric_col in ["ram_gb", "storage_gb", "working_hours", "lifespan_years"]:
        frame[numeric_col] = pd.to_numeric(frame[numeric_col], errors="coerce")

    frame = frame.dropna(subset=["lifespan_years"])
    frame = frame[frame["lifespan_years"] > 0]
    frame["ram_gb"] = frame["ram_gb"].fillna(0).clip(lower=0)
    frame["storage_gb"] = frame["storage_gb"].fillna(0).clip(lower=0)
    frame["working_hours"] = frame["working_hours"].fillna(0).clip(lower=0)
    frame["source_dataset"] = source_label
    return frame


def _fetch_ai4i_dataset(raw_dir: Path) -> pd.DataFrame:
    from ucimlrepo import fetch_ucirepo

    dataset = fetch_ucirepo(id=AI4I_UCI_ID)
    features = dataset.data.features.copy()
    targets = dataset.data.targets.copy()
    df = pd.concat([features, targets], axis=1)

    type_col = "Type" if "Type" in df.columns else "type"
    tool_wear_col = "Tool wear [min]" if "Tool wear [min]" in df.columns else "Tool wear"
    failure_col = "Machine failure" if "Machine failure" in df.columns else "machine failure"
    product_col = "Product ID" if "Product ID" in df.columns else "ProductID"

    quality = df[type_col].astype(str).str.upper().str[0]
    quality_ram = quality.map({"L": 8.0, "M": 16.0, "H": 32.0}).fillna(16.0)
    wear_minutes = pd.to_numeric(df[tool_wear_col], errors="coerce").fillna(0).clip(lower=0)
    failures = pd.to_numeric(df[failure_col], errors="coerce").fillna(0).clip(lower=0, upper=1)

    # Synthetic proxy lifespan in years, constrained to realistic IT ranges.
    base_years = 6.0 + quality.map({"L": -0.5, "M": 0.0, "H": 0.6}).fillna(0.0)
    lifespan_years = (base_years - (wear_minutes / 240.0) - (failures * 1.2)).clip(lower=0.5, upper=10.0)

    frame = pd.DataFrame(
        {
            "type": "maintenance_tool",
            "brand": "uci_ai4i",
            "model": df.get(product_col, pd.Series(["ai4i"] * len(df))).astype(str),
            "ram_gb": quality_ram,
            "storage_gb": np.where(quality == "H", 1024.0, np.where(quality == "M", 512.0, 256.0)),
            "working_hours": (wear_minutes / 60.0).clip(lower=0),
            "operational_state": np.where(failures > 0, "offline", "online_in_use"),
            "lifespan_years": lifespan_years,
        }
    )
    return _coerce_training_frame(frame, "ai4i_uci")


def _fetch_cmapss_dataset(raw_dir: Path) -> pd.DataFrame:
    zip_path = raw_dir / "cmapss" / "CMAPSSData.zip"
    _download_file(CMAPSS_ZIP_URL, zip_path, timeout_seconds=300)

    rows: list[dict] = []
    with zipfile.ZipFile(zip_path, "r") as zf:
        train_files = [name for name in zf.namelist() if re.match(r".*train_FD\d{3}\.txt$", name)]
        for file_name in sorted(train_files):
            with zf.open(file_name, "r") as handle:
                # 26 columns: unit id, cycle, 3 settings, 21 sensors
                df = pd.read_csv(handle, sep=r"\s+", header=None, engine="python")

            if df.empty:
                continue

            df = df.rename(columns={0: "unit", 1: "cycle"})
            last_cycle = df.groupby("unit", as_index=False)["cycle"].max()
            dataset_tag = Path(file_name).stem.replace("train_", "").lower()

            for _, row in last_cycle.iterrows():
                unit = int(row["unit"])
                cycle = float(row["cycle"])
                working_hours = cycle * 6.0
                lifespan_years = max(0.5, working_hours / (24.0 * 365.25))
                rows.append(
                    {
                        "type": "server",
                        "brand": "nasa_cmapss",
                        "model": f"{dataset_tag}_unit_{unit}",
                        "ram_gb": 32.0,
                        "storage_gb": 2048.0,
                        "working_hours": working_hours,
                        "operational_state": "offline",
                        "lifespan_years": lifespan_years,
                    }
                )

    frame = pd.DataFrame(rows)
    return _coerce_training_frame(frame, "nasa_cmapss")


def _parse_backblaze_zip_links(html: str) -> list[str]:
    pattern = r"https://f001\.backblazeb2\.com/file/Backblaze-Hard-Drive-Data/[^\s\"'>]+\.zip"
    links = re.findall(pattern, html, flags=re.IGNORECASE)
    # Preserve order while deduplicating.
    unique: list[str] = []
    seen: set[str] = set()
    for link in links:
        if link not in seen:
            seen.add(link)
            unique.append(link)
    return unique


def _download_backblaze_latest_zip(raw_dir: Path) -> Path:
    html = _fetch_text(BACKBLAZE_INDEX_URL, timeout_seconds=120)
    links = _parse_backblaze_zip_links(html)
    if not links:
        raise RuntimeError("Could not locate Backblaze ZIP links from index page")

    latest = links[0]
    filename = latest.rsplit("/", 1)[-1]
    destination = raw_dir / "backblaze" / filename
    _download_file(latest, destination, timeout_seconds=600)
    return destination


def _brand_from_drive_model(model: str) -> str:
    text = (model or "").strip().upper()
    if text.startswith("ST"):
        return "seagate"
    if text.startswith("WDC") or text.startswith("WD"):
        return "wdc"
    if text.startswith("HGST") or text.startswith("HUH"):
        return "hgst"
    if text.startswith("TOSH") or text.startswith("MG"):
        return "toshiba"
    return "backblaze"


def _iter_backblaze_failure_rows(zf: zipfile.ZipFile, max_rows: int) -> Iterable[dict]:
    count = 0
    for member in sorted(zf.namelist()):
        if not member.lower().endswith(".csv"):
            continue
        with zf.open(member, "r") as raw_file:
            wrapper = io.TextIOWrapper(raw_file, encoding="utf-8", errors="ignore")
            reader = csv.DictReader(wrapper)
            for row in reader:
                if str(row.get("failure", "0")).strip() != "1":
                    continue
                model = str(row.get("model", "")).strip()
                hours_raw = row.get("smart_9_raw")
                if not model or hours_raw is None:
                    continue
                try:
                    working_hours = float(hours_raw)
                except (TypeError, ValueError):
                    continue
                if working_hours <= 0:
                    continue
                capacity_bytes = row.get("capacity_bytes")
                try:
                    storage_gb = max(float(capacity_bytes) / 1_000_000_000.0, 0.0)
                except (TypeError, ValueError):
                    storage_gb = 1024.0

                yield {
                    "type": "server",
                    "brand": _brand_from_drive_model(model),
                    "model": model,
                    "ram_gb": 64.0,
                    "storage_gb": storage_gb,
                    "working_hours": working_hours,
                    "operational_state": "offline",
                    "lifespan_years": max(0.3, working_hours / (24.0 * 365.25)),
                }
                count += 1
                if count >= max_rows:
                    return


def _fetch_backblaze_dataset(raw_dir: Path, max_rows: int) -> pd.DataFrame:
    zip_path = _download_backblaze_latest_zip(raw_dir)
    with zipfile.ZipFile(zip_path, "r") as zf:
        rows = list(_iter_backblaze_failure_rows(zf, max_rows=max_rows))
    frame = pd.DataFrame(rows)
    return _coerce_training_frame(frame, "backblaze_drive_stats")


def _merge_frames(frames: list[pd.DataFrame], output_csv: Path) -> pd.DataFrame:
    if not frames:
        raise RuntimeError("No training frames were produced")

    merged = pd.concat(frames, ignore_index=True)
    merged = merged.dropna(subset=["lifespan_years"])
    merged = merged[merged["lifespan_years"] > 0]

    # Deduplicate exact feature-target duplicates while preserving source stats.
    merged = merged.drop_duplicates(subset=TRAINING_COLUMNS, keep="first")

    output_csv.parent.mkdir(parents=True, exist_ok=True)
    merged[TRAINING_COLUMNS].to_csv(output_csv, index=False)
    return merged


def main() -> None:
    parser = argparse.ArgumentParser(description="Auto-bootstrap and train inventory lifespan model")
    parser.add_argument("--database-url", default=None, help="Inventory PostgreSQL URL for local labelled export")
    parser.add_argument("--work-dir", default="/app/data/external_datasets", help="Workspace for downloaded datasets")
    parser.add_argument(
        "--local-training-csv",
        default="/app/data/lifespan_training_local.csv",
        help="Output path for locally exported labelled rows",
    )
    parser.add_argument(
        "--combined-training-csv",
        default="/app/data/lifespan_training.csv",
        help="Final merged training CSV path used by training",
    )
    parser.add_argument("--model-dir", default="/app/models", help="Directory to save asset_lifespan_model.pkl")
    parser.add_argument("--local-only", action="store_true", help="Train only from locally labeled lifecycle rows")
    parser.add_argument("--skip-local-export", action="store_true", help="Skip DB export step")
    parser.add_argument("--skip-ai4i", action="store_true", help="Skip AI4I UCI warm-start")
    parser.add_argument("--skip-cmapss", action="store_true", help="Skip NASA C-MAPSS warm-start")
    parser.add_argument("--skip-backblaze", action="store_true", help="Skip Backblaze warm-start")
    parser.add_argument(
        "--backblaze-max-failure-rows",
        type=int,
        default=5000,
        help="Maximum failed-drive rows to ingest from Backblaze ZIP",
    )
    args = parser.parse_args()

    if args.local_only:
        args.skip_ai4i = True
        args.skip_cmapss = True
        args.skip_backblaze = True

    work_dir = Path(args.work_dir)
    local_training_csv = Path(args.local_training_csv)
    combined_training_csv = Path(args.combined_training_csv)

    frames: list[pd.DataFrame] = []
    source_stats: dict[str, int] = {}
    source_errors: dict[str, str] = {}

    if not args.skip_local_export:
        if args.database_url:
            try:
                rows, _ = export_training_csv(
                    database_url=args.database_url,
                    output_csv=local_training_csv,
                    candidates_csv=local_training_csv.with_name("lifespan_training_candidates.csv"),
                )
                if rows > 0 and local_training_csv.exists():
                    local_df = pd.read_csv(local_training_csv)
                    local_df = _coerce_training_frame(local_df, "inventory_local")
                    frames.append(local_df)
                    source_stats["inventory_local"] = len(local_df)
                else:
                    source_stats["inventory_local"] = 0
            except Exception as exc:
                source_errors["inventory_local"] = str(exc)
        else:
            source_errors["inventory_local"] = "No --database-url provided"

    if not args.skip_ai4i:
        try:
            ai4i_df = _fetch_ai4i_dataset(work_dir)
            frames.append(ai4i_df)
            source_stats["ai4i_uci"] = len(ai4i_df)
        except Exception as exc:
            source_errors["ai4i_uci"] = str(exc)

    if not args.skip_cmapss:
        try:
            cmapss_df = _fetch_cmapss_dataset(work_dir)
            frames.append(cmapss_df)
            source_stats["nasa_cmapss"] = len(cmapss_df)
        except Exception as exc:
            source_errors["nasa_cmapss"] = str(exc)

    if not args.skip_backblaze:
        try:
            backblaze_df = _fetch_backblaze_dataset(work_dir, max_rows=max(1, args.backblaze_max_failure_rows))
            frames.append(backblaze_df)
            source_stats["backblaze_drive_stats"] = len(backblaze_df)
        except Exception as exc:
            source_errors["backblaze_drive_stats"] = str(exc)

    local_rows = int(source_stats.get("inventory_local", 0))
    if args.local_only and local_rows <= 0:
        raise RuntimeError("Local-only training requested, but no local labeled rows were exported.")
    if not frames:
        raise RuntimeError("No training frames were produced. Export local labels or enable warm-start datasets.")

    merged = _merge_frames(frames, combined_training_csv)
    model_path = train(str(combined_training_csv), args.model_dir)

    summary = {
        "combined_rows": int(len(merged)),
        "combined_training_csv": str(combined_training_csv),
        "model_path": str(model_path),
        "source_rows": source_stats,
        "source_errors": source_errors,
    }
    summary_path = combined_training_csv.with_name("lifespan_bootstrap_summary.json")
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
