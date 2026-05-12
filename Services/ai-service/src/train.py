"""
OpsMind AI Service — training pipeline.

This trainer follows the real OpsMind workflow assumption that newly created
tickets are always at L1. Therefore, `support_level` is excluded from model
features for initial prediction.

Usage:
    python -m src.train --data ITSM_Dataset.csv --model-dir models
"""

from __future__ import annotations

import argparse
import json
import logging
import os
from typing import Any, Dict, Tuple

import joblib
import pandas as pd
from sklearn.base import clone
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.ensemble import (
    HistGradientBoostingClassifier,
    HistGradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    r2_score,
    root_mean_squared_error,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from src.preprocess import (
    PRIORITY_LABELS,
    PRODUCTION_CATEGORICAL_FEATURES,
    PRODUCTION_FEATURES,
    PRODUCTION_NUMERIC_FEATURES,
    REMOVED_FEATURES,
    preprocess_for_training,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


def _build_preprocessor() -> ColumnTransformer:
    return ColumnTransformer(
        transformers=[
            (
                "categorical",
                OneHotEncoder(handle_unknown="ignore", sparse_output=False),
                PRODUCTION_CATEGORICAL_FEATURES,
            ),
            (
                "numeric",
                "passthrough",
                PRODUCTION_NUMERIC_FEATURES,
            ),
        ],
        remainder="drop",
        verbose_feature_names_out=False,
    )


def _build_priority_candidates(random_state: int) -> Dict[str, Any]:
    return {
        "dummy_most_frequent": DummyClassifier(strategy="most_frequent"),
        "logistic_regression": LogisticRegression(max_iter=2000, random_state=random_state),
        "random_forest": RandomForestClassifier(
            n_estimators=400,
            random_state=random_state,
            n_jobs=-1,
            min_samples_leaf=2,
        ),
        "hist_gradient_boosting": HistGradientBoostingClassifier(
            random_state=random_state,
            learning_rate=0.05,
            max_iter=300,
            min_samples_leaf=20,
        ),
    }


def _build_estimation_candidates(random_state: int) -> Dict[str, Any]:
    return {
        "dummy_mean": DummyRegressor(strategy="mean"),
        "random_forest": RandomForestRegressor(
            n_estimators=400,
            random_state=random_state,
            n_jobs=-1,
            min_samples_leaf=2,
        ),
        "hist_gradient_boosting": HistGradientBoostingRegressor(
            random_state=random_state,
            learning_rate=0.05,
            max_iter=300,
            min_samples_leaf=20,
        ),
    }


def _split_with_optional_stratify(
    *arrays,
    test_size: float,
    random_state: int,
    stratify,
    split_name: str,
):
    """Attempt a stratified split and fall back safely if needed."""
    try:
        result = train_test_split(
            *arrays,
            test_size=test_size,
            random_state=random_state,
            stratify=stratify,
        )
        logger.info("%s split: stratification enabled.", split_name)
        return result, True
    except ValueError as exc:
        logger.warning(
            "%s split stratification failed (%s). Falling back to non-stratified split.",
            split_name,
            exc,
        )
        result = train_test_split(
            *arrays,
            test_size=test_size,
            random_state=random_state,
            stratify=None,
        )
        return result, False


def _priority_distribution(y: pd.Series) -> Dict[str, int]:
    counts = y.value_counts().to_dict()
    return {
        label: int(counts.get(idx, 0))
        for idx, label in enumerate(PRIORITY_LABELS)
    }


def _regression_metrics(y_true: pd.Series, y_pred: Any) -> Dict[str, float]:
    return {
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "rmse": float(root_mean_squared_error(y_true, y_pred)),
        "r2": float(r2_score(y_true, y_pred)),
    }


def _classification_metrics(y_true: pd.Series, y_pred: Any) -> Dict[str, float]:
    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "macro_f1": float(f1_score(y_true, y_pred, average="macro", zero_division=0)),
    }


def _to_builtin(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): _to_builtin(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_builtin(v) for v in value]
    if hasattr(value, "item"):
        return value.item()
    return value


def _fit_priority_candidates(
    candidates: Dict[str, Any],
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_validation: pd.DataFrame,
    y_validation: pd.Series,
    X_test: pd.DataFrame,
    y_test: pd.Series,
) -> Dict[str, Dict[str, Any]]:
    results: Dict[str, Dict[str, Any]] = {}

    for name, estimator in candidates.items():
        pipeline = Pipeline(
            steps=[
                ("preprocessor", _build_preprocessor()),
                ("model", clone(estimator)),
            ]
        )
        pipeline.fit(X_train, y_train)

        train_pred = pipeline.predict(X_train)
        validation_pred = pipeline.predict(X_validation)
        test_pred = pipeline.predict(X_test)

        train_metrics = _classification_metrics(y_train, train_pred)
        validation_metrics = _classification_metrics(y_validation, validation_pred)
        test_metrics = _classification_metrics(y_test, test_pred)

        results[name] = {
            "pipeline": pipeline,
            "train": train_metrics,
            "validation": validation_metrics,
            "test": test_metrics,
            "validation_pred": validation_pred,
            "test_pred": test_pred,
        }

        logger.info(
            "Priority candidate=%s | val_macro_f1=%.4f | val_acc=%.4f",
            name,
            validation_metrics["macro_f1"],
            validation_metrics["accuracy"],
        )

    return results


def _fit_estimation_candidates(
    candidates: Dict[str, Any],
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_validation: pd.DataFrame,
    y_validation: pd.Series,
    X_test: pd.DataFrame,
    y_test: pd.Series,
) -> Dict[str, Dict[str, Any]]:
    results: Dict[str, Dict[str, Any]] = {}

    for name, estimator in candidates.items():
        pipeline = Pipeline(
            steps=[
                ("preprocessor", _build_preprocessor()),
                ("model", clone(estimator)),
            ]
        )
        pipeline.fit(X_train, y_train)

        train_pred = pipeline.predict(X_train)
        validation_pred = pipeline.predict(X_validation)
        test_pred = pipeline.predict(X_test)

        train_metrics = _regression_metrics(y_train, train_pred)
        validation_metrics = _regression_metrics(y_validation, validation_pred)
        test_metrics = _regression_metrics(y_test, test_pred)

        results[name] = {
            "pipeline": pipeline,
            "train": train_metrics,
            "validation": validation_metrics,
            "test": test_metrics,
        }

        logger.info(
            "EST candidate=%s | val_rmse=%.4f | val_mae=%.4f | val_r2=%.4f",
            name,
            validation_metrics["rmse"],
            validation_metrics["mae"],
            validation_metrics["r2"],
        )

    return results


def train(
    data_path: str,
    model_dir: str,
    random_state: int = 42,
    train_size: float = 0.70,
    validation_size: float = 0.15,
    test_size: float = 0.15,
) -> None:
    if round(train_size + validation_size + test_size, 8) != 1.0:
        raise ValueError("train_size + validation_size + test_size must equal 1.0")

    logger.info("Loading data from %s", data_path)
    raw_df = pd.read_csv(data_path)
    logger.info("Loaded %d rows, %d columns", len(raw_df), len(raw_df.columns))

    X, y_priority, y_resolution = preprocess_for_training(raw_df)
    logger.info("Rows after preprocessing: %d", len(X))
    logger.info("Feature frame shape: %s", X.shape)

    total_distribution = _priority_distribution(y_priority)
    logger.info("Priority distribution (total): %s", total_distribution)

    first_split, stratified_first = _split_with_optional_stratify(
        X,
        y_priority,
        y_resolution,
        test_size=test_size,
        random_state=random_state,
        stratify=y_priority,
        split_name="Train+Validation vs Test",
    )
    (
        X_train_valid,
        X_test,
        y_pri_train_valid,
        y_pri_test,
        y_res_train_valid,
        y_res_test,
    ) = first_split

    validation_relative_size = validation_size / (train_size + validation_size)
    second_split, stratified_second = _split_with_optional_stratify(
        X_train_valid,
        y_pri_train_valid,
        y_res_train_valid,
        test_size=validation_relative_size,
        random_state=random_state,
        stratify=y_pri_train_valid,
        split_name="Train vs Validation",
    )
    (
        X_train,
        X_validation,
        y_pri_train,
        y_pri_validation,
        y_res_train,
        y_res_validation,
    ) = second_split

    train_distribution = _priority_distribution(y_pri_train)
    validation_distribution = _priority_distribution(y_pri_validation)
    test_distribution = _priority_distribution(y_pri_test)

    logger.info("Priority distribution (train): %s", train_distribution)
    logger.info("Priority distribution (validation): %s", validation_distribution)
    logger.info("Priority distribution (test): %s", test_distribution)

    priority_candidates = _build_priority_candidates(random_state=random_state)
    priority_results = _fit_priority_candidates(
        candidates=priority_candidates,
        X_train=X_train,
        y_train=y_pri_train,
        X_validation=X_validation,
        y_validation=y_pri_validation,
        X_test=X_test,
        y_test=y_pri_test,
    )

    selected_priority_name = max(
        priority_results.keys(),
        key=lambda name: (
            priority_results[name]["validation"]["macro_f1"],
            priority_results[name]["validation"]["accuracy"],
        ),
    )
    selected_priority = priority_results[selected_priority_name]
    priority_pipeline = selected_priority["pipeline"]
    logger.info("Selected priority model: %s", selected_priority_name)

    label_indices = list(range(len(PRIORITY_LABELS)))
    validation_report = classification_report(
        y_pri_validation,
        selected_priority["validation_pred"],
        labels=label_indices,
        target_names=PRIORITY_LABELS,
        output_dict=True,
        zero_division=0,
    )
    test_report = classification_report(
        y_pri_test,
        selected_priority["test_pred"],
        labels=label_indices,
        target_names=PRIORITY_LABELS,
        output_dict=True,
        zero_division=0,
    )
    validation_confusion = confusion_matrix(
        y_pri_validation,
        selected_priority["validation_pred"],
        labels=label_indices,
    )
    test_confusion = confusion_matrix(
        y_pri_test,
        selected_priority["test_pred"],
        labels=label_indices,
    )

    logger.info(
        "Priority selected metrics | train_acc=%.4f val_acc=%.4f test_acc=%.4f | "
        "train_f1=%.4f val_f1=%.4f test_f1=%.4f",
        selected_priority["train"]["accuracy"],
        selected_priority["validation"]["accuracy"],
        selected_priority["test"]["accuracy"],
        selected_priority["train"]["macro_f1"],
        selected_priority["validation"]["macro_f1"],
        selected_priority["test"]["macro_f1"],
    )
    logger.info(
        "Priority validation confusion matrix (selected=%s):\n%s",
        selected_priority_name,
        validation_confusion,
    )
    logger.info(
        "Priority test confusion matrix (selected=%s):\n%s",
        selected_priority_name,
        test_confusion,
    )

    est_candidates = _build_estimation_candidates(random_state=random_state)
    est_results = _fit_estimation_candidates(
        candidates=est_candidates,
        X_train=X_train,
        y_train=y_res_train,
        X_validation=X_validation,
        y_validation=y_res_validation,
        X_test=X_test,
        y_test=y_res_test,
    )

    selected_est_name = min(
        est_results.keys(),
        key=lambda name: (
            est_results[name]["validation"]["rmse"],
            est_results[name]["validation"]["mae"],
        ),
    )
    selected_est = est_results[selected_est_name]
    est_pipeline = selected_est["pipeline"]
    logger.info("Selected EST model: %s", selected_est_name)

    logger.info(
        "EST selected metrics | train_rmse=%.4f val_rmse=%.4f test_rmse=%.4f | "
        "train_mae=%.4f val_mae=%.4f test_mae=%.4f",
        selected_est["train"]["rmse"],
        selected_est["validation"]["rmse"],
        selected_est["test"]["rmse"],
        selected_est["train"]["mae"],
        selected_est["validation"]["mae"],
        selected_est["test"]["mae"],
    )

    priority_baseline = priority_results["dummy_most_frequent"]
    est_baseline = est_results["dummy_mean"]

    warnings_list: list[str] = []
    priority_val_f1_delta = (
        selected_priority["validation"]["macro_f1"]
        - priority_baseline["validation"]["macro_f1"]
    )
    priority_val_acc_delta = (
        selected_priority["validation"]["accuracy"]
        - priority_baseline["validation"]["accuracy"]
    )
    if priority_val_f1_delta <= 0.02 and priority_val_acc_delta <= 0.02:
        warnings_list.append(
            "Priority model is close to baseline on validation "
            f"(delta_macro_f1={priority_val_f1_delta:.4f}, delta_accuracy={priority_val_acc_delta:.4f})."
        )

    est_val_rmse_delta = (
        est_baseline["validation"]["rmse"] - selected_est["validation"]["rmse"]
    )
    if est_val_rmse_delta <= 0.02:
        warnings_list.append(
            "Resolution model is close to baseline on validation "
            f"(rmse_improvement={est_val_rmse_delta:.4f})."
        )

    fitted_preprocessor: ColumnTransformer = priority_pipeline.named_steps["preprocessor"]
    transformed_feature_names = list(fitted_preprocessor.get_feature_names_out())

    metrics: Dict[str, Any] = {
        "selected_priority_model_name": selected_priority_name,
        "selected_est_model_name": selected_est_name,
        "feature_list": PRODUCTION_FEATURES,
        "removed_feature_list": REMOVED_FEATURES,
        "dataset": {
            "rows_after_preprocessing": int(len(X)),
            "feature_count": int(len(PRODUCTION_FEATURES)),
            "feature_names": PRODUCTION_FEATURES,
            "transformed_feature_count": int(len(transformed_feature_names)),
            "transformed_feature_names": transformed_feature_names,
            "priority_distribution_total": total_distribution,
            "priority_distribution_train": train_distribution,
            "priority_distribution_validation": validation_distribution,
            "priority_distribution_test": test_distribution,
        },
        "priority_model": {
            "train_accuracy": selected_priority["train"]["accuracy"],
            "validation_accuracy": selected_priority["validation"]["accuracy"],
            "test_accuracy": selected_priority["test"]["accuracy"],
            "train_macro_f1": selected_priority["train"]["macro_f1"],
            "validation_macro_f1": selected_priority["validation"]["macro_f1"],
            "test_macro_f1": selected_priority["test"]["macro_f1"],
            "validation_classification_report": validation_report,
            "test_classification_report": test_report,
            "validation_confusion_matrix": validation_confusion.tolist(),
            "test_confusion_matrix": test_confusion.tolist(),
            "candidate_validation_scores": {
                name: {
                    "validation_accuracy": result["validation"]["accuracy"],
                    "validation_macro_f1": result["validation"]["macro_f1"],
                }
                for name, result in priority_results.items()
            },
        },
        "estimation_model": {
            "train_mae": selected_est["train"]["mae"],
            "train_rmse": selected_est["train"]["rmse"],
            "train_r2": selected_est["train"]["r2"],
            "validation_mae": selected_est["validation"]["mae"],
            "validation_rmse": selected_est["validation"]["rmse"],
            "validation_r2": selected_est["validation"]["r2"],
            "test_mae": selected_est["test"]["mae"],
            "test_rmse": selected_est["test"]["rmse"],
            "test_r2": selected_est["test"]["r2"],
            "candidate_validation_scores": {
                name: {
                    "validation_mae": result["validation"]["mae"],
                    "validation_rmse": result["validation"]["rmse"],
                    "validation_r2": result["validation"]["r2"],
                }
                for name, result in est_results.items()
            },
        },
        "baseline": {
            "priority": {
                "train_accuracy": priority_baseline["train"]["accuracy"],
                "validation_accuracy": priority_baseline["validation"]["accuracy"],
                "test_accuracy": priority_baseline["test"]["accuracy"],
                "train_macro_f1": priority_baseline["train"]["macro_f1"],
                "validation_macro_f1": priority_baseline["validation"]["macro_f1"],
                "test_macro_f1": priority_baseline["test"]["macro_f1"],
            },
            "estimation": {
                "train_mae": est_baseline["train"]["mae"],
                "train_rmse": est_baseline["train"]["rmse"],
                "train_r2": est_baseline["train"]["r2"],
                "validation_mae": est_baseline["validation"]["mae"],
                "validation_rmse": est_baseline["validation"]["rmse"],
                "validation_r2": est_baseline["validation"]["r2"],
                "test_mae": est_baseline["test"]["mae"],
                "test_rmse": est_baseline["test"]["rmse"],
                "test_r2": est_baseline["test"]["r2"],
            },
        },
        "warnings": warnings_list,
    }

    split_config: Dict[str, Any] = {
        "train_size": train_size,
        "validation_size": validation_size,
        "test_size": test_size,
        "random_state": random_state,
        "stratified": bool(stratified_first and stratified_second),
        "stratified_splits": {
            "train_valid_vs_test": bool(stratified_first),
            "train_vs_validation": bool(stratified_second),
        },
    }

    os.makedirs(model_dir, exist_ok=True)

    priority_pipeline_path = os.path.join(model_dir, "priority_pipeline.pkl")
    est_pipeline_path = os.path.join(model_dir, "est_pipeline.pkl")
    meta_path = os.path.join(model_dir, "model_metadata.pkl")
    metrics_path = os.path.join(model_dir, "metrics.json")

    joblib.dump(priority_pipeline, priority_pipeline_path)
    logger.info("Saved priority pipeline -> %s", priority_pipeline_path)

    joblib.dump(est_pipeline, est_pipeline_path)
    logger.info("Saved EST pipeline -> %s", est_pipeline_path)

    metrics_builtin = _to_builtin(metrics)
    with open(metrics_path, "w", encoding="utf-8") as fp:
        json.dump(metrics_builtin, fp, indent=2)
    logger.info("Saved metrics -> %s", metrics_path)

    metadata = {
        "priority_labels": PRIORITY_LABELS,
        "feature_names": PRODUCTION_FEATURES,
        "transformed_feature_names": transformed_feature_names,
        "removed_feature_names": REMOVED_FEATURES,
        "selected_priority_model_name": selected_priority_name,
        "selected_est_model_name": selected_est_name,
        "training_summary": metrics_builtin,
        "split_config": split_config,
    }
    joblib.dump(metadata, meta_path)
    logger.info("Saved metadata -> %s", meta_path)

    logger.info("Training complete.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Train OpsMind AI models")
    parser.add_argument(
        "--data",
        type=str,
        required=True,
        help="Path to historical ticket CSV file (e.g. ITSM_Dataset.csv)",
    )
    parser.add_argument(
        "--model-dir",
        type=str,
        default=os.path.join(os.path.dirname(os.path.dirname(__file__)), "models"),
        help="Directory to save trained model artifacts (default: models/)",
    )
    parser.add_argument(
        "--random-state",
        type=int,
        default=42,
        help="Random seed for reproducible split and training (default: 42)",
    )
    parser.add_argument(
        "--train-size",
        type=float,
        default=0.70,
        help="Training split size (default: 0.70)",
    )
    parser.add_argument(
        "--validation-size",
        type=float,
        default=0.15,
        help="Validation split size (default: 0.15)",
    )
    parser.add_argument(
        "--test-size",
        type=float,
        default=0.15,
        help="Test split size (default: 0.15)",
    )

    args = parser.parse_args()

    train(
        data_path=args.data,
        model_dir=args.model_dir,
        random_state=args.random_state,
        train_size=args.train_size,
        validation_size=args.validation_size,
        test_size=args.test_size,
    )


if __name__ == "__main__":
    main()
