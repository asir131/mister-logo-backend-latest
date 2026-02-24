const OUTSTAND_API_BASE_URL =
  process.env.OUTSTAND_API_BASE_URL || 'https://api.outstand.so/v1';
const OUTSTAND_API_KEY = process.env.OUTSTAND_API_KEY;
const OUTSTAND_OAUTH_REDIRECT_URI = process.env.OUTSTAND_OAUTH_REDIRECT_URI;
const OUTSTAND_TENANT_PREFIX = process.env.OUTSTAND_TENANT_PREFIX || '';

function normalizePlatformName(value) {
  const platform = String(value || '').toLowerCase().trim();
  if (!platform) return '';
  if (platform === 'twitter') return 'x';
  return platform;
}

function buildTenantId(userId) {
  const base = String(userId || '').trim();
  if (!base) return '';
  if (!OUTSTAND_TENANT_PREFIX) return base;
  return `${OUTSTAND_TENANT_PREFIX}-${base}`;
}

function ensureApiKey() {
  if (!OUTSTAND_API_KEY) {
    throw new Error('OUTSTAND_API_KEY is not configured');
  }
}

async function request(path, options = {}, config = {}) {
  const url = `${OUTSTAND_API_BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (config.skipAuth !== true) {
    ensureApiKey();
    headers.Authorization = `Bearer ${OUTSTAND_API_KEY}`;
  }

  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers,
    });
  } catch (fetchErr) {
    const error = new Error(
      `OUTSTAND Network Error: ${fetchErr?.message || 'fetch failed'}`,
    );
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
      'OUTSTAND API request failed';
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

async function connectAccount(userId, platform, redirectUri) {
  const normalized = normalizePlatformName(platform);
  if (!normalized) {
    const error = new Error('platform is required for Outstand connect.');
    error.status = 400;
    throw error;
  }

  const tenantId = buildTenantId(userId);
  const callbackUri = redirectUri || OUTSTAND_OAUTH_REDIRECT_URI;
  if (!callbackUri) {
    const error = new Error('OUTSTAND_OAUTH_REDIRECT_URI is not configured.');
    error.status = 500;
    throw error;
  }

  const payload = {
    redirect_uri: callbackUri,
    tenant_id: tenantId || undefined,
  };

  return request(`/social-networks/${normalized}/auth-url`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function getPendingConnection(sessionToken) {
  return request(`/social-accounts/pending/${sessionToken}`, { method: 'GET' }, { skipAuth: true });
}

async function finalizePendingConnection(sessionToken, pageIds = []) {
  const payloads = [
    { selectedPageIds: pageIds },
    { pageIds },
    { page_ids: pageIds },
    { accounts: pageIds },
  ];
  let lastError = null;
  for (let i = 0; i < payloads.length; i += 1) {
    try {
      return await request(
        `/social-accounts/pending/${sessionToken}/finalize`,
        {
          method: 'POST',
          body: JSON.stringify(payloads[i]),
        },
        { skipAuth: true },
      );
    } catch (err) {
      lastError = err;
      if (![400, 404].includes(err?.status || 0)) {
        throw err;
      }
    }
  }
  throw lastError || new Error('Outstand finalize failed');
}

async function getConnectedAccounts(tenantId) {
  const params = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
  return request(`/social-accounts${params}`, { method: 'GET' });
}

async function disconnectAccount(accountId) {
  if (!accountId) {
    const error = new Error('accountId is required for disconnect.');
    error.status = 400;
    throw error;
  }
  const attempts = [
    { path: `/social-accounts/${accountId}`, method: 'DELETE' },
    { path: `/social-accounts/${accountId}/disconnect`, method: 'POST' },
  ];

  let lastError = null;
  for (let i = 0; i < attempts.length; i += 1) {
    try {
      return await request(attempts[i].path, { method: attempts[i].method });
    } catch (err) {
      lastError = err;
      if (![400, 404, 405].includes(err?.status || 0)) {
        throw err;
      }
    }
  }
  throw lastError || new Error('Outstand disconnect failed');
}

function buildMediaItems(mediaUrls = []) {
  return mediaUrls
    .map((url) => {
      if (!url) return null;
      let filename = '';
      try {
        const parsed = new URL(url);
        const last = parsed.pathname.split('/').pop();
        filename = last || '';
      } catch {
        const last = String(url).split('/').pop();
        filename = last || '';
      }
      return { url, filename };
    })
    .filter(Boolean);
}

async function createPost({ content, mediaUrls, accounts, scheduledAt, containers }) {
  const body = {};

  if (Array.isArray(containers) && containers.length) {
    body.containers = containers;
  } else if (Array.isArray(mediaUrls) && mediaUrls.length) {
    body.containers = [
      {
        content: content || '',
        media: buildMediaItems(mediaUrls),
      },
    ];
  } else if (content) {
    body.content = content;
  }

  body.accounts = Array.isArray(accounts) ? accounts : [];
  if (scheduledAt) {
    body.scheduledAt = scheduledAt;
  }

  return request('/posts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function getPostStatus(outstandPostId) {
  return request(`/posts/${outstandPostId}`);
}

async function deletePost(outstandPostId) {
  return request(`/posts/${outstandPostId}`, { method: 'DELETE' });
}

module.exports = {
  normalizePlatformName,
  buildTenantId,
  connectAccount,
  getPendingConnection,
  finalizePendingConnection,
  getConnectedAccounts,
  disconnectAccount,
  createPost,
  getPostStatus,
  deletePost,
};
