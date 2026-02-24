const Post = require('../models/Post');
const User = require('../models/User');
const Profile = require('../models/Profile');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildShareUrl(req, postId) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  if (host) {
    return `${protocol}://${host}/share/${postId}`;
  }
  const fallbackBase = process.env.APP_WEB_BASE_URL || '';
  return fallbackBase ? `${fallbackBase.replace(/\/$/, '')}/share/${postId}` : '';
}

async function sharePage(req, res) {
  try {
    const { postId } = req.params;
    const post = await Post.findById(postId).lean();
    if (!post) {
      return res.status(404).send('Not found');
    }

    const [author, profile] = await Promise.all([
      User.findById(post.userId).select('name').lean(),
      Profile.findOne({ userId: post.userId }).select('displayName').lean(),
    ]);

    const authorName = profile?.displayName || author?.name || 'UNAP';
    const title = post.description || 'UNAP Post';
    const description = `Shared by ${authorName}`;
    const shareUrl = buildShareUrl(req, post._id);
    const mediaUrl = post.mediaUrl || '';
    const mediaType = post.mediaType || '';
    const isVideo = mediaType === 'video';

    const escapedTitle = escapeHtml(title);
    const escapedDescription = escapeHtml(description);
    const escapedShareUrl = escapeHtml(shareUrl);
    const escapedMediaUrl = escapeHtml(mediaUrl);

    return res.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle}</title>
    <meta property="og:title" content="${escapedTitle}" />
    <meta property="og:description" content="${escapedDescription}" />
    <meta property="og:url" content="${escapedShareUrl}" />
    <meta property="og:type" content="website" />
    ${
      escapedMediaUrl
        ? isVideo
          ? `<meta property="og:video" content="${escapedMediaUrl}" />
    <meta property="og:video:secure_url" content="${escapedMediaUrl}" />
    <meta property="og:video:type" content="video/mp4" />`
          : `<meta property="og:image" content="${escapedMediaUrl}" />
    <meta property="og:image:secure_url" content="${escapedMediaUrl}" />
    <meta property="og:image:type" content="image/jpeg" />`
        : ''
    }
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapedTitle}" />
    <meta name="twitter:description" content="${escapedDescription}" />
    ${escapedMediaUrl ? `<meta name="twitter:image" content="${escapedMediaUrl}" />` : ''}
  </head>
  <body>
    <p>Shared from UNAP</p>
  </body>
</html>`);
  } catch (err) {
    console.error('Share page error:', err);
    return res.status(500).send('Error');
  }
}

module.exports = {
  sharePage,
  async shareXLink(req, res) {
    try {
      const { postId } = req.params;
      const post = await Post.findById(postId).select("_id").lean();
      if (!post) {
        return res.status(404).json({ error: "Not found" });
      }
      const shareUrl = buildShareUrl(req, post._id);
      return res.status(200).json({ shareUrl });
    } catch (err) {
      console.error("Share link error:", err);
      return res.status(500).json({ error: "Could not generate share URL." });
    }
  },
};
