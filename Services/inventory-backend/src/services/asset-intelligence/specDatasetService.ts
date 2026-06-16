import fs from 'fs';
import path from 'path';
import { ASSET_TYPES } from '../../config/constants';

type ConfidenceLevel = number;

export type AssetTypeSpecProfile = {
  assetType: string;
  categoryGroup: string;
  expectedSpecFields: string[];
  notApplicableFields: string[];
  supportedTelemetrySources: string[];
  liveStatusStrategy: string;
  consumptionSignals: string[];
  defaultLifespanYears: number;
  fallbackSpecTemplate: Record<string, string>;
  manualReviewRequiredWhen: string[];
};

export type VerifiedSpecsRow = {
  brand: string;
  model: string;
  assetType: string;
  modelYear: string;
  verifiedSpecsJson: Record<string, string>;
  sourceUrl: string;
  sourceDomain: string;
  sourceType: string;
  verifiedBy: string;
  verifiedAt: string;
  confidence: ConfidenceLevel;
  notes: string;
};

export type VerifiedSpecsMatchQuality = 'exact' | 'family';

export type VerifiedSpecsMatch = {
  row: VerifiedSpecsRow;
  quality: VerifiedSpecsMatchQuality;
  warnings: string[];
};

type CsvParseResult = {
  headers: string[];
  rows: Record<string, string>[];
  warnings: string[];
};

type DatasetCaches = {
  profileByType: Map<string, AssetTypeSpecProfile>;
  profileWarnings: string[];
  verifiedRows: VerifiedSpecsRow[];
  verifiedWarnings: string[];
  loaded: boolean;
};

const PROFILE_REQUIRED_COLUMNS = [
  'assetType',
  'categoryGroup',
  'expectedSpecFields',
  'notApplicableFields',
  'supportedTelemetrySources',
  'liveStatusStrategy',
  'consumptionSignals',
  'defaultLifespanYears',
  'fallbackSpecTemplate',
  'manualReviewRequiredWhen',
];

const VERIFIED_REQUIRED_COLUMNS = [
  'brand',
  'model',
  'assetType',
  'modelYear',
  'verifiedSpecsJson',
  'sourceUrl',
  'sourceDomain',
  'sourceType',
  'verifiedBy',
  'verifiedAt',
  'confidence',
  'notes',
];

const DATASET_ROOT = path.resolve(__dirname, '../../../datasets');
const KNOWN_ASSET_TYPE_SET = new Set(ASSET_TYPES.map((entry) => String(entry.value || '').trim().toLowerCase()));

const caches: DatasetCaches = {
  profileByType: new Map(),
  profileWarnings: [],
  verifiedRows: [],
  verifiedWarnings: [],
  loaded: false,
};

