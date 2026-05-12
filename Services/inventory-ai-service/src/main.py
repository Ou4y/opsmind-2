"""
OpsMind AI Service â€” FastAPI application.

Exposes prediction endpoints and health checks.
Swagger UI is available at ``/docs``.
"""

import logging
import os
import json
import re
import hashlib
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import AsyncGenerator
from pathlib import Path
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from src.models import get_store, load_models
from src.preprocess import INT_TO_PRIORITY, preprocess_for_inference
from src.schemas import (
    ActivitySummaryResponse,
    AssetLifespanRequest,
    AssetLifespanResponse,
    AssetSpecInferenceRequest,
    AssetSpecInferenceResponse,
    AssetSpecFeedbackRequest,
    AssetSpecFeedbackResponse,
    AssetSpecMetricsResponse,
    HealthResponse,
    PredictResolutionResponse,
    PredictionResponse,
    RecommendationItem,
    RecommendationsCountResponse,
    SLAFeedbackRequest,
    SLAPredictRequest,
    SLAPredictResponse,
    SimilarTicketsResponse,
    StatusResponse,
    SuggestCategoryRequest,
    SuggestCategoryResponse,
    SuggestPriorityRequest,
    SuggestPriorityResponse,
    TicketInput,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s â€” %(message)s",
)
logger = logging.getLogger(__name__)

APP_VERSION = "1.0.0"


SLA_RESOLUTION_TARGET_HOURS = {
    "HIGH": 4.0,
    "MEDIUM": 24.0,
    "LOW": 72.0,
}

ASSET_BRAND_FACTORS = {
    "apple": 1.14,
    "dell": 1.08,
    "hp": 1.04,
    "lenovo": 1.07,
    "cisco": 1.16,
    "ubiquiti": 1.06,
    "epson": 1.05,
    "canon": 1.04,
    "samsung": 1.05,
    "lg": 1.04,
    "acer": 0.96,
    "asus": 1.0,
    "generic": 0.9,
}

ASSET_QUALITY_FACTORS = {
    "budget": 0.86,
    "standard": 1.0,
    "premium": 1.16,
    "rugged": 1.22,
}

ASSET_STATE_FACTORS = {
    "online_in_use": 0.94,
    "online_idle": 0.99,
    "offline": 1.03,
}

BRAND_SPEC_PROFILES = {
    "apple": {"CPU Vendor": "Apple", "Storage Type": "SSD", "Display": "Retina"},
    "dell": {"CPU Vendor": "Intel", "Storage Type": "SSD"},
    "hp": {"CPU Vendor": "Intel", "Storage Type": "SSD"},
    "lenovo": {"CPU Vendor": "Intel", "Storage Type": "SSD"},
    "cisco": {"Managed": "Yes", "Rack Mount": "Yes"},
    "ubiquiti": {"Managed": "Yes", "PoE": "Supported"},
}

TYPE_SPEC_BASELINES = {
    "laptop": {"RAM": "16GB", "Storage": "512GB SSD", "OS": "Windows 11 Pro"},
    "desktop": {"RAM": "16GB", "Storage": "512GB SSD", "OS": "Windows 11 Pro"},
    "tablet": {"RAM": "8GB", "Storage": "256GB SSD", "OS": "Android/iPadOS"},
    "server": {"RAM": "32GB", "Storage": "2TB SSD", "CPU": "8-core"},
    "monitor": {"Panel": "IPS", "Refresh Rate": "60Hz", "Resolution": "1920x1080"},
    "router": {"Ports": "4", "WiFi": "WiFi 6"},
    "switch": {"Ports": "24", "Managed": "Yes"},
    "access_point": {"WiFi": "WiFi 6", "Band": "Dual-band"},
    "firewall": {"Throughput": "1Gbps", "Managed": "Yes"},
    "printer": {"Print Type": "Laser", "Duplex": "Auto"},
    "scanner": {"Scan Type": "ADF", "Resolution": "600dpi"},
    "projector": {"Brightness": "3500 ANSI", "Resolution": "1920x1080"},
}

SERPAPI_API_KEY = os.getenv("SERPAPI_API_KEY", "")
SERPAPI_ENDPOINT = os.getenv("SERPAPI_ENDPOINT", "https://serpapi.com/search.json")
SPEC_LOOKUP_TIMEOUT_SECONDS = int(os.getenv("SPEC_LOOKUP_TIMEOUT_SECONDS", "8"))
SPEC_RULE_VERSION_CONTROL = os.getenv("SPEC_RULE_VERSION_CONTROL", "spec-rules-v1")
SPEC_RULE_VERSION_CANDIDATE = os.getenv("SPEC_RULE_VERSION_CANDIDATE", "spec-rules-v2")
SPEC_AB_ROLLOUT_PERCENT = int(os.getenv("SPEC_AB_ROLLOUT_PERCENT", "20"))
SPEC_FORCE_VARIANT = os.getenv("SPEC_FORCE_VARIANT", "").strip().lower()
SPEC_VERIFICATION_CONFIDENCE_THRESHOLD = float(os.getenv("SPEC_VERIFICATION_CONFIDENCE_THRESHOLD", "0.85"))

