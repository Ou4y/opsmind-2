import { ASSET_TYPES } from '../../config/constants';
import { AssetIntelligenceProfile, CategoryGroup, LiveStatusStrategy } from './types';

const DEFAULT_EOL_RULES = {
  watchMonths: 12,
  dueSoonMonths: 3,
  procurementWindowMonths: 6,
};

type ProfileSeed = {
  assetType: string;
  displayName: string;
  categoryGroup: CategoryGroup;
  defaultLifespanYears: number;
  liveStatusStrategy: LiveStatusStrategy;
  onlineStatusApplicable: boolean;
  fallbackStatus: AssetIntelligenceProfile['fallbackStatus'];
  supportedTelemetrySources: string[];
  requiredSignals: string[];
  optionalSignals?: string[];
  expectedSpecFields?: string[];
  consumptionSignals?: string[];
  qualityImpactWeights?: Record<string, number>;
  specLookupStrategy?: string[];
  trustedSourceTypes?: string[];
  procurementGroupKey?: AssetIntelligenceProfile['procurementGroupKey'];
};

function buildProfile(seed: ProfileSeed): AssetIntelligenceProfile {
  return {
    assetType: seed.assetType,
    displayName: seed.displayName,
    categoryGroup: seed.categoryGroup,
    defaultLifespanYears: seed.defaultLifespanYears,
    lifespanConfidenceBase: 0.55,
    expectedSpecFields: seed.expectedSpecFields || ['brand', 'model', 'warranty', 'purchaseDate'],
    supportedTelemetrySources: seed.supportedTelemetrySources,
    requiredSignals: seed.requiredSignals,
    optionalSignals: seed.optionalSignals || [],
    liveStatusStrategy: seed.liveStatusStrategy,
    onlineStatusApplicable: seed.onlineStatusApplicable,
    consumptionSignals: seed.consumptionSignals || seed.requiredSignals,
    qualityImpactWeights: seed.qualityImpactWeights || {
      age: 0.25,
      faults: 0.25,
      utilization: 0.25,
      maintenance: 0.25,
    },
    eolRules: DEFAULT_EOL_RULES,
    specLookupStrategy: seed.specLookupStrategy || ['manufacturer', 'vendor_catalog', 'cached_verified'],
    trustedSourceTypes: seed.trustedSourceTypes || ['manufacturer', 'vendor_catalog', 'cached_verified'],
    fallbackStatus: seed.fallbackStatus,
    manualReviewRequiredWhen: [
      'spec evidence is low',
      'telemetry is missing or stale',
      'prediction confidence < 0.6',
    ],
    procurementGroupKey: seed.procurementGroupKey || 'assetType+brand+model',
  };
}

