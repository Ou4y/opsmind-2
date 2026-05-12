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


DATA_DIR = Path(os.getenv("INVENTORY_AI_DATA_DIR", "/app/data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

STATE_PATH = DATA_DIR / "scheduler_state.json"
METRICS_SNAPSHOT_PATH = DATA_DIR / "spec_metrics_latest.json"
GOLDEN_PATH = Path(os.getenv("SPEC_GOLDEN_PATH", str(DATA_DIR / "spec_golden_dataset.jsonl")))
FEEDBACK_CACHE_PATH = Path(os.getenv("SPEC_FEEDBACK_CACHE_PATH", str(DATA_DIR / "spec_feedback_cache.json")))
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


def _load_state() -> dict:
    if not STATE_PATH.exists():
        return {}
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_state(state: dict) -> None:
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=True, indent=2), encoding="utf-8")


def _run_command(command: list[str]) -> tuple[int, str]:
    completed = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )
    return completed.returncode, completed.stdout


def _run_daily_spec_jobs(now: datetime) -> None:
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


def main() -> None:
    print("[scheduler] Inventory AI scheduler started (UTC based).")
    state = _load_state()

    while True:
        now = datetime.now(timezone.utc)

        # Daily spec jobs
        daily_key = now.strftime("%Y-%m-%d")
        if now.hour == SPEC_DAILY_HOUR_UTC and now.minute == SPEC_DAILY_MINUTE_UTC:
            if state.get("daily_spec_jobs_last_run") != daily_key:
                _run_daily_spec_jobs(now)
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

        time.sleep(max(POLL_SECONDS, 15))


if __name__ == "__main__":
    main()
