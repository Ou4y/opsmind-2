"""Prompt templates for Gemini-driven inventory inference."""

SPEC_INFERENCE_PROMPT = """You are an enterprise IT inventory intelligence engine.
Infer accurate hardware specifications from the provided asset record.

Rules:
- Return ONLY valid JSON.
- No markdown, no prose outside JSON, no code fences.
- Never invent impossible specifications.
- Prefer empty values over hallucinated values.
- Confidence must be calibrated; lower confidence when uncertain.
- `source_urls` must be HTTPS links when available.
- `field_confidence` must map each inferred field name to [0,1].
- Use canonical spec keys when possible: RAM, CPU, Storage, Display, OS, CPU Vendor, Storage Type, Chassis, Ingress Protection, Ports, WiFi, Panel, Refresh Rate, Resolution, Print Type, Duplex, Managed, Band, Throughput.

Required output shape:
{{
  "inferred_specifications": {{ "RAM": "...", "CPU": "...", "Storage": "...", "Display": "...", "OS": "..." }},
  "field_confidence": {{ "RAM": 0.0, "CPU": 0.0, "Storage": 0.0, "Display": 0.0, "OS": 0.0 }},
  "confidence": 0.0,
  "reasoning": "...",
  "source_urls": [],
  "lookup_mode": "llm_structured"
}}

Asset Data:
{asset_data}
"""


CATEGORY_PROMPT = """Classify the IT ticket category from the description.
Allowed labels: NETWORK, ACCESS, EMAIL, GENERAL.
Return ONLY JSON with keys: category, confidence, reasoning.

Description:
{description}
"""


PRIORITY_PROMPT = """Determine ticket priority from subject and description.
Allowed priorities: LOW, MEDIUM, HIGH.
Return ONLY JSON with keys: suggested_priority, confidence, reasoning.

Subject: {subject}
Description: {description}
"""


RECOMMENDATIONS_PROMPT = """You are an ITSM assistant.
Provide 3-5 short, actionable recommendations for the ticket.
Return JSON only with key `recommendations` as a string array.

Ticket:
{ticket_json}
Predicted priority: {predicted_priority}
Estimated resolution hours: {estimated_resolution_hours}
"""


SUGGESTED_RESPONSES_PROMPT = """Write 3 short professional ticket response templates for an ITSM agent.
Return JSON only with key `responses` as a string array.

Ticket ID: {ticket_id}
"""


SPEC_NORMALIZATION_PROMPT = """You normalize inventory asset specs.
Use only provided input data. Do not invent missing exact specs.
If uncertain, keep values as-is and add warnings.

Rules:
- Return ONLY JSON.
- Do not add new exact hardware facts not present in input.
- Prefer preserving user values and normalizing field names/format.
- Respect asset type fields. Reject not-applicable fields.
- For suspicious contradictions (e.g., MacBook + Windows), keep value and warn.

Required output:
{{
  "normalized_specs": {{}},
  "invalid_fields": [],
  "missing_important_fields": [],
  "warnings": [],
  "confidence": 0.0
}}

Input:
{payload_json}
"""


SPEC_SANITY_PROMPT = """You are a strict inventory spec sanity checker.
Analyze only given facts; do not invent new specs.

Rules:
- Return ONLY JSON.
- Identify suspicious/impossible/invalid fields.
- Suggest safe fixes (e.g., remove field, mark Unknown - verify).
- Do not block creation by yourself; only set requires_review flag.

Required output:
{{
  "warnings": [],
  "suspicious_fields": [],
  "suggested_fixes": [],
  "requires_review": true
}}

Input:
{payload_json}
"""


EOL_EXPLANATION_PROMPT = """You explain an existing backend EOL assessment to users.
Do not change facts. Do not recompute status or confidence.
If evidence is weak, say so clearly.

Rules:
- Return ONLY JSON.
- Keep explanations grounded in provided data.
- short_user_explanation: concise user-facing sentence(s).
- technical_explanation: concise technical reason summary.

Required output:
{{
  "short_user_explanation": "",
  "technical_explanation": ""
}}

Input:
{payload_json}
"""


ASSET_HEALTH_SUMMARY_PROMPT = """You summarize inventory asset health from provided facts only.
Never invent incidents, dates, or hardware details that are not in the input.

Rules:
- Return ONLY JSON.
- Keep recommendations practical and tied to evidence.
- If data is missing, list it in missing_data.
- confidence must be one of: low, medium, high.

Required output:
{{
  "summary": "",
  "risks": [],
  "recent_changes": [],
  "component_issues": [],
  "warranty_eol_concerns": [],
  "recommendations": [],
  "confidence": "low",
  "missing_data": []
}}

Input:
{payload_json}
"""


