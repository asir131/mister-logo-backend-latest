const User = require('../models/User');
const outstandApi = require('./outstandApi');

function normalizePlatformName(value) {
  const platform = String(value || '').toLowerCase().trim();
  if (!platform) return '';
  if (platform === 'twitter') return 'x';
  if (platform === 'x') return 'twitter';
  return platform;
}

function normalizeAccountsResponse(data, tenantId) {
  const raw = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.accounts)
      ? data.accounts
      : Array.isArray(data)
        ? data
        : [];

  return raw
    .map((account) => {
      const rawPlatform = String(
        account.network || account.platform || account.provider || '',
      )
        .toLowerCase()
        .trim();
      return {
        platform: normalizePlatformName(rawPlatform),
        rawPlatform,
        accountId: account.id || account._id || account.accountId,
        username: account.username || account.handle || account.name,
        displayName: account.displayName || account.name,
        profileId: account.tenantId || account.tenant_id || tenantId,
      };
    })
    .filter((account) => account.platform && account.accountId);
}

async function ensureTenantId(user) {
  if (user?.lateAccountId) return user.lateAccountId;
  const tenantId = outstandApi.buildTenantId(user?._id || user?.id);
  if (tenantId) {
    await User.updateOne(
      { _id: user._id },
      { $set: { lateAccountId: tenantId } },
    );
  }
  return tenantId;
}

async function syncAccountsForUser(userId) {
  const user = await User.findById(userId).lean();
  if (!user) {
    const error = new Error('User not found.');
    error.status = 404;
    throw error;
  }

  const tenantId = await ensureTenantId(user);
  if (!tenantId) {
    const error = new Error('Outstand tenant not configured.');
    error.status = 400;
    throw error;
  }

  const response = await outstandApi.getConnectedAccounts(tenantId);
  const accounts = normalizeAccountsResponse(response, tenantId);

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        connectedPlatforms: accounts.map((acc) => acc.platform),
        connectedAccounts: accounts,
      },
    },
  );
  return { accounts, tenantId };
}

async function resolveAccountsForUser(userId, targets) {
  const { accounts, tenantId } = await syncAccountsForUser(userId);

  const requested = (targets || []).map((t) => normalizePlatformName(t));
  const accountIds = [];
  const missing = [];

  requested.forEach((platform) => {
    const match = accounts.find((acc) => acc.platform === platform);
    if (match) {
      accountIds.push(match.accountId);
    } else {
      missing.push(platform);
    }
  });

  return { accountIds, missing, tenantId };
}

module.exports = {
  syncAccountsForUser,
  resolveAccountsForUser,
};
