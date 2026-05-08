export const BUILDINGS = [
  'Central Warehouse', 
  'Main Building', 
  'K Building', 
  'N Building', 
  'S Building', 
  'R Building', 
  'Pharmacy Building'
];

export const DEPARTMENTS = [
  'Computer Science', 
  'Engineering', 
  'Architecture', 
  'Business', 
  'Mass Comm', 
  'Alsun', 
  'Pharmacy', 
  'Dentistry', 
  'Unassigned'
];

export const ASSET_TYPES = [
  // IT & Computing
  { value: 'laptop', label: 'Laptop', category: 'IT & Computing' },
  { value: 'desktop', label: 'Desktop PC', category: 'IT & Computing' },
  { value: 'monitor', label: 'Monitor', category: 'IT & Computing' },
  { value: 'server', label: 'Server', category: 'IT & Computing' },
  { value: 'tablet', label: 'Tablet / iPad', category: 'IT & Computing' },
  { value: 'peripheral', label: 'Peripheral (Keyboard/Mouse)', category: 'IT & Computing' },
  
  // AV & Classroom
  { value: 'projector', label: 'Projector', category: 'AV & Classroom' },
  { value: 'smartboard', label: 'Smartboard', category: 'AV & Classroom' },
  { value: 'camera', label: 'Camera', category: 'AV & Classroom' },
  { value: 'microphone', label: 'Microphone', category: 'AV & Classroom' },
  { value: 'speaker', label: 'Speaker System', category: 'AV & Classroom' },

  // Networking
  { value: 'router', label: 'Router', category: 'Networking' },
  { value: 'switch', label: 'Network Switch', category: 'Networking' },
  { value: 'access_point', label: 'Access Point (WiFi)', category: 'Networking' },
  { value: 'firewall', label: 'Firewall Appliance', category: 'Networking' },

  // Office & Furniture
  { value: 'printer', label: 'Printer', category: 'Office & Furniture' },
  { value: 'scanner', label: 'Scanner', category: 'Office & Furniture' },
  { value: 'desk', label: 'Desk', category: 'Office & Furniture' },
  { value: 'chair', label: 'Chair', category: 'Office & Furniture' },
  { value: 'filing_cabinet', label: 'Filing Cabinet', category: 'Office & Furniture' },
  { value: 'whiteboard', label: 'Whiteboard', category: 'Office & Furniture' },

  // Lab & Research
  { value: 'microscope', label: 'Microscope', category: 'Lab & Research' },
  { value: 'centrifuge', label: 'Centrifuge', category: 'Lab & Research' },
  { value: 'oscilloscope', label: 'Oscilloscope', category: 'Lab & Research' },
  { value: '3d_printer', label: '3D Printer', category: 'Lab & Research' },

  // Facilities
  { value: 'vehicle', label: 'University Vehicle', category: 'Facilities' },
  { value: 'generator', label: 'Generator', category: 'Facilities' },
  { value: 'hvac', label: 'HVAC Unit', category: 'Facilities' },
  { value: 'maintenance_tool', label: 'Power Tool', category: 'Facilities' },
];

export const EOL_METRICS = {
  laptop: { years: 4, cost: 1200 },
  desktop: { years: 5, cost: 900 },
  monitor: { years: 6, cost: 250 },
  server: { years: 7, cost: 5000 },
  tablet: { years: 3, cost: 600 },
  peripheral: { years: 2, cost: 50 },
  
  projector: { years: 5, cost: 800 },
  smartboard: { years: 7, cost: 2500 },
  camera: { years: 5, cost: 1000 },
  microphone: { years: 4, cost: 200 },
  speaker: { years: 6, cost: 300 },
  
  router: { years: 5, cost: 150 },
  switch: { years: 7, cost: 800 },
  access_point: { years: 5, cost: 200 },
  firewall: { years: 6, cost: 1500 },
  
  printer: { years: 5, cost: 400 },
  scanner: { years: 5, cost: 300 },
  desk: { years: 15, cost: 300 },
  chair: { years: 10, cost: 150 },
  filing_cabinet: { years: 20, cost: 200 },
  whiteboard: { years: 10, cost: 100 },
  
  microscope: { years: 10, cost: 1500 },
  centrifuge: { years: 8, cost: 2000 },
  oscilloscope: { years: 10, cost: 3000 },
  '3d_printer': { years: 5, cost: 2500 },
  
  vehicle: { years: 10, cost: 25000 },
  generator: { years: 15, cost: 15000 },
  hvac: { years: 15, cost: 8000 },
  maintenance_tool: { years: 5, cost: 150 },
  
  default: { years: 5, cost: 500 }
};
