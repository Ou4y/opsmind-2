"""
OpsMind AI Service — hybrid priority training pipeline.

Hybrid architecture in this trainer:
1) Feature Engineering
2) Rule Engine for realistic supervised labels
3) ML model experiments + selection
4) Metrics + artifact export
"""

from __future__ import annotations

import argparse
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from src.feature_engineering import (
    calculate_priority_score as shared_calculate_priority_score,
    map_priority_score as shared_map_priority_score,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

PRIORITY_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
PRIORITY_TO_INDEX = {label: idx for idx, label in enumerate(PRIORITY_LEVELS)}

REQUIRED_COLUMNS = [
    "priority",
    "title",
    "description",
    "created_hour",
    "created_month",
    "service_criticality_score",
]

OPTIONAL_DEFAULTS: dict[str, Any] = {
    "created_weekday": -1,
    "created_weekday_name": "UNKNOWN",
    "affected_service_domain": "",
    "product_group": "",
    "is_core_service": 0,
    "is_failure_related": 0,
    "is_access_related": 0,
    "is_after_hours": 0,
    "is_business_hours": 0,
    "requires_infrastructure_team": 0,
    "requires_device_team": 0,
    "requires_software_team": 0,
    "ticket_nature": "",
    "opsmind_request_type": "",
}

TARGET_COLUMN = "priority"
BASE_EXCLUDED_COLUMNS = [
    "priority",
    "original_priority",
    "rule_priority",
    "ticket_id",
    "resolution_time_hours",
    "created_time_iso",
    "sla_target_hours",
    "sla_breached",
    "sla_breach_risk",
    "resolution_bucket",
]

DERIVED_COLUMNS = [
    "description_word_count",
    "title_word_count",
    "has_error_keywords",
    "has_urgency_keywords",
    "has_access_keywords",
    "has_network_keywords",
    "has_hardware_keywords",
    "has_software_keywords",
    "is_peak_hour",
    "is_late_night",
    "is_start_of_week",
    "is_end_of_week",
    "academic_period",
    "service_criticality_level",
    "is_digital_service",
    "is_physical_service",
    "required_team_count",
    "requires_multiple_teams",
    "ticket_complexity_score",
    "ticket_complexity_level",
    "needs_fast_response",
    "operational_risk_score",
]

KEYWORD_GROUPS = {
    "has_error_keywords": [
        "error",
        "failed",
        "failure",
        "bug",
        "crash",
        "timeout",
        "not working",
        "cannot",
        "can't",
        "unable",
        "down",
        "broken",
        "issue",
        "problem",
        "unavailable",
        "disconnect",
        "disconnected",
        "freeze",
        "frozen",
        "stuck",
    ],
    "has_urgency_keywords": [
        "urgent",
        "immediately",
        "asap",
        "as soon as possible",
        "critical",
        "important",
        "blocked",
        "cannot continue",
        "can't continue",
        "deadline",
        "exam",
        "lecture",
        "meeting",
        "presentation",
        "now",
        "emergency",
    ],
    "has_access_keywords": [
        "login",
        "log in",
        "sign in",
        "signin",
        "password",
        "account",
        "access",
        "permission",
        "unauthorized",
        "forbidden",
        "disabled",
        "otp",
        "authentication",
        "auth",
        "reset",
        "credentials",
    ],
    "has_network_keywords": [
        "wifi",
        "wi-fi",
        "internet",
        "network",
        "connection",
        "disconnect",
        "disconnected",
        "router",
        "slow",
        "latency",
        "lan",
        "ethernet",
        "vpn",
        "dns",
    ],
    "has_hardware_keywords": [
        "laptop",
        "computer",
        "pc",
        "device",
        "printer",
        "keyboard",
        "mouse",
        "screen",
        "monitor",
        "projector",
        "hardware",
        "cable",
        "battery",
        "charger",
        "scanner",
    ],
    "has_software_keywords": [
        "software",
        "application",
        "app",
        "system",
        "dashboard",
        "page",
        "browser",
        "install",
        "installation",
        "update",
        "crash",
        "bug",
        "website",
        "portal",
        "form",
        "upload",
        "download",
    ],
}


@dataclass
class ExperimentConfig:
    name: str
    model_name: str
    feature_mode: str
    diagnostic_only: bool
    include_tfidf_text: bool
    include_priority_score: bool
    estimator: Any | None


def _to_builtin(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): _to_builtin(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_builtin(v) for v in value]
    if isinstance(value, tuple):
        return [_to_builtin(v) for v in value]
    if hasattr(value, "item"):
        return value.item()
    return value


def _safe_numeric(series: pd.Series, fill_value: float = 0.0) -> pd.Series:
    return pd.to_numeric(series, errors="coerce").fillna(fill_value)


def _normalize_bool_like(series: pd.Series, default: int = 0) -> pd.Series:
    true_tokens = {"1", "true", "yes", "y", "t", "on"}
    false_tokens = {"0", "false", "no", "n", "f", "off", ""}

    def convert(value: Any) -> int:
        if pd.isna(value):
            return default
        if isinstance(value, (bool, np.bool_)):
            return int(value)
        if isinstance(value, (int, np.integer, float, np.floating)):
            if pd.isna(value):
                return default
            return int(float(value) != 0.0)

        text = str(value).strip().lower()
        if text in true_tokens:
            return 1
        if text in false_tokens:
            return 0

        try:
            return int(float(text) != 0.0)
        except ValueError:
            return default

    return series.map(convert).astype("int64")


def _normalize_text_series(series: pd.Series) -> pd.Series:
    return series.fillna("").astype(str).str.strip()


def _normalize_text_upper(series: pd.Series) -> pd.Series:
    return _normalize_text_series(series).str.upper()


def _validate_required_columns(df: pd.DataFrame) -> None:
    missing = [col for col in REQUIRED_COLUMNS if col not in df.columns]
    if missing:
        raise ValueError(
            "Missing required columns for training: "
            + ", ".join(missing)
            + ". Please update ITSM_Dataset.csv."
        )


def _ensure_optional_columns(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    frame = df.copy(deep=True)
    warnings_list: list[str] = []

    for column_name, default_value in OPTIONAL_DEFAULTS.items():
        if column_name not in frame.columns:
            frame.loc[:, column_name] = default_value
            message = (
                f"Optional column '{column_name}' missing. "
                f"Using safe default '{default_value}'."
            )
            warnings_list.append(message)
            logger.warning(message)

    return frame, warnings_list


def _build_keyword_pattern(keywords: list[str]) -> str:
    patterns: list[str] = []
    for keyword in keywords:
        token = keyword.strip().lower()
        escaped = re.escape(token)
        if re.fullmatch(r"[a-z0-9]+", token):
            patterns.append(rf"\b{escaped}\b")
        else:
            patterns.append(escaped)
    return "|".join(patterns)


def _add_text_features(df: pd.DataFrame) -> pd.DataFrame:
    frame = df.copy(deep=True)

    title_text = _normalize_text_series(frame["title"])
    description_text = _normalize_text_series(frame["description"])
    combined_text = (title_text + " " + description_text).str.lower()

    frame.loc[:, "title"] = title_text
    frame.loc[:, "description"] = description_text

    frame.loc[:, "description_word_count"] = (
        description_text.str.findall(r"\b\w+\b").str.len().astype("int64")
    )
    frame.loc[:, "title_word_count"] = (
        title_text.str.findall(r"\b\w+\b").str.len().astype("int64")
    )

    for feature_name, keywords in KEYWORD_GROUPS.items():
        pattern = _build_keyword_pattern(keywords)
        frame.loc[:, feature_name] = combined_text.str.contains(
            pattern,
            regex=True,
            na=False,
        ).astype("int64")

    return frame


def _add_time_features(df: pd.DataFrame) -> pd.DataFrame:
    frame = df.copy(deep=True)

    frame.loc[:, "created_hour"] = _safe_numeric(frame["created_hour"], -1).astype("int64")
    frame.loc[:, "created_month"] = _safe_numeric(frame["created_month"], -1).astype("int64")
    frame.loc[:, "created_weekday"] = _safe_numeric(frame["created_weekday"], -1).astype("int64")

    frame.loc[:, "is_peak_hour"] = frame["created_hour"].between(9, 15, inclusive="both").astype("int64")
    frame.loc[:, "is_late_night"] = frame["created_hour"].between(0, 6, inclusive="both").astype("int64")

    weekday_name = _normalize_text_series(frame["created_weekday_name"]).str.lower()
    frame.loc[:, "is_start_of_week"] = weekday_name.isin(["sunday", "monday"]).astype("int64")
    frame.loc[:, "is_end_of_week"] = weekday_name.isin(
        ["thursday", "friday", "saturday"]
    ).astype("int64")

    def map_academic_period(month: Any) -> str:
        month_num = int(month) if pd.notna(month) else -1
        if month_num == 1:
            return "WINTER"
        if month_num in {2, 3, 4, 5}:
            return "SPRING"
        if month_num in {6, 7, 8}:
            return "SUMMER"
        if month_num in {9, 10, 11, 12}:
            return "FALL"
        return "UNKNOWN"

    frame.loc[:, "academic_period"] = frame["created_month"].map(map_academic_period)

    return frame


def _add_service_features(df: pd.DataFrame) -> pd.DataFrame:
    frame = df.copy(deep=True)

    criticality = _safe_numeric(frame["service_criticality_score"], 0.0)

    def map_criticality_level(value: Any) -> str:
        try:
            score = int(value)
        except (TypeError, ValueError):
            return "UNKNOWN"
        if score in {1, 2}:
            return "LOW"
        if score == 3:
            return "MEDIUM"
        if score in {4, 5}:
            return "HIGH"
        return "UNKNOWN"

    frame.loc[:, "service_criticality_level"] = criticality.map(map_criticality_level)

    domain_primary = _normalize_text_upper(frame["affected_service_domain"])
    domain_fallback = _normalize_text_upper(frame["product_group"])
    combined_domain = domain_primary.where(domain_primary.ne(""), domain_fallback)

    digital_terms = [
        "NETWORK",
        "SOFTWARE",
        "CLOUD",
        "AUTHENTICATION",
        "DATABASE",
        "SYSTEM",
        "APPLICATION",
        "PORTAL",
    ]
    physical_terms = ["HARDWARE", "DEVICE", "PRINTER", "PROJECTOR", "EQUIPMENT"]

    frame.loc[:, "is_digital_service"] = combined_domain.map(
        lambda value: int(any(term in value for term in digital_terms))
    ).astype("int64")
    frame.loc[:, "is_physical_service"] = combined_domain.map(
        lambda value: int(any(term in value for term in physical_terms))
    ).astype("int64")

    return frame


def _add_team_features(df: pd.DataFrame) -> pd.DataFrame:
    frame = df.copy(deep=True)

    requires_infra = _normalize_bool_like(frame["requires_infrastructure_team"])
    requires_device = _normalize_bool_like(frame["requires_device_team"])
    requires_software = _normalize_bool_like(frame["requires_software_team"])

    frame.loc[:, "requires_infrastructure_team"] = requires_infra
    frame.loc[:, "requires_device_team"] = requires_device
    frame.loc[:, "requires_software_team"] = requires_software

    frame.loc[:, "required_team_count"] = (
        requires_infra + requires_device + requires_software
    ).astype("int64")
    frame.loc[:, "requires_multiple_teams"] = (
        frame["required_team_count"] >= 2
    ).astype("int64")

    return frame


def _add_operational_features(df: pd.DataFrame) -> pd.DataFrame:
    frame = df.copy(deep=True)

    frame.loc[:, "is_core_service"] = _normalize_bool_like(frame["is_core_service"])
    frame.loc[:, "is_failure_related"] = _normalize_bool_like(frame["is_failure_related"])
    frame.loc[:, "is_access_related"] = _normalize_bool_like(frame["is_access_related"])
    frame.loc[:, "is_after_hours"] = _normalize_bool_like(frame["is_after_hours"])
    frame.loc[:, "requires_multiple_teams"] = _normalize_bool_like(frame["requires_multiple_teams"])

    criticality = _safe_numeric(frame["service_criticality_score"], 0.0)

    frame.loc[:, "ticket_complexity_score"] = (
        criticality
        + frame["required_team_count"]
        + frame["is_core_service"]
        + frame["is_failure_related"]
        + frame["is_access_related"]
        + frame["is_after_hours"]
        + frame["has_error_keywords"]
        + frame["has_urgency_keywords"]
    ).astype("float64")

    frame.loc[:, "ticket_complexity_level"] = np.select(
        [
            frame["ticket_complexity_score"] <= 3,
            frame["ticket_complexity_score"].between(4, 6, inclusive="both"),
            frame["ticket_complexity_score"] >= 7,
        ],
        ["LOW", "MEDIUM", "HIGH"],
        default="MEDIUM",
    )

    needs_fast = (
        ((frame["is_core_service"] == 1) & (frame["is_failure_related"] == 1))
        | ((criticality >= 4) & (frame["has_error_keywords"] == 1))
        | ((frame["has_urgency_keywords"] == 1) & (frame["is_failure_related"] == 1))
    )
    frame.loc[:, "needs_fast_response"] = needs_fast.astype("int64")

    frame.loc[:, "operational_risk_score"] = (
        criticality
        + (2 * frame["is_core_service"])
        + (2 * frame["is_failure_related"])
        + frame["is_access_related"]
        + frame["is_after_hours"]
        + frame["requires_multiple_teams"]
        + frame["has_urgency_keywords"]
        + frame["needs_fast_response"]
    ).astype("float64")

    return frame


def add_derived_features(df: pd.DataFrame) -> pd.DataFrame:
    frame = _add_text_features(df)
    frame = _add_time_features(frame)
    frame = _add_service_features(frame)
    frame = _add_team_features(frame)
    frame = _add_operational_features(frame)
    return frame


def _distribution(series: pd.Series) -> dict[str, int]:
    normalized = series.fillna("UNKNOWN").astype(str).str.upper()
    counts = normalized.value_counts().to_dict()
    ordered = {label: int(counts.get(label, 0)) for label in PRIORITY_LEVELS}
    extras = {k: int(v) for k, v in counts.items() if k not in ordered}
    return {**ordered, **extras}


def _extract_domain_signal(df: pd.DataFrame) -> pd.Series:
    domain_upper = _normalize_text_upper(df["affected_service_domain"])
    group_upper = _normalize_text_upper(df["product_group"])
    return domain_upper.where(domain_upper.ne(""), group_upper)


def generate_rule_based_priority(
    df: pd.DataFrame,
    random_state: int = 42,
    noise_rate: float = 0.15,
) -> pd.DataFrame:
    """Generate realistic ITSM priority labels from operational rules + controlled noise."""
    frame = df.copy(deep=True)

    frame.loc[:, "service_criticality_score"] = _safe_numeric(
        frame["service_criticality_score"], 0.0
    )
    frame.loc[:, "is_core_service"] = _normalize_bool_like(frame["is_core_service"])
    frame.loc[:, "is_failure_related"] = _normalize_bool_like(frame["is_failure_related"])
    frame.loc[:, "is_access_related"] = _normalize_bool_like(frame["is_access_related"])
    frame.loc[:, "is_business_hours"] = _normalize_bool_like(frame["is_business_hours"])
    frame.loc[:, "is_after_hours"] = _normalize_bool_like(frame["is_after_hours"])
    frame.loc[:, "requires_multiple_teams"] = _normalize_bool_like(frame["requires_multiple_teams"])
    frame.loc[:, "is_peak_hour"] = _normalize_bool_like(frame["is_peak_hour"])

    if "required_team_count" not in frame.columns:
        frame.loc[:, "required_team_count"] = 0
    frame.loc[:, "required_team_count"] = _safe_numeric(frame["required_team_count"], 0.0)

    domain_signal = _extract_domain_signal(frame)
    nature_signal = _normalize_text_upper(frame["ticket_nature"])
    req_type_signal = _normalize_text_upper(frame["opsmind_request_type"])

    frame.loc[:, "priority_score"] = shared_calculate_priority_score(frame)
    frame.loc[:, "rule_priority"] = frame["priority_score"].map(shared_map_priority_score)

    rng = np.random.default_rng(seed=random_state)
    rule_priority = frame["rule_priority"].astype(str).tolist()
    noisy_priority: list[str] = []

    for label in rule_priority:
        if rng.random() >= noise_rate:
            noisy_priority.append(label)
            continue

        level_idx = PRIORITY_TO_INDEX.get(label, 1)

        if level_idx == 0:
            noisy_priority.append(PRIORITY_LEVELS[1])
        elif level_idx == len(PRIORITY_LEVELS) - 1:
            noisy_priority.append(PRIORITY_LEVELS[-2])
        else:
            shift = rng.choice([-1, 1])
            noisy_priority.append(PRIORITY_LEVELS[level_idx + shift])

    frame.loc[:, "priority"] = noisy_priority

    return frame


def _prepare_feature_lists(
    df: pd.DataFrame,
    include_tfidf_text: bool,
    include_priority_score: bool,
) -> tuple[list[str], list[str], list[str], list[str]]:
    excluded_columns = [col for col in BASE_EXCLUDED_COLUMNS if col in df.columns]

    if not include_priority_score and "priority_score" in df.columns:
        excluded_columns.append("priority_score")

    feature_columns = [col for col in df.columns if col not in excluded_columns]

    if not include_tfidf_text:
        feature_columns = [
            col for col in feature_columns if col not in {"title", "description"}
        ]

    if include_tfidf_text:
        required_text = ["title", "description"]
        missing_text = [col for col in required_text if col not in feature_columns]
        if missing_text:
            raise ValueError(
                "Missing text columns required for TF-IDF experiment: "
                + ", ".join(missing_text)
            )

    numeric_features = [
        col for col in feature_columns if pd.api.types.is_numeric_dtype(df[col])
    ]
    categorical_features = [col for col in feature_columns if col not in numeric_features]

    if include_tfidf_text:
        # Title/description are consumed by TF-IDF, not by one-hot categorical encoding.
        categorical_features = [
            col for col in categorical_features if col not in {"title", "description"}
        ]

    return feature_columns, numeric_features, categorical_features, excluded_columns


def _build_preprocessor(
    numeric_features: list[str],
    categorical_features: list[str],
    include_tfidf_text: bool,
    force_dense_ohe: bool,
) -> ColumnTransformer:
    transformers: list[tuple[str, Any, Any]] = []

    if numeric_features:
        numeric_pipeline = Pipeline(
            steps=[("imputer", SimpleImputer(strategy="median"))]
        )
        transformers.append(("numeric", numeric_pipeline, numeric_features))

    if categorical_features:
        categorical_pipeline = Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="most_frequent")),
                ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=not force_dense_ohe)),
            ]
        )
        transformers.append(("categorical", categorical_pipeline, categorical_features))

    if include_tfidf_text:
        transformers.append(
            (
                "title_tfidf",
                TfidfVectorizer(max_features=1000, ngram_range=(1, 2)),
                "title",
            )
        )
        transformers.append(
            (
                "description_tfidf",
                TfidfVectorizer(max_features=3000, ngram_range=(1, 2)),
                "description",
            )
        )

    return ColumnTransformer(transformers=transformers, remainder="drop")


