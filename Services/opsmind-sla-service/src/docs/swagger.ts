import swaggerJsdoc from "swagger-jsdoc";

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "OpsMind SLA Service",
      version: "1.0.0",
      description: "TypeScript SLA microservice aligned with OpsMind Ticket and Workflow services",
    },
    servers: [{ url: "http://localhost:3004" }],
    tags: [
      { name: "Health", description: "Health endpoints" },
      { name: "SLA", description: "SLA endpoints" },
      { name: "Policies", description: "SLA policy endpoints" },
      { name: "Monitor", description: "Manual monitor endpoints" },
    ],
    components: {
      schemas: {
        StartSlaRequest: {
          type: "object",
          required: ["ticketId", "priority"],
          properties: {
            ticketId: { type: "string", example: "T1" },
            title: { type: "string", nullable: true, example: "Printer offline on floor 2" },
            priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], example: "HIGH" },
            createdAt: { type: "string", format: "date-time", example: "2026-04-11T10:00:00.000Z" },
            assignedTo: { type: "string", nullable: true, example: "tech1" },
            ticketStatus: { type: "string", example: "OPEN" },
            building: { type: "string", nullable: true, example: "A" },
            floor: { type: "integer", nullable: true, example: 2 },
            room: { type: "string", nullable: true, example: "204" },
            supportGroupId: { type: "string", nullable: true, example: "grp-1" },
            requesterId: { type: "string", nullable: true, example: "user-1" },
            technician: {
              type: "object",
              nullable: true,
              properties: {
                id: { type: "string", example: "42" },
                name: { type: "string", example: "Ali Hassan" },
                email: { type: "string", format: "email", example: "ali@example.com" },
              },
            },
            supervisor: {
              type: "object",
              nullable: true,
              properties: {
                id: { type: "string", example: "7" },
                name: { type: "string", example: "Mona Adel" },
                email: { type: "string", format: "email", example: "mona@example.com" },
              },
            },
          },
        },
        UpdateStatusRequest: {
          type: "object",
          properties: {
            ticketStatus: { type: "string", example: "IN_PROGRESS" },
            assignedTo: { type: "string", nullable: true, example: "tech1" },
            title: { type: "string", nullable: true, example: "Printer offline on floor 2" },
            firstResponseAt: { type: "string", format: "date-time", example: "2026-04-11T10:20:00.000Z" },
            resolvedAt: { type: "string", format: "date-time", example: "2026-04-11T11:30:00.000Z" },
            closedAt: { type: "string", format: "date-time", example: "2026-04-11T11:45:00.000Z" },
            building: { type: "string", nullable: true, example: "A" },
            floor: { type: "integer", nullable: true, example: 2 },
            room: { type: "string", nullable: true, example: "204" },
            supportGroupId: { type: "string", nullable: true, example: "grp-1" },
            technician: {
              type: "object",
              nullable: true,
              properties: {
                id: { type: "string", example: "42" },
                name: { type: "string", example: "Ali Hassan" },
                email: { type: "string", format: "email", example: "ali@example.com" },
              },
            },
            supervisor: {
              type: "object",
              nullable: true,
              properties: {
                id: { type: "string", example: "7" },
                name: { type: "string", example: "Mona Adel" },
                email: { type: "string", format: "email", example: "mona@example.com" },
              },
            },
          },
        },
        PauseRequest: {
          type: "object",
          properties: {
            reason: { type: "string", example: "WAITING_FOR_USER" },
          },
        },
        PolicyRequest: {
          type: "object",
          required: ["priority", "name", "responseMinutes", "resolutionMinutes"],
          properties: {
            priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], example: "HIGH" },
            name: { type: "string", example: "High Priority" },
            responseMinutes: { type: "integer", example: 60 },
            resolutionMinutes: { type: "integer", example: 720 },
            warning1Percent: { type: "integer", example: 70 },
            warning2Percent: { type: "integer", example: 85 },
            breachPercent: { type: "integer", example: 100 },
            breachAction: { type: "string", example: "NOTIFY_ONLY" },
          },
        },
      },
    },
    paths: {
      "/health": { get: { tags: ["Health"], summary: "Health check", responses: { "200": { description: "Service healthy" } } } },
      "/health/ready": {
        get: {
          tags: ["Health"],
          summary: "Readiness check",
          responses: {
            "200": { description: "Dependencies ready" },
            "503": { description: "One or more dependencies unavailable" },
          },
        },
      },
      "/sla/start": {
        post: {
          tags: ["SLA"],
          summary: "Start SLA for a ticket",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/StartSlaRequest" } } } },
          responses: { "201": { description: "SLA created" }, "409": { description: "SLA already exists" } },
        },
      },
      "/sla/calculate": {
        post: {
          tags: ["SLA"],
          summary: "Compatibility alias for start SLA",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/StartSlaRequest" } } } },
          responses: { "201": { description: "SLA created" } },
        },
      },
      "/sla/tickets/{ticketId}": {
        get: {
          tags: ["SLA"],
          summary: "Get SLA by ticket ID",
          parameters: [{ in: "path", name: "ticketId", required: true, schema: { type: "string" }, example: "T1" }],
          responses: { "200": { description: "SLA returned" }, "404": { description: "Not found" } },
        },
      },
      "/sla/tickets": {
        get: {
          tags: ["SLA"],
          summary: "List SLA-linked tickets",
          parameters: [
            { in: "query", name: "q", required: false, schema: { type: "string" }, example: "printer" },
            { in: "query", name: "status", required: false, schema: { type: "string", enum: ["ACTIVE", "PAUSED", "BREACHED", "RESOLVED", "CLOSED"] } },
            { in: "query", name: "priority", required: false, schema: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] } },
            { in: "query", name: "ticketStatus", required: false, schema: { type: "string" }, example: "IN_PROGRESS" },
            { in: "query", name: "assignedTo", required: false, schema: { type: "string" }, example: "42" },
            { in: "query", name: "limit", required: false, schema: { type: "integer", default: 50 } },
            { in: "query", name: "offset", required: false, schema: { type: "integer", default: 0 } },
          ],
          responses: { "200": { description: "SLA ticket list returned" } },
        },
      },
      "/sla/tickets/{ticketId}/status": {
        patch: {
          tags: ["SLA"],
          summary: "Update SLA ticket status",
          parameters: [{ in: "path", name: "ticketId", required: true, schema: { type: "string" }, example: "T1" }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateStatusRequest" } } } },
          responses: { "200": { description: "Updated" }, "404": { description: "Not found" } },
        },
      },
      "/sla/tickets/{ticketId}/pause": {
        post: {
          tags: ["SLA"],
          summary: "Pause SLA timer",
          parameters: [{ in: "path", name: "ticketId", required: true, schema: { type: "string" }, example: "T1" }],
          requestBody: { required: false, content: { "application/json": { schema: { $ref: "#/components/schemas/PauseRequest" } } } },
          responses: { "200": { description: "Paused" } },
        },
      },
      "/sla/tickets/{ticketId}/resume": {
        post: {
          tags: ["SLA"],
          summary: "Resume SLA timer",
          parameters: [{ in: "path", name: "ticketId", required: true, schema: { type: "string" }, example: "T1" }],
          responses: { "200": { description: "Resumed" } },
        },
      },
      "/sla/policies": {
        get: { tags: ["Policies"], summary: "Get policies", responses: { "200": { description: "Policies returned" } } },
        post: {
          tags: ["Policies"],
          summary: "Create or update policy",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PolicyRequest" } } } },
          responses: { "200": { description: "Policy saved" } },
        },
      },
      "/sla/monitor/run": {
        post: { tags: ["Monitor"], summary: "Run monitor cycle manually", responses: { "200": { description: "Monitor cycle complete" } } },
      },
    },
  },
  apis: [],
});
