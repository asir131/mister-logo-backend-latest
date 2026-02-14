const User = require('../models/User');
const lateApi = require('../services/lateApi');
const { syncAccountsForUser } = require('../services/lateAccounts');

function normalizePlatformName(value) {
  const platform = String(value || '').toLowerCase().trim();
  if (!platform) return '';
  if (platform === 'x') return 'twitter';
  return platform;
}

async function connectLate(req, res) {
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
    const callbackUri = host
      ? `${protocol}://${host}/api/accounts/late-callback`
      : undefined;

    const data = await lateApi.connectAccount(
      userId,
      platform,
      appRedirectUri,
      callbackUri,
    );
    return res.status(200).json({
      url: data.url,
      authUrl: data.authUrl,
      accountId: data.accountId,
    });
  } catch (err) {
    console.error('LATE connect error:', err);
    return res.status(err.status || 500).json({ error: err.message });
  }
}

async function lateCallback(req, res) {
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
    const connectedPlatform = normalizePlatformName(
      pickParam('connected') || pickParam('platform')
    );
    const profileId = pickParam('profileId') || process.env.LATE_PROFILE_ID;
    let alreadyConnected = false;

    if (userId && profileId) {
      const existingUser = await User.findById(userId).lean();
      if (existingUser && connectedPlatform) {
        alreadyConnected = (existingUser.connectedPlatforms || []).includes(connectedPlatform);
      }

      const updates = {
        lateAccountId: profileId,
      };
      const ops = { $set: updates };
      if (connectedPlatform) {
        ops.$addToSet = { connectedPlatforms: connectedPlatform };
      }
      await User.updateOne({ _id: userId }, ops);
      try {
        await syncAccountsForUser(userId);
      } catch (syncError) {
        console.error('LATE sync accounts error:', syncError);
      }
    }

    const redirectUrl = resolveClientRedirect({
      status: 'success',
      connected: connectedPlatform || '',
      profileId: profileId || '',
      alreadyConnected: alreadyConnected ? '1' : '0',
    });
    if (redirectUrl) {
      return res.redirect(302, redirectUrl);
    }

    return res.status(200).json({
      ok: true,
      userId,
      profileId,
      connected: connectedPlatform || null,
      alreadyConnected,
    });
  } catch (err) {
    console.error('LATE callback error:', err);
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
    const { accounts } = await syncAccountsForUser(req.user.id);
    return res.status(200).json({
      accounts,
      lateAccountId: user.lateAccountId,
    });
  } catch (err) {
    console.error('LATE list accounts error:', err);
    return res.status(err.status || 500).json({ error: err.message });
  }
}

async function disconnectAccount(req, res) {
  try {
    const platform = normalizePlatformName(req.params.platform);
    const user = await User.findById(req.user.id).lean();
    if (!user?.lateAccountId) {
      return res.status(400).json({ error: 'No LATE account connected.' });
    }
    const { accounts } = await syncAccountsForUser(req.user.id);
    const account = (accounts || []).find((item) => item.platform === platform);

    if (!account) {
      return res.status(200).json({
        disconnected: true,
        alreadyDisconnected: true,
      });
    }

    await lateApi.disconnectAccount({
      lateProfileId: user.lateAccountId,
      accountId: account.accountId,
      platform,
    });

    // Refresh local snapshot best-effort.
    try {
      await syncAccountsForUser(req.user.id);
    } catch (syncErr) {
      console.error('LATE post-disconnect sync error:', syncErr);
    }

    return res.status(200).json({ disconnected: true });
  } catch (err) {
    console.error('LATE disconnect error:', err);
    return res.status(err.status || 500).json({ error: err.message });
  }
}

module.exports = {
  connectLate,
  lateCallback,
  listAccounts,
  disconnectAccount,
};