AUTHORITATIVE_SOURCE_WEIGHTS = {
    "apple.com": 1.0,
    "dell.com": 0.99,
    "hp.com": 0.99,
    "lenovo.com": 0.99,
    "cisco.com": 0.99,
    "samsung.com": 0.97,
    "lg.com": 0.97,
    "asus.com": 0.97,
    "acer.com": 0.97,
    "microsoft.com": 0.97,
    "cdw.com": 0.9,
    "bhphotovideo.com": 0.9,
    "bestbuy.com": 0.88,
    "amazon.com": 0.84,
}

DATA_DIR = Path(os.getenv("INVENTORY_AI_DATA_DIR", "/app/data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
SPEC_FEEDBACK_PATH = DATA_DIR / "spec_feedback.jsonl"
SPEC_GOLDEN_PATH = DATA_DIR / "spec_golden_dataset.jsonl"
SPEC_FEEDBACK_CACHE_PATH = DATA_DIR / "spec_feedback_cache.json"
SPEC_FEEDBACK_CACHE: dict[str, dict] = {}


def _normalise_key(value: str | None) -> str:
    return "".join(ch for ch in str(value or "").lower() if ch.isalnum())


def _spec_number(specs: dict, keys: list[str], fallback: float = 0.0) -> float:
    normalised = {_normalise_key(k): v for k, v in (specs or {}).items()}
    for key in keys:
        value = normalised.get(_normalise_key(key))
        if value is None:
            continue
        cleaned = "".join(ch for ch in str(value) if ch.isdigit() or ch == ".")
        try:
            return float(cleaned)
        except ValueError:
            continue
    return fallback


def _infer_asset_quality(asset: AssetLifespanRequest) -> str:
    brand = _normalise_key(asset.brand)
    model = _normalise_key(asset.model)
    asset_type = _normalise_key(asset.type)
    ram_gb = _spec_number(asset.specifications, ["RAM", "Memory"])
    storage_gb = _spec_number(asset.specifications, ["Storage", "SSD", "Disk"])

    score = 50
    if brand in {"apple", "cisco"}:
        score += 20
    elif brand in {"dell", "lenovo", "hp", "samsung", "lg"}:
        score += 12
    elif brand in {"acer", "generic"}:
        score -= 8

    premium_markers = ("pro", "max", "precision", "thinkpad", "latitude", "elitebook", "zbook", "xps", "server", "enterprise", "rugged", "ultra")
    budget_markers = ("inspiron", "pavilion", "ideapad", "aspire", "basic", "entry", "mini")
    if any(marker in model for marker in premium_markers):
        score += 18
    if any(marker in model for marker in budget_markers):
        score -= 12
    if any(marker in model for marker in ("rugged", "toughbook", "industrial")):
        score += 24

    if ram_gb >= 32:
        score += 10
    elif ram_gb >= 16:
        score += 5
    elif 0 < ram_gb < 8:
        score -= 8

    if storage_gb >= 1000:
        score += 6
    elif 0 < storage_gb < 256:
        score -= 5

    if asset_type in {"server", "firewall", "switch"}:
        score += 8

    if score >= 82 or any(marker in model for marker in ("rugged", "toughbook", "industrial")):
        return "rugged"
    if score >= 66:
        return "premium"
    if score <= 42:
        return "budget"
    return "standard"


def _version_factor(model: str | None) -> float:
    import re

    match = re.search(r"\b(20\d{2}|19\d{2})\b", str(model or ""))
    if not match:
        return 1.0
    age = datetime.now(timezone.utc).year - int(match.group(1))
    if age <= 1:
        return 1.08
    if age <= 3:
        return 1.03
    if age >= 7:
        return 0.88
    return 1.0


def _predict_asset_lifespan_fallback(asset: AssetLifespanRequest) -> AssetLifespanResponse:
    quality = _infer_asset_quality(asset)
    brand_factor = ASSET_BRAND_FACTORS.get(_normalise_key(asset.brand), 1.0)
    quality_factor = ASSET_QUALITY_FACTORS.get(quality, 1.0)
    version_factor = _version_factor(asset.model)
    state_factor = ASSET_STATE_FACTORS.get(asset.operational_state, 1.0)

    base_years = asset.base_lifespan_years
    expected_lifetime_hours = max(base_years * 365 * 8, 1)
    usage_ratio = asset.working_hours / expected_lifetime_hours
    usage_factor = max(0.5, 1 - max(0.0, usage_ratio - 0.25) * 0.42)

    predicted_years = max(1.0, base_years * brand_factor * quality_factor * version_factor * state_factor * usage_factor)
    failure_risk = min(0.98, max(0.02, usage_ratio * 0.55 + (1 - usage_factor) * 0.6))

    return AssetLifespanResponse(
        predicted_lifespan_years=round(predicted_years, 1),
        quality_tier=quality,
        failure_risk=round(failure_risk, 3),
        model_version="asset-lifespan-fallback-v1",
        explanation="Estimated from brand/model/spec quality, telemetry state, and consumption-adjusted working hours.",
    )


def _predict_asset_lifespan(asset: AssetLifespanRequest) -> AssetLifespanResponse:
    store = get_store()
    quality = _infer_asset_quality(asset)

    if store.asset_lifespan_model is None:
        return _predict_asset_lifespan_fallback(asset)

    import pandas as pd

    ram_gb = _spec_number(asset.specifications, ["RAM", "Memory"])
    storage_gb = _spec_number(asset.specifications, ["Storage", "SSD", "Disk"])
    row = pd.DataFrame([{
        "type": asset.type,
        "brand": asset.brand or "",
        "model": asset.model or "",
        "ram_gb": ram_gb,
        "storage_gb": storage_gb,
        "working_hours": asset.working_hours,
        "operational_state": asset.operational_state,
    }])

    predicted_years = float(store.asset_lifespan_model.predict(row)[0])
    base = _predict_asset_lifespan_fallback(asset)
    return AssetLifespanResponse(
        predicted_lifespan_years=round(max(predicted_years, 1.0), 1),
        quality_tier=quality,
        failure_risk=base.failure_risk,
        model_version="asset-lifespan-trained-v1",
        explanation="Predicted by trained asset lifespan model using brand, model, specs, and telemetry.",
    )


def _extract_specs_from_text(text: str) -> dict[str, str]:
    specs: dict[str, str] = {}
    compact = " ".join(text.split())

    ram_match = re.search(r"\b(\d{1,3}\s?(?:GB|TB))\s*(?:RAM|Memory)\b", compact, re.IGNORECASE)
    if ram_match:
        specs["RAM"] = ram_match.group(1).upper().replace(" ", "")

    storage_match = re.search(r"\b(\d{2,4}\s?(?:GB|TB))\s*(?:SSD|HDD|NVME|Storage)\b", compact, re.IGNORECASE)
    if storage_match:
        specs["Storage"] = storage_match.group(1).upper().replace(" ", "") + " SSD"

    cpu_match = re.search(
        r"\b(Intel\s+Core\s+i[3579][-\w]*|Intel\s+Xeon[\w-]*|AMD\s+Ryzen\s+[3579][-\w]*|Apple\s+M[1-9][\w-]*)\b",
        compact,
        re.IGNORECASE,
    )
    if cpu_match:
        specs["CPU"] = cpu_match.group(1).strip()

    display_match = re.search(r"\b(\d{1,2}(?:\.\d)?)\s?(?:\"|inch|inches)\b", compact, re.IGNORECASE)
    if display_match:
        specs["Display"] = f"{display_match.group(1)} inch"

    os_match = re.search(r"\b(Windows\s+\d{1,2}(?:\s+\w+)?|Ubuntu\s+\d{2}\.\d{2}|macOS\s+\w+)\b", compact, re.IGNORECASE)
    if os_match:
        specs["OS"] = os_match.group(1).strip()

    return specs


def _extract_specs_from_jsonld(html_text: str) -> dict[str, str]:
    specs: dict[str, str] = {}
    scripts = re.findall(
        r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html_text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    for raw in scripts:
        try:
            parsed = json.loads(raw.strip())
            blocks = parsed if isinstance(parsed, list) else [parsed]
            for block in blocks:
                if not isinstance(block, dict):
                    continue
                additional = block.get("additionalProperty") or []
                if isinstance(additional, dict):
                    additional = [additional]
                for item in additional:
                    if not isinstance(item, dict):
                        continue
                    key = str(item.get("name", "")).strip()
                    value = str(item.get("value", "")).strip()
                    normalized = _normalise_key(key)
                    if not key or not value:
                        continue
                    if normalized in {"ram", "memory"}:
                        specs["RAM"] = value
                    elif normalized in {"storage", "ssd", "hdd", "harddrive"}:
                        specs["Storage"] = value
                    elif normalized in {"processor", "cpu"}:
                        specs["CPU"] = value
                    elif normalized in {"displaysize", "display", "screensize"}:
                        specs["Display"] = value
                    elif normalized in {"operatingsystem", "os"}:
                        specs["OS"] = value
        except Exception:
            continue
    return specs


def _fetch_text(url: str) -> str:
    req = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; OpsMindInventoryAI/1.0; +https://example.local)",
            "Accept-Language": "en-US,en;q=0.8",
        },
    )
    with urlopen(req, timeout=SPEC_LOOKUP_TIMEOUT_SECONDS) as response:
        content = response.read(180_000)
        return content.decode("utf-8", errors="ignore")


def _canonical_domain(url: str) -> str:
    host = urlparse(url).netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def _authoritative_weight(url: str) -> float:
    domain = _canonical_domain(url)
    for allowed, weight in AUTHORITATIVE_SOURCE_WEIGHTS.items():
        if domain == allowed or domain.endswith(f".{allowed}"):
            return weight
    return 0.0


def _is_authoritative(url: str) -> bool:
    return _authoritative_weight(url) > 0


def _jsonl_append(path: Path, row: dict) -> None:
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=True) + "\n")