def _compute_metrics(y_true: pd.Series, y_pred: np.ndarray) -> dict[str, Any]:
    report = classification_report(
        y_true,
        y_pred,
        labels=PRIORITY_LEVELS,
        target_names=PRIORITY_LEVELS,
        output_dict=True,
        zero_division=0,
    )
    matrix = confusion_matrix(y_true, y_pred, labels=PRIORITY_LEVELS)

    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "macro_precision": float(
            precision_score(y_true, y_pred, average="macro", zero_division=0)
        ),
        "macro_recall": float(
            recall_score(y_true, y_pred, average="macro", zero_division=0)
        ),
        "macro_f1": float(f1_score(y_true, y_pred, average="macro", zero_division=0)),
        "weighted_precision": float(
            precision_score(y_true, y_pred, average="weighted", zero_division=0)
        ),
        "weighted_recall": float(
            recall_score(y_true, y_pred, average="weighted", zero_division=0)
        ),
        "weighted_f1": float(
            f1_score(y_true, y_pred, average="weighted", zero_division=0)
        ),
        "classification_report": report,
        "confusion_matrix": matrix.tolist(),
    }


def _create_experiment_result_template(config: ExperimentConfig) -> dict[str, Any]:
    return {
        "model_name": config.model_name,
        "experiment_name": config.name,
        "diagnostic_only": config.diagnostic_only,
        "feature_mode": config.feature_mode,
        "feature_columns_used": [],
        "excluded_columns": [],
        "skipped": False,
        "skip_reason": "",
        "train_accuracy": None,
        "test_accuracy": None,
        "accuracy": None,
        "macro_precision": None,
        "macro_recall": None,
        "macro_f1": None,
        "weighted_precision": None,
        "weighted_recall": None,
        "weighted_f1": None,
        "classification_report": {},
        "confusion_matrix": [],
    }


