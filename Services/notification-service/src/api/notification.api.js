const express = require("express");
const jwt = require("jsonwebtoken");
const Notification = require("../models/Notification");
const inMemoryStore = require("../inMemoryStore");

const INTERNAL_SECRET = String(process.env.INTERNAL_SECRET || process.env.NOTIFICATION_INTERNAL_SECRET || "").trim();
const JWT_SECRET = String(process.env.JWT_SECRET || "").trim();
const SUPPORT_ROLES = new Set([
  "ADMIN",
  "SUPERVISOR",
  "TECHNICIAN",
  "JUNIOR",
  "SENIOR",
  "SYSTEM_ADMIN",
  "ADMINISTRATOR",
  "HEAD_OF_IT",
  "IT_ADMIN",
]);

function isWeakSecret(secret) {
  const normalized = String(secret || "").trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.length < 32) return true;
  if (normalized.includes("set_strong")) return true;
  if (normalized.includes("replace_with")) return true;
  if (normalized.includes("placeholder")) return true;
  return false;
}

function toOptionalString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeRoles(payload) {
  const source = payload?.roles ?? payload?.role ?? [];
  if (Array.isArray(source)) {
    return source.map((role) => String(role || "").trim().toUpperCase()).filter(Boolean);
  }

  const one = String(source || "").trim().toUpperCase();
  return one ? [one] : [];
}

function resolveJwtAuth(req) {
  if (!JWT_SECRET) {
    return null;
  }

  const header = toOptionalString(req.headers.authorization);
  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }

  try {
    const payload = jwt.verify(header.slice("Bearer ".length), JWT_SECRET);
    const userId = toOptionalString(payload?.userId ?? payload?.id ?? payload?.sub);
    if (!userId) {
      return null;
    }

    return {
      type: "jwt",
      userId,
      roles: normalizeRoles(payload),
    };
  } catch {
    return null;
  }
}

function hasInternalAccess(req) {
  if (!INTERNAL_SECRET) {
    return false;
  }

  const provided = toOptionalString(req.headers["x-internal-secret"] || req.headers["x-internal-token"]);
  return Boolean(provided && provided === INTERNAL_SECRET);
}

function isSupportRole(roles) {
  return (Array.isArray(roles) ? roles : []).some((role) => SUPPORT_ROLES.has(String(role || "").toUpperCase()));
}

function requireInternalAccess(req, res, next) {
  if (!INTERNAL_SECRET) {
    return res.status(500).json({ error: "Notification internal secret is not configured" });
  }

  if (!hasInternalAccess(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return next();
}

function requireUserReadAccess(req, res, next) {
  if (hasInternalAccess(req)) {
    return next();
  }

  const nodeEnv = String(process.env.NODE_ENV || "development");
  if (!JWT_SECRET || (nodeEnv !== "development" && isWeakSecret(JWT_SECRET))) {
    return res.status(500).json({ error: "Server authentication misconfiguration" });
  }

  const auth = resolveJwtAuth(req);
  if (!auth) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const targetUserId = toOptionalString(req.params.userId);
  if (!targetUserId) {
    return res.status(400).json({ error: "userId is required" });
  }

  if (auth.userId !== targetUserId && !isSupportRole(auth.roles)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  return next();
}

function setNotificationAPI(channel, exchange) {
  const router = express.Router();

  // Health api
  router.get("/health", (_req, res) => {
    res.json({ service: "Notification Service", status: "UP" });
  });

  router.post("/events", requireInternalAccess, (req, res) => {
    const { routingKey, payload } = req.body;

    if (!routingKey || typeof routingKey !== "string") {
      return res.status(422).json({ error: "Missing (or) invalid routingKey" });
    }

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
  router.post("/", requireInternalAccess, (req, res) => {
    const { type, payload } = req.body;
    if (!type || !payload) {
      return res.status(422).json({ error: "Missing type or payload" });
    }

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

      if (process.env.NO_DB === "true") {
        try {
          if (payload.endUser && payload.endUser.id) {
            inMemoryStore.addNotification(
              payload.endUser.id,
              `Ticket #${payload.ticket.id} - ${payload.ticket.title} created`
            );
          }
          if (payload.technician && payload.technician.id) {
            inMemoryStore.addNotification(payload.technician.id, `A ticket was opened: ${payload.ticket.title}`);
          }
          if (payload.admin && payload.admin.id) {
            inMemoryStore.addNotification(payload.admin.id, `Ticket opened: ${payload.ticket.title}`);
          }
        } catch (error) {
          console.warn("In-memory store add failed", error);
        }
      }

      return res.status(201).json({ message: "Legacy event forwarded", routingKey });
    } catch (err) {
      console.error("Failed to publish legacy event:", err);
      return res.status(502).json({ error: "Failed to publish legacy event" });
    }
  });

  router.put("/:userId/mark-read", requireUserReadAccess, async (req, res) => {
    try {
      const { userId } = req.params;

      if (process.env.NO_DB === "true") {
        inMemoryStore.markAllRead(userId);
        return res.json({ message: "Notifications marked as read (in-memory)" });
      }

      await Notification.updateMany({ userId, read: false }, { $set: { read: true } });

      return res.json({ message: "Notifications marked as read" });
    } catch (_err) {
      return res.status(500).json({ error: "Failed to mark as read" });
    }
  });

  router.get("/:userId", requireUserReadAccess, async (req, res) => {
    try {
      const { userId } = req.params;

      if (process.env.NO_DB === "true") {
        const notifications = inMemoryStore
          .getNotifications(userId)
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return res.json(notifications);
      }

      const notifications = await Notification.find({ userId }).sort({ createdAt: -1 });
      return res.json(notifications);
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
      return res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  return router;
}

module.exports = setNotificationAPI;