def _jsonl_read(path: Path) -> list[dict]:
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


def _spec_feedback_key(payload: AssetSpecInferenceRequest) -> str:
    parts = [
        str(payload.brand or "").strip().lower(),
        str(payload.model or "").strip().lower(),
        str(payload.type or "").strip().lower(),
    ]
    if not any(parts):
        return ""
    return " | ".join(parts)


def _load_feedback_cache() -> dict[str, dict]:
    if not SPEC_FEEDBACK_CACHE_PATH.exists():
        return {}
    try:
        with SPEC_FEEDBACK_CACHE_PATH.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
            if isinstance(data, dict):
                return data
    except Exception:
        return {}
    return {}


def _spec_variant_for_payload(payload: AssetSpecInferenceRequest) -> str:
    if SPEC_FORCE_VARIANT in {"control", "candidate"}:
        return SPEC_FORCE_VARIANT

    key = "|".join(
        [
            str(payload.brand or "").lower().strip(),
            str(payload.model or "").lower().strip(),
            str(payload.name or "").lower().strip(),
            str(payload.type or "").lower().strip(),
        ]
    )
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()
    bucket = int(digest[:8], 16) % 100
    return "candidate" if bucket < max(0, min(100, SPEC_AB_ROLLOUT_PERCENT)) else "control"


