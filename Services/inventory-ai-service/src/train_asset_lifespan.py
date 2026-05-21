"""
Train the OpsMind asset lifespan model.

Expected CSV columns:
  type, brand, model, ram_gb, storage_gb, working_hours,
  operational_state, lifespan_years
"""

import argparse
import os

import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder


FEATURES = [
    "type",
    "brand",
    "model",
    "ram_gb",
    "storage_gb",
    "working_hours",
    "operational_state",
]
TARGET = "lifespan_years"


def train(data_path: str, model_dir: str) -> str:
    data = pd.read_csv(data_path)
    missing = [column for column in FEATURES + [TARGET] if column not in data.columns]
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(missing)}")

    X = data[FEATURES].copy()
    y = data[TARGET].astype(float)
    sample_weight = None
    if "sample_weight" in data.columns:
        sample_weight = pd.to_numeric(data["sample_weight"], errors="coerce").fillna(1.0).clip(lower=0.05)

    categorical = ["type", "brand", "model", "operational_state"]
    numeric = ["ram_gb", "storage_gb", "working_hours"]

    preprocessor = ColumnTransformer(
        transformers=[
            ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), categorical),
            ("num", "passthrough", numeric),
        ]
    )

    model = Pipeline(
        steps=[
            ("preprocess", preprocessor),
            ("regressor", HistGradientBoostingRegressor(random_state=42)),
        ]
    )
    if sample_weight is not None:
        model.fit(X, y, regressor__sample_weight=sample_weight)
    else:
        model.fit(X, y)

    os.makedirs(model_dir, exist_ok=True)
    output_path = os.path.join(model_dir, "asset_lifespan_model.pkl")
    joblib.dump(model, output_path)
    return output_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train OpsMind asset lifespan model")
    parser.add_argument("--data", required=True, help="CSV path with asset lifespan history")
    parser.add_argument(
        "--model-dir",
        default=os.path.join(os.path.dirname(os.path.dirname(__file__)), "models"),
        help="Output directory for asset_lifespan_model.pkl",
    )
    args = parser.parse_args()
    print(f"Saved model to {train(args.data, args.model_dir)}")
