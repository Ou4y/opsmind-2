import crypto from 'crypto';

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortObject(item));
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort((a, b) => a.localeCompare(b));
    const sorted: Record<string, unknown> = {};
    for (const key of keys) {
      sorted[key] = sortObject(record[key]);
    }
    return sorted;
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

export function sha256(value: unknown): string {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}
