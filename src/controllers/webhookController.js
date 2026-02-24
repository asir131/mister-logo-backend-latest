const crypto = require('crypto');
const Post = require('../models/Post');

const WEBHOOK_SECRET = process.env.OUTSTAND_WEBHOOK_SECRET;

function verifySignature(rawBody, signature) {
  if (!WEBHOOK_SECRET) return true;
  if (!rawBody || !signature) return false;
  const digest = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

function mapStatus(eventType) {
  switch (eventType) {
    case 'post.published':
      return 'sent';
    case 'post.failed':
      return 'failed';
    case 'post.scheduled':
      return 'pending';
    default:
      return null;
  }
}

async function outstandWebhook(req, res) {
  const signature = req.headers['x-outstand-signature'];
  const rawBody = req.rawBody;

  if (!verifySignature(rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid signature.' });
  }

  const payload = req.body || {};
  const eventType = payload.type || payload.event;
  const status = mapStatus(eventType);

  const data = payload.data || payload;
  const latePostId = data.postId || data.id;
  const platforms = data.platforms || [];
  const error = data.error || null;

  if (!latePostId || !platforms.length || !status) {
    return res.status(200).json({ received: true });
  }

  const updates = {};
  const now = new Date();
  const incs = {};

  platforms.forEach((platform) => {
    updates[`shareStatus.${platform}`] = {
      status,
      error,
      updatedAt: now,
    };
    if (status === 'failed') {
      incs[`attempts.${platform}`] = 1;
    }
  });

  const updateOps = { $set: updates };
  if (Object.keys(incs).length) {
    updateOps.$inc = incs;
  }

  await Post.updateOne({ latePostId }, updateOps);

  return res.status(200).json({ received: true });
}

module.exports = {
  outstandWebhook,
};
