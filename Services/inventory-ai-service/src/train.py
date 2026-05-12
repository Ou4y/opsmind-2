"""
OpsMind AI Service — Training script.

Trains two models on historical ticket data (ITSM_Dataset.csv):
    1. Priority Prediction    (HistGradientBoostingClassifier) → LOW / MEDIUM / HIGH
    2. Estimated Resolution   (HistGradientBoostingRegressor)  → hours

The CSV is normalised to match the production Ticket schema during
preprocessing.  See ``preprocess.py`` for column mapping details.

Usage
-----
    python -m src.train --data ITSM_Dataset.csv [--model-dir models]

The script writes three artefacts to ``--model-dir``:
  • priority_model.pkl
  • est_model.pkl
  • model_metadata.pkl   (OHE column map + feature names)
"""

import argparse
import logging
import os
from typing import Tuple

import joblib
import pandas as pd
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    mean_absolute_error,
    root_mean_squared_error,
    r2_score,
)

from src.preprocess import preprocess_for_training, PRIORITY_LABELS

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


def _build_priority_model(random_state: int) -> HistGradientBoostingClassifier:
    """Create the tuned priority classifier.

    These settings performed better than the previous random forest baseline
    on this dataset while keeping training time reasonable.
    """
    return HistGradientBoostingClassifier(
        learning_rate=0.03,
        max_iter=300,
        max_depth=8,
        min_samples_leaf=20,
        l2_regularization=0.05,
        random_state=random_state,
    )


def _build_estimation_model(random_state: int) -> HistGradientBoostingRegressor:
    """Create the tuned resolution-time regressor."""
    return HistGradientBoostingRegressor(
        learning_rate=0.03,
        max_iter=300,
        max_depth=8,
        min_samples_leaf=20,
        l2_regularization=0.05,
        random_state=random_state,
    )


def _evaluate_priority(
    y_true: pd.Series,
    y_pred: pd.Series,
) -> float:
    """Log detailed priority metrics and return accuracy."""
    accuracy = accuracy_score(y_true, y_pred)

    present_labels = sorted(set(y_true.unique()) | set(y_pred))
    present_names = [PRIORITY_LABELS[i] for i in present_labels if i < len(PRIORITY_LABELS)]

    logger.info("Priority model accuracy: %.4f", accuracy)
    logger.info(
        "\n%s",
        classification_report(
            y_true,
            y_pred,
            labels=present_labels,
            target_names=present_names,
            zero_division=0,
        ),
    )
    return float(accuracy)


def _evaluate_estimation(
    y_true: pd.Series,
    y_pred: pd.Series,
) -> Tuple[float, float, float]:
    """Log and return MAE, RMSE, and R² for EST."""
    mae = mean_absolute_error(y_true, y_pred)
    rmse = root_mean_squared_error(y_true, y_pred)
    r2 = r2_score(y_true, y_pred)

    logger.info("EST model MAE : %.4f hours", mae)
    logger.info("EST model RMSE: %.4f hours", rmse)
    logger.info("EST model R²  : %.4f", r2)
    return float(mae), float(rmse), float(r2)


