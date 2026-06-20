export type PublicAssetVerificationSource = {
  assetTag?: unknown;
  type?: unknown;
  category?: unknown;
  location?: unknown;
  department?: unknown;
  status?: unknown;
};

function enumValue(value: unknown): string | null {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

function publicLabel(value: unknown): string | null {
  const normalized = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (!normalized) return null;
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function buildPublicAssetVerification(
  asset: PublicAssetVerificationSource | null,
  requestedAssetTag: string | null = null,
) {
  if (!asset) {
    return {
      registered: false,
      assetTag: requestedAssetTag || null,
      assetType: null,
      category: null,
      location: null,
      building: null,
      department: null,
      generalStatus: null,
    };
  }
  const location = publicLabel(asset.location);
  return {
    registered: true,
    assetTag: String(asset.assetTag || requestedAssetTag || '').trim() || null,
    assetType: enumValue(asset.type),
    category: enumValue(asset.category),
    location,
    building: location,
    department: publicLabel(asset.department),
    generalStatus: enumValue(asset.status),
  };
}

