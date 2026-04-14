import mongoose, { Schema, Document } from 'mongoose';

export interface IHistory extends Document {
  assetId: string;
  action: string; 
  details: string;
  timestamp: Date;
}

const HistorySchema: Schema = new Schema({
  assetId: { type: String, required: true },
  action: { type: String, required: true },
  details: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

export default mongoose.model<IHistory>('History', HistorySchema);