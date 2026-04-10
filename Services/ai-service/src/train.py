"""
OpsMind AI Service — Training script.

Trains two models on historical ticket data (ITSM_Dataset.csv):
  1. Priority Prediction   (RandomForestClassifier)  →  LOW / MEDIUM / HIGH
  2. Estimated Resolution   (RandomForestRegressor)   →  hours

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

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
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
    )

    # ── 4. Train Priority model ─────────────────────────────────────────────
    logger.info("Training Priority model (RandomForestClassifier) …")
    priority_clf = RandomForestClassifier(
        n_estimators=200,
        max_depth=20,
        min_samples_split=5,
        min_samples_leaf=2,
        class_weight="balanced",
        random_state=random_state,
        n_jobs=-1,
    )
    priority_clf.fit(X_train, y_pri_train)

    y_pri_pred = priority_clf.predict(X_test)
    logger.info("Priority model accuracy: %.4f", accuracy_score(y_pri_test, y_pri_pred))

    # Build target_names for only the classes present in the test set
    present_labels = sorted(set(y_pri_test.unique()) | set(y_pri_pred))
    present_names = [PRIORITY_LABELS[i] for i in present_labels if i < len(PRIORITY_LABELS)]
    logger.info(
        "\n%s",
        classification_report(
            y_pri_test, y_pri_pred,
            labels=present_labels,
            target_names=present_names,
            zero_division=0,
        ),
    )

    # ── 5. Train EST model ──────────────────────────────────────────────────
    logger.info("Training EST model (RandomForestRegressor) …")
    est_reg = RandomForestRegressor(
        n_estimators=200,
        max_depth=20,
        min_samples_split=5,
        min_samples_leaf=2,
        random_state=random_state,
        n_jobs=-1,
    )
    est_reg.fit(X_train, y_res_train)

    y_res_pred = est_reg.predict(X_test)
    logger.info("EST model MAE : %.4f hours", mean_absolute_error(y_res_test, y_res_pred))
    logger.info("EST model RMSE: %.4f hours", root_mean_squared_error(y_res_test, y_res_pred))
    logger.info("EST model R²  : %.4f", r2_score(y_res_test, y_res_pred))

    # ── 6. Persist artefacts ────────────────────────────────────────────────
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
    args = parser.parse_args()

    train(data_path=args.data, model_dir=args.model_dir, test_size=args.test_size)


if __name__ == "__main__":
    main()
