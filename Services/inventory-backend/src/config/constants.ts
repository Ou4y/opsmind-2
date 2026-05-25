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

// Keep `value` aligned with supported backend AssetType enum values for compatibility.
export const ASSET_TYPES = [
  // IT / Computer Labs
  { value: 'desktop', label: 'Desktop PC', category: 'IT / Computer Labs', registryKey: 'desktop_pc' },
  { value: 'laptop', label: 'Laptop', category: 'IT / Computer Labs', registryKey: 'laptop' },
  { value: 'server', label: 'Server', category: 'IT / Computer Labs', registryKey: 'server' },
  { value: 'desktop', label: 'Workstation', category: 'IT / Computer Labs', registryKey: 'workstation' },
  { value: 'desktop', label: 'Thin Client', category: 'IT / Computer Labs', registryKey: 'thin_client' },
  { value: 'tablet', label: 'Tablet', category: 'IT / Computer Labs', registryKey: 'tablet' },
  { value: 'tablet', label: 'iPad', category: 'IT / Computer Labs', registryKey: 'ipad' },
  { value: 'monitor', label: 'Monitor', category: 'IT / Computer Labs', registryKey: 'monitor' },
  { value: 'smartboard', label: 'Interactive Display', category: 'IT / Computer Labs', registryKey: 'interactive_display' },
  { value: 'smartboard', label: 'Smartboard', category: 'IT / Computer Labs', registryKey: 'smartboard' },
  { value: 'printer', label: 'Printer', category: 'IT / Computer Labs', registryKey: 'printer' },
  { value: 'scanner', label: 'Scanner', category: 'IT / Computer Labs', registryKey: 'scanner' },
  { value: 'printer', label: 'Photocopier', category: 'IT / Computer Labs', registryKey: 'photocopier' },
  { value: 'projector', label: 'Projector', category: 'IT / Computer Labs', registryKey: 'projector' },
  { value: 'camera', label: 'Document Camera', category: 'IT / Computer Labs', registryKey: 'document_camera' },
  { value: 'peripheral', label: 'External Storage Device', category: 'IT / Computer Labs', registryKey: 'external_storage_device' },
  { value: 'server', label: 'NAS Storage', category: 'IT / Computer Labs', registryKey: 'nas_storage' },
  { value: 'electronics', label: 'UPS', category: 'IT / Computer Labs', registryKey: 'ups' },
  { value: 'electronics', label: 'Network Rack', category: 'IT / Computer Labs', registryKey: 'network_rack' },
  { value: 'router', label: 'Router', category: 'IT / Computer Labs', registryKey: 'router' },
  { value: 'switch', label: 'Network Switch', category: 'IT / Computer Labs', registryKey: 'network_switch' },
  { value: 'access_point', label: 'Access Point', category: 'IT / Computer Labs', registryKey: 'access_point' },
  { value: 'firewall', label: 'Firewall Appliance', category: 'IT / Computer Labs', registryKey: 'firewall_appliance' },
  { value: 'electronics', label: 'IP Phone', category: 'IT / Computer Labs', registryKey: 'ip_phone' },
  { value: 'camera', label: 'CCTV Camera', category: 'IT / Computer Labs', registryKey: 'cctv_camera' },
  { value: 'server', label: 'NVR/DVR', category: 'IT / Computer Labs', registryKey: 'nvr_dvr' },
  { value: 'electronics', label: 'Biometric Attendance Device', category: 'IT / Computer Labs', registryKey: 'biometric_attendance_device' },

  // Classrooms / Lecture Halls
  { value: 'projector', label: 'Projector', category: 'Classrooms / Lecture Halls', registryKey: 'classroom_projector' },
  { value: 'smartboard', label: 'Smartboard', category: 'Classrooms / Lecture Halls', registryKey: 'classroom_smartboard' },
  { value: 'smartboard', label: 'Interactive Display', category: 'Classrooms / Lecture Halls', registryKey: 'classroom_interactive_display' },
  { value: 'speaker', label: 'Speaker System', category: 'Classrooms / Lecture Halls', registryKey: 'speaker_system' },
  { value: 'microphone', label: 'Microphone', category: 'Classrooms / Lecture Halls', registryKey: 'classroom_microphone' },
  { value: 'speaker', label: 'Amplifier', category: 'Classrooms / Lecture Halls', registryKey: 'amplifier' },
  { value: 'furniture', label: 'Podium', category: 'Classrooms / Lecture Halls', registryKey: 'podium' },
  { value: 'camera', label: 'Lecture Capture Device', category: 'Classrooms / Lecture Halls', registryKey: 'lecture_capture_device' },
  { value: 'camera', label: 'Camera', category: 'Classrooms / Lecture Halls', registryKey: 'classroom_camera' },
  { value: 'electronics', label: 'HDMI Matrix/Switcher', category: 'Classrooms / Lecture Halls', registryKey: 'hdmi_matrix_switcher' },
  { value: 'electronics', label: 'Control Panel', category: 'Classrooms / Lecture Halls', registryKey: 'control_panel' },

  // Labs / Engineering / Science
  { value: 'microscope', label: 'Microscope', category: 'Labs / Engineering / Science', registryKey: 'microscope' },
  { value: 'centrifuge', label: 'Centrifuge', category: 'Labs / Engineering / Science', registryKey: 'centrifuge' },
  { value: 'oscilloscope', label: 'Oscilloscope', category: 'Labs / Engineering / Science', registryKey: 'oscilloscope' },
  { value: 'oscilloscope', label: 'Function Generator', category: 'Labs / Engineering / Science', registryKey: 'function_generator' },
  { value: 'maintenance_tool', label: 'Multimeter', category: 'Labs / Engineering / Science', registryKey: 'multimeter' },
  { value: 'maintenance_tool', label: 'Power Supply Unit', category: 'Labs / Engineering / Science', registryKey: 'lab_power_supply_unit' },
  { value: '3d_printer', label: '3D Printer', category: 'Labs / Engineering / Science', registryKey: '3d_printer' },
  { value: 'maintenance_tool', label: 'Laser Cutter', category: 'Labs / Engineering / Science', registryKey: 'laser_cutter' },
  { value: 'maintenance_tool', label: 'CNC Machine', category: 'Labs / Engineering / Science', registryKey: 'cnc_machine' },
  { value: 'desktop', label: 'Lab Computer', category: 'Labs / Engineering / Science', registryKey: 'lab_computer' },
  { value: 'electronics', label: 'Sensor Kit', category: 'Labs / Engineering / Science', registryKey: 'sensor_kit' },
  { value: 'electronics', label: 'Robotics Kit', category: 'Labs / Engineering / Science', registryKey: 'robotics_kit' },
  { value: 'electronics', label: 'Arduino/Raspberry Pi Kit', category: 'Labs / Engineering / Science', registryKey: 'arduino_raspberry_pi_kit' },
  { value: 'furniture', label: 'Chemical Storage Cabinet', category: 'Labs / Engineering / Science', registryKey: 'chemical_storage_cabinet' },
  { value: 'electronics', label: 'Fume Hood', category: 'Labs / Engineering / Science', registryKey: 'fume_hood' },
  { value: 'electronics', label: 'Lab Refrigerator', category: 'Labs / Engineering / Science', registryKey: 'lab_refrigerator' },
  { value: 'electronics', label: 'Incubator', category: 'Labs / Engineering / Science', registryKey: 'incubator' },
  { value: 'electronics', label: 'Autoclave', category: 'Labs / Engineering / Science', registryKey: 'autoclave' },
  { value: 'electronics', label: 'Weighing Scale', category: 'Labs / Engineering / Science', registryKey: 'weighing_scale' },

  // Facilities / Maintenance
  { value: 'hvac', label: 'HVAC Unit', category: 'Facilities / Maintenance', registryKey: 'hvac_unit' },
  { value: 'hvac', label: 'Air Conditioner', category: 'Facilities / Maintenance', registryKey: 'air_conditioner' },
  { value: 'generator', label: 'Generator', category: 'Facilities / Maintenance', registryKey: 'generator' },
  { value: 'electronics', label: 'Elevator', category: 'Facilities / Maintenance', registryKey: 'elevator' },
  { value: 'electronics', label: 'Water Pump', category: 'Facilities / Maintenance', registryKey: 'water_pump' },
  { value: 'electronics', label: 'Fire Extinguisher', category: 'Facilities / Maintenance', registryKey: 'fire_extinguisher' },
  { value: 'electronics', label: 'Fire Alarm Panel', category: 'Facilities / Maintenance', registryKey: 'fire_alarm_panel' },
  { value: 'electronics', label: 'Access Control Panel', category: 'Facilities / Maintenance', registryKey: 'access_control_panel' },
  { value: 'electronics', label: 'Security Gate', category: 'Facilities / Maintenance', registryKey: 'security_gate' },
  { value: 'maintenance_tool', label: 'Tool Kit', category: 'Facilities / Maintenance', registryKey: 'tool_kit' },
  { value: 'maintenance_tool', label: 'Power Tool', category: 'Facilities / Maintenance', registryKey: 'power_tool' },
  { value: 'maintenance_tool', label: 'Cleaning Machine', category: 'Facilities / Maintenance', registryKey: 'cleaning_machine' },

  // Furniture
  { value: 'desk', label: 'Desk', category: 'Furniture', registryKey: 'desk' },
  { value: 'chair', label: 'Chair', category: 'Furniture', registryKey: 'chair' },
  { value: 'filing_cabinet', label: 'Filing Cabinet', category: 'Furniture', registryKey: 'filing_cabinet' },
  { value: 'furniture', label: 'Bookshelf', category: 'Furniture', registryKey: 'bookshelf' },
  { value: 'furniture', label: 'Meeting Table', category: 'Furniture', registryKey: 'meeting_table' },
  { value: 'lab_bench', label: 'Lab Bench', category: 'Furniture', registryKey: 'lab_bench' },
  { value: 'furniture', label: 'Locker', category: 'Furniture', registryKey: 'locker' },
  { value: 'whiteboard', label: 'Whiteboard', category: 'Furniture', registryKey: 'whiteboard' },
  { value: 'whiteboard', label: 'Notice Board', category: 'Furniture', registryKey: 'notice_board' },

  // Library
  { value: 'desktop', label: 'Library PC', category: 'Library', registryKey: 'library_pc' },
  { value: 'scanner', label: 'Barcode Scanner', category: 'Library', registryKey: 'barcode_scanner' },
  { value: 'scanner', label: 'RFID Reader', category: 'Library', registryKey: 'rfid_reader' },
  { value: 'scanner', label: 'Book Scanner', category: 'Library', registryKey: 'book_scanner' },
  { value: 'electronics', label: 'Self-check Machine', category: 'Library', registryKey: 'self_check_machine' },
  { value: 'printer', label: 'Printer', category: 'Library', registryKey: 'library_printer' },
  { value: 'scanner', label: 'Scanner', category: 'Library', registryKey: 'library_scanner' },

  // Medical / Clinic
  { value: 'furniture', label: 'Examination Bed', category: 'Medical / Clinic', registryKey: 'examination_bed' },
  { value: 'electronics', label: 'Blood Pressure Monitor', category: 'Medical / Clinic', registryKey: 'blood_pressure_monitor' },
  { value: 'electronics', label: 'Thermometer', category: 'Medical / Clinic', registryKey: 'thermometer' },
  { value: 'electronics', label: 'First Aid Kit', category: 'Medical / Clinic', registryKey: 'first_aid_kit' },
  { value: 'electronics', label: 'Medical Refrigerator', category: 'Medical / Clinic', registryKey: 'medical_refrigerator' },
  { value: 'furniture', label: 'Wheelchair', category: 'Medical / Clinic', registryKey: 'wheelchair' },

  // Transport
  { value: 'vehicle', label: 'University Vehicle', category: 'Transport', registryKey: 'university_vehicle' },
  { value: 'vehicle', label: 'Golf Cart', category: 'Transport', registryKey: 'golf_cart' },
  { value: 'vehicle', label: 'Bus', category: 'Transport', registryKey: 'bus' },
  { value: 'vehicle', label: 'Van', category: 'Transport', registryKey: 'van' },
  { value: 'vehicle', label: 'Car', category: 'Transport', registryKey: 'car' },

  // Software / Digital
  { value: 'electronics', label: 'Software License', category: 'Software / Digital', registryKey: 'software_license' },
  { value: 'electronics', label: 'Cloud Subscription', category: 'Software / Digital', registryKey: 'cloud_subscription' },
  { value: 'electronics', label: 'Database License', category: 'Software / Digital', registryKey: 'database_license' },
  { value: 'electronics', label: 'Antivirus License', category: 'Software / Digital', registryKey: 'antivirus_license' },
  { value: 'electronics', label: 'Design Software License', category: 'Software / Digital', registryKey: 'design_software_license' },
  { value: 'electronics', label: 'LMS Subscription', category: 'Software / Digital', registryKey: 'lms_subscription' },
  { value: 'electronics', label: 'Email/Office License', category: 'Software / Digital', registryKey: 'email_office_license' },
];

