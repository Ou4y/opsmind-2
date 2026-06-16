"""SLA risk and feedback endpoints."""

from __future__ import annotations

import logging
import time

from fastapi import APIRouter, HTTPException, Request

from src.schemas import SLAFeedbackRequest, SLAPredictRequest, SLAPredictResponse, StatusResponse


logger = logging.getLogger(__name__)
router = APIRouter(tags=["SLA"])


@router.post(
    "/predict-sla",
    response_model=SLAPredictResponse,
    summary="Predict SLA breach probability",
)
async def predict_sla(payload: SLAPredictRequest, request: Request) -> SLAPredictResponse:
    started = time.perf_counter()
    service = request.app.state.ticket_service
    try:
        return service.predict_sla(payload)
    except Exception as exc:
        logger.exception("SLA prediction failed")
        raise HTTPException(status_code=500, detail=f"SLA prediction error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "predict_sla"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "predict_sla"},
        )


@router.post(
    "/feedback/sla",
    response_model=StatusResponse,
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
