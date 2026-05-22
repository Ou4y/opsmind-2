require("dotenv").config();
const app = require("./app");
const connectDB = require("./config/db");
const axios = require("axios");

const PORT = Number(process.env.PORT || 3000);
const REPORT_SYNC_URL = process.env.REPORT_SYNC_URL || `http://127.0.0.1:${PORT}/analytics/sync`;

async function start() {
  try {
    // Connect MongoDB
    await connectDB();
    console.log("MongoDB connected ");

    //  Start HTTP server
    app.listen(PORT, () => {
      console.log(`Reporting Service running on ${PORT}`);
    });

    // Auto Sync every 1 minute 
    setInterval(async () => {
      try {
        console.log(" Auto syncing tickets...");
        await axios.get(REPORT_SYNC_URL);
      } catch (err) {
        console.error("Sync failed:", err.message);
      }
    }, 60000); 

  } catch (err) {
    console.error("Failed to start Reporting Service ", err);
    process.exit(1);
  }
}

start();