def _serpapi_search_links(query: str) -> list[str]:
    if not SERPAPI_API_KEY:
        return []
    params = urlencode(
        {
            "engine": "google",
            "q": query,
            "api_key": SERPAPI_API_KEY,
            "num": 5,
            "hl": "en",
            "gl": "us",
        }
    )
    url = f"{SERPAPI_ENDPOINT}?{params}"
    raw = _fetch_text(url)
    parsed = json.loads(raw)
    results = parsed.get("organic_results") or []
    links: list[str] = []
    for item in results:
        if isinstance(item, dict) and isinstance(item.get("link"), str):
            links.append(item["link"])
    return links[:3]


def _infer_asset_specs_fallback(
    payload: AssetSpecInferenceRequest,
    *,
    variant: str = "control",
    explanation: str | None = None,
    source_urls: list[str] | None = None,
) -> AssetSpecInferenceResponse:
    normalized_type = _normalise_key(payload.type)
    normalized_brand = _normalise_key(payload.brand)
    normalized_model = _normalise_key(payload.model)
    normalized_name = _normalise_key(payload.name)

    inferred_specs: dict[str, str] = {}
    if variant == "control":
        inferred_specs.update(TYPE_SPEC_BASELINES.get(normalized_type, {}))
    inferred_specs.update(BRAND_SPEC_PROFILES.get(normalized_brand, {}))

    if any(token in normalized_model or token in normalized_name for token in ("i9", "xeon", "ultra9", "threadripper")):
        inferred_specs["CPU"] = "High-performance"
        inferred_specs["RAM"] = inferred_specs.get("RAM", "32GB")
    elif any(token in normalized_model or token in normalized_name for token in ("i7", "ryzen7", "m2pro", "m3pro")):
        inferred_specs["CPU"] = "Performance-tier"
        inferred_specs["RAM"] = inferred_specs.get("RAM", "16GB")
    elif any(token in normalized_model or token in normalized_name for token in ("i5", "ryzen5", "m2", "m3")):
        inferred_specs["CPU"] = "Balanced-tier"
    elif any(token in normalized_model or token in normalized_name for token in ("i3", "celeron", "pentium")):
        inferred_specs["CPU"] = "Entry-tier"
        inferred_specs["RAM"] = inferred_specs.get("RAM", "8GB")

    if any(token in normalized_model for token in ("1tb", "1024")):
        inferred_specs["Storage"] = "1TB SSD"
    elif any(token in normalized_model for token in ("512",)):
        inferred_specs["Storage"] = "512GB SSD"
    elif any(token in normalized_model for token in ("256",)):
        inferred_specs["Storage"] = "256GB SSD"

    if any(token in normalized_model or token in normalized_name for token in ("rugged", "toughbook", "industrial")):
        inferred_specs["Chassis"] = "Rugged"
        inferred_specs["Ingress Protection"] = "IP65"

    return AssetSpecInferenceResponse(
        inferred_specifications=inferred_specs,
        confidence=0.62 if variant == "control" and inferred_specs else (0.56 if inferred_specs else 0.25),
        source=f"inventory-ai-spec-inference-{variant}",
        explanation=explanation or "Inferred from asset type baseline plus brand/model/name heuristics.",
        source_urls=source_urls or [],
        lookup_mode="heuristic_fallback",
        rule_version=SPEC_RULE_VERSION_CONTROL if variant == "control" else SPEC_RULE_VERSION_CANDIDATE,
        variant=variant,
    )


