import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';

// Load environment variables first
dotenv.config();

import { config } from '@config/index';
import { logger } from '@config/logger';
import { swaggerSpec } from '@config/swagger';
import { initializeDatabase, closeDatabase } from '@database/connection';
import { runMigrations } from '@database/migrations';
import { seedDatabase } from '@database/seed';
import { globalRateLimiter } from '@middlewares/rateLimiter.middleware';
import { errorHandler, notFoundHandler } from '@middlewares/error.middleware';

// Import routes
import authRoutes from '@modules/auth/auth.routes';
import adminRoutes from '@modules/admin/admin.routes';

class Server {
  private app: Application;
  private port: number;

  constructor() {
    this.app = express();
    this.port = config.server.port;
    this.initializeMiddlewares();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  private initializeMiddlewares(): void {
    // Security middlewares - configure helmet to allow Swagger UI
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }));
    this.app.use(cors({
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }));

    // Rate limiting
    this.app.use(globalRateLimiter);

    // Body parsing
    this.app.use(express.json({ limit: '10kb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10kb' }));

    // Request logging
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`);
      next();
    });
  }

  private initializeRoutes(): void {
    // Swagger documentation
    this.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'OpsMind Auth API Docs',
    }));

    // Swagger JSON endpoint
    this.app.get('/api-docs.json', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(swaggerSpec);
    });

    // Health check endpoint
    /**
     * @swagger
     * /health:
     *   get:
     *     summary: Health check endpoint
     *     tags: [System]
     *     security: []
     *     responses:
     *       200:
     *         description: Service is running
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 message:
     *                   type: string
     *                   example: Auth service is running
     *                 timestamp:
     *                   type: string
     *                   format: date-time
     */
    this.app.get('/health', (req, res) => {
      res.status(200).json({
        success: true,
        message: 'Auth service is running',
        timestamp: new Date().toISOString(),
      });
    });

    // API routes
    this.app.use('/auth', authRoutes);
    this.app.use('/admin', adminRoutes);

    // API info
    /**
     * @swagger
     * /:
     *   get:
     *     summary: API information endpoint
     *     tags: [System]
     *     security: []
     *     responses:
     *       200:
     *         description: API information
     */
    this.app.get('/', (req, res) => {
      res.status(200).json({
        success: true,
        message: 'OpsMind Authentication Service',
        version: '1.0.0',
        documentation: '/api-docs',
        endpoints: {
          auth: {
            signup: 'POST /auth/signup',
            login: 'POST /auth/login',
            verifyOTP: 'POST /auth/verify-otp',
            resendOTP: 'POST /auth/resend-otp',
          },
          admin: {
            createTechnician: 'POST /admin/technicians',
            getTechnicians: 'GET /admin/technicians',
            updateUserStatus: 'PATCH /admin/users/:id/status',
            getUsers: 'GET /admin/users',
            getBuildings: 'GET /admin/buildings',
            createBuilding: 'POST /admin/buildings',
          },
        },
      });
    });
  }

  private initializeErrorHandling(): void {
    this.app.use(notFoundHandler);
    this.app.use(errorHandler);
  }

  public async start(): Promise<void> {
    try {
      // Initialize database connection
      logger.info('Connecting to database...');
      await initializeDatabase();

      // Run migrations
      logger.info('Running database migrations...');
      await runMigrations();

      // Seed database (only seeds if data doesn't exist)
      logger.info('Seeding database...');
      await seedDatabase();

      // Start server
      this.app.listen(this.port, () => {
        logger.info(`Server is running on port ${this.port}`);
        logger.info(`Environment: ${config.server.nodeEnv}`);
      });

      // Graceful shutdown handlers
      this.setupGracefulShutdown();
    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received. Starting graceful shutdown...`);
      
      try {
        await closeDatabase();
        logger.info('Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }
}

// Start the server
const server = new Server();
server.start();
