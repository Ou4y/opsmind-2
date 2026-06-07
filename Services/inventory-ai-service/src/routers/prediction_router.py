"""Prediction endpoints (ticket, asset lifespan, and spec inference)."""

from __future__ import annotations

import json
import logging
import time

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from src.models import get_store
from src.schemas import (
    AssetHealthSummaryRequest,
    AssetHealthSummaryResponse,
    AssetLifespanRequest,
    AssetLifespanResponse,
    DataCorrectionSuggestionsRequest,
    DataCorrectionSuggestionsResponse,
    DocumentExtractionRequest,
    DocumentExtractionResponse,
    DuplicateExplanationRequest,
    DuplicateExplanationResponse,
    EolExplanationRequest,
    EolExplanationResponse,
    ImportColumnMappingRequest,
    ImportColumnMappingResponse,
    ImportErrorRepairRequest,
    ImportErrorRepairResponse,
    InvoiceAssetMatchingRequest,
    InvoiceAssetMatchingResponse,
    InventoryActionPlanRequest,
    InventoryActionPlanResponse,
    InventoryAssistantRequest,
    InventoryAssistantResponse,
    InventoryTicketDraftRequest,
    InventoryTicketDraftResponse,
    MaintenanceRecommendationRequest,
    MaintenanceRecommendationResponse,
    MissingDataDetectorRequest,
    MissingDataDetectorResponse,
    MonthlyInventoryReportRequest,
    MonthlyInventoryReportResponse,
    NaturalLanguageInventorySearchRequest,
    NaturalLanguageInventorySearchResponse,
    ProcurementRecommendationRequest,
    ProcurementRecommendationResponse,
    RelationshipSuggestionRequest,
    RelationshipSuggestionResponse,
    ReplacementPriorityRequest,
    ReplacementPriorityResponse,
    RiskScoreExplanationRequest,
    RiskScoreExplanationResponse,
    SourceSpecExtractionRequest,
    SourceSpecExtractionResponse,
    SpareStockForecastRequest,
    SpareStockForecastResponse,
    AssetSpecFeedbackRequest,
    AssetSpecFeedbackResponse,
    AssetSpecInferenceRequest,
    AssetSpecInferenceResponse,
    AssetSpecMetricsResponse,
    PredictionResponse,
    SpecNormalizationRequest,
    SpecNormalizationResponse,
    SpecSanityCheckRequest,
    SpecSanityCheckResponse,
    TicketInput,
)


logger = logging.getLogger(__name__)
router = APIRouter(tags=["Prediction"])


@router.post(
    "/predict",
    response_model=PredictionResponse,
    summary="Predict ticket priority and estimated resolution time",
)
async def predict(ticket: TicketInput, request: Request) -> PredictionResponse:
    started = time.perf_counter()
    store = get_store()
    if not store.is_loaded:
        raise HTTPException(
            status_code=503,
            detail="Models are not loaded. Please train and deploy models first.",
        )

    ticket_service = request.app.state.ticket_service
    try:
        ticket_data = ticket_service.ticket_dict_from_ticket_input(ticket)
        features = ticket_service.build_features(ticket_data)
        priority_label, priority_confidence = ticket_service.predict_priority(features)
        est_hours = ticket_service.predict_estimated_resolution_hours(features)
        return PredictionResponse(
            suggested_priority=priority_label,
            priority_confidence=priority_confidence,
            estimated_resolution_hours=est_hours,
        )
    except Exception as exc:
        logger.exception("Prediction failed")
        raise HTTPException(status_code=500, detail=f"Prediction error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "predict"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "predict"},
        )


@router.post(
    "/predict-asset-lifespan",
    response_model=AssetLifespanResponse,
    summary="Predict asset lifespan from asset profile and telemetry",
)
async def predict_asset_lifespan(asset: AssetLifespanRequest, request: Request) -> AssetLifespanResponse:
    started = time.perf_counter()
    service = request.app.state.lifespan_service
    try:
        return service.predict_asset_lifespan(asset)
    except Exception as exc:
        logger.exception("Asset lifespan prediction failed")
        raise HTTPException(status_code=500, detail=f"Asset prediction error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "predict_asset_lifespan"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "predict_asset_lifespan"},
        )


