"""
OpsMind AI Service — Preprocessing module.

Shared between training and inference to guarantee feature parity.

The training dataset (ITSM_Dataset.csv) has different column names than the
production Ticket schema.  This module handles:
  1. Column mapping from CSV → internal feature names.
  2. Priority mapping: CSV has Critical/High/Medium/Low → schema has HIGH/MEDIUM/LOW
     (Critical is merged into HIGH).
  3. Feature engineering (time features, one-hot encoding).
  4. Alignment between training and inference feature sets.
"""

from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

# ── Priority constants ───────────────────────────────────────────────────────
# The production Ticket schema uses: LOW, MEDIUM, HIGH  (no Critical).
# The training CSV uses: Low, Medium, High, Critical.
# We merge Critical → HIGH so the model outputs only valid schema values.

PRIORITY_LABELS: List[str] = ["LOW", "MEDIUM", "HIGH"]
PRIORITY_TO_INT: Dict[str, int] = {label: idx for idx, label in enumerate(PRIORITY_LABELS)}
INT_TO_PRIORITY: Dict[int, str] = {idx: label for idx, label in enumerate(PRIORITY_LABELS)}

# Mapping from CSV priority values → schema ENUM values
_CSV_PRIORITY_MAP: Dict[str, str] = {
    "Low": "LOW",
    "Medium": "MEDIUM",
    "High": "HIGH",
    "Critical": "HIGH",  # schema has no Critical — merge into HIGH
}

# ── Column mapping: CSV → internal names ─────────────────────────────────────
# These are the CSV columns we keep and the names we normalise them to.

CSV_COLUMN_MAP: Dict[str, str] = {
    "Topic": "type_of_request",
    "Support Level": "support_level",
    "Source": "source",
    "Product group": "product_group",
    "Country": "country",
    "Created time": "created_at",
    "Close time": "closed_at",
    "Priority": "priority",
}

# Categorical columns to one-hot encode (shared by training & inference)
CATEGORICAL_COLUMNS: List[str] = [
    "type_of_request",
    "support_level",
    "source",
    "product_group",
    "country",
]

# All columns from the CSV that carry lifecycle / leakage info
CSV_LEAKAGE_COLUMNS: List[str] = [
    "Status",
    "Ticket ID",
    "Agent Group",
    "Agent Name",
    "Expected SLA to resolve",
    "Expected SLA to first response",
    "First response time",
    "SLA For first response",
    "Resolution time",
    "SLA For Resolution",
    "Agent interactions",
    "Survey results",
    "Latitude",
    "Longitude",
]


# ── Feature Engineering ─────────────────────────────────────────────────────


def extract_time_features(df: pd.DataFrame) -> pd.DataFrame:
    """Extract ``created_hour`` and ``created_weekday`` from ``created_at``."""
    df = df.copy()
    df["created_at"] = pd.to_datetime(df["created_at"], dayfirst=True, errors="coerce")
    df["created_hour"] = df["created_at"].dt.hour
    df["created_weekday"] = df["created_at"].dt.weekday
    return df


def compute_resolution_time(df: pd.DataFrame) -> pd.DataFrame:
    """Compute ``resolution_time_hours`` = ``closed_at − created_at``."""
    df = df.copy()
    df["created_at"] = pd.to_datetime(df["created_at"], dayfirst=True, errors="coerce")
    df["closed_at"] = pd.to_datetime(df["closed_at"], dayfirst=True, errors="coerce")
    df["resolution_time_hours"] = (
        (df["closed_at"] - df["created_at"]).dt.total_seconds() / 3600.0
    )
    return df


def encode_priority(df: pd.DataFrame) -> pd.DataFrame:
    """Map priority labels → integers using the schema ENUM (LOW/MEDIUM/HIGH)."""
    df = df.copy()
    df["priority_encoded"] = df["priority"].map(PRIORITY_TO_INT)
    return df


