"""
OpsMind AI Service — Pydantic schemas for request/response validation.

Aligned with the production Ticket schema:
  - priority: LOW | MEDIUM | HIGH
  - support_level: L1 | L2 | L3 | L4
  - type_of_request: INCIDENT | SERVICE_REQUEST | MAINTENANCE
"""

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class PriorityEnum(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class SupportLevelEnum(str, Enum):
    L1 = "L1"
    L2 = "L2"
    L3 = "L3"
    L4 = "L4"


class TypeOfRequestEnum(str, Enum):
    INCIDENT = "INCIDENT"
    SERVICE_REQUEST = "SERVICE_REQUEST"
    MAINTENANCE = "MAINTENANCE"


class TicketInput(BaseModel):
    """Schema for incoming prediction requests.

    Only contains fields available at ticket creation time — mirrors the
    fields that the Ticket Service sends when a ticket is created.
    """

    title: str = Field(..., min_length=1, description="Ticket title")
    description: str = Field(..., min_length=1, description="Ticket description")
    support_level: str = Field(..., description="Support level: L1, L2, L3, L4")
    building: str = Field(..., description="Building name or identifier")
    room: str = Field(..., description="Room number or identifier")
    type_of_request: str = Field(
        ..., description="Request type: INCIDENT, SERVICE_REQUEST, MAINTENANCE"
    )
    created_at: datetime = Field(..., description="Ticket creation timestamp")

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "title": "VPN not connecting",
                    "description": "User reports VPN client fails to establish a connection after latest update.",
                    "support_level": "L1",
                    "building": "Main",
                    "room": "101",
                    "type_of_request": "INCIDENT",
                    "created_at": "2026-02-18T10:00:00",
                }
            ]
        }
    }


class PredictionResponse(BaseModel):
    """Schema for prediction results.

    ``suggested_priority`` will be one of LOW, MEDIUM, HIGH — matching the
    Ticket schema ENUM so the ticketing service can use it directly.
    """

    suggested_priority: str = Field(
        ..., description="Predicted priority: LOW, MEDIUM, or HIGH"
    )
    priority_confidence: float = Field(
        ..., ge=0.0, le=1.0, description="Confidence score for the predicted priority"
    )
    estimated_resolution_hours: float = Field(
        ..., ge=0.0, description="Estimated time to resolve the ticket in hours"
    )


class HealthResponse(BaseModel):
    """Schema for the health-check endpoint."""

    status: str
    models_loaded: bool
    version: str
