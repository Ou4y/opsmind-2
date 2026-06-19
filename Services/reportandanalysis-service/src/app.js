const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const analyticsRoutes = require("./routes/analytics.routes");
const { buildStrictCorsOptions } = require("./config/cors");

const app = express();
app.use(helmet());
app.use(cors(buildStrictCorsOptions(process.env)));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));

app.use("/analytics", analyticsRoutes);

app.get("/health", (_req, res) => {
  res.json({
    service: "Reporting & Analytics",
    status: "UP"
  });
});

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

app.use((error, _req, res, _next) => {
  const nodeEnv = process.env.NODE_ENV || "development";
  const statusCode = Number(error?.statusCode) || 500;
  const message =
    statusCode >= 500 && nodeEnv !== "development"
      ? "Internal server error"
      : String(error?.message || "Internal server error");

  if (statusCode >= 500) {
    console.error("[ReportingService] Unhandled error", {
      message: error?.message || String(error),
      stack: nodeEnv === "development" ? error?.stack : undefined,
    });
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(nodeEnv === "development" && error?.stack ? { stack: error.stack } : {}),
  });
});

module.exports = app;
