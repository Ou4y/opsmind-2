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


class AssetHealthSummaryRequest(BaseModel):
    asset: dict = Field(default_factory=dict)
    eol_assessment: dict = Field(default_factory=dict, validation_alias=AliasChoices("eol_assessment", "eolAssessment"))
    include_related: bool = Field(True, validation_alias=AliasChoices("include_related", "includeRelated"))
    history_events: list[dict] = Field(default_factory=list, validation_alias=AliasChoices("history_events", "historyEvents"))
    components: list[dict] = Field(default_factory=list)
    maintenance_count: int = Field(0, ge=0, validation_alias=AliasChoices("maintenance_count", "maintenanceCount"))

    model_config = {"extra": "allow"}


class AssetHealthSummaryResponse(BaseModel):
    summary: str
    risks: list[str] = Field(default_factory=list)
    recent_changes: list[str] = Field(default_factory=list)
    component_issues: list[str] = Field(default_factory=list)
    warranty_eol_concerns: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    confidence: str = Field("low")
    missing_data: list[str] = Field(default_factory=list)
    llm_used: bool = False
    llm_status: str = Field("disabled")
    fallback_reason: Optional[str] = None


class InventoryAssistantRequest(BaseModel):
    query: str = Field(..., min_length=1)
    deterministic_result: dict = Field(default_factory=dict, validation_alias=AliasChoices("deterministic_result", "deterministicResult"))
    context_summary: dict = Field(default_factory=dict, validation_alias=AliasChoices("context_summary", "contextSummary"))

    model_config = {"extra": "allow"}


class InventoryAssistantResponse(BaseModel):
    answer: str
    suggested_actions: list[str] = Field(default_factory=list)
    confidence: str = Field("low")
    missing_data: list[str] = Field(default_factory=list)
    llm_used: bool = False
    llm_status: str = Field("disabled")
    fallback_reason: Optional[str] = None


class ImportColumnMappingRequest(BaseModel):
    filename: Optional[str] = None
    headers: list[str] = Field(default_factory=list)
    sample_rows: list[dict] = Field(default_factory=list, validation_alias=AliasChoices("sample_rows", "sampleRows"))
    expected_fields: list[str] = Field(default_factory=list, validation_alias=AliasChoices("expected_fields", "expectedFields"))
    deterministic_mappings: list[dict] = Field(default_factory=list, validation_alias=AliasChoices("deterministic_mappings", "deterministicMappings"))

    model_config = {"extra": "allow"}


class ImportColumnMappingResponse(BaseModel):
    mappings: list[dict] = Field(default_factory=list)
    unmapped_columns: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    llm_used: bool = False


class MissingDataDetectorRequest(BaseModel):
    report: dict = Field(default_factory=dict)

    model_config = {"extra": "allow"}


class MissingDataDetectorResponse(BaseModel):
    summary: str
    recommendations: list[str] = Field(default_factory=list)
    confidence: str = Field("low")
    llm_used: bool = False


class MaintenanceRecommendationRequest(BaseModel):
    recommendations: list[dict] = Field(default_factory=list)

    model_config = {"extra": "allow"}


class MaintenanceRecommendationResponse(BaseModel):
    summary: str
    confidence: str = Field("low")
    llm_used: bool = False


class ProcurementRecommendationRequest(BaseModel):
    recommended_purchases: list[dict] = Field(default_factory=list, validation_alias=AliasChoices("recommended_purchases", "recommendedPurchases"))

    model_config = {"extra": "allow"}


class ProcurementRecommendationResponse(BaseModel):
    summary: str
    missing_data: list[str] = Field(default_factory=list)
    confidence: str = Field("low")
    llm_used: bool = False


class DuplicateExplanationRequest(BaseModel):
    duplicate_groups: list[dict] = Field(default_factory=list, validation_alias=AliasChoices("duplicate_groups", "duplicateGroups"))
    summary: str = ""

    model_config = {"extra": "allow"}


class DuplicateExplanationResponse(BaseModel):
    summary: str
    confidence: str = Field("low")
    llm_used: bool = False


class NaturalLanguageInventorySearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    interpreted_filters: dict = Field(default_factory=dict, validation_alias=AliasChoices("interpreted_filters", "interpretedFilters"))
    candidate_results: list[dict] = Field(default_factory=list, validation_alias=AliasChoices("candidate_results", "candidateResults"))
    fallback_answer: str = Field("", validation_alias=AliasChoices("fallback_answer", "fallbackAnswer"))

    model_config = {"extra": "allow"}