const PROFILE_LIST: AssetIntelligenceProfile[] = [
  buildProfile({
    assetType: 'laptop',
    displayName: 'Laptop',
    categoryGroup: 'endpoint_it',
    defaultLifespanYears: 5,
    liveStatusStrategy: 'online_offline',
    onlineStatusApplicable: true,
    fallbackStatus: 'insufficient_data',
    supportedTelemetrySources: ['device_agent', 'mdm', 'ping', 'ticket_history'],
    requiredSignals: ['heartbeat', 'active_user'],
    optionalSignals: ['cpu', 'ram', 'disk', 'battery_cycles', 'thermal_events'],
  }),
  buildProfile({
    assetType: 'desktop',
    displayName: 'Desktop PC',
    categoryGroup: 'endpoint_it',
    defaultLifespanYears: 6,
    liveStatusStrategy: 'online_offline',
    onlineStatusApplicable: true,
    fallbackStatus: 'insufficient_data',
    supportedTelemetrySources: ['device_agent', 'ping', 'ticket_history'],
    requiredSignals: ['heartbeat', 'login_activity'],
    optionalSignals: ['cpu', 'ram', 'disk', 'thermal_events'],
  }),
  buildProfile({
    assetType: 'monitor',
    displayName: 'Monitor',
    categoryGroup: 'endpoint_it',
    defaultLifespanYears: 6,
    liveStatusStrategy: 'online_offline',
    onlineStatusApplicable: false,
    fallbackStatus: 'not_monitored',
    supportedTelemetrySources: ['device_agent', 'manual_inspection'],
    requiredSignals: ['power_state'],
    optionalSignals: ['uptime', 'brightness_hours'],
    procurementGroupKey: 'assetType+brand',
  }),
  buildProfile({
    assetType: 'server',
    displayName: 'Server',
    categoryGroup: 'endpoint_it',
    defaultLifespanYears: 7,
    liveStatusStrategy: 'online_offline',
    onlineStatusApplicable: true,
    fallbackStatus: 'insufficient_data',
    supportedTelemetrySources: ['device_agent', 'snmp', 'ping', 'maintenance_system'],
    requiredSignals: ['heartbeat', 'uptime'],
    optionalSignals: ['cpu', 'ram', 'disk_io', 'temperature', 'smart_health'],
  }),
  buildProfile({
    assetType: 'tablet',
    displayName: 'Tablet / iPad',
    categoryGroup: 'endpoint_it',
    defaultLifespanYears: 4,
    liveStatusStrategy: 'online_offline',
    onlineStatusApplicable: true,
    fallbackStatus: 'insufficient_data',
    supportedTelemetrySources: ['mdm', 'device_agent', 'ticket_history'],
    requiredSignals: ['mdm_online'],
    optionalSignals: ['app_usage', 'battery_cycles'],
  }),
  buildProfile({
    assetType: 'peripheral',
    displayName: 'Peripheral (Keyboard/Mouse)',
    categoryGroup: 'endpoint_it',
    defaultLifespanYears: 3,
    liveStatusStrategy: 'condition_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'inspection_required',
    supportedTelemetrySources: ['manual_inspection', 'ticket_history'],
    requiredSignals: ['inspection_score'],
    optionalSignals: ['wear_level', 'repair_count'],
    procurementGroupKey: 'assetType+brand',
  }),
  buildProfile({
    assetType: 'projector',
    displayName: 'Projector',
    categoryGroup: 'av',
    defaultLifespanYears: 5,
    liveStatusStrategy: 'runtime_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'insufficient_data',
    supportedTelemetrySources: ['device_agent', 'manual_inspection', 'maintenance_system'],
    requiredSignals: ['runtime_hours'],
    optionalSignals: ['lamp_hours', 'overheat_events', 'fault_count'],
  }),
  buildProfile({
    assetType: 'smartboard',
    displayName: 'Smartboard',
    categoryGroup: 'av',
    defaultLifespanYears: 7,
    liveStatusStrategy: 'runtime_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'insufficient_data',
    supportedTelemetrySources: ['device_agent', 'manual_inspection', 'maintenance_system'],
    requiredSignals: ['power_hours'],
    optionalSignals: ['touch_errors', 'firmware_health'],
  }),
  buildProfile({
    assetType: 'camera',
    displayName: 'Camera',
    categoryGroup: 'av',
    defaultLifespanYears: 5,
    liveStatusStrategy: 'runtime_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'insufficient_data',
    supportedTelemetrySources: ['device_agent', 'manual_inspection', 'maintenance_system'],
    requiredSignals: ['runtime_hours'],
    optionalSignals: ['sensor_errors', 'battery_cycles'],
  }),
  buildProfile({
    assetType: 'microphone',
    displayName: 'Microphone',
    categoryGroup: 'av',
    defaultLifespanYears: 4,
    liveStatusStrategy: 'condition_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'inspection_required',
    supportedTelemetrySources: ['manual_inspection', 'ticket_history'],
    requiredSignals: ['inspection_score'],
    optionalSignals: ['distortion_reports', 'repair_count'],
    procurementGroupKey: 'assetType+brand',
  }),
  buildProfile({
    assetType: 'speaker',
    displayName: 'Speaker System',
    categoryGroup: 'av',
    defaultLifespanYears: 6,
    liveStatusStrategy: 'runtime_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'insufficient_data',
    supportedTelemetrySources: ['device_agent', 'manual_inspection', 'maintenance_system'],
    requiredSignals: ['usage_hours'],
    optionalSignals: ['thermal_events', 'amplifier_faults'],
  }),
  buildProfile({
    assetType: 'router',
    displayName: 'Router',
    categoryGroup: 'network',
    defaultLifespanYears: 6,
    liveStatusStrategy: 'online_offline',
    onlineStatusApplicable: true,
    fallbackStatus: 'insufficient_data',
    supportedTelemetrySources: ['snmp', 'ping', 'network_controller'],
    requiredSignals: ['snmp_reachable', 'uptime'],
    optionalSignals: ['traffic', 'packet_loss', 'temperature', 'reboot_count'],
  }),
  buildProfile({
    assetType: 'switch',
    displayName: 'Network Switch',
    categoryGroup: 'network',
    defaultLifespanYears: 7,
    liveStatusStrategy: 'online_offline',
    onlineStatusApplicable: true,
    fallbackStatus: 'insufficient_data',
    supportedTelemetrySources: ['snmp', 'ping', 'network_controller'],
    requiredSignals: ['snmp_reachable', 'uptime'],
    optionalSignals: ['port_errors', 'traffic', 'temperature'],
  }),
  buildProfile({
    assetType: 'access_point',
    displayName: 'Access Point (WiFi)',
    categoryGroup: 'network',
    defaultLifespanYears: 5,
    liveStatusStrategy: 'online_offline',
    onlineStatusApplicable: true,
    fallbackStatus: 'insufficient_data',
    supportedTelemetrySources: ['network_controller', 'snmp', 'ping'],
    requiredSignals: ['controller_seen'],
    optionalSignals: ['clients_connected', 'throughput', 'retry_rate'],
  }),
  buildProfile({
    assetType: 'firewall',
    displayName: 'Firewall Appliance',
    categoryGroup: 'network',
    defaultLifespanYears: 6,
    liveStatusStrategy: 'online_offline',
    onlineStatusApplicable: true,
    fallbackStatus: 'insufficient_data',
    supportedTelemetrySources: ['snmp', 'network_controller', 'ping'],
    requiredSignals: ['snmp_reachable', 'uptime'],
    optionalSignals: ['throughput', 'session_drops', 'temperature', 'faults'],
  }),
  buildProfile({
    assetType: 'printer',
    displayName: 'Printer',
    categoryGroup: 'printer_doc',
    defaultLifespanYears: 5,
    liveStatusStrategy: 'runtime_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'insufficient_data',
    supportedTelemetrySources: ['printer_counter', 'snmp', 'maintenance_system'],
    requiredSignals: ['page_count'],
    optionalSignals: ['toner_level', 'paper_jams', 'error_codes', 'service_calls'],
  }),
  buildProfile({
    assetType: 'scanner',
    displayName: 'Scanner',
    categoryGroup: 'printer_doc',
    defaultLifespanYears: 5,
    liveStatusStrategy: 'runtime_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'insufficient_data',
    supportedTelemetrySources: ['printer_counter', 'snmp', 'maintenance_system'],
    requiredSignals: ['scan_count'],
    optionalSignals: ['adf_jams', 'error_codes', 'service_calls'],
  }),
  buildProfile({
    assetType: 'desk',
    displayName: 'Desk',
    categoryGroup: 'furniture',
    defaultLifespanYears: 15,
    liveStatusStrategy: 'condition_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'inspection_required',
    supportedTelemetrySources: ['manual_inspection', 'ticket_history'],
    requiredSignals: ['inspection_score'],
    optionalSignals: ['repair_count', 'relocation_frequency'],
    procurementGroupKey: 'assetType',
  }),
  buildProfile({
    assetType: 'chair',
    displayName: 'Chair',
    categoryGroup: 'furniture',
    defaultLifespanYears: 10,
    liveStatusStrategy: 'condition_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'inspection_required',
    supportedTelemetrySources: ['manual_inspection', 'ticket_history'],
    requiredSignals: ['inspection_score'],
    optionalSignals: ['repair_count', 'usage_intensity'],
    procurementGroupKey: 'assetType',
  }),
  buildProfile({
    assetType: 'filing_cabinet',
    displayName: 'Filing Cabinet',
    categoryGroup: 'furniture',
    defaultLifespanYears: 20,
    liveStatusStrategy: 'condition_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'inspection_required',
    supportedTelemetrySources: ['manual_inspection', 'ticket_history'],
    requiredSignals: ['inspection_score'],
    optionalSignals: ['lock_failures', 'damage_reports'],
    procurementGroupKey: 'assetType',
  }),
  buildProfile({
    assetType: 'whiteboard',
    displayName: 'Whiteboard',
    categoryGroup: 'furniture',
    defaultLifespanYears: 10,
    liveStatusStrategy: 'condition_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'inspection_required',
    supportedTelemetrySources: ['manual_inspection', 'ticket_history'],
    requiredSignals: ['inspection_score'],
    optionalSignals: ['surface_wear', 'frame_damage'],
    procurementGroupKey: 'assetType',
  }),
  buildProfile({
    assetType: 'microscope',
    displayName: 'Microscope',
    categoryGroup: 'lab',
    defaultLifespanYears: 10,
    liveStatusStrategy: 'runtime_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'insufficient_data',
    supportedTelemetrySources: ['device_agent', 'manual_inspection', 'maintenance_system'],
    requiredSignals: ['operating_hours'],
    optionalSignals: ['calibration_pass_rate', 'faults'],
  }),
  buildProfile({
    assetType: 'centrifuge',
    displayName: 'Centrifuge',
    categoryGroup: 'lab',
    defaultLifespanYears: 8,
    liveStatusStrategy: 'runtime_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'insufficient_data',
    supportedTelemetrySources: ['device_agent', 'manual_inspection', 'maintenance_system'],
    requiredSignals: ['runtime_hours'],
    optionalSignals: ['cycle_count', 'vibration_errors', 'maintenance_events'],
  }),
  buildProfile({
    assetType: 'oscilloscope',
    displayName: 'Oscilloscope',
    categoryGroup: 'lab',
    defaultLifespanYears: 10,
    liveStatusStrategy: 'runtime_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'insufficient_data',
    supportedTelemetrySources: ['device_agent', 'manual_inspection', 'maintenance_system'],
    requiredSignals: ['runtime_hours'],
    optionalSignals: ['calibration_status', 'fault_logs'],
  }),
  buildProfile({
    assetType: '3d_printer',
    displayName: '3D Printer',
    categoryGroup: 'lab',
    defaultLifespanYears: 5,
    liveStatusStrategy: 'runtime_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'insufficient_data',
    supportedTelemetrySources: ['device_agent', 'maintenance_system', 'manual_inspection'],
    requiredSignals: ['print_hours'],
    optionalSignals: ['nozzle_wear', 'print_failures', 'maintenance_events'],
  }),
  buildProfile({
    assetType: 'vehicle',
    displayName: 'University Vehicle',
    categoryGroup: 'facilities',
    defaultLifespanYears: 10,
    liveStatusStrategy: 'runtime_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'insufficient_data',
    supportedTelemetrySources: ['device_agent', 'maintenance_system', 'manual_inspection'],
    requiredSignals: ['odometer', 'engine_hours'],
    optionalSignals: ['fault_codes', 'service_history'],
  }),
  buildProfile({
    assetType: 'generator',
    displayName: 'Generator',
    categoryGroup: 'facilities',
    defaultLifespanYears: 15,
    liveStatusStrategy: 'runtime_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'insufficient_data',
    supportedTelemetrySources: ['building_management_system', 'maintenance_system', 'manual_inspection'],
    requiredSignals: ['runtime_hours'],
    optionalSignals: ['load_cycles', 'faults', 'service_intervals'],
  }),
  buildProfile({
    assetType: 'hvac',
    displayName: 'HVAC Unit',
    categoryGroup: 'facilities',
    defaultLifespanYears: 15,
    liveStatusStrategy: 'runtime_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'insufficient_data',
    supportedTelemetrySources: ['building_management_system', 'maintenance_system', 'manual_inspection'],
    requiredSignals: ['runtime_hours'],
    optionalSignals: ['pressure', 'temperature', 'faults', 'maintenance_events'],
  }),
  buildProfile({
    assetType: 'maintenance_tool',
    displayName: 'Power Tool',
    categoryGroup: 'facilities',
    defaultLifespanYears: 5,
    liveStatusStrategy: 'runtime_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'inspection_required',
    supportedTelemetrySources: ['manual_inspection', 'maintenance_system'],
    requiredSignals: ['runtime_hours'],
    optionalSignals: ['cycle_count', 'vibration', 'faults', 'inspection_score'],
    procurementGroupKey: 'assetType+brand',
  }),
  // Compatibility profile seeds for legacy values present in schema/constants.
  buildProfile({
    assetType: 'keyboard',
    displayName: 'Keyboard',
    categoryGroup: 'endpoint_it',
    defaultLifespanYears: 3,
    liveStatusStrategy: 'condition_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'inspection_required',
    supportedTelemetrySources: ['manual_inspection'],
    requiredSignals: ['inspection_score'],
    procurementGroupKey: 'assetType',
  }),
  buildProfile({
    assetType: 'electronics',
    displayName: 'Electronics',
    categoryGroup: 'endpoint_it',
    defaultLifespanYears: 5,
    liveStatusStrategy: 'runtime_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'insufficient_data',
    supportedTelemetrySources: ['manual_inspection', 'device_agent'],
    requiredSignals: ['inspection_score'],
  }),
  buildProfile({
    assetType: 'furniture',
    displayName: 'Furniture',
    categoryGroup: 'furniture',
    defaultLifespanYears: 12,
    liveStatusStrategy: 'condition_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'inspection_required',
    supportedTelemetrySources: ['manual_inspection'],
    requiredSignals: ['inspection_score'],
    procurementGroupKey: 'assetType',
  }),
  buildProfile({
    assetType: 'lab_bench',
    displayName: 'Lab Bench',
    categoryGroup: 'lab',
    defaultLifespanYears: 12,
    liveStatusStrategy: 'condition_based',
    onlineStatusApplicable: false,
    fallbackStatus: 'inspection_required',
    supportedTelemetrySources: ['manual_inspection'],
    requiredSignals: ['inspection_score'],
    procurementGroupKey: 'assetType',
  }),
];

