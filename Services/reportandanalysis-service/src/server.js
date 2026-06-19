require("dotenv").config();
const app = require("./app");
const connectDB = require("./config/db");
const axios = require("axios");

const PORT = Number(process.env.PORT || 3000);
const REPORT_SYNC_URL = process.env.REPORT_SYNC_URL || `http://127.0.0.1:${PORT}/analytics/sync`;
const INTERNAL_API_TOKEN = String(process.env.INTERNAL_API_TOKEN || "").trim();

async function start() {
  try {
    await connectDB();
    console.log("MongoDB connected");

    app.listen(PORT, () => {
      console.log(`Reporting Service running on ${PORT}`);
    });

    // Auto sync every minute via protected internal endpoint.
    setInterval(async () => {
      try {
        const headers = INTERNAL_API_TOKEN ? { "x-internal-token": INTERNAL_API_TOKEN } : {};
        await axios.get(REPORT_SYNC_URL, { headers });
      } catch (err) {
        console.error("Sync failed:", err.message);
      }
    }, 60000);
  } catch (err) {
    console.error("Failed to start Reporting Service", err);
    process.exit(1);
  }
}

start();
