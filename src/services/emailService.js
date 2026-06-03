const nodemailer = require('nodemailer');

const {
  EMAIL_HOST,
  EMAIL_PORT,
  EMAIL_USER,
  EMAIL_PASS,
  EMAIL_FROM,
  EMAIL_SECURE,
  EMAIL_TLS_SERVERNAME,
} = process.env;

const port = Number(EMAIL_PORT) || 587;
const secure =
  String(EMAIL_SECURE || '').toLowerCase() === 'true' || port === 465;

const transporter = nodemailer.createTransport({
  host: EMAIL_HOST,
  port,
  secure,
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