@router.post(
    "/infer-asset-specs",
    response_model=AssetSpecInferenceResponse,
    summary="Infer likely asset specifications from name/brand/model/type",
)
async def infer_asset_specs(payload: AssetSpecInferenceRequest, request: Request) -> AssetSpecInferenceResponse:
    started = time.perf_counter()
    service = request.app.state.spec_service
    try:
        return await service.infer_asset_specs(payload)
    except Exception as exc:
        logger.exception("Asset specification inference failed")
        raise HTTPException(status_code=500, detail=f"Asset spec inference error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "infer_asset_specs"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "infer_asset_specs"},
        )


@router.post(
    "/feedback/spec-verification",
    response_model=AssetSpecFeedbackResponse,
    summary="Store human verification feedback for asset specs",
)
async def spec_verification_feedback(
    payload: AssetSpecFeedbackRequest,
    request: Request,
) -> AssetSpecFeedbackResponse:
    service = request.app.state.spec_service
    try:
        return service.submit_feedback(payload)
    except Exception as exc:
        logger.exception("Failed to persist spec verification feedback")
        raise HTTPException(status_code=500, detail=f"Spec feedback error: {exc}") from exc


@router.get(
    "/metrics/spec-inference",
    response_model=AssetSpecMetricsResponse,
    summary="Evaluate precision/recall by field from golden dataset",
)
async def spec_inference_metrics(request: Request, variant: str | None = None) -> AssetSpecMetricsResponse:
    service = request.app.state.spec_service
    try:
        return service.spec_inference_metrics(variant=variant)
    except Exception as exc:
        logger.exception("Failed to compute spec inference metrics")
        raise HTTPException(status_code=500, detail=f"Spec metrics error: {exc}") from exc


@router.post(
    "/normalize-asset-specs",
    response_model=SpecNormalizationResponse,
    summary="Normalize raw asset specs text with deterministic + LLM-assisted rules",
)
async def normalize_asset_specs(payload: SpecNormalizationRequest, request: Request) -> SpecNormalizationResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service
    try:
        return await service.normalize_specs(payload)
    except Exception as exc:
        logger.exception("Spec normalization helper failed")
        raise HTTPException(status_code=500, detail=f"Spec normalization error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "normalize_asset_specs"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "normalize_asset_specs"},
        )


@router.post(
    "/check-asset-spec-sanity",
    response_model=SpecSanityCheckResponse,
    summary="Run deterministic + LLM-assisted sanity checks on normalized asset specs",
)
async def check_asset_spec_sanity(payload: SpecSanityCheckRequest, request: Request) -> SpecSanityCheckResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service
    try:
        return await service.check_spec_sanity(payload)
    except Exception as exc:
        logger.exception("Spec sanity helper failed")
        raise HTTPException(status_code=500, detail=f"Spec sanity error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "check_asset_spec_sanity"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "check_asset_spec_sanity"},
        )


@router.post(
    "/explain-eol-assessment",
    response_model=EolExplanationResponse,
    summary="Generate user-friendly and technical explanations for an existing EOL assessment",
)
async def explain_eol_assessment(payload: EolExplanationRequest, request: Request) -> EolExplanationResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service
    try:
        return await service.explain_eol_assessment(payload)
    except Exception as exc:
        logger.exception("EOL explanation helper failed")
        raise HTTPException(status_code=500, detail=f"EOL explanation error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "explain_eol_assessment"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "explain_eol_assessment"},
        )


@router.post(
    "/summarize-asset-health",
    response_model=AssetHealthSummaryResponse,
    summary="Summarize asset health using combined lifecycle/history context",
)
async def summarize_asset_health(payload: AssetHealthSummaryRequest, request: Request) -> AssetHealthSummaryResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service
    try:
        return await service.summarize_asset_health(payload)
    except Exception as exc:
        logger.exception("Asset health summary helper failed")
        raise HTTPException(status_code=500, detail=f"Asset health summary error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "summarize_asset_health"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "summarize_asset_health"},
        )


@router.post(
    "/inventory-assistant",
    response_model=InventoryAssistantResponse,
    summary="Answer inventory assistant queries using deterministic context + LLM explanation",
)
async def inventory_assistant(payload: InventoryAssistantRequest, request: Request) -> InventoryAssistantResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service
    try:
        return await service.inventory_assistant(payload)
    except Exception as exc:
        logger.exception("Inventory assistant helper failed")
        raise HTTPException(status_code=500, detail=f"Inventory assistant error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "inventory_assistant"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "inventory_assistant"},
        )


