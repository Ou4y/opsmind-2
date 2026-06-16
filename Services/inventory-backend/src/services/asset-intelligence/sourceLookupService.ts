import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getAssetTypeSpecProfile, normalizeAssetTypeInput, normalizeBrandInput } from './specDatasetService';
import { listSpecSources } from './specSources';

type LookupConfig = {
  enabled: boolean;
  apiKey: string;
  endpoint: string;
  timeoutMs: number;
  searchTimeoutMs: number;
  fetchTimeoutMs: number;
  extractionTimeoutMs: number;
  totalLookupTimeoutMs: number;
  maxResults: number;
  allowedDomainsOnly: boolean;
  cacheEnabled: boolean;
  cacheTtlDays: number;
  maxFetchBytes: number;
};

type SourceRegistryRow = {
  assetType: string;
  brand: string;
  sourceDomain: string;
  sourceUrl: string;
  sourceType: string;
  sourceStyle: SourceStyle;
  trustLevel: 'high' | 'medium' | 'low';
  notes: string;
};

type SourceStyle =
  | 'official_support'
  | 'official_datasheet'
  | 'official_product_specs'
  | 'official_manuals'
  | 'official_quickspecs'
  | 'official_catalog'
  | 'official_store_product_page'
  | 'official_download_center';

type SearchCandidate = {
  title: string;
  snippet: string;
  url: string;
  domain: string;
  score: number;
  reason: string;
  sourceStyle: SourceStyle;
  trustLevel: 'high' | 'medium' | 'low';
};

type SourceCacheRow = {
  brand: string;
  model: string;
  assetType: string;
  normalizedKey: string;
  specsText: string;
  normalizedSpecs: Record<string, string>;
  sourceUrl: string;
  sourceDomain: string;
  sourceType: string;
  confidence: number;
  evidenceStatus: string;
  exactModelMatched: boolean;
  requiresReview?: boolean;
  contentHash: string;
  fetchedAt: string;
  expiresAt: string;
  warnings: string[];
};

export type SourceLookupInput = {
  assetType: string;
  brand: string;
  model: string;
  forceRefresh?: boolean;
  allowLiveLookup?: boolean;
};

export type SourceLookupResult = {
  success: boolean;
  cacheHit: boolean;
  sourceType: string;
  sourceUrl: string;
  sourceDomain: string;
  specsText: string;
  normalizedSpecs: Record<string, string>;
  confidence: number;
  evidenceStatus: 'source_backed' | 'source_candidate_or_family_level' | 'insufficient_source_evidence' | 'llm_or_heuristic_only';
  evidenceReason: string;
  requiresReview: boolean;
  warnings: string[];
  candidates: Array<{
    url: string;
    domain: string;
    title: string;
    score: number;
    reason: string;
    extractionAttempted: boolean;
    extractionFailedReason?: string;
  }>;
  exactModelMatched: boolean;
  lookupMode: string;
  message?: string;
};

const DATASET_ROOT = path.resolve(__dirname, '../../../datasets');
const CACHE_PATH = path.join(DATASET_ROOT, 'cache', 'source_verified_specs_cache.jsonl');
const REGISTRY_SEED_PATH = path.join(DATASET_ROOT, 'seed', 'spec_source_registry.seed.csv');
const REGISTRY_TEMPLATE_PATH = path.join(DATASET_ROOT, 'templates', 'spec_source_registry.csv');