def _run_sklearn_experiment(
    df: pd.DataFrame,
    train_idx: pd.Index,
    test_idx: pd.Index,
    y_train: pd.Series,
    y_test: pd.Series,
    config: ExperimentConfig,
) -> tuple[dict[str, Any], Any | None]:
    result = _create_experiment_result_template(config)

    if config.estimator is None:
        result["skipped"] = True
        result["skip_reason"] = "Estimator is not available."
        return result, None

    try:
        feature_columns, numeric_features, categorical_features, excluded_columns = _prepare_feature_lists(
            df=df,
            include_tfidf_text=config.include_tfidf_text,
            include_priority_score=config.include_priority_score,
        )

        force_dense_ohe = config.name in {
            "hist_gradient_boosting_structured",
            "catboost_structured",
        }

        preprocessor = _build_preprocessor(
            numeric_features=numeric_features,
            categorical_features=categorical_features,
            include_tfidf_text=config.include_tfidf_text,
            force_dense_ohe=force_dense_ohe,
        )

        X_train = df.loc[train_idx, feature_columns].copy(deep=True)
        X_test = df.loc[test_idx, feature_columns].copy(deep=True)

        # Ensure text columns are strings for TF-IDF pipeline.
        if config.include_tfidf_text:
            X_train.loc[:, "title"] = _normalize_text_series(X_train["title"])
            X_train.loc[:, "description"] = _normalize_text_series(X_train["description"])
            X_test.loc[:, "title"] = _normalize_text_series(X_test["title"])
            X_test.loc[:, "description"] = _normalize_text_series(X_test["description"])

        pipeline = Pipeline(
            steps=[
                ("preprocessor", preprocessor),
                ("model", config.estimator),
            ]
        )

        pipeline.fit(X_train, y_train)

        train_pred = pipeline.predict(X_train)
        test_pred = pipeline.predict(X_test)

        metrics = _compute_metrics(y_true=y_test, y_pred=test_pred)

        result.update(
            {
                "feature_columns_used": feature_columns,
                "excluded_columns": excluded_columns,
                "train_accuracy": float(accuracy_score(y_train, train_pred)),
                "test_accuracy": float(accuracy_score(y_test, test_pred)),
                "accuracy": metrics["accuracy"],
                "macro_precision": metrics["macro_precision"],
                "macro_recall": metrics["macro_recall"],
                "macro_f1": metrics["macro_f1"],
                "weighted_precision": metrics["weighted_precision"],
                "weighted_recall": metrics["weighted_recall"],
                "weighted_f1": metrics["weighted_f1"],
                "classification_report": metrics["classification_report"],
                "confusion_matrix": metrics["confusion_matrix"],
            }
        )

        return result, pipeline

    except MemoryError as exc:
        result["skipped"] = True
        result["skip_reason"] = f"Skipped due to memory limits: {exc}"
        return result, None
    except Exception as exc:
        result["skipped"] = True
        result["skip_reason"] = str(exc)
        return result, None


