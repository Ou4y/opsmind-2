require("dotenv").config();
const app = require("./app");
const connectDB = require("./config/db");
const axios = require("axios");

const PORT = process.env.PORT || 3004;

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
        await axios.get("http://localhost:3000/analytics/sync");
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