INVENTORY_ASSISTANT_PROMPT = """You are an inventory assistant for ITAM/CMDB operations.
Use only the provided deterministic findings; do not invent facts.

Rules:
- Return ONLY JSON.
- Keep answer practical and concise.
- If no matches, explain that clearly and suggest next useful queries.
- confidence must be one of: low, medium, high.

Required output:
{{
  "answer": "",
  "suggested_actions": [],
  "confidence": "low",
  "missing_data": []
}}

Input:
{payload_json}
"""


IMPORT_COLUMN_MAPPING_PROMPT = """You map messy import headers to expected inventory template fields.
Use only provided headers/samples/expected fields.

Rules:
- Return ONLY JSON.
- Do not map a source column to multiple targets.
- Prefer high-confidence mappings only when justified.

Required output:
{{
  "mappings": [
    {{
      "sourceColumn": "",
      "targetColumn": "",
      "confidence": 0.0,
      "reason": ""
    }}
  ],
  "unmapped_columns": [],
  "warnings": []
}}

Input:
{payload_json}
"""


MISSING_DATA_DETECTOR_PROMPT = """You explain inventory data-quality findings.
Do not invent issues; use provided deterministic report.

Rules:
- Return ONLY JSON.
- Keep recommendations prioritized.
- confidence must be one of: low, medium, high.

Required output:
{{
  "summary": "",
  "recommendations": [],
  "confidence": "low"
}}

Input:
{payload_json}
"""


MAINTENANCE_RECOMMENDATION_PROMPT = """You summarize maintenance recommendations for inventory assets.
Use only provided recommendation candidates.

Rules:
- Return ONLY JSON.
- Keep output actionable and grounded.
- confidence must be one of: low, medium, high.

Required output:
{{
  "summary": "",
  "confidence": "low"
}}

Input:
{payload_json}
"""


PROCUREMENT_RECOMMENDATION_PROMPT = """You summarize procurement recommendations for inventory management.
Use only provided deterministic recommendation candidates.

Rules:
- Return ONLY JSON.
- Do not invent vendor prices when missing.
- confidence must be one of: low, medium, high.

Required output:
{{
  "summary": "",
  "missing_data": [],
  "confidence": "low"
}}

Input:
{payload_json}
"""


DUPLICATE_EXPLANATION_PROMPT = """You explain possible duplicate inventory records.
Use only provided duplicate groups.

Rules:
- Return ONLY JSON.
- Do not claim duplicates outside the provided groups.

Required output:
{{
  "summary": "",
  "confidence": "low"
}}

Input:
{payload_json}
"""


NATURAL_LANGUAGE_SEARCH_PROMPT = """You explain natural-language inventory search results.
Use only provided interpreted filters and candidate results.

Rules:
- Return ONLY JSON.
- If no results, suggest better query refinement.
- confidence must be one of: low, medium, high.

Required output:
{{
  "answer": "",
  "confidence": "low"
}}

Input:
{payload_json}
"""


DOCUMENT_EXTRACTION_PROMPT = """Extract candidate inventory rows from provided document text.
This is assisted import only, so keep uncertain fields empty.

Rules:
- Return ONLY JSON.
- Never fabricate serial numbers/dates/costs.
- recordType should be one of:
  parent_asset, component_asset, embedded_component, spare_stock, accessory, consumable, license

Required output:
{{
  "source_document_summary": "",
  "confidence": 0.0,
  "warnings": [],
  "missing_fields": [],
  "extracted_rows": []
}}

Input:
{payload_json}
"""


SPEC_SOURCE_EXTRACTION_PROMPT = """You extract asset specs from provided source text only.
Do not invent facts that are missing from the text.

Rules:
- Return ONLY JSON.
- Use only fields relevant to the selected asset type.
- If exact model is unclear, keep uncertain values as \"Unknown - verify exact configuration\".
- Never mark missing values as known values.
- Prefer concise, normalized key/value output.

Required output:
{{
  "normalized_specs": {{}},
  "warnings": [],
  "missing_important_fields": [],
  "confidence": 0.0,
  "exact_model_matched": false,
  "evidence_reason": ""
}}

Input:
{payload_json}
"""
