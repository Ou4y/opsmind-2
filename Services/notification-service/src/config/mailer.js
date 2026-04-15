//for emails
const nodemailer = require("nodemailer");

const transportOptions = {
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 1025,
  secure: false,
};

// MailHog (and many local SMTP relays) don't require SMTP AUTH.
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  transportOptions.auth = {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  };
}

const transporter = nodemailer.createTransport(transportOptions);

module.exports = transporter;
