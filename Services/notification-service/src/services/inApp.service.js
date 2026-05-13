const Notification = require("../models/Notification");
const inMemoryStore = require("../inMemoryStore");

async function sendInAppNotification(userId, message) {
  // If running tests without DB writes, keep notifications in-memory
  if (process.env.NO_DB === "true") {
    inMemoryStore.addNotification(userId, message);
    console.log(`In-App (IN-MEM) → User ${userId}: ${message}`);
    return;
  }

  // store in MongoDB
  await Notification.create({
    userId,
    message
  });

  console.log(`In-App → User ${userId}: ${message}`);
}

module.exports = { sendInAppNotification };
