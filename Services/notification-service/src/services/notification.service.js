const { sendEmail } = require("./email.service");
const { sendInAppNotification } = require("./inApp.service");
const buildMessage = require("../utils/message.builder");

exports.handle = async (type, payload) => {

  const notifications = buildMessage(type, payload);

  for (const n of notifications) {

    await sendInAppNotification(n.userId, n.message, type);

    if (n.email) {
      await sendEmail(n.email, n.subject, n.message);
    }
  }
};
