from __future__ import annotations

from pathlib import Path

from src.repositories.spec_feedback_repository import SpecFeedbackRepository


def test_repository_atomic_cache_and_jsonl(tmp_path: Path) -> None:
    feedback_path = tmp_path / "spec_feedback.jsonl"
    golden_path = tmp_path / "spec_golden.jsonl"
    cache_path = tmp_path / "spec_feedback_cache.json"

    repo = SpecFeedbackRepository(
        feedback_path=feedback_path,
        golden_path=golden_path,
        cache_path=cache_path,
    )

    row = {"asset_id": "ASSET-1", "action": "approve"}
    repo.write_feedback(row)
    repo.write_golden({"asset_id": "ASSET-1", "predicted_specifications": {"RAM": "16GB"}})
    repo.upsert_cache_entry("dell | 5420 | laptop", {"predicted_specifications": {"RAM": "16GB"}})

    assert feedback_path.exists()
    assert golden_path.exists()
    assert cache_path.exists()
    assert repo.golden_size() == 1

    cached = repo.get_cache_entry("dell | 5420 | laptop")
    assert cached is not None
    assert cached["predicted_specifications"]["RAM"] == "16GB"
