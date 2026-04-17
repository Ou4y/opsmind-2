"""
OpsMind AI Service — FastAPI application.

Exposes prediction endpoints and health checks.
Swagger UI is available at ``/docs``.
"""

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import AsyncGenerator

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from src.models import get_store, load_models
from src.preprocess import INT_TO_PRIORITY, preprocess_for_inference
from src.schemas import (
    ActivitySummaryResponse,
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
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

APP_VERSION = "1.0.0"


SLA_RESOLUTION_TARGET_HOURS = {
    "HIGH": 4.0,
    "MEDIUM": 24.0,
    "LOW": 72.0,
}


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


# ── Lifespan ─────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Load ML models into memory on startup."""
    try:
        load_models()
        logger.info("Models loaded — service is ready.")
    except FileNotFoundError as exc:
        logger.error("Model loading failed: %s", exc)
        logger.warning("Service starting WITHOUT models. /predict will return 503.")
    yield


# ── App ──────────────────────────────────────────────────────────────────────

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


# ── Endpoints ────────────────────────────────────────────────────────────────


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
        status="ok" if store.is_loaded else "degraded",
        models_loaded=store.is_loaded,
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


# ── Frontend-facing /ai/* endpoints ─────────────────────────────────────────


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


# ── SLA risk + feedback endpoints (used by AI Insights page) ───────────────


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
