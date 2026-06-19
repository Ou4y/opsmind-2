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
import { authController } from '@modules/auth/auth.controller';
import adminRoutes from '@modules/admin/admin.routes';
import { userRepository } from '@modules/users/user.repository';

const DEFAULT_ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'X-Request-Id'];
const DEFAULT_ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

function parseAllowedOrigins(): string[] {
  const values = [
    process.env.ALLOWED_ORIGINS,
    process.env.FRONTEND_ORIGIN,
    process.env.CORS_ORIGIN,
  ]
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .flatMap((value) => String(value).split(',').map((entry) => entry.trim()).filter(Boolean));

  const uniqueOrigins = Array.from(new Set(values));
  if (uniqueOrigins.length > 0) return uniqueOrigins;

  if ((process.env.NODE_ENV || 'development') === 'development') {
    return ['http://localhost:8085', 'http://localhost:5173', 'http://127.0.0.1:5173'];
  }

  return [];
}

function shouldEnableApiDocs(): boolean {
  return (
    process.env.ENABLE_API_DOCS === 'true' ||
    (process.env.ENABLE_API_DOCS !== 'false' && (process.env.NODE_ENV || 'development') === 'development')
  );
}

function isWeakSecret(secret: string): boolean {
  const normalized = String(secret || '').trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.length < 32) return true;
  if (normalized.includes('set_strong')) return true;
  if (normalized.includes('replace_with')) return true;
  if (normalized.includes('placeholder')) return true;
  return false;
}

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
    if (!config.jwt.secret) {
      throw new Error('JWT_SECRET is required');
    }
    if ((process.env.NODE_ENV || 'development') !== 'development' && isWeakSecret(config.jwt.secret)) {
      throw new Error('JWT_SECRET is insecure for non-development environments');
    }

    const allowedOrigins = parseAllowedOrigins();
    const allowCredentials =
      process.env.CORS_ALLOW_CREDENTIALS === 'true' && allowedOrigins.length > 0;

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
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        const error = new Error('CORS origin is not allowed') as Error & { statusCode?: number };
        error.statusCode = 403;
        return callback(error);
      },
      methods: DEFAULT_ALLOWED_METHODS,
      allowedHeaders: DEFAULT_ALLOWED_HEADERS,
      credentials: allowCredentials,
      optionsSuccessStatus: 204,
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
    if (shouldEnableApiDocs()) {
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
    }

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

    // Internal service-to-service route used by ticket-service for SLA enrichment.
    this.app.get('/users/:id', (req, res) => {
      const expectedToken = process.env.INTERNAL_API_TOKEN || '';
      const providedToken = String(req.header('x-internal-token') || '');
      if (!expectedToken || providedToken !== expectedToken) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }
      return authController.getUserById(req, res);
    });
    this.app.post('/internal/users/batch', async (req, res) => {
      const expectedToken = process.env.INTERNAL_API_TOKEN || '';
      const providedToken = String(req.header('x-internal-token') || '');
      if (!expectedToken || providedToken !== expectedToken) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const ids = Array.isArray(req.body?.ids)
        ? req.body.ids.map((id: unknown) => String(id || '').trim()).filter(Boolean)
        : [];

      if (ids.length > 100) {
        return res.status(400).json({
          success: false,
          message: 'A maximum of 100 user IDs can be requested at once',
        });
      }

      const users = await userRepository.findByIdsWithRoles(ids);

      return res.status(200).json({
        success: true,
        count: users.length,
        data: users.map((user) => {
          const firstName = String(user.first_name || '').trim();
          const lastName = String(user.last_name || '').trim();
          const name = [firstName, lastName].filter(Boolean).join(' ').trim();

          return {
            id: user.id,
            name: name || user.email,
            fullName: name || null,
            email: user.email,
            username: user.email?.split('@')[0] || null,
            role: user.roles[0]?.name || null,
          };
        }),
      });
    });
    this.app.get('/internal/admin-users', async (req, res) => {
      const expectedToken = process.env.INTERNAL_API_TOKEN || '';
      const providedToken = String(req.header('x-internal-token') || '');
      if (!expectedToken || providedToken !== expectedToken) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const users = await userRepository.findAll({ isActive: true });
      const admins = users
        .filter((u) => Array.isArray(u.roles) && u.roles.some((r: any) => String(r?.name || '').toUpperCase() === 'ADMIN'))
        .map((u) => ({
          id: u.id,
          email: u.email,
          firstName: u.first_name,
          lastName: u.last_name,
          isActive: u.is_active,
        }));

      return res.status(200).json({
        success: true,
        count: admins.length,
        data: admins,
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
