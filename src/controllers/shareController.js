const { sharePostInternal } = require('./postController');
const { shareUblastInternal } = require('./ublastController');
const Post = require('../models/Post');
const User = require('../models/User');
const Profile = require('../models/Profile');
const { sendEmail } = require('../services/emailService');
const { sendSms } = require('../services/smsService');

function buildShareUrl(req, postId) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  if (host) {
    return `${protocol}://${host}/share/post/${postId}`;
  }
  const fallbackBase = process.env.APP_WEB_BASE_URL || '';
  return fallbackBase ? `${fallbackBase.replace(/\/$/, '')}/share/post/${postId}` : '';
}

function buildProfileShareUrl(req, profile) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const base =
    host
      ? `${protocol}://${host}`
      : (process.env.APP_WEB_BASE_URL || '').replace(/\/$/, '');
  if (!base) return '';
  const username = String(profile?.username || '').replace(/^@/, '').trim();
  if (username) return `${base}/u/${encodeURIComponent(username)}`;
  const userId = String(profile?.userId || profile?._id || '').trim();
  return userId ? `${base}/profile/${encodeURIComponent(userId)}` : '';
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function normalizePhone(value) {
  return String(value || '').trim().replace(/[^\d+]/g, '');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function getSharePostPayload(req, postId) {
  const post = await Post.findById(postId).select('_id userId description postType').lean();
  if (!post) return null;

  const [author, profile] = await Promise.all([
    User.findById(post.userId).select('name').lean(),
    Profile.findOne({ userId: post.userId }).select('displayName username').lean(),
  ]);

  const authorName = profile?.displayName || profile?.username || author?.name || 'Someone';
  const description =
    String(post.description || '').trim() ||
    `Check out this ${post.postType || 'post'} on UNAP.`;
  const shareUrl = buildShareUrl(req, post._id);

  return {
    authorName,
    description,
    shareUrl,
  };
}

async function getShareProfilePayload(req, { profileUserId, title, url }) {
  let profile = null;
  let user = null;
  if (profileUserId) {
    [profile, user] = await Promise.all([
      Profile.findOne({ userId: profileUserId })
        .select('userId displayName username bio profileImageUrl')
        .lean(),
      User.findById(profileUserId).select('name').lean(),
    ]);
  }

  const displayName =
    profile?.displayName ||
    profile?.username ||
    user?.name ||
    String(title || '').trim() ||
    'UNAP profile';
  const shareUrl =
    String(url || '').trim() ||
    (profile ? buildProfileShareUrl(req, profile) : '');

  if (!shareUrl) return null;

  return {
    displayName,
    description: 'Check out this profile on UNAP.',
    shareUrl,
  };
}

async function shareUnified(req, res) {
  const { id: userId } = req.user;
  const { type, id, shareType, postId, ublastId, target } = req.body;

  const resolvedPostId = postId || (type === 'post' ? id : null);
  const resolvedUblastId = ublastId || (type === 'ublast' ? id : null);

  if (resolvedPostId) {
    const result = await sharePostInternal({
      userId,
      postId: resolvedPostId,
      target,
    });
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.status(201).json({
      post: result.post,
      sharedFromUblast: false,
      message: result.message || result.warning,
      warning: result.warning,
    });
  }

  if (resolvedUblastId) {
    const result = await shareUblastInternal({ userId, ublastId: resolvedUblastId, shareType });
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.status(200).json({ post: result.post, sharedFromUblast: true });
  }

  if (!id) {
    return res.status(400).json({ error: 'postId, ublastId, or id is required.' });
  }

  const ublastResult = await shareUblastInternal({ userId, ublastId: id, shareType });
  if (!ublastResult.error) {
    return res.status(200).json({ post: ublastResult.post, sharedFromUblast: true });
  }

  const postResult = await sharePostInternal({ userId, postId: id, target });
  if (!postResult.error) {
    return res.status(201).json({
      post: postResult.post,
      sharedFromUblast: false,
      message: postResult.message || postResult.warning,
      warning: postResult.warning,
    });
  }

  return res.status(400).json({ error: 'Invalid share request.' });
}

async function sharePostByEmail(req, res) {
  try {
    const { postId, email } = req.body || {};
    if (!postId) {
      return res.status(400).json({ error: 'postId is required.' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Valid email is required.' });
    }

    const payload = await getSharePostPayload(req, postId);
    if (!payload) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    await sendEmail({
      to: String(email).trim(),
      subject: `${payload.authorName} shared a UNAP post with you`,
      text: `${payload.description}\n\nOpen on UNAP:\n${payload.shareUrl}`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
          <h2 style="margin:0 0 12px">UNAP Post</h2>
          <p>${escapeHtml(payload.authorName)} shared a post with you.</p>
          <p>${escapeHtml(payload.description)}</p>
          <p><a href="${escapeHtml(payload.shareUrl)}" style="display:inline-block;background:#111;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none">Open Post</a></p>
          <p style="font-size:12px;color:#666">${escapeHtml(payload.shareUrl)}</p>
        </div>
      `,
    });

    return res.status(200).json({ message: 'Post link sent by email.' });
  } catch (err) {
    console.error('Share email failed:', err?.message || err);
    return res.status(err?.status || 502).json({
      error:
        'Email delivery failed. Please check SMTP username/password and try again.',
    });
  }
}

async function sharePostBySms(req, res) {
  const { postId, phoneNumber, type, profileUserId, title, url } = req.body || {};

  const to = normalizePhone(phoneNumber);
  if (!/^\+\d{8,15}$/.test(to)) {
    return res.status(400).json({ error: 'Phone number must include country code.' });
  }

  const isProfileShare = type === 'profile';
  if (!isProfileShare && !postId) {
    return res.status(400).json({ error: 'postId is required.' });
  }

  const payload = isProfileShare
    ? await getShareProfilePayload(req, { profileUserId, title, url })
    : await getSharePostPayload(req, postId);
  if (!payload) {
    return res.status(404).json({ error: isProfileShare ? 'Profile not found.' : 'Post not found.' });
  }

  await sendSms({
    to,
    body: isProfileShare
      ? `${payload.description} ${payload.displayName}: ${payload.shareUrl}`
      : `${payload.authorName} shared a UNAP post: ${payload.shareUrl}`,
  });

  return res.status(200).json({ message: isProfileShare ? 'Profile link sent by SMS.' : 'Post link sent by SMS.' });
}

module.exports = {
  shareUnified,
  sharePostByEmail,
  sharePostBySms,
};
