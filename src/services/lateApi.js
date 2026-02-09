const LATE_API_BASE_URL = process.env.LATE_API_BASE_URL || 'https://getlate.dev/api/v1';
const LATE_API_KEY = process.env.LATE_API_KEY;
const LATE_OAUTH_REDIRECT_URI = process.env.LATE_OAUTH_REDIRECT_URI;
const LATE_PROFILE_ID = process.env.LATE_PROFILE_ID;

function normalizePlatformName(value) {
  const platform = String(value || '').toLowerCase().trim();
  if (!platform) return '';
  if (platform === 'x') return 'twitter';
  return platform;
}

function getPlatformCandidates(value) {
  const normalized = normalizePlatformName(value);
  if (normalized === 'twitter') return ['twitter', 'x'];
  if (!normalized) return [];
  return [normalized];
}

function ensureApiKey() {
  if (!LATE_API_KEY) {
    throw new Error('LATE_API_KEY is not configured');
  }
}

async function request(path, options = {}) {
  ensureApiKey();
  const url = `${LATE_API_BASE_URL}${path}`;

  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${LATE_API_KEY}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
  } catch (fetchErr) {
    const error = new Error(`LATE Network Error: ${fetchErr?.message || 'fetch failed'}`);
    error.status = 503;
    error.url = url;
    error.method = options.method || 'GET';
    error.requestBody = options.body;
    throw error;
  }

  const rawText = await res.text().catch(() => '');
  let data = {};
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      data = { raw: rawText.slice(0, 500) };
    }
  }

  if (!res.ok) {
    const message =
      data?.error ||
      data?.message ||
      data?.raw ||
      `${res.status} ${res.statusText}` ||
      'LATE API request failed';
    const error = new Error(message);
    error.status = res.status;
    error.payload = data;
    error.url = url;
    error.method = options.method || 'GET';
    error.requestBody = options.body;
    throw error;
  }
  return data;
}

async function connectAccount(userId, platform, appRedirectUri, callbackUri) {
  const platformCandidates = getPlatformCandidates(platform);
  if (!platformCandidates.length) {
    const error = new Error('platform is required for LATE connect.');
    error.status = 400;
    throw error;
  }
  if (!LATE_PROFILE_ID) {
    const error = new Error('LATE_PROFILE_ID is not configured.');
    error.status = 500;
    throw error;
  }
  const callbackParams = new URLSearchParams({ userId: String(userId) });
  if (appRedirectUri) {
    callbackParams.set('clientRedirect', String(appRedirectUri));
  }
  const baseCallback = callbackUri || LATE_OAUTH_REDIRECT_URI;
  if (!baseCallback) {
    const error = new Error('LATE_OAUTH_REDIRECT_URI is not configured.');
    error.status = 500;
    throw error;
  }

  const redirectUrl = `${baseCallback}${baseCallback.includes('?') ? '&' : '?'}${callbackParams.toString()}`;
  const params = new URLSearchParams({
    profileId: LATE_PROFILE_ID,
    redirect_url: redirectUrl,
  });

  let lastError = null;
  for (let i = 0; i < platformCandidates.length; i += 1) {
    const candidate = platformCandidates[i];
    try {
      return await request(`/connect/${candidate}?${params.toString()}`, {
        method: 'GET',
      });
    } catch (err) {
      lastError = err;
      const canRetryAlias =
        i < platformCandidates.length - 1 && [400, 404].includes(err?.status || 0);
      if (!canRetryAlias) throw err;
    }
  }

  throw lastError || new Error('LATE API request failed');
}

async function handleOAuthCallback(query) {
  return request(`/connect/callback?${new URLSearchParams(query).toString()}`, {
    method: 'GET',
  });
}

async function getConnectedAccounts(lateAccountId) {
  const params = lateAccountId ? `?profileId=${lateAccountId}` : '';
  return request(`/accounts${params}`, { method: 'GET' });
}

async function disconnectAccount({ lateProfileId, accountId, platform }) {
  const platformCandidates = getPlatformCandidates(platform);
  if (!platformCandidates.length) {
    const error = new Error('platform is required for disconnect.');
    error.status = 400;
    throw error;
  }

  const idCandidates = [accountId, lateProfileId]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  if (!idCandidates.length) {
    const error = new Error('accountId or lateProfileId is required for disconnect.');
    error.status = 400;
    throw error;
  }

  let lastError = null;
  for (let i = 0; i < platformCandidates.length; i += 1) {
    const candidatePlatform = platformCandidates[i];
    for (let j = 0; j < idCandidates.length; j += 1) {
      const id = idCandidates[j];
      const attempts = [
        {
          path: `/accounts/${id}/disconnect`,
          method: 'POST',
          body: JSON.stringify({ platform: candidatePlatform }),
        },
        {
          path: `/accounts/${id}/disconnect`,
          method: 'DELETE',
        },
        {
          path: `/accounts/${id}`,
          method: 'DELETE',
        },
        {
          path: '/accounts/disconnect',
          method: 'POST',
          body: JSON.stringify({
            accountId: id,
            profileId: lateProfileId,
            platform: candidatePlatform,
          }),
        },
      ];

      for (let k = 0; k < attempts.length; k += 1) {
        try {
          return await request(attempts[k].path, {
            method: attempts[k].method,
            body: attempts[k].body,
          });
        } catch (err) {
          lastError = err;
          // Keep trying alternative API shapes when method/path is unsupported.
          if (![400, 404, 405].includes(err?.status || 0)) {
            throw err;
          }
        }
      }
    }
  }

  throw lastError || new Error('LATE API request failed');
}

async function createPost({ content, mediaUrls, platforms, scheduledAt, lateAccountId }) {
  if (!lateAccountId) {
    const error = new Error('LATE account not connected.');
    error.status = 400;
    throw error;
  }
  const mediaItems = (mediaUrls || []).map((url) => {
    let type = 'image';
    if (typeof url === 'string') {
      const lower = url.toLowerCase();
      if (lower.match(/\.mp4|\.mov|\.webm|\.mkv|\.avi/)) {
        type = 'video';
      } else if (lower.match(/\.mp3|\.wav|\.m4a|\.aac/)) {
        type = 'audio';
      }
    }
    return { url, type };
  });
  return request('/posts', {
    method: 'POST',
    body: JSON.stringify({
      profileId: lateAccountId,
      content,
      mediaItems,
      platforms: platforms || [],
      scheduledFor: scheduledAt,
    }),
  });
}

async function getPostStatus(latePostId) {
  return request(`/posts/${latePostId}`);
}

async function deletePost(latePostId) {
  return request(`/posts/${latePostId}`, { method: 'DELETE' });
}

async function migrateTokens({ userId, tokens }) {
  return request('/accounts/migrate', {
    method: 'POST',
    body: JSON.stringify({
      externalUserId: userId,
      tokens,
    }),
  });
}

module.exports = {
  connectAccount,
  handleOAuthCallback,
  getConnectedAccounts,
  disconnectAccount,
  createPost,
  getPostStatus,
  deletePost,
  migrateTokens,
};
