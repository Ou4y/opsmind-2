"""
Monthly lifecycle recalibration helper.

Runs lifespan model training and writes metadata snapshot for auditing.
"""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from src.train_asset_lifespan import train


def main(data_path: str, model_dir: str, metadata_path: str) -> None:
    output_path = train(data_path, model_dir)
    metadata = {
        "trained_at_utc": datetime.now(timezone.utc).isoformat(),
        "source_data": data_path,
        "model_output": output_path,
        "cadence": "monthly_recalibration",
    }
    meta_file = Path(metadata_path)
    meta_file.parent.mkdir(parents=True, exist_ok=True)
    meta_file.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(f"Saved recalibration metadata: {meta_file}")
    print(f"Saved model: {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Recalibrate asset lifespan model monthly")
    parser.add_argument("--data", required=True, help="CSV path with telemetry + failure/replacement outcomes")
    parser.add_argument("--model-dir", default="/app/models", help="Output model directory")
    parser.add_argument(
        "--metadata-path",
        default="/app/data/lifespan_recalibration_metadata.json",
        help="Metadata output path",
    )
    args = parser.parse_args()
    main(args.data, args.model_dir, args.metadata_path)
