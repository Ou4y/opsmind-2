const cors = require("cors");
const helmet = require("helmet");
const connectMongoDB = require("./config/db");
const { buildStrictCorsOptions } = require("./config/cors");
require("dotenv").config();

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

const express = require("express");
const connectRabbitMQ = require("./config/rabbitmq");
const consumeTicketNotifications = require("./consumers/ticketNotification.consumer");
const createNotificationAPI = require("./api/notification.api");

(async () => {
  try {
    const app = express();
    app.use(helmet());
    app.use(cors(buildStrictCorsOptions(process.env)));
    app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));

    // MongoDB (skip when running in NO_DB test mode)
    if (process.env.NO_DB !== "true") {
      await connectMongoDB();
    } else {
      console.log("NO_DB=true -> skipping MongoDB connection (using in-memory store for tests)");
    }

    const { channel, EXCHANGE_NAME } = await connectRabbitMQ();
    await consumeTicketNotifications(channel, EXCHANGE_NAME);

    app.use("/api/notifications", createNotificationAPI(channel, EXCHANGE_NAME));

    const PORT = process.env.PORT || 3000;

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Notification Service running on port ${PORT}`);
    });

    // REQUIRED for Railway Docker (keep service alive)
    setInterval(() => {}, 1000);
  } catch (err) {
    console.error("Fatal startup error:", err);
  }
})();
