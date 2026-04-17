"""
OpsMind AI Service — FastAPI application.

Exposes prediction endpoints and health checks.
Swagger UI is available at ``/docs``.
"""

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from src.models import get_store, load_models
from src.preprocess import INT_TO_PRIORITY, preprocess_for_inference
from src.schemas import HealthResponse, PredictionResponse, TicketInput

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

APP_VERSION = "1.0.0"


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
        # Convert pydantic model → dict for preprocessing
        ticket_data = ticket.model_dump()
        ticket_data["created_at"] = ticket_data["created_at"].isoformat()

        # Build feature vector
        features = preprocess_for_inference(
            data=ticket_data,
            ohe_columns=store.ohe_columns,
            feature_names=store.feature_names,
        )

        # ── Priority prediction ─────────────────────────────────────────
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

        # ── Resolution time prediction ──────────────────────────────────
        est_hours = float(store.est_model.predict(features)[0])
        est_hours = round(max(est_hours, 0.0), 2)  # clamp to non-negative

        return PredictionResponse(
            suggested_priority=priority_label,
            priority_confidence=priority_confidence,
            estimated_resolution_hours=est_hours,
        )

    except Exception as exc:
        logger.exception("Prediction failed")
        raise HTTPException(status_code=500, detail=f"Prediction error: {exc}") from exc
