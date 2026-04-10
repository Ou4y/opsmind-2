import swaggerJSDoc, { type Options } from "swagger-jsdoc";
import path from "node:path";
import { config } from "../config";

const cwd = process.cwd();

const options: Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "OpsMind Ticket Service API",
      version: "1.0.0",
      description: "REST API for managing tickets.",
    },
    // Best practice for reverse-proxies / Docker port-mapping:
    // use a relative server so Swagger UI uses the same origin that served /docs
    // (avoids hardcoding localhost:3000 while the host publishes 3001).
    servers: [{ url: "/" }],
    tags: [{ name: "Tickets" }, { name: "Health" }, { name: "Docs" }],
  },
  // IMPORTANT:
  // swagger-jsdoc resolves globs relative to process.cwd(). We include both
  // TS sources (dev) and compiled JS (prod/Docker).
  apis: [
    path.join(cwd, "src", "routes", "**", "*.ts"),
    path.join(cwd, "src", "app.ts"),
    path.join(cwd, "dist", "routes", "**", "*.js"),
    path.join(cwd, "dist", "app.js"),
  ],
};

export const swaggerSpec = swaggerJSDoc(options);
