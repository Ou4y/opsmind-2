import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma';
import {
  getMissingAssetTypeProfiles,
  listAssetIntelligenceProfiles,
} from './profiles';
import { listTelemetrySources } from './telemetrySources';
import { listSpecSources, listTrustedSpecDomains } from './specSources';
import {
  DatasetTemplateDefinition,
  DatasetTemplateStatus,
  InventoryAiReadinessReport,
  ReadinessCapability,
  ReadinessState,
} from './types';
import { listConsumptionRules } from './consumptionRules';

const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'RABBITMQ_URI',
  'INVENTORY_AI_SERVICE_URL',
  'SPEC_VERIFICATION_CONFIDENCE_THRESHOLD',
];

const OPTIONAL_ENV_VARS = [
  'INVENTORY_ENFORCE_AUTH',
  'INTERNAL_API_TOKEN',
  'SERPAPI_API_KEY',
  'SERPAPI_ENDPOINT',
  'LLM_PROVIDER',
  'OLLAMA_BASE_URL',
  'OLLAMA_MODEL',
  'OLLAMA_TIMEOUT_SECONDS',
  'OLLAMA_TIMEOUT_MS',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'SPEC_RULE_VERSION_CONTROL',
  'SPEC_RULE_VERSION_CANDIDATE',
];

const REQUIRED_TELEMETRY_SOURCES = [
  'manual_toggle',
  'manual_inspection',
  'device_agent',
  'ping',
  'snmp',
  'mdm',
  'printer_counter',
  'network_controller',
  'maintenance_system',
  'ticket_history',
  'vendor_api',
  'building_management_system',
];

const REQUIRED_SPEC_SOURCE_HINTS = [
  'manufacturer.dell',
  'manufacturer.hp',
  'manufacturer.apple',
  'manufacturer.lenovo',
  'manufacturer.cisco',
  'manufacturer.ubiquiti',
  'manufacturer.tp_link',
  'manufacturer.epson',
  'manufacturer.canon',
  'manufacturer.brother',
  'manufacturer.microsoft_surface',
  'manufacturer.samsung',
  'manufacturer.lg',
  'manufacturer.benq',
  'manufacturer.viewsonic',
  'manufacturer.schneider_apc',
  'internal.vendor_catalog',
  'internal.procurement_spreadsheet',
  'internal.warranty_documents',
  'internal.maintenance_contracts',
];

const DATASET_TEMPLATE_DEFINITIONS: DatasetTemplateDefinition[] = [
  {
    fileName: 'asset_master_data.csv',
    requiredColumns: ['assetId', 'name', 'assetType', 'brand', 'model', 'department', 'location', 'currentStatus'],
    optionalColumns: ['serialNumber', 'purchaseDate', 'warrantyEndDate', 'assignedUser'],
  },
  {
    fileName: 'verified_specs_dataset.csv',
    requiredColumns: ['brand', 'model', 'assetType', 'verifiedSpecsJson', 'sourceUrl', 'sourceDomain', 'confidence'],
    optionalColumns: ['verifiedBy', 'verifiedAt'],
  },
  {
    fileName: 'lifespan_history_dataset.csv',
    requiredColumns: ['assetId', 'assetType', 'purchaseDate', 'actualLifespanYears', 'reasonForRetirement'],
    optionalColumns: ['retiredDate', 'failureDate', 'repairCount', 'usageLevel'],
  },
  {
    fileName: 'maintenance_ticket_history.csv',
    requiredColumns: ['assetId', 'ticketDate', 'ticketType', 'severity', 'resolution'],
    optionalColumns: ['repairCost', 'downtimeHours'],
  },
  {
    fileName: 'telemetry_samples_dataset.csv',
    requiredColumns: ['assetId', 'observedAt', 'source', 'rawSignalsJson', 'derivedStatus'],
    optionalColumns: ['activeHours', 'idleHours', 'offlineHours', 'consumptionScore', 'qualityImpactScore'],
  },
  {
    fileName: 'procurement_vendor_dataset.csv',
    requiredColumns: ['assetType', 'brand', 'model', 'supplier', 'replacementCost', 'leadTimeDays'],
    optionalColumns: ['minimumOrderQuantity', 'preferredVendor', 'warrantyMonths'],
  },
  {
    fileName: 'spec_source_registry.csv',
    requiredColumns: ['sourceKey', 'sourceType', 'brandMatchers', 'assetTypeMatchers', 'trustedDomains', 'priority', 'confidenceBase'],
    optionalColumns: ['trustedUrlPatterns', 'requiresRecencyDays'],
  },
  {
    fileName: 'asset_type_profile_dataset.csv',
    requiredColumns: ['assetType', 'categoryGroup', 'defaultLifespanYears', 'liveStatusStrategy', 'supportedTelemetrySources', 'fallbackStatus'],
    optionalColumns: ['expectedSpecFields', 'consumptionSignals', 'manualReviewRequiredWhen'],
  },
];