function normalizeToken(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeDelimitedList(value: string): string[] {
  return String(value || '')
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeAssetTypeInput(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (KNOWN_ASSET_TYPE_SET.has(raw)) return raw;
  const squash = normalizeToken(raw);
  for (const knownType of KNOWN_ASSET_TYPE_SET) {
    if (normalizeToken(knownType) === squash) return knownType;
  }
  if (squash === 'desktoppc') return 'desktop';
  if (squash === 'tabletipad') return 'tablet';
  if (squash === 'networkswitch') return 'switch';
  if (squash === 'accesspointwifi') return 'access_point';
  if (squash === 'firewallappliance') return 'firewall';
  if (squash === 'speakersystem') return 'speaker';
  if (squash === 'universityvehicle') return 'vehicle';
  if (squash === 'powertool') return 'maintenance_tool';
  return raw.replace(/\s+/g, '_');
}

function normalizeBrandInput(brand: unknown, model: unknown): string {
  const brandRaw = String(brand || '').trim().toLowerCase();
  const modelRaw = String(model || '').trim().toLowerCase();
  const combined = `${brandRaw} ${modelRaw}`;

  if (combined.includes('macbook') || combined.includes('mac book') || brandRaw === 'apple') {
    return 'apple';
  }
  if (brandRaw === 'hewlettpackard' || brandRaw === 'hpinc') return 'hp';
  return normalizeToken(brandRaw);
}

function normalizeModelInput(model: unknown): string {
  return normalizeToken(model);
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseCsvFile(filePath: string, requiredColumns: string[]): CsvParseResult {
  const warnings: string[] = [];
  if (!fs.existsSync(filePath)) {
    warnings.push(`Dataset file not found: ${filePath}`);
    return { headers: [], rows: [], warnings };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0 && !line.trim().startsWith('#'));
  if (lines.length === 0) {
    warnings.push(`Dataset file is empty: ${filePath}`);
    return { headers: [], rows: [], warnings };
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  const missingColumns = requiredColumns.filter((required) => !headers.includes(required));
  if (missingColumns.length > 0) {
    warnings.push(`Dataset ${path.basename(filePath)} missing required columns: ${missingColumns.join(', ')}`);
    return { headers, rows: [], warnings };
  }

  const rows: Record<string, string>[] = [];
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const values = parseCsvLine(lines[lineIndex]);
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = String(values[idx] ?? '').trim();
    });
    rows.push(row);
  }

  return { headers, rows, warnings };
}

function sanitizeSource(urlValue: string, sourceDomainValue: string): { sourceUrl: string; sourceDomain: string } {
  let sourceUrl = String(urlValue || '').trim();
  let sourceDomain = String(sourceDomainValue || '').trim().toLowerCase();

  if (sourceUrl) {
    try {
      const parsed = new URL(sourceUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        sourceUrl = '';
      } else if (!sourceDomain) {
        sourceDomain = parsed.hostname.replace(/^www\./, '').toLowerCase();
      }
    } catch (_error) {
      sourceUrl = '';
    }
  }

  if (sourceDomain && !/^[a-z0-9.-]+$/.test(sourceDomain)) {
    sourceDomain = '';
  }

  return { sourceUrl, sourceDomain };
}

function parseConfidence(value: string, fallback = 0.4): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

function resolveDatasetPath(envName: string, fileName: string): string {
  const envPath = String(process.env[envName] || '').trim();
  if (envPath && fs.existsSync(envPath)) return path.resolve(envPath);

  const seedPath = path.join(DATASET_ROOT, 'seed', fileName);
  if (fs.existsSync(seedPath)) return seedPath;

  const templateSameName = path.join(DATASET_ROOT, 'templates', fileName);
  if (fs.existsSync(templateSameName)) return templateSameName;

  const templateBaseName = fileName.replace('.seed.csv', '.csv');
  return path.join(DATASET_ROOT, 'templates', templateBaseName);
}

function loadProfiles(): { profileByType: Map<string, AssetTypeSpecProfile>; warnings: string[] } {
  const datasetPath = resolveDatasetPath('ASSET_TYPE_PROFILE_DATASET_PATH', 'asset_type_profile_dataset.seed.csv');
  const parsed = parseCsvFile(datasetPath, PROFILE_REQUIRED_COLUMNS);
  const warnings = [...parsed.warnings];
  const profileByType = new Map<string, AssetTypeSpecProfile>();

  parsed.rows.forEach((row, rowIndex) => {
    const assetType = normalizeAssetTypeInput(row.assetType);
    if (!assetType || !KNOWN_ASSET_TYPE_SET.has(assetType)) {
      warnings.push(`Profile row ${rowIndex + 2}: unknown assetType "${row.assetType}" - row skipped`);
      return;
    }

    let fallbackSpecTemplate: Record<string, string> = {};
    try {
      const parsedTemplate = JSON.parse(String(row.fallbackSpecTemplate || '{}'));
      if (parsedTemplate && typeof parsedTemplate === 'object' && !Array.isArray(parsedTemplate)) {
        Object.entries(parsedTemplate as Record<string, unknown>).forEach(([key, value]) => {
          fallbackSpecTemplate[String(key)] = String(value ?? '').trim();
        });
      }
    } catch (_error) {
      warnings.push(`Profile row ${rowIndex + 2}: invalid fallbackSpecTemplate JSON - row skipped`);
      return;
    }

    if (Object.keys(fallbackSpecTemplate).length === 0) {
      warnings.push(`Profile row ${rowIndex + 2}: empty fallbackSpecTemplate - row skipped`);
      return;
    }

    const defaultLifespanYears = Number(row.defaultLifespanYears);
    const safeYears = Number.isFinite(defaultLifespanYears) && defaultLifespanYears > 0
      ? defaultLifespanYears
      : 5;

    profileByType.set(assetType, {
      assetType,
      categoryGroup: String(row.categoryGroup || '').trim(),
      expectedSpecFields: normalizeDelimitedList(row.expectedSpecFields),
      notApplicableFields: normalizeDelimitedList(row.notApplicableFields),
      supportedTelemetrySources: normalizeDelimitedList(row.supportedTelemetrySources),
      liveStatusStrategy: String(row.liveStatusStrategy || '').trim(),
      consumptionSignals: normalizeDelimitedList(row.consumptionSignals),
      defaultLifespanYears: safeYears,
      fallbackSpecTemplate,
      manualReviewRequiredWhen: normalizeDelimitedList(row.manualReviewRequiredWhen),
    });
  });

  return { profileByType, warnings };
}

function loadVerifiedRows(): { verifiedRows: VerifiedSpecsRow[]; warnings: string[] } {
  const datasetPath = resolveDatasetPath('VERIFIED_SPECS_DATASET_PATH', 'verified_specs_dataset.seed.csv');
  const parsed = parseCsvFile(datasetPath, VERIFIED_REQUIRED_COLUMNS);
  const warnings = [...parsed.warnings];
  const verifiedRows: VerifiedSpecsRow[] = [];

  parsed.rows.forEach((row, rowIndex) => {
    const assetType = normalizeAssetTypeInput(row.assetType);
    if (!assetType || !KNOWN_ASSET_TYPE_SET.has(assetType)) {
      warnings.push(`Verified specs row ${rowIndex + 2}: unknown assetType "${row.assetType}" - row skipped`);
      return;
    }

    let verifiedSpecsJson: Record<string, string> = {};
    try {
      const parsedSpecs = JSON.parse(String(row.verifiedSpecsJson || '{}'));
      if (!parsedSpecs || typeof parsedSpecs !== 'object' || Array.isArray(parsedSpecs)) {
        warnings.push(`Verified specs row ${rowIndex + 2}: verifiedSpecsJson is not a JSON object - row skipped`);
        return;
      }
      Object.entries(parsedSpecs as Record<string, unknown>).forEach(([key, value]) => {
        const fieldKey = String(key || '').trim();
        const fieldValue = String(value ?? '').trim();
        if (fieldKey && fieldValue) verifiedSpecsJson[fieldKey] = fieldValue;
      });
    } catch (_error) {
      warnings.push(`Verified specs row ${rowIndex + 2}: invalid verifiedSpecsJson - row skipped`);
      return;
    }

    if (Object.keys(verifiedSpecsJson).length === 0) {
      warnings.push(`Verified specs row ${rowIndex + 2}: verifiedSpecsJson has no usable fields - row skipped`);
      return;
    }

    const { sourceUrl, sourceDomain } = sanitizeSource(row.sourceUrl, row.sourceDomain);
    const confidence = parseConfidence(row.confidence, 0.45);

    verifiedRows.push({
      brand: String(row.brand || '').trim(),
      model: String(row.model || '').trim(),
      assetType,
      modelYear: String(row.modelYear || '').trim(),
      verifiedSpecsJson,
      sourceUrl,
      sourceDomain,
      sourceType: String(row.sourceType || '').trim(),
      verifiedBy: String(row.verifiedBy || '').trim(),
      verifiedAt: String(row.verifiedAt || '').trim(),
      confidence,
      notes: String(row.notes || '').trim(),
    });
  });

  return { verifiedRows, warnings };
}

function ensureLoaded(): void {
  if (caches.loaded) return;
  const profileResult = loadProfiles();
  const verifiedResult = loadVerifiedRows();
  caches.profileByType = profileResult.profileByType;
  caches.profileWarnings = profileResult.warnings;
  caches.verifiedRows = verifiedResult.verifiedRows;
  caches.verifiedWarnings = verifiedResult.warnings;
  caches.loaded = true;
}

function containsModelFamily(modelInputNorm: string, modelRowNorm: string): boolean {
  if (!modelInputNorm || !modelRowNorm) return false;
  if (modelInputNorm.includes(modelRowNorm) || modelRowNorm.includes(modelInputNorm)) return true;
  const macbookProFamily = modelInputNorm.includes('macbookpro') && modelRowNorm.includes('macbookpro');
  if (macbookProFamily) return true;
  return false;
}

function isGenericRow(row: VerifiedSpecsRow): boolean {
  const notesNorm = normalizeToken(row.notes);
  return notesNorm.includes('generic') || notesNorm.includes('family') || notesNorm.includes('verify');
}

function lookupVerifiedSpecs(input: { brand?: string; model?: string; assetType: string }): VerifiedSpecsMatch | null {
  ensureLoaded();
  const assetType = normalizeAssetTypeInput(input.assetType);
  if (!assetType) return null;

  const inputBrandNorm = normalizeBrandInput(input.brand, input.model);
  const inputModelNorm = normalizeModelInput(input.model);
  const scopedRows = caches.verifiedRows.filter((row) => row.assetType === assetType);
  if (!scopedRows.length) return null;

  let best: { row: VerifiedSpecsRow; score: number; quality: VerifiedSpecsMatchQuality; warnings: string[] } | null = null;

  for (const row of scopedRows) {
    const rowBrandNorm = normalizeBrandInput(row.brand, row.model);
    const rowModelNorm = normalizeModelInput(row.model);
    const brandMatch = Boolean(inputBrandNorm) && inputBrandNorm === rowBrandNorm;
    const exactModelMatch = Boolean(inputModelNorm) && inputModelNorm === rowModelNorm;
    const familyModelMatch = containsModelFamily(inputModelNorm, rowModelNorm);
    if (!brandMatch && !exactModelMatch && !familyModelMatch) continue;

    let score = 0;
    let quality: VerifiedSpecsMatchQuality = 'family';
    const warnings: string[] = [];

    if (brandMatch && exactModelMatch) {
      score = 100;
      quality = 'exact';
    } else if (brandMatch && familyModelMatch) {
      score = 78;
      quality = 'family';
      warnings.push('Family-level model match; exact configuration should be verified.');
    } else if (exactModelMatch) {
      score = 70;
      quality = 'family';
      warnings.push('Model matched without strong brand match; manual verification required.');
    } else if (familyModelMatch) {
      score = 62;
      quality = 'family';
      warnings.push('Weak family-level match; manual verification required.');
    }

    if (isGenericRow(row)) {
      score -= 6;
      warnings.push('Dataset row is generic; exact configuration is not guaranteed.');
    }

    if (!best || score > best.score) {
      best = { row, score, quality, warnings };
    }
  }

  if (!best) return null;
  return {
    row: best.row,
    quality: best.quality,
    warnings: best.warnings,
  };
}

function loadAssetTypeProfilesFromDataset(): { profiles: AssetTypeSpecProfile[]; warnings: string[] } {
  ensureLoaded();
  return {
    profiles: Array.from(caches.profileByType.values()),
    warnings: [...caches.profileWarnings],
  };
}

function loadVerifiedSpecsDataset(): { rows: VerifiedSpecsRow[]; warnings: string[] } {
  ensureLoaded();
  return {
    rows: [...caches.verifiedRows],
    warnings: [...caches.verifiedWarnings],
  };
}

function getAssetTypeSpecProfile(assetType: string): AssetTypeSpecProfile | null {
  ensureLoaded();
  const normalized = normalizeAssetTypeInput(assetType);
  if (!normalized) return null;
  return caches.profileByType.get(normalized) || null;
}

function getSpecDatasetWarnings(): string[] {
  ensureLoaded();
  return [...caches.profileWarnings, ...caches.verifiedWarnings];
}

export {
  getAssetTypeSpecProfile,
  getSpecDatasetWarnings,
  loadAssetTypeProfilesFromDataset,
  loadVerifiedSpecsDataset,
  lookupVerifiedSpecs,
  normalizeAssetTypeInput,
  normalizeBrandInput,
  normalizeModelInput,
};
