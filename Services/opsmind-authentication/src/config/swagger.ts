import swaggerJsdoc from 'swagger-jsdoc';
import { SwaggerDefinition } from 'swagger-jsdoc';

const swaggerDefinition: SwaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'OpsMind Authentication Service API',
    version: '1.0.0',
    description: 'API documentation for OpsMind Authentication microservice',
    contact: {
      name: 'OpsMind Team',
      email: 'support@opsmind.com',
    },
    license: {
      name: 'ISC',
    },
  },
  servers: [
    {
      url: 'http://localhost:3002',
      description: 'Development server',
    },
    {
      url: 'http://localhost:3002',
      description: 'Production server',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT token',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: false,
          },
          message: {
            type: 'string',
            example: 'Error message',
          },
          errors: {
            type: 'array',
            items: {
              type: 'object',
            },
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            example: '550e8400-e29b-41d4-a716-446655440000',
          },
          email: {
            type: 'string',
            format: 'email',
            example: 'user@miuegypt.edu.eg',
          },
          first_name: {
            type: 'string',
            example: 'John',
          },
          last_name: {
            type: 'string',
            example: 'Doe',
          },
          is_verified: {
            type: 'boolean',
            example: true,
          },
          is_active: {
            type: 'boolean',
            example: true,
          },
          created_at: {
            type: 'string',
            format: 'date-time',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
      Role: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
          },
          name: {
            type: 'string',
            enum: ['ADMIN', 'TECHNICIAN', 'DOCTOR', 'STUDENT'],
            example: 'TECHNICIAN',
          },
          description: {
            type: 'string',
            example: 'IT support technician',
          },
        },
      },
      Building: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
          },
          name: {
            type: 'string',
            example: 'Engineering Building',
          },
          code: {
            type: 'string',
            example: 'ENG',
          },
          address: {
            type: 'string',
            example: 'East Wing',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
    },
  },
  security: [
    {
      bearerAuth: [],
    },
  ],
};

const options = {
  definition: swaggerDefinition,
  // Path to the API routes
  apis: [
    './src/modules/**/*.routes.ts',
    './src/modules/**/*.routes.js',
    './dist/modules/**/*.routes.js',
    './src/server.ts',
    './dist/server.js',
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