def _build_experiment_configs(random_state: int) -> list[ExperimentConfig]:
    logistic = LogisticRegression(
        max_iter=2000,
        class_weight="balanced",
        solver="saga",
        random_state=random_state,
    )

    random_forest = RandomForestClassifier(
        n_estimators=300,
        random_state=random_state,
        class_weight="balanced",
        n_jobs=-1,
    )

    hist_gb = HistGradientBoostingClassifier(
        random_state=random_state,
        max_iter=300,
        learning_rate=0.05,
        max_leaf_nodes=31,
    )

    catboost_estimator: Any | None = None
    try:
        from catboost import CatBoostClassifier

        catboost_estimator = CatBoostClassifier(
            iterations=500,
            depth=6,
            learning_rate=0.05,
            loss_function="MultiClass",
            eval_metric="TotalF1",
            random_seed=random_state,
            verbose=False,
        )
    except Exception:
        catboost_estimator = None

    return [
        ExperimentConfig(
            name="logistic_regression_tfidf_structured",
            model_name="LogisticRegression",
            feature_mode="tfidf_plus_structured",
            diagnostic_only=False,
            include_tfidf_text=True,
            include_priority_score=False,
            estimator=logistic,
        ),
        ExperimentConfig(
            name="random_forest_structured",
            model_name="RandomForestClassifier",
            feature_mode="structured_only",
            diagnostic_only=False,
            include_tfidf_text=False,
            include_priority_score=False,
            estimator=random_forest,
        ),
        ExperimentConfig(
            name="hist_gradient_boosting_structured",
            model_name="HistGradientBoostingClassifier",
            feature_mode="structured_only",
            diagnostic_only=False,
            include_tfidf_text=False,
            include_priority_score=False,
            estimator=hist_gb,
        ),
        ExperimentConfig(
            name="catboost_structured",
            model_name="CatBoostClassifier",
            feature_mode="structured_only",
            diagnostic_only=False,
            include_tfidf_text=False,
            include_priority_score=False,
            estimator=catboost_estimator,
        ),
        ExperimentConfig(
            name="diagnostic_with_priority_score",
            model_name="LogisticRegression",
            feature_mode="structured_with_priority_score",
            diagnostic_only=True,
            include_tfidf_text=False,
            include_priority_score=True,
            estimator=LogisticRegression(
                max_iter=2000,
                class_weight="balanced",
                solver="saga",
                random_state=random_state,
            ),
        ),
    ]


