export type CategoryGroup =
  | 'endpoint_it'
  | 'network'
  | 'printer_doc'
  | 'av'
  | 'furniture'
  | 'lab'
  | 'facilities';

export type LiveStatusStrategy = 'online_offline' | 'condition_based' | 'runtime_based';

export type ProcurementGroupKey = 'assetType+brand+model' | 'assetType+brand' | 'assetType';

export type CanonicalLiveStatus =
  | 'online_in_use'
  | 'online_idle'
  | 'offline'
  | 'not_monitored'
  | 'insufficient_data'
  | 'monitoring_enabled_waiting_for_signal'
  | 'inspection_required'
  | 'condition_unknown'
  | 'not_applicable'
  | 'unknown';

export interface AssetIntelligenceProfile {
  assetType: string;
  displayName: string;
  categoryGroup: CategoryGroup;
  defaultLifespanYears: number;
  lifespanConfidenceBase: number;
  expectedSpecFields: string[];
  supportedTelemetrySources: string[];
  requiredSignals: string[];
  optionalSignals: string[];
  liveStatusStrategy: LiveStatusStrategy;
  onlineStatusApplicable: boolean;
  consumptionSignals: string[];
  qualityImpactWeights: Record<string, number>;
  eolRules: {
    watchMonths: number;
    dueSoonMonths: number;
    procurementWindowMonths: number;
  };
  specLookupStrategy: string[];
  trustedSourceTypes: string[];
  fallbackStatus: 'not_monitored' | 'insufficient_data' | 'inspection_required' | 'condition_unknown';
  manualReviewRequiredWhen: string[];
  procurementGroupKey: ProcurementGroupKey;
}

export type TelemetrySourceMode = 'push' | 'poll' | 'manual' | 'derived';
export type TelemetrySourceTrust = 'high' | 'medium' | 'low';
export type TelemetryFailureBehavior =
  | 'mark_insufficient_data'
  | 'mark_not_monitored'
  | 'keep_last_with_decay';

export interface TelemetrySourceDefinition {
  sourceKey: string;
  displayName: string;
  supportedAssetTypes: string[] | ['*'];
  mode: TelemetrySourceMode;
  trustLevel: TelemetrySourceTrust;
  freshnessThresholdMinutes: number;
  expectedSignals: string[];
  requiredFields: string[];
  statusMappingStrategy: string;
  consumptionMappingStrategy: string;
  qualityImpactMappingStrategy: string;
  confidenceRules: string[];
  failureBehavior: TelemetryFailureBehavior;
  examplePayload: Record<string, unknown>;
}

export type SpecSourceType =
  | 'manufacturer'
  | 'vendor_catalog'
  | 'internal_document'
  | 'cached_verified'
  | 'manual_override';

export type SpecExtractMode = 'html' | 'pdf' | 'api' | 'sheet';
export type SpecVerificationPolicy = 'auto_if_high_confidence' | 'manual_review_required';

export interface SpecSourceDefinition {
  sourceKey: string;
  sourceType: SpecSourceType;
  brandMatchers: string[];
  assetTypeMatchers: string[];
  trustedDomains: string[];
  trustedUrlPatterns: string[];
  priority: number;
  confidenceBase: number;
  requiresRecencyDays?: number;
  requiresContentHash: boolean;
  extractMode: SpecExtractMode;
  verificationPolicy: SpecVerificationPolicy;
}

export interface ConsumptionRuleDefinition {
  ruleKey: string;
  categoryGroup: CategoryGroup;
  signalWeights: Record<string, number>;
  qualityImpactWeights: Record<string, number>;
  minConfidenceToAffectLifespan: number;
  recalculationTriggerDelta: number;
  explanationTemplate: string;
}

export interface DerivedLiveStatusResult {
  status: CanonicalLiveStatus;
  confidence: number;
  reason: string;
  source: string;
  strategy: LiveStatusStrategy;
}

export interface DatasetTemplateDefinition {
  fileName: string;
  requiredColumns: string[];
  optionalColumns: string[];
}

export type ReadinessState = 'ready' | 'partial' | 'missing';

export interface ReadinessCapability {
  state: ReadinessState;
  summary: string;
  blockers: string[];
}

export interface EnvironmentVariableCheck {
  required: {
    present: string[];
    missing: string[];
  };
  optional: {
    present: string[];
    missing: string[];
  };
}

export interface DatasetTemplateStatus {
  fileName: string;
  exists: boolean;
  requiredColumnsPresent: boolean;
  missingRequiredColumns: string[];
}

export interface RegistryReadinessSummary {
  profileCount: number;
  missingAssetProfiles: string[];
  telemetrySourceCount: number;
  missingTelemetrySources: string[];
  specSourceCount: number;
  trustedSpecDomainsCount: number;
}

export interface CanonicalCoverageSummary {
  assetsTotal: number;
  assetsWithCanonicalSpecSnapshot: number;
  assetsWithCanonicalTelemetry: number;
  assetsWithCanonicalLifespanPrediction: number;
  assetsWithCanonicalEolAssessment: number;
  assetsWithProcurementCandidate: number;
}

export interface InventoryAiReadinessReport {
  generatedAt: string;
  capabilities: {
    specLookup: ReadinessCapability;
    telemetry: ReadinessCapability;
    consumption: ReadinessCapability;
    eol: ReadinessCapability;
    procurement: ReadinessCapability;
    durableAiJobs: ReadinessCapability;
  };
  registries: RegistryReadinessSummary;
  datasets: DatasetTemplateStatus[];
  environment: EnvironmentVariableCheck;
  coverage: CanonicalCoverageSummary;
  warnings: string[];
  nextSteps: string[];
}
