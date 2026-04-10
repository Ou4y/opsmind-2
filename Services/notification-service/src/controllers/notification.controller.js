const Notification = require("../models/notification.model");
const notificationService = require("../services/notification.service");

exports.sendNotification = async (req, res, next) => {
  try {
    const { type, payload } = req.body;

    await notificationService.handle(type, payload);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

exports.getUserNotifications = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const notifications = await Notification.find({ userId })
      .sort({ createdAt: -1 });

    res.json(notifications);
  } catch (err) {
    next(err);
  }
};

exports.markAllAsRead = async (req, res, next) => {
  try {
    const { userId } = req.params;

    await Notification.updateMany(
      { userId, read: false },
      { read: true }
    );

    res.status(200).json({
      success: true,
      message: "All notifications marked as read"
    });

  } catch (error) {
    next(error);
  }
};

exports.markAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;

    await Notification.findByIdAndUpdate(id, { read: true });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

exports.getUnreadCount = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const count = await Notification.countDocuments({
      userId,
      read: false
    });

    res.json({ unread: count });
  } catch (err) {
    next(err);
  }
};