def _select_best_non_diagnostic(
    experiment_results: dict[str, dict[str, Any]],
) -> tuple[str, dict[str, Any]]:
    candidates: list[tuple[str, dict[str, Any]]] = []
    for name, result in experiment_results.items():
        if result.get("diagnostic_only"):
            continue
        if result.get("skipped"):
            continue
        candidates.append((name, result))

    if not candidates:
        raise RuntimeError(
            "No non-diagnostic experiment completed successfully. "
            "Cannot select production model."
        )

    best_name, best_result = max(
        candidates,
        key=lambda item: (
            item[1].get("macro_f1", -1.0),
            item[1].get("weighted_f1", -1.0),
            item[1].get("test_accuracy", -1.0),
        ),
    )
    return best_name, best_result


def _print_summary(
    original_dist: dict[str, int],
    rule_dist: dict[str, int],
    final_dist: dict[str, int],
    enriched_path: Path,
    experiments: dict[str, dict[str, Any]],
    best_name: str,
    best_result: dict[str, Any],
    model_path: Path,
    metrics_path: Path,
) -> None:
    print("\n=== Training Summary ===")
    print("Dataset loaded successfully")
    print(f"Original priority distribution: {original_dist}")
    print(f"Rule priority distribution: {rule_dist}")
    print(f"Final generated priority distribution: {final_dist}")
    print(f"Derived columns added: {', '.join(DERIVED_COLUMNS)}")
    print(f"Enriched dataset saved path: {enriched_path}")

    print("\nExperiment results:")
    for name, result in experiments.items():
        if result.get("skipped"):
            print(f"- {name}: skipped ({result.get('skip_reason')})")
        else:
            print(
                f"- {name}: completed | "
                f"test_accuracy={result.get('test_accuracy'):.4f} | "
                f"macro_f1={result.get('macro_f1'):.4f} | "
                f"weighted_f1={result.get('weighted_f1'):.4f}"
            )

    print("\nBest selected production model:")
    print(f"- experiment: {best_name}")
    print(f"- model: {best_result.get('model_name')}")
    print(f"- test_accuracy: {best_result.get('test_accuracy'):.4f}")
    print(f"- macro_f1: {best_result.get('macro_f1'):.4f}")
    print(f"- weighted_f1: {best_result.get('weighted_f1'):.4f}")
    print(f"Model saved path: {model_path}")
    print(f"Metrics saved path: {metrics_path}")

    best_macro_f1 = float(best_result.get("macro_f1", 0.0))
    diagnostic = experiments.get("diagnostic_with_priority_score")

    print("\nInterpretation:")
    if best_macro_f1 >= 0.35:
        print("- Regenerated priority target is now learnable by production-style models.")
    else:
        print(
            "- Best non-diagnostic macro F1 is still near random-zone; "
            "target-generation rules or feature signal need strengthening."
        )

    if diagnostic and not diagnostic.get("skipped"):
        diag_macro = float(diagnostic.get("macro_f1", 0.0))
        if diag_macro - best_macro_f1 >= 0.10:
            print(
                "- Diagnostic model is much higher because priority_score is directly connected "
                "to generated labels (expected behavior)."
            )


