export {
  getLatestSpecSnapshot,
  persistSpecSnapshot,
  type PersistSpecSnapshotInput,
} from './specEvidenceRepository';
export {
  getLatestTelemetrySample,
  persistTelemetrySample,
  type PersistTelemetrySampleInput,
} from './telemetryRepository';
export {
  getLatestPersistedLifespanPrediction,
  persistLifespanPrediction,
  type PersistLifespanPredictionInput,
} from './lifespanRepository';
export {
  getLatestEolAssessment,
  persistEolAssessment,
  type PersistEolAssessmentInput,
} from './eolRepository';

