"""
OpsMind AI Service — Model loading and management.

Models are loaded once at startup and cached in memory.
"""

import logging
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import joblib

logger = logging.getLogger(__name__)

# ── Defaults ─────────────────────────────────────────────────────────────────

DEFAULT_MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models")
PRIORITY_MODEL_FILE = "priority_model.pkl"
EST_MODEL_FILE = "est_model.pkl"
METADATA_FILE = "model_metadata.pkl"
ASSET_LIFESPAN_MODEL_FILE = "asset_lifespan_model.pkl"


# ── Container ────────────────────────────────────────────────────────────────


@dataclass
class ModelStore:
    """In-memory store for loaded ML artefacts."""

    priority_model: Optional[Any] = None
    est_model: Optional[Any] = None
    asset_lifespan_model: Optional[Any] = None
    ohe_columns: Dict[str, List[str]] = field(default_factory=dict)
    feature_names: List[str] = field(default_factory=list)

    @property
    def is_loaded(self) -> bool:
        return self.priority_model is not None and self.est_model is not None

    @property
    def asset_model_loaded(self) -> bool:
        return self.asset_lifespan_model is not None


# Singleton instance
store = ModelStore()


# ── Loaders ──────────────────────────────────────────────────────────────────


def load_models(model_dir: Optional[str] = None) -> ModelStore:
    """Load trained models and metadata from disk.

    Parameters
    ----------
    model_dir : str | None
        Directory containing ``.pkl`` artefacts.  Falls back to ``models/``.

    Returns
    -------
    ModelStore
        The populated singleton model store.

    Notes
    -----
    Ticket models are optional in this service profile. If ticket artefacts are
    missing, `/predict` will stay disabled while asset lifespan inference can
    still run (trained or fallback).
    """
    global store

    model_dir = model_dir or DEFAULT_MODEL_DIR

    priority_path = os.path.join(model_dir, PRIORITY_MODEL_FILE)
    est_path = os.path.join(model_dir, EST_MODEL_FILE)
    meta_path = os.path.join(model_dir, METADATA_FILE)

    # Reset singleton fields so repeated calls don't keep stale artefacts.
    store.priority_model = None
    store.est_model = None
    store.asset_lifespan_model = None
    store.ohe_columns = {}
    store.feature_names = []

    missing_ticket_paths = [
        label for path, label in [
            (priority_path, "priority_model.pkl"),
            (est_path, "est_model.pkl"),
            (meta_path, "model_metadata.pkl"),
        ] if not os.path.isfile(path)
    ]

    if missing_ticket_paths:
        logger.warning(
            "Ticket prediction artefacts missing in %s: %s. /predict will return 503 until trained.",
            model_dir,
            ", ".join(missing_ticket_paths),
        )
    else:
        logger.info("Loading priority model from %s", priority_path)
        store.priority_model = joblib.load(priority_path)

        logger.info("Loading EST model from %s", est_path)
        store.est_model = joblib.load(est_path)

        logger.info("Loading model metadata from %s", meta_path)
        metadata = joblib.load(meta_path)
        store.ohe_columns = metadata["ohe_columns"]
        store.feature_names = metadata["feature_names"]
        logger.info("Ticket models loaded successfully.")

    asset_model_path = os.path.join(model_dir, ASSET_LIFESPAN_MODEL_FILE)
    if os.path.isfile(asset_model_path):
        logger.info("Loading asset lifespan model from %s", asset_model_path)
        store.asset_lifespan_model = joblib.load(asset_model_path)
    else:
        logger.warning("Asset lifespan model not found at %s. Using fallback estimator.", asset_model_path)

    return store


def get_store() -> ModelStore:
    """Return the singleton ``ModelStore``."""
    return store
