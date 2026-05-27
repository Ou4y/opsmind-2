"""Gemma-assisted inventory normalization/sanity/explanation helpers.

These helpers are deterministic-first and only use LLM for safe reasoning polish.
"""

from __future__ import annotations

import json
import re
from typing import Any

import anyio

from src.config import AppSettings
from src.llm.client_protocol import LLMClientProtocol
from src.llm.prompts import (
    ASSET_HEALTH_SUMMARY_PROMPT,
    DATA_CORRECTION_SUGGESTIONS_PROMPT,
    DOCUMENT_EXTRACTION_PROMPT,
    DUPLICATE_EXPLANATION_PROMPT,
    EOL_EXPLANATION_PROMPT,
    IMPORT_COLUMN_MAPPING_PROMPT,
    IMPORT_ERROR_REPAIR_PROMPT,
    INVENTORY_ASSISTANT_PROMPT,
    INVENTORY_ACTION_PLAN_PROMPT,
    INVENTORY_TICKET_DRAFT_PROMPT,
    MAINTENANCE_RECOMMENDATION_PROMPT,
    MISSING_DATA_DETECTOR_PROMPT,
    MONTHLY_INVENTORY_REPORT_PROMPT,
    NATURAL_LANGUAGE_SEARCH_PROMPT,
    PROCUREMENT_RECOMMENDATION_PROMPT,
    RELATIONSHIP_SUGGESTION_PROMPT,
    REPLACEMENT_PRIORITY_PROMPT,
    RISK_SCORE_EXPLANATION_PROMPT,
    SPARE_STOCK_FORECAST_PROMPT,
    SPEC_SOURCE_EXTRACTION_PROMPT,
    SPEC_NORMALIZATION_PROMPT,
    SPEC_SANITY_PROMPT,
    INVOICE_MATCHING_PROMPT,
)
from src.llm.validators import clamp_confidence
from src.schemas import (
    AssetHealthSummaryRequest,
    AssetHealthSummaryResponse,
    DataCorrectionSuggestionsRequest,
    DataCorrectionSuggestionsResponse,
    DocumentExtractionRequest,
    DocumentExtractionResponse,
    DuplicateExplanationRequest,
    DuplicateExplanationResponse,
    EolExplanationRequest,
    EolExplanationResponse,
    ImportColumnMappingRequest,
    ImportColumnMappingResponse,
    ImportErrorRepairRequest,
    ImportErrorRepairResponse,
    InvoiceAssetMatchingRequest,
    InvoiceAssetMatchingResponse,
    InventoryActionPlanRequest,
    InventoryActionPlanResponse,
    InventoryAssistantRequest,
    InventoryAssistantResponse,
    InventoryTicketDraftRequest,
    InventoryTicketDraftResponse,
    MaintenanceRecommendationRequest,
    MaintenanceRecommendationResponse,
    MissingDataDetectorRequest,
    MissingDataDetectorResponse,
    MonthlyInventoryReportRequest,
    MonthlyInventoryReportResponse,
    NaturalLanguageInventorySearchRequest,
    NaturalLanguageInventorySearchResponse,
    ProcurementRecommendationRequest,
    ProcurementRecommendationResponse,
    RelationshipSuggestionRequest,
    RelationshipSuggestionResponse,
    ReplacementPriorityRequest,
    ReplacementPriorityResponse,
    RiskScoreExplanationRequest,
    RiskScoreExplanationResponse,
    SpareStockForecastRequest,
    SpareStockForecastResponse,
    SourceSpecExtractionRequest,
    SourceSpecExtractionResponse,
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

    @staticmethod
    def _tokenize_model(value: str) -> str:
        return "".join(ch for ch in str(value or "").lower() if ch.isalnum())

    @staticmethod
    def _model_parts(value: str) -> list[str]:
        return [
            token.strip().lower()
            for token in re.split(r"[^a-zA-Z0-9]+", str(value or ""))
            if token and len(token.strip()) >= 2
        ]

    @staticmethod
    def _has_variant_hint(value: str) -> bool:
        raw = str(value or "").lower()
        if re.search(r"\b(19|20)\d{2}\b", raw):
            return True
        if re.search(r"\b(gen|g)\s?\d+\b", raw):
            return True
        if re.search(r"\b(intel|amd|ryzen|core|m\d|i[3579])\b", raw):
            return True
        if re.search(r"\b[a-z]{1,4}\d{3,5}[a-z]{0,3}\b", raw):
            return True
        return False

    @classmethod
    def _is_broad_family_model(cls, model: str) -> bool:
        parts = cls._model_parts(model)
        if len(parts) <= 1:
            return True
        family_words = {
            "pro",
            "air",
            "max",
            "plus",
            "mini",
            "series",
            "family",
            "laserjet",
            "thinkpad",
            "macbook",
            "catalyst",
        }
        non_family = [part for part in parts if part not in family_words]
        if not cls._has_variant_hint(model) and len(non_family) <= 1:
            return True
        return False

    @classmethod
    def _model_coverage_score(cls, model: str, source_text: str) -> float:
        parts = cls._model_parts(model)
        if not parts:
            return 0.0
        haystack = cls._tokenize_model(source_text)
        matched = [part for part in parts if cls._tokenize_model(part) in haystack]
        return len(matched) / len(parts)

    @staticmethod
    def _extract_known_fields_from_source_text(source_text: str, expected_fields: list[str]) -> dict[str, str]:
        text = str(source_text or "")
        text_lower = text.lower()
        extracted: dict[str, str] = {}
        expected_norm = {"".join(ch for ch in str(field).lower() if ch.isalnum()) for field in (expected_fields or [])}

        def allow(field_name: str) -> bool:
            if not expected_norm:
                return True
            return "".join(ch for ch in field_name.lower() if ch.isalnum()) in expected_norm

        memory_match = re.search(r"\b(?:ram|memory)\b[^0-9]{0,20}(\d+\s?(?:gb|tb))", text_lower, re.IGNORECASE)
        if memory_match and allow("RAM"):
            extracted["RAM"] = memory_match.group(1).upper().replace(" ", "")

        storage_match = re.search(r"\b(?:storage|ssd|hdd)\b[^0-9]{0,20}(\d+\s?(?:gb|tb))", text_lower, re.IGNORECASE)
        if storage_match and allow("Storage"):
            extracted["Storage"] = storage_match.group(1).upper().replace(" ", "")

        if allow("OS"):
            if "macos" in text_lower or "os x" in text_lower:
                extracted["OS"] = "macOS"
            elif "windows" in text_lower:
                windows = re.search(r"(windows\s+\d+(?:\s+(?:pro|home|enterprise))?)", text, re.IGNORECASE)
                extracted["OS"] = windows.group(1).strip() if windows else "Windows"
            elif "linux" in text_lower:
                extracted["OS"] = "Linux"

        cpu_match = re.search(
            r"\b(?:processor|cpu|chip)\b[^.,;\n]{0,48}",
            text,
            re.IGNORECASE,
        )
        if cpu_match and allow("Processor/Chip"):
            extracted["Processor/Chip"] = cpu_match.group(0).strip()

        display_match = re.search(r"\b\d{2}(?:\.\d)?[\"â€]\s*(?:display|screen)", text, re.IGNORECASE)
        if display_match and allow("Display"):
            extracted["Display"] = display_match.group(0).strip()

        ports_match = re.search(r"\b(?:ports?|interfaces?|rj-45|usb|hdmi|displayport)\b[^.,;\n]{0,96}", text, re.IGNORECASE)
        if ports_match:
            if allow("Ports"):
                extracted["Ports"] = ports_match.group(0).strip()
            if allow("Input Ports"):
                extracted["Input Ports"] = ports_match.group(0).strip()
            if allow("Connectivity"):
                extracted["Connectivity"] = ports_match.group(0).strip()

        throughput_match = re.search(r"\b(?:throughput|bandwidth|speed)\b[^.,;\n]{0,72}", text, re.IGNORECASE)
        if throughput_match and allow("Throughput"):
            extracted["Throughput"] = throughput_match.group(0).strip()

        firmware_match = re.search(r"\b(?:firmware(?:\s+version)?|software version)\b[^.,;\n]{0,72}", text, re.IGNORECASE)
        if firmware_match and allow("Firmware Version"):
            extracted["Firmware Version"] = firmware_match.group(0).strip()

        poe_match = re.search(r"\b(?:poe|power over ethernet)\b[^.,;\n]{0,56}", text, re.IGNORECASE)
        if poe_match and allow("PoE Support"):
            extracted["PoE Support"] = poe_match.group(0).strip()

        print_tech_match = re.search(r"\b(?:print technology|laser|inkjet|thermal)\b[^.,;\n]{0,72}", text, re.IGNORECASE)
        if print_tech_match and allow("Print Technology"):
            extracted["Print Technology"] = print_tech_match.group(0).strip()

        color_match = re.search(r"\b(?:color|monochrome|black and white)\b[^.,;\n]{0,56}", text, re.IGNORECASE)
        if color_match and allow("Color Support"):
            extracted["Color Support"] = color_match.group(0).strip()

        duplex_match = re.search(r"\b(?:duplex|two-sided)\b[^.,;\n]{0,56}", text, re.IGNORECASE)
        if duplex_match and allow("Duplex"):
            extracted["Duplex"] = duplex_match.group(0).strip()

        toner_match = re.search(r"\b(?:toner|ink|cartridge)\b[^.,;\n]{0,72}", text, re.IGNORECASE)
        if toner_match and allow("Toner/Ink Type"):
            extracted["Toner/Ink Type"] = toner_match.group(0).strip()

        page_count_match = re.search(r"\b(?:page count|pages?|ppm)\b[^.,;\n]{0,72}", text, re.IGNORECASE)
        if page_count_match and allow("Page Count"):
            extracted["Page Count"] = page_count_match.group(0).strip()

        dimensions_match = re.search(r"\b(?:dimensions?|size)\b[^.,;\n]{0,72}", text, re.IGNORECASE)
        if dimensions_match and allow("Dimensions"):
            extracted["Dimensions"] = dimensions_match.group(0).strip()

        material_match = re.search(r"\b(?:material|frame|mesh|fabric|wood|steel)\b[^.,;\n]{0,64}", text, re.IGNORECASE)
        if material_match and allow("Material"):
            extracted["Material"] = material_match.group(0).strip()

        return extracted

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

    async def summarize_asset_health(self, payload: AssetHealthSummaryRequest) -> AssetHealthSummaryResponse:
        asset = payload.asset or {}
        eol = payload.eol_assessment or {}
        events = list(payload.history_events or [])
        components = list(payload.components or [])

        asset_name = str(asset.get("name") or "Asset")
        asset_id = str(asset.get("customId") or asset.get("assetId") or "").strip()
        lifecycle = str(asset.get("lifecycleStatus") or "unknown").replace("_", " ").lower()
        eol_status = str(eol.get("status") or "unknown").replace("_", " ").lower()
        eol_confidence = float(eol.get("confidence") or 0.0)
        eol_confidence_pct = int(round(max(0.0, min(1.0, eol_confidence)) * 100))

        missing_data: list[str] = []
        if not asset.get("purchaseDate"):
            missing_data.append("purchaseDate")
        if not asset.get("warrantyEndDate"):
            missing_data.append("warrantyEndDate")
        if not asset.get("serialNumber"):
            missing_data.append("serialNumber")
        if not events:
            missing_data.append("historyEvents")
        telemetry_enabled = bool((asset.get("specifications") or {}).get("telemetryEnabled"))
        if not telemetry_enabled:
            missing_data.append("telemetrySignals")

        recent_changes = []
        for row in events[:8]:
            event_label = str(row.get("event") or row.get("eventType") or "Event").strip()
            source_name = str(row.get("sourceItemName") or row.get("sourceItemCustomId") or "Related item").strip()
            reason = str(row.get("reason") or "").strip()
            line = f"{source_name}: {event_label}"
            if reason:
                line += f" — Reason: {reason}"
            recent_changes.append(line)

        component_issues = []
        for row in events:
            source_type = str(row.get("sourceItemType") or "").strip().lower()
            event_key = str(row.get("eventType") or row.get("event") or "").strip().lower()
            if source_type == "component" and any(token in event_key for token in ("fail", "repair", "replace", "retire", "dispose")):
                source_name = str(row.get("sourceItemName") or "Component").strip()
                component_issues.append(f"{source_name}: {str(row.get('event') or row.get('eventType') or 'issue')}")
        component_issues = component_issues[:8]

        warranty_eol_concerns = []
        if asset.get("warrantyEndDate"):
            warranty_eol_concerns.append(f"Warranty end date: {asset.get('warrantyEndDate')}")
        else:
            warranty_eol_concerns.append("Warranty end date is missing.")
        warranty_eol_concerns.append(f"EOL status: {eol_status} ({eol_confidence_pct}% confidence)")
        if str(eol.get("reason") or "").strip():
            warranty_eol_concerns.append(f"EOL reason: {str(eol.get('reason') or '').strip()}")

        risks: list[str] = []
        if eol_status in {"at risk", "expired", "eol expired"}:
            risks.append(f"EOL risk is elevated ({eol_status}).")
        if component_issues:
            risks.append(f"{len(component_issues)} component issue event(s) were detected.")
        if missing_data:
            risks.append("Some lifecycle and telemetry fields are missing, reducing confidence.")

        recommendations: list[str] = []
        if not asset.get("warrantyEndDate"):
            recommendations.append("Add warranty end date to improve lifecycle planning.")
        if not asset.get("purchaseDate"):
            recommendations.append("Backfill purchase date for stronger EOL confidence.")
        if component_issues:
            recommendations.append("Schedule preventive maintenance for repeated component issues.")
        if payload.maintenance_count <= 0:
            recommendations.append("Add maintenance records for better health traceability.")
        if not recommendations:
            recommendations.append("Continue periodic monitoring and maintenance reviews.")

        confidence = "high"
        if len(missing_data) >= 4:
            confidence = "low"
        elif len(missing_data) >= 2:
            confidence = "medium"

        summary = (
            f"{asset_name}{f' ({asset_id})' if asset_id else ''} is currently {lifecycle}. "
            f"EOL status is {eol_status} with {eol_confidence_pct}% confidence. "
            f"{'Recent component issues were detected.' if component_issues else 'No major component failure trend was detected.'}"
        )

        llm_used = False
        schema = {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "risks": {"type": "array", "items": {"type": "string"}},
                "recent_changes": {"type": "array", "items": {"type": "string"}},
                "component_issues": {"type": "array", "items": {"type": "string"}},
                "warranty_eol_concerns": {"type": "array", "items": {"type": "string"}},
                "recommendations": {"type": "array", "items": {"type": "string"}},
                "confidence": {"type": "string"},
                "missing_data": {"type": "array", "items": {"type": "string"}},
            },
            "required": [
                "summary",
                "risks",
                "recent_changes",
                "component_issues",
                "warranty_eol_concerns",
                "recommendations",
                "confidence",
                "missing_data",
            ],
        }
        prompt_payload = {
            "asset": asset,
            "eol_assessment": eol,
            "include_related": payload.include_related,
            "history_events": events[:80],
            "components": components[:80],
            "maintenance_count": payload.maintenance_count,
        }
        parsed = None
        if self.llm.enabled:
            parsed = await anyio.to_thread.run_sync(
                self._llm_json,
                ASSET_HEALTH_SUMMARY_PROMPT.format(payload_json=json.dumps(prompt_payload, ensure_ascii=False)),
                schema,
                0.1,
            )
        if isinstance(parsed, dict):
            llm_used = True
            summary = str(parsed.get("summary") or summary).strip() or summary
            risks = [str(item).strip() for item in (parsed.get("risks") or []) if str(item).strip()] or risks
            recent_changes = [str(item).strip() for item in (parsed.get("recent_changes") or []) if str(item).strip()] or recent_changes
            component_issues = [str(item).strip() for item in (parsed.get("component_issues") or []) if str(item).strip()] or component_issues
            warranty_eol_concerns = [str(item).strip() for item in (parsed.get("warranty_eol_concerns") or []) if str(item).strip()] or warranty_eol_concerns
            recommendations = [str(item).strip() for item in (parsed.get("recommendations") or []) if str(item).strip()] or recommendations
            missing_data = [str(item).strip() for item in (parsed.get("missing_data") or []) if str(item).strip()] or missing_data
            confidence_candidate = str(parsed.get("confidence") or confidence).strip().lower()
            if confidence_candidate in {"low", "medium", "high"}:
                confidence = confidence_candidate

        return AssetHealthSummaryResponse(
            summary=summary,
            risks=risks[:12],
            recent_changes=recent_changes[:12],
            component_issues=component_issues[:12],
            warranty_eol_concerns=warranty_eol_concerns[:12],
            recommendations=recommendations[:12],
            confidence=confidence,
            missing_data=missing_data[:24],
            llm_used=llm_used,
        )

    @staticmethod
    def _confidence_label(value: Any, fallback: str = "low") -> str:
        candidate = str(value or fallback).strip().lower()
        return candidate if candidate in {"low", "medium", "high"} else fallback

    def _llm_status(self, llm_used: bool) -> str:
        if llm_used:
            return "ready"
        return "fallback" if self.llm.enabled else "disabled"

    async def inventory_assistant(self, payload: InventoryAssistantRequest) -> InventoryAssistantResponse:
        deterministic = payload.deterministic_result or {}
        answer = str(deterministic.get("answer") or "No deterministic answer was provided.").strip()
        suggested_actions = [
            str(item).strip()
            for item in (deterministic.get("suggestedActions") or deterministic.get("suggested_actions") or [])
            if str(item).strip()
        ]
        confidence = self._confidence_label(deterministic.get("confidence"), "low")
        missing_data = [
            str(item).strip()
            for item in (deterministic.get("missingData") or deterministic.get("missing_data") or [])
            if str(item).strip()
        ]

        llm_used = False
        fallback_reason: str | None = None
        schema = {
            "type": "object",
            "properties": {
                "answer": {"type": "string"},
                "suggested_actions": {"type": "array", "items": {"type": "string"}},
                "confidence": {"type": "string"},
                "missing_data": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["answer", "suggested_actions", "confidence", "missing_data"],
        }
        prompt_payload = {
            "query": payload.query,
            "deterministic_result": deterministic,
            "context_summary": payload.context_summary,
        }
        parsed = None
        if self.llm.enabled:
            parsed = await anyio.to_thread.run_sync(
                self._llm_json,
                INVENTORY_ASSISTANT_PROMPT.format(payload_json=json.dumps(prompt_payload, ensure_ascii=False)),
                schema,
                0.1,
            )
        else:
            fallback_reason = "llm_disabled"
        if isinstance(parsed, dict):
            llm_used = True
            answer = str(parsed.get("answer") or answer).strip() or answer
            suggested_actions = [
                str(item).strip() for item in (parsed.get("suggested_actions") or []) if str(item).strip()
            ] or suggested_actions
            confidence = self._confidence_label(parsed.get("confidence"), confidence)
            missing_data = [str(item).strip() for item in (parsed.get("missing_data") or []) if str(item).strip()] or missing_data
        elif self.llm.enabled:
            fallback_reason = str(getattr(self.llm, "last_error", "") or "llm_unavailable").strip() or "llm_unavailable"

        return InventoryAssistantResponse(
            answer=answer,
            suggested_actions=suggested_actions[:12],
            confidence=confidence,
            missing_data=missing_data[:24],
            llm_used=llm_used,
            llm_status="ready" if llm_used else ("fallback" if self.llm.enabled else "disabled"),
            fallback_reason=fallback_reason,
        )

    async def data_correction_suggestions(self, payload: DataCorrectionSuggestionsRequest) -> DataCorrectionSuggestionsResponse:
        suggestions = payload.suggestions or []
        summary = str(payload.summary or "").strip() or (
            f"Identified {len(suggestions)} data-correction suggestion(s)."
            if suggestions
            else "No deterministic data-correction suggestions were generated."
        )
        confidence = self._confidence_label(payload.confidence, "medium" if suggestions else "low")
        missing_data = [str(item).strip() for item in (payload.missing_data or []) if str(item).strip()]
        suggested_actions = [
            str(item).strip()
            for item in (payload.suggested_actions or [])
            if str(item).strip()
        ] or [
            "Review critical findings first and apply only safe corrections after confirmation.",
        ]
        llm_used = False
        fallback_reason: str | None = None

        schema = {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "confidence": {"type": "string"},
                "missing_data": {"type": "array", "items": {"type": "string"}},
                "suggested_actions": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["summary", "confidence", "missing_data", "suggested_actions"],
        }
        prompt_payload = {
            "summary": summary,
            "counts_by_severity": payload.counts_by_severity,
            "suggestions": suggestions[:120],
            "data_scope": payload.data_scope,
        }
        parsed = None
        if self.llm.enabled:
            parsed = await anyio.to_thread.run_sync(
                self._llm_json,
                DATA_CORRECTION_SUGGESTIONS_PROMPT.format(payload_json=json.dumps(prompt_payload, ensure_ascii=False)),
                schema,
                0.1,
            )
        else:
            fallback_reason = "llm_disabled"
        if isinstance(parsed, dict):
            llm_used = True
            summary = str(parsed.get("summary") or summary).strip() or summary
            confidence = self._confidence_label(parsed.get("confidence"), confidence)
            missing_data = [str(item).strip() for item in (parsed.get("missing_data") or []) if str(item).strip()] or missing_data
            suggested_actions = [
                str(item).strip() for item in (parsed.get("suggested_actions") or []) if str(item).strip()
            ] or suggested_actions
        elif self.llm.enabled:
            fallback_reason = str(getattr(self.llm, "last_error", "") or "llm_unavailable").strip() or "llm_unavailable"

        return DataCorrectionSuggestionsResponse(
            summary=summary,
            confidence=confidence,
            missing_data=missing_data[:24],
            suggested_actions=suggested_actions[:20],
            llm_used=llm_used,
            llm_status=self._llm_status(llm_used),
            fallback_reason=fallback_reason,
        )

    async def risk_score_explanation(self, payload: RiskScoreExplanationRequest) -> RiskScoreExplanationResponse:
        rows = payload.risk_scores or []
        summary = str(payload.summary or "").strip() or (
            f"Computed risk scores for {len(rows)} asset(s)." if rows else "No risk rows were provided."
        )
        confidence = self._confidence_label(payload.confidence, "medium" if rows else "low")
        missing_data = [str(item).strip() for item in (payload.missing_data or []) if str(item).strip()]
        suggested_actions = [
            str(item).strip()
            for item in (payload.suggested_actions or [])
            if str(item).strip()
        ] or [
            "Prioritize critical/high risk assets for maintenance or replacement planning.",
        ]
        llm_used = False
        fallback_reason: str | None = None

        schema = {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "confidence": {"type": "string"},
                "missing_data": {"type": "array", "items": {"type": "string"}},
                "suggested_actions": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["summary", "confidence", "missing_data", "suggested_actions"],
        }
        parsed = None
        if self.llm.enabled:
            parsed = await anyio.to_thread.run_sync(
                self._llm_json,
                RISK_SCORE_EXPLANATION_PROMPT.format(payload_json=json.dumps({
                    "summary": summary,
                    "risk_scores": rows[:120],
                    "data_scope": payload.data_scope,
                    "missing_data": missing_data,
                }, ensure_ascii=False)),
                schema,
                0.1,
            )
        else:
            fallback_reason = "llm_disabled"
        if isinstance(parsed, dict):
            llm_used = True
            summary = str(parsed.get("summary") or summary).strip() or summary
            confidence = self._confidence_label(parsed.get("confidence"), confidence)
            missing_data = [str(item).strip() for item in (parsed.get("missing_data") or []) if str(item).strip()] or missing_data
            suggested_actions = [str(item).strip() for item in (parsed.get("suggested_actions") or []) if str(item).strip()] or suggested_actions
        elif self.llm.enabled:
            fallback_reason = str(getattr(self.llm, "last_error", "") or "llm_unavailable").strip() or "llm_unavailable"

        return RiskScoreExplanationResponse(
            summary=summary,
            confidence=confidence,
            missing_data=missing_data[:24],
            suggested_actions=suggested_actions[:20],
            llm_used=llm_used,
            llm_status=self._llm_status(llm_used),
            fallback_reason=fallback_reason,
        )

    async def replacement_priority(self, payload: ReplacementPriorityRequest) -> ReplacementPriorityResponse:
        rows = payload.ranked_items or []
        summary = str(payload.summary or "").strip() or (
            f"Ranked {len(rows)} replacement candidate(s)." if rows else "No replacement-priority candidates were provided."
        )
        confidence = self._confidence_label(payload.confidence, "medium" if rows else "low")
        missing_data = [str(item).strip() for item in (payload.missing_data or []) if str(item).strip()]
        suggested_actions = [
            str(item).strip()
            for item in (payload.suggested_actions or [])
            if str(item).strip()
        ] or [
            "Start with top-ranked items and validate budget/stock constraints.",
        ]
        llm_used = False
        fallback_reason: str | None = None

        schema = {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "confidence": {"type": "string"},
                "missing_data": {"type": "array", "items": {"type": "string"}},
                "suggested_actions": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["summary", "confidence", "missing_data", "suggested_actions"],
        }
        parsed = None
        if self.llm.enabled:
            parsed = await anyio.to_thread.run_sync(
                self._llm_json,
                REPLACEMENT_PRIORITY_PROMPT.format(payload_json=json.dumps({
                    "summary": summary,
                    "ranked_items": rows[:120],
                    "missing_data": missing_data,
                }, ensure_ascii=False)),
                schema,
                0.1,
            )
        else:
            fallback_reason = "llm_disabled"
        if isinstance(parsed, dict):
            llm_used = True
            summary = str(parsed.get("summary") or summary).strip() or summary
            confidence = self._confidence_label(parsed.get("confidence"), confidence)
            missing_data = [str(item).strip() for item in (parsed.get("missing_data") or []) if str(item).strip()] or missing_data
            suggested_actions = [str(item).strip() for item in (parsed.get("suggested_actions") or []) if str(item).strip()] or suggested_actions
        elif self.llm.enabled:
            fallback_reason = str(getattr(self.llm, "last_error", "") or "llm_unavailable").strip() or "llm_unavailable"

        return ReplacementPriorityResponse(
            summary=summary,
            confidence=confidence,
            missing_data=missing_data[:24],
            suggested_actions=suggested_actions[:20],
            llm_used=llm_used,
            llm_status=self._llm_status(llm_used),
            fallback_reason=fallback_reason,
        )

    async def spare_stock_forecast(self, payload: SpareStockForecastRequest) -> SpareStockForecastResponse:
        forecasts = payload.forecasts or []
        summary = str(payload.summary or "").strip() or (
            f"Prepared stock forecast for {len(forecasts)} item(s)." if forecasts else "No stock forecast rows were provided."
        )
        confidence = self._confidence_label(payload.confidence, "medium" if forecasts else "low")
        missing_data = [str(item).strip() for item in (payload.missing_data or []) if str(item).strip()]
        suggested_actions = [
            str(item).strip()
            for item in (payload.suggested_actions or [])
            if str(item).strip()
        ] or [
            "Raise procurement requests for items below reorder thresholds first.",
        ]
        llm_used = False
        fallback_reason: str | None = None
        schema = {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "confidence": {"type": "string"},
                "missing_data": {"type": "array", "items": {"type": "string"}},
                "suggested_actions": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["summary", "confidence", "missing_data", "suggested_actions"],
        }
        parsed = None
        if self.llm.enabled:
            parsed = await anyio.to_thread.run_sync(
                self._llm_json,
                SPARE_STOCK_FORECAST_PROMPT.format(payload_json=json.dumps({
                    "summary": summary,
                    "forecasts": forecasts[:120],
                    "missing_data": missing_data,
                }, ensure_ascii=False)),
                schema,
                0.1,
            )
        else:
            fallback_reason = "llm_disabled"
        if isinstance(parsed, dict):
            llm_used = True
            summary = str(parsed.get("summary") or summary).strip() or summary
            confidence = self._confidence_label(parsed.get("confidence"), confidence)
            missing_data = [str(item).strip() for item in (parsed.get("missing_data") or []) if str(item).strip()] or missing_data
            suggested_actions = [str(item).strip() for item in (parsed.get("suggested_actions") or []) if str(item).strip()] or suggested_actions
        elif self.llm.enabled:
            fallback_reason = str(getattr(self.llm, "last_error", "") or "llm_unavailable").strip() or "llm_unavailable"

        return SpareStockForecastResponse(
            summary=summary,
            confidence=confidence,
            missing_data=missing_data[:24],
            suggested_actions=suggested_actions[:20],
            llm_used=llm_used,
            llm_status=self._llm_status(llm_used),
            fallback_reason=fallback_reason,
        )

    async def repair_import_errors(self, payload: ImportErrorRepairRequest) -> ImportErrorRepairResponse:
        fixes = [dict(row) for row in (payload.fixes or [])]
        warnings = [str(item).strip() for item in (payload.warnings or []) if str(item).strip()]
        summary = str(payload.summary or "").strip() or (
            f"Prepared {len(fixes)} import repair suggestion(s)." if fixes else "No deterministic import repair suggestions were generated."
        )
        confidence = self._confidence_label(payload.confidence, "medium" if fixes else "low")
        llm_used = False
        fallback_reason: str | None = None

        schema = {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "confidence": {"type": "string"},
                "warnings": {"type": "array", "items": {"type": "string"}},
                "fixes": {"type": "array", "items": {"type": "object"}},
            },
            "required": ["summary", "confidence", "warnings", "fixes"],
        }
        parsed = None
        if self.llm.enabled:
            parsed = await anyio.to_thread.run_sync(
                self._llm_json,
                IMPORT_ERROR_REPAIR_PROMPT.format(payload_json=json.dumps({
                    "summary": summary,
                    "fixes": fixes[:120],
                    "warnings": warnings[:40],
                }, ensure_ascii=False)),
                schema,
                0.1,
            )
        else:
            fallback_reason = "llm_disabled"
        if isinstance(parsed, dict):
            llm_used = True
            summary = str(parsed.get("summary") or summary).strip() or summary
            confidence = self._confidence_label(parsed.get("confidence"), confidence)
            warnings = [str(item).strip() for item in (parsed.get("warnings") or []) if str(item).strip()] or warnings
            parsed_fixes = parsed.get("fixes") or []
            if isinstance(parsed_fixes, list) and parsed_fixes:
                fixes = [dict(row) for row in parsed_fixes if isinstance(row, dict)] or fixes
        elif self.llm.enabled:
            fallback_reason = str(getattr(self.llm, "last_error", "") or "llm_unavailable").strip() or "llm_unavailable"

        return ImportErrorRepairResponse(
            summary=summary,
            fixes=fixes[:200],
            corrected_rows_preview=[],
            warnings=warnings[:40],
            confidence=confidence,
            llm_used=llm_used,
            llm_status=self._llm_status(llm_used),
            fallback_reason=fallback_reason,
        )

    async def relationship_suggestions(self, payload: RelationshipSuggestionRequest) -> RelationshipSuggestionResponse:
        suggestions = payload.suggestions or []
        summary = str(payload.summary or "").strip() or (
            f"Prepared {len(suggestions)} relationship suggestion(s)." if suggestions else "No deterministic relationship suggestions were generated."
        )
        confidence = self._confidence_label(payload.confidence, "medium" if suggestions else "low")
        missing_data = [str(item).strip() for item in (payload.missing_data or []) if str(item).strip()]
        llm_used = False
        fallback_reason: str | None = None
        schema = {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "confidence": {"type": "string"},
                "missing_data": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["summary", "confidence", "missing_data"],
        }
        parsed = None
        if self.llm.enabled:
            parsed = await anyio.to_thread.run_sync(
                self._llm_json,
                RELATIONSHIP_SUGGESTION_PROMPT.format(payload_json=json.dumps({
                    "summary": summary,
                    "suggestions": suggestions[:120],
                    "missing_data": missing_data,
                }, ensure_ascii=False)),
                schema,
                0.1,
            )
        else:
            fallback_reason = "llm_disabled"
        if isinstance(parsed, dict):
            llm_used = True
            summary = str(parsed.get("summary") or summary).strip() or summary
            confidence = self._confidence_label(parsed.get("confidence"), confidence)
            missing_data = [str(item).strip() for item in (parsed.get("missing_data") or []) if str(item).strip()] or missing_data
        elif self.llm.enabled:
            fallback_reason = str(getattr(self.llm, "last_error", "") or "llm_unavailable").strip() or "llm_unavailable"

        return RelationshipSuggestionResponse(
            summary=summary,
            confidence=confidence,
            missing_data=missing_data[:24],
            llm_used=llm_used,
            llm_status=self._llm_status(llm_used),
            fallback_reason=fallback_reason,
        )

    async def match_invoice_assets(self, payload: InvoiceAssetMatchingRequest) -> InvoiceAssetMatchingResponse:
        matches = payload.matches or []
        unmatched = payload.unmatched_items or []
        warnings = [str(item).strip() for item in (payload.warnings or []) if str(item).strip()]
        summary = str(payload.summary or "").strip() or (
            f"Prepared {len(matches)} invoice/document match suggestion(s)." if matches else "No deterministic invoice matches were generated."
        )
        confidence = self._confidence_label(payload.confidence, "medium" if matches else "low")
        llm_used = False
        fallback_reason: str | None = None
        schema = {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "confidence": {"type": "string"},
                "warnings": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["summary", "confidence", "warnings"],
        }
        parsed = None
        if self.llm.enabled:
            parsed = await anyio.to_thread.run_sync(
                self._llm_json,
                INVOICE_MATCHING_PROMPT.format(payload_json=json.dumps({
                    "summary": summary,
                    "matches": matches[:120],
                    "unmatched_items": unmatched[:120],
                    "warnings": warnings[:40],
                }, ensure_ascii=False)),
                schema,
                0.1,
            )
        else:
            fallback_reason = "llm_disabled"
        if isinstance(parsed, dict):
            llm_used = True
            summary = str(parsed.get("summary") or summary).strip() or summary
            confidence = self._confidence_label(parsed.get("confidence"), confidence)
            warnings = [str(item).strip() for item in (parsed.get("warnings") or []) if str(item).strip()] or warnings
        elif self.llm.enabled:
            fallback_reason = str(getattr(self.llm, "last_error", "") or "llm_unavailable").strip() or "llm_unavailable"

        return InvoiceAssetMatchingResponse(
            summary=summary,
            confidence=confidence,
            warnings=warnings[:40],
            llm_used=llm_used,
            llm_status=self._llm_status(llm_used),
            fallback_reason=fallback_reason,
        )

    async def draft_inventory_ticket(self, payload: InventoryTicketDraftRequest) -> InventoryTicketDraftResponse:
        ticket_draft = dict(payload.ticket_draft or {})
        summary_title = str(ticket_draft.get("title") or "").strip()
        confidence = self._confidence_label(payload.confidence, "medium" if ticket_draft else "low")
        missing_data = [str(item).strip() for item in (payload.missing_data or []) if str(item).strip()]
        llm_used = False
        fallback_reason: str | None = None
        schema = {
            "type": "object",
            "properties": {
                "ticket_draft": {"type": "object"},
                "confidence": {"type": "string"},
                "missing_data": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["ticket_draft", "confidence", "missing_data"],
        }
        parsed = None
        if self.llm.enabled:
            parsed = await anyio.to_thread.run_sync(
                self._llm_json,
                INVENTORY_TICKET_DRAFT_PROMPT.format(payload_json=json.dumps({
                    "ticket_draft": ticket_draft,
                    "missing_data": missing_data,
                }, ensure_ascii=False)),
                schema,
                0.1,
            )
        else:
            fallback_reason = "llm_disabled"
        if isinstance(parsed, dict):
            llm_used = True
            parsed_draft = parsed.get("ticket_draft") or {}
            if isinstance(parsed_draft, dict) and parsed_draft:
                ticket_draft = parsed_draft
            confidence = self._confidence_label(parsed.get("confidence"), confidence)
            missing_data = [str(item).strip() for item in (parsed.get("missing_data") or []) if str(item).strip()] or missing_data
        elif self.llm.enabled:
            fallback_reason = str(getattr(self.llm, "last_error", "") or "llm_unavailable").strip() or "llm_unavailable"

        if not ticket_draft:
            ticket_draft = {
                "title": summary_title or "Inventory issue follow-up",
                "description": "Review related inventory evidence and create a maintenance action plan.",
            }

        return InventoryTicketDraftResponse(
            ticket_draft=ticket_draft,
            confidence=confidence,
            missing_data=missing_data[:24],
            llm_used=llm_used,
            llm_status=self._llm_status(llm_used),
            fallback_reason=fallback_reason,
        )

    async def monthly_inventory_report(self, payload: MonthlyInventoryReportRequest) -> MonthlyInventoryReportResponse:
        report_title = str(payload.report_title or "Monthly Inventory Report").strip() or "Monthly Inventory Report"
        executive_summary = str(payload.executive_summary or "").strip() or "Monthly inventory report generated from deterministic metrics."
        sections = [dict(row) for row in (payload.sections or []) if isinstance(row, dict)]
        section_keys = [
            str((row.get("title") or row.get("key") or "")).strip()
            for row in sections[:16]
            if isinstance(row, dict)
        ]
        section_keys = [entry for entry in section_keys if entry]
        recommendations = [str(item).strip() for item in (payload.recommendations or []) if str(item).strip()]
        confidence = self._confidence_label(payload.confidence, "medium")
        missing_data = [str(item).strip() for item in (payload.missing_data or []) if str(item).strip()]
        llm_used = False
        fallback_reason: str | None = None
        schema = {
            "type": "object",
            "properties": {
                "executive_summary": {"type": "string"},
                "recommendations": {"type": "array", "items": {"type": "string"}},
                "confidence": {"type": "string"},
                "missing_data": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["executive_summary", "recommendations", "confidence", "missing_data"],
        }
        parsed = None
        if self.llm.enabled:
            parsed = await anyio.to_thread.run_sync(
                self._llm_json,
                MONTHLY_INVENTORY_REPORT_PROMPT.format(payload_json=json.dumps({
                    "report_title": report_title,
                    "date_range": payload.date_range,
                    "executive_summary": executive_summary,
                    "section_keys": section_keys,
                    "metrics": payload.metrics,
                    "recommendations": recommendations[:30],
                    "missing_data": missing_data,
                }, ensure_ascii=False)),
                schema,
                0.1,
            )
        else:
            fallback_reason = "llm_disabled"
        if isinstance(parsed, dict):
            llm_used = True
            executive_summary = str(parsed.get("executive_summary") or executive_summary).strip() or executive_summary
            recommendations = [str(item).strip() for item in (parsed.get("recommendations") or []) if str(item).strip()] or recommendations
            confidence = self._confidence_label(parsed.get("confidence"), confidence)
            missing_data = [str(item).strip() for item in (parsed.get("missing_data") or []) if str(item).strip()] or missing_data
        elif self.llm.enabled:
            fallback_reason = str(getattr(self.llm, "last_error", "") or "llm_unavailable").strip() or "llm_unavailable"

        return MonthlyInventoryReportResponse(
            report_title=report_title,
            executive_summary=executive_summary,
            sections=sections[:24],
            recommendations=recommendations[:30],
            confidence=confidence,
            missing_data=missing_data[:24],
            llm_used=llm_used,
            llm_status=self._llm_status(llm_used),
            fallback_reason=fallback_reason,
        )

    async def plan_inventory_action(self, payload: InventoryActionPlanRequest) -> InventoryActionPlanResponse:
        action_plan = dict(payload.action_plan or {})
        action_type = str(action_plan.get("actionType") or action_plan.get("action_type") or "review_only").strip() or "review_only"
        summary = str(action_plan.get("summary") or f"Prepared review plan for: {payload.query}").strip()
        risks = [str(item).strip() for item in (action_plan.get("risks") or []) if str(item).strip()]
        confirmation_instructions = str(
            action_plan.get("confirmationInstructions")
            or action_plan.get("confirmation_instructions")
            or "Review affected items and confirm through dedicated safe workflows."
        ).strip()
        confidence = self._confidence_label(payload.confidence, "medium")
        llm_used = False
        fallback_reason: str | None = None
        schema = {
            "type": "object",
            "properties": {
                "action_type": {"type": "string"},
                "summary": {"type": "string"},
                "risks": {"type": "array", "items": {"type": "string"}},
                "confirmation_instructions": {"type": "string"},
                "confidence": {"type": "string"},
            },
            "required": ["action_type", "summary", "risks", "confirmation_instructions", "confidence"],
        }
        parsed = None
        if self.llm.enabled:
            parsed = await anyio.to_thread.run_sync(
                self._llm_json,
                INVENTORY_ACTION_PLAN_PROMPT.format(payload_json=json.dumps({
                    "query": payload.query,
                    "action_plan": action_plan,
                }, ensure_ascii=False)),
                schema,
                0.1,
            )
        else:
            fallback_reason = "llm_disabled"
        if isinstance(parsed, dict):
            llm_used = True
            action_type = str(parsed.get("action_type") or action_type).strip() or action_type
            summary = str(parsed.get("summary") or summary).strip() or summary
            risks = [str(item).strip() for item in (parsed.get("risks") or []) if str(item).strip()] or risks
            confirmation_instructions = str(parsed.get("confirmation_instructions") or confirmation_instructions).strip() or confirmation_instructions
            confidence = self._confidence_label(parsed.get("confidence"), confidence)
        elif self.llm.enabled:
            fallback_reason = str(getattr(self.llm, "last_error", "") or "llm_unavailable").strip() or "llm_unavailable"

        return InventoryActionPlanResponse(
            action_type=action_type,
            summary=summary,
            risks=risks[:16],
            confirmation_instructions=confirmation_instructions,
            confidence=confidence,
            llm_used=llm_used,
            llm_status=self._llm_status(llm_used),
            fallback_reason=fallback_reason,
        )

    async def map_import_columns(self, payload: ImportColumnMappingRequest) -> ImportColumnMappingResponse:
        mappings = [dict(row) for row in (payload.deterministic_mappings or [])]
        unmapped = []
        warnings: list[str] = []
        llm_used = False
        schema = {
            "type": "object",
            "properties": {
                "mappings": {"type": "array", "items": {"type": "object"}},
                "unmapped_columns": {"type": "array", "items": {"type": "string"}},
                "warnings": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["mappings", "unmapped_columns", "warnings"],
        }
        prompt_payload = {
            "filename": payload.filename,
            "headers": payload.headers,
            "sample_rows": payload.sample_rows[:6],
            "expected_fields": payload.expected_fields,
            "deterministic_mappings": payload.deterministic_mappings,
        }
        parsed = None
        if self.llm.enabled:
            parsed = await anyio.to_thread.run_sync(
                self._llm_json,
                IMPORT_COLUMN_MAPPING_PROMPT.format(payload_json=json.dumps(prompt_payload, ensure_ascii=False)),
                schema,
                0.1,
            )
        if isinstance(parsed, dict):
            llm_used = True
            parsed_mappings = parsed.get("mappings") or []
            if isinstance(parsed_mappings, list) and parsed_mappings:
                mappings = [dict(row) for row in parsed_mappings if isinstance(row, dict)]
            parsed_unmapped = parsed.get("unmapped_columns") or []
            if isinstance(parsed_unmapped, list):
                unmapped = [str(item).strip() for item in parsed_unmapped if str(item).strip()]
            parsed_warnings = parsed.get("warnings") or []
            if isinstance(parsed_warnings, list):
                warnings = [str(item).strip() for item in parsed_warnings if str(item).strip()]

        return ImportColumnMappingResponse(
            mappings=mappings[:120],
            unmapped_columns=unmapped[:120],
            warnings=warnings[:40],
            llm_used=llm_used,
        )

    async def detect_missing_inventory_data(self, payload: MissingDataDetectorRequest) -> MissingDataDetectorResponse:
        report = payload.report or {}
        summary = f"Detected {int(report.get('totalIssues') or 0)} issue(s), including {int(report.get('criticalIssues') or 0)} critical."
        recommendations = [
            str(item).strip()
            for item in (report.get("recommendations") or [])
            if str(item).strip()
        ]
        confidence = self._confidence_label(report.get("confidence"), "medium")
        llm_used = False

        schema = {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "recommendations": {"type": "array", "items": {"type": "string"}},
                "confidence": {"type": "string"},
            },
            "required": ["summary", "recommendations", "confidence"],
        }
        parsed = None
        if self.llm.enabled:
            parsed = await anyio.to_thread.run_sync(
                self._llm_json,
                MISSING_DATA_DETECTOR_PROMPT.format(payload_json=json.dumps({"report": report}, ensure_ascii=False)),
                schema,
                0.1,
            )
        if isinstance(parsed, dict):
            llm_used = True
            summary = str(parsed.get("summary") or summary).strip() or summary
            recommendations = [str(item).strip() for item in (parsed.get("recommendations") or []) if str(item).strip()] or recommendations
            confidence = self._confidence_label(parsed.get("confidence"), confidence)

        return MissingDataDetectorResponse(
            summary=summary,
            recommendations=recommendations[:20],
            confidence=confidence,
            llm_used=llm_used,
        )

    async def maintenance_recommendations(self, payload: MaintenanceRecommendationRequest) -> MaintenanceRecommendationResponse:
        recs = payload.recommendations or []
        summary = f"Prepared {len(recs)} maintenance recommendation(s)." if recs else "Not enough data for actionable maintenance recommendations."
        confidence = "medium" if recs else "low"
        llm_used = False
        schema = {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "confidence": {"type": "string"},
            },
            "required": ["summary", "confidence"],
        }
        parsed = None
        if self.llm.enabled:
            parsed = await anyio.to_thread.run_sync(
                self._llm_json,
                MAINTENANCE_RECOMMENDATION_PROMPT.format(payload_json=json.dumps({"recommendations": recs[:80]}, ensure_ascii=False)),
                schema,
                0.1,
            )
        if isinstance(parsed, dict):
            llm_used = True
            summary = str(parsed.get("summary") or summary).strip() or summary
            confidence = self._confidence_label(parsed.get("confidence"), confidence)
        return MaintenanceRecommendationResponse(summary=summary, confidence=confidence, llm_used=llm_used)

    async def procurement_recommendations(self, payload: ProcurementRecommendationRequest) -> ProcurementRecommendationResponse:
        recs = payload.recommended_purchases or []
        summary = f"Prepared {len(recs)} procurement recommendation(s)." if recs else "No urgent procurement recommendations from current deterministic inputs."
        confidence = "medium" if recs else "low"
        missing_data: list[str] = []
        llm_used = False
        schema = {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "missing_data": {"type": "array", "items": {"type": "string"}},
                "confidence": {"type": "string"},
            },
            "required": ["summary", "missing_data", "confidence"],
        }
        parsed = None
        if self.llm.enabled:
            parsed = await anyio.to_thread.run_sync(
                self._llm_json,
                PROCUREMENT_RECOMMENDATION_PROMPT.format(payload_json=json.dumps({"recommended_purchases": recs[:80]}, ensure_ascii=False)),
                schema,
                0.1,
            )
        if isinstance(parsed, dict):
            llm_used = True
            summary = str(parsed.get("summary") or summary).strip() or summary
            missing_data = [str(item).strip() for item in (parsed.get("missing_data") or []) if str(item).strip()]
            confidence = self._confidence_label(parsed.get("confidence"), confidence)

        return ProcurementRecommendationResponse(
            summary=summary,
            missing_data=missing_data[:20],
            confidence=confidence,
            llm_used=llm_used,
        )

    async def explain_duplicate_assets(self, payload: DuplicateExplanationRequest) -> DuplicateExplanationResponse:
        groups = payload.duplicate_groups or []
        summary = payload.summary or (
            f"Detected {len(groups)} duplicate/similarity group(s)." if groups else "No likely duplicates detected."
        )
        confidence = "medium" if groups else "low"
        llm_used = False
        schema = {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "confidence": {"type": "string"},
            },
            "required": ["summary", "confidence"],
        }
        parsed = None
        if self.llm.enabled:
            parsed = await anyio.to_thread.run_sync(
                self._llm_json,
                DUPLICATE_EXPLANATION_PROMPT.format(payload_json=json.dumps({"duplicate_groups": groups[:80], "summary": payload.summary}, ensure_ascii=False)),
                schema,
                0.1,
            )
        if isinstance(parsed, dict):
            llm_used = True
            summary = str(parsed.get("summary") or summary).strip() or summary
            confidence = self._confidence_label(parsed.get("confidence"), confidence)
        return DuplicateExplanationResponse(summary=summary, confidence=confidence, llm_used=llm_used)

    async def natural_language_inventory_search(self, payload: NaturalLanguageInventorySearchRequest) -> NaturalLanguageInventorySearchResponse:
        answer = payload.fallback_answer or "No deterministic answer was provided."
        confidence = "medium" if payload.candidate_results else "low"
        llm_used = False
        schema = {
            "type": "object",
            "properties": {
                "answer": {"type": "string"},
                "confidence": {"type": "string"},
            },
            "required": ["answer", "confidence"],
        }
        parsed = None
        if self.llm.enabled:
            parsed = await anyio.to_thread.run_sync(
                self._llm_json,
                NATURAL_LANGUAGE_SEARCH_PROMPT.format(payload_json=json.dumps({
                    "query": payload.query,
                    "interpreted_filters": payload.interpreted_filters,
                    "candidate_results": payload.candidate_results[:80],
                    "fallback_answer": payload.fallback_answer,
                }, ensure_ascii=False)),
                schema,
                0.1,
            )
        if isinstance(parsed, dict):
            llm_used = True
            answer = str(parsed.get("answer") or answer).strip() or answer
            confidence = self._confidence_label(parsed.get("confidence"), confidence)
        return NaturalLanguageInventorySearchResponse(answer=answer, confidence=confidence, llm_used=llm_used)

    async def extract_assets_from_document_text(self, payload: DocumentExtractionRequest) -> DocumentExtractionResponse:
        text = str(payload.document_text or "").strip()
        deterministic_rows = payload.deterministic_rows or []
        summary = f"Document text processed with {len(deterministic_rows)} deterministic candidate row(s)."
        confidence = 0.55 if deterministic_rows else 0.35
        warnings: list[str] = []
        missing_fields: list[str] = []
        extracted_rows = [dict(row) for row in deterministic_rows[:250]]
        llm_used = False

        if not text:
            warnings.append("Document text is empty.")
            return DocumentExtractionResponse(
                source_document_summary=summary,
                confidence=0.2,
                warnings=warnings,
                missing_fields=["documentText"],
                extracted_rows=[],
                llm_used=False,
            )

        schema = {
            "type": "object",
            "properties": {
                "source_document_summary": {"type": "string"},
                "confidence": {"type": "number"},
                "warnings": {"type": "array", "items": {"type": "string"}},
                "missing_fields": {"type": "array", "items": {"type": "string"}},
                "extracted_rows": {"type": "array", "items": {"type": "object"}},
            },
            "required": ["source_document_summary", "confidence", "warnings", "missing_fields", "extracted_rows"],
        }
        parsed = None
        if self.llm.enabled and len(text) <= 50000:
            parsed = await anyio.to_thread.run_sync(
                self._llm_json,
                DOCUMENT_EXTRACTION_PROMPT.format(payload_json=json.dumps({
                    "filename": payload.filename,
                    "document_text": text[:50000],
                    "deterministic_rows": deterministic_rows[:80],
                }, ensure_ascii=False)),
                schema,
                0.1,
            )

        if isinstance(parsed, dict):
            llm_used = True
            summary = str(parsed.get("source_document_summary") or summary).strip() or summary
            parsed_confidence = float(parsed.get("confidence") or confidence)
            confidence = max(0.0, min(1.0, parsed_confidence))
            warnings = [str(item).strip() for item in (parsed.get("warnings") or []) if str(item).strip()] or warnings
            missing_fields = [str(item).strip() for item in (parsed.get("missing_fields") or []) if str(item).strip()] or missing_fields
            parsed_rows = parsed.get("extracted_rows") or []
            if isinstance(parsed_rows, list) and parsed_rows:
                extracted_rows = [dict(row) for row in parsed_rows if isinstance(row, dict)][:250]

        return DocumentExtractionResponse(
            source_document_summary=summary,
            confidence=max(0.0, min(1.0, confidence)),
            warnings=warnings[:30],
            missing_fields=missing_fields[:20],
            extracted_rows=extracted_rows[:250],
            llm_used=llm_used,
        )

    async def extract_specs_from_source(self, payload: SourceSpecExtractionRequest) -> SourceSpecExtractionResponse:
        warnings: list[str] = []
        source_text = str(payload.source_text or "").strip()
        expected_fields = [str(field).strip() for field in (payload.expected_fields or []) if str(field).strip()]
        not_applicable_fields = [str(field).strip() for field in (payload.not_applicable_fields or []) if str(field).strip()]

        if not source_text:
            return SourceSpecExtractionResponse(
                normalized_specs={},
                specs_text="",
                confidence=0.35,
                extracted_fields=[],
                missing_important_fields=expected_fields[:8],
                warnings=["Source text is empty; cannot extract reliable specifications."],
                evidence_reason="No source text available for extraction.",
                exact_model_matched=False,
                llm_used=False,
            )

        normalized_response = await self.normalize_specs(
            SpecNormalizationRequest.model_validate(
                {
                    "assetType": payload.asset_type,
                    "brand": payload.brand,
                    "model": payload.model,
                    "rawSpecsText": source_text,
                    "expectedFields": expected_fields,
                    "notApplicableFields": not_applicable_fields,
                    "currentSpecs": {},
                }
            )
        )

        normalized_specs = dict(normalized_response.normalized_specs or {})
        if not normalized_specs:
            regex_fallback = self._extract_known_fields_from_source_text(source_text, expected_fields)
            if regex_fallback:
                normalized_specs = regex_fallback
                warnings.append("Used deterministic text-pattern extraction fallback.")

        coverage_score = self._model_coverage_score(
            payload.model or "",
            f"{payload.source_url} {payload.source_domain} {payload.source_text[:20000]}",
        )
        broad_family_input = self._is_broad_family_model(payload.model or "")
        exact_model_matched = coverage_score >= 0.75 and not broad_family_input
        confidence = clamp_confidence(normalized_response.confidence, 0.45 if normalized_specs else 0.35)

        if broad_family_input:
            warnings.append("Model input appears family-level/broad; provide generation/year/SKU for exact verification.")
            confidence = min(confidence, 0.7)

        if not exact_model_matched:
            confidence = min(confidence, 0.74)
            warnings.append("Exact model match is weak or unclear in source content.")

        if not normalized_specs:
            confidence = min(confidence, 0.45)
            warnings.append("No structured specs could be extracted from source text.")

        llm_output = None
        should_try_llm = (
            self.llm.enabled
            and (not normalized_specs or len(normalized_specs) < 2)
            and len(source_text) <= 20000
        )
        if self.llm.enabled and not should_try_llm and len(source_text) > 20000:
            warnings.append("Skipped LLM extraction for very large source text; used deterministic extraction path.")
        if should_try_llm:
            schema = {
                "type": "object",
                "properties": {
                    "normalized_specs": {"type": "object"},
                    "warnings": {"type": "array", "items": {"type": "string"}},
                    "missing_important_fields": {"type": "array", "items": {"type": "string"}},
                    "confidence": {"type": "number"},
                    "exact_model_matched": {"type": "boolean"},
                    "evidence_reason": {"type": "string"},
                },
                "required": [
                    "normalized_specs",
                    "warnings",
                    "missing_important_fields",
                    "confidence",
                    "exact_model_matched",
                    "evidence_reason",
                ],
            }
            prompt_payload = {
                "asset_type": payload.asset_type,
                "brand": payload.brand,
                "model": payload.model,
                "source_url": payload.source_url,
                "source_domain": payload.source_domain,
                "source_text": source_text[:20000],
                "expected_fields": expected_fields,
                "not_applicable_fields": not_applicable_fields,
            }
            llm_output = await anyio.to_thread.run_sync(
                self._llm_json,
                SPEC_SOURCE_EXTRACTION_PROMPT.format(payload_json=json.dumps(prompt_payload, ensure_ascii=False)),
                schema,
                0.1,
            )

        llm_used = False
        if isinstance(llm_output, dict):
            llm_specs = llm_output.get("normalized_specs") or {}
            if isinstance(llm_specs, dict):
                safe_specs: dict[str, str] = {}
                expected_norm = {self._norm(field): str(field) for field in expected_fields}
                not_applicable_norm = {self._norm(field) for field in not_applicable_fields}
                for key, value in llm_specs.items():
                    canonical = self._canonical_field_name(str(key))
                    val = str(value or "").strip()
                    if not canonical or not val:
                        continue
                    norm_key = self._norm(canonical)
                    if norm_key in not_applicable_norm:
                        continue
                    if expected_norm and norm_key not in expected_norm:
                        continue
                    safe_specs[expected_norm.get(norm_key, canonical)] = val
                if safe_specs:
                    normalized_specs = safe_specs
                    llm_used = True

            llm_conf = clamp_confidence(llm_output.get("confidence"), confidence)
            if exact_model_matched and not broad_family_input:
                confidence = max(confidence, min(llm_conf, 0.92))
            else:
                confidence = max(confidence, min(llm_conf, 0.72))

            llm_exact = bool(llm_output.get("exact_model_matched", exact_model_matched))
            exact_model_matched = bool(llm_exact and coverage_score >= 0.65 and not broad_family_input)
            for warning in llm_output.get("warnings") or []:
                safe = str(warning or "").strip()
                if safe and safe not in warnings:
                    warnings.append(safe)

        normalized_keys = {self._norm(self._canonical_field_name(field)) for field in normalized_specs.keys()}
        missing_important_fields = []
        if expected_fields:
            for field in expected_fields:
                canonical_expected = self._canonical_field_name(field)
                if self._norm(canonical_expected) not in normalized_keys:
                    missing_important_fields.append(canonical_expected)

        unknown_markers = {"n/a", "na", "unknown", "not specified", "pending"}
        unknown_like_count = 0
        for value in normalized_specs.values():
            norm_value = str(value or "").strip().lower()
            if not norm_value:
                unknown_like_count += 1
                continue
            if any(marker in norm_value for marker in unknown_markers):
                unknown_like_count += 1
        if unknown_like_count > 0:
            confidence = min(confidence, 0.75)
            warnings.append("Some extracted fields are placeholders/unknown values and require verification.")

        generation_mentions = re.findall(r"\b(gen(?:eration)?\s?\d+|20\d{2}|m[1234])\b", source_text.lower())
        if len(set(generation_mentions)) >= 2:
            confidence = min(confidence, 0.68)
            warnings.append("Source content appears to include multiple generations/variants; confirm exact model/SKU.")

        if coverage_score < 0.35:
            confidence = min(confidence, 0.62)
            warnings.append("Model token match against source text is low.")
        elif coverage_score < 0.55:
            confidence = min(confidence, 0.7)
            warnings.append("Model token match is partial; likely family-level evidence.")

        evidence_reason = (
            "Specs extracted from trusted source text."
            if exact_model_matched and normalized_specs
            else "Source text extracted, but exact model match/evidence is limited or family-level; manual verification required."
        )

        return SourceSpecExtractionResponse(
            normalized_specs=normalized_specs,
            specs_text=self._format_specs(normalized_specs),
            confidence=clamp_confidence(confidence, 0.35),
            extracted_fields=list(normalized_specs.keys()),
            missing_important_fields=missing_important_fields[:20],
            warnings=(list(dict.fromkeys(warnings + list(normalized_response.warnings or []))))[:20],
            evidence_reason=evidence_reason,
            exact_model_matched=exact_model_matched,
            llm_used=llm_used or bool(normalized_response.llm_used),
        )

