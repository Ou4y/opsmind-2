import { CategoryGroup, ConsumptionRuleDefinition } from './types';

const BASELINE_RULES: ConsumptionRuleDefinition[] = [
  {
    ruleKey: 'consumption.endpoint_it.v1',
    categoryGroup: 'endpoint_it',
    signalWeights: {
      active_hours: 0.3,
      cpu_pressure: 0.2,
      memory_pressure: 0.15,
      battery_cycles: 0.15,
      thermal_events: 0.1,
      ticket_incidents: 0.1,
    },
    qualityImpactWeights: {
      thermal_events: 0.35,
      battery_health: 0.25,
      disk_health: 0.2,
      incident_severity: 0.2,
    },
    minConfidenceToAffectLifespan: 0.6,
    recalculationTriggerDelta: 0.1,
    explanationTemplate:
      'Endpoint consumption score reflects active-use intensity, component stress, and incident pressure.',
  },
  {
    ruleKey: 'consumption.printer_doc.v1',
    categoryGroup: 'printer_doc',
    signalWeights: {
      page_or_scan_volume: 0.35,
      jam_rate: 0.2,
      error_rate: 0.2,
      maintenance_frequency: 0.15,
      consumable_stress: 0.1,
    },
    qualityImpactWeights: {
      jam_rate: 0.35,
      error_rate: 0.35,
      maintenance_backlog: 0.3,
    },
    minConfidenceToAffectLifespan: 0.62,
    recalculationTriggerDelta: 0.12,
    explanationTemplate:
      'Document-device consumption score reflects workload volume and reliability degradation indicators.',
  },
  {
    ruleKey: 'consumption.network.v1',
    categoryGroup: 'network',
    signalWeights: {
      throughput_load: 0.25,
      packet_loss: 0.2,
      port_or_interface_errors: 0.2,
      reboot_events: 0.15,
      temperature_stress: 0.2,
    },
    qualityImpactWeights: {
      sustained_errors: 0.4,
      thermal_stress: 0.3,
      reboot_instability: 0.3,
    },
    minConfidenceToAffectLifespan: 0.65,
    recalculationTriggerDelta: 0.1,
    explanationTemplate:
      'Network consumption score reflects reliability and stress patterns under active traffic conditions.',
  },
  {
    ruleKey: 'consumption.av.v1',
    categoryGroup: 'av',
    signalWeights: {
      runtime_hours: 0.3,
      lamp_or_component_hours: 0.25,
      overheat_events: 0.2,
      fault_events: 0.15,
      maintenance_frequency: 0.1,
    },
    qualityImpactWeights: {
      overheat_events: 0.4,
      fault_events: 0.35,
      component_wear: 0.25,
    },
    minConfidenceToAffectLifespan: 0.6,
    recalculationTriggerDelta: 0.1,
    explanationTemplate:
      'AV consumption score reflects runtime wear and thermal/fault conditions on critical components.',
  },
  {
    ruleKey: 'consumption.furniture.v1',
    categoryGroup: 'furniture',
    signalWeights: {
      inspection_decay: 0.4,
      repair_frequency: 0.35,
      location_usage_intensity: 0.25,
    },
    qualityImpactWeights: {
      structural_wear: 0.45,
      repair_burden: 0.35,
      safety_flags: 0.2,
    },
    minConfidenceToAffectLifespan: 0.55,
    recalculationTriggerDelta: 0.15,
    explanationTemplate:
      'Furniture consumption score reflects condition trend, repair load, and usage intensity context.',
  },
  {
    ruleKey: 'consumption.lab.v1',
    categoryGroup: 'lab',
    signalWeights: {
      runtime_hours: 0.3,
      calibration_drift: 0.25,
      fault_events: 0.2,
      maintenance_interval_breach: 0.25,
    },
    qualityImpactWeights: {
      calibration_failures: 0.4,
      fault_events: 0.35,
      overdue_maintenance: 0.25,
    },
    minConfidenceToAffectLifespan: 0.65,
    recalculationTriggerDelta: 0.1,
    explanationTemplate:
      'Lab-equipment consumption score reflects operational wear plus calibration and maintenance compliance.',
  },
  {
    ruleKey: 'consumption.facilities.v1',
    categoryGroup: 'facilities',
    signalWeights: {
      runtime_hours: 0.35,
      load_cycles: 0.2,
      fault_events: 0.2,
      service_interval_breach: 0.25,
    },
    qualityImpactWeights: {
      fault_events: 0.4,
      service_breach: 0.35,
      load_stress: 0.25,
    },
    minConfidenceToAffectLifespan: 0.65,
    recalculationTriggerDelta: 0.1,
    explanationTemplate:
      'Facilities consumption score reflects runtime stress and maintenance compliance for heavy-duty assets.',
  },
];

const RULES_BY_CATEGORY = BASELINE_RULES.reduce((acc, rule) => {
  acc[rule.categoryGroup] = rule;
  return acc;
}, {} as Record<CategoryGroup, ConsumptionRuleDefinition>);

export function listConsumptionRules(): ConsumptionRuleDefinition[] {
  return BASELINE_RULES;
}

export function getConsumptionRuleForCategory(category: CategoryGroup): ConsumptionRuleDefinition | null {
  return RULES_BY_CATEGORY[category] || null;
}
