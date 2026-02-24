const User = require('../models/User');
const outstandApi = require('../services/outstandApi');
const { syncAccountsForUser } = require('../services/outstandAccounts');

function normalizePlatformName(value) {
  const platform = String(value || '').toLowerCase().trim();
  if (!platform) return '';
  if (platform === 'x') return 'twitter';
  return platform;
}

async function connectOutstand(req, res) {
  try {
    const userId = req.user.id;
    const platform = normalizePlatformName(req.body?.platform || req.query?.platform);
    const appRedirectUri = req.body?.appRedirectUri || req.query?.appRedirectUri;
    const forwardedProto = req.headers['x-forwarded-proto'];
    const forwardedHost = req.headers['x-forwarded-host'];
    const protocol =
      (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) ||
      req.protocol ||
      'http';
    const host =
      (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ||
      req.get('host');
    const callbackBase = host
      ? `${protocol}://${host}/api/accounts/outstand-callback`
      : undefined;
    const callbackParams = new URLSearchParams({ userId: String(userId) });
    if (appRedirectUri) {
      callbackParams.set('clientRedirect', String(appRedirectUri));
    }
    const callbackUri =
      callbackBase && callbackParams.toString()
        ? `${callbackBase}${callbackBase.includes('?') ? '&' : '?'}${callbackParams.toString()}`
        : callbackBase;

    const data = await outstandApi.connectAccount(userId, platform, callbackUri);
    return res.status(200).json({
      url: data.url || data.auth_url || data.authUrl,
      authUrl: data.authUrl || data.auth_url || data.url,
      accountId: data.accountId || data.id,
    });
  } catch (err) {
    console.error('Outstand connect error:', err);
    return res.status(err.status || 500).json({ error: err.message });
  }
}

async function outstandCallback(req, res) {
  try {
    const rawQuery = req.originalUrl.includes('?')
      ? req.originalUrl.slice(req.originalUrl.indexOf('?') + 1)
      : '';
    const fallbackParams = new URLSearchParams(rawQuery.replace(/\?/g, '&'));

    const pickParam = (key) => {
      const value = req.query?.[key];
      if (typeof value === 'string' && value.length > 0) return value;
      return fallbackParams.get(key) || undefined;
    };

    const callbackError = pickParam('error');
    const clientRedirect = pickParam('clientRedirect');

    const resolveClientRedirect = (params = {}) => {
      if (typeof clientRedirect !== 'string' || !clientRedirect) return null;
      // Allow standalone and Expo dev deep links.
      if (!/^(unap|exp|exps):\/\//i.test(clientRedirect)) return null;
      try {
        const target = new URL(clientRedirect);
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null && String(value).length > 0) {
            target.searchParams.set(key, String(value));
          }
        });
        return target.toString();
      } catch {
        return null;
      }
    };

    if (callbackError) {
      const redirectUrl = resolveClientRedirect({
        status: 'error',
        error: callbackError,
      });
      if (redirectUrl) {
        return res.redirect(302, redirectUrl);
      }
      return res.status(400).json({ error: callbackError });
    }

    let userId = pickParam('userId');
    if (typeof userId === 'string' && userId.includes('?')) {
      userId = userId.split('?')[0];
    }
    const sessionToken = pickParam('session') || pickParam('pending');
    const connectedPlatform = normalizePlatformName(
      pickParam('connected') || pickParam('platform') || pickParam('network')
    );
    const tenantId = pickParam('tenantId') || pickParam('tenant_id') || outstandApi.buildTenantId(userId);
    let alreadyConnected = false;

    if (userId && tenantId) {
      const existingUser = await User.findById(userId).lean();
      if (existingUser && connectedPlatform) {
        alreadyConnected = (existingUser.connectedPlatforms || []).includes(connectedPlatform);
      }

      const updates = {
        lateAccountId: tenantId,
      };
      const ops = { $set: updates };
      if (connectedPlatform) {
        ops.$addToSet = { connectedPlatforms: connectedPlatform };
      }
      await User.updateOne({ _id: userId }, ops);
    }

    if (sessionToken && userId) {
      try {
        const pending = await outstandApi.getPendingConnection(sessionToken);
        const availablePages = pending?.availablePages || pending?.pages || pending?.data?.availablePages;
        if (Array.isArray(availablePages) && availablePages.length > 0) {
          const pageIds = availablePages
            .map((page) => page.id || page.pageId || page._id)
            .filter(Boolean);
          if (pageIds.length) {
            await outstandApi.finalizePendingConnection(sessionToken, pageIds);
          }
        } else {
          await outstandApi.finalizePendingConnection(sessionToken, []);
        }
      } catch (pendingErr) {
        console.error('Outstand pending finalize error:', pendingErr);
      }
    }

    try {
      await syncAccountsForUser(userId);
    } catch (syncError) {
      console.error('Outstand sync accounts error:', syncError);
    }

    const redirectUrl = resolveClientRedirect({
      status: 'success',
      connected: connectedPlatform || '',
      profileId: tenantId || '',
      alreadyConnected: alreadyConnected ? '1' : '0',
    });
    if (redirectUrl) {
      return res.redirect(302, redirectUrl);
    }

    return res.status(200).json({
      ok: true,
      userId,
      profileId: tenantId,
      connected: connectedPlatform || null,
      alreadyConnected,
    });
  } catch (err) {
    console.error('Outstand callback error:', err);
    return res.status(err.status || 500).json({ error: err.message });
  }
}

async function listAccounts(req, res) {
  try {
    const user = await User.findById(req.user.id).lean();
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    if (!user?.lateAccountId) {
      return res.status(200).json({ accounts: [] });
    }
    let accounts = [];
    try {
      const result = await syncAccountsForUser(req.user.id);
      accounts = result.accounts || [];
    } catch (syncErr) {
      if (syncErr?.message?.includes('OUTSTAND_API_KEY is not configured')) {
        return res.status(200).json({
          accounts: [],
          warning: 'Outstand API key not configured.',
        });
      }
      throw syncErr;
    }
    return res.status(200).json({
      accounts,
      lateAccountId: user.lateAccountId,
    });
  } catch (err) {
    console.error('Outstand list accounts error:', err);
    return res.status(err.status || 500).json({ error: err.message });
  }
}

async function disconnectAccount(req, res) {
  try {
    const platform = normalizePlatformName(req.params.platform);
    const user = await User.findById(req.user.id).lean();
    if (!user?.lateAccountId) {
      return res.status(400).json({ error: 'No Outstand account connected.' });
    }
    const { accounts } = await syncAccountsForUser(req.user.id);
    const account = (accounts || []).find((item) => item.platform === platform);

    if (!account) {
      return res.status(200).json({
        disconnected: true,
        alreadyDisconnected: true,
      });
    }

    await outstandApi.disconnectAccount(account.accountId);

    // Refresh local snapshot best-effort.
    try {
      await syncAccountsForUser(req.user.id);
    } catch (syncErr) {
      console.error('Outstand post-disconnect sync error:', syncErr);
    }

    return res.status(200).json({ disconnected: true });
  } catch (err) {
    console.error('Outstand disconnect error:', err);
    return res.status(err.status || 500).json({ error: err.message });
  }
}

module.exports = {
  connectOutstand,
  outstandCallback,
  listAccounts,
  disconnectAccount,
};
