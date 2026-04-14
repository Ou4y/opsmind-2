import mongoose, { Document, Schema } from 'mongoose';

export interface ITicket extends Document {
  title: string;
  description: string;
  status: 'Open' | 'In Progress' | 'Resolved' | 'Closed';
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
  type: 'Hardware' | 'Software' | 'Network' | 'Access' | 'Other';
  assignedTo?: string; // User name or ID
  relatedAsset?: string; // e.g., Asset Custom ID
  createdAt: Date;
}

const TicketSchema: Schema = new Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['Open', 'In Progress', 'Resolved', 'Closed'], 
    default: 'Open' 
  },
  priority: { 
    type: String, 
    enum: ['Low', 'Medium', 'High', 'Critical'], 
    default: 'Medium' 
  },
  type: { 
    type: String, 
    enum: ['Hardware', 'Software', 'Network', 'Access', 'Other'], 
    default: 'Other' 
  },
  assignedTo: { type: String },
  relatedAsset: { type: String },
}, { timestamps: true });

export default mongoose.model<ITicket>('Ticket', TicketSchema);