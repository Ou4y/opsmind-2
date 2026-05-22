const express = require("express");
const cors = require("cors");

const healthRoutes = require("./routes/health.routes");
const remediationRoutes = require("./routes/remediation.routes");
const agentTaskRoutes = require("./routes/agentTask.routes");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const app = express();

// Development-friendly CORS for local integration; restrict origins before production.
const corsOptions = {
  origin: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "X-User-Id",
    "X-User-Role",
  ],
  credentials: false,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(express.json({ limit: "1mb" }));

app.use(healthRoutes);
app.use(remediationRoutes);
app.use(agentTaskRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
