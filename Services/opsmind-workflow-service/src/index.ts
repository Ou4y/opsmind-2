import dotenv from 'dotenv';
dotenv.config();

import { createApp } from './app';
import { pool, waitForDatabase } from './config/database';
import { startSlaMonitor } from './jobs/slaMonitor';

const PORT: number = parseInt(process.env.PORT || '3003', 10);

async function main(): Promise<void> {
  try {
    // ── Wait for MySQL (retries with backoff — essential for Docker) ──
    await waitForDatabase();

    // ── Create and start Express app ──
    const app = createApp();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Workflow Service running on port ${PORT}`);
      console.log(`📡 Health check: http://localhost:${PORT}/health`);
      console.log(`🔀 Workflow API:  http://localhost:${PORT}/workflow`);
      console.log(`🔧 Admin API:    http://localhost:${PORT}/admin`);
    });

    // ── Start background jobs ──
    startSlaMonitor();

    // ── Graceful shutdown ──
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received. Shutting down gracefully...`);
      await pool.end();
      console.log('MySQL pool closed.');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    console.error('❌ Failed to start Workflow Service:', error);
    process.exit(1);
  }
}

main();