class NaturalLanguageInventorySearchResponse(BaseModel):
    answer: str
    confidence: str = Field("low")
    llm_used: bool = False


class DocumentExtractionRequest(BaseModel):
    filename: Optional[str] = None
    document_text: str = Field("", validation_alias=AliasChoices("document_text", "documentText"))
    deterministic_rows: list[dict] = Field(default_factory=list, validation_alias=AliasChoices("deterministic_rows", "deterministicRows"))

    model_config = {"extra": "allow"}


class DocumentExtractionResponse(BaseModel):
    source_document_summary: str
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    warnings: list[str] = Field(default_factory=list)
    missing_fields: list[str] = Field(default_factory=list)
    extracted_rows: list[dict] = Field(default_factory=list)
    llm_used: bool = False


class DataCorrectionSuggestionsRequest(BaseModel):
    summary: str = ""
    suggestions: list[dict] = Field(default_factory=list)
    counts_by_severity: dict = Field(default_factory=dict, validation_alias=AliasChoices("counts_by_severity", "countsBySeverity"))
    data_scope: Optional[str] = Field(None, validation_alias=AliasChoices("data_scope", "dataScope"))
    confidence: str = "medium"
    missing_data: list[str] = Field(default_factory=list, validation_alias=AliasChoices("missing_data", "missingData"))
    suggested_actions: list[str] = Field(default_factory=list, validation_alias=AliasChoices("suggested_actions", "suggestedActions"))

    model_config = {"extra": "allow"}


class DataCorrectionSuggestionsResponse(BaseModel):
    summary: str
    confidence: str = Field("low")
    missing_data: list[str] = Field(default_factory=list)
    suggested_actions: list[str] = Field(default_factory=list)
    llm_used: bool = False
    llm_status: str = "disabled"
    fallback_reason: Optional[str] = None


class RiskScoreExplanationRequest(BaseModel):
    summary: str = ""
    risk_scores: list[dict] = Field(default_factory=list, validation_alias=AliasChoices("risk_scores", "riskScores"))
    data_scope: Optional[str] = Field(None, validation_alias=AliasChoices("data_scope", "dataScope"))
    missing_data: list[str] = Field(default_factory=list, validation_alias=AliasChoices("missing_data", "missingData"))
    confidence: str = "medium"
    suggested_actions: list[str] = Field(default_factory=list, validation_alias=AliasChoices("suggested_actions", "suggestedActions"))

    model_config = {"extra": "allow"}


class RiskScoreExplanationResponse(BaseModel):
    summary: str
    confidence: str = Field("low")
    missing_data: list[str] = Field(default_factory=list)
    suggested_actions: list[str] = Field(default_factory=list)
    llm_used: bool = False
    llm_status: str = "disabled"
    fallback_reason: Optional[str] = None


class ReplacementPriorityRequest(BaseModel):
    summary: str = ""
    ranked_items: list[dict] = Field(default_factory=list, validation_alias=AliasChoices("ranked_items", "rankedItems"))
    missing_data: list[str] = Field(default_factory=list, validation_alias=AliasChoices("missing_data", "missingData"))
    confidence: str = "medium"
    suggested_actions: list[str] = Field(default_factory=list, validation_alias=AliasChoices("suggested_actions", "suggestedActions"))

    model_config = {"extra": "allow"}


class ReplacementPriorityResponse(BaseModel):
    summary: str
    confidence: str = Field("low")
    missing_data: list[str] = Field(default_factory=list)
    suggested_actions: list[str] = Field(default_factory=list)
    llm_used: bool = False
    llm_status: str = "disabled"
    fallback_reason: Optional[str] = None


class SpareStockForecastRequest(BaseModel):
    summary: str = ""
    forecasts: list[dict] = Field(default_factory=list)
    missing_data: list[str] = Field(default_factory=list, validation_alias=AliasChoices("missing_data", "missingData"))
    confidence: str = "medium"
    suggested_actions: list[str] = Field(default_factory=list, validation_alias=AliasChoices("suggested_actions", "suggestedActions"))

    model_config = {"extra": "allow"}


class SpareStockForecastResponse(BaseModel):
    summary: str
    confidence: str = Field("low")
    missing_data: list[str] = Field(default_factory=list)
    suggested_actions: list[str] = Field(default_factory=list)
    llm_used: bool = False
    llm_status: str = "disabled"
    fallback_reason: Optional[str] = None


