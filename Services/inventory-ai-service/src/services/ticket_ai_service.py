"""Ticket-focused prediction and AI helper service."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import anyio
import numpy as np

from src.config import AppSettings
from src.llm.client_protocol import LLMClientProtocol
from src.llm.prompts import (
    CATEGORY_PROMPT,
    PRIORITY_PROMPT,
    RECOMMENDATIONS_PROMPT,
    SUGGESTED_RESPONSES_PROMPT,
)
from src.llm.validators import clamp_confidence
from src.models import get_store
from src.preprocess import INT_TO_PRIORITY, preprocess_for_inference
from src.schemas import (
    RecommendationItem,
    SLAPredictRequest,
    SLAPredictResponse,
    SuggestCategoryRequest,
    SuggestCategoryResponse,
    SuggestPriorityRequest,
    SuggestPriorityResponse,
    TicketInput,
)


class TicketAIService:
    def __init__(self, settings: AppSettings, llm: LLMClientProtocol) -> None:
        self.settings = settings
        self.llm = llm

    @staticmethod
    def normalise_priority_label(value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = str(value).strip().upper()
        if cleaned == "CRITICAL":
            return "HIGH"
        if cleaned in {"LOW", "MEDIUM", "HIGH"}:
            return cleaned
        return None

    @staticmethod
    def ticket_dict_from_ticket_input(ticket: TicketInput) -> dict[str, Any]:
        ticket_data = ticket.model_dump()
        created_at = ticket_data.get("created_at")
        if isinstance(created_at, datetime):
            created_at_dt = created_at
        else:
            created_at_dt = datetime.now(timezone.utc)
        ticket_data["created_at"] = created_at_dt.isoformat()
        return ticket_data

    def build_features(self, ticket_data: dict[str, Any]):
        store = get_store()
        return preprocess_for_inference(
            data=ticket_data,
            ohe_columns=store.ohe_columns,
            feature_names=store.feature_names,
        )

    def predict_priority(self, features) -> tuple[str, float]:
        store = get_store()
        predicted_priority = int(store.priority_model.predict(features)[0])
        priority_label = INT_TO_PRIORITY.get(predicted_priority, "UNKNOWN")
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

    def predict_estimated_resolution_hours(self, features) -> float:
        store = get_store()
        est_hours = float(store.est_model.predict(features)[0])
        return round(max(est_hours, 0.0), 2)

    @staticmethod
    def sla_probability_from_ratio(ratio: float) -> float:
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

    async def gemini_json(self, prompt: str, schema: dict, temperature: float = 0.2) -> dict | None:
        if not self.llm.enabled:
            return None
        return await anyio.to_thread.run_sync(self.llm.generate_json, prompt, schema, temperature)

    async def suggest_category(self, payload: SuggestCategoryRequest) -> SuggestCategoryResponse:
        schema = {
            "type": "object",
            "properties": {
                "category": {"type": "string"},
                "confidence": {"type": "number"},
                "reasoning": {"type": "string"},
            },
            "required": ["category", "confidence"],
        }
        parsed = await self.gemini_json(
            CATEGORY_PROMPT.format(description=payload.description),
            schema,
            temperature=0.1,
        )
        if parsed:
            category = str(parsed.get("category") or "").strip().upper()
            if category in {"NETWORK", "ACCESS", "EMAIL", "GENERAL"}:
                return SuggestCategoryResponse(
                    category=category,
                    confidence=clamp_confidence(parsed.get("confidence"), 0.5),
                )

        text = payload.description.lower()
        if any(k in text for k in ["vpn", "wifi", "network", "internet"]):
            return SuggestCategoryResponse(category="NETWORK", confidence=0.65)
        if any(k in text for k in ["password", "login", "auth", "mfa"]):
            return SuggestCategoryResponse(category="ACCESS", confidence=0.6)
        if any(k in text for k in ["email", "outlook", "smtp", "imap"]):
            return SuggestCategoryResponse(category="EMAIL", confidence=0.6)
        return SuggestCategoryResponse(category="GENERAL", confidence=0.4)

    async def suggest_priority(self, payload: SuggestPriorityRequest) -> SuggestPriorityResponse:
        schema = {
            "type": "object",
            "properties": {
                "suggested_priority": {"type": "string"},
                "confidence": {"type": "number"},
                "reasoning": {"type": "string"},
            },
            "required": ["suggested_priority", "confidence"],
        }
        parsed = await self.gemini_json(
            PRIORITY_PROMPT.format(subject=payload.subject, description=payload.description),
            schema,
            temperature=0.1,
        )
        if parsed:
            priority = str(parsed.get("suggested_priority") or "").strip().upper()
            if priority in {"LOW", "MEDIUM", "HIGH"}:
                return SuggestPriorityResponse(
                    suggested_priority=priority,
                    confidence=clamp_confidence(parsed.get("confidence"), 0.5),
                    reasoning=str(parsed.get("reasoning") or "") or None,
                )

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

    async def recommendations_for_payload(self, ticket: TicketInput) -> list[RecommendationItem]:
        store = get_store()
        if not store.is_loaded:
            raise RuntimeError("Models are not loaded")

        ticket_data = self.ticket_dict_from_ticket_input(ticket)
        features = self.build_features(ticket_data)
        predicted_priority, _ = self.predict_priority(features)
        est_hours = self.predict_estimated_resolution_hours(features)

        schema = {
            "type": "object",
            "properties": {
                "recommendations": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["recommendations"],
        }
        parsed = await self.gemini_json(
            RECOMMENDATIONS_PROMPT.format(
                ticket_json=json.dumps(ticket_data, indent=2, default=str),
                predicted_priority=predicted_priority,
                estimated_resolution_hours=est_hours,
            ),
            schema,
            temperature=0.2,
        )
        items = (parsed or {}).get("recommendations") or []
        if isinstance(items, list) and items:
            recs = [RecommendationItem(text=str(item)) for item in items[:5] if str(item).strip()]
            if recs:
                return recs

        recs_fallback: list[str] = []
        if predicted_priority == "HIGH":
            recs_fallback.append("High urgency detected: assign a senior technician or escalate early.")
        if predicted_priority in {"MEDIUM", "HIGH"}:
            recs_fallback.append("Start triage now: confirm impact, scope, and a reliable reproduction path.")
        if str(ticket.type_of_request).upper() == "INCIDENT":
            recs_fallback.append("Follow incident checklist: recent changes, auth/network status, and service health.")

        sla_target = self.settings.sla_resolution_target_hours.get(predicted_priority, 24.0)
        if est_hours >= sla_target:
            recs_fallback.append("SLA breach risk: allocate resources or reroute to the right team immediately.")

        recs_fallback.append("Add clear next steps and request missing details (device/OS/app version, timestamps).")
        return [RecommendationItem(text=text) for text in recs_fallback]

    async def suggested_responses(self, ticket_id: str) -> list[str]:
        schema = {
            "type": "object",
            "properties": {
                "responses": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["responses"],
        }
        parsed = await self.gemini_json(
            SUGGESTED_RESPONSES_PROMPT.format(ticket_id=ticket_id),
            schema,
            temperature=0.3,
        )
        items = (parsed or {}).get("responses") or []
        if isinstance(items, list) and items:
            clean = [str(item) for item in items[:5] if str(item).strip()]
            if clean:
                return clean

        return [
            "Thanks for reporting this. Can you share the exact error message and when it started?",
            "Can you confirm whether this happens on multiple devices or users?",
            "We are investigating. We'll update you with next steps shortly.",
        ]

    def predict_sla(self, payload: SLAPredictRequest) -> SLAPredictResponse:
        store = get_store()
        if not store.is_loaded:
            pr = self.normalise_priority_label(payload.priority) or "MEDIUM"
            base = {"HIGH": 75.0, "MEDIUM": 45.0, "LOW": 20.0}.get(pr, 45.0)
            return SLAPredictResponse(
                sla_breach_probability=base,
                estimated_resolution_hours=None,
                sla_target_hours=self.settings.sla_resolution_target_hours.get(pr, 24.0),
                used_priority=pr,
            )

        created_at = payload.created_at or datetime.now(timezone.utc)
        ticket_data = {
            "title": payload.title or "(no title)",
            "description": payload.description or "(no description)",
            "building": None,
            "room": None,
            "type_of_request": payload.type_of_request or "INCIDENT",
            "support_level": payload.support_level or "L1",
            "created_at": created_at.isoformat(),
        }

        features = self.build_features(ticket_data)
        predicted_priority, _ = self.predict_priority(features)
        est_hours = self.predict_estimated_resolution_hours(features)

        requested_priority = self.normalise_priority_label(payload.priority)
        used_priority = requested_priority or predicted_priority
        sla_target = self.settings.sla_resolution_target_hours.get(used_priority, 24.0)
        ratio = (est_hours / sla_target) if sla_target > 0 else 0.0
        prob = self.sla_probability_from_ratio(ratio)

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
