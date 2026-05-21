"""Prediction endpoints (ticket, asset lifespan, and spec inference)."""

from __future__ import annotations

import logging
import time

from fastapi import APIRouter, HTTPException, Request

from src.models import get_store
from src.schemas import (
    AssetLifespanRequest,
    AssetLifespanResponse,
    AssetSpecFeedbackRequest,
    AssetSpecFeedbackResponse,
    AssetSpecInferenceRequest,
    AssetSpecInferenceResponse,
    AssetSpecMetricsResponse,
    PredictionResponse,
    TicketInput,
)


logger = logging.getLogger(__name__)
router = APIRouter(tags=["Prediction"])


@router.post(
    "/predict",
    response_model=PredictionResponse,
    summary="Predict ticket priority and estimated resolution time",
)
async def predict(ticket: TicketInput, request: Request) -> PredictionResponse:
    started = time.perf_counter()
    store = get_store()
    if not store.is_loaded:
        raise HTTPException(
            status_code=503,
            detail="Models are not loaded. Please train and deploy models first.",
        )

    ticket_service = request.app.state.ticket_service
    try:
        ticket_data = ticket_service.ticket_dict_from_ticket_input(ticket)
        features = ticket_service.build_features(ticket_data)
        priority_label, priority_confidence = ticket_service.predict_priority(features)
        est_hours = ticket_service.predict_estimated_resolution_hours(features)
        return PredictionResponse(
            suggested_priority=priority_label,
            priority_confidence=priority_confidence,
            estimated_resolution_hours=est_hours,
        )
    except Exception as exc:
        logger.exception("Prediction failed")
        raise HTTPException(status_code=500, detail=f"Prediction error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "predict"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "predict"},
        )


@router.post(
    "/predict-asset-lifespan",
    response_model=AssetLifespanResponse,
    summary="Predict asset lifespan from asset profile and telemetry",
)
async def predict_asset_lifespan(asset: AssetLifespanRequest, request: Request) -> AssetLifespanResponse:
    started = time.perf_counter()
    service = request.app.state.lifespan_service
    try:
        return service.predict_asset_lifespan(asset)
    except Exception as exc:
        logger.exception("Asset lifespan prediction failed")
        raise HTTPException(status_code=500, detail=f"Asset prediction error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "predict_asset_lifespan"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "predict_asset_lifespan"},
        )


@router.post(
    "/infer-asset-specs",
    response_model=AssetSpecInferenceResponse,
    summary="Infer likely asset specifications from name/brand/model/type",
)
async def infer_asset_specs(payload: AssetSpecInferenceRequest, request: Request) -> AssetSpecInferenceResponse:
    started = time.perf_counter()
    service = request.app.state.spec_service
    try:
        return await service.infer_asset_specs(payload)
    except Exception as exc:
        logger.exception("Asset specification inference failed")
        raise HTTPException(status_code=500, detail=f"Asset spec inference error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "infer_asset_specs"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "infer_asset_specs"},
        )


@router.post(
    "/feedback/spec-verification",
    response_model=AssetSpecFeedbackResponse,
    summary="Store human verification feedback for asset specs",
)
async def spec_verification_feedback(
    payload: AssetSpecFeedbackRequest,
    request: Request,
) -> AssetSpecFeedbackResponse:
    service = request.app.state.spec_service
    try:
        return service.submit_feedback(payload)
    except Exception as exc:
        logger.exception("Failed to persist spec verification feedback")
        raise HTTPException(status_code=500, detail=f"Spec feedback error: {exc}") from exc


@router.get(
    "/metrics/spec-inference",
    response_model=AssetSpecMetricsResponse,
    summary="Evaluate precision/recall by field from golden dataset",
)
async def spec_inference_metrics(request: Request, variant: str | None = None) -> AssetSpecMetricsResponse:
    service = request.app.state.spec_service
    try:
        return service.spec_inference_metrics(variant=variant)
    except Exception as exc:
        logger.exception("Failed to compute spec inference metrics")
        raise HTTPException(status_code=500, detail=f"Spec metrics error: {exc}") from exc
