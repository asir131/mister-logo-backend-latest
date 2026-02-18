const UBlast = require('../models/UBlast');
const User = require('../models/User');
const Post = require('../models/Post');
const { fireAndForgetNotifyAndPush } = require('../services/notifyAndPush');

const BLOCK_DAYS = Number(process.env.UBLAST_BLOCK_DAYS || 90);
const SHARE_WINDOW_HOURS = Number(process.env.UBLAST_SHARE_WINDOW_HOURS || 48);

function getUblastNotificationPayload(ublast) {
  const title = 'New UBlast Is Live';
  const body =
    ublast?.title && String(ublast.title).trim().length
      ? `Admin posted: ${String(ublast.title).trim()}`
      : 'A scheduled UBlast is now live.';

  return {
    title,
    body,
    type: 'ublast',
    screen: '/(tabs)/trending',
    data: {
      type: 'ublast',
      ublastId: String(ublast?._id || ''),
      event: 'scheduled-release',
    },
  };
}

async function releaseScheduledUblasts(io) {
  const now = new Date();
  const topExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const expiresAt = new Date(now.getTime() + SHARE_WINDOW_HOURS * 60 * 60 * 1000);
  const scheduled = await UBlast.find({
    status: 'scheduled',
    scheduledFor: { $lte: now, $ne: null },
  }).lean();

  if (scheduled.length === 0) return;

  const users = await User.find({ isBanned: { $ne: true } }).select('_id').lean();
  const userIds = users.map((user) => String(user._id)).filter(Boolean);

  for (const ublast of scheduled) {
    await UBlast.updateOne(
      { _id: ublast._id },
      {
        $set: {
          status: 'released',
          releasedAt: now,
          expiresAt,
          topExpiresAt,
        },
      },
    );

    if (userIds.length) {
      const payload = getUblastNotificationPayload(ublast);
      fireAndForgetNotifyAndPush({
        io,
        userIds,
        title: payload.title,
        body: payload.body,
        type: payload.type,
        screen: payload.screen,
        data: payload.data,
      });
    }
  }
}

async function expireUblasts() {
  const now = new Date();
  await UBlast.updateMany(
    {
      status: 'released',
      expiresAt: { $lte: now },
    },
    {
      $set: { status: 'expired' },
    },
  );
}

async function clearExpiredBlocks() {
  const now = new Date();
  await User.updateMany(
    { ublastBlockedUntil: { $lte: now } },
    { $unset: { ublastBlockedUntil: '' } },
  );
}

async function enforceUblastShareWindow() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - SHARE_WINDOW_HOURS * 60 * 60 * 1000);

  const overdueUblasts = await UBlast.find({
    status: 'released',
    releasedAt: { $lte: cutoff },
  })
    .select('_id')
    .lean();

  if (overdueUblasts.length === 0) return;

  const overdueIds = overdueUblasts.map((ublast) => ublast._id);

  const fullyCompliant = await Post.aggregate([
    { $match: { ublastId: { $in: overdueIds } } },
    {
      $group: {
        _id: '$userId',
        ublastIds: { $addToSet: '$ublastId' },
      },
    },
    {
      $project: {
        count: { $size: '$ublastIds' },
      },
    },
    { $match: { count: overdueIds.length } },
  ]);

  const compliantUserIds = fullyCompliant.map((entry) => entry._id);

  const blockUntil = new Date(now.getTime() + BLOCK_DAYS * 24 * 60 * 60 * 1000);

  await User.updateMany(
    {
      isBlocked: { $ne: true },
      isBanned: { $ne: true },
      $or: [
        { ublastBlockedUntil: { $exists: false } },
        { ublastBlockedUntil: null },
        { ublastBlockedUntil: { $lte: now } },
      ],
      _id: { $nin: compliantUserIds },
    },
    { $set: { ublastBlockedUntil: blockUntil } },
  );
}

function startUblastJobs(io) {
  const intervalMs = 60 * 1000;

  const runAll = () => {
    releaseScheduledUblasts(io).catch((err) =>
      console.error('UBlast release job failed:', err),
    );
    expireUblasts().catch((err) =>
      console.error('UBlast expiry job failed:', err),
    );
    enforceUblastShareWindow().catch((err) =>
      console.error('UBlast share enforcement failed:', err),
    );
    clearExpiredBlocks().catch((err) =>
      console.error('UBlast unblock job failed:', err),
    );
  };

  runAll();
  setInterval(runAll, intervalMs);

  console.log(
    `UBlast jobs scheduled (block ${BLOCK_DAYS}d).`,
  );
}

module.exports = { startUblastJobs };

