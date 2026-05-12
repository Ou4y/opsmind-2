"""
OpsMind AI Service — FastAPI application.

Exposes model prediction and AI helper endpoints.
Swagger UI is available at ``/docs``.
"""

from __future__ import annotations

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
    SimilarTicketsResponse,
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


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Load ML pipelines into memory on startup."""
    try:
        load_models()
        logger.info("Pipelines loaded — service is ready.")
    except FileNotFoundError as exc:
        logger.error("Model loading failed: %s", exc)
        logger.warning("Service starting WITHOUT models. /predict will return 503.")
    yield


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


def _ticket_dict_from_ticket_input(ticket: TicketInput) -> dict:
    ticket_data = ticket.model_dump()
    created_at = ticket_data.get("created_at")
    if isinstance(created_at, datetime):
        created_at_dt = created_at
    else:
        created_at_dt = datetime.now(timezone.utc)

    ticket_data["created_at"] = created_at_dt.isoformat()
    return ticket_data


def _build_features(ticket_data: dict):
    return preprocess_for_inference(data=ticket_data)


def _predict_priority(features) -> tuple[str, float]:
    store = get_store()

    predicted_priority = int(store.priority_pipeline.predict(features)[0])
    priority_label = INT_TO_PRIORITY.get(predicted_priority, "LOW")

    priority_confidence = 0.0
    if hasattr(store.priority_pipeline, "predict_proba"):
        priority_proba = store.priority_pipeline.predict_proba(features)[0]

        classes = getattr(store.priority_pipeline, "classes_", None)
        if classes is None and hasattr(store.priority_pipeline, "named_steps"):
            model = store.priority_pipeline.named_steps.get("model")
            classes = getattr(model, "classes_", None)

        if classes is not None:
            classes_list = [int(c) for c in list(classes)]
            if predicted_priority in classes_list:
                class_index = classes_list.index(predicted_priority)
            else:
                class_index = int(np.argmax(priority_proba))
        else:
            class_index = int(np.argmax(priority_proba))

        priority_confidence = round(float(priority_proba[class_index]), 4)

    return priority_label, priority_confidence


def _predict_estimated_resolution_hours(features) -> float:
    store = get_store()
    est_hours = float(store.est_pipeline.predict(features)[0])
    return round(max(est_hours, 0.0), 2)


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
    """Predict priority and estimated resolution time for a new ticket."""
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


@app.get(
    "/ai/recommendations/count",
    response_model=RecommendationsCountResponse,
    tags=["AI"],
    summary="Count pending AI recommendations",
)
async def recommendations_count() -> RecommendationsCountResponse:
    return RecommendationsCountResponse(count=0, pending=0)


@app.get(
    "/ai/recommendations/{ticket_id}",
    response_model=list[RecommendationItem],
    tags=["AI"],
    summary="Get AI recommendations for a ticket (by id)",
)
async def get_recommendations(ticket_id: str) -> list[RecommendationItem]:
    return [
        RecommendationItem(
            text=f"Review ticket {ticket_id} details and ensure reproduction steps are captured."
        ),
        RecommendationItem(text="If blocked at L1, consider escalating to L2 for faster triage."),
        RecommendationItem(
            text="Attach logs/screenshots and recent change history to reduce back-and-forth."
        ),
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

    recs: list[str] = []
    if predicted_priority == "CRITICAL":
        recs.append("Critical urgency detected: page on-call owner and escalate immediately.")
    elif predicted_priority == "HIGH":
        recs.append("High urgency detected: assign a senior technician or escalate early.")

    if predicted_priority in {"MEDIUM", "HIGH", "CRITICAL"}:
        recs.append("Start triage now: confirm impact, scope, and a reliable reproduction path.")

    if str(ticket.type_of_request).upper() == "INCIDENT":
        recs.append("Follow incident checklist: recent changes, auth/network status, and service health.")

    recs.append("Add clear next steps and request missing details (device/OS/app version, timestamps).")

    return [RecommendationItem(text=text) for text in recs]


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
        "transformed_feature_count": len(store.transformed_feature_names),
        "transformed_feature_names": store.transformed_feature_names,
        "removed_feature_names": store.removed_feature_names,
        "priority_labels": store.priority_labels,
        "selected_priority_model": store.selected_priority_model_name,
        "selected_est_model": store.selected_est_model_name,
    }


@app.post(
    "/ai/suggest-category",
    response_model=SuggestCategoryResponse,
    tags=["AI"],
    summary="Suggest a category from free-text description",
)
async def suggest_category(payload: SuggestCategoryRequest) -> SuggestCategoryResponse:
    text = payload.description.lower()
    if any(keyword in text for keyword in ["vpn", "wifi", "network", "internet"]):
        return SuggestCategoryResponse(category="NETWORK", confidence=0.65)
    if any(keyword in text for keyword in ["password", "login", "auth", "mfa"]):
        return SuggestCategoryResponse(category="ACCESS", confidence=0.60)
    if any(keyword in text for keyword in ["email", "outlook", "smtp", "imap"]):
        return SuggestCategoryResponse(category="EMAIL", confidence=0.60)
    return SuggestCategoryResponse(category="GENERAL", confidence=0.40)


@app.post(
    "/ai/suggest-priority",
    response_model=SuggestPriorityResponse,
    tags=["AI"],
    summary="Suggest a priority from subject + description",
)
async def suggest_priority(payload: SuggestPriorityRequest) -> SuggestPriorityResponse:
    text = f"{payload.subject} {payload.description}".lower()

    critical_keywords = [
        "critical",
        "sev1",
        "system down",
        "major outage",
        "all users",
        "security breach",
    ]
    high_keywords = ["outage", "down", "production"]
    medium_keywords = ["cannot", "unable", "fails", "error"]

    if any(keyword in text for keyword in critical_keywords):
        return SuggestPriorityResponse(
            suggested_priority="CRITICAL",
            confidence=0.80,
            reasoning="Detected critical-impact keywords.",
        )

    if any(keyword in text for keyword in high_keywords):
        return SuggestPriorityResponse(
            suggested_priority="HIGH",
            confidence=0.70,
            reasoning="Detected outage or production-impact keywords.",
        )

    if any(keyword in text for keyword in medium_keywords):
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
