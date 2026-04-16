export const BUILDINGS = [
  'Central Warehouse',
  'Main Building',
  'K Building',
  'N Building',
  'S Building',
  'R Building',
  'Pharmacy Building',
] as const;

export const DEPARTMENTS = [
  'Computer Science',
  'Engineering',
  'Architecture',
  'Business',
  'Mass Comm',
  'Alsun',
  'Pharmacy',
  'Dentistry',
  'Unassigned',
  'General',
] as const;

type AssetTypeOption = { value: string; label: string };

const toLabel = (value: string): string => {
  if (value === '3d_printer') return '3D Printer';
  return value
    .split('_')
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join(' ');
};

// The frontend expects [{ value, label }]
export const ASSET_TYPES: AssetTypeOption[] = [
  'laptop',
  'desktop',
  'tablet',
  'server',
  'monitor',
  'peripheral',
  'keyboard',
  'electronics',
  'projector',
  'smartboard',
  'camera',
  'speaker',
  'microphone',
  'router',
  'switch',
  'access_point',
  'firewall',
  'printer',
  'scanner',
  'desk',
  'chair',
  'whiteboard',
  'filing_cabinet',
  'furniture',
  'microscope',
  'centrifuge',
  'oscilloscope',
  '3d_printer',
  'lab_bench',
  'vehicle',
  'generator',
  'hvac',
  'maintenance_tool',
].map((value) => ({ value, label: toLabel(value) }));

export const EOL_METRICS: Record<string, { years: number; cost: number }> = {
  default: { years: 5, cost: 500 },
  laptop: { years: 4, cost: 1200 },
  desktop: { years: 5, cost: 900 },
  server: { years: 6, cost: 4000 },
  monitor: { years: 5, cost: 350 },
  printer: { years: 6, cost: 600 },
  projector: { years: 6, cost: 800 },
  router: { years: 5, cost: 500 },
  switch: { years: 5, cost: 700 },
};

