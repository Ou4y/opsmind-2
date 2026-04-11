const Notification = require("../models/Notification");

async function sendInAppNotification(userId, message) {
  //store in MongoDB
  await Notification.create({
    userId,
    message

  });

  
  console.log(`In-App → User ${userId}: ${message}`);
}

module.exports = { sendInAppNotification };
