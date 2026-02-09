const User = require('../models/User');
const lateApi = require('./lateApi');

function normalizePlatformName(value) {
  const platform = String(value || '').toLowerCase().trim();
  if (!platform) return '';
  if (platform === 'x') return 'twitter';
  if (platform === 'twitter/x') return 'twitter';
  return platform;
}

function normalizeAccountsResponse(data, profileId) {
  const raw = Array.isArray(data?.accounts) ? data.accounts : Array.isArray(data) ? data : [];
  return raw
    .map((account) => {
      const rawPlatform = String(account.platform || account.provider || '')
        .toLowerCase()
        .trim();
      return {
      platform: normalizePlatformName(rawPlatform),
      rawPlatform,
      accountId: account._id || account.id || account.accountId,
      username: account.username,
      displayName: account.displayName,
      profileId: account.profileId || profileId,
    };
    })
    .filter((account) => account.platform && account.accountId);
}

async function syncAccountsForUser(userId) {
  const user = await User.findById(userId).lean();
  if (!user?.lateAccountId) {
    const error = new Error('LATE account not connected.');
    error.status = 400;
    throw error;
  }

  const response = await lateApi.getConnectedAccounts(user.lateAccountId);
  const accounts = normalizeAccountsResponse(response, user.lateAccountId);

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        connectedPlatforms: accounts.map((acc) => acc.platform),
        connectedAccounts: accounts,
      },
    },
  );
  return { accounts, lateProfileId: user.lateAccountId };
}

async function resolvePlatformsForUser(userId, targets) {
  const { accounts, lateProfileId } = await syncAccountsForUser(userId);

  const requested = (targets || []).map((t) => normalizePlatformName(t));
  const platforms = [];
  const missing = [];

  requested.forEach((platform) => {
    const match = accounts.find((acc) => acc.platform === platform);
    if (match) {
      // Use provider-native platform key when calling LATE APIs.
      platforms.push({
        platform: match.rawPlatform || match.platform,
        accountId: match.accountId,
      });
    } else {
      missing.push(platform);
    }
  });

  return { platforms, missing, lateProfileId };
}

module.exports = {
  syncAccountsForUser,
  resolvePlatformsForUser,
};
