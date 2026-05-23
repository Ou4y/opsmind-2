import { getAssetIntelligenceProfile } from './profiles';
import { getTelemetrySourceDefinition } from './telemetrySources';
import { CanonicalLiveStatus, DerivedLiveStatusResult } from './types';

type ClassifierInput = {
  assetType: string;
  telemetrySource?: string | null;
  rawSignals?: Record<string, unknown> | null;
  telemetryEnabled?: boolean;
  hasFreshSignal?: boolean;
};

function toBool(value: unknown): boolean {
  if (value === true) return true;
  if (value === false) return false;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function hasMeaningfulSignals(signals: Record<string, unknown>): boolean {
  return Object.keys(signals).some((key) => {
    const value = signals[key];
    return value !== null && value !== undefined && String(value).trim() !== '';
  });
}

function buildResult(
  status: CanonicalLiveStatus,
  confidence: number,
  reason: string,
  source: string,
  strategy: DerivedLiveStatusResult['strategy'],
): DerivedLiveStatusResult {
  return {
    status,
    confidence: Math.max(0, Math.min(1, confidence)),
    reason,
    source,
    strategy,
  };
}

function classifyOnlineOffline(
  sourceKey: string,
  signals: Record<string, unknown>,
  telemetryEnabled: boolean,
  hasFreshSignal: boolean,
): DerivedLiveStatusResult {
  if (!telemetryEnabled && !hasMeaningfulSignals(signals)) {
    return buildResult(
      'not_monitored',
      0.2,
      'Telemetry is disabled and no telemetry signal has been captured.',
      sourceKey,
      'online_offline',
    );
  }

  if (telemetryEnabled && !hasFreshSignal) {
    return buildResult(
      'monitoring_enabled_waiting_for_signal',
      0.25,
      'Telemetry is enabled, but no fresh signal has been received yet.',
      sourceKey,
      'online_offline',
    );
  }

  const isOnline = toBool(signals.isOnline) || toBool(signals.reachable) || toBool(signals.snmp_reachable);
  const isActive = toBool(signals.isActive) || toNumber(signals.activeMinutes) !== null && Number(signals.activeMinutes) > 0;

  if (!hasMeaningfulSignals(signals)) {
    return buildResult(
      'insufficient_data',
      0.2,
      'Telemetry source exists, but usable online/offline signals are missing.',
      sourceKey,
      'online_offline',
    );
  }

  if (!isOnline) {
    return buildResult('offline', 0.75, 'Device appears unreachable from recent telemetry signals.', sourceKey, 'online_offline');
  }
  if (isActive) {
    return buildResult('online_in_use', 0.88, 'Recent telemetry indicates active usage.', sourceKey, 'online_offline');
  }
  return buildResult('online_idle', 0.82, 'Recent telemetry indicates online but idle state.', sourceKey, 'online_offline');
}

function classifyConditionBased(
  sourceKey: string,
  signals: Record<string, unknown>,
  telemetryEnabled: boolean,
  hasFreshSignal: boolean,
): DerivedLiveStatusResult {
  if (!telemetryEnabled && !hasMeaningfulSignals(signals)) {
    return buildResult(
      'inspection_required',
      0.2,
      'This asset type relies on inspections and has no telemetry/inspection signal yet.',
      sourceKey,
      'condition_based',
    );
  }

  if (telemetryEnabled && !hasFreshSignal) {
    return buildResult(
      'monitoring_enabled_waiting_for_signal',
      0.25,
      'Monitoring is enabled, waiting for inspection or telemetry input.',
      sourceKey,
      'condition_based',
    );
  }

  const inspectionScore = toNumber(signals.inspectionScore ?? signals.conditionScore);
  if (inspectionScore === null) {
    return buildResult(
      'condition_unknown',
      0.35,
      'Condition-based status is required, but no inspection score is available.',
      sourceKey,
      'condition_based',
    );
  }
  if (inspectionScore < 0.4) {
    return buildResult(
      'inspection_required',
      0.75,
      'Inspection score is low and requires manual review.',
      sourceKey,
      'condition_based',
    );
  }
  return buildResult(
    'not_applicable',
    0.7,
    'Online/offline does not apply to this asset type; condition score is available.',
    sourceKey,
    'condition_based',
  );
}

function classifyRuntimeBased(
  sourceKey: string,
  signals: Record<string, unknown>,
  telemetryEnabled: boolean,
  hasFreshSignal: boolean,
): DerivedLiveStatusResult {
  if (!telemetryEnabled && !hasMeaningfulSignals(signals)) {
    return buildResult(
      'not_monitored',
      0.2,
      'Runtime-based telemetry is not configured for this asset.',
      sourceKey,
      'runtime_based',
    );
  }

  if (telemetryEnabled && !hasFreshSignal) {
    return buildResult(
      'monitoring_enabled_waiting_for_signal',
      0.25,
      'Runtime monitoring is enabled, but no fresh runtime signal has arrived.',
      sourceKey,
      'runtime_based',
    );
  }

  const runtimeHours = toNumber(signals.runtimeHours ?? signals.runtime_hours ?? signals.workingHours);
  const faultCount = toNumber(signals.faults ?? signals.faultCount) || 0;

  if (runtimeHours === null) {
    return buildResult(
      'insufficient_data',
      0.35,
      'Runtime-based classification needs runtime signals that are missing.',
      sourceKey,
      'runtime_based',
    );
  }

  if (faultCount > 0 && runtimeHours > 0) {
    return buildResult(
      'online_in_use',
      0.62,
      'Runtime is active with fault pressure; operational review may be needed.',
      sourceKey,
      'runtime_based',
    );
  }

  if (runtimeHours > 0) {
    return buildResult(
      'online_idle',
      0.6,
      'Runtime evidence exists without active fault indicators.',
      sourceKey,
      'runtime_based',
    );
  }

  return buildResult(
    'insufficient_data',
    0.4,
    'Runtime telemetry exists but does not yet indicate active operation.',
    sourceKey,
    'runtime_based',
  );
}

export function deriveLiveStatus(input: ClassifierInput): DerivedLiveStatusResult {
  const profile = getAssetIntelligenceProfile(input.assetType);
  const sourceKey = String(input.telemetrySource || 'manual_toggle').trim();
  const source = getTelemetrySourceDefinition(sourceKey);
  const telemetryEnabled = Boolean(input.telemetryEnabled);
  const hasFreshSignal = Boolean(input.hasFreshSignal);
  const signals = (input.rawSignals && typeof input.rawSignals === 'object')
    ? input.rawSignals
    : {};

  if (!profile) {
    return buildResult(
      'unknown',
      0.1,
      'No asset intelligence profile is registered for this asset type.',
      source?.sourceKey || sourceKey,
      'condition_based',
    );
  }

  if (profile.liveStatusStrategy === 'online_offline') {
    return classifyOnlineOffline(source?.sourceKey || sourceKey, signals, telemetryEnabled, hasFreshSignal);
  }
  if (profile.liveStatusStrategy === 'runtime_based') {
    return classifyRuntimeBased(source?.sourceKey || sourceKey, signals, telemetryEnabled, hasFreshSignal);
  }
  return classifyConditionBased(source?.sourceKey || sourceKey, signals, telemetryEnabled, hasFreshSignal);
}
