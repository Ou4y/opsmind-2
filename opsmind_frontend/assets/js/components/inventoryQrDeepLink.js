const DEFAULT_SCAN_PATH = '/assets/scan';
const DEFAULT_INVENTORY_PATH = '/pages/inventory.html';

function cleanValue(value) {
  return String(value || '').trim();
}

function currentOrigin() {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return 'http://localhost';
}

function appBaseUrl(explicitBaseUrl = '') {
  const configured = cleanValue(explicitBaseUrl)
    || (typeof window !== 'undefined' && cleanValue(window.OPSMIND_PUBLIC_APP_URL || window.OPSMIND_APP_URL))
    || currentOrigin();
  return new URL(configured, currentOrigin());
}

export function parseInventoryAssetDeepLink(search = '') {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const candidates = [
    ['assetTag', params.get('assetTag')],
    ['assetId', params.get('assetId')],
    ['openAsset', params.get('openAsset')],
    ['serialNumber', params.get('serialNumber')],
  ];
  const match = candidates.find(([, value]) => cleanValue(value));
  return match ? { lookupType: match[0], lookupValue: cleanValue(match[1]) } : null;
}

export function resolveInventoryAssetDeepLink(assets = [], target = null) {
  if (!target?.lookupType || !target?.lookupValue || !Array.isArray(assets)) return null;
  const wanted = cleanValue(target.lookupValue).toLowerCase();
  const equals = (value) => cleanValue(value).toLowerCase() === wanted;
  const unique = (matches) => matches.length === 1 ? matches[0] : null;
  if (target.lookupType === 'assetTag') return unique(assets.filter((asset) => equals(asset?.assetTag || asset?.asset_tag)));
  if (target.lookupType === 'assetId') return unique(assets.filter((asset) => equals(asset?.customId || asset?.assetId)));
  if (target.lookupType === 'serialNumber') return unique(assets.filter((asset) => equals(asset?.serialNumber || asset?.serial_number)));
  if (target.lookupType === 'openAsset') {
    const idMatch = unique(assets.filter((asset) => equals(asset?.customId || asset?.assetId)));
    return idMatch || unique(assets.filter((asset) => equals(asset?.assetTag || asset?.asset_tag)));
  }
  return null;
}

export function buildInventoryAssetQrUrl(asset = {}, options = {}) {
  const assetTag = cleanValue(asset.assetTag || asset.asset_tag);
  const assetId = cleanValue(asset.customId || asset.assetId);
  if (!assetTag && !assetId) throw new Error('Asset tag or stable asset ID is required for QR generation.');
  const url = new URL(cleanValue(options.scanPath) || DEFAULT_SCAN_PATH, appBaseUrl(options.baseUrl));
  url.searchParams.set(assetTag ? 'assetTag' : 'assetId', assetTag || assetId);
  return url.toString();
}

export function buildAuthenticatedInventoryUrl(target, options = {}) {
  if (!target?.lookupType || !target?.lookupValue) throw new Error('Asset deep-link target is required.');
  const url = new URL(cleanValue(options.inventoryPath) || DEFAULT_INVENTORY_PATH, appBaseUrl(options.baseUrl));
  url.searchParams.set(target.lookupType, cleanValue(target.lookupValue));
  return url.toString();
}
