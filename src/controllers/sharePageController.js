const Post = require('../models/Post');
const Ucut = require('../models/Ucut');
const User = require('../models/User');
const Profile = require('../models/Profile');
const mongoose = require('mongoose');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildShareUrl(req, postId, contentType = 'post') {
  const path =
    contentType === 'uclips'
      ? `/share/uclips/${postId}`
      : contentType === 'ucuts'
        ? `/share/ucuts/${postId}`
        : `/share/post/${postId}`;
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  if (host) {
    return `${protocol}://${host}${path}`;
  }
  const fallbackBase = process.env.APP_WEB_BASE_URL || '';
  return fallbackBase ? `${fallbackBase.replace(/\/$/, '')}${path}` : '';
}

function buildProfileShareUrl(req, profile) {
  const identifier = String(profile?.username || profile?.userId || profile?._id || '').trim();
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const path = profile?.username
    ? `/u/${encodeURIComponent(identifier)}`
    : `/profile/${encodeURIComponent(identifier)}`;
  if (host) {
    return `${protocol}://${host}${path}`;
  }
  const fallbackBase = process.env.APP_WEB_BASE_URL || '';
  return fallbackBase ? `${fallbackBase.replace(/\/$/, '')}${path}` : '';
}

function buildOrigin(req) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  if (host) return `${protocol}://${host}`;
  return (process.env.APP_WEB_BASE_URL || '').replace(/\/$/, '');
}

function buildAbsoluteUrl(req, path) {
  const origin = buildOrigin(req);
  return origin ? `${origin}${path}` : path;
}

function buildShareImageUrl(req) {
  return buildAbsoluteUrl(req, '/assets/unap-share-thumbnail.jpg?v=2');
}

function buildAppDeepLink(postId, contentType = 'post') {
  if (contentType === 'uclips') {
    return `unap://screens/home/uclip-detail?postId=${encodeURIComponent(String(postId))}`;
  }
  if (contentType === 'ucuts') {
    return `unap://screens/home/ucut-detail?ucutId=${encodeURIComponent(String(postId))}`;
  }
  return `unap://screens/home/post-detail?postId=${encodeURIComponent(String(postId))}`;
}

function buildProfileAppDeepLink(userId) {
  return `unap://screens/profile/other-profile?id=${encodeURIComponent(String(userId))}`;
}

function buildStoreFallbackUrl(req, store = '', target = '') {
  const origin = buildOrigin(req);
  const suffix = store ? `/${encodeURIComponent(store)}` : '';
  const query = target ? `?target=${encodeURIComponent(target)}` : '';
  return origin ? `${origin}/download${suffix}${query}` : `/download${suffix}${query}`;
}

