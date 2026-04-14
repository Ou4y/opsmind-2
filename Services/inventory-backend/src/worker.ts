// src/worker.ts
import dotenv from 'dotenv';
dotenv.config(); // Load env vars

import mongoose from 'mongoose';
import { EventBus } from './services/EventBus';
import startHistoryService from './services/history-service/index';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/opsmind_assets';

// 1. Connect to MongoDB
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ [WORKER] Connected to MongoDB'))
  .catch((err) => console.error('❌ [WORKER] DB Error:', err));

const startWorker = async () => {
  console.log('👷 Starting Background Worker...');

  // 2. Connect to RabbitMQ
  await EventBus.connect();

  // 3. Start Listening (The Consumer)
  await startHistoryService();

  console.log('👂 Worker is listening for events...');
};

startWorker();

// Graceful Shutdown for Worker
process.on('SIGINT', async () => {
  console.log('\n🛑 Worker shutting down...');
  await mongoose.connection.close();
  process.exit(0);
}); 