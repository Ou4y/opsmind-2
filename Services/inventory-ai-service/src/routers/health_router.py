"""Health and observability endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse

from src.models import get_store
from src.schemas import HealthResponse


router = APIRouter(tags=["Health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Service health check",
)
async def health(request: Request) -> HealthResponse:
    store = get_store()
    settings = request.app.state.settings
    llm = request.app.state.spec_service.llm
    llm_provider = str(getattr(settings, "llm_provider", "none") or "none")
    llm_enabled = bool(getattr(llm, "enabled", False))
    llm_model = getattr(llm, "model", None) if llm_enabled else None
    llm_status = str(getattr(llm, "status", "disabled"))
    llm_last_error = str(getattr(llm, "last_error", "") or "") or None
    using_gemini = llm_provider == "gemini"
    return HealthResponse(
        status="ok" if (store.is_loaded or store.asset_model_loaded) else "degraded",
        models_loaded=store.is_loaded,
        ticket_models_loaded=store.is_loaded,
        asset_model_loaded=store.asset_model_loaded,
        version=settings.app_version,
        llm_provider=llm_provider,
        llm_enabled=llm_enabled,
        llm_model=llm_model,
        llm_status=llm_status,
        llm_last_error=llm_last_error,
        gemini_enabled=llm_enabled if using_gemini else False,
        gemini_model=llm_model if using_gemini else None,
        gemini_status=llm_status if using_gemini else "disabled",
        gemini_last_error=llm_last_error if using_gemini else None,
    )


@router.get(
    "/metrics",
    response_class=PlainTextResponse,
    summary="Prometheus-style in-memory metrics",
)
async def metrics(request: Request) -> PlainTextResponse:
    metrics_sink = request.app.state.metrics
    return PlainTextResponse(metrics_sink.render_prometheus())
