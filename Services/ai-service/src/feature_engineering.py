"""
OpsMind AI Service — shared feature engineering for training/inference.

This module centralizes feature derivation used by the hybrid priority model and
rule layer so runtime inference stays aligned with training behavior.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict

import numpy as np
import pandas as pd

PRIORITY_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
PRIORITY_TO_INDEX = {label: idx for idx, label in enumerate(PRIORITY_LEVELS)}

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

MODEL_FEATURE_COLUMNS = [
    "topic",
    "product_group",
    "created_hour",
    "created_weekday",
    "created_weekday_name",
    "created_month",
    "is_weekend",
    "is_business_hours",
    "is_after_hours",
    "time_period",
    "ticket_nature",
    "opsmind_request_type",
    "is_incident_like",
    "is_request_like",
    "is_failure_related",
    "is_access_related",
    "affected_service_domain",
    "is_core_service",
    "service_criticality_score",
    "requires_infrastructure_team",
    "requires_device_team",
    "requires_software_team",
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

HIGH_CRITICAL_DOMAINS = {
    "NETWORK",
    "CLOUD",
    "AUTHENTICATION",
    "DATABASE",
    "SYSTEM",
    "APPLICATION",
    "PORTAL",
}

DIGITAL_TERMS = {
    "NETWORK",
    "SOFTWARE",
    "CLOUD",
    "AUTHENTICATION",
    "DATABASE",
    "SYSTEM",
    "APPLICATION",
    "PORTAL",
}

PHYSICAL_TERMS = {"HARDWARE", "DEVICE", "PRINTER", "PROJECTOR", "EQUIPMENT"}

DOMAIN_HINTS = {
    "NETWORK": ["network", "wifi", "internet", "vpn", "dns", "router", "lan", "ethernet"],
    "AUTHENTICATION": ["login", "password", "auth", "otp", "access", "permission", "account"],
    "SOFTWARE": ["software", "application", "app", "portal", "website", "system", "browser"],
    "HARDWARE": ["hardware", "laptop", "computer", "printer", "monitor", "keyboard", "mouse"],
    "CLOUD": ["cloud", "server", "deployment", "container", "kubernetes"],
}


def normalize_bool(value: Any) -> int:
    """Convert booleans / number-like / text-like values into 0 or 1."""
    true_tokens = {"1", "true", "yes", "y", "t", "on"}
    false_tokens = {"0", "false", "no", "n", "f", "off", ""}

    if value is None:
        return 0

    if isinstance(value, (bool, np.bool_)):
        return int(value)

    if isinstance(value, (int, np.integer, float, np.floating)):
        if pd.isna(value):
            return 0
        return int(float(value) != 0.0)

    text = str(value).strip().lower()
    if text in true_tokens:
        return 1
    if text in false_tokens:
        return 0

    try:
        return int(float(text) != 0.0)
    except ValueError:
        return 0


def normalize_text(value: Any) -> str:
    """Return stripped string with safe fallback."""
    if value is None:
        return ""
    if isinstance(value, float) and pd.isna(value):
        return ""
    return str(value).strip()


def _safe_numeric(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        if isinstance(value, str) and not value.strip():
            return default
        num = float(value)
        if np.isnan(num):
            return default
        return num
    except (TypeError, ValueError):
        return default


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


def _normalize_to_frame(input_data: dict | pd.DataFrame) -> pd.DataFrame:
    if isinstance(input_data, pd.DataFrame):
        frame = input_data.copy(deep=True)
    elif isinstance(input_data, dict):
        frame = pd.DataFrame([input_data])
    else:
        raise TypeError("input_data must be dict or pandas.DataFrame")

    alias_map = {
        "typeOfRequest": "type_of_request",
        "productGroup": "product_group",
        "createdAt": "created_at",
        "requesterId": "requester_id",
        "requesterRole": "requester_role",
        "ticketId": "ticket_id",
        "category": "topic",
    }

    for src, dst in alias_map.items():
        if src in frame.columns and dst not in frame.columns:
            frame.loc[:, dst] = frame[src]

    return frame


def _parse_created_at(raw: Any) -> datetime:
    if isinstance(raw, datetime):
        if raw.tzinfo is None:
            return raw.replace(tzinfo=timezone.utc)
        return raw.astimezone(timezone.utc)

    if raw is None:
        return datetime.now(timezone.utc)

    text = normalize_text(raw)
    if not text:
        return datetime.now(timezone.utc)

    normalized = text.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        parsed = pd.to_datetime(text, errors="coerce", utc=True)
        if pd.isna(parsed):
            return datetime.now(timezone.utc)
        return parsed.to_pydatetime()


def _derive_domain(product_group: str, topic: str, combined_text: str) -> str:
    raw_domain = normalize_text(product_group).upper() or normalize_text(topic).upper()
    if raw_domain:
        if "NETWORK" in raw_domain:
            return "NETWORK"
        if "AUTH" in raw_domain or "ACCESS" in raw_domain or "LOGIN" in raw_domain:
            return "AUTHENTICATION"
        if "SOFTWARE" in raw_domain or "APP" in raw_domain or "PORTAL" in raw_domain:
            return "SOFTWARE"
        if "HARDWARE" in raw_domain or "DEVICE" in raw_domain or "PRINTER" in raw_domain:
            return "HARDWARE"
        if "CLOUD" in raw_domain:
            return "CLOUD"
        return raw_domain

    lower_text = combined_text.lower()
    for domain, hints in DOMAIN_HINTS.items():
        if any(hint in lower_text for hint in hints):
            return domain

    return "GENERAL"


def _derive_time_period(hour: int) -> str:
    if hour < 0 or hour > 23:
        return "UNKNOWN"
    if 6 <= hour < 12:
        return "MORNING"
    if 12 <= hour < 17:
        return "AFTERNOON"
    if 17 <= hour < 22:
        return "EVENING"
    return "NIGHT"


def _derive_criticality(
    request_type: str,
    has_failure: int,
    has_urgency: int,
    is_core_service: int,
    domain: str,
) -> int:
    score = 2

    if request_type == "INCIDENT":
        score += 1

    if domain in HIGH_CRITICAL_DOMAINS:
        score += 1

    if has_failure == 1:
        score += 1

    if has_urgency == 1:
        score += 1

    if is_core_service == 1:
        score += 1

    return int(max(1, min(score, 5)))


def _map_academic_period(month_num: int) -> str:
    if month_num == 1:
        return "WINTER"
    if month_num in {2, 3, 4, 5}:
        return "SPRING"
    if month_num in {6, 7, 8}:
        return "SUMMER"
    if month_num in {9, 10, 11, 12}:
        return "FALL"
    return "UNKNOWN"


def _map_criticality_level(score: int) -> str:
    if score in {1, 2}:
        return "LOW"
    if score == 3:
        return "MEDIUM"
    if score in {4, 5}:
        return "HIGH"
    return "UNKNOWN"


def _derive_ticket_nature(request_type: str, has_failure: int, has_access: int, has_network: int) -> str:
    if request_type == "INCIDENT":
        if has_access:
            return "ACCESS_ISSUE"
        if has_failure:
            return "FAILURE"
        if has_network:
            return "OUTAGE"
        return "INCIDENT"
    if request_type == "SERVICE_REQUEST":
        return "SERVICE_REQUEST"
    if request_type == "MAINTENANCE":
        return "MAINTENANCE"
    return "TECHNICAL_ISSUE"


def derive_ticket_features(input_data: dict | pd.DataFrame) -> pd.DataFrame:
    """Build model-ready features from raw ticket payload(s)."""
    frame = _normalize_to_frame(input_data)
    rows: list[Dict[str, Any]] = []

    keyword_patterns = {
        feature_name: re.compile(_build_keyword_pattern(keywords), flags=re.IGNORECASE)
        for feature_name, keywords in KEYWORD_GROUPS.items()
    }

    for _, raw_row in frame.iterrows():
        row = raw_row.to_dict()

        title = normalize_text(row.get("title"))
        description = normalize_text(row.get("description"))
        combined_text = f"{title} {description}".strip()

        created_at = _parse_created_at(row.get("created_at") or row.get("createdAt"))
        created_hour = int(created_at.hour)
        created_month = int(created_at.month)
        created_weekday = int(created_at.weekday())
        created_weekday_name = created_at.strftime("%A")
        is_weekend = int(created_weekday in {4, 5})
        is_after_hours = int(created_hour < 8 or created_hour >= 18)
        is_business_hours = int(not is_after_hours)
        is_peak_hour = int(9 <= created_hour <= 15)
        is_late_night = int(0 <= created_hour <= 6)

        request_type = normalize_text(
            row.get("type_of_request")
            or row.get("typeOfRequest")
            or row.get("opsmind_request_type")
        ).upper() or "INCIDENT"

        topic = normalize_text(row.get("topic")) or request_type
        product_group = normalize_text(row.get("product_group") or row.get("productGroup"))

        keyword_flags: Dict[str, int] = {}
        for feature_name, pattern in keyword_patterns.items():
            keyword_flags[feature_name] = int(bool(pattern.search(combined_text)))

        domain = _derive_domain(product_group=product_group, topic=topic, combined_text=combined_text)
        is_core_service = int(domain in HIGH_CRITICAL_DOMAINS)

        is_failure_related = max(
            keyword_flags["has_error_keywords"],
            int(any(token in combined_text.lower() for token in ["down", "outage", "failed", "cannot", "not working"])),
        )
        is_access_related = max(
            keyword_flags["has_access_keywords"],
            int("access" in combined_text.lower() or "login" in combined_text.lower()),
        )

        requires_infra = int(
            domain in {"NETWORK", "CLOUD", "DATABASE", "AUTHENTICATION", "SYSTEM"}
            or keyword_flags["has_network_keywords"] == 1
        )
        requires_device = int(
            domain == "HARDWARE" or keyword_flags["has_hardware_keywords"] == 1
        )
        requires_software = int(
            domain in {"SOFTWARE", "APPLICATION", "PORTAL"} or keyword_flags["has_software_keywords"] == 1
        )

        required_team_count = int(requires_infra + requires_device + requires_software)
        requires_multiple_teams = int(required_team_count >= 2)

        service_criticality_score = _derive_criticality(
            request_type=request_type,
            has_failure=is_failure_related,
            has_urgency=keyword_flags["has_urgency_keywords"],
            is_core_service=is_core_service,
            domain=domain,
        )

        service_criticality_level = _map_criticality_level(service_criticality_score)
        academic_period = _map_academic_period(created_month)
        time_period = _derive_time_period(created_hour)

        ticket_nature = _derive_ticket_nature(
            request_type=request_type,
            has_failure=is_failure_related,
            has_access=is_access_related,
            has_network=keyword_flags["has_network_keywords"],
        )

        is_incident_like = int(request_type == "INCIDENT" or ticket_nature in {"INCIDENT", "FAILURE", "OUTAGE", "ACCESS_ISSUE", "TECHNICAL_ISSUE"})
        is_request_like = int(request_type in {"SERVICE_REQUEST", "MAINTENANCE"})

        is_digital_service = int(any(term in domain for term in DIGITAL_TERMS))
        is_physical_service = int(any(term in domain for term in PHYSICAL_TERMS))

        description_word_count = int(len(re.findall(r"\b\w+\b", description)))
        title_word_count = int(len(re.findall(r"\b\w+\b", title)))

        ticket_complexity_score = float(
            service_criticality_score
            + required_team_count
            + is_core_service
            + is_failure_related
            + is_access_related
            + is_after_hours
            + keyword_flags["has_error_keywords"]
            + keyword_flags["has_urgency_keywords"]
        )

        if ticket_complexity_score <= 3:
            ticket_complexity_level = "LOW"
        elif 4 <= ticket_complexity_score <= 6:
            ticket_complexity_level = "MEDIUM"
        else:
            ticket_complexity_level = "HIGH"

        needs_fast_response = int(
            ((is_core_service == 1) and (is_failure_related == 1))
            or ((service_criticality_score >= 4) and (keyword_flags["has_error_keywords"] == 1))
            or ((keyword_flags["has_urgency_keywords"] == 1) and (is_failure_related == 1))
        )

        operational_risk_score = float(
            service_criticality_score
            + (2 * is_core_service)
            + (2 * is_failure_related)
            + is_access_related
            + is_after_hours
            + requires_multiple_teams
            + keyword_flags["has_urgency_keywords"]
            + needs_fast_response
        )

        rows.append(
            {
                "title": title,
                "description": description,
                "topic": topic,
                "product_group": product_group or domain,
                "created_hour": created_hour,
                "created_weekday": created_weekday,
                "created_weekday_name": created_weekday_name,
                "created_month": created_month,
                "is_weekend": is_weekend,
                "is_business_hours": is_business_hours,
                "is_after_hours": is_after_hours,
                "time_period": time_period,
                "ticket_nature": ticket_nature,
                "opsmind_request_type": request_type,
                "is_incident_like": is_incident_like,
                "is_request_like": is_request_like,
                "is_failure_related": is_failure_related,
                "is_access_related": is_access_related,
                "affected_service_domain": domain,
                "is_core_service": is_core_service,
                "service_criticality_score": service_criticality_score,
                "requires_infrastructure_team": requires_infra,
                "requires_device_team": requires_device,
                "requires_software_team": requires_software,
                "description_word_count": description_word_count,
                "title_word_count": title_word_count,
                "has_error_keywords": keyword_flags["has_error_keywords"],
                "has_urgency_keywords": keyword_flags["has_urgency_keywords"],
                "has_access_keywords": keyword_flags["has_access_keywords"],
                "has_network_keywords": keyword_flags["has_network_keywords"],
                "has_hardware_keywords": keyword_flags["has_hardware_keywords"],
                "has_software_keywords": keyword_flags["has_software_keywords"],
                "is_peak_hour": is_peak_hour,
                "is_late_night": is_late_night,
                "is_start_of_week": int(created_weekday_name.lower() in {"sunday", "monday"}),
                "is_end_of_week": int(created_weekday_name.lower() in {"thursday", "friday", "saturday"}),
                "academic_period": academic_period,
                "service_criticality_level": service_criticality_level,
                "is_digital_service": is_digital_service,
                "is_physical_service": is_physical_service,
                "required_team_count": required_team_count,
                "requires_multiple_teams": requires_multiple_teams,
                "ticket_complexity_score": ticket_complexity_score,
                "ticket_complexity_level": ticket_complexity_level,
                "needs_fast_response": needs_fast_response,
                "operational_risk_score": operational_risk_score,
            }
        )

    features_df = pd.DataFrame(rows)

    # Ensure all training feature columns exist even for sparse inputs.
    for column_name in MODEL_FEATURE_COLUMNS:
        if column_name not in features_df.columns:
            if column_name in {
                "created_hour",
                "created_weekday",
                "created_month",
                "is_weekend",
                "is_business_hours",
                "is_after_hours",
                "is_incident_like",
                "is_request_like",
                "is_failure_related",
                "is_access_related",
                "is_core_service",
                "requires_infrastructure_team",
                "requires_device_team",
                "requires_software_team",
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
                "is_digital_service",
                "is_physical_service",
                "required_team_count",
                "requires_multiple_teams",
                "ticket_complexity_score",
                "needs_fast_response",
                "operational_risk_score",
                "service_criticality_score",
            }:
                features_df.loc[:, column_name] = 0
            else:
                features_df.loc[:, column_name] = "UNKNOWN"

    return features_df


def calculate_priority_score(features_df: pd.DataFrame) -> pd.Series:
    """Apply the same rule scoring formula used in training."""
    frame = features_df.copy(deep=True)

    service_criticality_score = pd.to_numeric(frame["service_criticality_score"], errors="coerce").fillna(0.0)
    is_core_service = frame["is_core_service"].map(normalize_bool)
    is_failure_related = frame["is_failure_related"].map(normalize_bool)
    is_access_related = frame["is_access_related"].map(normalize_bool)
    is_business_hours = frame["is_business_hours"].map(normalize_bool)
    is_after_hours = frame["is_after_hours"].map(normalize_bool)
    requires_multiple_teams = frame["requires_multiple_teams"].map(normalize_bool)
    is_peak_hour = frame["is_peak_hour"].map(normalize_bool)
    required_team_count = pd.to_numeric(frame["required_team_count"], errors="coerce").fillna(0.0)

    domain_signal = (
        frame["affected_service_domain"].map(normalize_text).str.upper().replace("", pd.NA)
        .fillna(frame["product_group"].map(normalize_text).str.upper())
    )
    nature_signal = frame["ticket_nature"].map(normalize_text).str.upper()
    req_type_signal = frame["opsmind_request_type"].map(normalize_text).str.upper()

    domain_critical_flag = domain_signal.map(
        lambda value: int(any(term in value for term in HIGH_CRITICAL_DOMAINS))
    )

    incident_nature_flag = nature_signal.map(
        lambda value: int(any(term in value for term in ["INCIDENT", "FAILURE", "OUTAGE", "ACCESS_ISSUE", "TECHNICAL_ISSUE"]))
    )
    incident_request_type_flag = req_type_signal.str.contains("INCIDENT", regex=False).astype("int64")

    score = (
        service_criticality_score
        + (2 * is_core_service)
        + (2 * is_failure_related)
        + is_access_related
        + requires_multiple_teams
        + (required_team_count >= 2).astype("int64")
        + frame["has_error_keywords"].map(normalize_bool)
        + (2 * frame["has_urgency_keywords"].map(normalize_bool))
        + is_business_hours
        + is_peak_hour
        + ((is_after_hours == 1) & (is_core_service == 1)).astype("int64")
        + (2 * domain_critical_flag)
        + incident_nature_flag
        + incident_request_type_flag
    )

    return score.astype("float64")


def map_priority_score(score: Any) -> str:
    """Map numeric rule score to LOW/MEDIUM/HIGH/CRITICAL."""
    try:
        value = float(score)
    except (TypeError, ValueError):
        return "MEDIUM"

    if value <= 4:
        return "LOW"
    if 5 <= value <= 7:
        return "MEDIUM"
    if 8 <= value <= 10:
        return "HIGH"
    if value >= 11:
        return "CRITICAL"
    return "MEDIUM"


def build_explanation(
    features_row: Dict[str, Any] | pd.Series,
    rule_priority: str,
    ai_priority: str,
    final_priority: str,
    confidence: float,
    decision_source: str,
) -> list[str]:
    """Build human-readable decision explanation bullets."""
    row = dict(features_row)
    explanation: list[str] = []

    if normalize_bool(row.get("is_core_service")):
        explanation.append("Core service impact was detected.")

    if normalize_bool(row.get("is_failure_related")):
        explanation.append("Failure-related signals were identified in the ticket text.")

    if normalize_bool(row.get("is_access_related")):
        explanation.append("Access/authentication-related symptoms were identified.")

    if normalize_bool(row.get("has_urgency_keywords")):
        explanation.append("Urgency keywords increased the operational priority score.")

    if normalize_bool(row.get("has_error_keywords")):
        explanation.append("Error/failure keywords were detected in title or description.")

    if normalize_bool(row.get("has_network_keywords")):
        explanation.append("Network-impact keywords were detected.")
    if normalize_bool(row.get("has_software_keywords")):
        explanation.append("Software/application-impact keywords were detected.")
    if normalize_bool(row.get("has_hardware_keywords")):
        explanation.append("Hardware/device-impact keywords were detected.")

    if normalize_bool(row.get("is_peak_hour")):
        explanation.append("Ticket was created during peak support hours.")
    elif normalize_bool(row.get("is_business_hours")):
        explanation.append("Ticket was created during business hours.")
    elif normalize_bool(row.get("is_after_hours")):
        explanation.append("Ticket was created after business hours.")

    if normalize_bool(row.get("requires_multiple_teams")):
        explanation.append("Resolution likely requires coordination across multiple teams.")

    service_criticality = normalize_text(row.get("service_criticality_level")) or "UNKNOWN"
    explanation.append(f"Derived service criticality level: {service_criticality}.")
    explanation.append(
        f"Rule priority: {rule_priority}; AI priority: {ai_priority}; final priority: {final_priority}."
    )
    explanation.append(
        f"Decision source: {decision_source}; AI confidence: {round(float(confidence or 0.0), 4)}."
    )

    if not explanation:
        explanation.append("Priority determined from default rule and model signals.")

    return explanation