def one_hot_encode(
    df: pd.DataFrame,
    columns: Optional[List[str]] = None,
    fit_columns: Optional[Dict[str, List[str]]] = None,
) -> Tuple[pd.DataFrame, Dict[str, List[str]]]:
    """One-hot encode categorical columns.

    Parameters
    ----------
    df : pd.DataFrame
        Input dataframe.
    columns : list[str] | None
        Columns to encode.  Defaults to ``CATEGORICAL_COLUMNS``.
    fit_columns : dict | None
        If provided, align the resulting dummy columns to match the training
        set (handles unseen categories at inference time).

    Returns
    -------
    tuple[pd.DataFrame, dict]
        The encoded dataframe and a mapping ``{original_col: [dummy_cols]}``.
    """
    if columns is None:
        columns = CATEGORICAL_COLUMNS

    cols_to_encode = [c for c in columns if c in df.columns]
    df = pd.get_dummies(df, columns=cols_to_encode, dtype=int)

    column_map: Dict[str, List[str]] = {}

    if fit_columns is None:
        # Training: record the dummy columns produced
        for col in cols_to_encode:
            column_map[col] = sorted(
                [c for c in df.columns if c.startswith(f"{col}_")]
            )
    else:
        # Inference: align to training columns
        column_map = fit_columns
        all_expected = [c for cols in fit_columns.values() for c in cols]
        for c in all_expected:
            if c not in df.columns:
                df[c] = 0

    return df, column_map


# ── Training pipeline ───────────────────────────────────────────────────────


def _normalise_csv(df: pd.DataFrame) -> pd.DataFrame:
    """Rename CSV columns and map priority values to schema ENUMs."""
    # Drop leakage / lifecycle columns from the CSV
    drop = [c for c in CSV_LEAKAGE_COLUMNS if c in df.columns]
    df = df.drop(columns=drop)

    # Rename remaining columns
    df = df.rename(columns={k: v for k, v in CSV_COLUMN_MAP.items() if k in df.columns})

    # Map priority values: Low→LOW, Medium→MEDIUM, High→HIGH, Critical→HIGH
    if "priority" in df.columns:
        df["priority"] = df["priority"].map(_CSV_PRIORITY_MAP)

    return df


def preprocess_for_training(
    df: pd.DataFrame,
) -> Tuple[pd.DataFrame, pd.Series, pd.Series, Dict[str, List[str]], List[str]]:
    """Full preprocessing pipeline for training.

    Returns
    -------
    X : pd.DataFrame
        Feature matrix.
    y_priority : pd.Series
        Integer-encoded priority labels.
    y_resolution : pd.Series
        Resolution time in hours.
    ohe_columns : dict
        One-hot encoding column map (persist for inference alignment).
    feature_names : list[str]
        Ordered feature column names used by the models.
    """
    df = _normalise_csv(df)

    # Compute resolution time target
    df = compute_resolution_time(df)

    # Encode priority target
    df = encode_priority(df)

    # Drop rows where targets are missing
    df = df.dropna(subset=["resolution_time_hours", "priority_encoded"])
    df = df[df["resolution_time_hours"] > 0]

    # Extract hour / weekday from created_at
    df = extract_time_features(df)

    # Drop columns not needed as features (datetime, raw priority, closed_at)
    df = df.drop(columns=["created_at", "closed_at", "priority"], errors="ignore")

    # One-hot encode categorical columns
    df, ohe_columns = one_hot_encode(df)

    # Separate targets from features
    y_priority = df.pop("priority_encoded").astype(int)
    y_resolution = df.pop("resolution_time_hours").astype(float)

    feature_names = sorted(df.columns.tolist())
    df = df[feature_names]

    return df, y_priority, y_resolution, ohe_columns, feature_names


# ── Inference pipeline ───────────────────────────────────────────────────────


def preprocess_for_inference(
    data: Dict[str, Any],
    ohe_columns: Dict[str, List[str]],
    feature_names: List[str],
) -> pd.DataFrame:
    """Preprocess a single ticket dict coming from the Ticket Service API.

    The API sends the fields available at ticket creation time:
        title, description, building, room, type_of_request,
        support_level, created_at

    ``title``, ``description``, ``building``, and ``room`` are NOT in the
    training CSV, so they are dropped before feature construction.  The model
    relies on ``type_of_request``, ``support_level``, ``created_hour``, and
    ``created_weekday`` (plus any extra categorical columns that exist in both
    training and inference).

    Parameters
    ----------
    data : dict
        Raw ticket fields matching ``TicketInput``.
    ohe_columns : dict
        Column map saved during training.
    feature_names : list[str]
        Ordered feature names from training.

    Returns
    -------
    pd.DataFrame
        Single-row feature matrix aligned to the trained model.
    """
    df = pd.DataFrame([data])

    # Extract time features
    df = extract_time_features(df)

    # Drop fields that are not model features
    df = df.drop(
        columns=["title", "description", "building", "room", "created_at"],
        errors="ignore",
    )

    # One-hot encode, aligned to training columns
    df, _ = one_hot_encode(df, fit_columns=ohe_columns)

    # Ensure exact column order; fill missing with 0
    for col in feature_names:
        if col not in df.columns:
            df[col] = 0
    df = df[feature_names]

    return df
