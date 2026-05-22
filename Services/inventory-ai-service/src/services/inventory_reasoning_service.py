"""Gemma-assisted inventory normalization/sanity/explanation helpers.

These helpers are deterministic-first and only use LLM for safe reasoning polish.
"""

from __future__ import annotations

import json
from typing import Any

import anyio

from src.config import AppSettings
from src.llm.client_protocol import LLMClientProtocol
from src.llm.prompts import (
    EOL_EXPLANATION_PROMPT,
    SPEC_NORMALIZATION_PROMPT,
    SPEC_SANITY_PROMPT,
)
from src.llm.validators import clamp_confidence
from src.schemas import (
    EolExplanationRequest,
    EolExplanationResponse,
    SpecNormalizationRequest,
    SpecNormalizationResponse,
    SpecSanityCheckRequest,
    SpecSanityCheckResponse,
)


FURNITURE_TYPES = {
    "desk",
    "chair",
    "filing_cabinet",
    "whiteboard",
    "furniture",
}

IT_ONLY_FIELDS = {
    "ram",
    "memory",
    "cpu",
    "processor",
    "storage",
    "os",
    "operatingsystem",
    "gpu",
    "wifi",
    "ethernet",
}


class InventoryReasoningService:
    def __init__(self, settings: AppSettings, llm: LLMClientProtocol) -> None:
        self.settings = settings
        self.llm = llm

    @staticmethod
    def _norm(value: Any) -> str:
        return "".join(ch for ch in str(value or "").lower() if ch.isalnum())

    @staticmethod
    def _parse_specs_text(raw_specs_text: str) -> dict[str, str]:
        parsed: dict[str, str] = {}
        for raw_line in str(raw_specs_text or "").splitlines():
            line = str(raw_line or "").strip()
            if not line:
                continue
            sep = line.find(":")
            if sep <= 0:
                continue
            key = line[:sep].strip()
            value = line[sep + 1 :].strip()
            if key and value:
                parsed[key] = value
        return parsed

    @staticmethod
    def _format_specs(specs: dict[str, str]) -> str:
        return "\n".join(
            f"{key}: {value}"
            for key, value in specs.items()
            if str(key).strip() and str(value).strip()
        )

    @staticmethod
    def _canonical_field_name(field: str) -> str:
        raw = str(field or "").strip()
        if not raw:
            return ""
        key = "".join(ch for ch in raw.lower() if ch.isalnum())
        aliases = {
            "ram": "RAM",
            "memory": "RAM",
            "cpu": "CPU",
            "processor": "Processor/Chip",
            "chip": "Processor/Chip",
            "storage": "Storage",
            "disk": "Storage",
            "operatingsystem": "OS",
            "os": "OS",
            "serialnumber": "Serial Number",
        }
        return aliases.get(key, raw)

    def _llm_json(self, prompt: str, schema: dict[str, Any], temperature: float = 0.1) -> dict[str, Any] | None:
        if not self.llm.enabled:
            return None
        return self.llm.generate_json(prompt, schema, temperature)

    async def normalize_specs(self, payload: SpecNormalizationRequest) -> SpecNormalizationResponse:
        parsed_specs = self._parse_specs_text(payload.raw_specs_text)
        for key, value in (payload.current_specs or {}).items():
            safe_key = str(key or "").strip()
            safe_value = str(value or "").strip()
            if safe_key and safe_value and safe_key not in parsed_specs:
                parsed_specs[safe_key] = safe_value

        normalized: dict[str, str] = {}
        for key, value in parsed_specs.items():
            canonical = self._canonical_field_name(key)
            if canonical and str(value).strip():
                normalized[canonical] = str(value).strip()

        expected_by_norm = {
            self._norm(field): str(field)
            for field in (payload.expected_fields or [])
            if str(field).strip()
        }
        not_applicable = {
            self._norm(field)
            for field in (payload.not_applicable_fields or [])
            if str(field).strip()
        }

        invalid_fields: list[str] = []
        warnings: list[str] = []

        filtered: dict[str, str] = {}
        for field, value in normalized.items():
            norm_key = self._norm(field)
            if not_applicable and norm_key in not_applicable:
                invalid_fields.append(field)
                continue
            if expected_by_norm and norm_key not in expected_by_norm:
                invalid_fields.append(field)
                continue
            filtered[expected_by_norm.get(norm_key, field)] = value
        normalized = filtered

        missing_important_fields: list[str] = []
        if expected_by_norm:
            for norm_key, pretty_field in expected_by_norm.items():
                if norm_key not in {self._norm(key) for key in normalized.keys()}:
                    missing_important_fields.append(pretty_field)

        normalized_brand = self._norm(payload.brand)
        normalized_model = self._norm(payload.model)
        normalized_type = self._norm(payload.asset_type)

        if normalized_type in FURNITURE_TYPES:
            for field in list(normalized.keys()):
                if self._norm(field) in IT_ONLY_FIELDS:
                    invalid_fields.append(field)
                    normalized.pop(field, None)
            if invalid_fields:
                warnings.append("IT hardware fields were removed because they are not applicable for this asset type.")

        if (
            (("macbook" in normalized_brand) or ("apple" in normalized_brand) or ("macbook" in normalized_model))
            and "os" in {self._norm(key) for key in normalized.keys()}
        ):
            os_key = next((key for key in normalized.keys() if self._norm(key) == "os"), "OS")
            os_value = str(normalized.get(os_key, "")).lower()
            if "windows" in os_value:
                warnings.append("Suspicious OS for Apple/MacBook. Please verify exact model/year and installed OS.")

        confidence = 0.62 if normalized else 0.45
        llm_used = False

        schema = {
            "type": "object",
            "properties": {
                "normalized_specs": {"type": "object"},
                "invalid_fields": {"type": "array", "items": {"type": "string"}},
                "missing_important_fields": {"type": "array", "items": {"type": "string"}},
                "warnings": {"type": "array", "items": {"type": "string"}},
                "confidence": {"type": "number"},
            },
            "required": ["normalized_specs", "invalid_fields", "missing_important_fields", "warnings", "confidence"],
        }
        prompt_payload = {
            "asset_type": payload.asset_type,
            "brand": payload.brand,
            "model": payload.model,
            "raw_specs_text": payload.raw_specs_text,
            "current_normalized_specs": normalized,
            "expected_fields": payload.expected_fields,
            "not_applicable_fields": payload.not_applicable_fields,
        }
        parsed = None
        if self.llm.enabled:
            parsed = await anyio.to_thread.run_sync(
                self._llm_json,
                SPEC_NORMALIZATION_PROMPT.format(payload_json=json.dumps(prompt_payload, ensure_ascii=False)),
                schema,
                0.1,
            )

        if isinstance(parsed, dict):
            llm_specs = parsed.get("normalized_specs") or {}
            if isinstance(llm_specs, dict):
                safe_llm_specs: dict[str, str] = {}
                base_norm_keys = {self._norm(key) for key in normalized.keys()}
                for key, value in llm_specs.items():
                    safe_key = self._canonical_field_name(str(key))
                    safe_value = str(value or "").strip()
                    if not safe_key or not safe_value:
                        continue
                    safe_norm_key = self._norm(safe_key)
                    # Guard against hallucinated fields: only allow existing fields or explicit expected fields.
                    if base_norm_keys and safe_norm_key not in base_norm_keys and safe_norm_key not in expected_by_norm:
                        continue
                    safe_llm_specs[expected_by_norm.get(safe_norm_key, safe_key)] = safe_value
                if safe_llm_specs:
                    normalized = safe_llm_specs
                    llm_used = True

            for field in parsed.get("invalid_fields") or []:
                safe = str(field or "").strip()
                if safe and safe not in invalid_fields:
                    invalid_fields.append(safe)
            for warning in parsed.get("warnings") or []:
                safe = str(warning or "").strip()
                if safe and safe not in warnings:
                    warnings.append(safe)
            llm_conf = clamp_confidence(parsed.get("confidence"), confidence)
            confidence = max(confidence, min(llm_conf, 0.9))

        normalized_text = self._format_specs(normalized)
        return SpecNormalizationResponse(
            normalized_specs=normalized,
            normalized_specs_text=normalized_text,
            invalid_fields=invalid_fields,
            missing_important_fields=missing_important_fields,
            warnings=warnings,
            confidence=clamp_confidence(confidence, 0.4),
            llm_used=llm_used,
        )

    async def check_spec_sanity(self, payload: SpecSanityCheckRequest) -> SpecSanityCheckResponse:
        warnings: list[str] = []
        suspicious_fields: list[str] = []
        suggested_fixes: list[str] = []

        normalized_type = self._norm(payload.asset_type)
        normalized_brand = self._norm(payload.brand)
        normalized_model = self._norm(payload.model)
        expected = {self._norm(field) for field in (payload.expected_fields or []) if str(field).strip()}
        not_applicable = {self._norm(field) for field in (payload.not_applicable_fields or []) if str(field).strip()}

        specs = payload.normalized_specs or {}
        for field, value in specs.items():
            field_norm = self._norm(field)
            value_text = str(value or "").strip()
            if not field_norm:
                continue
            if not_applicable and field_norm in not_applicable:
                suspicious_fields.append(field)
                warnings.append(f"{field} is not applicable for asset type {payload.asset_type}.")
                suggested_fixes.append(f"Remove {field} or replace with an applicable field.")
            if expected and field_norm not in expected:
                suspicious_fields.append(field)
                warnings.append(f"{field} is outside expected spec fields for this asset type.")
                suggested_fixes.append(f"Verify whether {field} should be present for this asset type.")
            if normalized_type in FURNITURE_TYPES and field_norm in IT_ONLY_FIELDS:
                suspicious_fields.append(field)
                warnings.append(f"{field} looks invalid for furniture/non-IT assets.")
                suggested_fixes.append(f"Remove {field} and use condition/material/inspection fields instead.")
            if (
                field_norm == "os"
                and ("apple" in normalized_brand or "macbook" in normalized_brand or "macbook" in normalized_model)
                and "windows" in value_text.lower()
            ):
                suspicious_fields.append(field)
                warnings.append("MacBook/Apple model with Windows OS looks suspicious.")
                suggested_fixes.append("Set OS to 'macOS' or 'Unknown - verify exact configuration'.")

        source_type = str(payload.source_type or "").strip().lower()
        evidence_status = str(payload.evidence_status or "").strip().lower()
        if source_type in {"asset_type_profile", "llm_only", "heuristic"} or evidence_status in {
            "insufficient_source_evidence",
            "llm_or_heuristic_only",
        }:
            warnings.append("Specs are not backed by trusted source evidence. Manual verification recommended.")

        requires_review = bool(suspicious_fields) or evidence_status in {
            "insufficient_source_evidence",
            "llm_or_heuristic_only",
        }
        llm_used = False

        schema = {
            "type": "object",
            "properties": {
                "warnings": {"type": "array", "items": {"type": "string"}},
                "suspicious_fields": {"type": "array", "items": {"type": "string"}},
                "suggested_fixes": {"type": "array", "items": {"type": "string"}},
                "requires_review": {"type": "boolean"},
            },
            "required": ["warnings", "suspicious_fields", "suggested_fixes", "requires_review"],
        }
        prompt_payload = {
            "asset_type": payload.asset_type,
            "brand": payload.brand,
            "model": payload.model,
            "normalized_specs": payload.normalized_specs,
            "source_type": payload.source_type,
            "evidence_status": payload.evidence_status,
        }
        parsed = None
        if self.llm.enabled:
            parsed = await anyio.to_thread.run_sync(
                self._llm_json,
                SPEC_SANITY_PROMPT.format(payload_json=json.dumps(prompt_payload, ensure_ascii=False)),
                schema,
                0.1,
            )

        if isinstance(parsed, dict):
            llm_used = True
            for warning in parsed.get("warnings") or []:
                safe = str(warning or "").strip()
                if safe and safe not in warnings:
                    warnings.append(safe)
            for field in parsed.get("suspicious_fields") or []:
                safe = str(field or "").strip()
                if safe and safe not in suspicious_fields:
                    suspicious_fields.append(safe)
            for fix in parsed.get("suggested_fixes") or []:
                safe = str(fix or "").strip()
                if safe and safe not in suggested_fixes:
                    suggested_fixes.append(safe)
            requires_review = bool(parsed.get("requires_review", requires_review)) or requires_review

        return SpecSanityCheckResponse(
            warnings=warnings[:12],
            suspicious_fields=suspicious_fields[:12],
            suggested_fixes=suggested_fixes[:12],
            requires_review=requires_review,
            llm_used=llm_used,
        )

    async def explain_eol_assessment(self, payload: EolExplanationRequest) -> EolExplanationResponse:
        assessment = payload.assessment or {}
        status = str(assessment.get("status") or "unknown")
        confidence = payload.confidence if payload.confidence is not None else assessment.get("confidence")
        confidence_pct = int(round(float(confidence or 0) * 100))
        telemetry = str(payload.telemetry_status or assessment.get("telemetryStatus") or "unknown")
        spec_evidence = str(payload.spec_evidence_status or assessment.get("specEvidenceStatus") or "insufficient_source_evidence")
        reason = str(assessment.get("reason") or "No detailed reason was provided.")
        predicted_eol = assessment.get("predictedEolDate")
        months_remaining = assessment.get("monthsRemaining")
        procurement = bool(
            payload.procurement_suitable
            if payload.procurement_suitable is not None
            else assessment.get("suitableForProcurementPlanning")
        )

        short_user = (
            f"EOL status is {status.replace('_', ' ')} with {confidence_pct}% confidence. "
            f"{'Procurement planning is recommended.' if procurement else 'Manual monitoring is recommended.'}"
        )
        technical = (
            f"Backend assessment status={status}, confidence={confidence_pct}%, telemetry={telemetry}, "
            f"specEvidence={spec_evidence}, predictedEolDate={predicted_eol}, monthsRemaining={months_remaining}. "
            f"Reason: {reason}"
        )

        llm_used = False
        schema = {
            "type": "object",
            "properties": {
                "short_user_explanation": {"type": "string"},
                "technical_explanation": {"type": "string"},
            },
            "required": ["short_user_explanation", "technical_explanation"],
        }
        prompt_payload = {
            "assessment": assessment,
            "telemetry_status": telemetry,
            "spec_evidence_status": spec_evidence,
            "predicted_lifespan_years": payload.predicted_lifespan_years,
            "confidence": confidence,
            "procurement_suitable": procurement,
        }
        parsed = None
        if self.llm.enabled:
            parsed = await anyio.to_thread.run_sync(
                self._llm_json,
                EOL_EXPLANATION_PROMPT.format(payload_json=json.dumps(prompt_payload, ensure_ascii=False)),
                schema,
                0.1,
            )
        if isinstance(parsed, dict):
            llm_short = str(parsed.get("short_user_explanation") or "").strip()
            llm_tech = str(parsed.get("technical_explanation") or "").strip()
            if llm_short:
                short_user = llm_short
            if llm_tech:
                technical = llm_tech
            llm_used = True

        return EolExplanationResponse(
            short_user_explanation=short_user,
            technical_explanation=technical,
            llm_used=llm_used,
        )
