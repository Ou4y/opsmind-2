"""
Build a feedback-driven spec cache from human-verified golden records.

Output: /app/data/spec_feedback_cache.json (or custom --output)
"""

import argparse
import json
from pathlib import Path


def _norm(value: str | None) -> str:
    return str(value or "").strip().lower()


def build_cache(golden_path: Path, output_path: Path) -> int:
    if not golden_path.exists():
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text("{}", encoding="utf-8")
        return 0

    cache: dict[str, dict] = {}
    with golden_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            raw = line.strip()
            if not raw:
                continue
            try:
                row = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(row, dict):
                continue

            key = " | ".join([_norm(row.get("brand")), _norm(row.get("model")), _norm(row.get("type"))]).strip()
            if not key:
                continue
            corrected = row.get("corrected_specifications") or row.get("predicted_specifications") or {}
            if not isinstance(corrected, dict) or not corrected:
                continue
            cache[key] = {
                "corrected_specifications": corrected,
                "predicted_specifications": row.get("predicted_specifications") or {},
                "source_urls": row.get("source_urls") or [],
                "lookup_mode": row.get("lookup_mode") or "feedback",
                "updated_at": row.get("submitted_at"),
            }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(cache, ensure_ascii=True, indent=2), encoding="utf-8")
    return len(cache)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build spec feedback cache from golden dataset")
    parser.add_argument("--golden", default="/app/data/spec_golden_dataset.jsonl", help="Golden dataset JSONL path")
    parser.add_argument("--output", default="/app/data/spec_feedback_cache.json", help="Output JSON cache path")
    args = parser.parse_args()

    count = build_cache(Path(args.golden), Path(args.output))
    print(f"Built feedback cache entries: {count}")
