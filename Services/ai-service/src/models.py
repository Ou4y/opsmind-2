"""
OpsMind AI Service — model loading and in-memory store.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import joblib

logger = logging.getLogger(__name__)

DEFAULT_MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models")
PRIORITY_PIPELINE_FILE = "priority_pipeline.pkl"
EST_PIPELINE_FILE = "est_pipeline.pkl"
METADATA_FILE = "model_metadata.pkl"


@dataclass
class ModelStore:
    """In-memory store for loaded ML artifacts."""

    priority_pipeline: Optional[Any] = None
    est_pipeline: Optional[Any] = None
    feature_names: List[str] = field(default_factory=list)
    transformed_feature_names: List[str] = field(default_factory=list)
    removed_feature_names: List[str] = field(default_factory=list)
    priority_labels: List[str] = field(default_factory=list)
    selected_priority_model_name: Optional[str] = None
    selected_est_model_name: Optional[str] = None
    training_summary: Dict[str, Any] = field(default_factory=dict)
    split_config: Dict[str, Any] = field(default_factory=dict)

    @property
    def is_loaded(self) -> bool:
        return self.priority_pipeline is not None and self.est_pipeline is not None


store = ModelStore()


def load_models(model_dir: Optional[str] = None) -> ModelStore:
    """Load trained pipelines and metadata from disk."""
    global store

    model_dir = model_dir or DEFAULT_MODEL_DIR

    priority_path = os.path.join(model_dir, PRIORITY_PIPELINE_FILE)
    est_path = os.path.join(model_dir, EST_PIPELINE_FILE)
    meta_path = os.path.join(model_dir, METADATA_FILE)

    for path, label in [
        (priority_path, "Priority pipeline"),
        (est_path, "EST pipeline"),
        (meta_path, "Model metadata"),
    ]:
        if not os.path.isfile(path):
            raise FileNotFoundError(f"{label} not found at {path}. Run training first.")

    logger.info("Loading priority pipeline from %s", priority_path)
    store.priority_pipeline = joblib.load(priority_path)

    logger.info("Loading EST pipeline from %s", est_path)
    store.est_pipeline = joblib.load(est_path)

    logger.info("Loading model metadata from %s", meta_path)
    metadata = joblib.load(meta_path)
    store.feature_names = metadata.get("feature_names", [])
    store.transformed_feature_names = metadata.get("transformed_feature_names", [])
    store.removed_feature_names = metadata.get("removed_feature_names", [])
    store.priority_labels = metadata.get("priority_labels", [])
    store.selected_priority_model_name = metadata.get("selected_priority_model_name")
    store.selected_est_model_name = metadata.get("selected_est_model_name")
    store.training_summary = metadata.get("training_summary", {})
    store.split_config = metadata.get("split_config", {})

    logger.info("All models loaded successfully.")
    return store


def get_store() -> ModelStore:
    """Return the singleton model store."""
    return store
