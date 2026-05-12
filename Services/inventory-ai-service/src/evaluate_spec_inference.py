"""
Evaluate spec inference quality from golden dataset.

Computes precision and recall per field.
"""

import argparse
import json
from pathlib import Path


FIELDS = ["RAM", "CPU", "Storage", "Display", "OS"]


def evaluate(path: Path) -> dict:
    tp = {field: 0 for field in FIELDS}
    fp = {field: 0 for field in FIELDS}
    fn = {field: 0 for field in FIELDS}
    evaluated = 0

    if not path.exists():
        return {"evaluated_records": 0, "precision_by_field": {}, "recall_by_field": {}}

    with path.open("r", encoding="utf-8") as handle:
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

            predicted = row.get("predicted_specifications") or {}
            corrected = row.get("corrected_specifications") or {}
            if not isinstance(predicted, dict) or not isinstance(corrected, dict):
                continue
            evaluated += 1

            for field in FIELDS:
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
    for field in FIELDS:
        pden = tp[field] + fp[field]
        rden = tp[field] + fn[field]
        precision[field] = round(tp[field] / pden, 4) if pden else 0.0
        recall[field] = round(tp[field] / rden, 4) if rden else 0.0

    return {
        "evaluated_records": evaluated,
        "precision_by_field": precision,
        "recall_by_field": recall,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate spec inference metrics from golden dataset")
    parser.add_argument("--golden", default="/app/data/spec_golden_dataset.jsonl", help="Golden dataset JSONL path")
    args = parser.parse_args()
    result = evaluate(Path(args.golden))
    print(json.dumps(result, indent=2))