def train(data_path: str, model_dir: str, test_size: float = 0.2, random_state: int = 42) -> None:
    """Run the full training pipeline."""

    # ── 1. Load data ────────────────────────────────────────────────────────
    logger.info("Loading data from %s", data_path)
    df = pd.read_csv(data_path)
    logger.info("Loaded %d rows, %d columns", len(df), len(df.columns))

    # ── 2. Preprocess ───────────────────────────────────────────────────────
    X, y_priority, y_resolution, ohe_columns, feature_names = preprocess_for_training(df)
    logger.info("Feature matrix shape: %s", X.shape)
    logger.info("Priority distribution:\n%s", y_priority.value_counts().sort_index())

    # ── 3. Train / test split ───────────────────────────────────────────────
    (
        X_train, X_test,
        y_pri_train, y_pri_test,
        y_res_train, y_res_test,
    ) = train_test_split(
        X, y_priority, y_resolution,
        test_size=test_size,
        random_state=random_state,
        stratify=y_priority,
    )

    # ── 4. Baseline comparison ──────────────────────────────────────────────
    logger.info("Training baseline models for comparison …")

    baseline_pri = DummyClassifier(strategy="most_frequent")
    baseline_pri.fit(X_train, y_pri_train)
    baseline_pri_pred = baseline_pri.predict(X_test)
    baseline_pri_acc = accuracy_score(y_pri_test, baseline_pri_pred)
    logger.info("Baseline priority accuracy (most_frequent): %.4f", baseline_pri_acc)

    baseline_est = DummyRegressor(strategy="mean")
    baseline_est.fit(X_train, y_res_train)
    baseline_est_pred = baseline_est.predict(X_test)
    baseline_est_mae = mean_absolute_error(y_res_test, baseline_est_pred)
    baseline_est_rmse = root_mean_squared_error(y_res_test, baseline_est_pred)
    baseline_est_r2 = r2_score(y_res_test, baseline_est_pred)
    logger.info("Baseline EST MAE : %.4f hours", baseline_est_mae)
    logger.info("Baseline EST RMSE: %.4f hours", baseline_est_rmse)
    logger.info("Baseline EST R²  : %.4f", baseline_est_r2)

    # ── 5. Train Priority model ─────────────────────────────────────────────
    logger.info("Training Priority model (HistGradientBoostingClassifier) …")
    priority_clf = _build_priority_model(random_state=random_state)
    priority_clf.fit(X_train, y_pri_train)

    y_pri_pred = priority_clf.predict(X_test)
    model_pri_acc = _evaluate_priority(y_pri_test, y_pri_pred)

    # ── 6. Train EST model ──────────────────────────────────────────────────
    logger.info("Training EST model (HistGradientBoostingRegressor) …")
    est_reg = _build_estimation_model(random_state=random_state)
    est_reg.fit(X_train, y_res_train)

    y_res_pred = est_reg.predict(X_test)
    model_est_mae, model_est_rmse, model_est_r2 = _evaluate_estimation(y_res_test, y_res_pred)

    # Summarise gains vs baseline
    logger.info("Priority accuracy delta vs baseline: %+0.4f", model_pri_acc - baseline_pri_acc)
    logger.info("EST MAE delta vs baseline: %+0.4f hours", model_est_mae - baseline_est_mae)
    logger.info("EST RMSE delta vs baseline: %+0.4f hours", model_est_rmse - baseline_est_rmse)
    logger.info("EST R² delta vs baseline: %+0.4f", model_est_r2 - baseline_est_r2)

    # ── 7. Persist artefacts ────────────────────────────────────────────────
    os.makedirs(model_dir, exist_ok=True)

    priority_path = os.path.join(model_dir, "priority_model.pkl")
    est_path = os.path.join(model_dir, "est_model.pkl")
    meta_path = os.path.join(model_dir, "model_metadata.pkl")

    joblib.dump(priority_clf, priority_path)
    logger.info("Saved priority model → %s", priority_path)

    joblib.dump(est_reg, est_path)
    logger.info("Saved EST model → %s", est_path)

    metadata = {
        "ohe_columns": ohe_columns,
        "feature_names": feature_names,
        "priority_labels": PRIORITY_LABELS,
        "training_summary": {
            "priority_accuracy": model_pri_acc,
            "priority_baseline_accuracy": float(baseline_pri_acc),
            "est_mae": model_est_mae,
            "est_rmse": model_est_rmse,
            "est_r2": model_est_r2,
            "est_baseline_mae": float(baseline_est_mae),
            "est_baseline_rmse": float(baseline_est_rmse),
            "est_baseline_r2": float(baseline_est_r2),
        },
    }
    joblib.dump(metadata, meta_path)
    logger.info("Saved metadata → %s", meta_path)

    logger.info("Training complete ✅")


# ── CLI ──────────────────────────────────────────────────────────────────────


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
        help="Directory to save trained model artefacts (default: models/)",
    )
    parser.add_argument(
        "--test-size",
        type=float,
        default=0.2,
        help="Fraction of data to hold out for evaluation (default: 0.2)",
    )
    parser.add_argument(
        "--random-state",
        type=int,
        default=42,
        help="Random seed for reproducible split and model training (default: 42)",
    )
    args = parser.parse_args()

    train(
        data_path=args.data,
        model_dir=args.model_dir,
        test_size=args.test_size,
        random_state=args.random_state,
    )


if __name__ == "__main__":
    main()