export const COMPONENT_TYPE_REGISTRY_BY_PARENT: Record<string, string[]> = {
  desktop_pc: ['RAM', 'CPU', 'Motherboard', 'SSD', 'HDD', 'NVMe Drive', 'GPU', 'PSU', 'Network Card', 'Wi-Fi Card', 'Cooling Fan', 'CPU Cooler', 'CMOS Battery', 'Optical Drive', 'Case'],
  workstation: ['RAM', 'CPU', 'Motherboard', 'SSD', 'HDD', 'NVMe Drive', 'GPU', 'PSU', 'Network Card', 'Wi-Fi Card', 'Cooling Fan', 'CPU Cooler', 'CMOS Battery', 'Case'],
  server: ['RAM', 'CPU', 'Motherboard', 'SSD', 'HDD', 'NVMe Drive', 'GPU', 'RAID Controller', 'Server Power Supply', 'Server Fan', 'Server Backplane', 'Network Card'],
  laptop: ['RAM', 'SSD', 'Battery', 'Charger', 'Keyboard', 'Screen/Display Panel', 'Trackpad', 'Wi-Fi Card', 'Cooling Fan', 'Motherboard', 'Webcam', 'Speaker', 'Hinge'],
  printer: ['Toner Cartridge', 'Ink Cartridge', 'Drum Unit', 'Fuser Unit', 'Paper Tray', 'Roller Kit', 'Maintenance Kit', 'Print Head'],
  photocopier: ['Toner Cartridge', 'Drum Unit', 'Fuser Unit', 'Paper Tray', 'Roller Kit', 'Maintenance Kit'],
  projector: ['Lamp', 'Filter', 'Remote Control', 'Lens', 'HDMI Module', 'Power Supply'],
  router: ['SFP Module', 'Power Adapter', 'Fan Module', 'Power Supply Module', 'Network Interface Module', 'Antenna'],
  network_switch: ['SFP Module', 'Power Supply Module', 'Fan Module', 'Network Interface Module'],
  access_point: ['Antenna', 'Power Adapter', 'Network Interface Module'],
  cctv_camera: ['Camera Lens', 'Power Adapter', 'Storage Drive', 'PoE Injector', 'Mount Bracket'],
  lab_equipment: ['Probe', 'Sensor', 'Electrode', 'Tube Holder', 'Rotor', 'Lens', 'Filter', 'Calibration Weight', 'Power Adapter'],
  hvac_unit: ['Compressor', 'Filter', 'Fan Motor', 'Thermostat', 'Control Board', 'Pump Motor', 'Belt', 'Valve'],
  furniture: ['Chair Wheel', 'Chair Armrest', 'Chair Gas Lift', 'Desk Drawer', 'Cabinet Lock', 'Table Leg'],
  default: ['RAM', 'SSD', 'Battery', 'Power Adapter', 'Filter', 'Sensor'],
};