function buildAndroidIntentUrl(postId, fallbackUrl, contentType = 'post') {
  const path =
    contentType === 'uclips'
      ? `screens/home/uclip-detail?postId=${encodeURIComponent(String(postId))}`
      : contentType === 'ucuts'
        ? `screens/home/ucut-detail?ucutId=${encodeURIComponent(String(postId))}`
        : `screens/home/post-detail?postId=${encodeURIComponent(String(postId))}`;
  return `intent://${path}#Intent;scheme=unap;package=com.mdalifk2002.UNAP;S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;
}

function buildProfileAndroidIntentUrl(userId, fallbackUrl) {
  const path = `screens/profile/other-profile?id=${encodeURIComponent(String(userId))}`;
  return `intent://${path}#Intent;scheme=unap;package=com.mdalifk2002.UNAP;S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;
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
    const requestedContentType = String(req.shareContentType || '').trim();
    const contentType =
      requestedContentType ||
      (post.postType === 'uclip' ? 'uclips' : 'post');
    if (contentType === 'uclips' && post.postType !== 'uclip') {
      return res.status(404).send('Not found');
    }
    if (contentType === 'post' && post.postType === 'uclip') {
      return res.status(404).send('Not found');
    }

    const [author, profile] = await Promise.all([
      User.findById(post.userId).select('name').lean(),
      Profile.findOne({ userId: post.userId }).select('displayName').lean(),
    ]);

    const authorName = profile?.displayName || author?.name || 'UNAP';
    const title = post.description || (contentType === 'uclips' ? 'UNAP UClip' : 'UNAP Post');
    const description = `Shared by ${authorName}`;
    const shareUrl = buildShareUrl(req, post._id, contentType);
    const appDeepLink = buildAppDeepLink(post._id, contentType);
    const androidFallbackUrl = buildStoreFallbackUrl(req, 'android', appDeepLink);
    const iosFallbackUrl = buildStoreFallbackUrl(req, 'ios', appDeepLink);
    const defaultFallbackUrl = buildStoreFallbackUrl(req, '', appDeepLink);
    const androidIntentUrl = buildAndroidIntentUrl(post._id, androidFallbackUrl, contentType);
    const mediaType = post.mediaType || '';
    const isVideo = mediaType === 'video';
    const isImage = mediaType === 'image';
    const isAudio = mediaType === 'audio';
    const mediaUrl = buildPlayableMediaUrl(req, post.mediaUrl);
    const fallbackImageUrl = buildShareImageUrl(req);
    const previewImageUrl = buildPlayableMediaUrl(
      req,
      post.mediaPreviewUrl || (isImage ? post.mediaUrl : ''),
    ) || fallbackImageUrl;
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
    <meta name="apple-itunes-app" content="app-argument=${escapedAppDeepLink}" />
    <meta itemprop="name" content="${escapedTitle}" />
    <meta itemprop="description" content="${escapedDescription}" />
    <meta itemprop="image" content="${escapedPreviewImageUrl}" />
    ${
      escapedPreviewImageUrl
        ? isVideo
          ? `<meta property="og:image" content="${escapedPreviewImageUrl}" />
    <meta property="og:image:url" content="${escapedPreviewImageUrl}" />
    <meta property="og:image:secure_url" content="${escapedPreviewImageUrl}" />
    <meta property="og:image:type" content="image/jpeg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="UNAP post preview" />
    <meta property="og:video" content="${escapedMediaUrl}" />
    <meta property="og:video:secure_url" content="${escapedMediaUrl}" />
    <meta property="og:video:type" content="${escapedMimeType}" />
    <meta property="og:video:width" content="720" />
    <meta property="og:video:height" content="1280" />`
          : `<meta property="og:image" content="${escapedPreviewImageUrl}" />
    <meta property="og:image:url" content="${escapedPreviewImageUrl}" />
    <meta property="og:image:secure_url" content="${escapedPreviewImageUrl}" />
    <meta property="og:image:type" content="${isImage && mediaUrl ? escapedMimeType : 'image/jpeg'}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="UNAP post preview" />`
        : ''
    }
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapedTitle}" />
    <meta name="twitter:description" content="${escapedDescription}" />
    ${escapedPreviewImageUrl ? `<meta name="twitter:image" content="${escapedPreviewImageUrl}" />` : ''}
    ${escapedPreviewImageUrl ? `<meta name="twitter:image:alt" content="UNAP post preview" />` : ''}
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
    <script>
      (function () {
        var deepLink = ${JSON.stringify(appDeepLink)};
        var androidIntent = ${JSON.stringify(androidIntentUrl)};
        var androidFallback = ${JSON.stringify(androidFallbackUrl)};
        var iosFallback = ${JSON.stringify(iosFallbackUrl)};
        var defaultFallback = ${JSON.stringify(defaultFallbackUrl)};
        var ua = navigator.userAgent || '';
        var isAndroid = /Android/i.test(ua);
        var isIos = /iPhone|iPad|iPod/i.test(ua);
        var isBot = /bot|crawler|spider|facebookexternalhit|twitterbot|whatsapp|telegram/i.test(ua);
        if (isBot) return;

        window.__openUnapShare = function () {
          var fallback = isIos ? iosFallback : isAndroid ? androidFallback : defaultFallback;
          var startedAt = Date.now();
          window.setTimeout(function () {
            if (Date.now() - startedAt < 2600 && !document.hidden) {
              window.location.href = fallback;
            }
          }, 1600);
          window.location.href = isAndroid ? androidIntent : deepLink;
        };

        if (isAndroid || isIos) {
          window.setTimeout(window.__openUnapShare, 350);
        }
      })();
    </script>
  </head>
  <body>
    <main>
      <div class="top">
        <div class="brand">
          <div class="mark">U</div>
          <span>UNAP</span>
        </div>
        <a class="open-app" href="${escapedAppDeepLink}" onclick="if(window.__openUnapShare){window.__openUnapShare();return false;}">Open in app</a>
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

