"""Asset lifespan prediction service."""

from __future__ import annotations

import re
from datetime import datetime, timezone

from src.config import AppSettings
from src.models import get_store
from src.observability import InMemoryMetrics
from src.schemas import AssetLifespanRequest, AssetLifespanResponse


class LifespanService:
    def __init__(self, settings: AppSettings, metrics: InMemoryMetrics) -> None:
        self.settings = settings
        self.metrics = metrics

    @staticmethod
    def _normalise_key(value: str | None) -> str:
        return "".join(ch for ch in str(value or "").lower() if ch.isalnum())

    def _spec_number(self, specs: dict, keys: list[str], fallback: float = 0.0) -> float:
        normalised = {self._normalise_key(k): v for k, v in (specs or {}).items()}
        for key in keys:
            value = normalised.get(self._normalise_key(key))
            if value is None:
                continue
            cleaned = "".join(ch for ch in str(value) if ch.isdigit() or ch == ".")
            try:
                return float(cleaned)
            except ValueError:
                continue
        return fallback

    def _infer_asset_quality(self, asset: AssetLifespanRequest) -> str:
        brand = self._normalise_key(asset.brand)
        model = self._normalise_key(asset.model)
        asset_type = self._normalise_key(asset.type)
        ram_gb = self._spec_number(asset.specifications, ["RAM", "Memory"])
        storage_gb = self._spec_number(asset.specifications, ["Storage", "SSD", "Disk"])

        score = 50
        if brand in {"apple", "cisco"}:
            score += 20
        elif brand in {"dell", "lenovo", "hp", "samsung", "lg"}:
            score += 12
        elif brand in {"acer", "generic"}:
            score -= 8

        premium_markers = (
            "pro",
            "max",
            "precision",
            "thinkpad",
            "latitude",
            "elitebook",
            "zbook",
            "xps",
            "server",
            "enterprise",
            "rugged",
            "ultra",
        )
        budget_markers = ("inspiron", "pavilion", "ideapad", "aspire", "basic", "entry", "mini")
        if any(marker in model for marker in premium_markers):
            score += 18
        if any(marker in model for marker in budget_markers):
            score -= 12
        if any(marker in model for marker in ("rugged", "toughbook", "industrial")):
            score += 24

        if ram_gb >= 32:
            score += 10
        elif ram_gb >= 16:
            score += 5
        elif 0 < ram_gb < 8:
            score -= 8

        if storage_gb >= 1000:
            score += 6
        elif 0 < storage_gb < 256:
            score -= 5

        if asset_type in {"server", "firewall", "switch"}:
            score += 8

        if score >= 82 or any(marker in model for marker in ("rugged", "toughbook", "industrial")):
            return "rugged"
        if score >= 66:
            return "premium"
        if score <= 42:
            return "budget"
        return "standard"

    @staticmethod
    def _version_factor(model: str | None) -> float:
        match = re.search(r"\b(20\d{2}|19\d{2})\b", str(model or ""))
        if not match:
            return 1.0
        age = datetime.now(timezone.utc).year - int(match.group(1))
        if age <= 1:
            return 1.08
        if age <= 3:
            return 1.03
        if age >= 7:
            return 0.88
        return 1.0

    def predict_asset_lifespan_fallback(self, asset: AssetLifespanRequest) -> AssetLifespanResponse:
        quality = self._infer_asset_quality(asset)
        brand_factor = self.settings.asset_brand_factors.get(self._normalise_key(asset.brand), 1.0)
        quality_factor = self.settings.asset_quality_factors.get(quality, 1.0)
        version_factor = self._version_factor(asset.model)
        state_factor = self.settings.asset_state_factors.get(asset.operational_state, 1.0)

        base_years = asset.base_lifespan_years
        expected_lifetime_hours = max(base_years * 365 * 8, 1)
        usage_ratio = asset.working_hours / expected_lifetime_hours
        usage_factor = max(0.5, 1 - max(0.0, usage_ratio - 0.25) * 0.42)

        predicted_years = max(
            1.0,
            base_years * brand_factor * quality_factor * version_factor * state_factor * usage_factor,
        )
        failure_risk = min(0.98, max(0.02, usage_ratio * 0.55 + (1 - usage_factor) * 0.6))

        return AssetLifespanResponse(
            predicted_lifespan_years=round(predicted_years, 1),
            quality_tier=quality,
            failure_risk=round(failure_risk, 3),
            model_version="asset-lifespan-fallback-v1",
            explanation="Estimated from brand/model/spec quality, telemetry state, and consumption-adjusted working hours.",
        )

    def predict_asset_lifespan(self, asset: AssetLifespanRequest) -> AssetLifespanResponse:
        store = get_store()
        quality = self._infer_asset_quality(asset)

        if store.asset_lifespan_model is None:
            return self.predict_asset_lifespan_fallback(asset)

        import pandas as pd

        ram_gb = self._spec_number(asset.specifications, ["RAM", "Memory"])
        storage_gb = self._spec_number(asset.specifications, ["Storage", "SSD", "Disk"])
        row = pd.DataFrame(
            [
                {
                    "type": asset.type,
                    "brand": asset.brand or "",
                    "model": asset.model or "",
                    "ram_gb": ram_gb,
                    "storage_gb": storage_gb,
                    "working_hours": asset.working_hours,
                    "operational_state": asset.operational_state,
                }
            ]
        )

        predicted_years = float(store.asset_lifespan_model.predict(row)[0])
        base = self.predict_asset_lifespan_fallback(asset)
        return AssetLifespanResponse(
            predicted_lifespan_years=round(max(predicted_years, 1.0), 1),
            quality_tier=quality,
            failure_risk=base.failure_risk,
            model_version="asset-lifespan-trained-v1",
            explanation="Predicted by trained asset lifespan model using brand, model, specs, and telemetry.",
        )
