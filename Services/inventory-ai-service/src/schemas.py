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


class AssetLifespanRequest(BaseModel):
    asset_id: Optional[str] = Field(None, validation_alias=AliasChoices("asset_id", "assetId", "customId"))
    type: str
    brand: Optional[str] = None
    model: Optional[str] = Field(None, validation_alias=AliasChoices("model", "version"))
    specifications: dict = Field(default_factory=dict)
    base_lifespan_years: float = Field(5.0, ge=0.1, validation_alias=AliasChoices("base_lifespan_years", "baseLifespanYears"))
    working_hours: float = Field(0.0, ge=0.0, validation_alias=AliasChoices("working_hours", "workingHours"))
    operational_state: str = Field("offline", validation_alias=AliasChoices("operational_state", "operationalState"))

    model_config = {"extra": "allow"}


class AssetLifespanResponse(BaseModel):
    predicted_lifespan_years: float = Field(..., ge=0.0)
    quality_tier: str
    failure_risk: float = Field(..., ge=0.0, le=1.0)
    model_version: str
    explanation: str


class AssetSpecInferenceRequest(BaseModel):
    name: Optional[str] = None
    type: str
    brand: Optional[str] = None
    model: Optional[str] = Field(None, validation_alias=AliasChoices("model", "version"))
    specifications: dict = Field(default_factory=dict)

    model_config = {"extra": "allow"}


class AssetSpecInferenceResponse(BaseModel):
    inferred_specifications: dict
    field_confidence: dict[str, float] = Field(default_factory=dict)
    confidence: float = Field(..., ge=0.0, le=1.0)
    source: str
    explanation: str
    source_urls: list[str] = Field(default_factory=list)
    lookup_mode: str = "heuristic_fallback"
    rule_version: str = "spec-rules-v1"
    variant: str = "control"


class AssetSpecFeedbackRequest(BaseModel):
    asset_id: str = Field(..., validation_alias=AliasChoices("asset_id", "assetId", "customId"))
    action: str = Field(..., description="approve | correct | reject")
    name: Optional[str] = None
    type: Optional[str] = None
    brand: Optional[str] = None
    model: Optional[str] = None
    predicted_specifications: dict = Field(default_factory=dict)
    corrected_specifications: dict = Field(default_factory=dict)
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    source: str = ""
    source_urls: list[str] = Field(default_factory=list)
    lookup_mode: str = "heuristic_fallback"
    submitted_by: Optional[str] = None
    submitted_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    model_config = {"extra": "allow"}


class AssetSpecFeedbackResponse(BaseModel):
    status: str
    saved_to: str
    golden_dataset_size: int = Field(..., ge=0)


class AssetSpecMetricsResponse(BaseModel):
    status: str
    evaluated_records: int = Field(..., ge=0)
    fields: list[str] = Field(default_factory=list)
    precision_by_field: dict = Field(default_factory=dict)
    recall_by_field: dict = Field(default_factory=dict)


class SpecNormalizationRequest(BaseModel):
    asset_type: str = Field(..., validation_alias=AliasChoices("asset_type", "assetType", "type"))
    brand: Optional[str] = None
    model: Optional[str] = Field(None, validation_alias=AliasChoices("model", "version"))
    raw_specs_text: str = Field("", validation_alias=AliasChoices("raw_specs_text", "rawSpecsText", "specsText"))
    expected_fields: list[str] = Field(default_factory=list, validation_alias=AliasChoices("expected_fields", "expectedFields"))
    not_applicable_fields: list[str] = Field(default_factory=list, validation_alias=AliasChoices("not_applicable_fields", "notApplicableFields"))
    current_specs: dict = Field(default_factory=dict, validation_alias=AliasChoices("current_specs", "currentSpecs"))

    model_config = {"extra": "allow"}


class SpecNormalizationResponse(BaseModel):
    normalized_specs: dict[str, str] = Field(default_factory=dict)
    normalized_specs_text: str = ""
    invalid_fields: list[str] = Field(default_factory=list)
    missing_important_fields: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    confidence: float = Field(..., ge=0.0, le=1.0)
    llm_used: bool = False


