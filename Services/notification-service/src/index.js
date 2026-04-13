const cors = require("cors");
const connectMongoDB = require("./config/db");
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
    app.use(cors());
    app.use(express.json());

    //  MongoDB
    await connectMongoDB();

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
