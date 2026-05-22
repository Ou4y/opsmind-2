import dotenv from 'dotenv';
dotenv.config();

import { EventBus } from './services/EventBus';
import startHistoryService from './services/history-service/index';
import { prisma } from './lib/prisma';
import { startInventoryAiJobWorker, stopInventoryAiJobWorker } from './services/asset-ai-jobs';

const startWorker = async () => {
  console.log('[WORKER] Starting background worker...');

  try {
    await prisma.$queryRaw`SELECT NOW()`;
    console.log('[WORKER] Connected to PostgreSQL via Prisma');
  } catch (error: any) {
    console.error('[WORKER] DB connection failed:', error?.message || error);
    process.exit(1);
  }

  await EventBus.connect();
  await startHistoryService();
  await startInventoryAiJobWorker();

  console.log('[WORKER] Listening for history and inventory AI jobs...');
};

startWorker().catch((error) => {
  console.error('[WORKER] Fatal startup error:', error);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('\n[WORKER] Shutting down...');
  await stopInventoryAiJobWorker();
  await prisma.$disconnect();
  process.exit(0);
});
