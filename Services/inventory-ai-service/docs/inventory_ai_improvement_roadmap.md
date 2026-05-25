# Inventory AI Improvement Roadmap (Gemma-First)

## Current baseline
- Primary local provider: `ollama`
- Default model: `gemma3:4b`
- Existing helpers: spec normalization/sanity, EOL explanation, source extraction
- New helper in this pass: asset health summary from parent + related history context

## Model strategy
- Primary local LLM: `gemma3:4b`
  - Use for summary/explanation/recommendation and missing-data narratives.
- Optional embedding model: `nomic-embed-text`
  - Use later for semantic search, duplicate similarity, and related-record retrieval.
- Optional structured model: `qwen2.5:7b`
  - Use later for stronger JSON mapping/validation for messy imports.
- Optional vision/cloud future:
  - Gemini API / Qwen2.5-VL / Llama 3.2 Vision for scanned PDF/image extraction with mandatory review.

## Near-term feature phases
1. AI Asset Health Summary
- Implemented endpoint: `/summarize-asset-health`
- Inputs: asset profile, EOL assessment, related timeline, component snapshot, maintenance count
- Output: summary, risks, changes, component issues, warranty/EOL concerns, recommendations, confidence, missing data

2. Combined-history assistant prompts
- Build parent-asset maintenance narratives from direct + related events.
- Explain confidence gaps based on missing lifecycle/telemetry fields.

3. Smart import mapping assistant
- Suggest CSV column mappings for messy headers.
- Keep deterministic validation authoritative; AI is suggestion-only.

4. Missing-data detector
- Explain missing serial/tag/warranty/purchase/parent linkage/component serial coverage.

5. Procurement recommendations
- Blend low spare stock + failure frequencies + warranty/EOL risk into purchase suggestions.

6. Duplicate detection
- Rules first (serial/tag collisions), embeddings second (`nomic-embed-text`) for fuzzy similarity.

7. Natural language inventory search
- Retrieval + structured answer generation; keep auditable citations to matched records.

## Guardrails
- Never invent serial numbers, warranty dates, or maintenance actions.
- If evidence is incomplete, return explicit missing-data fields and lower confidence.
- Keep cloud/vision ingestion disabled by default and review-gated.