class SpecSanityCheckRequest(BaseModel):
    asset_type: str = Field(..., validation_alias=AliasChoices("asset_type", "assetType", "type"))
    brand: Optional[str] = None
    model: Optional[str] = Field(None, validation_alias=AliasChoices("model", "version"))
    normalized_specs: dict[str, str] = Field(default_factory=dict, validation_alias=AliasChoices("normalized_specs", "normalizedSpecs"))
    source_type: Optional[str] = Field(None, validation_alias=AliasChoices("source_type", "sourceType"))
    evidence_status: Optional[str] = Field(None, validation_alias=AliasChoices("evidence_status", "evidenceStatus"))
    expected_fields: list[str] = Field(default_factory=list, validation_alias=AliasChoices("expected_fields", "expectedFields"))
    not_applicable_fields: list[str] = Field(default_factory=list, validation_alias=AliasChoices("not_applicable_fields", "notApplicableFields"))

    model_config = {"extra": "allow"}


class SpecSanityCheckResponse(BaseModel):
    warnings: list[str] = Field(default_factory=list)
    suspicious_fields: list[str] = Field(default_factory=list)
    suggested_fixes: list[str] = Field(default_factory=list)
    requires_review: bool = True
    llm_used: bool = False


class SourceSpecExtractionRequest(BaseModel):
    asset_type: str = Field(..., validation_alias=AliasChoices("asset_type", "assetType", "type"))
    brand: Optional[str] = None
    model: Optional[str] = Field(None, validation_alias=AliasChoices("model", "version"))
    source_url: str = Field("", validation_alias=AliasChoices("source_url", "sourceUrl"))
    source_domain: str = Field("", validation_alias=AliasChoices("source_domain", "sourceDomain"))
    source_text: str = Field("", validation_alias=AliasChoices("source_text", "sourceText"))
    expected_fields: list[str] = Field(default_factory=list, validation_alias=AliasChoices("expected_fields", "expectedFields"))
    not_applicable_fields: list[str] = Field(default_factory=list, validation_alias=AliasChoices("not_applicable_fields", "notApplicableFields"))

    model_config = {"extra": "allow"}


class SourceSpecExtractionResponse(BaseModel):
    normalized_specs: dict[str, str] = Field(default_factory=dict)
    specs_text: str = ""
    confidence: float = Field(..., ge=0.0, le=1.0)
    extracted_fields: list[str] = Field(default_factory=list)
    missing_important_fields: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    evidence_reason: str = ""
    exact_model_matched: bool = False
    llm_used: bool = False


class EolExplanationRequest(BaseModel):
    assessment: dict = Field(default_factory=dict)
    telemetry_status: Optional[str] = Field(None, validation_alias=AliasChoices("telemetry_status", "telemetryStatus"))
    spec_evidence_status: Optional[str] = Field(None, validation_alias=AliasChoices("spec_evidence_status", "specEvidenceStatus"))
    predicted_lifespan_years: Optional[float] = Field(None, validation_alias=AliasChoices("predicted_lifespan_years", "predictedLifespanYears"))
    confidence: Optional[float] = Field(None, ge=0.0, le=1.0)
    procurement_suitable: Optional[bool] = Field(None, validation_alias=AliasChoices("procurement_suitable", "procurementSuitable", "suitableForProcurementPlanning"))

    model_config = {"extra": "allow"}


class EolExplanationResponse(BaseModel):
    short_user_explanation: str
    technical_explanation: str
    llm_used: bool = False


class HealthResponse(BaseModel):
    """Schema for the health-check endpoint."""

    status: str
    models_loaded: bool
    ticket_models_loaded: bool = False
    asset_model_loaded: bool = False
    version: str
    llm_provider: str = "none"
    llm_enabled: bool = False
    llm_model: Optional[str] = None
    llm_status: str = "disabled"
    llm_last_error: Optional[str] = None
    gemini_enabled: bool = False
    gemini_model: Optional[str] = None
    gemini_status: str = "disabled"
    gemini_last_error: Optional[str] = None


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
