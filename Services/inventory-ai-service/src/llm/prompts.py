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
{
  "normalized_specs": {},
  "invalid_fields": [],
  "missing_important_fields": [],
  "warnings": [],
  "confidence": 0.0
}

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
{
  "warnings": [],
  "suspicious_fields": [],
  "suggested_fixes": [],
  "requires_review": true
}

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
{
  "short_user_explanation": "",
  "technical_explanation": ""
}

Input:
{payload_json}
"""
