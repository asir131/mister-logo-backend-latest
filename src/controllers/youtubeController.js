const mongoose = require('mongoose');

const User = require('../models/User');
const Post = require('../models/Post');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const YOUTUBE_CALLBACK_URL = process.env.YOUTUBE_CALLBACK_URL || '';

const GOOGLE_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_UPLOAD_INIT_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

function isConfigured() {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && YOUTUBE_CALLBACK_URL);
}

function encodeState(payload) {
  const raw = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  return raw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeState(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const base64 = value
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function normalizeClientRedirect(value) {
  if (typeof value !== 'string' || !value) return null;
  if (!/^(unap|exp|exps):\/\//i.test(value)) return null;
  try {
    const parsed = new URL(value);
    return parsed.toString();
  } catch {
    return null;
  }
}

function withQuery(urlString, query) {
  const url = new URL(urlString);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function sendRedirectPage(res, redirectUrl, title, description) {
  const safeUrl = String(redirectUrl || '').replace(/"/g, '&quot;');
  return res.status(200).send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="font-family: Arial, sans-serif; background:#0b1220; color:#fff; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0;">
    <div style="max-width:420px;background:#101827;border:1px solid #1f2937;border-radius:12px;padding:20px;text-align:center;">
      <h2>${title}</h2>
      <p style="color:#9ca3af;">${description}</p>
      <a href="${safeUrl}" style="display:inline-block;margin-top:12px;background:#2563eb;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;">Back To UNAP</a>
    </div>
    <script>setTimeout(function(){window.location.href='${safeUrl}';},50);</script>
  </body>
</html>`);
}

async function exchangeCode(code) {
  const body = new URLSearchParams();
  body.set('code', code);
  body.set('client_id', GOOGLE_CLIENT_ID);
  body.set('client_secret', GOOGLE_CLIENT_SECRET);
  body.set('redirect_uri', YOUTUBE_CALLBACK_URL);
  body.set('grant_type', 'authorization_code');

  const tokenRes = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData?.access_token) {
    throw new Error(tokenData?.error_description || tokenData?.error || 'Could not exchange YouTube auth code.');
  }

  return tokenData;
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams();
  body.set('refresh_token', refreshToken);
  body.set('client_id', GOOGLE_CLIENT_ID);
  body.set('client_secret', GOOGLE_CLIENT_SECRET);
  body.set('grant_type', 'refresh_token');

  const tokenRes = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData?.access_token) {
    throw new Error(tokenData?.error_description || tokenData?.error || 'Could not refresh YouTube token.');
  }

  return tokenData;
}

async function ensureFreshToken(userDoc) {
  const yt = userDoc?.youtubeAuth || {};
  const now = Date.now();

  if (yt.accessToken && yt.expiresAt && new Date(yt.expiresAt).getTime() > now + 60 * 1000) {
    return yt.accessToken;
  }

  if (!yt.refreshToken) {
    return null;
  }

  const refreshed = await refreshAccessToken(yt.refreshToken);
  const expiresIn = Number(refreshed.expires_in || 3600);
  const nextExpiresAt = new Date(Date.now() + expiresIn * 1000);

  await User.updateOne(
    { _id: userDoc._id },
    {
      $set: {
        'youtubeAuth.accessToken': refreshed.access_token,
        'youtubeAuth.expiresAt': nextExpiresAt,
      },
    },
  );

  return refreshed.access_token;
}

async function initResumableUpload(accessToken, title, description, mimeType, contentLength) {
  const metadata = {
    snippet: {
      title,
      description,
    },
    status: {
      privacyStatus: 'public',
    },
  };

  const initRes = await fetch(YOUTUBE_UPLOAD_INIT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(contentLength),
    },
    body: JSON.stringify(metadata),
  });

  if (!initRes.ok) {
    const text = await initRes.text();
    throw new Error(`YouTube upload init failed: ${text || initRes.statusText}`);
  }

  const location = initRes.headers.get('location');
  if (!location) {
    throw new Error('YouTube upload URL missing.');
  }
  return location;
}

async function uploadBinary(uploadUrl, accessToken, buffer, mimeType) {
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': mimeType,
      'Content-Length': String(buffer.length),
    },
    body: buffer,
  });

  const uploadData = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok || !uploadData?.id) {
    throw new Error(uploadData?.error?.message || 'YouTube upload failed.');
  }
  return uploadData;
}


function buildCloudinaryImageToVideoCandidates(mediaUrl) {
  if (typeof mediaUrl !== 'string' || !mediaUrl) return [];

  try {
    const parsed = new URL(mediaUrl);
    if (!/res\.cloudinary\.com$/i.test(parsed.hostname)) return [];
    if (!parsed.pathname.includes('/image/upload/')) return [];

    const candidates = [];

    const withVideoPath = new URL(parsed.toString());
    withVideoPath.pathname = withVideoPath.pathname.replace('/image/upload/', '/video/upload/f_mp4/du_3/');
    candidates.push(withVideoPath.toString());

    const withImagePath = new URL(parsed.toString());
    withImagePath.pathname = withImagePath.pathname.replace('/image/upload/', '/image/upload/f_mp4/du_3/');
    candidates.push(withImagePath.toString());

    return Array.from(new Set(candidates));
  } catch {
    return [];
  }
}

async function resolveUploadMedia(post) {
  const mediaUrl = String(post?.mediaUrl || '').trim();
  if (!mediaUrl) {
    throw new Error('Post media URL missing.');
  }

  if (post?.mediaType === 'video') {
    const mediaRes = await fetch(mediaUrl);
    if (!mediaRes.ok) {
      throw new Error('Could not fetch source media.');
    }
    const buffer = Buffer.from(await mediaRes.arrayBuffer());
    const mimeType = mediaRes.headers.get('content-type') || 'video/mp4';
    return { buffer, mimeType };
  }

  if (post?.mediaType === 'image') {
    const candidates = buildCloudinaryImageToVideoCandidates(mediaUrl);

    for (const candidate of candidates) {
      const mediaRes = await fetch(candidate);
      if (!mediaRes.ok) continue;
      const mimeType = mediaRes.headers.get('content-type') || '';
      if (!mimeType.startsWith('video/')) continue;

      const buffer = Buffer.from(await mediaRes.arrayBuffer());
      if (!buffer.length) continue;

      return { buffer, mimeType };
    }

    throw new Error('Image posts require Cloudinary image-to-video conversion, but conversion failed.');
  }

  throw new Error('Only image or video posts can be uploaded to YouTube.');
}
async function getYouTubeConnectUrl(req, res) {
  if (!isConfigured()) {
    return res.status(500).json({ error: 'YouTube auth is not configured.' });
  }

  const clientRedirect = normalizeClientRedirect(req.query.clientRedirect);
  if (!clientRedirect) {
    return res.status(400).json({ error: 'Valid clientRedirect is required.' });
  }

  const state = encodeState({
    userId: String(req.user?.id || ''),
    clientRedirect,
  });

  const authUrl = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
  authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', YOUTUBE_CALLBACK_URL);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile https://www.googleapis.com/auth/youtube.upload');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('include_granted_scopes', 'true');
  authUrl.searchParams.set('state', state);

  return res.status(200).json({ url: authUrl.toString() });
}

async function youtubeAuthCallback(req, res) {
  if (!isConfigured()) {
    return res.status(500).json({ error: 'YouTube auth is not configured.' });
  }

  const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
  const state = decodeState(req.query.state);
  const clientRedirect = normalizeClientRedirect(state?.clientRedirect);
  const userId = state?.userId;

  if (!code || !clientRedirect || !mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ error: 'Invalid YouTube OAuth callback parameters.' });
  }

  try {
    const tokenData = await exchangeCode(code);
    const expiresIn = Number(tokenData.expires_in || 3600);
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    await User.updateOne(
      { _id: userId },
      {
        $set: {
          'youtubeAuth.accessToken': tokenData.access_token,
          'youtubeAuth.refreshToken': tokenData.refresh_token || undefined,
          'youtubeAuth.expiresAt': expiresAt,
          'youtubeAuth.scope': tokenData.scope || '',
        },
      },
    );

    const redirectUrl = withQuery(clientRedirect, { status: 'success', provider: 'youtube' });
    return sendRedirectPage(res, redirectUrl, 'YouTube connected', 'Returning to UNAP...');
  } catch (error) {
    const redirectUrl = withQuery(clientRedirect, {
      status: 'error',
      provider: 'youtube',
      error: error?.message || 'Could not connect YouTube.',
    });
    return sendRedirectPage(res, redirectUrl, 'YouTube connection failed', 'Returning to UNAP...');
  }
}

async function sharePostToYoutube(req, res) {
  if (!isConfigured()) {
    return res.status(500).json({ error: 'YouTube auth is not configured.' });
  }

  const { postId } = req.body || {};
  if (!mongoose.isValidObjectId(postId)) {
    return res.status(400).json({ error: 'Valid postId is required.' });
  }

  const [userDoc, post] = await Promise.all([
    User.findById(req.user.id),
    Post.findById(postId).lean(),
  ]);

  if (!userDoc) {
    return res.status(404).json({ error: 'User not found.' });
  }
  if (!post) {
    return res.status(404).json({ error: 'Post not found.' });
  }
  if (post.mediaType !== 'video' && post.mediaType !== 'image') {
    return res.status(400).json({ error: 'Only image or video posts can be uploaded to YouTube.' });
  }
  if (!post.mediaUrl) {
    return res.status(400).json({ error: 'Post media URL missing.' });
  }

  const accessToken = await ensureFreshToken(userDoc);
  if (!accessToken) {
    return res.status(428).json({
      error: 'YouTube account not connected.',
      code: 'YOUTUBE_AUTH_REQUIRED',
    });
  }

  try {
    const { buffer, mimeType } = await resolveUploadMedia(post);

    const uploadUrl = await initResumableUpload(
      accessToken,
      (post.description || 'UNAP Upload').slice(0, 100),
      post.description || '',
      mimeType,
      buffer.length,
    );

    const uploadData = await uploadBinary(uploadUrl, accessToken, buffer, mimeType);
    const videoId = uploadData.id;

    return res.status(200).json({
      success: true,
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      message: 'Uploaded to YouTube successfully.',
    });
  } catch (error) {
    console.error('YouTube upload error:', error);
    return res.status(500).json({ error: error?.message || 'Could not upload to YouTube.' });
  }
}

module.exports = {
  getYouTubeConnectUrl,
  youtubeAuthCallback,
  sharePostToYoutube,
};





