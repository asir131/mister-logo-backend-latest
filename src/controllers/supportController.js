const { validationResult } = require('express-validator');
const { sendEmail } = require('../services/emailService');
const SupportThread = require('../models/SupportThread');
const SupportMessage = require('../models/SupportMessage');

function parsePaging(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed <= 0) return fallback;
  if (max && parsed > max) return max;
  return parsed;
}

async function sendSupportMessage(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const subject = String(req.body?.subject || '').trim();
  const content = String(req.body?.content || '').trim();
  if (!subject || !content) {
    return res.status(400).json({ error: 'Subject and discussion are required.' });
  }

  const user = req.user || {};
  const senderEmail = user.email || 'unknown';
  const senderId = user.id || 'unknown';
  const to = process.env.ADMIN_EMAIL || process.env.EMAIL_FROM || process.env.EMAIL_USER;
  if (!to) {
    return res.status(500).json({ error: 'Admin email is not configured.' });
  }

  const now = new Date();
  const thread = await SupportThread.findOneAndUpdate(
    { userId: senderId },
    {
      $set: {
        status: 'pending',
        lastMessageAt: now,
        lastSubject: subject,
      },
      $setOnInsert: { userId: senderId },
    },
    { new: true, upsert: true },
  );

  await SupportMessage.create({
    threadId: thread._id,
    userId: senderId,
    subject,
    content,
  });

  const text = `Support message from user ${senderId} (${senderEmail}):\n\n${content}`;
  await sendEmail({
    to,
    subject: `[Support] ${subject}`,
    text,
  });

  return res.status(200).json({ message: 'Support message sent.' });
}

async function listMyThreads(req, res) {
  const userId = req.user?.id;
  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 20, 100);
  const skip = (page - 1) * limit;

  const [totalCount, threads] = await Promise.all([
    SupportThread.countDocuments({ userId }),
    SupportThread.find({ userId })
      .sort({ lastMessageAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  return res.status(200).json({
    threads,
    page,
    totalPages,
    totalCount,
  });
}

async function listMyMessages(req, res) {
  const userId = req.user?.id;
  const { threadId } = req.params;
  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 20, 200);
  const skip = (page - 1) * limit;

  const thread = await SupportThread.findOne({ _id: threadId, userId }).lean();
  if (!thread) {
    return res.status(404).json({ error: 'Thread not found.' });
  }

  const [totalCount, messages] = await Promise.all([
    SupportMessage.countDocuments({ threadId, userId }),
    SupportMessage.find({ threadId, userId })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  return res.status(200).json({
    thread,
    messages,
    page,
    totalPages,
    totalCount,
  });
}

module.exports = {
  sendSupportMessage,
  listMyThreads,
  listMyMessages,
};
