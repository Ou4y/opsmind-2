"""Validation and normalization helpers for LLM outputs."""

from __future__ import annotations

from typing import Any


def clamp_confidence(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = float(default)
    return max(0.0, min(1.0, parsed))


def should_trigger_review(confidence: float, threshold: float = 0.75) -> bool:
    return clamp_confidence(confidence) < clamp_confidence(threshold, 0.75)


def sanitize_urls(raw_urls: Any) -> list[str]:
    if not isinstance(raw_urls, list):
        return []
    clean: list[str] = []
    for item in raw_urls:
        if isinstance(item, str):
            stripped = item.strip()
            if stripped:
                clean.append(stripped)
    return clean


def sanitize_field_confidence(
    field_confidence: Any,
    inferred_specs: dict[str, Any],
    *,
    default_confidence: float,
) -> dict[str, float]:
    default_value = clamp_confidence(default_confidence)
    out: dict[str, float] = {}
    if isinstance(field_confidence, dict):
        for field, value in field_confidence.items():
            if field in inferred_specs:
                out[str(field)] = clamp_confidence(value, default_value)
    for field in inferred_specs:
        out.setdefault(str(field), default_value)
    return out
