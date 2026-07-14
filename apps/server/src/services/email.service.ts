import nodemailer from 'nodemailer';
import { logger } from '../utils/logger';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT ?? '587', 10),
  secure: parseInt(process.env.SMTP_PORT ?? '587', 10) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM = `"${process.env.SMTP_FROM_NAME ?? 'EZ- Restaurant'}" <${
  process.env.SMTP_FROM_EMAIL ?? 'noreply@qrrestaurant.com'
}>`;

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  try {
    await transporter.sendMail({ from: FROM, to, subject, html });
    logger.info(`Email sent to ${to}: ${subject}`);
  } catch (error) {
    logger.error(`Failed to send email to ${to}:`, error);
    throw new Error('Failed to send email. Please try again.');
  }
}

export async function sendVerificationEmail(
  to: string,
  name: string,
  token: string
): Promise<void> {
  const verifyUrl = `${process.env.CLIENT_URL}/verify-email?token=${token}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><style>
      body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
      .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 20px rgba(0,0,0,0.1); }
      .header { background: linear-gradient(135deg, #E85D04, #F48C06); padding: 40px 30px; text-align: center; }
      .header h1 { color: white; margin: 0; font-size: 28px; }
      .body { padding: 40px 30px; }
      .btn { display: inline-block; background: #E85D04; color: white !important; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; }
      .footer { background: #f9f9f9; padding: 20px 30px; text-align: center; color: #888; font-size: 12px; }
    </style></head>
    <body>
      <div class="container">
        <div class="header"><h1>🍽️ EZ- Restaurant</h1></div>
        <div class="body">
          <h2>Verify your email, ${name}!</h2>
          <p>Thanks for signing up. Click the button below to verify your email address and get started.</p>
          <p style="text-align: center; margin: 30px 0;">
            <a href="${verifyUrl}" class="btn">Verify Email Address</a>
          </p>
          <p style="color: #888; font-size: 14px;">This link expires in 24 hours. If you didn't sign up, you can safely ignore this email.</p>
        </div>
        <div class="footer"><p>© 2024 EZ- Restaurant SaaS. All rights reserved.</p></div>
      </div>
    </body>
    </html>
  `;
  await sendEmail(to, 'Verify your EZ- Restaurant account', html);
}

export async function sendPasswordResetEmail(
  to: string,
  name: string,
  token: string
): Promise<void> {
  const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${token}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><style>
      body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
      .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; }
      .header { background: linear-gradient(135deg, #E85D04, #F48C06); padding: 40px 30px; text-align: center; }
      .header h1 { color: white; margin: 0; font-size: 28px; }
      .body { padding: 40px 30px; }
      .btn { display: inline-block; background: #E85D04; color: white !important; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; }
    </style></head>
    <body>
      <div class="container">
        <div class="header"><h1>🔐 Password Reset</h1></div>
        <div class="body">
          <h2>Reset your password, ${name}</h2>
          <p>We received a request to reset your password. Click the button below to choose a new password.</p>
          <p style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" class="btn">Reset Password</a>
          </p>
          <p style="color: #888; font-size: 14px;">This link expires in 1 hour. If you didn't request this, please ignore this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;
  await sendEmail(to, 'Reset your EZ- Restaurant password', html);
}

export async function sendOrderConfirmationEmail(
  to: string,
  name: string,
  orderId: string,
  restaurantName: string,
  total: number
): Promise<void> {
  const trackUrl = `${process.env.CLIENT_URL}/orders/${orderId}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><style>
      body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
      .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; }
      .header { background: linear-gradient(135deg, #16a34a, #22c55e); padding: 40px 30px; text-align: center; }
      .header h1 { color: white; margin: 0; font-size: 28px; }
      .body { padding: 40px 30px; }
      .order-info { background: #f9f9f9; border-radius: 8px; padding: 20px; margin: 20px 0; }
      .btn { display: inline-block; background: #16a34a; color: white !important; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; }
    </style></head>
    <body>
      <div class="container">
        <div class="header"><h1>✅ Order Confirmed!</h1></div>
        <div class="body">
          <h2>Hi ${name},</h2>
          <p>Your order has been confirmed! Here's a summary:</p>
          <div class="order-info">
            <p><strong>Order ID:</strong> #${orderId.slice(-8).toUpperCase()}</p>
            <p><strong>Restaurant:</strong> ${restaurantName}</p>
            <p><strong>Total:</strong> ₹${total.toFixed(2)}</p>
          </div>
          <p style="text-align: center; margin: 30px 0;">
            <a href="${trackUrl}" class="btn">Track Your Order</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
  await sendEmail(to, `Order confirmed - ${restaurantName}`, html);
}
