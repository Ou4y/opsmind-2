from __future__ import annotations

import asyncio
from pathlib import Path

from src.config import AppSettings
from src.llm.gemini_client import GeminiClient
from src.observability import InMemoryMetrics
from src.repositories.spec_feedback_repository import SpecFeedbackRepository
from src.schemas import AssetSpecInferenceRequest
from src.services.spec_inference_service import SpecInferenceService


def _build_settings(tmp_path: Path) -> AppSettings:
    data_dir = tmp_path / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return AppSettings(
        gemini_api_key="",
        gemini_model="gemini-2.5-flash",
        data_dir=data_dir,
        model_dir=tmp_path / "models",
        spec_feedback_path=data_dir / "spec_feedback.jsonl",
        spec_golden_path=data_dir / "spec_golden_dataset.jsonl",
        spec_feedback_cache_path=data_dir / "spec_feedback_cache.json",
        spec_variant_policy_path=data_dir / "spec_variant_policy.json",
        spec_lookup_timeout_seconds=2,
        spec_http_retry_attempts=1,
        spec_http_backoff_seconds=0.01,
        spec_max_fetch_bytes=50_000,
        spec_max_search_links=3,
        spec_max_authoritative_links=2,
        serpapi_api_key="",
        spec_real_specs_only=False,
    )


def test_ssrf_guard_blocks_local_targets(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    repo = SpecFeedbackRepository(settings.spec_feedback_path, settings.spec_golden_path, settings.spec_feedback_cache_path)
    service = SpecInferenceService(settings, repo, GeminiClient("", "gemini-2.5-flash"), InMemoryMetrics())
    try:
        assert service._is_safe_external_url("http://127.0.0.1:8000") is False
        assert service._is_safe_external_url("http://localhost:8000") is False
    finally:
        asyncio.run(service.aclose())


def test_infer_fallback_has_field_confidence(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    repo = SpecFeedbackRepository(settings.spec_feedback_path, settings.spec_golden_path, settings.spec_feedback_cache_path)
    service = SpecInferenceService(settings, repo, GeminiClient("", "gemini-2.5-flash"), InMemoryMetrics())
    try:
        payload = AssetSpecInferenceRequest(type="laptop")
        result = asyncio.run(service.infer_asset_specs(payload))
        assert isinstance(result.inferred_specifications, dict)
        assert isinstance(result.field_confidence, dict)
        for field in result.inferred_specifications:
            assert field in result.field_confidence
            assert 0.0 <= float(result.field_confidence[field]) <= 1.0
    finally:
        asyncio.run(service.aclose())


def test_infer_prefers_feedback_cache(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    repo = SpecFeedbackRepository(settings.spec_feedback_path, settings.spec_golden_path, settings.spec_feedback_cache_path)
    repo.upsert_cache_entry(
        "dell | latitude 5420 | laptop",
        {
            "corrected_specifications": {"RAM": "16GB", "Storage": "512GB SSD"},
            "source_urls": ["https://dell.com/example"],
        },
    )
    service = SpecInferenceService(settings, repo, GeminiClient("", "gemini-2.5-flash"), InMemoryMetrics())
    try:
        payload = AssetSpecInferenceRequest(type="laptop", brand="Dell", model="Latitude 5420")
        result = asyncio.run(service.infer_asset_specs(payload))
        assert result.lookup_mode == "verified_feedback_cache"
        assert result.inferred_specifications.get("RAM") == "16GB"
        assert result.confidence >= 0.9
    finally:
        asyncio.run(service.aclose())
