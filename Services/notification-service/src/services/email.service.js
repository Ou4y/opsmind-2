//handel email
const transporter = require("../config/mailer");

async function sendEmail(to, subject, text) {
  if (!to) {
    console.warn(`Email not sent. Recipient is missing for subject: "${subject}"`);
    return;
  }

  await transporter.sendMail({
    from: `"OpsMind Notifications" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text
  });

  console.log(`Email sent to ${to}`);
}

module.exports = { sendEmail };
