const express = require("express");
const router = express.Router();
const controller = require("../controllers/notification.controller");
const authMiddleware = require("../middlewares/auth.middleware");

router.post("/", authMiddleware, controller.sendNotification);

router.get("/:userId", controller.getUserNotifications);

router.get("/:userId/unread-count", controller.getUnreadCount);

router.patch("/:id/read", controller.markAsRead);

router.patch("/user/:userId/read-all", controller.markAllAsRead);

module.exports = router;
