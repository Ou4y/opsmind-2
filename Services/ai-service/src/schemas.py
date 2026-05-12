"""
OpsMind AI Service — Pydantic schemas.

Prediction output labels:
- LOW | MEDIUM | HIGH | CRITICAL

Compatibility note:
- `support_level`, `latitude`, and `longitude` are accepted for API
  compatibility but ignored by the initial prediction model.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import AliasChoices, BaseModel, Field


class PriorityEnum(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


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
    """Schema for prediction requests."""

    title: str = Field(..., min_length=1, description="Ticket title")
    description: str = Field(..., min_length=1, description="Ticket description")

    # Compatibility field used as fallback topic source.
    type_of_request: str = Field(
        ...,
        description="Compatibility field. Used as fallback when `topic` is not provided.",
    )

    # Preferred categorical fields when available.
    topic: Optional[str] = Field(None, description="Ticket topic/category")
    source: Optional[str] = Field(None, description="Ticket source channel")
    product_group: Optional[str] = Field(
        None,
        description="Product group",
        validation_alias=AliasChoices("product_group", "productGroup"),
    )
    country: Optional[str] = Field(None, description="Country")

    requester_id: Optional[str] = Field(None, description="Requester identifier")
    latitude: Optional[float] = Field(
        None,
        ge=-90,
        le=90,
        description="Accepted for compatibility; ignored by initial prediction model.",
    )
    longitude: Optional[float] = Field(
        None,
        ge=-180,
        le=180,
        description="Accepted for compatibility; ignored by initial prediction model.",
    )

    support_level: str = Field(
        default="L1",
        description="Accepted for compatibility; ignored by initial prediction model.",
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Ticket creation timestamp (defaults to now)",
        validation_alias=AliasChoices("created_at", "createdAt"),
    )

    building: Optional[str] = Field(None, description="Optional building identifier")
    room: Optional[str] = Field(None, description="Optional room identifier")

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "title": "VPN outage in HQ",
                    "description": "Remote users cannot connect through VPN.",
                    "type_of_request": "INCIDENT",
                    "topic": "Network Issue",
                    "source": "Portal",
                    "product_group": "Network",
                    "country": "UAE",
                    "support_level": "L1",
                    "created_at": "2026-02-18T10:00:00Z",
                }
            ]
        }
    }


class PredictionResponse(BaseModel):
    """Schema for /predict output."""

    suggested_priority: PriorityEnum = Field(
        ..., description="Predicted priority: LOW, MEDIUM, HIGH, or CRITICAL"
    )
    priority_confidence: float = Field(
        ..., ge=0.0, le=1.0, description="Confidence score for the predicted priority"
    )
    estimated_resolution_hours: float = Field(
        ..., ge=0.0, description="Estimated time to resolve the ticket in hours"
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "suggested_priority": "CRITICAL",
                    "priority_confidence": 0.82,
                    "estimated_resolution_hours": 1.75,
                }
            ]
        }
    }


class HealthResponse(BaseModel):
    status: str
    models_loaded: bool
    version: str


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
    suggested_priority: PriorityEnum
    confidence: float = Field(..., ge=0.0, le=1.0)
    reasoning: Optional[str] = None


class SimilarTicketsResponse(BaseModel):
    tickets: list[dict]


class ActivitySummaryResponse(BaseModel):
    summary: str


class PredictResolutionResponse(BaseModel):
    estimated_resolution_hours: float = Field(..., ge=0.0)
