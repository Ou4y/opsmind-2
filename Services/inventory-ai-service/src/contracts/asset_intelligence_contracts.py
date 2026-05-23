"""Shared Inventory AI contract vocabulary for readiness alignment.

This file is intentionally lightweight and non-invasive. It does not change
runtime behavior unless imported by future integrations.
"""

from __future__ import annotations

from typing import Final


LIVE_STATUS_VOCABULARY: Final[list[str]] = [
    "online_in_use",
    "online_idle",
    "offline",
    "not_monitored",
    "insufficient_data",
    "monitoring_enabled_waiting_for_signal",
    "inspection_required",
    "condition_unknown",
    "not_applicable",
]

SPEC_EVIDENCE_VOCABULARY: Final[list[str]] = [
    "trusted",
    "insufficient_source_evidence",
    "llm_or_heuristic_only",
]

PROCUREMENT_WORKFLOW_STATES: Final[list[str]] = [
    "open",
    "acknowledged",
    "planned",
    "ordered",
    "resolved",
    "dismissed",
]

SUPPORTED_TELEMETRY_SOURCES: Final[list[str]] = [
    "manual_toggle",
    "manual_inspection",
    "device_agent",
    "ping",
    "snmp",
    "mdm",
    "printer_counter",
    "network_controller",
    "maintenance_system",
    "ticket_history",
    "vendor_api",
    "building_management_system",
]
