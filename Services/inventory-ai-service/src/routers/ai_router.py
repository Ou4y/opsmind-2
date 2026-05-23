"""Frontend-facing AI helper endpoints."""

from __future__ import annotations

import logging
import time

from fastapi import APIRouter, HTTPException, Request

from src.models import get_store
from src.schemas import (
    ActivitySummaryResponse,
    PredictResolutionResponse,
    RecommendationItem,
    RecommendationsCountResponse,
    SimilarTicketsResponse,
    SuggestCategoryRequest,
    SuggestCategoryResponse,
    SuggestPriorityRequest,
    SuggestPriorityResponse,
    TicketInput,
)


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["AI"])


@router.get(
    "/recommendations/count",
    response_model=RecommendationsCountResponse,
    summary="Count pending AI recommendations",
)
async def recommendations_count() -> RecommendationsCountResponse:
    return RecommendationsCountResponse(count=0, pending=0)


@router.get(
    "/recommendations/{ticket_id}",
    response_model=list[RecommendationItem],
    summary="Get AI recommendations for a ticket (by id)",
)
async def get_recommendations(ticket_id: str) -> list[RecommendationItem]:
    return [
        RecommendationItem(text=f"Review ticket {ticket_id} details and ensure reproduction steps are captured."),
        RecommendationItem(text="If blocked at L1, consider escalating to L2 for faster triage."),
        RecommendationItem(text="Attach logs/screenshots and recent change history to reduce back-and-forth."),
    ]


@router.post(
    "/recommendations",
    response_model=list[RecommendationItem],
    summary="Get AI recommendations for a ticket (payload)",
)
async def get_recommendations_for_payload(ticket: TicketInput, request: Request) -> list[RecommendationItem]:
    started = time.perf_counter()
    store = get_store()
    if not store.is_loaded:
        raise HTTPException(status_code=503, detail="Models are not loaded")

    ticket_service = request.app.state.ticket_service
    try:
        return await ticket_service.recommendations_for_payload(ticket)
    except Exception as exc:
        logger.exception("AI recommendations failed")
        raise HTTPException(status_code=500, detail=f"Recommendations error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "ai_recommendations"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "ai_recommendations"},
        )


@router.get(
    "/insights",
    summary="Basic AI service insights",
)
async def insights() -> dict:
    store = get_store()
    return {
        "models_loaded": store.is_loaded,
        "feature_count": len(store.feature_names),
        "feature_names": store.feature_names,
    }


@router.post(
    "/suggest-category",
    response_model=SuggestCategoryResponse,
    summary="Suggest a category from free-text description",
)
async def suggest_category(payload: SuggestCategoryRequest, request: Request) -> SuggestCategoryResponse:
    started = time.perf_counter()
    service = request.app.state.ticket_service
    try:
        return await service.suggest_category(payload)
    except Exception as exc:
        logger.exception("Category suggestion failed")
        raise HTTPException(status_code=500, detail=f"Category suggestion error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "ai_suggest_category"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "ai_suggest_category"},
        )


@router.post(
    "/suggest-priority",
    response_model=SuggestPriorityResponse,
    summary="Suggest a priority from subject + description",
)
async def suggest_priority(payload: SuggestPriorityRequest, request: Request) -> SuggestPriorityResponse:
    started = time.perf_counter()
    service = request.app.state.ticket_service
    try:
        return await service.suggest_priority(payload)
    except Exception as exc:
        logger.exception("Priority suggestion failed")
        raise HTTPException(status_code=500, detail=f"Priority suggestion error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "ai_suggest_priority"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "ai_suggest_priority"},
        )


@router.get(
    "/similar-tickets/{ticket_id}",
    response_model=SimilarTicketsResponse,
    summary="Find similar tickets (placeholder)",
)
async def similar_tickets(ticket_id: str, limit: int = 5) -> SimilarTicketsResponse:
    return SimilarTicketsResponse(tickets=[])


@router.get(
    "/activity-summary/{ticket_id}",
    response_model=ActivitySummaryResponse,
    summary="Summarize ticket activity (placeholder)",
)
async def activity_summary(ticket_id: str) -> ActivitySummaryResponse:
    return ActivitySummaryResponse(summary="No activity summary available yet.")


@router.post(
    "/predict-resolution",
    response_model=PredictResolutionResponse,
    summary="Predict resolution time (hours)",
)
async def predict_resolution(ticket: TicketInput, request: Request) -> PredictResolutionResponse:
    store = get_store()
    if not store.is_loaded:
        raise HTTPException(status_code=503, detail="Models are not loaded")
    service = request.app.state.ticket_service
    ticket_data = service.ticket_dict_from_ticket_input(ticket)
    features = service.build_features(ticket_data)
    est_hours = service.predict_estimated_resolution_hours(features)
    return PredictResolutionResponse(estimated_resolution_hours=est_hours)


@router.get(
    "/suggested-responses/{ticket_id}",
    summary="Suggested response templates",
)
async def suggested_responses(ticket_id: str, request: Request) -> list[str]:
    service = request.app.state.ticket_service
    try:
        return await service.suggested_responses(ticket_id)
    except Exception as exc:
        logger.exception("Suggested responses failed")
        raise HTTPException(status_code=500, detail=f"Suggested responses error: {exc}") from exc
