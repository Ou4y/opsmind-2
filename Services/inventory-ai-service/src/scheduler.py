"""
Inventory AI scheduler.

Runs:
- Daily spec feedback cache rebuild + metrics snapshot
- Monthly lifespan recalibration (if training data exists)
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile


DATA_DIR = Path(os.getenv("INVENTORY_AI_DATA_DIR", "/app/data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

STATE_PATH = DATA_DIR / "scheduler_state.json"
METRICS_SNAPSHOT_PATH = DATA_DIR / "spec_metrics_latest.json"
GOLDEN_PATH = Path(os.getenv("SPEC_GOLDEN_PATH", str(DATA_DIR / "spec_golden_dataset.jsonl")))
FEEDBACK_CACHE_PATH = Path(os.getenv("SPEC_FEEDBACK_CACHE_PATH", str(DATA_DIR / "spec_feedback_cache.json")))
SPEC_VARIANT_POLICY_PATH = Path(os.getenv("SPEC_VARIANT_POLICY_PATH", str(DATA_DIR / "spec_variant_policy.json")))
LIFESPAN_TRAIN_DATA_PATH = Path(os.getenv("LIFESPAN_TRAIN_DATA_PATH", str(DATA_DIR / "lifespan_training.csv")))
LIFESPAN_MODEL_DIR = Path(os.getenv("LIFESPAN_MODEL_DIR", "/app/models"))
LIFESPAN_RECALIBRATION_METADATA_PATH = Path(
    os.getenv("LIFESPAN_RECALIBRATION_METADATA_PATH", str(DATA_DIR / "lifespan_recalibration_metadata.json"))
)

POLL_SECONDS = int(os.getenv("SCHEDULER_POLL_SECONDS", "60"))
SPEC_DAILY_HOUR_UTC = int(os.getenv("SPEC_DAILY_HOUR_UTC", "1"))
SPEC_DAILY_MINUTE_UTC = int(os.getenv("SPEC_DAILY_MINUTE_UTC", "0"))
LIFESPAN_MONTHLY_DAY_UTC = int(os.getenv("LIFESPAN_MONTHLY_DAY_UTC", "1"))
LIFESPAN_MONTHLY_HOUR_UTC = int(os.getenv("LIFESPAN_MONTHLY_HOUR_UTC", "2"))
LIFESPAN_MONTHLY_MINUTE_UTC = int(os.getenv("LIFESPAN_MONTHLY_MINUTE_UTC", "0"))
LIFECYCLE_LABELS_CSV = Path(os.getenv("LIFECYCLE_LABELS_CSV", str(DATA_DIR / "lifecycle_outcomes_labels.csv")))
INVENTORY_BACKEND_URL = os.getenv("INVENTORY_BACKEND_URL", "http://inventory-backend:5000")
INVENTORY_DATABASE_URL = os.getenv("INVENTORY_DATABASE_URL", "")
WEEKLY_RETRAIN_DAY_UTC = int(os.getenv("WEEKLY_RETRAIN_DAY_UTC", "0"))  # Monday=0 ... Sunday=6
WEEKLY_RETRAIN_HOUR_UTC = int(os.getenv("WEEKLY_RETRAIN_HOUR_UTC", "3"))
WEEKLY_RETRAIN_MINUTE_UTC = int(os.getenv("WEEKLY_RETRAIN_MINUTE_UTC", "0"))
PROXY_LABEL_WEIGHT = float(os.getenv("PROXY_LABEL_WEIGHT", "0.2"))
SPEC_PROMOTION_MIN_EVALS = int(os.getenv("SPEC_PROMOTION_MIN_EVALS", "40"))
SPEC_PROMOTION_MIN_IMPROVEMENT = float(os.getenv("SPEC_PROMOTION_MIN_IMPROVEMENT", "0.01"))


def _load_state() -> dict:
    if not STATE_PATH.exists():
        return {}
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_state(state: dict) -> None:
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=True, indent=2), encoding="utf-8")


def _atomic_write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        delete=False,
        dir=str(path.parent),
        prefix=f"{path.name}.tmp.",
        suffix=".json",
    ) as handle:
        json.dump(data, handle, ensure_ascii=True, indent=2)
        temp_path = Path(handle.name)
    temp_path.replace(path)


def _read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows: list[dict] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            raw = line.strip()
            if not raw:
                continue
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, dict):
                    rows.append(parsed)
            except json.JSONDecodeError:
                continue
    return rows


def _variant_metrics(rows: list[dict], variant: str) -> dict:
    fields = ["RAM", "CPU", "Storage", "Display", "OS"]
    tp = {field: 0 for field in fields}
    fp = {field: 0 for field in fields}
    fn = {field: 0 for field in fields}
    evaluated = 0

    for row in rows:
        if str(row.get("variant", "")).lower() != variant.lower():
            continue
        predicted = row.get("predicted_specifications") or {}
        corrected = row.get("corrected_specifications") or {}
        if not isinstance(predicted, dict) or not isinstance(corrected, dict):
            continue
        evaluated += 1
        for field in fields:
            pred_val = str(predicted.get(field, "")).strip().lower()
            true_val = str(corrected.get(field, "")).strip().lower()
            if pred_val and true_val:
                if pred_val == true_val:
                    tp[field] += 1
                else:
                    fp[field] += 1
                    fn[field] += 1
            elif pred_val and not true_val:
                fp[field] += 1
            elif true_val and not pred_val:
                fn[field] += 1

    precision = {}
    recall = {}
    for field in fields:
        pden = tp[field] + fp[field]
        rden = tp[field] + fn[field]
        precision[field] = round(tp[field] / pden, 4) if pden else 0.0
        recall[field] = round(tp[field] / rden, 4) if rden else 0.0

    return {
        "evaluated_records": evaluated,
        "precision_by_field": precision,
        "recall_by_field": recall,
    }


def _score_metrics(metrics: dict) -> float:
    precision = metrics.get("precision_by_field") or {}
    recall = metrics.get("recall_by_field") or {}
    fields = sorted(set(list(precision.keys()) + list(recall.keys())))
    if not fields:
        return 0.0
    running = 0.0
    for field in fields:
        p = float(precision.get(field, 0.0))
        r = float(recall.get(field, 0.0))
        running += ((p + r) / 2.0)
    return round(running / len(fields), 4)


def _maybe_promote_spec_variant(now: datetime, state: dict) -> None:
    rows = _read_jsonl(GOLDEN_PATH)
    control = _variant_metrics(rows, "control")
    candidate = _variant_metrics(rows, "candidate")
    control_count = int(control.get("evaluated_records", 0))
    candidate_count = int(candidate.get("evaluated_records", 0))

    promotion_payload = {
        "updated_at_utc": now.isoformat(),
        "force_variant": "",
        "reason": "",
        "control": control,
        "candidate": candidate,
        "scores": {
            "control": _score_metrics(control),
            "candidate": _score_metrics(candidate),
        },
    }

    if control_count < SPEC_PROMOTION_MIN_EVALS or candidate_count < SPEC_PROMOTION_MIN_EVALS:
        promotion_payload["reason"] = (
            f"insufficient_samples control={control_count} candidate={candidate_count} "
            f"required={SPEC_PROMOTION_MIN_EVALS}"
        )
        _atomic_write_json(SPEC_VARIANT_POLICY_PATH, promotion_payload)
        state["spec_variant_policy"] = promotion_payload
        return

    candidate_score = float(promotion_payload["scores"]["candidate"])
    control_score = float(promotion_payload["scores"]["control"])
    delta = candidate_score - control_score

    if delta >= SPEC_PROMOTION_MIN_IMPROVEMENT:
        promotion_payload["force_variant"] = "candidate"
        promotion_payload["reason"] = (
            f"candidate_outperforms_by_{delta:.4f}_threshold_{SPEC_PROMOTION_MIN_IMPROVEMENT:.4f}"
        )
    else:
        promotion_payload["force_variant"] = "control"
        promotion_payload["reason"] = (
            f"control_retained_delta_{delta:.4f}_threshold_{SPEC_PROMOTION_MIN_IMPROVEMENT:.4f}"
        )

    _atomic_write_json(SPEC_VARIANT_POLICY_PATH, promotion_payload)
    state["spec_variant_policy"] = promotion_payload


def _run_command(command: list[str]) -> tuple[int, str]:
    completed = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )
    return completed.returncode, completed.stdout


def _run_daily_spec_jobs(now: datetime, state: dict) -> None:
    print(f"[scheduler] Running daily spec jobs at {now.isoformat()}")
    code, output = _run_command(
        [
            sys.executable,
            "-m",
            "src.train_spec_feedback_cache",
            "--golden",
            str(GOLDEN_PATH),
            "--output",
            str(FEEDBACK_CACHE_PATH),
        ]
    )
    print(output.strip())
    if code != 0:
        print(f"[scheduler] train_spec_feedback_cache failed with code {code}")
        return

    code, output = _run_command(
        [
            sys.executable,
            "-m",
            "src.evaluate_spec_inference",
            "--golden",
            str(GOLDEN_PATH),
        ]
    )
    print(output.strip())
    if code != 0:
        print(f"[scheduler] evaluate_spec_inference failed with code {code}")
        return

    try:
        metrics = json.loads(output)
        metrics["generated_at_utc"] = now.isoformat()
        METRICS_SNAPSHOT_PATH.write_text(json.dumps(metrics, ensure_ascii=True, indent=2), encoding="utf-8")
    except Exception as exc:
        print(f"[scheduler] Could not write metrics snapshot: {exc}")

    try:
        _maybe_promote_spec_variant(now, state)
    except Exception as exc:
        print(f"[scheduler] Variant promotion evaluation failed: {exc}")


def _run_monthly_lifespan_recalibration(now: datetime) -> None:
    if not LIFESPAN_TRAIN_DATA_PATH.exists() or LIFESPAN_TRAIN_DATA_PATH.stat().st_size == 0:
        print(
            "[scheduler] Skipping monthly lifespan recalibration: "
            f"no training data at {LIFESPAN_TRAIN_DATA_PATH}"
        )
        return

    print(f"[scheduler] Running monthly lifespan recalibration at {now.isoformat()}")
    code, output = _run_command(
        [
            sys.executable,
            "-m",
            "src.recalibrate_lifespan_monthly",
            "--data",
            str(LIFESPAN_TRAIN_DATA_PATH),
            "--model-dir",
            str(LIFESPAN_MODEL_DIR),
            "--metadata-path",
            str(LIFESPAN_RECALIBRATION_METADATA_PATH),
        ]
    )
    print(output.strip())
    if code != 0:
        print(f"[scheduler] recalibrate_lifespan_monthly failed with code {code}")


def _run_weekly_lifecycle_training(now: datetime) -> None:
    if not INVENTORY_DATABASE_URL:
        print("[scheduler] Skipping weekly lifecycle retrain: INVENTORY_DATABASE_URL is not configured")
        return
    if not LIFECYCLE_LABELS_CSV.exists():
        print(f"[scheduler] Skipping weekly lifecycle retrain: labels CSV missing at {LIFECYCLE_LABELS_CSV}")
        return

    print(f"[scheduler] Running weekly lifecycle import/export/retrain at {now.isoformat()}")
    code, output = _run_command(
        [
            sys.executable,
            "-m",
            "src.batch_import_lifecycle_outcomes",
            "--csv",
            str(LIFECYCLE_LABELS_CSV),
            "--inventory-backend-url",
            str(INVENTORY_BACKEND_URL),
        ]
    )
    print(output.strip())
    if code != 0:
        print(f"[scheduler] batch_import_lifecycle_outcomes failed with code {code}")
        return

    code, output = _run_command(
        [
            sys.executable,
            "-m",
            "src.export_lifespan_training_dataset",
            "--database-url",
            str(INVENTORY_DATABASE_URL),
            "--output",
            str(DATA_DIR / "lifespan_training_local.csv"),
            "--candidates-output",
            str(DATA_DIR / "lifespan_training_candidates.csv"),
            "--include-proxy-labels",
            "--proxy-weight",
            str(PROXY_LABEL_WEIGHT),
        ]
    )
    print(output.strip())
    if code != 0:
        print(f"[scheduler] export_lifespan_training_dataset failed with code {code}")
        return

    code, output = _run_command(
        [
            sys.executable,
            "-m",
            "src.auto_train_inventory_lifespan",
            "--database-url",
            str(INVENTORY_DATABASE_URL),
            "--combined-training-csv",
            str(DATA_DIR / "lifespan_training.csv"),
            "--model-dir",
            str(LIFESPAN_MODEL_DIR),
            "--local-only",
            "--include-proxy-labels",
            "--proxy-weight",
            str(PROXY_LABEL_WEIGHT),
        ]
    )
    print(output.strip())
    if code != 0:
        print(f"[scheduler] auto_train_inventory_lifespan failed with code {code}")


def main() -> None:
    print("[scheduler] Inventory AI scheduler started (UTC based).")
    state = _load_state()

    while True:
        now = datetime.now(timezone.utc)

        # Daily spec jobs
        daily_key = now.strftime("%Y-%m-%d")
        if now.hour == SPEC_DAILY_HOUR_UTC and now.minute == SPEC_DAILY_MINUTE_UTC:
            if state.get("daily_spec_jobs_last_run") != daily_key:
                _run_daily_spec_jobs(now, state)
                state["daily_spec_jobs_last_run"] = daily_key
                _save_state(state)

        # Monthly lifespan recalibration
        monthly_key = now.strftime("%Y-%m")
        if (
            now.day == LIFESPAN_MONTHLY_DAY_UTC
            and now.hour == LIFESPAN_MONTHLY_HOUR_UTC
            and now.minute == LIFESPAN_MONTHLY_MINUTE_UTC
        ):
            if state.get("monthly_lifespan_jobs_last_run") != monthly_key:
                _run_monthly_lifespan_recalibration(now)
                state["monthly_lifespan_jobs_last_run"] = monthly_key
                _save_state(state)

        # Weekly lifecycle labels import + local retraining
        weekly_key = f"{now.strftime('%Y')}-W{now.isocalendar().week:02d}"
        if (
            now.weekday() == WEEKLY_RETRAIN_DAY_UTC
            and now.hour == WEEKLY_RETRAIN_HOUR_UTC
            and now.minute == WEEKLY_RETRAIN_MINUTE_UTC
        ):
            if state.get("weekly_lifecycle_jobs_last_run") != weekly_key:
                _run_weekly_lifecycle_training(now)
                state["weekly_lifecycle_jobs_last_run"] = weekly_key
                _save_state(state)

        time.sleep(max(POLL_SECONDS, 15))


if __name__ == "__main__":
    main()