def _sse_event(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.post(
    "/inventory-assistant-stream",
    summary="Stream an inventory assistant answer from Gemma using deterministic context",
)
async def inventory_assistant_stream(payload: InventoryAssistantRequest, request: Request) -> StreamingResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service

    def stream_events():
        deterministic = payload.deterministic_result or {}
        fallback_answer = str(deterministic.get("answer") or "System data did not return an assistant answer.").strip()
        suggested_actions = [
            str(item).strip()
            for item in (deterministic.get("suggestedActions") or deterministic.get("suggested_actions") or [])
            if str(item).strip()
        ][:12]
        missing_data = [
            str(item).strip()
            for item in (deterministic.get("missingData") or deterministic.get("missing_data") or [])
            if str(item).strip()
        ][:24]
        confidence = str(deterministic.get("confidence") or "medium").strip().lower() or "medium"
        yield _sse_event("metadata", {
            "source": "gemma",
            "llmUsed": True,
            "model": getattr(service.llm, "model", None),
            "status": "stream_starting",
        })
        chunks: list[str] = []
        try:
            for chunk in service.stream_inventory_assistant_text(payload):
                text = str(chunk or "")
                if not text:
                    continue
                chunks.append(text)
                yield _sse_event("chunk", {"text": text})
            answer = "".join(chunks).strip()
            if not answer:
                raise RuntimeError("empty_stream")
            yield _sse_event("done", {
                "answer": answer,
                "suggested_actions": suggested_actions,
                "confidence": confidence,
                "missing_data": missing_data,
                "llm_used": True,
                "llm_status": "ready",
                "fallback_reason": None,
                "duration_ms": round((time.perf_counter() - started) * 1000),
                "model": getattr(service.llm, "model", None),
            })
        except Exception as exc:
            reason = str(exc) or "llm_stream_failed"
            logger.warning("Inventory assistant stream fallback: %s", reason)
            yield _sse_event("fallback", {
                "answer": fallback_answer,
                "reason": reason,
                "source": "deterministic",
            })
            yield _sse_event("done", {
                "answer": fallback_answer,
                "suggested_actions": suggested_actions,
                "confidence": confidence,
                "missing_data": missing_data,
                "llm_used": False,
                "llm_status": "fallback" if getattr(service.llm, "enabled", False) else "disabled",
                "fallback_reason": reason,
                "duration_ms": round((time.perf_counter() - started) * 1000),
                "model": getattr(service.llm, "model", None),
            })

    request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "inventory_assistant_stream"})
    return StreamingResponse(
        stream_events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post(
    "/map-import-columns",
    response_model=ImportColumnMappingResponse,
    summary="Suggest import column mappings from messy headers",
)
async def map_import_columns(payload: ImportColumnMappingRequest, request: Request) -> ImportColumnMappingResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service
    try:
        return await service.map_import_columns(payload)
    except Exception as exc:
        logger.exception("Import column mapping helper failed")
        raise HTTPException(status_code=500, detail=f"Import mapping error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "map_import_columns"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "map_import_columns"},
        )


@router.post(
    "/detect-missing-inventory-data",
    response_model=MissingDataDetectorResponse,
    summary="Explain missing-data/data-quality findings",
)
async def detect_missing_inventory_data(payload: MissingDataDetectorRequest, request: Request) -> MissingDataDetectorResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service
    try:
        return await service.detect_missing_inventory_data(payload)
    except Exception as exc:
        logger.exception("Missing data detector helper failed")
        raise HTTPException(status_code=500, detail=f"Missing-data helper error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "detect_missing_inventory_data"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "detect_missing_inventory_data"},
        )


@router.post(
    "/maintenance-recommendations",
    response_model=MaintenanceRecommendationResponse,
    summary="Summarize maintenance recommendation candidates",
)
async def maintenance_recommendations(payload: MaintenanceRecommendationRequest, request: Request) -> MaintenanceRecommendationResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service
    try:
        return await service.maintenance_recommendations(payload)
    except Exception as exc:
        logger.exception("Maintenance recommendations helper failed")
        raise HTTPException(status_code=500, detail=f"Maintenance recommendations error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "maintenance_recommendations"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "maintenance_recommendations"},
        )


@router.post(
    "/procurement-recommendations",
    response_model=ProcurementRecommendationResponse,
    summary="Summarize procurement recommendation candidates",
)
async def procurement_recommendations(payload: ProcurementRecommendationRequest, request: Request) -> ProcurementRecommendationResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service
    try:
        return await service.procurement_recommendations(payload)
    except Exception as exc:
        logger.exception("Procurement recommendations helper failed")
        raise HTTPException(status_code=500, detail=f"Procurement recommendations error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "procurement_recommendations"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "procurement_recommendations"},
        )


@router.post(
    "/explain-duplicate-assets",
    response_model=DuplicateExplanationResponse,
    summary="Explain duplicate detection groups",
)
async def explain_duplicate_assets(payload: DuplicateExplanationRequest, request: Request) -> DuplicateExplanationResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service
    try:
        return await service.explain_duplicate_assets(payload)
    except Exception as exc:
        logger.exception("Duplicate explanation helper failed")
        raise HTTPException(status_code=500, detail=f"Duplicate explanation error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "explain_duplicate_assets"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "explain_duplicate_assets"},
        )


@router.post(
    "/natural-language-inventory-search",
    response_model=NaturalLanguageInventorySearchResponse,
    summary="Explain NL inventory search results",
)
async def natural_language_inventory_search(
    payload: NaturalLanguageInventorySearchRequest,
    request: Request,
) -> NaturalLanguageInventorySearchResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service
    try:
        return await service.natural_language_inventory_search(payload)
    except Exception as exc:
        logger.exception("Natural language inventory search helper failed")
        raise HTTPException(status_code=500, detail=f"Natural language inventory search error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "natural_language_inventory_search"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "natural_language_inventory_search"},
        )


@router.post(
    "/data-correction-suggestions",
    response_model=DataCorrectionSuggestionsResponse,
    summary="Summarize deterministic inventory data correction suggestions",
)
async def data_correction_suggestions(
    payload: DataCorrectionSuggestionsRequest,
    request: Request,
) -> DataCorrectionSuggestionsResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service
    try:
        return await service.data_correction_suggestions(payload)
    except Exception as exc:
        logger.exception("Data correction suggestions helper failed")
        raise HTTPException(status_code=500, detail=f"Data correction suggestions error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "data_correction_suggestions"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "data_correction_suggestions"},
        )


@router.post(
    "/risk-score-explanation",
    response_model=RiskScoreExplanationResponse,
    summary="Explain deterministic inventory risk scores",
)
async def risk_score_explanation(
    payload: RiskScoreExplanationRequest,
    request: Request,
) -> RiskScoreExplanationResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service
    try:
        return await service.risk_score_explanation(payload)
    except Exception as exc:
        logger.exception("Risk score explanation helper failed")
        raise HTTPException(status_code=500, detail=f"Risk score explanation error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "risk_score_explanation"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "risk_score_explanation"},
        )


@router.post(
    "/replacement-priority",
    response_model=ReplacementPriorityResponse,
    summary="Summarize replacement-priority candidates",
)
async def replacement_priority(
    payload: ReplacementPriorityRequest,
    request: Request,
) -> ReplacementPriorityResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service
    try:
        return await service.replacement_priority(payload)
    except Exception as exc:
        logger.exception("Replacement priority helper failed")
        raise HTTPException(status_code=500, detail=f"Replacement priority error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "replacement_priority"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "replacement_priority"},
        )


@router.post(
    "/spare-stock-forecast",
    response_model=SpareStockForecastResponse,
    summary="Summarize spare-stock forecast recommendations",
)
async def spare_stock_forecast(
    payload: SpareStockForecastRequest,
    request: Request,
) -> SpareStockForecastResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service
    try:
        return await service.spare_stock_forecast(payload)
    except Exception as exc:
        logger.exception("Spare stock forecast helper failed")
        raise HTTPException(status_code=500, detail=f"Spare stock forecast error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "spare_stock_forecast"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "spare_stock_forecast"},
        )


@router.post(
    "/repair-import-errors",
    response_model=ImportErrorRepairResponse,
    summary="Explain deterministic import-error repair suggestions",
)
async def repair_import_errors(
    payload: ImportErrorRepairRequest,
    request: Request,
) -> ImportErrorRepairResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service
    try:
        return await service.repair_import_errors(payload)
    except Exception as exc:
        logger.exception("Import error repair helper failed")
        raise HTTPException(status_code=500, detail=f"Import error repair error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "repair_import_errors"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "repair_import_errors"},
        )


@router.post(
    "/relationship-suggestions",
    response_model=RelationshipSuggestionResponse,
    summary="Summarize deterministic relationship suggestions",
)
async def relationship_suggestions(
    payload: RelationshipSuggestionRequest,
    request: Request,
) -> RelationshipSuggestionResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service
    try:
        return await service.relationship_suggestions(payload)
    except Exception as exc:
        logger.exception("Relationship suggestions helper failed")
        raise HTTPException(status_code=500, detail=f"Relationship suggestions error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "relationship_suggestions"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "relationship_suggestions"},
        )


@router.post(
    "/match-invoice-assets",
    response_model=InvoiceAssetMatchingResponse,
    summary="Summarize invoice/document to asset matching suggestions",
)
async def match_invoice_assets(
    payload: InvoiceAssetMatchingRequest,
    request: Request,
) -> InvoiceAssetMatchingResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service
    try:
        return await service.match_invoice_assets(payload)
    except Exception as exc:
        logger.exception("Invoice asset matching helper failed")
        raise HTTPException(status_code=500, detail=f"Invoice asset matching error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "match_invoice_assets"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "match_invoice_assets"},
        )


@router.post(
    "/draft-inventory-ticket",
    response_model=InventoryTicketDraftResponse,
    summary="Polish inventory ticket drafts from deterministic issue data",
)
async def draft_inventory_ticket(
    payload: InventoryTicketDraftRequest,
    request: Request,
) -> InventoryTicketDraftResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service
    try:
        return await service.draft_inventory_ticket(payload)
    except Exception as exc:
        logger.exception("Inventory ticket draft helper failed")
        raise HTTPException(status_code=500, detail=f"Inventory ticket draft error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "draft_inventory_ticket"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "draft_inventory_ticket"},
        )


@router.post(
    "/monthly-inventory-report",
    response_model=MonthlyInventoryReportResponse,
    summary="Polish monthly inventory report output from deterministic metrics",
)
async def monthly_inventory_report(
    payload: MonthlyInventoryReportRequest,
    request: Request,
) -> MonthlyInventoryReportResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service
    try:
        return await service.monthly_inventory_report(payload)
    except Exception as exc:
        logger.exception("Monthly inventory report helper failed")
        raise HTTPException(status_code=500, detail=f"Monthly inventory report error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "monthly_inventory_report"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "monthly_inventory_report"},
        )


@router.post(
    "/plan-inventory-action",
    response_model=InventoryActionPlanResponse,
    summary="Polish natural-language inventory action plans (review-first)",
)
async def plan_inventory_action(
    payload: InventoryActionPlanRequest,
    request: Request,
) -> InventoryActionPlanResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service
    try:
        return await service.plan_inventory_action(payload)
    except Exception as exc:
        logger.exception("Inventory action planning helper failed")
        raise HTTPException(status_code=500, detail=f"Inventory action planning error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "plan_inventory_action"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "plan_inventory_action"},
        )


@router.post(
    "/extract-assets-from-document-text",
    response_model=DocumentExtractionResponse,
    summary="Extract candidate inventory rows from document text for assisted import",
)
async def extract_assets_from_document_text(payload: DocumentExtractionRequest, request: Request) -> DocumentExtractionResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service
    try:
        return await service.extract_assets_from_document_text(payload)
    except Exception as exc:
        logger.exception("Document extraction helper failed")
        raise HTTPException(status_code=500, detail=f"Document extraction error: {exc}") from exc
    finally:
        request.app.state.metrics.inc("inventory_ai_endpoint_total", labels={"endpoint": "extract_assets_from_document_text"})
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "extract_assets_from_document_text"},
        )


@router.post(
    "/extract-asset-specs-from-source",
    response_model=SourceSpecExtractionResponse,
    summary="Extract normalized asset specs strictly from fetched trusted source text",
)
async def extract_asset_specs_from_source(
    payload: SourceSpecExtractionRequest,
    request: Request,
) -> SourceSpecExtractionResponse:
    started = time.perf_counter()
    service = request.app.state.inventory_reasoning_service
    try:
        return await service.extract_specs_from_source(payload)
    except Exception as exc:
        logger.exception("Source spec extraction helper failed")
        raise HTTPException(status_code=500, detail=f"Source extraction error: {exc}") from exc
    finally:
        request.app.state.metrics.inc(
            "inventory_ai_endpoint_total",
            labels={"endpoint": "extract_asset_specs_from_source"},
        )
        request.app.state.metrics.observe(
            "inventory_ai_endpoint_seconds",
            time.perf_counter() - started,
            labels={"endpoint": "extract_asset_specs_from_source"},
        )