def _infer_asset_specs(payload: AssetSpecInferenceRequest) -> AssetSpecInferenceResponse:
    variant = _spec_variant_for_payload(payload)
    active_rule_version = SPEC_RULE_VERSION_CONTROL if variant == "control" else SPEC_RULE_VERSION_CANDIDATE
    feedback_key = _spec_feedback_key(payload)
    if feedback_key and feedback_key in SPEC_FEEDBACK_CACHE:
        cached = SPEC_FEEDBACK_CACHE.get(feedback_key) or {}
        cached_specs = cached.get("corrected_specifications") or cached.get("predicted_specifications") or {}
        if isinstance(cached_specs, dict) and cached_specs:
            return AssetSpecInferenceResponse(
                inferred_specifications=cached_specs,
                confidence=0.97,
                source="inventory-ai-feedback-cache-v1",
                explanation="Matched a human-verified asset spec profile from historical corrections.",
                source_urls=list(cached.get("source_urls") or []),
                lookup_mode="verified_feedback_cache",
                rule_version=active_rule_version,
                variant=variant,
            )

    query = " ".join(
        value for value in [
            str(payload.brand or "").strip(),
            str(payload.model or "").strip(),
            str(payload.name or "").strip(),
            "specifications",
        ] if value
    )
    if not query:
        return _infer_asset_specs_fallback(payload, variant=variant)

    links: list[str] = []
    authoritative_links: list[str] = []
    extracted_candidates: list[tuple[dict[str, str], float]] = []
    try:
        links = _serpapi_search_links(query)
        authoritative_links = [link for link in links if _is_authoritative(link)]
        for link in authoritative_links:
            try:
                html = _fetch_text(link)
                from_jsonld = _extract_specs_from_jsonld(html)
                stripped = re.sub(r"<[^>]+>", " ", html)
                from_text = _extract_specs_from_text(stripped)
                combined = {**from_text, **from_jsonld}
                if combined:
                    extracted_candidates.append((combined, _authoritative_weight(link)))
            except Exception:
                continue
    except Exception as exc:
        logger.warning("Live spec lookup failed for query '%s': %s", query, exc)

    if extracted_candidates:
        merged: dict[str, str] = {}
        weighted_hits = 0.0
        weighted_total = 0.0
        for candidate, weight in extracted_candidates:
            weighted_total += max(weight, 0.0) * 5
            for key, value in candidate.items():
                merged.setdefault(key, value)
                weighted_hits += max(weight, 0.0)

        coverage_score = min(len(merged) / 5.0, 1.0)
        source_score = (weighted_hits / weighted_total) if weighted_total > 0 else 0.0
        confidence = min(0.98, max(0.35, 0.45 * coverage_score + 0.55 * source_score))
        lookup_mode = "live_catalog_lookup"
        if confidence < SPEC_VERIFICATION_CONFIDENCE_THRESHOLD:
            lookup_mode = "live_catalog_low_confidence"

        return AssetSpecInferenceResponse(
            inferred_specifications=merged,
            confidence=round(confidence, 4),
            source=f"inventory-ai-live-catalog-{variant}",
            explanation="Resolved from authoritative OEM/trusted reseller pages with weighted source confidence.",
            source_urls=authoritative_links,
            lookup_mode=lookup_mode,
            rule_version=active_rule_version,
            variant=variant,
        )

    fallback = _infer_asset_specs_fallback(
        payload,
        variant=variant,
        explanation="Live authoritative lookup did not return extractable specs; used heuristic model fallback.",
        source_urls=authoritative_links,
    )
    fallback.explanation = (
        "Live authoritative lookup did not return extractable specs; used heuristic model fallback."
    )
    fallback.rule_version = active_rule_version
    return fallback


def _metrics_from_golden_dataset(rows: list[dict]) -> AssetSpecMetricsResponse:
    fields = ["RAM", "CPU", "Storage", "Display", "OS"]
    tp = {field: 0 for field in fields}
    fp = {field: 0 for field in fields}
    fn = {field: 0 for field in fields}
    evaluated = 0

    for row in rows:
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

    precision_by_field = {}
    recall_by_field = {}
    for field in fields:
        precision_den = tp[field] + fp[field]
        recall_den = tp[field] + fn[field]
        precision_by_field[field] = round(tp[field] / precision_den, 4) if precision_den > 0 else 0.0
        recall_by_field[field] = round(tp[field] / recall_den, 4) if recall_den > 0 else 0.0

    return AssetSpecMetricsResponse(
        status="ok",
        evaluated_records=evaluated,
        fields=fields,
        precision_by_field=precision_by_field,
        recall_by_field=recall_by_field,
    )


def _normalise_priority_label(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip().upper()
    if cleaned == "CRITICAL":
        return "HIGH"
    if cleaned in {"LOW", "MEDIUM", "HIGH"}:
        return cleaned
    return None


def _ticket_dict_from_ticket_input(ticket: TicketInput) -> dict:
    ticket_data = ticket.model_dump()
    created_at = ticket_data.get("created_at")
    if isinstance(created_at, datetime):
        created_at_dt = created_at
    else:
        created_at_dt = datetime.now(timezone.utc)

    # Preprocessor expects an ISO string.
    ticket_data["created_at"] = created_at_dt.isoformat()
    return ticket_data


def _build_features(ticket_data: dict) -> "np.ndarray | object":
    store = get_store()
    return preprocess_for_inference(
        data=ticket_data,
        ohe_columns=store.ohe_columns,
        feature_names=store.feature_names,
    )


def _predict_priority(features) -> tuple[str, float]:
    store = get_store()

    predicted_priority = int(store.priority_model.predict(features)[0])
    priority_label = INT_TO_PRIORITY.get(predicted_priority, "Unknown")

    priority_confidence = 0.0
    if hasattr(store.priority_model, "predict_proba"):
        priority_proba = store.priority_model.predict_proba(features)[0]
        if hasattr(store.priority_model, "classes_"):
            classes = list(store.priority_model.classes_)
            if predicted_priority in classes:
                class_index = classes.index(predicted_priority)
            else:
                class_index = int(np.argmax(priority_proba))
        else:
            class_index = int(np.argmax(priority_proba))
        priority_confidence = round(float(priority_proba[class_index]), 4)

    return priority_label, priority_confidence


def _predict_estimated_resolution_hours(features) -> float:
    store = get_store()
    est_hours = float(store.est_model.predict(features)[0])
    return round(max(est_hours, 0.0), 2)


def _sla_probability_from_ratio(ratio: float) -> float:
    # Coarse, interpretable mapping tuned to frontend thresholds.
    if ratio >= 1.5:
        return 95.0
    if ratio >= 1.2:
        return 85.0
    if ratio >= 1.0:
        return 70.0
    if ratio >= 0.8:
        return 55.0
    if ratio >= 0.6:
        return 35.0
    return 15.0


# â”€â”€ Lifespan â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Load ML models into memory on startup."""
    global SPEC_FEEDBACK_CACHE
    try:
        load_models()
        SPEC_FEEDBACK_CACHE = _load_feedback_cache()
        store = get_store()
        if store.is_loaded or store.asset_model_loaded:
            logger.info(
                "Models loaded. ticket_models=%s asset_model=%s",
                store.is_loaded,
                store.asset_model_loaded,
            )
        else:
            logger.warning("No trained models loaded. Ticket /predict disabled; lifespan endpoint will use fallback.")
    except Exception as exc:
        logger.error("Model loading failed: %s", exc)
        logger.warning("Service starting with fallback-only behavior.")
    yield


# â”€â”€ App â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app = FastAPI(
    title="OpsMind AI Service",
    description=(
        "Microservice that predicts ticket priority and estimated resolution "
        "time for the OpsMind ITSM platform."
    ),
    version=APP_VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# â”€â”€ Endpoints â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@app.get(
    "/health",
    response_model=HealthResponse,
    tags=["Health"],
    summary="Service health check",
)
async def health() -> HealthResponse:
    """Return service status and whether models are loaded."""
    store = get_store()
    return HealthResponse(
        status="ok" if (store.is_loaded or store.asset_model_loaded) else "degraded",
        models_loaded=store.is_loaded,
        ticket_models_loaded=store.is_loaded,
        asset_model_loaded=store.asset_model_loaded,
        version=APP_VERSION,
    )


