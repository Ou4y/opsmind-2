import { SpecSourceDefinition } from './types';

function manufacturerSource(params: {
  sourceKey: string;
  brandMatchers: string[];
  trustedDomains: string[];
  priority: number;
}): SpecSourceDefinition {
  return {
    sourceKey: params.sourceKey,
    sourceType: 'manufacturer',
    brandMatchers: params.brandMatchers,
    assetTypeMatchers: ['*'],
    trustedDomains: params.trustedDomains,
    trustedUrlPatterns: ['/product', '/products', '/support', '/spec', '/manual', '/datasheet'],
    priority: params.priority,
    confidenceBase: 0.92,
    requiresRecencyDays: 3650,
    requiresContentHash: true,
    extractMode: 'html',
    verificationPolicy: 'manual_review_required',
  };
}

export const SPEC_SOURCE_REGISTRY: SpecSourceDefinition[] = [
  manufacturerSource({
    sourceKey: 'manufacturer.dell',
    brandMatchers: ['dell'],
    trustedDomains: ['dell.com', 'delltechnologies.com'],
    priority: 100,
  }),
  manufacturerSource({
    sourceKey: 'manufacturer.hp',
    brandMatchers: ['hp', 'hewlett packard'],
    trustedDomains: ['hp.com', 'support.hp.com'],
    priority: 99,
  }),
  manufacturerSource({
    sourceKey: 'manufacturer.apple',
    brandMatchers: ['apple'],
    trustedDomains: ['apple.com', 'support.apple.com'],
    priority: 100,
  }),
  manufacturerSource({
    sourceKey: 'manufacturer.lenovo',
    brandMatchers: ['lenovo'],
    trustedDomains: ['lenovo.com', 'support.lenovo.com'],
    priority: 99,
  }),
  manufacturerSource({
    sourceKey: 'manufacturer.cisco',
    brandMatchers: ['cisco'],
    trustedDomains: ['cisco.com'],
    priority: 100,
  }),
  manufacturerSource({
    sourceKey: 'manufacturer.ubiquiti',
    brandMatchers: ['ubiquiti'],
    trustedDomains: ['ui.com'],
    priority: 96,
  }),
  manufacturerSource({
    sourceKey: 'manufacturer.tp_link',
    brandMatchers: ['tp-link', 'tplink'],
    trustedDomains: ['tp-link.com'],
    priority: 94,
  }),
  manufacturerSource({
    sourceKey: 'manufacturer.epson',
    brandMatchers: ['epson'],
    trustedDomains: ['epson.com'],
    priority: 95,
  }),
  manufacturerSource({
    sourceKey: 'manufacturer.canon',
    brandMatchers: ['canon'],
    trustedDomains: ['canon.com'],
    priority: 95,
  }),
  manufacturerSource({
    sourceKey: 'manufacturer.brother',
    brandMatchers: ['brother'],
    trustedDomains: ['brother.com'],
    priority: 95,
  }),
  manufacturerSource({
    sourceKey: 'manufacturer.microsoft_surface',
    brandMatchers: ['microsoft', 'surface'],
    trustedDomains: ['microsoft.com'],
    priority: 95,
  }),
  manufacturerSource({
    sourceKey: 'manufacturer.samsung',
    brandMatchers: ['samsung'],
    trustedDomains: ['samsung.com'],
    priority: 95,
  }),
  manufacturerSource({
    sourceKey: 'manufacturer.lg',
    brandMatchers: ['lg'],
    trustedDomains: ['lg.com'],
    priority: 95,
  }),
  manufacturerSource({
    sourceKey: 'manufacturer.benq',
    brandMatchers: ['benq'],
    trustedDomains: ['benq.com'],
    priority: 94,
  }),
  manufacturerSource({
    sourceKey: 'manufacturer.viewsonic',
    brandMatchers: ['viewsonic'],
    trustedDomains: ['viewsonic.com'],
    priority: 94,
  }),
  manufacturerSource({
    sourceKey: 'manufacturer.schneider_apc',
    brandMatchers: ['schneider', 'apc'],
    trustedDomains: ['se.com', 'apc.com'],
    priority: 96,
  }),
  {
    sourceKey: 'internal.vendor_catalog',
    sourceType: 'internal_document',
    brandMatchers: ['*'],
    assetTypeMatchers: ['*'],
    trustedDomains: ['internal.vendor.catalog'],
    trustedUrlPatterns: ['internal://vendor-catalog/*'],
    priority: 90,
    confidenceBase: 0.85,
    requiresContentHash: true,
    extractMode: 'sheet',
    verificationPolicy: 'manual_review_required',
  },
  {
    sourceKey: 'internal.procurement_spreadsheet',
    sourceType: 'internal_document',
    brandMatchers: ['*'],
    assetTypeMatchers: ['*'],
    trustedDomains: ['internal.procurement.spreadsheet'],
    trustedUrlPatterns: ['internal://procurement/*'],
    priority: 88,
    confidenceBase: 0.82,
    requiresContentHash: true,
    extractMode: 'sheet',
    verificationPolicy: 'manual_review_required',
  },
  {
    sourceKey: 'internal.warranty_documents',
    sourceType: 'internal_document',
    brandMatchers: ['*'],
    assetTypeMatchers: ['*'],
    trustedDomains: ['internal.warranty.documents'],
    trustedUrlPatterns: ['internal://warranty/*'],
    priority: 89,
    confidenceBase: 0.8,
    requiresContentHash: true,
    extractMode: 'pdf',
    verificationPolicy: 'manual_review_required',
  },
  {
    sourceKey: 'internal.maintenance_contracts',
    sourceType: 'internal_document',
    brandMatchers: ['*'],
    assetTypeMatchers: ['*'],
    trustedDomains: ['internal.maintenance.contracts'],
    trustedUrlPatterns: ['internal://maintenance-contracts/*'],
    priority: 87,
    confidenceBase: 0.78,
    requiresContentHash: true,
    extractMode: 'pdf',
    verificationPolicy: 'manual_review_required',
  },
  {
    sourceKey: 'cached.verified_specs',
    sourceType: 'cached_verified',
    brandMatchers: ['*'],
    assetTypeMatchers: ['*'],
    trustedDomains: ['inventory.canonical.cache'],
    trustedUrlPatterns: ['canonical://asset-spec-snapshot/*'],
    priority: 98,
    confidenceBase: 0.95,
    requiresContentHash: true,
    extractMode: 'api',
    verificationPolicy: 'auto_if_high_confidence',
  },
  {
    sourceKey: 'manual.override',
    sourceType: 'manual_override',
    brandMatchers: ['*'],
    assetTypeMatchers: ['*'],
    trustedDomains: ['inventory.manual.override'],
    trustedUrlPatterns: ['manual://asset-spec-review/*'],
    priority: 110,
    confidenceBase: 1,
    requiresContentHash: false,
    extractMode: 'api',
    verificationPolicy: 'auto_if_high_confidence',
  },
];

const REGISTRY_BY_KEY = SPEC_SOURCE_REGISTRY.reduce((acc, source) => {
  acc[source.sourceKey] = source;
  return acc;
}, {} as Record<string, SpecSourceDefinition>);

export function listSpecSources(): SpecSourceDefinition[] {
  return SPEC_SOURCE_REGISTRY;
}

export function getSpecSourceDefinition(sourceKey: string): SpecSourceDefinition | null {
  return REGISTRY_BY_KEY[String(sourceKey || '').trim()] || null;
}

export function listTrustedSpecDomains(): string[] {
  const set = new Set<string>();
  for (const source of SPEC_SOURCE_REGISTRY) {
    for (const domain of source.trustedDomains) set.add(domain);
  }
  return Array.from(set).sort();
}
