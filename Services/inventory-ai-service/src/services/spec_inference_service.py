"""Spec inference orchestration service (Gemini + live lookup + fallback)."""

from __future__ import annotations

import anyio
import hashlib
import ipaddress
import json
import logging
import re
import socket
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse

import httpx

from src.config import AppSettings
from src.llm.client_protocol import LLMClientProtocol
from src.llm.prompts import SPEC_INFERENCE_PROMPT
from src.llm.validators import clamp_confidence, sanitize_field_confidence, sanitize_urls
from src.observability import InMemoryMetrics
from src.repositories.spec_feedback_repository import SpecFeedbackRepository
from src.schemas import (
    AssetSpecFeedbackRequest,
    AssetSpecFeedbackResponse,
    AssetSpecInferenceRequest,
    AssetSpecInferenceResponse,
    AssetSpecMetricsResponse,
)


logger = logging.getLogger(__name__)


class SpecInferenceService:
    def __init__(
        self,
        settings: AppSettings,
        repository: SpecFeedbackRepository,
        llm: LLMClientProtocol,
        metrics: InMemoryMetrics,
    ) -> None:
        self.settings = settings
        self.repository = repository
        self.llm = llm
        self.metrics = metrics
        self._http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(float(self.settings.spec_lookup_timeout_seconds)),
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=50),
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; OpsMindInventoryAI/1.1; +https://example.local)",
                "Accept-Language": "en-US,en;q=0.8",
            },
        )
        self._lookup_failures = 0
        self._lookup_circuit_open_until = 0.0

    async def aclose(self) -> None:
        await self._http_client.aclose()

    @staticmethod
    def _normalise_key(value: str | None) -> str:
        return "".join(ch for ch in str(value or "").lower() if ch.isalnum())

    @staticmethod
    def _canonical_spec_key(field: str) -> str:
        raw = str(field or "").strip()
        if not raw:
            return ""
        normalized = "".join(ch for ch in raw.lower() if ch.isalnum())
        alias_map = {
            "ram": "RAM",
            "memory": "RAM",
            "cpu": "CPU",
            "processor": "CPU",
            "storage": "Storage",
            "disk": "Storage",
            "harddrive": "Storage",
            "ssd": "Storage",
            "display": "Display",
            "screen": "Display",
            "screensize": "Display",
            "os": "OS",
            "operatingsystem": "OS",
            "cpuvendor": "CPU Vendor",
            "processorvendor": "CPU Vendor",
            "storagetype": "Storage Type",
            "disktype": "Storage Type",
            "chassis": "Chassis",
            "ingressprotection": "Ingress Protection",
            "ports": "Ports",
            "wifi": "WiFi",
            "panel": "Panel",
            "refreshrate": "Refresh Rate",
            "resolution": "Resolution",
            "printtype": "Print Type",
            "duplex": "Duplex",
            "managed": "Managed",
            "band": "Band",
            "throughput": "Throughput",
        }
        return alias_map.get(normalized, raw)

    def _normalize_specs_dict(self, specs: dict[str, Any]) -> dict[str, str]:
        out: dict[str, str] = {}
        for field, value in (specs or {}).items():
            canonical = self._canonical_spec_key(str(field))
            cleaned = str(value or "").strip()
            if canonical and cleaned:
                out[canonical] = cleaned
        return out

    @staticmethod
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

    @staticmethod
    def _canonical_domain(url: str) -> str:
        host = urlparse(url).netloc.lower()
        if host.startswith("www."):
            host = host[4:]
        return host

    def _authoritative_weight(self, url: str) -> float:
        domain = self._canonical_domain(url)
        for allowed, weight in self.settings.authoritative_source_weights.items():
            if domain == allowed or domain.endswith(f".{allowed}"):
                return weight
        return 0.0

    def _is_authoritative(self, url: str) -> bool:
        return self._authoritative_weight(url) > 0

    def _is_safe_external_url(self, url: str) -> bool:
        try:
            parsed = urlparse(url)
            if parsed.scheme not in {"http", "https"}:
                return False
            hostname = parsed.hostname
            if not hostname:
                return False
            if parsed.port and parsed.port not in {80, 443}:
                return False

            addresses = socket.getaddrinfo(hostname, parsed.port or 443, proto=socket.IPPROTO_TCP)
            if not addresses:
                return False

            for entry in addresses:
                raw_ip = entry[4][0]
                ip = ipaddress.ip_address(raw_ip)
                if (
                    ip.is_private
                    or ip.is_loopback
                    or ip.is_link_local
                    or ip.is_multicast
                    or ip.is_reserved
                    or ip.is_unspecified
                ):
                    return False
            return True
        except Exception:
            return False

    async def _fetch_text(self, url: str) -> str:
        if not self._is_safe_external_url(url):
            raise ValueError("Unsafe URL blocked by SSRF guard")

        wait = float(self.settings.spec_http_backoff_seconds)
        retries = int(self.settings.spec_http_retry_attempts)
        last_error: Exception | None = None
        for attempt in range(retries):
            try:
                response = await self._http_client.get(url, follow_redirects=False)
                if response.status_code in {429, 500, 502, 503, 504}:
                    raise httpx.HTTPStatusError(
                        f"Transient upstream status {response.status_code}",
                        request=response.request,
                        response=response,
                    )
                response.raise_for_status()
                payload = response.content[: int(self.settings.spec_max_fetch_bytes)]
                return payload.decode("utf-8", errors="ignore")
            except Exception as exc:
                last_error = exc
                if attempt + 1 < retries:
                    await anyio.sleep(wait * (2**attempt))
                continue
        raise RuntimeError(f"Failed to fetch URL after retries: {url}") from last_error

    async def _serpapi_search_links(self, query: str) -> list[str]:
        if not self.settings.serpapi_api_key:
            return []
        if time.time() < self._lookup_circuit_open_until:
            return []

        params = urlencode(
            {
                "engine": "google",
                "q": query,
                "api_key": self.settings.serpapi_api_key,
                "num": self.settings.spec_max_search_links,
                "hl": "en",
                "gl": "us",
            }
        )
        url = f"{self.settings.serpapi_endpoint}?{params}"
        try:
            raw = await self._fetch_text(url)
            parsed = json.loads(raw)
            results = parsed.get("organic_results") or []
            links: list[str] = []
            for item in results:
                link = item.get("link") if isinstance(item, dict) else None
                if isinstance(link, str):
                    links.append(link)
            self._lookup_failures = 0
            return links[: self.settings.spec_max_search_links]
        except Exception:
            self._lookup_failures += 1
            if self._lookup_failures >= self.settings.spec_lookup_circuit_failures:
                self._lookup_circuit_open_until = (
                    time.time() + self.settings.spec_lookup_circuit_reset_seconds
                )
            raise

    def _extract_specs_from_text(self, text: str) -> dict[str, str]:
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

    def _extract_specs_from_jsonld(self, html_text: str) -> dict[str, str]:
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
                        normalized = self._normalise_key(key)
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

    def _spec_feedback_key(self, payload: AssetSpecInferenceRequest) -> str:
        parts = [
            str(payload.brand or "").strip().lower(),
            str(payload.model or "").strip().lower(),
            str(payload.type or "").strip().lower(),
        ]
        if not any(parts):
            return ""
        return " | ".join(parts)

    def _policy_forced_variant(self) -> str | None:
        path = self.settings.spec_variant_policy_path
        if not path.exists():
            return None
        try:
            with path.open("r", encoding="utf-8") as handle:
                data = json.load(handle)
            force_variant = str((data or {}).get("force_variant") or "").lower()
            if force_variant in {"control", "candidate"}:
                return force_variant
        except Exception:
            return None
        return None

    def _spec_variant_for_payload(self, payload: AssetSpecInferenceRequest) -> str:
        if self.settings.spec_force_variant in {"control", "candidate"}:
            return self.settings.spec_force_variant

        forced_by_policy = self._policy_forced_variant()
        if forced_by_policy:
            return forced_by_policy

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
        return "candidate" if bucket < max(0, min(100, self.settings.spec_ab_rollout_percent)) else "control"

    async def _gemini_asset_spec_response(
        self,
        payload: AssetSpecInferenceRequest,
        variant: str,
        rule_version: str,
    ) -> AssetSpecInferenceResponse | None:
        if not self.llm.enabled:
            return None

        schema: dict[str, Any] = {
            "type": "object",
            "properties": {
                "inferred_specifications": {"type": "object"},
                "field_confidence": {"type": "object"},
                "confidence": {"type": "number"},
                "reasoning": {"type": "string"},
                "source_urls": {"type": "array", "items": {"type": "string"}},
                "lookup_mode": {"type": "string"},
            },
            "required": ["inferred_specifications", "confidence", "reasoning"],
        }
        prompt = SPEC_INFERENCE_PROMPT.format(asset_data=json.dumps(payload.model_dump(), indent=2, default=str))
        parsed = await anyio.to_thread.run_sync(self.llm.generate_json, prompt, schema, 0.2)
        if not parsed:
            return None

        inferred = parsed.get("inferred_specifications") or {}
        if not isinstance(inferred, dict) or not inferred:
            return None
        inferred = self._normalize_specs_dict(inferred)
        if not inferred:
            return None

        confidence = clamp_confidence(parsed.get("confidence"), 0.0)
        if confidence <= 0.0:
            return None

        source_urls = [url for url in sanitize_urls(parsed.get("source_urls")) if self._is_safe_external_url(url)]
        field_confidence = sanitize_field_confidence(
            parsed.get("field_confidence"),
            inferred,
            default_confidence=max(0.35, confidence * 0.9),
        )

        lookup_mode = str(parsed.get("lookup_mode") or "gemini_structured")
        if confidence < self.settings.spec_verification_confidence_threshold:
            lookup_mode = "gemini_low_confidence"

        return AssetSpecInferenceResponse(
            inferred_specifications=inferred,
            field_confidence=field_confidence,
            confidence=confidence,
            source=f"llm:{self.llm.model}",
            explanation=str(parsed.get("reasoning") or "LLM structured inference."),
            source_urls=source_urls,
            lookup_mode=lookup_mode,
            rule_version=rule_version,
            variant=variant,
        )

    def _infer_asset_specs_fallback(
        self,
        payload: AssetSpecInferenceRequest,
        *,
        variant: str = "control",
        explanation: str | None = None,
        source_urls: list[str] | None = None,
    ) -> AssetSpecInferenceResponse:
        normalized_type = self._normalise_key(payload.type)
        normalized_brand = self._normalise_key(payload.brand)
        normalized_model = self._normalise_key(payload.model)
        normalized_name = self._normalise_key(payload.name)

        inferred_specs: dict[str, str] = {}
        if variant == "control" or self.settings.spec_enable_local_model_catalog:
            inferred_specs.update(self.settings.type_spec_baselines.get(normalized_type, {}))
        inferred_specs.update(self.settings.brand_spec_profiles.get(normalized_brand, {}))

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
        elif "512" in normalized_model:
            inferred_specs["Storage"] = "512GB SSD"
        elif "256" in normalized_model:
            inferred_specs["Storage"] = "256GB SSD"

        if any(token in normalized_model or token in normalized_name for token in ("rugged", "toughbook", "industrial")):
            inferred_specs["Chassis"] = "Rugged"
            inferred_specs["Ingress Protection"] = "IP65"

        if inferred_specs:
            default_conf = 0.56 if variant == "candidate" else 0.62
            confidence = 0.35 if self.settings.spec_real_specs_only else default_conf
            field_conf = sanitize_field_confidence({}, inferred_specs, default_confidence=confidence)
        else:
            confidence = 0.2
            field_conf = {}

        return AssetSpecInferenceResponse(
            inferred_specifications=inferred_specs,
            field_confidence=field_conf,
            confidence=clamp_confidence(confidence),
            source=f"inventory-ai-spec-inference-{variant}",
            explanation=explanation or "Inferred from asset type baseline plus brand/model/name heuristics.",
            source_urls=source_urls or [],
            lookup_mode="heuristic_fallback",
            rule_version=(
                self.settings.spec_rule_version_control
                if variant == "control"
                else self.settings.spec_rule_version_candidate
            ),
            variant=variant,
        )

    def _build_live_lookup_response(
        self,
        variant: str,
        rule_version: str,
        authoritative_links: list[str],
        extracted_candidates: list[tuple[dict[str, str], float]],
    ) -> AssetSpecInferenceResponse | None:
        if not extracted_candidates:
            return None

        field_votes: dict[str, dict[str, float]] = {}
        for candidate, weight in extracted_candidates:
            w = max(weight, 0.01)
            for field, value in candidate.items():
                if field not in field_votes:
                    field_votes[field] = {}
                field_votes[field][value] = field_votes[field].get(value, 0.0) + w

        merged: dict[str, str] = {}
        field_confidence: dict[str, float] = {}
        for field, votes in field_votes.items():
            if not votes:
                continue
            best_value, best_weight = max(votes.items(), key=lambda item: item[1])
            total_weight = sum(votes.values())
            merged[field] = best_value
            field_confidence[field] = clamp_confidence(best_weight / total_weight, 0.35)

        if not merged:
            return None

        fields = ["RAM", "CPU", "Storage", "Display", "OS"]
        coverage_score = min(len([field for field in fields if field in merged]) / float(len(fields)), 1.0)
        avg_field_conf = sum(field_confidence.values()) / len(field_confidence) if field_confidence else 0.0
        confidence = clamp_confidence((0.45 * coverage_score) + (0.55 * avg_field_conf), 0.35)
        lookup_mode = "live_catalog_lookup"
        if confidence < self.settings.spec_verification_confidence_threshold:
            lookup_mode = "live_catalog_low_confidence"

        return AssetSpecInferenceResponse(
            inferred_specifications=merged,
            field_confidence=field_confidence,
            confidence=confidence,
            source=f"inventory-ai-live-catalog-{variant}",
            explanation="Resolved from authoritative OEM/trusted reseller pages with weighted source confidence.",
            source_urls=authoritative_links,
            lookup_mode=lookup_mode,
            rule_version=rule_version,
            variant=variant,
        )

    @staticmethod
    def _merge_missing_fields(primary: AssetSpecInferenceResponse, secondary: AssetSpecInferenceResponse) -> None:
        for field, value in (secondary.inferred_specifications or {}).items():
            if field not in primary.inferred_specifications:
                primary.inferred_specifications[field] = value
                fallback_conf = secondary.field_confidence.get(field, secondary.confidence)
                primary.field_confidence[field] = clamp_confidence(fallback_conf, primary.confidence * 0.8)

    async def infer_asset_specs(self, payload: AssetSpecInferenceRequest) -> AssetSpecInferenceResponse:
        started = time.perf_counter()
        variant = self._spec_variant_for_payload(payload)
        active_rule_version = (
            self.settings.spec_rule_version_control
            if variant == "control"
            else self.settings.spec_rule_version_candidate
        )
        feedback_key = self._spec_feedback_key(payload)

        if feedback_key:
            cached = self.repository.get_cache_entry(feedback_key) or {}
            cached_specs = cached.get("corrected_specifications") or cached.get("predicted_specifications") or {}
            if isinstance(cached_specs, dict) and cached_specs:
                response = AssetSpecInferenceResponse(
                    inferred_specifications=cached_specs,
                    field_confidence=sanitize_field_confidence({}, cached_specs, default_confidence=0.99),
                    confidence=0.97,
                    source="inventory-ai-feedback-cache-v1",
                    explanation="Matched a human-verified asset spec profile from historical corrections.",
                    source_urls=list(cached.get("source_urls") or []),
                    lookup_mode="verified_feedback_cache",
                    rule_version=active_rule_version,
                    variant=variant,
                )
                self.metrics.inc(
                    "inventory_ai_spec_inference_total",
                    labels={"lookup_mode": response.lookup_mode, "variant": variant},
                )
                self.metrics.observe(
                    "inventory_ai_spec_inference_seconds",
                    time.perf_counter() - started,
                    labels={"lookup_mode": response.lookup_mode, "variant": variant},
                )
                return response

        gemini_result = await self._gemini_asset_spec_response(payload, variant, active_rule_version)

        query = " ".join(
            value
            for value in [
                str(payload.brand or "").strip(),
                str(payload.model or "").strip(),
                str(payload.name or "").strip(),
                "specifications",
            ]
            if value
        )

        authoritative_links: list[str] = []
        extracted_candidates: list[tuple[dict[str, str], float]] = []
        if query:
            try:
                links = await self._serpapi_search_links(query)
                authoritative_links = [
                    link
                    for link in links
                    if self._is_authoritative(link) and self._is_safe_external_url(link)
                ][: self.settings.spec_max_authoritative_links]

                for link in authoritative_links:
                    try:
                        html = await self._fetch_text(link)
                        from_jsonld = self._extract_specs_from_jsonld(html)
                        stripped = re.sub(r"<[^>]+>", " ", html)
                        from_text = self._extract_specs_from_text(stripped)
                        combined = {**from_text, **from_jsonld}
                        if combined:
                            extracted_candidates.append((combined, self._authoritative_weight(link)))
                    except Exception:
                        continue
            except Exception as exc:
                logger.warning("Live spec lookup failed for query '%s': %s", query, exc)

        live_result = self._build_live_lookup_response(
            variant=variant,
            rule_version=active_rule_version,
            authoritative_links=authoritative_links,
            extracted_candidates=extracted_candidates,
        )

        if live_result and gemini_result:
            self._merge_missing_fields(live_result, gemini_result)
            live_result.explanation = (
                f"{live_result.explanation} Missing fields were backfilled from LLM structured inference."
            )
            response = live_result
        elif live_result:
            response = live_result
        elif gemini_result:
            if gemini_result.confidence < self.settings.spec_verification_confidence_threshold:
                fallback = self._infer_asset_specs_fallback(
                    payload,
                    variant=variant,
                    explanation=(
                        "LLM returned low-confidence output; anchored on heuristic baseline and backfilled "
                        "missing fields from LLM structured inference."
                    ),
                    source_urls=gemini_result.source_urls,
                )
                if fallback.inferred_specifications:
                    self._merge_missing_fields(fallback, gemini_result)
                    fallback.lookup_mode = "heuristic_with_llm_backfill"
                    response = fallback
                else:
                    response = gemini_result
            else:
                response = gemini_result
        else:
            response = self._infer_asset_specs_fallback(
                payload,
                variant=variant,
                explanation="No high-confidence live or LLM output; used heuristic model fallback.",
                source_urls=authoritative_links,
            )

        self.metrics.inc(
            "inventory_ai_spec_inference_total",
            labels={"lookup_mode": response.lookup_mode, "variant": variant},
        )
        self.metrics.observe(
            "inventory_ai_spec_inference_seconds",
            time.perf_counter() - started,
            labels={"lookup_mode": response.lookup_mode, "variant": variant},
        )
        return response

    def submit_feedback(self, payload: AssetSpecFeedbackRequest) -> AssetSpecFeedbackResponse:
        row = payload.model_dump()
        submitted_at = row.get("submitted_at")
        if isinstance(submitted_at, datetime):
            row["submitted_at"] = submitted_at.isoformat()
        else:
            row["submitted_at"] = submitted_at or datetime.now(timezone.utc).isoformat()
        self.repository.write_feedback(row)

        action = str(payload.action or "").lower().strip()
        if action in {"approve", "correct"}:
            golden_row = dict(row)
            if action == "approve" and not golden_row.get("corrected_specifications"):
                golden_row["corrected_specifications"] = dict(payload.predicted_specifications or {})
            self.repository.write_golden(golden_row)

            key_parts = [
                str((row.get("brand") or "")).strip().lower(),
                str((row.get("model") or "")).strip().lower(),
                str((row.get("type") or "")).strip().lower(),
            ]
            key = " | ".join(key_parts) if any(key_parts) else str(payload.asset_id).strip().lower()

            self.repository.upsert_cache_entry(
                key,
                {
                    "corrected_specifications": golden_row.get("corrected_specifications") or {},
                    "predicted_specifications": golden_row.get("predicted_specifications") or {},
                    "source_urls": golden_row.get("source_urls") or [],
                    "lookup_mode": golden_row.get("lookup_mode") or "feedback",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
            )

        self.metrics.inc("inventory_ai_spec_feedback_total", labels={"action": action or "unknown"})
        return AssetSpecFeedbackResponse(
            status="ok",
            saved_to=str(self.settings.spec_feedback_path),
            golden_dataset_size=self.repository.golden_size(),
        )

    @staticmethod
    def _metrics_from_rows(rows: list[dict]) -> AssetSpecMetricsResponse:
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

    def spec_inference_metrics(self, variant: str | None = None) -> AssetSpecMetricsResponse:
        rows = self.repository.read_golden()
        if variant:
            rows = [row for row in rows if str(row.get("variant", "")).lower() == str(variant).lower()]
        return self._metrics_from_rows(rows)