@app.post(
    "/predict",
    response_model=PredictionResponse,
    tags=["Prediction"],
    summary="Predict ticket priority and estimated resolution time",
)
async def predict(ticket: TicketInput) -> PredictionResponse:
    """Predict priority and estimated resolution time for a new ticket.

    Only fields available at ticket creation time are used.
    """
    store = get_store()

    if not store.is_loaded:
        raise HTTPException(
            status_code=503,
            detail="Models are not loaded. Please train and deploy models first.",
        )

    try:
        ticket_data = _ticket_dict_from_ticket_input(ticket)
        features = _build_features(ticket_data)

        priority_label, priority_confidence = _predict_priority(features)
        est_hours = _predict_estimated_resolution_hours(features)

        return PredictionResponse(
            suggested_priority=priority_label,
            priority_confidence=priority_confidence,
            estimated_resolution_hours=est_hours,
        )

    except Exception as exc:
        logger.exception("Prediction failed")
        raise HTTPException(status_code=500, detail=f"Prediction error: {exc}") from exc


# â”€â”€ Frontend-facing /ai/* endpoints â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@app.post(
    "/predict-asset-lifespan",
    response_model=AssetLifespanResponse,
    tags=["Prediction"],
    summary="Predict asset lifespan from asset profile and telemetry",
)
async def predict_asset_lifespan(asset: AssetLifespanRequest) -> AssetLifespanResponse:
    """Predict asset lifespan from brand/model/specs and telemetry.

    This is the contract a future trained asset model should keep. Until there
    is historical asset failure data, it uses an always-available deterministic
    fallback model.
    """
    try:
        return _predict_asset_lifespan(asset)
    except Exception as exc:
        logger.exception("Asset lifespan prediction failed")
        raise HTTPException(status_code=500, detail=f"Asset prediction error: {exc}") from exc


@app.post(
    "/infer-asset-specs",
    response_model=AssetSpecInferenceResponse,
    tags=["Prediction"],
    summary="Infer likely asset specifications from name/brand/model/type",
)
async def infer_asset_specs(payload: AssetSpecInferenceRequest) -> AssetSpecInferenceResponse:
    try:
        return _infer_asset_specs(payload)
    except Exception as exc:
        logger.exception("Asset specification inference failed")
        raise HTTPException(status_code=500, detail=f"Asset spec inference error: {exc}") from exc


