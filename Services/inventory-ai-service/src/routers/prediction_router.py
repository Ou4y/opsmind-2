"""Prediction endpoints (ticket, asset lifespan, and spec inference)."""

from __future__ import annotations

import logging
import time

from fastapi import APIRouter, HTTPException, Request

from src.models import get_store
from src.schemas import (
    AssetHealthSummaryRequest,
    AssetHealthSummaryResponse,
    AssetLifespanRequest,
    AssetLifespanResponse,
    DocumentExtractionRequest,
    DocumentExtractionResponse,
    DuplicateExplanationRequest,
    DuplicateExplanationResponse,
    EolExplanationRequest,
    EolExplanationResponse,
    ImportColumnMappingRequest,
    ImportColumnMappingResponse,
    InventoryAssistantRequest,
    InventoryAssistantResponse,
    MaintenanceRecommendationRequest,
    MaintenanceRecommendationResponse,
    MissingDataDetectorRequest,
    MissingDataDetectorResponse,
    NaturalLanguageInventorySearchRequest,
    NaturalLanguageInventorySearchResponse,
    ProcurementRecommendationRequest,
    ProcurementRecommendationResponse,
    SourceSpecExtractionRequest,
    SourceSpecExtractionResponse,
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