class ImportErrorRepairRequest(BaseModel):
    summary: str = ""
    fixes: list[dict] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    confidence: str = "medium"

    model_config = {"extra": "allow"}


class ImportErrorRepairResponse(BaseModel):
    summary: str
    fixes: list[dict] = Field(default_factory=list)
    corrected_rows_preview: list[dict] = Field(default_factory=list, validation_alias=AliasChoices("corrected_rows_preview", "correctedRowsPreview"))
    warnings: list[str] = Field(default_factory=list)
    confidence: str = Field("low")
    llm_used: bool = False
    llm_status: str = "disabled"
    fallback_reason: Optional[str] = None


class RelationshipSuggestionRequest(BaseModel):
    summary: str = ""
    suggestions: list[dict] = Field(default_factory=list)
    missing_data: list[str] = Field(default_factory=list, validation_alias=AliasChoices("missing_data", "missingData"))
    confidence: str = "medium"

    model_config = {"extra": "allow"}


class RelationshipSuggestionResponse(BaseModel):
    summary: str
    confidence: str = Field("low")
    missing_data: list[str] = Field(default_factory=list)
    llm_used: bool = False
    llm_status: str = "disabled"
    fallback_reason: Optional[str] = None


class InvoiceAssetMatchingRequest(BaseModel):
    summary: str = ""
    matches: list[dict] = Field(default_factory=list)
    unmatched_items: list[dict] = Field(default_factory=list, validation_alias=AliasChoices("unmatched_items", "unmatchedItems"))
    warnings: list[str] = Field(default_factory=list)
    confidence: str = "medium"

    model_config = {"extra": "allow"}


class InvoiceAssetMatchingResponse(BaseModel):
    summary: str
    confidence: str = Field("low")
    warnings: list[str] = Field(default_factory=list)
    llm_used: bool = False
    llm_status: str = "disabled"
    fallback_reason: Optional[str] = None


class InventoryTicketDraftRequest(BaseModel):
    ticket_draft: dict = Field(default_factory=dict, validation_alias=AliasChoices("ticket_draft", "ticketDraft"))
    confidence: str = "medium"
    missing_data: list[str] = Field(default_factory=list, validation_alias=AliasChoices("missing_data", "missingData"))

    model_config = {"extra": "allow"}


class InventoryTicketDraftResponse(BaseModel):
    ticket_draft: dict = Field(default_factory=dict)
    confidence: str = Field("low")
    missing_data: list[str] = Field(default_factory=list)
    llm_used: bool = False
    llm_status: str = "disabled"
    fallback_reason: Optional[str] = None


class MonthlyInventoryReportRequest(BaseModel):
    report_title: str = Field("", validation_alias=AliasChoices("report_title", "reportTitle"))
    date_range: str = Field("", validation_alias=AliasChoices("date_range", "dateRange"))
    executive_summary: str = Field("", validation_alias=AliasChoices("executive_summary", "executiveSummary"))
    sections: list[dict] = Field(default_factory=list)
    metrics: dict = Field(default_factory=dict)
    recommendations: list[str] = Field(default_factory=list)
    confidence: str = "medium"
    missing_data: list[str] = Field(default_factory=list, validation_alias=AliasChoices("missing_data", "missingData"))

    model_config = {"extra": "allow"}


class MonthlyInventoryReportResponse(BaseModel):
    report_title: str
    executive_summary: str
    sections: list[dict] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    confidence: str = Field("low")
    missing_data: list[str] = Field(default_factory=list)
    llm_used: bool = False
    llm_status: str = "disabled"
    fallback_reason: Optional[str] = None


class InventoryActionPlanRequest(BaseModel):
    query: str = Field(..., min_length=1)
    action_plan: dict = Field(default_factory=dict, validation_alias=AliasChoices("action_plan", "actionPlan"))
    confidence: str = "medium"

    model_config = {"extra": "allow"}


class InventoryActionPlanResponse(BaseModel):
    action_type: str = Field("", validation_alias=AliasChoices("action_type", "actionType"))
    summary: str
    risks: list[str] = Field(default_factory=list)
    confirmation_instructions: str = Field("", validation_alias=AliasChoices("confirmation_instructions", "confirmationInstructions"))
    confidence: str = Field("low")
    llm_used: bool = False
    llm_status: str = "disabled"
    fallback_reason: Optional[str] = None


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
