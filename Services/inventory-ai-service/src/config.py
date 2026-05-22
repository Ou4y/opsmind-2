"""Configuration and defaults for inventory-ai-service."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import os


def _to_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _parse_ollama_timeout_seconds() -> int:
    """Resolve timeout from either seconds or millisecond env vars.

    Ticket service uses OLLAMA_TIMEOUT_MS while inventory-ai historically used
    OLLAMA_TIMEOUT_SECONDS; support both so deployments stay compatible.
    """
    raw_seconds = os.getenv("OLLAMA_TIMEOUT_SECONDS")
    if raw_seconds is not None and str(raw_seconds).strip():
        return max(3, int(str(raw_seconds).strip()))

    raw_ms = os.getenv("OLLAMA_TIMEOUT_MS")
    if raw_ms is not None and str(raw_ms).strip():
        timeout_ms = max(3000, int(str(raw_ms).strip()))
        # Round up to avoid unintentionally shortening configured timeout.
        return max(3, (timeout_ms + 999) // 1000)

    return 45


@dataclass(slots=True)
class AppSettings:
    app_version: str = "1.1.0"

    llm_provider: str = "ollama"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"
    ollama_base_url: str = "http://host.docker.internal:11434"
    ollama_model: str = "gemma3:4b"
    ollama_timeout_seconds: int = 45

    data_dir: Path = Path("/app/data")
    model_dir: Path = Path("/app/models")

    spec_feedback_path: Path = Path("/app/data/spec_feedback.jsonl")
    spec_golden_path: Path = Path("/app/data/spec_golden_dataset.jsonl")
    spec_feedback_cache_path: Path = Path("/app/data/spec_feedback_cache.json")
    spec_variant_policy_path: Path = Path("/app/data/spec_variant_policy.json")

    spec_lookup_timeout_seconds: int = 8
    spec_http_retry_attempts: int = 3
    spec_http_backoff_seconds: float = 0.35
    spec_lookup_circuit_failures: int = 4
    spec_lookup_circuit_reset_seconds: int = 90
    spec_max_fetch_bytes: int = 180_000
    spec_max_search_links: int = 5
    spec_max_authoritative_links: int = 3

    serpapi_api_key: str = ""
    serpapi_endpoint: str = "https://serpapi.com/search.json"

    spec_rule_version_control: str = "spec-rules-v1"
    spec_rule_version_candidate: str = "spec-rules-v2"
    spec_ab_rollout_percent: int = 20
    spec_force_variant: str = ""
    spec_verification_confidence_threshold: float = 0.85
    spec_enable_local_model_catalog: bool = False
    spec_real_specs_only: bool = True

    spec_promotion_min_evals: int = 40
    spec_promotion_min_improvement: float = 0.01

    sla_resolution_target_hours: dict[str, float] = field(
        default_factory=lambda: {
            "HIGH": 4.0,
            "MEDIUM": 24.0,
            "LOW": 72.0,
        }
    )

    asset_brand_factors: dict[str, float] = field(
        default_factory=lambda: {
            "apple": 1.14,
            "dell": 1.08,
            "hp": 1.04,
            "lenovo": 1.07,
            "cisco": 1.16,
            "ubiquiti": 1.06,
            "epson": 1.05,
            "canon": 1.04,
            "samsung": 1.05,
            "lg": 1.04,
            "acer": 0.96,
            "asus": 1.0,
            "generic": 0.9,
        }
    )

    asset_quality_factors: dict[str, float] = field(
        default_factory=lambda: {
            "budget": 0.86,
            "standard": 1.0,
            "premium": 1.16,
            "rugged": 1.22,
        }
    )

    asset_state_factors: dict[str, float] = field(
        default_factory=lambda: {
            "online_in_use": 0.94,
            "online_idle": 0.99,
            "offline": 1.03,
        }
    )

    brand_spec_profiles: dict[str, dict[str, str]] = field(
        default_factory=lambda: {
            "apple": {"CPU Vendor": "Apple", "Storage Type": "SSD", "Display": "Retina"},
            "dell": {"CPU Vendor": "Intel", "Storage Type": "SSD"},
            "hp": {"CPU Vendor": "Intel", "Storage Type": "SSD"},
            "lenovo": {"CPU Vendor": "Intel", "Storage Type": "SSD"},
            "cisco": {"Managed": "Yes", "Rack Mount": "Yes"},
            "ubiquiti": {"Managed": "Yes", "PoE": "Supported"},
        }
    )

    type_spec_baselines: dict[str, dict[str, str]] = field(
        default_factory=lambda: {
            "laptop": {"RAM": "16GB", "Storage": "512GB SSD", "OS": "Windows 11 Pro"},
            "desktop": {"RAM": "16GB", "Storage": "512GB SSD", "OS": "Windows 11 Pro"},
            "tablet": {"RAM": "8GB", "Storage": "256GB SSD", "OS": "Android/iPadOS"},
            "server": {"RAM": "32GB", "Storage": "2TB SSD", "CPU": "8-core"},
            "monitor": {"Panel": "IPS", "Refresh Rate": "60Hz", "Resolution": "1920x1080"},
            "router": {"Ports": "4", "WiFi": "WiFi 6"},
            "switch": {"Ports": "24", "Managed": "Yes"},
            "access_point": {"WiFi": "WiFi 6", "Band": "Dual-band"},
            "firewall": {"Throughput": "1Gbps", "Managed": "Yes"},
            "printer": {"Print Type": "Laser", "Duplex": "Auto"},
            "scanner": {"Scan Type": "ADF", "Resolution": "600dpi"},
            "projector": {"Brightness": "3500 ANSI", "Resolution": "1920x1080"},
        }
    )

    authoritative_source_weights: dict[str, float] = field(
        default_factory=lambda: {
            "apple.com": 1.0,
            "dell.com": 0.99,
            "hp.com": 0.99,
            "lenovo.com": 0.99,
            "cisco.com": 0.99,
            "samsung.com": 0.97,
            "lg.com": 0.97,
            "asus.com": 0.97,
            "acer.com": 0.97,
            "microsoft.com": 0.97,
            "cdw.com": 0.9,
            "bhphotovideo.com": 0.9,
            "bestbuy.com": 0.88,
            "amazon.com": 0.84,
        }
    )

    @classmethod
    def from_env(cls) -> "AppSettings":
        data_dir = Path(os.getenv("INVENTORY_AI_DATA_DIR", "/app/data"))
        model_dir = Path(os.getenv("LIFESPAN_MODEL_DIR", "/app/models"))
        data_dir.mkdir(parents=True, exist_ok=True)
        model_dir.mkdir(parents=True, exist_ok=True)
        llm_provider = os.getenv("LLM_PROVIDER", "ollama").strip().lower() or "ollama"
        if llm_provider not in {"ollama", "gemini"}:
            llm_provider = "ollama"

        settings = cls(
            llm_provider=llm_provider,
            gemini_api_key=os.getenv("GEMINI_API_KEY", "").strip(),
            gemini_model=os.getenv("GEMINI_MODEL", "gemini-2.0-flash").strip() or "gemini-2.0-flash",
            ollama_base_url=(
                os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434").strip()
                or "http://host.docker.internal:11434"
            ),
            ollama_model=os.getenv("OLLAMA_MODEL", "gemma3:4b").strip() or "gemma3:4b",
            ollama_timeout_seconds=_parse_ollama_timeout_seconds(),
            data_dir=data_dir,
            model_dir=model_dir,
            spec_feedback_path=data_dir / "spec_feedback.jsonl",
            spec_golden_path=Path(os.getenv("SPEC_GOLDEN_PATH", str(data_dir / "spec_golden_dataset.jsonl"))),
            spec_feedback_cache_path=Path(
                os.getenv("SPEC_FEEDBACK_CACHE_PATH", str(data_dir / "spec_feedback_cache.json"))
            ),
            spec_variant_policy_path=Path(
                os.getenv("SPEC_VARIANT_POLICY_PATH", str(data_dir / "spec_variant_policy.json"))
            ),
            spec_lookup_timeout_seconds=max(1, int(os.getenv("SPEC_LOOKUP_TIMEOUT_SECONDS", "8"))),
            spec_http_retry_attempts=max(1, int(os.getenv("SPEC_HTTP_RETRY_ATTEMPTS", "3"))),
            spec_http_backoff_seconds=max(0.05, float(os.getenv("SPEC_HTTP_BACKOFF_SECONDS", "0.35"))),
            spec_lookup_circuit_failures=max(1, int(os.getenv("SPEC_LOOKUP_CIRCUIT_FAILURES", "4"))),
            spec_lookup_circuit_reset_seconds=max(5, int(os.getenv("SPEC_LOOKUP_CIRCUIT_RESET_SECONDS", "90"))),
            spec_max_fetch_bytes=max(20_000, int(os.getenv("SPEC_MAX_FETCH_BYTES", "180000"))),
            spec_max_search_links=max(1, int(os.getenv("SPEC_MAX_SEARCH_LINKS", "5"))),
            spec_max_authoritative_links=max(1, int(os.getenv("SPEC_MAX_AUTHORITATIVE_LINKS", "3"))),
            serpapi_api_key=os.getenv("SERPAPI_API_KEY", "").strip(),
            serpapi_endpoint=os.getenv("SERPAPI_ENDPOINT", "https://serpapi.com/search.json"),
            spec_rule_version_control=os.getenv("SPEC_RULE_VERSION_CONTROL", "spec-rules-v1"),
            spec_rule_version_candidate=os.getenv("SPEC_RULE_VERSION_CANDIDATE", "spec-rules-v2"),
            spec_ab_rollout_percent=max(0, min(100, int(os.getenv("SPEC_AB_ROLLOUT_PERCENT", "20")))),
            spec_force_variant=os.getenv("SPEC_FORCE_VARIANT", "").strip().lower(),
            spec_verification_confidence_threshold=float(
                os.getenv("SPEC_VERIFICATION_CONFIDENCE_THRESHOLD", "0.85")
            ),
            spec_enable_local_model_catalog=_to_bool(os.getenv("SPEC_ENABLE_LOCAL_MODEL_CATALOG"), False),
            spec_real_specs_only=_to_bool(os.getenv("SPEC_REAL_SPECS_ONLY"), True),
            spec_promotion_min_evals=max(1, int(os.getenv("SPEC_PROMOTION_MIN_EVALS", "40"))),
            spec_promotion_min_improvement=max(0.0, float(os.getenv("SPEC_PROMOTION_MIN_IMPROVEMENT", "0.01"))),
        )
        settings.spec_feedback_path.parent.mkdir(parents=True, exist_ok=True)
        return settings
