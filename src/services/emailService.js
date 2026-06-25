const nodemailer = require('nodemailer');

const {
  EMAIL_HOST,
  EMAIL_PORT,
  EMAIL_USER,
  EMAIL_PASS,
  EMAIL_FROM,
  EMAIL_SECURE,
  EMAIL_TLS_SERVERNAME,
  EMAIL_POOL,
  EMAIL_MAX_CONNECTIONS,
  EMAIL_MAX_MESSAGES,
  EMAIL_CONNECTION_TIMEOUT_MS,
  EMAIL_GREETING_TIMEOUT_MS,
  EMAIL_SOCKET_TIMEOUT_MS,
} = process.env;

const port = Number(EMAIL_PORT) || 587;
const secure =
  String(EMAIL_SECURE || '').toLowerCase() === 'true' || port === 465;
const pool = String(EMAIL_POOL || 'true').toLowerCase() !== 'false';

const transporter = nodemailer.createTransport({
  pool,
  host: EMAIL_HOST,
  port,
  secure,
  maxConnections: Number(EMAIL_MAX_CONNECTIONS) || 3,
  maxMessages: Number(EMAIL_MAX_MESSAGES) || 100,
  connectionTimeout: Number(EMAIL_CONNECTION_TIMEOUT_MS) || 10000,
  greetingTimeout: Number(EMAIL_GREETING_TIMEOUT_MS) || 10000,
  socketTimeout: Number(EMAIL_SOCKET_TIMEOUT_MS) || 30000,
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS,
  },
  tls: EMAIL_TLS_SERVERNAME ? { servername: EMAIL_TLS_SERVERNAME } : undefined,
});

async function sendOtpEmail(to, otp) {
  const mailOptions = {
    from: EMAIL_FROM || EMAIL_USER,
    to,
    subject: 'Your verification code',
    text: `Your verification code is ${otp}. It expires in 10 minutes.`,
  };

  return transporter.sendMail(mailOptions);
}

async function sendEmail({ to, subject, text, html }) {
  const mailOptions = {
    from: EMAIL_FROM || EMAIL_USER,
    to,
    subject,
    text,
    html,
  };
  return transporter.sendMail(mailOptions);
}

module.exports = {
  sendOtpEmail,
  sendEmail,
};
