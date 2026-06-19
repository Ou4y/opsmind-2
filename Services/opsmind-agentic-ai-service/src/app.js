const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const healthRoutes = require("./routes/health.routes");
const remediationRoutes = require("./routes/remediation.routes");
const agentTaskRoutes = require("./routes/agentTask.routes");
const { buildStrictCorsOptions } = require("./config/cors");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const app = express();

app.use(helmet());
app.use(cors(buildStrictCorsOptions(process.env)));

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));

app.use(healthRoutes);
app.use(remediationRoutes);
app.use(agentTaskRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