const PROPOSED_DURABLE_AI_JOB_TYPES = [
  'inventory.ai.spec_lookup.requested',
  'inventory.ai.spec_extract.requested',
  'inventory.ai.lifespan_prediction.requested',
  'inventory.ai.eol_assessment.requested',
  'inventory.ai.telemetry_rollup.requested',
  'inventory.ai.consumption_scoring.requested',
  'inventory.ai.procurement_candidate_refresh.requested',
];

function hasEnv(name: string): boolean {
  return Boolean(String(process.env[name] || '').trim());
}

function splitCsvHeaderLine(line: string): string[] {
  return line
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateDatasetTemplateFile(baseDir: string, template: DatasetTemplateDefinition): DatasetTemplateStatus {
  const targetPath = path.join(baseDir, template.fileName);
  if (!fs.existsSync(targetPath)) {
    return {
      fileName: template.fileName,
      exists: false,
      requiredColumnsPresent: false,
      missingRequiredColumns: template.requiredColumns,
    };
  }

  const firstLine = fs.readFileSync(targetPath, 'utf8').split(/\r?\n/, 1)[0] || '';
  const columns = new Set(splitCsvHeaderLine(firstLine));
  const missingRequiredColumns = template.requiredColumns.filter((required) => !columns.has(required));
  return {
    fileName: template.fileName,
    exists: true,
    requiredColumnsPresent: missingRequiredColumns.length === 0,
    missingRequiredColumns,
  };
}

function determineCapabilityState(blockers: string[], partialSignals: string[]): ReadinessState {
  if (blockers.length > 0) return 'missing';
  if (partialSignals.length > 0) return 'partial';
  return 'ready';
}

function buildCapability(summaryReady: string, summaryPartial: string, summaryMissing: string, blockers: string[], partialSignals: string[]): ReadinessCapability {
  const state = determineCapabilityState(blockers, partialSignals);
  if (state === 'ready') {
    return { state, summary: summaryReady, blockers: [] };
  }
  if (state === 'partial') {
    return { state, summary: summaryPartial, blockers: partialSignals };
  }
  return { state, summary: summaryMissing, blockers };
}

async function safeCount(label: string, producer: () => Promise<number>, errors: string[]): Promise<number> {
  try {
    return await producer();
  } catch (error: any) {
    const message = compactErrorMessage(error);
    errors.push(`${label}: ${message}`);
    console.warn(`[InventoryAIReadiness] ${label} unavailable: ${message}`);
    return 0;
  }
}

function compactErrorMessage(error: unknown): string {
  const raw = String((error as any)?.message || error || 'unknown error');
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const tableLine = lines.find((line) => line.toLowerCase().includes('does not exist'));
  if (tableLine) return tableLine;
  return lines[0] || 'unknown error';
}

async function collectCanonicalCoverage() {
  const errors: string[] = [];
  const assetsTotal = await safeCount('assets', async () => prisma.asset.count(), errors);
  const assetsWithCanonicalSpecSnapshot = await safeCount(
    'asset_spec_snapshots',
    async () => (await prisma.assetSpecSnapshot.groupBy({ by: ['assetId'] })).length,
    errors,
  );
  const assetsWithCanonicalTelemetry = await safeCount(
    'asset_telemetry_samples',
    async () => (await prisma.assetTelemetrySample.groupBy({ by: ['assetId'] })).length,
    errors,
  );
  const assetsWithCanonicalLifespanPrediction = await safeCount(
    'asset_lifespan_predictions',
    async () => (await prisma.assetLifespanPrediction.groupBy({ by: ['assetId'], where: { isDisplayOnly: false } })).length,
    errors,
  );
  const assetsWithCanonicalEolAssessment = await safeCount(
    'asset_eol_assessments',
    async () => (await prisma.assetEolAssessment.groupBy({ by: ['assetId'] })).length,
    errors,
  );
  const assetsWithProcurementCandidate = await safeCount(
    'asset_procurement_candidates',
    async () => (await prisma.assetProcurementCandidate.groupBy({ by: ['assetId'] })).length,
    errors,
  );

  return {
    coverage: {
      assetsTotal,
      assetsWithCanonicalSpecSnapshot,
      assetsWithCanonicalTelemetry,
      assetsWithCanonicalLifespanPrediction,
      assetsWithCanonicalEolAssessment,
      assetsWithProcurementCandidate,
    },
    errors,
  };
}

export async function buildInventoryAiReadinessReport(): Promise<InventoryAiReadinessReport> {
  const profiles = listAssetIntelligenceProfiles();
  const missingAssetProfiles = getMissingAssetTypeProfiles();
  const telemetrySources = listTelemetrySources();
  const telemetrySourceKeys = new Set(telemetrySources.map((entry) => entry.sourceKey));
  const missingTelemetrySources = REQUIRED_TELEMETRY_SOURCES.filter((key) => !telemetrySourceKeys.has(key));
  const specSources = listSpecSources();
  const specSourceKeys = new Set(specSources.map((entry) => entry.sourceKey));
  const missingSpecSources = REQUIRED_SPEC_SOURCE_HINTS.filter((key) => !specSourceKeys.has(key));
  const trustedSpecDomainsCount = listTrustedSpecDomains().length;
  const consumptionRules = listConsumptionRules();
  const { coverage, errors: coverageErrors } = await collectCanonicalCoverage();

  const datasetsDir = path.resolve(__dirname, '../../../datasets/templates');
  const datasets = DATASET_TEMPLATE_DEFINITIONS.map((template) => validateDatasetTemplateFile(datasetsDir, template));

  const requiredPresent = REQUIRED_ENV_VARS.filter((name) => hasEnv(name));
  const requiredMissing = REQUIRED_ENV_VARS.filter((name) => !hasEnv(name));
  const optionalPresent = OPTIONAL_ENV_VARS.filter((name) => hasEnv(name));
  const optionalMissing = OPTIONAL_ENV_VARS.filter((name) => !hasEnv(name));

  const specLookupBlockers: string[] = [];
  const specLookupPartial: string[] = [];
  if (missingSpecSources.length > 0) specLookupPartial.push(`Missing seeded spec sources: ${missingSpecSources.join(', ')}`);
  if (trustedSpecDomainsCount < 15) specLookupPartial.push('Trusted spec domain registry is too small.');
  if (!hasEnv('SERPAPI_API_KEY')) specLookupPartial.push('SERPAPI_API_KEY is not configured for live web lookup.');
  if (coverage.assetsWithCanonicalSpecSnapshot === 0) specLookupPartial.push('No canonical spec snapshots have been persisted yet.');
  if (specSources.length === 0) specLookupBlockers.push('Spec source registry is empty.');

  const telemetryBlockers: string[] = [];
  const telemetryPartial: string[] = [];
  if (missingTelemetrySources.length > 0) telemetryPartial.push(`Missing telemetry source contracts: ${missingTelemetrySources.join(', ')}`);
  if (coverage.assetsWithCanonicalTelemetry === 0) telemetryPartial.push('No canonical telemetry samples have been persisted yet.');
  if (telemetrySources.length === 0) telemetryBlockers.push('Telemetry source registry is empty.');

  const consumptionBlockers: string[] = [];
  const consumptionPartial: string[] = [];
  if (consumptionRules.length === 0) consumptionBlockers.push('No consumption scoring rules are registered.');
  if (coverage.assetsWithCanonicalTelemetry === 0) consumptionPartial.push('Consumption scoring has no telemetry baseline yet.');
  if (coverage.assetsWithCanonicalLifespanPrediction === 0) consumptionPartial.push('No persisted lifespan predictions exist to evaluate deltas.');

  const eolBlockers: string[] = [];
  const eolPartial: string[] = [];
  if (coverage.assetsWithCanonicalLifespanPrediction === 0) eolPartial.push('No canonical lifespan predictions exist yet.');
  if (coverage.assetsWithCanonicalEolAssessment === 0) eolPartial.push('No canonical EOL assessments exist yet.');
  if (profiles.length === 0) eolBlockers.push('Asset intelligence profiles are not configured.');

  const procurementBlockers: string[] = [];
  const procurementPartial: string[] = [];
  if (coverage.assetsWithCanonicalEolAssessment === 0) procurementPartial.push('Procurement readiness needs canonical EOL assessments.');
  if (coverage.assetsWithProcurementCandidate === 0) procurementPartial.push('No procurement candidates have been persisted yet.');

  const durableJobsBlockers: string[] = [
    'Durable job workers, retry queues, and DLQ handling are not implemented yet.',
  ];
  const durableJobsPartial: string[] = [
    `Proposed job contract count: ${PROPOSED_DURABLE_AI_JOB_TYPES.length}`,
  ];

  const capabilities = {
    specLookup: buildCapability(
      'Spec lookup readiness is strong with seeded trusted source contracts and canonical persistence.',
      'Spec lookup contracts exist, but provider coverage or evidence seeding is incomplete.',
      'Spec lookup readiness is missing core contracts.',
      specLookupBlockers,
      specLookupPartial,
    ),
    telemetry: buildCapability(
      'Telemetry readiness has source contracts and canonical persistence coverage.',
      'Telemetry contracts exist, but not all source contracts or signals are active yet.',
      'Telemetry readiness is missing core contracts.',
      telemetryBlockers,
      telemetryPartial,
    ),
    consumption: buildCapability(
      'Consumption scoring readiness has category rules and telemetry-backed baselines.',
      'Consumption contracts exist, but coverage is still limited by available telemetry/predictions.',
      'Consumption readiness is missing core rule contracts.',
      consumptionBlockers,
      consumptionPartial,
    ),
    eol: buildCapability(
      'EOL readiness is backed by canonical predictions and confidence-aware assessments.',
      'EOL framework exists, but canonical coverage is still building.',
      'EOL readiness is missing required profile/prediction contracts.',
      eolBlockers,
      eolPartial,
    ),
    procurement: buildCapability(
      'Procurement readiness has canonical assessment and candidate foundations.',
      'Procurement foundation exists, but planning coverage is limited.',
      'Procurement readiness is missing foundation contracts.',
      procurementBlockers,
      procurementPartial,
    ),
    durableAiJobs: buildCapability(
      'Durable async AI jobs are fully implemented.',
      'Durable async AI job contracts are defined but runtime workers are pending.',
      'Durable async AI job infrastructure is not implemented yet.',
      durableJobsBlockers,
      durableJobsPartial,
    ),
  };

  const warnings: string[] = [];
  if (requiredMissing.length > 0) warnings.push(`Missing required environment variables: ${requiredMissing.join(', ')}`);
  if (missingAssetProfiles.length > 0) warnings.push(`Missing asset intelligence profiles: ${missingAssetProfiles.join(', ')}`);
  if (missingTelemetrySources.length > 0) warnings.push(`Missing telemetry source definitions: ${missingTelemetrySources.join(', ')}`);
  if (missingSpecSources.length > 0) warnings.push(`Missing spec source definitions: ${missingSpecSources.join(', ')}`);
  const datasetIssues = datasets.filter((dataset) => !dataset.exists || !dataset.requiredColumnsPresent);
  if (datasetIssues.length > 0) {
    warnings.push(
      `Dataset template issues detected for: ${datasetIssues.map((entry) => entry.fileName).join(', ')}`,
    );
  }
  if (coverageErrors.length > 0) warnings.push(`Coverage checks partially unavailable: ${coverageErrors.join(' | ')}`);
  warnings.push('Durable AI job queues/retries/DLQ are still planned and not active yet.');

  const nextSteps: string[] = [
    'Connect first real telemetry provider (device_agent or snmp) and persist samples into asset_telemetry_samples.',
    'Seed internal source registry datasets and validate with readiness endpoint.',
    'Implement durable AI job workers with retry and DLQ contracts.',
    'Add procurement workflow state endpoints after confidence thresholds are verified in production-like data.',
  ];

  return {
    generatedAt: new Date().toISOString(),
    capabilities,
    registries: {
      profileCount: profiles.length,
      missingAssetProfiles,
      telemetrySourceCount: telemetrySources.length,
      missingTelemetrySources,
      specSourceCount: specSources.length,
      trustedSpecDomainsCount,
    },
    datasets,
    environment: {
      required: {
        present: requiredPresent,
        missing: requiredMissing,
      },
      optional: {
        present: optionalPresent,
        missing: optionalMissing,
      },
    },
    coverage,
    warnings,
    nextSteps,
  };
}
