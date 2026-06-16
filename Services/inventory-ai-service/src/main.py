"""OpsMind inventory-ai-service FastAPI application."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import anyio
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import AppSettings
from src.llm.client_protocol import LLMClientProtocol
from src.llm.gemini_client import GeminiClient
from src.llm.ollama_client import OllamaClient
from src.models import get_store, load_models
from src.observability import InMemoryMetrics
from src.repositories.spec_feedback_repository import SpecFeedbackRepository
from src.routers.ai_router import router as ai_router
from src.routers.health_router import router as health_router
from src.routers.prediction_router import router as prediction_router
from src.routers.sla_router import router as sla_router
from src.services.lifespan_service import LifespanService
from src.services.inventory_reasoning_service import InventoryReasoningService
from src.services.spec_inference_service import SpecInferenceService
from src.services.ticket_ai_service import TicketAIService


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
logger = logging.getLogger(__name__)


def _build_llm_client(settings: AppSettings) -> LLMClientProtocol:
    provider = (settings.llm_provider or "").strip().lower()
    if provider == "ollama":
        logger.info("Using Ollama as LLM provider (%s @ %s)", settings.ollama_model, settings.ollama_base_url)
        return OllamaClient(
            base_url=settings.ollama_base_url,
            model=settings.ollama_model,
            timeout_seconds=settings.ollama_timeout_seconds,
            keep_alive=settings.ollama_keep_alive,
            retry_attempts=settings.ollama_retry_attempts,
        )
    if provider == "gemini":
        logger.info("Using Gemini as LLM provider (%s)", settings.gemini_model)
        return GeminiClient(api_key=settings.gemini_api_key, model=settings.gemini_model)

    logger.warning("Unknown LLM_PROVIDER=%s; defaulting to disabled Gemini client.", provider)
    return GeminiClient(api_key="", model=settings.gemini_model)

load_dotenv()
settings = AppSettings.from_env()
metrics = InMemoryMetrics()
feedback_repository = SpecFeedbackRepository(
    feedback_path=settings.spec_feedback_path,
    golden_path=settings.spec_golden_path,
    cache_path=settings.spec_feedback_cache_path,
)
llm_client = _build_llm_client(settings)
spec_service = SpecInferenceService(
    settings=settings,
    repository=feedback_repository,
    llm=llm_client,
    metrics=metrics,
)
ticket_service = TicketAIService(settings=settings, llm=llm_client)
lifespan_service = LifespanService(settings=settings, metrics=metrics)
inventory_reasoning_service = InventoryReasoningService(settings=settings, llm=llm_client)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    try:
        load_models()
        feedback_repository.reload_cache()
        store = get_store()
        if store.is_loaded or store.asset_model_loaded:
            logger.info(
                "Models loaded. ticket_models=%s asset_model=%s llm_enabled=%s",
                store.is_loaded,
                store.asset_model_loaded,
                llm_client.enabled,
            )
        else:
            logger.warning("No trained models loaded. Ticket /predict disabled; lifespan endpoint will use fallback.")
        if (
            settings.llm_provider == "ollama"
            and settings.ollama_warmup_enabled
            and hasattr(llm_client, "warmup")
            and llm_client.enabled
        ):
            try:
                logger.info(
                    "Starting Ollama warm-up model=%s keep_alive=%s timeout=%ss retry=%s",
                    settings.ollama_model,
                    settings.ollama_keep_alive,
                    settings.ollama_timeout_seconds,
                    settings.ollama_retry_attempts,
                )
                warmed = await anyio.to_thread.run_sync(llm_client.warmup, settings.ollama_warmup_prompt)  # type: ignore[attr-defined]
                if warmed:
                    logger.info("Ollama warm-up completed successfully.")
                else:
                    logger.warning(
                        "Ollama warm-up failed; service will continue and use fallback when needed. last_error=%s",
                        getattr(llm_client, "last_error", ""),
                    )
            except Exception as warmup_exc:
                logger.warning("Ollama warm-up failed unexpectedly: %s", warmup_exc)
    except Exception as exc:
        logger.error("Model loading failed: %s", exc)
        logger.warning("Service starting with fallback-only behavior.")
    yield
    if hasattr(llm_client, "close"):
        try:
            llm_client.close()  # type: ignore[attr-defined]
        except Exception:
            pass
    await spec_service.aclose()


app = FastAPI(
    title="OpsMind Inventory AI Service",
    description=(
        "Microservice for inventory specification inference, asset lifespan prediction, "
        "and ticket AI helpers."
    ),
    version=settings.app_version,
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

app.state.settings = settings
app.state.metrics = metrics
app.state.feedback_repository = feedback_repository
app.state.spec_service = spec_service
app.state.ticket_service = ticket_service
app.state.lifespan_service = lifespan_service
app.state.inventory_reasoning_service = inventory_reasoning_service

app.include_router(health_router)
app.include_router(prediction_router)
app.include_router(ai_router)
app.include_router(sla_router)
