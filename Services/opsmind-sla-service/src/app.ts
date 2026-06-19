import cors from "cors";
import express from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { config } from "./config";
import { swaggerSpec } from "./docs/swagger";
import { errorMiddleware } from "./middleware/error.middleware";
import { requestIdMiddleware } from "./middleware/requestId.middleware";
import { slaRoutes } from "./routes/sla.routes";
import { buildStrictCorsOptions } from "./utils/cors";

export const app = express();

const enableApiDocs =
  process.env.ENABLE_API_DOCS === "true" ||
  (process.env.ENABLE_API_DOCS !== "false" && config.env === "development");

app.use(helmet());
app.use(cors(buildStrictCorsOptions(process.env)));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));
app.use(requestIdMiddleware);

if (enableApiDocs) {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

app.use(slaRoutes);
app.use(errorMiddleware);
