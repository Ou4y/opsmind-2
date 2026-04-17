"""
OpsMind AI Service — Pydantic schemas for request/response validation.

Aligned with the production Ticket schema:
  - priority: LOW | MEDIUM | HIGH
  - support_level: L1 | L2 | L3 | L4
  - type_of_request: INCIDENT | SERVICE_REQUEST | MAINTENANCE
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import AliasChoices, BaseModel, Field


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

    # Ticket-service-aligned core fields
    title: str = Field(..., min_length=1, description="Ticket title")
    description: str = Field(..., min_length=1, description="Ticket description")
    type_of_request: str = Field(
        ..., description="Request type: INCIDENT, SERVICE_REQUEST, MAINTENANCE"
    )

    # Optional fields (may not exist on all tickets / pages)
    requester_id: Optional[str] = Field(None, description="User ID/email that created the ticket")
    latitude: Optional[float] = Field(None, ge=-90, le=90, description="GPS latitude (optional)")
    longitude: Optional[float] = Field(None, ge=-180, le=180, description="GPS longitude (optional)")

    # Model-related fields
    support_level: str = Field(
        default="L1",
        description="Support level: L1, L2, L3, L4 (defaults to L1)",
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Ticket creation timestamp (defaults to now)",
        validation_alias=AliasChoices("created_at", "createdAt"),
    )

    # Legacy/UI-only fields (not used by the current models)
    building: Optional[str] = Field(None, description="Building identifier (optional)")
    room: Optional[str] = Field(None, description="Room identifier (optional)")

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


# ── Additional endpoint schemas (frontend integration) ─────────────────────


class RecommendationItem(BaseModel):
    text: str


class RecommendationsCountResponse(BaseModel):
    count: int = Field(..., ge=0)
    pending: int = Field(..., ge=0)


class SuggestCategoryRequest(BaseModel):
    description: str = Field(..., min_length=1)


class SuggestCategoryResponse(BaseModel):
    category: str
    confidence: float = Field(..., ge=0.0, le=1.0)


class SuggestPriorityRequest(BaseModel):
    subject: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)


class SuggestPriorityResponse(BaseModel):
    suggested_priority: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    reasoning: Optional[str] = None


class SimilarTicketsResponse(BaseModel):
    tickets: list[dict]


class ActivitySummaryResponse(BaseModel):
    summary: str


class PredictResolutionResponse(BaseModel):
    estimated_resolution_hours: float = Field(..., ge=0.0)


class SLAPredictRequest(BaseModel):
    # Allow flexible payloads from different pages.
    ticket_id: Optional[str] = Field(None, validation_alias=AliasChoices("ticket_id", "ticketId"))
    title: Optional[str] = None
    description: Optional[str] = None
    type_of_request: Optional[str] = Field(
        None,
        validation_alias=AliasChoices("type_of_request", "type", "request_type"),
    )
    support_level: Optional[str] = None
    priority: Optional[str] = None
    created_at: Optional[datetime] = Field(
        None,
        validation_alias=AliasChoices("created_at", "createdAt"),
    )
    assigned_team: Optional[str] = Field(None, validation_alias=AliasChoices("assigned_team", "assignedTeam"))

    model_config = {"extra": "allow"}


class SLAPredictResponse(BaseModel):
    sla_breach_probability: float = Field(..., ge=0.0, le=100.0)
    estimated_resolution_hours: Optional[float] = Field(None, ge=0.0)
    sla_target_hours: Optional[float] = Field(None, ge=0.0)
    used_priority: Optional[str] = None


class SLAFeedbackRequest(BaseModel):
    ticket_id: str
    ai_probability: float = Field(..., ge=0.0, le=100.0)
    admin_decision: int = Field(..., ge=0, le=1)
    final_outcome: int = Field(..., ge=0, le=1)


class StatusResponse(BaseModel):
    status: str
