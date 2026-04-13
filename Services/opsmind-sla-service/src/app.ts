import cors from "cors";
import express from "express";
import swaggerUi from "swagger-ui-express";
import { config } from "./config";
import { swaggerSpec } from "./docs/swagger";
import { errorMiddleware } from "./middleware/error.middleware";
import { requestIdMiddleware } from "./middleware/requestId.middleware";
import { slaRoutes } from "./routes/sla.routes";

export const app = express();

app.use(cors({ origin: config.cors.origins }));
app.use(express.json());
app.use(requestIdMiddleware);

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use(slaRoutes);
app.use(errorMiddleware);
