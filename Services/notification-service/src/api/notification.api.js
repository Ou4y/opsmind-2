const express = require("express");
const Notification = require("../models/Notification");


function setNotificationAPI(channel, exchange) {
  const router = express.Router();

  // Health api
  router.get("/health", (req, res) => {
    res.json({ service: "Notification Service", status: "UP" });
  });

  router.post("/events", (req, res) => {
    const { routingKey, payload } = req.body;

    // check for routingkey
    if (!routingKey || typeof routingKey !== "string") {
      return res.status(422).json({ error: "Missing (or) invalid routingKey" });
    }

    // check for payload
    if (!payload) {
      return res.status(422).json({ error: "Missing in payload" });
    }

    try {
      const messageBuffer = Buffer.from(JSON.stringify(payload));

      channel.publish(exchange, routingKey, messageBuffer, {
        contentType: "application/json"
      });

      res.json({ message: "Event published successfully", routingKey });
    } catch (err) {
      console.error("Failed to publish event:", err);
      res.status(502).json({ error: "Failed to publish event" });
    }
  });


  router.put("/:userId/mark-read", async (req, res) => {
  try {
    const { userId } = req.params;

    await Notification.updateMany(
      { userId, read: false },
      { $set: { read: true } }
    );

    res.json({ message: "Notifications marked as read" });
  } catch (err) {
    res.status(500).json({ error: "Failed to mark as read" });
  }
});



  // Get all notifications for a user (OLD notifications)
router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const notifications = await Notification.find({ userId })
      .sort({ createdAt: -1 });

    res.json(notifications);
  } catch (err) {
    console.error("Failed to fetch notifications:", err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});


  return router;
}

module.exports = setNotificationAPI;