def train(
    data_path: Path,
    model_dir: Path,
    random_state: int = 42,
    test_size: float = 0.2,
    noise_rate: float = 0.15,
) -> None:
    logger.info("Loading dataset from %s", data_path)
    raw_df = pd.read_csv(data_path)
    logger.info("Loaded %d rows and %d columns", len(raw_df), len(raw_df.columns))

    _validate_required_columns(raw_df)
    safe_df, optional_warnings = _ensure_optional_columns(raw_df)

    enriched_df = add_derived_features(safe_df)

    enriched_df.loc[:, "original_priority"] = _normalize_text_upper(enriched_df["priority"])

    enriched_df = generate_rule_based_priority(
        df=enriched_df,
        random_state=random_state,
        noise_rate=noise_rate,
    )

    # Keep target labels in fixed uppercase set.
    enriched_df.loc[:, "priority"] = _normalize_text_upper(enriched_df["priority"])
    enriched_df.loc[:, "rule_priority"] = _normalize_text_upper(enriched_df["rule_priority"])

    # Save enriched dataset.
    enriched_path = data_path.with_name("ITSM_Dataset_enriched.csv")
    enriched_df.to_csv(enriched_path, index=False)
    logger.info("Saved enriched dataset -> %s", enriched_path)

    # Prepare train/test split for fair experiment comparison.
    working_df = enriched_df.copy(deep=True)
    working_df = working_df[working_df[TARGET_COLUMN].isin(PRIORITY_LEVELS)].copy(deep=True)

    y = working_df[TARGET_COLUMN].astype(str)
    train_idx, test_idx = train_test_split(
        working_df.index,
        test_size=test_size,
        random_state=random_state,
        stratify=y,
    )

    y_train = y.loc[train_idx]
    y_test = y.loc[test_idx]

    # Run all experiments on identical split.
    experiment_results: dict[str, dict[str, Any]] = {}
    experiment_models: dict[str, Any | None] = {}

    for config in _build_experiment_configs(random_state=random_state):
        logger.info("Running experiment: %s", config.name)

        if config.name == "catboost_structured" and config.estimator is None:
            result = _create_experiment_result_template(config)
            result["skipped"] = True
            result["skip_reason"] = "CatBoost is not installed in this environment."
            experiment_results[config.name] = result
            experiment_models[config.name] = None
            continue

        result, fitted_model = _run_sklearn_experiment(
            df=working_df,
            train_idx=train_idx,
            test_idx=test_idx,
            y_train=y_train,
            y_test=y_test,
            config=config,
        )

        experiment_results[config.name] = result
        experiment_models[config.name] = fitted_model

    best_experiment_name, best_experiment_result = _select_best_non_diagnostic(experiment_results)
    best_model = experiment_models.get(best_experiment_name)
    if best_model is None:
        raise RuntimeError("Best experiment has no fitted model artifact to save.")

    model_dir.mkdir(parents=True, exist_ok=True)

    best_model_path = model_dir / "priority_model_pipeline.pkl"
    compatibility_model_path = model_dir / "priority_pipeline.pkl"
    metrics_path = model_dir / "metrics.json"

    joblib.dump(best_model, best_model_path)
    joblib.dump(best_model, compatibility_model_path)
    logger.info("Saved best model -> %s", best_model_path)

    # Build metrics payload.
    original_dist = _distribution(working_df["original_priority"])
    rule_dist = _distribution(working_df["rule_priority"])
    final_dist = _distribution(working_df["priority"])
    train_dist = _distribution(y_train)
    test_dist = _distribution(y_test)

    existing_excluded = [col for col in BASE_EXCLUDED_COLUMNS if col in working_df.columns]

    metrics_payload = {
        "dataset": {
            "source_file": data_path.name,
            "enriched_file": enriched_path.name,
            "rows": int(len(raw_df)),
            "original_column_count": int(len(raw_df.columns)),
            "enriched_column_count": int(len(enriched_df.columns)),
            "target": "priority",
            "original_priority_distribution": original_dist,
            "rule_priority_distribution": rule_dist,
            "final_priority_distribution": final_dist,
            "train_class_distribution": train_dist,
            "test_class_distribution": test_dist,
        },
        "feature_engineering": {
            "derived_columns_added": DERIVED_COLUMNS,
            "target_generation": {
                "enabled": True,
                "method": "rule_based_itsm_priority_with_controlled_noise",
                "noise_rate": noise_rate,
                "random_state": random_state,
                "priority_score_mapping": {
                    "LOW": "score <= 4",
                    "MEDIUM": "score 5 to 7",
                    "HIGH": "score 8 to 10",
                    "CRITICAL": "score >= 11",
                },
                "notes": [
                    "original_priority preserves the old source label.",
                    "priority was regenerated using realistic ITSM operational rules.",
                    "Controlled one-level label noise was added to avoid unrealistically perfect labels.",
                ],
            },
            "excluded_columns_base": existing_excluded,
            "notes": [
                "resolution_time_hours was excluded from priority prediction to avoid target leakage.",
                "SLA-related fields were not used.",
                "priority_score is excluded from production-style model experiments.",
                "priority_score is included only in the diagnostic experiment.",
            ],
            "optional_column_warnings": optional_warnings,
        },
        "experiments": experiment_results,
        "best_model": {
            "experiment_name": best_experiment_name,
            "model_name": best_experiment_result.get("model_name"),
            "selection_metric": "macro_f1",
            "test_accuracy": float(best_experiment_result.get("test_accuracy", 0.0)),
            "macro_f1": float(best_experiment_result.get("macro_f1", 0.0)),
            "weighted_f1": float(best_experiment_result.get("weighted_f1", 0.0)),
            "model_file": str(Path("models") / "priority_model_pipeline.pkl"),
        },
        "artifacts": {
            "enriched_dataset": enriched_path.name,
            "model_file": str(Path("models") / "priority_model_pipeline.pkl"),
            "metrics_file": str(Path("models") / "metrics.json"),
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    with metrics_path.open("w", encoding="utf-8") as file_obj:
        json.dump(_to_builtin(metrics_payload), file_obj, indent=2)
    logger.info("Saved metrics -> %s", metrics_path)

    _print_summary(
        original_dist=original_dist,
        rule_dist=rule_dist,
        final_dist=final_dist,
        enriched_path=enriched_path,
        experiments=experiment_results,
        best_name=best_experiment_name,
        best_result=best_experiment_result,
        model_path=best_model_path,
        metrics_path=metrics_path,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Train OpsMind hybrid priority model pipeline")
    parser.add_argument(
        "--data",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "ITSM_Dataset.csv",
        help="Path to ITSM_Dataset.csv",
    )
    parser.add_argument(
        "--model-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "models",
        help="Directory for model artifacts",
    )
    parser.add_argument(
        "--random-state",
        type=int,
        default=42,
        help="Random seed",
    )
    parser.add_argument(
        "--test-size",
        type=float,
        default=0.2,
        help="Test split size",
    )
    parser.add_argument(
        "--noise-rate",
        type=float,
        default=0.15,
        help="Controlled one-level label noise rate",
    )

    args = parser.parse_args()

    train(
        data_path=args.data,
        model_dir=args.model_dir,
        random_state=args.random_state,
        test_size=args.test_size,
        noise_rate=args.noise_rate,
    )


if __name__ == "__main__":
    main()