export const ASSET_INTELLIGENCE_PROFILES: Record<string, AssetIntelligenceProfile> = PROFILE_LIST.reduce(
  (acc, profile) => {
    acc[profile.assetType] = profile;
    return acc;
  },
  {} as Record<string, AssetIntelligenceProfile>,
);

const PROFILE_ALIASES: Record<string, string> = {
  desktop_pc: 'desktop',
  tablet_ipad: 'tablet',
  speaker_system: 'speaker',
  network_switch: 'switch',
  access_point_wifi: 'access_point',
  firewall_appliance: 'firewall',
  university_vehicle: 'vehicle',
  power_tool: 'maintenance_tool',
};

function normalizeAssetTypeKey(assetType: string): string {
  return String(assetType || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function getAssetIntelligenceProfile(assetType: string): AssetIntelligenceProfile | null {
  const normalized = normalizeAssetTypeKey(assetType);
  if (ASSET_INTELLIGENCE_PROFILES[normalized]) return ASSET_INTELLIGENCE_PROFILES[normalized];
  const aliasTarget = PROFILE_ALIASES[normalized];
  if (aliasTarget && ASSET_INTELLIGENCE_PROFILES[aliasTarget]) return ASSET_INTELLIGENCE_PROFILES[aliasTarget];
  return null;
}

export function listAssetIntelligenceProfiles(): AssetIntelligenceProfile[] {
  return Object.values(ASSET_INTELLIGENCE_PROFILES);
}

export function getExpectedAssetTypesFromConfig(): string[] {
  return ASSET_TYPES.map((entry) => String(entry.value || '').trim().toLowerCase()).filter(Boolean);
}

export function getMissingAssetTypeProfiles(): string[] {
  const configuredTypes = getExpectedAssetTypesFromConfig();
  return configuredTypes.filter((assetType) => !getAssetIntelligenceProfile(assetType));
}
