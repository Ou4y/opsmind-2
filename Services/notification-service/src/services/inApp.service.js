const Notification = require("../models/notification.model");

exports.sendInAppNotification = async (userId, message, type) => {
  try {
    const notification = await Notification.create({
      userId,
      message,
      type
    });

    console.log(" In-App Notification Saved:", notification._id);

    return notification;

  } catch (error) {
    console.error(" Failed to save In-App Notification:", error.message);
    throw error; 
  }
};