export const ACCESSORY_TYPES = [
  'Keyboard', 'Mouse', 'Monitor', 'Charger', 'Power Cable', 'HDMI Cable', 'VGA Cable', 'DisplayPort Cable',
  'USB Cable', 'USB-C Cable', 'Ethernet Cable', 'Adapter', 'Docking Station', 'Laptop Bag', 'Headset',
  'Webcam', 'Remote Control', 'Tripod', 'Microphone Stand', 'Projector Screen', 'External Hard Drive',
  'Flash Drive', 'Barcode Scanner', 'Card Reader'
];

export const CONSUMABLE_TYPES = [
  'AA Battery', 'AAA Battery', 'CMOS Battery', 'UPS Battery', 'Toner', 'Ink', 'Paper', 'Labels',
  'QR Label Stickers', 'Cleaning Kit', 'Alcohol Wipes', 'Thermal Paste', 'Cable Ties',
  'Network Cables', 'Lab Gloves', 'Lab Tubes', 'Printer Drum', 'Projector Filters'
];

export const SPARE_STOCK_TYPES = [
  'Spare RAM', 'Spare SSD', 'Spare HDD', 'Spare NVMe Drive', 'Spare PSU', 'Spare Laptop Battery',
  'Spare Charger', 'Spare Projector Lamp', 'Spare Printer Toner', 'Spare Printer Drum',
  'Spare Network Switch PSU', 'Spare SFP Module', 'Spare Access Point Adapter', 'Spare UPS Battery',
  'Spare Chair Wheel', 'Spare Chair Armrest', 'Spare HVAC Filter', 'Spare Fan Motor', 'Spare Power Adapter'
];

export const LICENSE_TYPES = [
  'Windows License', 'Microsoft Office License', 'Antivirus License', 'Adobe License', 'AutoCAD License',
  'MATLAB License', 'SPSS License', 'Database License', 'Server OS License', 'Cloud Subscription',
  'LMS License', 'Email/Office 365 Subscription', 'Zoom/Teams License', 'Backup Software License', 'Security Software License'
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
  electronics: { years: 6, cost: 1200 },
  furniture: { years: 12, cost: 250 },
  default: { years: 5, cost: 500 }
};
