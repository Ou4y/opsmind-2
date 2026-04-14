import mongoose, { Schema, Document } from 'mongoose';

// 1. Define Valid Locations & Departments
export type Location = 'Central Warehouse' | 'Main Building' | 'K Building' | 'N Building' | 'S Building' | 'R Building' | 'Pharmacy Building';
// ✅ ADDED 'General' here so the server doesn't crash on default values
export type Department = 'Computer Science' | 'Engineering' | 'Architecture' | 'Business' | 'Mass Comm' | 'Alsun' | 'Pharmacy' | 'Dentistry' | 'Unassigned' | 'General';

/**
 * 2. Define Valid Asset Types
 * ✅ UPDATED: Added 'furniture' to match the frontend dropdown.
 * ✅ CLEANUP: Removed duplicate 'electronics' entries.
 */
const ASSET_TYPES = [
  // IT & Computing
  'laptop', 'desktop', 'tablet', 'server', 'monitor', 'peripheral',
  'Laptop', 'Desktop', 'Tablet', 'Server', 'Monitor', 'Peripheral',
  'keyboard', 'Keyboard',
  'electronics', 'Electronics',
  
  // AV & Classroom
  'projector', 'smartboard', 'camera', 'speaker', 'microphone',
  'Projector', 'Smartboard', 'Camera', 'Speaker', 'Microphone',
  
  // Networking
  'router', 'switch', 'access_point', 'firewall',
  'Router', 'Switch', 'Access_Point', 'Firewall',
  
  // Office & Furniture
  // ✅ ADDED 'furniture' here because your frontend sends it!
  'printer', 'scanner', 'desk', 'chair', 'whiteboard', 'filing_cabinet', 'furniture',
  'Printer', 'Scanner', 'Desk', 'Chair', 'Whiteboard', 'Filing_Cabinet', 'Furniture',
  
  // Lab & Research
  'microscope', 'centrifuge', 'oscilloscope', '3d_printer', 'lab_bench',
  'Microscope', 'Centrifuge', 'Oscilloscope', '3D_Printer', 'Lab_Bench',
  
  // Facilities
  'vehicle', 'generator', 'hvac', 'maintenance_tool',
  'Vehicle', 'Generator', 'HVAC', 'Maintenance_Tool'
];

// 3. The TypeScript Interface
export interface IAsset extends Document {
  customId: string;
  name: string;
  type: string; 
  status: 'active' | 'repair' | 'retired' | 'assigned' | 'maintenance';
  value: number;
  quantity: number;
  assignedUser?: string | null; 
  tickets: string[];
  location: Location;
  department: Department;
  // ✅ Specifications field to store technical details (RAM, Storage, etc.)
  specifications: Record<string, any>;
  history: { 
    // ✅ ADDED: 'Details Updated' to match server.ts logic
    event: 'AssetAssigned' | 'AssetFaultReported' | 'Created' | 'StatusChange' | 'Transfer' | 'InfoUpdate' | 'Distributed' | 'Received_Distribution' | 'Details Updated'; 
    details: string;
    date: Date;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

// 4. The Mongoose Schema
const assetSchema = new Schema<IAsset>({
  customId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  
  type: { 
    type: String, 
    required: true,
    enum: ASSET_TYPES 
  },
  
  status: { type: String, default: 'active' },
  value: { type: Number, default: 0 },
  // Default quantity is 1 because we are now tracking individual items
  quantity: { type: Number, default: 1, min: 0 },
  assignedUser: { type: String, default: null },
  tickets: [{ type: String }],

  location: { 
    type: String, 
    required: true, 
    enum: ['Central Warehouse', 'Main Building', 'K Building', 'N Building', 'S Building', 'R Building', 'Pharmacy Building'],
    default: 'Central Warehouse' 
  },

  department: { 
    type: String, 
    required: true,
    // ✅ ADDED 'General' here to match the TypeScript Interface
    enum: ['Computer Science', 'Engineering', 'Architecture', 'Business', 'Mass Comm', 'Alsun', 'Pharmacy', 'Dentistry', 'Unassigned', 'General'],
    default: 'Unassigned'
  },

  // ✅ specifications as a flexible Object (Mixed type)
  specifications: { 
    type: Schema.Types.Mixed, 
    default: {} 
  },
  
  history: [{
    event: { type: String, required: true },
    details: { type: String, required: true },
    date: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

export default mongoose.model<IAsset>('Asset', assetSchema);
