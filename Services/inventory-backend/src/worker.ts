// src/worker.ts
import dotenv from 'dotenv';
dotenv.config(); // Load env vars

import { EventBus } from './services/EventBus';
import startHistoryService from './services/history-service/index';
import { prisma } from './lib/prisma';

const startWorker = async () => {
  console.log('👷 Starting Background Worker...');

  // 1. Verify Prisma connection
  try {
    await prisma.$queryRaw`SELECT NOW()`;
    console.log('✅ [WORKER] Connected to PostgreSQL via Prisma');
  } catch (err: any) {
    console.error('❌ [WORKER] DB Error:', err.message);
    process.exit(1);
  }

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
  await prisma.$disconnect();
  process.exit(0);
}); 
