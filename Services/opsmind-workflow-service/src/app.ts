import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';
import { buildStrictCorsOptions } from './config/cors';

import workflowRoutes from './routes/workflowRoutes';
import adminRoutes from './routes/adminRoutes';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { requestLogger } from './middlewares/requestLogger';

/**
 * Express Application Factory (TypeScript)
 *
 * Separating app creation from listening allows for testing.
 */
export function createApp(): Application {
  const app: Application = express();
  const enableApiDocs =
    process.env.ENABLE_API_DOCS === 'true' ||
    (process.env.ENABLE_API_DOCS !== 'false' && (process.env.NODE_ENV || 'development') === 'development');

  // ── Security ──
  app.use(helmet());
  app.use(cors(buildStrictCorsOptions(process.env)));

  // ── Parsing ──
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // ── Logging ──
  app.use(morgan('dev'));
  app.use(requestLogger);

  // ── Health Check (with DB verification) ──
  app.get('/health', async (_req: Request, res: Response) => {
    try {
      const { pool } = await import('./config/database');
      await pool.execute('SELECT 1');
      res.status(200).json({
        status: 'OK',
        service: process.env.SERVICE_NAME || 'opsmind-workflow',
        database: 'connected',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    } catch (error: any) {
      res.status(500).json({
        status: 'ERROR',
        service: process.env.SERVICE_NAME || 'opsmind-workflow',
        database: 'disconnected',
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // ── Routes ──
  if (enableApiDocs) {
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'OpsMind Workflow API Docs',
    }));
    app.get('/api-docs.json', (_req: Request, res: Response) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(swaggerSpec);
    });
  }

  // Workflow routes at /workflow (includes /workflow/health, /workflow/logs, etc.)
  app.use('/workflow', workflowRoutes);

  // Admin routes at /workflow/admin (frontend calls /workflow/admin/support-groups/*)
  app.use('/workflow/admin', adminRoutes);

  // ── Error Handling ──
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
