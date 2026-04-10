import nodemailer from 'nodemailer';
import { config } from '@config/index';
import { logger } from '@config/logger';

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.port === 465,
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

export interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export const sendEmail = async (options: EmailOptions): Promise<boolean> => {
  try {
    const mailOptions = {
      from: config.smtp.from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    };

    // Development mode: Log email to console instead of sending
    if (config.server.nodeEnv === 'development' || config.smtp.host === 'smtp.example.com') {
      logger.info('┌─────────────────────────────────────────────────────────────┐');
      logger.info('│ 📧 EMAIL (Development Mode - Not Actually Sent)            │');
      logger.info('├─────────────────────────────────────────────────────────────┤');
      logger.info(`│ To: ${options.to.padEnd(54)} │`);
      logger.info(`│ Subject: ${options.subject.padEnd(50)} │`);
      logger.info('├─────────────────────────────────────────────────────────────┤');
      logger.info(`│ ${(options.text || '').padEnd(58)} │`);
      logger.info('└─────────────────────────────────────────────────────────────┘');
      return true;
    }

    await transporter.sendMail(mailOptions);
    logger.info(`✅ Email sent successfully to: ${options.to}`);
    return true;
  } catch (error) {
    logger.error('❌ Failed to send email:', error);
    return false;
  }
};

export const sendOTPEmail = async (
  email: string,
  otp: string,
  purpose: 'VERIFICATION' | 'LOGIN'
): Promise<boolean> => {
  const subject = purpose === 'VERIFICATION' 
    ? 'Verify Your OpsMind Account' 
    : 'Your OpsMind Login OTP';

  const purposeText = purpose === 'VERIFICATION'
    ? 'verify your account'
    : 'complete your login';

  // Log OTP prominently in development mode
  if (config.server.nodeEnv === 'development' || config.smtp.host === 'smtp.example.com') {
    logger.info('╔═════════════════════════════════════════════════════════════╗');
    logger.info('║            🔐 OTP CODE (DEVELOPMENT MODE)                   ║');
    logger.info('╠═════════════════════════════════════════════════════════════╣');
    logger.info(`║  Email: ${email.padEnd(50)} ║`);
    logger.info(`║  Purpose: ${purpose.padEnd(48)} ║`);
    logger.info('╠═════════════════════════════════════════════════════════════╣');
    logger.info(`║           OTP CODE: ${otp.padEnd(40)} ║`);
    logger.info(`║           Valid for: ${config.otp.expiryMinutes} minutes${' '.repeat(37)} ║`);
    logger.info('╚═════════════════════════════════════════════════════════════╝');
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #2563eb; color: white; padding: 20px; text-align: center; }
        .content { padding: 30px; background-color: #f9fafb; }
        .otp-box { background-color: #2563eb; color: white; font-size: 32px; 
                   letter-spacing: 8px; padding: 20px; text-align: center; 
                   margin: 20px 0; border-radius: 8px; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        .warning { color: #dc2626; font-size: 14px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>OpsMind ITSM</h1>
        </div>
        <div class="content">
          <h2>Your One-Time Password</h2>
          <p>Use the following OTP to ${purposeText}:</p>
          <div class="otp-box">${otp}</div>
          <p>This OTP is valid for <strong>${config.otp.expiryMinutes} minutes</strong>.</p>
          <p class="warning">
            ⚠️ Do not share this code with anyone. OpsMind will never ask for your OTP.
          </p>
        </div>
        <div class="footer">
          <p>This is an automated message from OpsMind ITSM.</p>
          <p>If you didn't request this OTP, please ignore this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
    OpsMind ITSM - Your One-Time Password
    
    Use the following OTP to ${purposeText}: ${otp}
    
    This OTP is valid for ${config.otp.expiryMinutes} minutes.
    
    Do not share this code with anyone. OpsMind will never ask for your OTP.
    
    If you didn't request this OTP, please ignore this email.
  `;

  return sendEmail({ to: email, subject, html, text });
};
