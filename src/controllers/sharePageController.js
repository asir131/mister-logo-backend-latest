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

function buildOrigin(req) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  if (host) return `${protocol}://${host}`;
  return (process.env.APP_WEB_BASE_URL || '').replace(/\/$/, '');
}

function buildAppDeepLink(postId) {
  return `unap://screens/home/post-detail?postId=${encodeURIComponent(String(postId))}`;
}

function getGcsObjectPath(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    if (!['storage.googleapis.com', 'storage.cloud.google.com'].includes(parsed.hostname)) {
      return '';
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return '';
    return parts.slice(1).join('/');
  } catch {
    return '';
  }
}

function buildPlayableMediaUrl(req, mediaUrl) {
  const url = String(mediaUrl || '').trim();
  if (!url) return '';
  const origin = buildOrigin(req);
  if (!origin) return url;
  if (url.startsWith(`${origin}/media/`) || url.startsWith(`${origin}/media?`)) {
    return url;
  }
  const objectPath = getGcsObjectPath(url);
  if (!objectPath) return url;
  return `${origin}/media/${objectPath}`;
}

function getMimeType(mediaType, url) {
  const value = String(url || '').toLowerCase();
  if (mediaType === 'video') {
    if (value.includes('.mov')) return 'video/quicktime';
    if (value.includes('.webm')) return 'video/webm';
    return 'video/mp4';
  }
  if (mediaType === 'audio') {
    if (value.includes('.wav')) return 'audio/wav';
    if (value.includes('.m4a')) return 'audio/mp4';
    return 'audio/mpeg';
  }
  if (value.includes('.png')) return 'image/png';
  if (value.includes('.webp')) return 'image/webp';
  return 'image/jpeg';
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
    const appDeepLink = buildAppDeepLink(post._id);
    const mediaType = post.mediaType || '';
    const isVideo = mediaType === 'video';
    const isImage = mediaType === 'image';
    const isAudio = mediaType === 'audio';
    const mediaUrl = buildPlayableMediaUrl(req, post.mediaUrl);
    const previewImageUrl = buildPlayableMediaUrl(
      req,
      post.mediaPreviewUrl || (isImage ? post.mediaUrl : ''),
    );
    const mimeType = getMimeType(mediaType, mediaUrl);

    const escapedTitle = escapeHtml(title);
    const escapedDescription = escapeHtml(description);
    const escapedShareUrl = escapeHtml(shareUrl);
    const escapedAppDeepLink = escapeHtml(appDeepLink);
    const escapedMediaUrl = escapeHtml(mediaUrl);
    const escapedPreviewImageUrl = escapeHtml(previewImageUrl);
    const escapedAuthorName = escapeHtml(authorName);
    const escapedMimeType = escapeHtml(mimeType);

    return res.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle}</title>
    <meta property="og:title" content="${escapedTitle}" />
    <meta property="og:description" content="${escapedDescription}" />
    <meta property="og:url" content="${escapedShareUrl}" />
    <meta property="og:site_name" content="UNAP" />
    <meta property="og:type" content="${isVideo ? 'video.other' : 'article'}" />
    ${
      escapedPreviewImageUrl
        ? isVideo
          ? `<meta property="og:image" content="${escapedPreviewImageUrl}" />
    <meta property="og:image:secure_url" content="${escapedPreviewImageUrl}" />
    <meta property="og:image:type" content="image/jpeg" />
    <meta property="og:video" content="${escapedMediaUrl}" />
    <meta property="og:video:secure_url" content="${escapedMediaUrl}" />
    <meta property="og:video:type" content="${escapedMimeType}" />
    <meta property="og:video:width" content="720" />
    <meta property="og:video:height" content="1280" />`
          : `<meta property="og:image" content="${escapedPreviewImageUrl}" />
    <meta property="og:image:secure_url" content="${escapedPreviewImageUrl}" />
    <meta property="og:image:type" content="${escapedMimeType}" />`
        : ''
    }
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapedTitle}" />
    <meta name="twitter:description" content="${escapedDescription}" />
    ${escapedPreviewImageUrl ? `<meta name="twitter:image" content="${escapedPreviewImageUrl}" />` : ''}
    <style>
      :root {
        color-scheme: dark;
        --bg: #05070b;
        --panel: #0c111a;
        --panel-2: #111827;
        --text: #f8fafc;
        --muted: #a6adbb;
        --line: rgba(255, 255, 255, 0.12);
        --accent: #f97316;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at 20% 0%, rgba(249, 115, 22, 0.16), transparent 28rem),
          linear-gradient(180deg, #05070b 0%, #0b1020 100%);
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(920px, 100%);
        margin: 0 auto;
        padding: 20px;
      }
      .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 6px 0 18px;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        font-weight: 800;
        letter-spacing: 0;
      }
      .mark {
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border-radius: 8px;
        background: #fff;
        color: #05070b;
        font-weight: 900;
      }
      .open-app {
        border: 1px solid var(--line);
        color: var(--text);
        text-decoration: none;
        padding: 10px 14px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.06);
        font-weight: 700;
        white-space: nowrap;
      }
      .player {
        overflow: hidden;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: #000;
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.4);
      }
      video, img, audio {
        display: block;
        width: 100%;
      }
      video, img {
        max-height: min(78vh, 820px);
        object-fit: contain;
        background: #000;
      }
      audio {
        padding: 28px;
        background: var(--panel);
      }
      .meta {
        padding: 18px 2px 0;
      }
      h1 {
        margin: 0;
        font-size: clamp(24px, 4vw, 42px);
        line-height: 1.12;
        letter-spacing: 0;
      }
      .byline {
        margin: 10px 0 0;
        color: var(--muted);
        font-size: 15px;
      }
      .fallback {
        padding: 36px 20px;
        color: var(--muted);
        text-align: center;
        background: var(--panel);
      }
      .fallback a { color: var(--text); }
      @media (max-width: 560px) {
        main { padding: 14px; }
        .top { padding-bottom: 14px; }
        .open-app { padding: 9px 12px; font-size: 14px; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="top">
        <div class="brand">
          <div class="mark">U</div>
          <span>UNAP</span>
        </div>
        <a class="open-app" href="${escapedAppDeepLink}">Open in app</a>
      </div>
      <section class="player">
        ${
          isVideo && escapedMediaUrl
            ? `<video controls playsinline preload="metadata" poster="${escapedPreviewImageUrl}">
          <source src="${escapedMediaUrl}" type="${escapedMimeType}" />
          Your browser does not support video playback.
        </video>`
            : isImage && escapedMediaUrl
              ? `<img src="${escapedMediaUrl}" alt="${escapedTitle}" />`
              : isAudio && escapedMediaUrl
                ? `<audio controls preload="metadata">
          <source src="${escapedMediaUrl}" type="${escapedMimeType}" />
          Your browser does not support audio playback.
        </audio>`
                : `<div class="fallback">This UNAP post is available in the app.</div>`
        }
      </section>
      <section class="meta">
        <h1>${escapedTitle}</h1>
        <p class="byline">Shared by ${escapedAuthorName}</p>
      </section>
    </main>
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