function clampNumber(value: unknown, min: number, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

function normalizeToken(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeDomain(domainValue: string): string {
  const raw = String(domainValue || '').trim().toLowerCase();
  return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

function sanitizeUrl(urlValue: string): string {
  const raw = String(urlValue || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.toString();
  } catch (_error) {
    return '';
  }
}

function normalizeAssetType(value: unknown): string {
  return normalizeAssetTypeInput(value) || String(value || '').trim().toLowerCase();
}

function slugifyModel(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeKey(assetType: string, brand: string, model: string): string {
  const typeKey = normalizeAssetType(assetType);
  const brandKey = normalizeBrandInput(brand, model);
  const modelKey = slugifyModel(model);
  return `${typeKey}|${brandKey}|${modelKey}`;
}

function parseBoolean(value: unknown, fallback = false): boolean {
  if (value === true) return true;
  if (value === false) return false;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function getLookupConfig(): LookupConfig {
  const baseTimeoutMs = Math.max(2000, Number(process.env.SPEC_LOOKUP_TIMEOUT_MS || 12000));
  return {
    enabled: parseBoolean(process.env.SPEC_LOOKUP_ENABLED, false),
    apiKey: String(process.env.SERPAPI_API_KEY || '').trim(),
    endpoint: String(process.env.SERPAPI_ENDPOINT || 'https://serpapi.com/search.json').trim(),
    timeoutMs: baseTimeoutMs,
    searchTimeoutMs: Math.max(3000, Number(process.env.SPEC_LOOKUP_SEARCH_TIMEOUT_MS || baseTimeoutMs)),
    fetchTimeoutMs: Math.max(3000, Number(process.env.SPEC_LOOKUP_FETCH_TIMEOUT_MS || baseTimeoutMs)),
    extractionTimeoutMs: Math.max(8000, Number(process.env.SPEC_LOOKUP_EXTRACTION_TIMEOUT_MS || 35000)),
    totalLookupTimeoutMs: Math.max(15_000, Number(process.env.SPEC_LOOKUP_TOTAL_TIMEOUT_MS || 90_000)),
    maxResults: Math.max(1, Math.min(10, Number(process.env.SPEC_LOOKUP_MAX_RESULTS || 5))),
    allowedDomainsOnly: parseBoolean(process.env.SPEC_LOOKUP_ALLOWED_DOMAINS_ONLY, true),
    cacheEnabled: parseBoolean(process.env.SPEC_LOOKUP_CACHE_ENABLED, true),
    cacheTtlDays: Math.max(1, Number(process.env.SPEC_LOOKUP_CACHE_TTL_DAYS || 90)),
    maxFetchBytes: Math.max(10_000, Number(process.env.SPEC_LOOKUP_MAX_FETCH_BYTES || 500_000)),
  };
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function parseCsvRows(filePath: string): Record<string, string>[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = String(values[idx] ?? '').trim();
    });
    return row;
  });
}

function mapTrustLevel(value: string): 'high' | 'medium' | 'low' {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'high' || normalized === 'medium' || normalized === 'low') return normalized;
  if (normalized.includes('high')) return 'high';
  if (normalized.includes('medium')) return 'medium';
  return 'low';
}

function classifySourceStyle(sourceType: string, sourceUrl: string, notes: string): SourceStyle {
  const text = `${sourceType} ${sourceUrl} ${notes}`.toLowerCase();
  if (text.includes('quickspec') || text.includes('psref')) return 'official_quickspecs';
  if (text.includes('datasheet') || text.includes('data-sheet')) return 'official_datasheet';
  if (text.includes('manual') || text.includes('user guide')) return 'official_manuals';
  if (text.includes('download')) return 'official_download_center';
  if (text.includes('support')) return 'official_support';
  if (text.includes('specification') || text.includes('specs')) return 'official_product_specs';
  if (text.includes('catalog')) return 'official_catalog';
  if (text.includes('store') || text.includes('shop')) return 'official_store_product_page';
  return 'official_support';
}

function sourceStyleWeight(style: SourceStyle): number {
  switch (style) {
    case 'official_datasheet': return 28;
    case 'official_quickspecs': return 26;
    case 'official_manuals': return 24;
    case 'official_download_center': return 23;
    case 'official_support': return 20;
    case 'official_product_specs': return 18;
    case 'official_catalog': return 12;
    case 'official_store_product_page': return 5;
    default: return 10;
  }
}

function normalizeModelTokenList(model: string): string[] {
  return String(model || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function hasStrongVariantHint(model: string): boolean {
  const raw = String(model || '').toLowerCase();
  if (/\b(19|20)\d{2}\b/.test(raw)) return true;
  if (/\b(gen|g)\s?\d+\b/.test(raw)) return true;
  if (/\b(intel|amd|ryzen|core|m\d|i[3579])\b/.test(raw)) return true;
  if (/\b[a-z]{1,4}\d{3,5}[a-z]{0,3}\b/.test(raw)) return true;
  return false;
}

function isBroadFamilyModel(model: string): boolean {
  const normalized = String(model || '').trim().toLowerCase();
  if (!normalized) return true;
  const tokens = normalizeModelTokenList(normalized);
  if (tokens.length <= 1) return true;
  const familyWords = new Set(['pro', 'air', 'plus', 'max', 'mini', 'series', 'family', 'laserjet', 'thinkpad', 'macbook', 'catalyst']);
  const nonFamilyTokens = tokens.filter((token) => !familyWords.has(token));
  if (!hasStrongVariantHint(normalized) && nonFamilyTokens.length <= 1) return true;
  return false;
}

function parseSeedRegistryRows(rows: Record<string, string>[]): SourceRegistryRow[] {
  return rows
    .map((row) => {
      const sourceDomain = normalizeDomain(row.sourceDomain || row.trustedDomain || row.domain || '');
      const sourceUrl = sanitizeUrl(row.sourceUrl || '');
      const assetType = normalizeAssetType(row.assetType || '*');
      const brand = String(row.brand || '*').trim();
      if (!sourceDomain || !brand) return null;
      return {
        assetType: assetType || '*',
        brand,
        sourceDomain,
        sourceUrl,
        sourceType: String(row.sourceType || 'manufacturer').trim().toLowerCase() || 'manufacturer',
        sourceStyle: classifySourceStyle(
          String(row.sourceType || 'manufacturer'),
          String(row.sourceUrl || ''),
          String(row.notes || ''),
        ),
        trustLevel: mapTrustLevel(row.trustLevel || row.trust || 'high'),
        notes: String(row.notes || '').trim(),
      } satisfies SourceRegistryRow;
    })
    .filter((row): row is SourceRegistryRow => Boolean(row));
}

function loadFallbackRegistryFromSpecSources(): SourceRegistryRow[] {
  const rows: SourceRegistryRow[] = [];
  for (const source of listSpecSources()) {
    for (const domain of source.trustedDomains || []) {
      const normalizedDomain = normalizeDomain(domain);
      if (!normalizedDomain) continue;
      const brands = (source.brandMatchers || []).length ? source.brandMatchers : ['*'];
      const assetTypes = (source.assetTypeMatchers || []).length ? source.assetTypeMatchers : ['*'];
      for (const brand of brands) {
        for (const assetType of assetTypes) {
          rows.push({
            assetType: assetType === '*' ? '*' : normalizeAssetType(assetType),
            brand: String(brand || '*').trim(),
            sourceDomain: normalizedDomain,
            sourceUrl: '',
            sourceType: source.sourceType || 'manufacturer',
            sourceStyle: classifySourceStyle(source.sourceType || 'manufacturer', '', source.sourceKey || ''),
            trustLevel: source.priority >= 98 ? 'high' : source.priority >= 90 ? 'medium' : 'low',
            notes: `fallback:${source.sourceKey}`,
          });
        }
      }
    }
  }
  return rows;
}

let registryCache: { rows: SourceRegistryRow[]; loadedAt: number } = { rows: [], loadedAt: 0 };

function loadTrustedSourceRegistry(): SourceRegistryRow[] {
  const now = Date.now();
  if (registryCache.rows.length && (now - registryCache.loadedAt) < 5 * 60 * 1000) {
    return registryCache.rows;
  }

  const seedRows = parseSeedRegistryRows(parseCsvRows(REGISTRY_SEED_PATH));
  const templateRows = parseSeedRegistryRows(parseCsvRows(REGISTRY_TEMPLATE_PATH));
  const combined = [...seedRows, ...templateRows];
  const rows = combined.length ? combined : loadFallbackRegistryFromSpecSources();

  const unique = new Map<string, SourceRegistryRow>();
  rows.forEach((row) => {
    const key = `${row.assetType}|${normalizeToken(row.brand)}|${row.sourceDomain}|${row.sourceType}`;
    if (!unique.has(key)) unique.set(key, row);
  });
  registryCache = { rows: Array.from(unique.values()), loadedAt: now };
  return registryCache.rows;
}

function isDomainTrusted(domain: string, trustedDomains: string[]): boolean {
  const normalized = normalizeDomain(domain);
  return trustedDomains.some((trusted) => {
    const safeTrusted = normalizeDomain(trusted);
    return normalized === safeTrusted || normalized.endsWith(`.${safeTrusted}`);
  });
}

async function ensureCacheFileExists(): Promise<void> {
  await fs.promises.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  if (!fs.existsSync(CACHE_PATH)) {
    await fs.promises.writeFile(CACHE_PATH, '', 'utf8');
  }
}

async function readCacheRows(): Promise<SourceCacheRow[]> {
  await ensureCacheFileExists();
  const content = await fs.promises.readFile(CACHE_PATH, 'utf8');
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rows: SourceCacheRow[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as SourceCacheRow;
      if (parsed && typeof parsed === 'object' && parsed.normalizedKey) {
        rows.push(parsed);
      }
    } catch (_error) {
      // Skip invalid JSONL row.
    }
  }
  return rows;
}

async function appendCacheRow(row: SourceCacheRow): Promise<void> {
  await ensureCacheFileExists();
  await fs.promises.appendFile(CACHE_PATH, `${JSON.stringify(row)}\n`, 'utf8');
}

function pickBestCacheRow(rows: SourceCacheRow[], normalizedKeyValue: string): SourceCacheRow | null {
  const matches = rows
    .filter((row) => String(row.normalizedKey || '').trim() === normalizedKeyValue)
    .sort((a, b) => new Date(b.fetchedAt || 0).getTime() - new Date(a.fetchedAt || 0).getTime());
  if (!matches.length) return null;
  return matches[0];
}

function isCacheRowFresh(row: SourceCacheRow): boolean {
  const expiresAtMs = new Date(row.expiresAt || 0).getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) return false;
  return Date.now() < expiresAtMs;
}

function buildQueries(brand: string, model: string, trustedDomains: string[]): string[] {
  const keywords = [
    'specs',
    'specifications',
    '"technical specifications"',
    'datasheet',
    'manual',
    'support',
    'quickspecs',
    '"product specifications"',
  ];
  const domains = trustedDomains.slice(0, 3);
  const queries: string[] = [];
  for (const domain of domains) {
    for (const keyword of keywords) {
      queries.push(`site:${domain} "${brand} ${model}" ${keyword}`);
    }
  }
  return Array.from(new Set(queries)).slice(0, 12);
}

function buildSearchParams(query: string, config: LookupConfig): URLSearchParams {
  const params = new URLSearchParams();
  params.set('engine', 'google');
  params.set('q', query);
  params.set('num', String(config.maxResults));
  params.set('api_key', config.apiKey);
  return params;
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function candidateTextScore(text: string, brandNorm: string, modelNorm: string): number {
  const lowered = String(text || '').toLowerCase();
  const normalized = normalizeToken(lowered);
  let score = 0;
  if (brandNorm && normalized.includes(brandNorm)) score += 10;
  if (modelNorm && normalized.includes(modelNorm)) score += 40;
  if (brandNorm && modelNorm && normalized.includes(`${brandNorm}${modelNorm}`)) score += 20;
  const keywordHits = ['spec', 'specification', 'datasheet', 'manual', 'quickspec', 'psref', 'support', 'userguide', 'download']
    .reduce((total, kw) => total + (normalized.includes(kw) ? 1 : 0), 0);
  score += keywordHits * 5;
  if (
    lowered.includes('/shop')
    || lowered.includes('/store')
    || lowered.includes('/cart')
    || lowered.includes('/configurator')
    || lowered.includes('buy')
  ) {
    score -= 20;
  }
  if (
    lowered.includes('/discussion')
    || lowered.includes('/community')
    || lowered.includes('community.')
    || lowered.includes('forum')
    || lowered.includes('/forums')
  ) {
    score -= 24;
  }
  if (normalized.includes('forum') || normalized.includes('reddit') || normalized.includes('amazon') || normalized.includes('ebay') || normalized.includes('wikipedia')) {
    score -= 25;
  }
  return score;
}

function candidateUrlIntentScore(url: string): number {
  const lowered = String(url || '').toLowerCase();
  let score = 0;
  if (/(spec|specification|datasheet|manual|user-guide|download|support|psref|quickspec)/.test(lowered)) score += 24;
  if (/(catalog|resources)/.test(lowered)) score += 8;
  if (/(shop|store|buy|cart|checkout|product-list|category)/.test(lowered)) score -= 18;
  if (/(discussion|community|forum|answers|threads)/.test(lowered)) score -= 22;
  return score;
}

function pickQueryDomains(scopedRows: SourceRegistryRow[], maxDomains = 3): string[] {
  const seen = new Set<string>();
  const rankedRows = [...scopedRows].sort((a, b) => {
    const trustRank = (row: SourceRegistryRow) => (row.trustLevel === 'high' ? 3 : row.trustLevel === 'medium' ? 2 : 1);
    const trustDiff = trustRank(b) - trustRank(a);
    if (trustDiff !== 0) return trustDiff;
    return sourceStyleWeight(b.sourceStyle) - sourceStyleWeight(a.sourceStyle);
  });
  const domains: string[] = [];
  for (const row of rankedRows) {
    const domain = normalizeDomain(row.sourceDomain);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    domains.push(domain);
    if (domains.length >= maxDomains) break;
  }
  return domains;
}

function rankCandidates(
  candidates: SearchCandidate[],
  trustedRows: SourceRegistryRow[],
  brand: string,
  model: string,
): SearchCandidate[] {
  const brandNorm = normalizeBrandInput(brand, model);
  const modelNorm = normalizeToken(model);
  const trustByDomain = new Map<string, number>();
  const styleByDomain = new Map<string, SourceStyle>();
  const trustLevelByDomain = new Map<string, 'high' | 'medium' | 'low'>();
  trustedRows.forEach((row) => {
    const trust = row.trustLevel === 'high' ? 22 : row.trustLevel === 'medium' ? 12 : 6;
    trustByDomain.set(row.sourceDomain, Math.max(trustByDomain.get(row.sourceDomain) || 0, trust));
    styleByDomain.set(row.sourceDomain, row.sourceStyle);
    trustLevelByDomain.set(row.sourceDomain, row.trustLevel);
  });

  return candidates
    .map((candidate) => {
      const trust = trustByDomain.get(candidate.domain) || 0;
      const sourceStyle = styleByDomain.get(candidate.domain) || 'official_support';
      const trustLevel = trustLevelByDomain.get(candidate.domain) || 'medium';
      const textScore = candidateTextScore(`${candidate.title} ${candidate.snippet} ${candidate.url}`, brandNorm, modelNorm);
      const intentScore = candidateUrlIntentScore(candidate.url);
      const styleScore = sourceStyleWeight(sourceStyle);
      const finalScore = candidate.score + trust + textScore + intentScore + styleScore;
      return {
        ...candidate,
        sourceStyle,
        trustLevel,
        score: finalScore,
        reason: `trust=${trust} style=${sourceStyle} text=${textScore} intent=${intentScore}`,
      };
    })
    .sort((a, b) => b.score - a.score);
}

function stripHtmlToText(input: string): string {
  return String(input || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreModelTokenCoverage(model: string, text: string): number {
  const tokens = normalizeModelTokenList(model);
  if (!tokens.length) return 0;
  const haystack = normalizeToken(text);
  const matched = tokens.filter((token) => haystack.includes(normalizeToken(token)));
  return matched.length / tokens.length;
}

function hasSufficientReadableText(text: string): boolean {
  const trimmed = String(text || '').trim();
  if (trimmed.length < 400) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length >= 70;
}

function hasSpecSignal(text: string): boolean {
  const lowered = String(text || '').toLowerCase();
  return /(specification|specs|datasheet|manual|user guide|technical|processor|memory|storage|display|ports|dimensions|warranty)/.test(lowered);
}

function fallbackExtractSpecsFromText(params: {
  assetType: string;
  text: string;
  expectedFields: string[];
}): Record<string, string> {
  const sourceText = String(params.text || '');
  const lowered = sourceText.toLowerCase();
  const expected = new Set(params.expectedFields.map((field) => normalizeToken(field)));
  const allow = (field: string) => expected.size === 0 || expected.has(normalizeToken(field));
  const out: Record<string, string> = {};

  const pick = (field: string, regex: RegExp, transform?: (match: RegExpMatchArray) => string) => {
    if (!allow(field) || out[field]) return;
    const match = sourceText.match(regex);
    if (!match) return;
    const value = transform ? transform(match) : match[0].trim();
    if (value) out[field] = value;
  };

  pick('Memory', /\b(?:ram|memory)\b[^0-9]{0,20}(\d+\s?(?:gb|tb))/i, (m) => m[1].toUpperCase().replace(/\s+/g, ''));
  pick('Storage', /\b(?:storage|ssd|hdd)\b[^0-9]{0,24}(\d+\s?(?:gb|tb))/i, (m) => m[1].toUpperCase().replace(/\s+/g, ''));
  pick('Processor/Chip', /\b(?:processor|cpu|chip)\b[^.;\n]{0,64}/i);
  pick('Display', /\b\d{2}(?:\.\d)?\s?(?:inch|in|\"|”)\b[^.;\n]{0,40}/i);

  if (allow('OS')) {
    if (lowered.includes('macos')) out.OS = 'macOS';
    else if (lowered.includes('windows')) {
      const match = sourceText.match(/windows\s+\d+(?:\s+(?:pro|home|enterprise))?/i);
      out.OS = match ? match[0] : 'Windows';
    } else if (lowered.includes('linux')) out.OS = 'Linux';
  }

  pick('Ports', /\b(?:ports?|interfaces?|rj-45|usb|hdmi|displayport)\b[^.;\n]{0,96}/i);
  pick('Input Ports', /\b(?:ports?|interfaces?|rj-45|usb|hdmi|displayport)\b[^.;\n]{0,96}/i);
  pick('Connectivity', /\b(?:wifi|wi-fi|bluetooth|ethernet|usb|hdmi|displayport|rj-45)\b[^.;\n]{0,96}/i);
  pick('Throughput', /\b(?:throughput|bandwidth|speed)\b[^.;\n]{0,72}/i);
  pick('Firmware Version', /\b(?:firmware(?:\s+version)?|software version)\b[^.;\n]{0,72}/i);
  pick('PoE Support', /\b(?:poe|power over ethernet)\b[^.;\n]{0,56}/i);

  pick('Print Technology', /\b(?:print technology|laser|inkjet|thermal)\b[^.;\n]{0,72}/i);
  pick('Color Support', /\b(?:color|monochrome|black and white)\b[^.;\n]{0,56}/i);
  pick('Duplex', /\b(?:duplex|two-sided)\b[^.;\n]{0,56}/i);
  pick('Toner/Ink Type', /\b(?:toner|ink|cartridge)\b[^.;\n]{0,72}/i);
  pick('Page Count', /\b(?:page count|pages?|ppm)\b[^.;\n]{0,72}/i);
  pick('Scan Technology', /\b(?:scan technology|scanner type|cis|ccd)\b[^.;\n]{0,72}/i);
  pick('ADF Support', /\b(?:adf|automatic document feeder)\b[^.;\n]{0,72}/i);
  pick('Resolution', /\b(?:resolution)\b[^.;\n]{0,72}/i);

  const furnitureLike = new Set(['chair', 'desk', 'filing_cabinet', 'whiteboard']);
  if (furnitureLike.has(params.assetType)) {
    pick('Dimensions', /\b(?:dimensions?|size)\b[^.;\n]{0,72}/i);
    pick('Material', /\b(?:material|frame|mesh|fabric|wood|steel)\b[^.;\n]{0,64}/i);
    pick('Frame Type', /\b(?:frame type|frame)\b[^.;\n]{0,64}/i);
    pick('Weight Capacity', /\b(?:weight capacity|supports up to|max load)\b[^.;\n]{0,64}/i);
    if (allow('Condition') && !out.Condition) out.Condition = 'Pending inspection';
  }

  return out;
}

async function fetchSourceText(
  url: string,
  config: LookupConfig,
  timeoutMs: number,
): Promise<{ text: string; contentHash: string; warning?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Fetch failed (${response.status})`);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('pdf')) {
      return { text: '', contentHash: '', warning: 'PDF source fetching is not supported in this phase.' };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const sliced = buffer.subarray(0, config.maxFetchBytes);
    const contentHash = crypto.createHash('sha256').update(sliced).digest('hex');
    const rawText = sliced.toString('utf8');
    const text = stripHtmlToText(rawText);
    return { text, contentHash };
  } finally {
    clearTimeout(timer);
  }
}

async function callSourceExtractionAI(payload: {
  assetType: string;
  brand: string;
  model: string;
  sourceUrl: string;
  sourceDomain: string;
  sourceText: string;
  expectedFields?: string[];
  notApplicableFields?: string[];
}, timeoutMs: number): Promise<{
  normalizedSpecs: Record<string, string>;
  specsText: string;
  confidence: number;
  extractedFields: string[];
  missingImportantFields: string[];
  warnings: string[];
  evidenceReason: string;
  exactModelMatched: boolean;
} | null> {
  const baseUrl = String(process.env.INVENTORY_AI_SERVICE_URL || 'http://inventory-ai-service:8000').trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/extract-asset-specs-from-source`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const parsed = await response.json();
    return {
      normalizedSpecs: (parsed?.normalizedSpecs && typeof parsed.normalizedSpecs === 'object') ? parsed.normalizedSpecs : {},
      specsText: String(parsed?.specsText || ''),
      confidence: clampNumber(parsed?.confidence, 0, 1),
      extractedFields: Array.isArray(parsed?.extractedFields) ? parsed.extractedFields.map(String) : [],
      missingImportantFields: Array.isArray(parsed?.missingImportantFields) ? parsed.missingImportantFields.map(String) : [],
      warnings: Array.isArray(parsed?.warnings) ? parsed.warnings.map(String) : [],
      evidenceReason: String(parsed?.evidenceReason || ''),
      exactModelMatched: Boolean(parsed?.exactModelMatched),
    };
  } catch (_error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function computeEvidenceStatus(params: {
  exactModelMatched: boolean;
  confidence: number;
  broadFamilyInput: boolean;
  coverageScore: number;
}): {
  evidenceStatus: 'source_backed' | 'source_candidate_or_family_level' | 'insufficient_source_evidence';
  requiresReview: boolean;
} {
  const { exactModelMatched, confidence, broadFamilyInput, coverageScore } = params;
  if (exactModelMatched && confidence >= 0.72 && !broadFamilyInput && coverageScore >= 0.75) {
    return { evidenceStatus: 'source_backed', requiresReview: confidence < 0.85 };
  }
  if (exactModelMatched || coverageScore >= 0.45) {
    return { evidenceStatus: 'source_candidate_or_family_level', requiresReview: true };
  }
  return { evidenceStatus: 'insufficient_source_evidence', requiresReview: true };
}

function toPreviewCandidate(
  candidate: SearchCandidate,
  extractionAttempted = false,
  extractionFailedReason = '',
) {
  return {
    url: candidate.url,
    domain: candidate.domain,
    title: candidate.title,
    score: Number(candidate.score.toFixed(2)),
    reason: candidate.reason,
    extractionAttempted,
    ...(extractionFailedReason ? { extractionFailedReason } : {}),
  };
}

export async function lookupTrustedSourceSpecs(input: SourceLookupInput): Promise<SourceLookupResult> {
  const assetType = normalizeAssetType(input.assetType);
  const brand = String(input.brand || '').trim();
  const model = String(input.model || '').trim();
  const forceRefresh = Boolean(input.forceRefresh);
  const allowLiveLookup = input.allowLiveLookup !== false;
  const broadFamilyInput = isBroadFamilyModel(model);
  const key = normalizeKey(assetType, brand, model);
  const config = getLookupConfig();
  const startedAt = Date.now();
  const deadlineAt = startedAt + config.totalLookupTimeoutMs;
  const timeRemainingMs = () => Math.max(0, deadlineAt - Date.now());
  const deadlineExceeded = () => timeRemainingMs() <= 0;
  const warnings: string[] = [];
  const profile = getAssetTypeSpecProfile(assetType);
  const expectedFields = Array.isArray(profile?.expectedSpecFields) ? profile?.expectedSpecFields : [];
  const notApplicableFields = Array.isArray(profile?.notApplicableFields) ? profile?.notApplicableFields : [];
  if (broadFamilyInput) {
    warnings.push('Model input appears broad/family-level. Provide generation/year/SKU for stronger exact source matching.');
  }

  if (!assetType || !brand || !model) {
    return {
      success: false,
      cacheHit: false,
      sourceType: 'none',
      sourceUrl: '',
      sourceDomain: '',
      specsText: '',
      normalizedSpecs: {},
      confidence: 0.3,
      evidenceStatus: 'llm_or_heuristic_only',
      evidenceReason: 'Asset type, brand, and model are required for trusted source lookup.',
      requiresReview: true,
      warnings: ['Missing required lookup input fields.'],
      candidates: [],
      exactModelMatched: false,
      lookupMode: 'input_validation_failed',
      message: 'Asset type, brand, and model are required.',
    };
  }

  const cachedRows = await readCacheRows();
  const cached = pickBestCacheRow(cachedRows, key);
  if (config.cacheEnabled && cached && !forceRefresh && isCacheRowFresh(cached)) {
    return {
      success: true,
      cacheHit: true,
      sourceType: 'source_lookup_cache',
      sourceUrl: String(cached.sourceUrl || ''),
      sourceDomain: String(cached.sourceDomain || ''),
      specsText: String(cached.specsText || ''),
      normalizedSpecs: (cached.normalizedSpecs && typeof cached.normalizedSpecs === 'object') ? cached.normalizedSpecs : {},
      confidence: clampNumber(cached.confidence, 0, 1),
      evidenceStatus: (
        String(cached.evidenceStatus || '') === 'source_backed'
          ? 'source_backed'
          : String(cached.evidenceStatus || '') === 'source_candidate_or_family_level'
            ? 'source_candidate_or_family_level'
            : 'insufficient_source_evidence'
      ),
      evidenceReason: String(cached.evidenceStatus || '') === 'source_backed'
        ? 'Using cached source-backed specs.'
        : 'Using cached trusted-source candidate specs (manual verification still recommended).',
      requiresReview: cached.requiresReview ?? (!cached.exactModelMatched || clampNumber(cached.confidence, 0, 1) < 0.85),
      warnings: Array.isArray(cached.warnings) ? cached.warnings : [],
      candidates: [],
      exactModelMatched: Boolean(cached.exactModelMatched),
      lookupMode: 'source_lookup_cache_hit',
      message: 'Using cached source lookup result.',
    };
  }

  if (!allowLiveLookup) {
    return {
      success: false,
      cacheHit: false,
      sourceType: 'none',
      sourceUrl: '',
      sourceDomain: '',
      specsText: '',
      normalizedSpecs: {},
      confidence: 0.35,
      evidenceStatus: 'insufficient_source_evidence',
      evidenceReason: 'No cached trusted source specs found for this exact asset model.',
      requiresReview: true,
      warnings: ['Live trusted source lookup is disabled for this request mode (cache_only).'],
      candidates: [],
      exactModelMatched: false,
      lookupMode: 'source_lookup_cache_miss',
      message: 'No cached trusted source result was found.',
    };
  }

  if (!config.enabled) {
    return {
      success: false,
      cacheHit: false,
      sourceType: 'none',
      sourceUrl: '',
      sourceDomain: '',
      specsText: '',
      normalizedSpecs: {},
      confidence: 0.35,
      evidenceStatus: 'llm_or_heuristic_only',
      evidenceReason: 'Trusted source lookup is disabled by configuration.',
      requiresReview: true,
      warnings: ['SPEC_LOOKUP_ENABLED=false'],
      candidates: [],
      exactModelMatched: false,
      lookupMode: 'source_lookup_disabled',
      message: 'Trusted source lookup is disabled.',
    };
  }

  if (!config.apiKey) {
    return {
      success: false,
      cacheHit: false,
      sourceType: 'none',
      sourceUrl: '',
      sourceDomain: '',
      specsText: '',
      normalizedSpecs: {},
      confidence: 0.35,
      evidenceStatus: 'llm_or_heuristic_only',
      evidenceReason: 'SERPAPI_API_KEY is missing for live trusted source lookup.',
      requiresReview: true,
      warnings: ['SERPAPI_API_KEY is not configured'],
      candidates: [],
      exactModelMatched: false,
      lookupMode: 'source_lookup_key_missing',
      message: 'Trusted source lookup is enabled but SerpAPI key is missing.',
    };
  }

  const registryRows = loadTrustedSourceRegistry();
  const normalizedBrand = normalizeBrandInput(brand, model);
  const scopedRows = registryRows.filter((row) => {
    const assetTypeMatch = row.assetType === '*' || row.assetType === assetType;
    const rowBrandNorm = normalizeToken(row.brand);
    const brandMatch = rowBrandNorm === '*' || rowBrandNorm === normalizedBrand || normalizeToken(brand) === rowBrandNorm;
    return assetTypeMatch && brandMatch;
  });

  const trustedDomains = Array.from(new Set(scopedRows.map((row) => row.sourceDomain).filter(Boolean)));
  if (!trustedDomains.length) {
    return {
      success: false,
      cacheHit: false,
      sourceType: 'none',
      sourceUrl: '',
      sourceDomain: '',
      specsText: '',
      normalizedSpecs: {},
      confidence: 0.35,
      evidenceStatus: 'llm_or_heuristic_only',
      evidenceReason: 'No trusted registry source domains found for this asset type/brand.',
      requiresReview: true,
      warnings: ['Trusted source registry has no matching domain.'],
      candidates: [],
      exactModelMatched: false,
      lookupMode: 'source_registry_miss',
      message: 'No trusted source domains are configured for this asset type and brand.',
    };
  }

  const queryDomains = pickQueryDomains(scopedRows, 3);
  const queries = buildQueries(brand, model, queryDomains.length ? queryDomains : trustedDomains);
  const rawCandidates: SearchCandidate[] = [];
  for (const query of queries) {
    if (deadlineExceeded()) {
      warnings.push('Lookup timed out while searching candidate sources.');
      break;
    }
    try {
      const url = `${config.endpoint}?${buildSearchParams(query, config).toString()}`;
      const payload = await fetchJsonWithTimeout(url, Math.min(config.searchTimeoutMs, Math.max(1000, timeRemainingMs())));
      const organic = Array.isArray(payload?.organic_results) ? payload.organic_results : [];
      organic.forEach((entry: any) => {
        const link = sanitizeUrl(String(entry?.link || entry?.url || ''));
        if (!link) return;
        const domain = normalizeDomain(new URL(link).hostname);
        if (!domain) return;
        if (config.allowedDomainsOnly && !isDomainTrusted(domain, trustedDomains)) return;
        rawCandidates.push({
          title: String(entry?.title || '').trim(),
          snippet: String(entry?.snippet || '').trim(),
          url: link,
          domain,
          score: 0,
          reason: 'search-result',
          sourceStyle: 'official_support',
          trustLevel: 'medium',
        });
      });
      if (rawCandidates.length >= config.maxResults) break;
    } catch (error: any) {
      warnings.push(`Search query failed: ${error.message}`);
    }
  }

  const deduped = new Map<string, SearchCandidate>();
  rawCandidates.forEach((candidate) => {
    if (!deduped.has(candidate.url)) deduped.set(candidate.url, candidate);
  });
  const rankedCandidates = rankCandidates(Array.from(deduped.values()), scopedRows, brand, model).slice(0, config.maxResults);
  if (!rankedCandidates.length) {
    return {
      success: false,
      cacheHit: false,
      sourceType: 'none',
      sourceUrl: '',
      sourceDomain: '',
      specsText: '',
      normalizedSpecs: {},
      confidence: 0.35,
      evidenceStatus: 'llm_or_heuristic_only',
      evidenceReason: 'No trusted source candidates were found.',
      requiresReview: true,
      warnings,
      candidates: [],
      exactModelMatched: false,
      lookupMode: 'trusted_search_no_candidates',
      message: 'No trusted source candidates were found.',
    };
  }

  const candidateReports: Array<{ candidate: SearchCandidate; attempted: boolean; failureReason: string }> = [];
  for (const candidate of rankedCandidates.slice(0, Math.min(4, rankedCandidates.length))) {
    if (deadlineExceeded()) {
      warnings.push('Lookup timed out before candidate extraction could complete.');
      break;
    }
    let extractionAttempted = false;
    let extractionFailedReason = '';
    try {
      const fetchBudget = Math.min(config.fetchTimeoutMs, Math.max(1000, timeRemainingMs()));
      const fetched = await fetchSourceText(candidate.url, config, fetchBudget);
      console.info(
        `[SourceLookup] candidate domain=${candidate.domain} style=${candidate.sourceStyle} score=${candidate.score.toFixed(1)} textLen=${fetched.text.length}`,
      );
      if (fetched.warning) warnings.push(fetched.warning);
      if (!fetched.text) {
        extractionFailedReason = 'Fetched content was empty.';
        candidateReports.push({ candidate, attempted: extractionAttempted, failureReason: extractionFailedReason });
        continue;
      }
      if (!hasSufficientReadableText(fetched.text)) {
        extractionFailedReason = `Readable text too short (${fetched.text.length} chars).`;
        candidateReports.push({ candidate, attempted: extractionAttempted, failureReason: extractionFailedReason });
        continue;
      }
      if (!hasSpecSignal(fetched.text)) {
        extractionFailedReason = 'Fetched content did not contain enough specification signals.';
        candidateReports.push({ candidate, attempted: extractionAttempted, failureReason: extractionFailedReason });
        continue;
      }

      extractionAttempted = true;
      const coverageScore = scoreModelTokenCoverage(model, `${candidate.title} ${candidate.snippet} ${candidate.url} ${fetched.text.slice(0, 20000)}`);
      if (coverageScore < 0.35) {
        extractionFailedReason = 'Model token coverage was too weak for this source candidate.';
        candidateReports.push({ candidate, attempted: extractionAttempted, failureReason: extractionFailedReason });
        continue;
      }

      const extracted = await callSourceExtractionAI({
        assetType,
        brand,
        model,
        sourceUrl: candidate.url,
        sourceDomain: candidate.domain,
        sourceText: fetched.text,
        expectedFields,
        notApplicableFields,
      }, Math.min(config.extractionTimeoutMs, Math.max(2000, timeRemainingMs())));
      let effectiveExtracted = extracted;
      if (!effectiveExtracted || !Object.keys(effectiveExtracted.normalizedSpecs || {}).length) {
        const fallbackSpecs = fallbackExtractSpecsFromText({
          assetType,
          text: fetched.text,
          expectedFields,
        });
        if (Object.keys(fallbackSpecs).length > 0) {
          effectiveExtracted = {
            normalizedSpecs: fallbackSpecs,
            specsText: Object.entries(fallbackSpecs).map(([field, value]) => `${field}: ${value}`).join('\n'),
            confidence: 0.58,
            extractedFields: Object.keys(fallbackSpecs),
            missingImportantFields: [],
            warnings: ['Used deterministic extraction fallback because LLM extraction was unavailable/empty.'],
            evidenceReason: 'Deterministic extraction from trusted source text.',
            exactModelMatched: coverageScore >= 0.75 && !broadFamilyInput,
          };
        }
      }
      if (!effectiveExtracted || !Object.keys(effectiveExtracted.normalizedSpecs || {}).length) {
        extractionFailedReason = `No usable specs extracted from ${candidate.domain}`;
        warnings.push(extractionFailedReason);
        candidateReports.push({ candidate, attempted: extractionAttempted, failureReason: extractionFailedReason });
        continue;
      }

      const confidence = clampNumber(effectiveExtracted.confidence, 0.35, 0.95);
      const effectiveCoverage = scoreModelTokenCoverage(model, `${candidate.title} ${candidate.snippet} ${candidate.url} ${effectiveExtracted.specsText}`);
      const { evidenceStatus, requiresReview } = computeEvidenceStatus({
        exactModelMatched: effectiveExtracted.exactModelMatched,
        confidence,
        broadFamilyInput,
        coverageScore: effectiveCoverage,
      });
      const sourceType = scopedRows.find((row) => row.sourceDomain === candidate.domain)?.sourceType || 'manufacturer';
      const fetchedAt = new Date();
      const expiresAt = new Date(fetchedAt.getTime() + config.cacheTtlDays * 24 * 60 * 60 * 1000);
      const specsText = String(effectiveExtracted.specsText || '').trim();
      const effectiveSpecsText = specsText || Object.entries(effectiveExtracted.normalizedSpecs)
        .map(([field, value]) => `${field}: ${value}`)
        .join('\n');

      const shouldCache = config.cacheEnabled && (
        evidenceStatus === 'source_backed'
        || (evidenceStatus === 'source_candidate_or_family_level' && confidence >= 0.55)
      );
      if (shouldCache) {
        const cacheRow: SourceCacheRow = {
          brand,
          model,
          assetType,
          normalizedKey: key,
          specsText: effectiveSpecsText,
          normalizedSpecs: effectiveExtracted.normalizedSpecs,
          sourceUrl: candidate.url,
          sourceDomain: candidate.domain,
          sourceType,
          confidence,
          evidenceStatus,
          exactModelMatched: Boolean(effectiveExtracted.exactModelMatched),
          requiresReview,
          contentHash: fetched.contentHash,
          fetchedAt: fetchedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          warnings: effectiveExtracted.warnings || [],
        };
        await appendCacheRow(cacheRow);
      }
      console.info(
        `[SourceLookup] extraction success domain=${candidate.domain} exact=${Boolean(effectiveExtracted.exactModelMatched)} confidence=${confidence.toFixed(3)} cached=${shouldCache}`,
      );

      return {
        success: true,
        cacheHit: false,
        sourceType: 'trusted_source_lookup',
        sourceUrl: candidate.url,
        sourceDomain: candidate.domain,
        specsText: effectiveSpecsText,
        normalizedSpecs: effectiveExtracted.normalizedSpecs,
        confidence,
        evidenceStatus,
        evidenceReason: effectiveExtracted.evidenceReason || (
          evidenceStatus === 'source_backed'
            ? 'Specs extracted from trusted source content.'
            : 'Trusted source candidate was found but exact model evidence is limited.'
        ),
        requiresReview,
        warnings: [...warnings, ...(effectiveExtracted.warnings || [])],
        candidates: [
          ...candidateReports.map((entry) => toPreviewCandidate(entry.candidate, entry.attempted, entry.failureReason)),
          toPreviewCandidate(candidate, true, ''),
        ],
        exactModelMatched: Boolean(effectiveExtracted.exactModelMatched),
        lookupMode: evidenceStatus === 'source_backed'
          ? 'trusted_source_live_lookup_exact'
          : 'trusted_source_live_lookup_family',
        message: evidenceStatus === 'source_backed'
          ? 'Trusted source-backed specifications extracted successfully.'
          : 'Trusted sources were found, but evidence is family-level or partial; manual review is required.',
      };
    } catch (error: any) {
      extractionFailedReason = `Candidate fetch/extraction failed for ${candidate.domain}: ${error.message}`;
      warnings.push(extractionFailedReason);
      candidateReports.push({ candidate, attempted: extractionAttempted, failureReason: extractionFailedReason });
    }
  }

  return {
    success: false,
    cacheHit: false,
    sourceType: 'none',
    sourceUrl: '',
    sourceDomain: '',
    specsText: '',
    normalizedSpecs: {},
    confidence: 0.35,
    evidenceStatus: 'llm_or_heuristic_only',
    evidenceReason: 'Trusted sources were found, but no exact extractable specifications were confirmed.',
    requiresReview: true,
    warnings,
    candidates: [
      ...candidateReports.map((entry) => toPreviewCandidate(entry.candidate, entry.attempted, entry.failureReason)),
      ...rankedCandidates
        .filter((candidate) => !candidateReports.some((entry) => entry.candidate.url === candidate.url))
        .map((candidate) => toPreviewCandidate(candidate, false, 'Not attempted because higher-ranked candidates failed first.')),
    ],
    exactModelMatched: false,
    lookupMode: 'trusted_source_extraction_failed',
    message: deadlineExceeded()
      ? 'Trusted source lookup reached the maximum time budget before extraction completed.'
      : 'Trusted sources were found, but no exact extractable specifications were confirmed.',
  };
}

export function getSourceLookupCachePath(): string {
  return CACHE_PATH;
}


