"""
OpsMind AI Service — preprocessing helpers.

This module centralizes data preparation rules so training and inference stay
consistent with the real OpsMind ticket-creation workflow.

Workflow constraints implemented here:
- Keep priority as 4 classes: LOW, MEDIUM, HIGH, CRITICAL.
- Use label encoding for priority target (never one-hot encode y).
- Exclude escalation/lifecycle features (for example Support Level, SLA, agent fields).
- Use only production-safe creation-time inputs for modeling.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

# ── Priority target ──────────────────────────────────────────────────────────

PRIORITY_LABELS: List[str] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
PRIORITY_TO_INT: Dict[str, int] = {
    label: idx for idx, label in enumerate(PRIORITY_LABELS)
}
INT_TO_PRIORITY: Dict[int, str] = {
    idx: label for idx, label in enumerate(PRIORITY_LABELS)
}

_CSV_PRIORITY_MAP: Dict[str, str] = {
    "Low": "LOW",
    "Medium": "MEDIUM",
    "High": "HIGH",
    "Critical": "CRITICAL",
}

# ── Feature policy ───────────────────────────────────────────────────────────

PRODUCTION_CATEGORICAL_FEATURES: List[str] = [
    "topic",
    "source",
    "product_group",
    "country",
]
PRODUCTION_NUMERIC_FEATURES: List[str] = [
    "created_hour",
    "created_weekday",
    "is_weekend",
    "is_out_of_hours",
]
PRODUCTION_FEATURES: List[str] = (
    PRODUCTION_CATEGORICAL_FEATURES + PRODUCTION_NUMERIC_FEATURES
)

REMOVED_FEATURES: List[str] = [
    "Support Level",
    "Latitude",
    "Longitude",
    "Agent Group",
    "Agent Name",
    "Status",
    "Ticket ID",
    "Expected SLA to resolve",
    "Expected SLA to first response",
    "First response time",
    "SLA For first response",
    "SLA For Resolution",
    "Resolution time",
    "Survey results",
    "Agent interactions",
    "Close time as a feature",
]

CSV_COLUMN_MAP: Dict[str, str] = {
    "Topic": "topic",
    "Source": "source",
    "Product group": "product_group",
    "Country": "country",
    "Created time": "created_at",
    "Close time": "closed_at",
    "Priority": "priority",
}

_OUT_OF_HOURS_START = 8
_OUT_OF_HOURS_END = 18


# ── Shared helpers ───────────────────────────────────────────────────────────


def _normalise_category(value: Any) -> str:
    if value is None:
        return "UNKNOWN"
    text = str(value).strip()
    return text if text else "UNKNOWN"


def _map_priority_value(value: Any) -> Optional[str]:
    if value is None:
        return None

    text = str(value).strip()
    if not text:
        return None

    if text in _CSV_PRIORITY_MAP:
        return _CSV_PRIORITY_MAP[text]

    upper_text = text.upper()
    if upper_text in PRIORITY_TO_INT:
        return upper_text

    title_text = text.title()
    return _CSV_PRIORITY_MAP.get(title_text)


def add_created_time_features(df: pd.DataFrame, created_col: str = "created_at") -> pd.DataFrame:
    """Add hour/weekday/weekend/out-of-hours features from created timestamp."""
    frame = df.copy(deep=True)

    created_at = pd.to_datetime(frame[created_col], dayfirst=True, errors="coerce")
    frame.loc[:, "created_at"] = created_at

    created_hour = created_at.dt.hour.fillna(-1).astype("int64")
    created_weekday = created_at.dt.weekday.fillna(-1).astype("int64")

    # Weekend: Saturday/Sunday based on weekday index (Mon=0, Sun=6)
    is_weekend = created_at.dt.weekday.isin([5, 6]).fillna(False).astype("int64")

    # Out-of-hours: before 08:00 or after/equal 18:00 local ticket time
    is_out_of_hours = (
        ((created_hour >= 0) & (created_hour < _OUT_OF_HOURS_START))
        | (created_hour >= _OUT_OF_HOURS_END)
    ).astype("int64")

    frame.loc[:, "created_hour"] = created_hour
    frame.loc[:, "created_weekday"] = created_weekday
    frame.loc[:, "is_weekend"] = is_weekend
    frame.loc[:, "is_out_of_hours"] = is_out_of_hours

    return frame


def _normalise_training_csv(df: pd.DataFrame) -> pd.DataFrame:
    """Rename relevant CSV columns and normalize values used by the pipeline."""
    frame = df.copy(deep=True)

    rename_map = {src: dst for src, dst in CSV_COLUMN_MAP.items() if src in frame.columns}
    frame = frame.rename(columns=rename_map)

    if "priority" in frame.columns:
        frame.loc[:, "priority"] = frame["priority"].map(_map_priority_value)

    return frame


# ── Training preprocessing ───────────────────────────────────────────────────


def preprocess_for_training(df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.Series, pd.Series]:
    """Prepare training features and targets from historical CSV rows."""
    frame = _normalise_training_csv(df)

    for col in PRODUCTION_CATEGORICAL_FEATURES:
        if col not in frame.columns:
            frame[col] = "UNKNOWN"
        frame.loc[:, col] = frame[col].map(_normalise_category)

    frame = add_created_time_features(frame, created_col="created_at")

    created_at = pd.to_datetime(frame["created_at"], dayfirst=True, errors="coerce")
    closed_at = pd.to_datetime(frame.get("closed_at"), dayfirst=True, errors="coerce")
    frame.loc[:, "created_at"] = created_at
    frame.loc[:, "closed_at"] = closed_at

    frame.loc[:, "priority_encoded"] = frame["priority"].map(PRIORITY_TO_INT)
    frame.loc[:, "resolution_time_hours"] = (
        (closed_at - created_at).dt.total_seconds() / 3600.0
    )

    frame = frame.dropna(
        subset=[
            "priority_encoded",
            "resolution_time_hours",
            "created_hour",
            "created_weekday",
        ]
    ).copy(deep=True)
    frame = frame[frame["resolution_time_hours"] > 0].copy(deep=True)

    X = frame[PRODUCTION_FEATURES].copy(deep=True)
    y_priority = frame["priority_encoded"].astype("int64")
    y_resolution = frame["resolution_time_hours"].astype("float64")

    return X, y_priority, y_resolution


# ── Inference preprocessing ──────────────────────────────────────────────────


def preprocess_for_inference(data: Dict[str, Any]) -> pd.DataFrame:
    """Build one-row inference feature frame using production-safe inputs only."""
    created_at = data.get("created_at")
    if not created_at:
        created_at = datetime.now(timezone.utc).isoformat()

    topic = data.get("topic") or data.get("type_of_request")
    source = data.get("source")
    product_group = data.get("product_group") or data.get("productGroup")
    country = data.get("country")

    frame = pd.DataFrame(
        [
            {
                "topic": _normalise_category(topic),
                "source": _normalise_category(source),
                "product_group": _normalise_category(product_group),
                "country": _normalise_category(country),
                "created_at": created_at,
            }
        ]
    )

    frame = add_created_time_features(frame, created_col="created_at")

    for col in PRODUCTION_CATEGORICAL_FEATURES:
        if col not in frame.columns:
            frame[col] = "UNKNOWN"
        frame.loc[:, col] = frame[col].map(_normalise_category)

    for col in PRODUCTION_NUMERIC_FEATURES:
        if col not in frame.columns:
            frame[col] = 0
        frame.loc[:, col] = pd.to_numeric(frame[col], errors="coerce").fillna(0).astype("int64")

    return frame[PRODUCTION_FEATURES].copy(deep=True)