function sharePostPage(req, res) {
  req.shareContentType = 'post';
  return sharePage(req, res);
}

function shareUclipPage(req, res) {
  req.shareContentType = 'uclips';
  return sharePage(req, res);
}

async function shareUcutPage(req, res) {
  try {
    const { ucutId } = req.params;
    if (!mongoose.isValidObjectId(ucutId)) {
      return res.status(404).send('Not found');
    }

    const ucut = await Ucut.findById(ucutId).lean();
    if (!ucut) {
      return res.status(404).send('Not found');
    }

    const [author, profile] = await Promise.all([
      User.findById(ucut.userId).select('name').lean(),
      Profile.findOne({ userId: ucut.userId }).select('displayName username').lean(),
    ]);

    const firstSegment = [...(ucut.segments || [])].sort(
      (a, b) => (a.order || 0) - (b.order || 0),
    )[0] || {};
    const mediaUrl = buildPlayableMediaUrl(req, firstSegment.url || '');
    const mediaType = ucut.mediaType || ucut.type || '';
    const isVideo = mediaType === 'video';
    const isImage = mediaType === 'image';
    const previewImageUrl =
      buildPlayableMediaUrl(req, firstSegment.previewUrl || firstSegment.thumbnailUrl || '') ||
      (isImage ? mediaUrl : '') ||
      buildShareImageUrl(req);
    const mimeType = getMimeType(mediaType, mediaUrl);
    const authorName = profile?.displayName || profile?.username || author?.name || 'UNAP';
    const title = String(ucut.text || '').trim() || 'UNAP UCut';
    const description = `Shared by ${authorName}`;
    const shareUrl = buildShareUrl(req, ucut._id, 'ucuts');
    const appDeepLink = buildAppDeepLink(ucut._id, 'ucuts');
    const androidFallbackUrl = buildStoreFallbackUrl(req, 'android', appDeepLink);
    const iosFallbackUrl = buildStoreFallbackUrl(req, 'ios', appDeepLink);
    const defaultFallbackUrl = buildStoreFallbackUrl(req, '', appDeepLink);
    const androidIntentUrl = buildAndroidIntentUrl(ucut._id, androidFallbackUrl, 'ucuts');

    const escapedTitle = escapeHtml(title);
    const escapedDescription = escapeHtml(description);
    const escapedShareUrl = escapeHtml(shareUrl);
    const escapedAppDeepLink = escapeHtml(appDeepLink);
    const escapedMediaUrl = escapeHtml(mediaUrl);
    const escapedPreviewImageUrl = escapeHtml(previewImageUrl);
    const escapedAuthorName = escapeHtml(authorName);
    const escapedMimeType = escapeHtml(mimeType);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
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
    <meta name="apple-itunes-app" content="app-argument=${escapedAppDeepLink}" />
    <meta property="og:image" content="${escapedPreviewImageUrl}" />
    <meta property="og:image:secure_url" content="${escapedPreviewImageUrl}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapedTitle}" />
    <meta name="twitter:description" content="${escapedDescription}" />
    <meta name="twitter:image" content="${escapedPreviewImageUrl}" />
    ${
      isVideo && escapedMediaUrl
        ? `<meta property="og:video" content="${escapedMediaUrl}" />
    <meta property="og:video:secure_url" content="${escapedMediaUrl}" />
    <meta property="og:video:type" content="${escapedMimeType}" />`
        : ''
    }
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; background: #05070b; color: #fff; font-family: Arial, sans-serif; }
      main { width: min(720px, 100%); margin: 0 auto; padding: 18px; }
      .top { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 14px; }
      .brand { font-weight: 800; }
      .open-app { color: #05070b; background: #fff; border-radius: 8px; padding: 10px 14px; text-decoration: none; font-weight: 700; }
      .player { background: #000; border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,.12); }
      video, img { display: block; width: 100%; max-height: 82vh; object-fit: contain; background: #000; }
      .meta { padding-top: 16px; }
      h1 { margin: 0; font-size: clamp(24px, 5vw, 40px); }
      p { color: #a6adbb; }
    </style>
    <script>
      (function () {
        var deepLink = ${JSON.stringify(appDeepLink)};
        var androidIntent = ${JSON.stringify(androidIntentUrl)};
        var androidFallback = ${JSON.stringify(androidFallbackUrl)};
        var iosFallback = ${JSON.stringify(iosFallbackUrl)};
        var defaultFallback = ${JSON.stringify(defaultFallbackUrl)};
        var ua = navigator.userAgent || '';
        var isAndroid = /Android/i.test(ua);
        var isIos = /iPhone|iPad|iPod/i.test(ua);
        var isBot = /bot|crawler|spider|facebookexternalhit|twitterbot|whatsapp|telegram/i.test(ua);
        if (isBot) return;
        window.__openUnapShare = function () {
          var fallback = isIos ? iosFallback : isAndroid ? androidFallback : defaultFallback;
          var startedAt = Date.now();
          window.setTimeout(function () {
            if (Date.now() - startedAt < 2600 && !document.hidden) {
              window.location.href = fallback;
            }
          }, 1600);
          window.location.href = isAndroid ? androidIntent : deepLink;
        };
        if (isAndroid || isIos) window.setTimeout(window.__openUnapShare, 350);
      })();
    </script>
  </head>
  <body>
    <main>
      <div class="top">
        <div class="brand">UNAP</div>
        <a class="open-app" href="${escapedAppDeepLink}" onclick="if(window.__openUnapShare){window.__openUnapShare();return false;}">Open in app</a>
      </div>
      <section class="player">
        ${
          isVideo && escapedMediaUrl
            ? `<video controls playsinline preload="metadata" poster="${escapedPreviewImageUrl}">
          <source src="${escapedMediaUrl}" type="${escapedMimeType}" />
        </video>`
            : isImage && escapedMediaUrl
              ? `<img src="${escapedMediaUrl}" alt="${escapedTitle}" />`
              : `<div style="padding:36px;text-align:center;color:#a6adbb">This UCut is available in the UNAP app.</div>`
        }
      </section>
      <section class="meta">
        <h1>${escapedTitle}</h1>
        <p>Shared by ${escapedAuthorName}</p>
      </section>
    </main>
  </body>
</html>`);
  } catch (err) {
    console.error('UCut share page error:', err);
    return res.status(500).send('Error');
  }
}

async function profileSharePage(req, res) {
  try {
    const rawProfileId = String(req.params.profileId || '').trim();
    if (!rawProfileId || !mongoose.isValidObjectId(rawProfileId)) {
      return res.status(404).send('Not found');
    }

    const profile = await Profile.findOne({
      $or: [{ userId: rawProfileId }, { _id: rawProfileId }],
    }).lean();
    if (!profile) {
      return res.status(404).send('Not found');
    }

    return renderProfileSharePage(req, res, profile);
  } catch (err) {
    console.error('Profile share page error:', err);
    return res.status(500).send('Error');
  }
}

async function usernameSharePage(req, res) {
  try {
    const username = String(req.params.username || '').replace(/^@/, '').trim();
    if (!username) {
      return res.status(404).send('Not found');
    }

    const profile = await Profile.findOne({
      username: new RegExp(`^${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    }).lean();
    if (!profile) {
      return res.status(404).send('Not found');
    }

    return renderProfileSharePage(req, res, profile);
  } catch (err) {
    console.error('Username share page error:', err);
    return res.status(500).send('Error');
  }
}

async function renderProfileSharePage(req, res, profile) {
  const user = await User.findById(profile.userId).select('name').lean();
  const displayName = profile.displayName || profile.username || user?.name || 'UNAP Artist';
  const username = profile.username ? `@${profile.username}` : '';
  const title = `${displayName} on UNAP`;
  const description =
    profile.bio ||
    (profile.usnapVideoUrl
      ? `Watch ${displayName}'s USnap description video on UNAP.`
      : `Check out ${displayName}'s profile on UNAP.`);
  const shareUrl = buildProfileShareUrl(req, profile);
  const appDeepLink = buildProfileAppDeepLink(profile.userId);
  const androidFallbackUrl = buildStoreFallbackUrl(req, 'android', appDeepLink);
  const iosFallbackUrl = buildStoreFallbackUrl(req, 'ios', appDeepLink);
  const defaultFallbackUrl = buildStoreFallbackUrl(req, '', appDeepLink);
  const androidIntentUrl = buildProfileAndroidIntentUrl(profile.userId, androidFallbackUrl);
  const usnapVideoUrl = buildPlayableMediaUrl(req, profile.usnapVideoUrl);
  const fallbackImageUrl = buildShareImageUrl(req);
  const avatarImageUrl = buildPlayableMediaUrl(req, profile.profileImageUrl) || fallbackImageUrl;
  const previewImageUrl =
    buildPlayableMediaUrl(req, profile.usnapThumbnailUrl) || avatarImageUrl;
  const usnapMimeType = getMimeType('video', usnapVideoUrl);

  const escapedTitle = escapeHtml(title);
  const escapedDescription = escapeHtml(description);
  const escapedShareUrl = escapeHtml(shareUrl);
  const escapedAppDeepLink = escapeHtml(appDeepLink);
  const escapedPreviewImageUrl = escapeHtml(previewImageUrl);
  const escapedAvatarImageUrl = escapeHtml(avatarImageUrl);
  const escapedUsnapVideoUrl = escapeHtml(usnapVideoUrl);
  const escapedUsnapMimeType = escapeHtml(usnapMimeType);
  const escapedDisplayName = escapeHtml(displayName);
  const escapedUsername = escapeHtml(username);
  const escapedBio = escapeHtml(profile.bio || '');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle}</title>
    <link rel="canonical" href="${escapedShareUrl}" />
    <meta name="description" content="${escapedDescription}" />
    <meta property="og:title" content="${escapedTitle}" />
    <meta property="og:description" content="${escapedDescription}" />
    <meta property="og:url" content="${escapedShareUrl}" />
    <meta property="og:site_name" content="UNAP" />
    <meta property="og:type" content="${escapedUsnapVideoUrl ? 'video.other' : 'profile'}" />
    <meta name="apple-itunes-app" content="app-argument=${escapedAppDeepLink}" />
    <meta itemprop="name" content="${escapedTitle}" />
    <meta itemprop="description" content="${escapedDescription}" />
    <meta itemprop="image" content="${escapedPreviewImageUrl}" />
    <meta property="og:image" content="${escapedPreviewImageUrl}" />
    <meta property="og:image:url" content="${escapedPreviewImageUrl}" />
    <meta property="og:image:secure_url" content="${escapedPreviewImageUrl}" />
    <meta property="og:image:type" content="image/jpeg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="UNAP profile preview" />
    ${
      escapedUsnapVideoUrl
        ? `<meta property="og:video" content="${escapedUsnapVideoUrl}" />
    <meta property="og:video:secure_url" content="${escapedUsnapVideoUrl}" />
    <meta property="og:video:type" content="${escapedUsnapMimeType}" />
    <meta property="og:video:width" content="720" />
    <meta property="og:video:height" content="1280" />`
        : ''
    }
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapedTitle}" />
    <meta name="twitter:description" content="${escapedDescription}" />
    <meta name="twitter:image" content="${escapedPreviewImageUrl}" />
    <meta name="twitter:image:alt" content="UNAP profile preview" />
    <style>
      :root {
        color-scheme: dark;
        --bg: #05070b;
        --panel: #0c111a;
        --text: #f8fafc;
        --muted: #a6adbb;
        --line: rgba(255, 255, 255, 0.12);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background: linear-gradient(180deg, #05070b 0%, #0b1020 100%);
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(920px, 100%);
        margin: 0 auto;
        padding: 20px;
      }
      .top, .identity {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
      }
      .top { padding: 6px 0 18px; }
      .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        font-weight: 800;
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
      .profile {
        border: 1px solid var(--line);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.04);
        overflow: hidden;
      }
      .identity {
        justify-content: flex-start;
        padding: 18px;
      }
      .avatar {
        width: 74px;
        height: 74px;
        border-radius: 999px;
        object-fit: cover;
        background: #111827;
        border: 1px solid var(--line);
      }
      h1 {
        margin: 0;
        font-size: clamp(26px, 5vw, 44px);
        line-height: 1.1;
      }
      .username, .bio {
        margin: 6px 0 0;
        color: var(--muted);
      }
      .player {
        border-top: 1px solid var(--line);
        background: #000;
      }
      video, .fallback-image {
        display: block;
        width: 100%;
        max-height: min(76vh, 820px);
        object-fit: contain;
        background: #000;
      }
      .fallback {
        padding: 34px 20px;
        color: var(--muted);
        text-align: center;
        background: var(--panel);
      }
      @media (max-width: 560px) {
        main { padding: 14px; }
        .identity { align-items: flex-start; }
      }
    </style>
    <script>
      (function () {
        var deepLink = ${JSON.stringify(appDeepLink)};
        var androidIntent = ${JSON.stringify(androidIntentUrl)};
        var androidFallback = ${JSON.stringify(androidFallbackUrl)};
        var iosFallback = ${JSON.stringify(iosFallbackUrl)};
        var defaultFallback = ${JSON.stringify(defaultFallbackUrl)};
        var ua = navigator.userAgent || '';
        var isAndroid = /Android/i.test(ua);
        var isIos = /iPhone|iPad|iPod/i.test(ua);
        var isBot = /bot|crawler|spider|facebookexternalhit|twitterbot|whatsapp|telegram/i.test(ua);
        if (isBot) return;

        window.__openUnapProfile = function () {
          var fallback = isIos ? iosFallback : isAndroid ? androidFallback : defaultFallback;
          var startedAt = Date.now();
          window.setTimeout(function () {
            if (Date.now() - startedAt < 2600 && !document.hidden) {
              window.location.href = fallback;
            }
          }, 1600);
          window.location.href = isAndroid ? androidIntent : deepLink;
        };
      })();
    </script>
  </head>
  <body>
    <main>
      <div class="top">
        <div class="brand">
          <div class="mark">U</div>
          <span>UNAP</span>
        </div>
        <a class="open-app" href="${escapedAppDeepLink}" onclick="if(window.__openUnapProfile){window.__openUnapProfile();return false;}">Open in app</a>
      </div>
      <section class="profile">
        <div class="identity">
          <img class="avatar" src="${escapedAvatarImageUrl}" alt="${escapedDisplayName}" />
          <div>
            <h1>${escapedDisplayName}</h1>
            ${escapedUsername ? `<p class="username">${escapedUsername}</p>` : ''}
            ${escapedBio ? `<p class="bio">${escapedBio}</p>` : ''}
          </div>
        </div>
        <div class="player">
          ${
            escapedUsnapVideoUrl
              ? `<video controls playsinline preload="metadata" poster="${escapedPreviewImageUrl}">
            <source src="${escapedUsnapVideoUrl}" type="${escapedUsnapMimeType}" />
            Your browser does not support video playback.
          </video>`
              : `<div class="fallback">This UNAP profile is available in the app.</div>`
          }
        </div>
      </section>
    </main>
  </body>
</html>`);
}

module.exports = {
  sharePage,
  sharePostPage,
  shareUclipPage,
  shareUcutPage,
  profileSharePage,
  usernameSharePage,
  appDownloadPage(req, res) {
    const playStoreUrl =
      process.env.PLAY_STORE_URL ||
      'https://play.google.com/store/apps/details?id=com.mdalifk2002.UNAP';
    const appStoreUrl =
      process.env.APP_STORE_URL ||
      'https://apps.apple.com/us/search?term=UNAP';
    const requestedStore = String(req.params.store || '').toLowerCase();
    const targetDeepLink = String(req.query?.target || '').trim();
    const userAgent = String(req.get('user-agent') || '').toLowerCase();
    const wantsIos =
      ['ios', 'app-store', 'appstore', 'apple'].includes(requestedStore) ||
      (!requestedStore && /iphone|ipad|ipod/.test(userAgent));
    let targetUrl = wantsIos && appStoreUrl ? appStoreUrl : playStoreUrl;
    if (!wantsIos && targetDeepLink) {
      try {
        const parsedStoreUrl = new URL(targetUrl);
        if (parsedStoreUrl.hostname === 'play.google.com') {
          parsedStoreUrl.searchParams.set('referrer', `deep_link=${encodeURIComponent(targetDeepLink)}`);
          targetUrl = parsedStoreUrl.toString();
        }
      } catch {
        // Keep the configured store URL as-is.
      }
    }
    const canonicalPath = wantsIos ? '/download/ios' : '/download';
    const canonicalUrl = buildAbsoluteUrl(req, canonicalPath);
    const imageUrl = buildShareImageUrl(req);
    const title = 'UNAP';
    const description =
      'United Artists of Power. Create, share, and connect with artists on UNAP.';
    const escapedTargetUrl = escapeHtml(targetUrl);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <meta property="og:site_name" content="UNAP" />
    <meta property="og:type" content="website" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:url" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:type" content="image/jpeg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="UNAP app logo" />
    <meta itemprop="name" content="${escapeHtml(title)}" />
    <meta itemprop="description" content="${escapeHtml(description)}" />
    <meta itemprop="image" content="${escapeHtml(imageUrl)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
    <meta name="twitter:image:alt" content="UNAP app logo" />
    <meta http-equiv="refresh" content="2; url=${escapedTargetUrl}" />
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #000;
        color: #fff;
        font-family: Arial, sans-serif;
        text-align: center;
        padding: 24px;
      }
      main { width: min(420px, 100%); }
      img {
        display: block;
        width: 100%;
        max-width: 360px;
        margin: 0 auto 24px;
      }
      h1 {
        margin: 0 0 10px;
        font-size: 36px;
        letter-spacing: 0;
      }
      p {
        margin: 0 0 22px;
        color: #d4d4d4;
        line-height: 1.5;
      }
      a {
        display: inline-block;
        border: 1px solid #fff;
        border-radius: 8px;
        padding: 12px 18px;
        color: #000;
        background: #fff;
        font-weight: 700;
        text-decoration: none;
      }
    </style>
    <script>
      window.setTimeout(function () {
        window.location.href = ${JSON.stringify(targetUrl)};
      }, 700);
    </script>
  </head>
  <body>
    <main>
      <img src="${escapeHtml(imageUrl)}" alt="UNAP app logo" />
      <h1>UNAP</h1>
      <p>Opening the app store...</p>
      <a href="${escapedTargetUrl}">Open store</a>
    </main>
  </body>
</html>`);
  },
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
