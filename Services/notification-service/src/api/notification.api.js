const express = require("express");
const Notification = require("../models/Notification");
const inMemoryStore = require("../inMemoryStore");

const INTERNAL_SECRET = process.env.INTERNAL_SECRET || process.env.NOTIFICATION_INTERNAL_SECRET || "supersecret";


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
        contentType: "application/json",
        persistent: true,
      });

      res.json({ message: "Event published successfully", routingKey });
    } catch (err) {
      console.error("Failed to publish event:", err);
      res.status(502).json({ error: "Failed to publish event" });
    }
  });


  // Legacy compatibility endpoint used by ticket service safety-net HTTP calls.
  // Accepts body { type, payload } and publishes to RabbitMQ as a notification event.
  router.post("/", (req, res) => {
    const secret = req.headers["x-internal-secret"] || req.headers["x-internal-token"];
    if (secret !== INTERNAL_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { type, payload } = req.body;
    if (!type || !payload) {
      return res.status(422).json({ error: "Missing type or payload" });
    }

    // Map legacy types to routing keys
    const mapping = {
      TICKET_OPENED: "ticket.notification.opened",
      TICKET_RESOLVED: "ticket.notification.resolved",
    };

    const routingKey = mapping[type] || `ticket.notification.${type.toLowerCase()}`;

    try {
      const messageBuffer = Buffer.from(JSON.stringify(payload));
      channel.publish(exchange, routingKey, messageBuffer, {
        contentType: "application/json",
        persistent: true,
      });

      // Also store in-memory if running in NO_DB test mode
      if (process.env.NO_DB === "true") {
        // attempt to add simple notifications for users contained in payload
        try {
          if (payload.endUser && payload.endUser.id) {
            inMemoryStore.addNotification(payload.endUser.id, `Ticket #${payload.ticket.id} - ${payload.ticket.title} created`);
          }
          if (payload.technician && payload.technician.id) {
            inMemoryStore.addNotification(payload.technician.id, `A ticket was opened: ${payload.ticket.title}`);
          }
          if (payload.admin && payload.admin.id) {
            inMemoryStore.addNotification(payload.admin.id, `Ticket opened: ${payload.ticket.title}`);
          }
        } catch (e) {
          console.warn('In-memory store add failed', e);
        }
      }

      return res.status(201).json({ message: "Legacy event forwarded", routingKey });
    } catch (err) {
      console.error("Failed to publish legacy event:", err);
      return res.status(502).json({ error: "Failed to publish legacy event" });
    }
  });


  router.put("/:userId/mark-read", async (req, res) => {
  try {
    const { userId } = req.params;

    if (process.env.NO_DB === "true") {
      inMemoryStore.markAllRead(userId);
      return res.json({ message: "Notifications marked as read (in-memory)" });
    }

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

    if (process.env.NO_DB === "true") {
      const notifications = inMemoryStore.getNotifications(userId).sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt));
      return res.json(notifications);
    }

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