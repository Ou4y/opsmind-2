import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { lookupTrustedSourceSpecs } from '../src/services/asset-intelligence/sourceLookupService';

dotenv.config();

type WarmupTarget = {
  assetType: string;
  brand: string;
  model: string;
};

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
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
      values.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  values.push(current.trim());
  return values;
}

function readTargets(filePath: string): WarmupTarget[] {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (!lines.length) return [];

  const headers = parseCsvLine(lines[0]).map((value) => value.toLowerCase());
  const idxAssetType = headers.indexOf('assettype');
  const idxBrand = headers.indexOf('brand');
  const idxModel = headers.indexOf('model');
  if (idxAssetType < 0 || idxBrand < 0 || idxModel < 0) {
    return [];
  }

  const targets: WarmupTarget[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const assetType = String(cells[idxAssetType] || '').trim();
    const brand = String(cells[idxBrand] || '').trim();
    const model = String(cells[idxModel] || '').trim();
    if (!assetType || !brand || !model) continue;
    targets.push({ assetType, brand, model });
  }
  return targets;
}

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  if (!raw) return null;
  return raw.slice(prefix.length).trim();
}

async function run() {
  const defaultTargetsPath = path.resolve(__dirname, '../datasets/seed/source_lookup_targets.seed.csv');
  const filePath = parseArg('file') ? path.resolve(parseArg('file') as string) : defaultTargetsPath;
  const maxLookupsRaw = parseArg('max');
  const maxLookups = Math.max(1, Math.min(100, Number(maxLookupsRaw || 10)));
  const forceRefresh = process.argv.includes('--force-refresh');

  const targets = readTargets(filePath);
  if (!targets.length) {
    console.log(`[warmup_source_specs_cache] No targets found in ${filePath}`);
    return;
  }

  const limited = targets.slice(0, maxLookups);
  console.log(`[warmup_source_specs_cache] Loaded ${targets.length} target(s), running ${limited.length} lookup(s).`);
  console.log(`[warmup_source_specs_cache] forceRefresh=${forceRefresh}`);

  let success = 0;
  let cacheHits = 0;
  let failed = 0;

  for (let i = 0; i < limited.length; i += 1) {
    const target = limited[i];
    const label = `${target.assetType} | ${target.brand} | ${target.model}`;
    try {
      const result = await lookupTrustedSourceSpecs({
        assetType: target.assetType,
        brand: target.brand,
        model: target.model,
        forceRefresh,
      });
      if (result.success) {
        success += 1;
        if (result.cacheHit) cacheHits += 1;
        console.log(`[${i + 1}/${limited.length}] OK ${label} :: ${result.cacheHit ? 'cache-hit' : 'live'} :: ${result.sourceDomain || 'no-domain'}`);
      } else {
        failed += 1;
        console.log(`[${i + 1}/${limited.length}] FAIL ${label} :: ${result.evidenceReason}`);
      }
    } catch (error: any) {
      failed += 1;
      console.log(`[${i + 1}/${limited.length}] ERROR ${label} :: ${error?.message || error}`);
    }
  }

  console.log(`[warmup_source_specs_cache] done success=${success} cacheHits=${cacheHits} failed=${failed}`);
}

run().catch((error) => {
  console.error('[warmup_source_specs_cache] fatal error:', error?.message || error);
  process.exitCode = 1;
});
