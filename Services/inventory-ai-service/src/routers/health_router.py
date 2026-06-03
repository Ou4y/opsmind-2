"""Health and observability endpoints."""

from __future__ import annotations

import time

import anyio
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


@router.get(
    "/ai/diagnostics",
    summary="Inventory AI diagnostics (safe debug metadata)",
)
async def ai_diagnostics(request: Request) -> dict:
    settings = request.app.state.settings
    llm = request.app.state.spec_service.llm
    llm_provider = str(getattr(settings, "llm_provider", "none") or "none")
    llm_enabled = bool(getattr(llm, "enabled", False))
    diagnostics: dict = {}

    if llm_enabled and hasattr(llm, "diagnostics"):
        try:
            diagnostics = dict(getattr(llm, "diagnostics")() or {})
        except Exception as exc:
            diagnostics = {
                "diagnostics_error": str(exc),
            }

    return {
        "inventory_ai_service_version": settings.app_version,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "llm_provider": llm_provider,
        "llm_enabled": llm_enabled,
        "llm_model": getattr(llm, "model", None) if llm_enabled else None,
        "llm_status": str(getattr(llm, "status", "disabled")),
        "llm_last_error": str(getattr(llm, "last_error", "") or "") or None,
        "ollama_base_url": diagnostics.get("ollama_base_url"),
        "timeout_seconds": diagnostics.get("timeout_seconds"),
        "keep_alive": diagnostics.get("keep_alive"),
        "retry_attempts": diagnostics.get("retry_attempts"),
        "last_success_at": diagnostics.get("last_success_at"),
        "last_checked_at": diagnostics.get("last_checked_at"),
        "last_failure_at": diagnostics.get("last_failure_at"),
        "consecutive_failures": diagnostics.get("consecutive_failures"),
        "ollama_tags_reachable": diagnostics.get("ollama_tags_reachable"),
        "selected_model_present": diagnostics.get("selected_model_present"),
        "available_models_sample": diagnostics.get("available_models_sample", []),
        "raw": diagnostics,
    }


@router.post(
    "/ai/test-gemma",
    summary="Run a tiny Gemma/Ollama test prompt",
)
async def ai_test_gemma(request: Request) -> dict:
    llm = request.app.state.spec_service.llm
    settings = request.app.state.settings
    started = time.perf_counter()
    prompt = 'Respond with strict JSON only: {"status":"OK","message":"OK"}'
    try:
        payload = await request.json()
        candidate = str((payload or {}).get("prompt") or "").strip()
        if candidate:
            prompt = f'{candidate}\nRespond with strict JSON only: {{"status":"OK","message":"OK"}}'
    except Exception:
        pass
    schema = {
        "type": "object",
        "properties": {
            "status": {"type": "string"},
            "message": {"type": "string"},
        },
        "required": ["status", "message"],
    }

    if not bool(getattr(llm, "enabled", False)):
        return {
            "ok": False,
            "provider": str(getattr(settings, "llm_provider", "none") or "none"),
            "llm_enabled": False,
            "llm_status": str(getattr(llm, "status", "disabled")),
            "reason": "llm_disabled",
            "duration_ms": int((time.perf_counter() - started) * 1000),
        }

    parsed = await anyio.to_thread.run_sync(
        llm.generate_json,
        prompt,
        schema,
        0.0,
    )
    status_value = str((parsed or {}).get("status") or "").strip().upper()
    ok = isinstance(parsed, dict) and status_value == "OK"
    return {
        "ok": ok,
        "provider": str(getattr(settings, "llm_provider", "none") or "none"),
        "model": getattr(llm, "model", None),
        "llm_status": str(getattr(llm, "status", "disabled")),
        "llm_last_error": str(getattr(llm, "last_error", "") or "") or None,
        "used_gemma": bool(ok and str(getattr(settings, "llm_provider", "")) == "ollama"),
        "response": parsed if isinstance(parsed, dict) else None,
        "duration_ms": int((time.perf_counter() - started) * 1000),
    }