@app.post(
    "/feedback/spec-verification",
    response_model=AssetSpecFeedbackResponse,
    tags=["Prediction"],
    summary="Store human verification feedback for asset specs",
)
async def spec_verification_feedback(payload: AssetSpecFeedbackRequest) -> AssetSpecFeedbackResponse:
    global SPEC_FEEDBACK_CACHE
    try:
        row = payload.model_dump()
        submitted_at = row.get("submitted_at")
        if isinstance(submitted_at, datetime):
            row["submitted_at"] = submitted_at.isoformat()
        else:
            row["submitted_at"] = submitted_at or datetime.now(timezone.utc).isoformat()
        _jsonl_append(SPEC_FEEDBACK_PATH, row)

        action = str(payload.action or "").lower().strip()
        if action in {"approve", "correct"}:
            golden_row = dict(row)
            if action == "approve" and not golden_row.get("corrected_specifications"):
                golden_row["corrected_specifications"] = dict(payload.predicted_specifications or {})
            _jsonl_append(SPEC_GOLDEN_PATH, golden_row)

            key_parts = [
                str((row.get("brand") or "")).strip().lower(),
                str((row.get("model") or "")).strip().lower(),
                str((row.get("type") or "")).strip().lower(),
            ]
            key = " | ".join(key_parts) if any(key_parts) else ""
            if not key:
                key = str(payload.asset_id).strip().lower()

            SPEC_FEEDBACK_CACHE[key] = {
                "corrected_specifications": golden_row.get("corrected_specifications") or {},
                "predicted_specifications": golden_row.get("predicted_specifications") or {},
                "source_urls": golden_row.get("source_urls") or [],
                "lookup_mode": golden_row.get("lookup_mode") or "feedback",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            with SPEC_FEEDBACK_CACHE_PATH.open("w", encoding="utf-8") as cache_file:
                json.dump(SPEC_FEEDBACK_CACHE, cache_file, ensure_ascii=True, indent=2)

        golden_size = len(_jsonl_read(SPEC_GOLDEN_PATH))
        return AssetSpecFeedbackResponse(
            status="ok",
            saved_to=str(SPEC_FEEDBACK_PATH),
            golden_dataset_size=golden_size,
        )
    except Exception as exc:
        logger.exception("Failed to persist spec verification feedback")
        raise HTTPException(status_code=500, detail=f"Spec feedback error: {exc}") from exc


@app.get(
    "/metrics/spec-inference",
    response_model=AssetSpecMetricsResponse,
    tags=["Prediction"],
    summary="Evaluate precision/recall by field from golden dataset",
)
async def spec_inference_metrics(variant: str | None = None) -> AssetSpecMetricsResponse:
    try:
        rows = _jsonl_read(SPEC_GOLDEN_PATH)
        if variant:
            filtered = []
            for row in rows:
                if str(row.get("variant", "")).lower() == str(variant).lower():
                    filtered.append(row)
            rows = filtered
        return _metrics_from_golden_dataset(rows)
    except Exception as exc:
        logger.exception("Failed to compute spec inference metrics")
        raise HTTPException(status_code=500, detail=f"Spec metrics error: {exc}") from exc


@app.get(
    "/ai/recommendations/count",
    response_model=RecommendationsCountResponse,
    tags=["AI"],
    summary="Count pending AI recommendations",
)
async def recommendations_count() -> RecommendationsCountResponse:
    # This service does not persist a recommendations queue yet.
    return RecommendationsCountResponse(count=0, pending=0)


@app.get(
    "/ai/recommendations/{ticket_id}",
    response_model=list[RecommendationItem],
    tags=["AI"],
    summary="Get AI recommendations for a ticket (by id)",
)
async def get_recommendations(ticket_id: str) -> list[RecommendationItem]:
    # Lightweight, always-available recommendations (no ticket fetch here).
    return [
        RecommendationItem(text=f"Review ticket {ticket_id} details and ensure reproduction steps are captured."),
        RecommendationItem(text="If blocked at L1, consider escalating to L2 for faster triage."),
        RecommendationItem(text="Attach logs/screenshots and recent change history to reduce back-and-forth."),
    ]


@app.post(
    "/ai/recommendations",
    response_model=list[RecommendationItem],
    tags=["AI"],
    summary="Get AI recommendations for a ticket (payload)",
)
async def get_recommendations_for_payload(ticket: TicketInput) -> list[RecommendationItem]:
    store = get_store()
    if not store.is_loaded:
        raise HTTPException(status_code=503, detail="Models are not loaded")

    ticket_data = _ticket_dict_from_ticket_input(ticket)
    features = _build_features(ticket_data)
    predicted_priority, _ = _predict_priority(features)
    est_hours = _predict_estimated_resolution_hours(features)

    recs: list[str] = []
    if predicted_priority == "HIGH":
        recs.append("High urgency detected: assign a senior technician or escalate early.")
    if predicted_priority in {"MEDIUM", "HIGH"}:
        recs.append("Start triage now: confirm impact, scope, and a reliable reproduction path.")
    if str(ticket.type_of_request).upper() == "INCIDENT":
        recs.append("Follow incident checklist: recent changes, auth/network status, and service health.")

    sla_target = SLA_RESOLUTION_TARGET_HOURS.get(predicted_priority, 24.0)
    if est_hours >= sla_target:
        recs.append("SLA breach risk: allocate resources or reroute to the right team immediately.")

    recs.append("Add clear next steps and request missing details (device/OS/app version, timestamps).")

    return [RecommendationItem(text=t) for t in recs]


@app.get(
    "/ai/insights",
    tags=["AI"],
    summary="Basic AI service insights",
)
async def insights() -> dict:
    store = get_store()
    return {
        "models_loaded": store.is_loaded,
        "feature_count": len(store.feature_names),
        "feature_names": store.feature_names,
    }


@app.post(
    "/ai/suggest-category",
    response_model=SuggestCategoryResponse,
    tags=["AI"],
    summary="Suggest a category from free-text description",
)
async def suggest_category(payload: SuggestCategoryRequest) -> SuggestCategoryResponse:
    text = payload.description.lower()
    if any(k in text for k in ["vpn", "wifi", "network", "internet"]):
        return SuggestCategoryResponse(category="NETWORK", confidence=0.65)
    if any(k in text for k in ["password", "login", "auth", "mfa"]):
        return SuggestCategoryResponse(category="ACCESS", confidence=0.6)
    if any(k in text for k in ["email", "outlook", "smtp", "imap"]):
        return SuggestCategoryResponse(category="EMAIL", confidence=0.6)
    return SuggestCategoryResponse(category="GENERAL", confidence=0.4)


@app.post(
    "/ai/suggest-priority",
    response_model=SuggestPriorityResponse,
    tags=["AI"],
    summary="Suggest a priority from subject + description",
)
async def suggest_priority(payload: SuggestPriorityRequest) -> SuggestPriorityResponse:
    text = f"{payload.subject} {payload.description}".lower()
    if any(k in text for k in ["outage", "down", "production", "critical", "sev1"]):
        return SuggestPriorityResponse(
            suggested_priority="HIGH",
            confidence=0.7,
            reasoning="Detected outage/production-impact keywords.",
        )
    if any(k in text for k in ["cannot", "unable", "fails", "error"]):
        return SuggestPriorityResponse(
            suggested_priority="MEDIUM",
            confidence=0.55,
            reasoning="Detected failure keywords with unclear scope.",
        )
    return SuggestPriorityResponse(
        suggested_priority="LOW",
        confidence=0.45,
        reasoning="No strong urgency signals detected.",
    )


@app.get(
    "/ai/similar-tickets/{ticket_id}",
    response_model=SimilarTicketsResponse,
    tags=["AI"],
    summary="Find similar tickets (placeholder)",
)
async def similar_tickets(ticket_id: str, limit: int = 5) -> SimilarTicketsResponse:
    return SimilarTicketsResponse(tickets=[])


@app.get(
    "/ai/activity-summary/{ticket_id}",
    response_model=ActivitySummaryResponse,
    tags=["AI"],
    summary="Summarize ticket activity (placeholder)",
)
async def activity_summary(ticket_id: str) -> ActivitySummaryResponse:
    return ActivitySummaryResponse(summary="No activity summary available yet.")


@app.post(
    "/ai/predict-resolution",
    response_model=PredictResolutionResponse,
    tags=["AI"],
    summary="Predict resolution time (hours)",
)
async def predict_resolution(ticket: TicketInput) -> PredictResolutionResponse:
    store = get_store()
    if not store.is_loaded:
        raise HTTPException(status_code=503, detail="Models are not loaded")

    ticket_data = _ticket_dict_from_ticket_input(ticket)
    features = _build_features(ticket_data)
    est_hours = _predict_estimated_resolution_hours(features)
    return PredictResolutionResponse(estimated_resolution_hours=est_hours)


@app.get(
    "/ai/suggested-responses/{ticket_id}",
    tags=["AI"],
    summary="Suggested response templates (placeholder)",
)
async def suggested_responses(ticket_id: str) -> list[str]:
    return [
        "Thanks for reporting this. Can you share the exact error message and when it started?",
        "Can you confirm whether this happens on multiple devices or users?",
        "We are investigating. We'll update you with next steps shortly.",
    ]


# â”€â”€ SLA risk + feedback endpoints (used by AI Insights page) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@app.post(
    "/predict-sla",
    response_model=SLAPredictResponse,
    tags=["SLA"],
    summary="Predict SLA breach probability",
)
async def predict_sla(payload: SLAPredictRequest) -> SLAPredictResponse:
    store = get_store()

    # If models are unavailable, fall back to a simple priority-based estimate.
    if not store.is_loaded:
        pr = _normalise_priority_label(payload.priority) or "MEDIUM"
        base = {"HIGH": 75.0, "MEDIUM": 45.0, "LOW": 20.0}.get(pr, 45.0)
        return SLAPredictResponse(
            sla_breach_probability=base,
            estimated_resolution_hours=None,
            sla_target_hours=SLA_RESOLUTION_TARGET_HOURS.get(pr, 24.0),
            used_priority=pr,
        )

    created_at = payload.created_at or datetime.now(timezone.utc)
    type_of_request = payload.type_of_request or "INCIDENT"
    support_level = payload.support_level or "L1"

    # Build a ticket-like payload for the shared feature pipeline.
    ticket_data = {
        "title": payload.title or "(no title)",
        "description": payload.description or "(no description)",
        "building": None,
        "room": None,
        "type_of_request": type_of_request,
        "support_level": support_level,
        "created_at": created_at.isoformat(),
    }

    features = _build_features(ticket_data)
    predicted_priority, _ = _predict_priority(features)
    est_hours = _predict_estimated_resolution_hours(features)

    requested_priority = _normalise_priority_label(payload.priority)
    used_priority = requested_priority or predicted_priority

    sla_target = SLA_RESOLUTION_TARGET_HOURS.get(used_priority, 24.0)
    ratio = (est_hours / sla_target) if sla_target > 0 else 0.0

    prob = _sla_probability_from_ratio(ratio)

    # Mild adjustments for weekends / out-of-hours.
    if created_at.weekday() >= 5:
        prob += 5.0
    if created_at.hour < 8 or created_at.hour >= 18:
        prob += 5.0

    prob = max(0.0, min(100.0, prob))

    return SLAPredictResponse(
        sla_breach_probability=round(prob, 2),
        estimated_resolution_hours=est_hours,
        sla_target_hours=sla_target,
        used_priority=used_priority,
    )


@app.post(
    "/feedback/sla",
    response_model=StatusResponse,
    tags=["SLA"],
    summary="Submit SLA prediction feedback",
)
async def submit_sla_feedback(payload: SLAFeedbackRequest) -> StatusResponse:
    logger.info(
        "Received SLA feedback",
        extra={
            "ticket_id": payload.ticket_id,
            "ai_probability": payload.ai_probability,
            "admin_decision": payload.admin_decision,
            "final_outcome": payload.final_outcome,
        },
    )
    return StatusResponse(status="ok")

