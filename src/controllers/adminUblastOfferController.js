const mongoose = require('mongoose');

const UBlast = require('../models/UBlast');
const UblastOffer = require('../models/UblastOffer');
const User = require('../models/User');
const { fireAndForgetNotifyAndPush } = require('../services/notifyAndPush');


async function notifyUblastUsers(io, ublast, event = 'released', targetUserIds = []) {
  if (!io || !ublast) return;

  const ids = Array.isArray(targetUserIds) && targetUserIds.length
    ? targetUserIds.map((id) => String(id || '').trim()).filter(Boolean)
    : (await User.find({ isBanned: { $ne: true } }).select('_id').lean())
        .map((user) => String(user._id));

  if (!ids.length) return;

  const heading = event === 'released' ? 'New UBlast Is Live' : 'New UBlast Created';
  const body =
    ublast?.title && String(ublast.title).trim().length
      ? `Admin posted: ${String(ublast.title).trim()}`
      : 'Admin posted a new UBlast.';

  fireAndForgetNotifyAndPush({
    io,
    userIds: ids,
    title: heading,
    body,
    type: 'ublast',
    screen: '/(tabs)/trending',
    data: {
      type: 'ublast',
      ublastId: String(ublast._id),
      event,
    },
  });
}

function requireObjectId(value) {
  return mongoose.isValidObjectId(value);
}

async function createRewardUblast(req, res) {
  const { ublastId } = req.params;
  const { userId } = req.body;
  if (!requireObjectId(ublastId) || !requireObjectId(userId)) {
    return res.status(400).json({ error: 'Invalid ublastId or userId.' });
  }

  const source = await UBlast.findById(ublastId).lean();
  if (!source) {
    return res.status(404).json({ error: 'UBlast not found.' });
  }

  const now = new Date();
  const topExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const expiresAt = new Date(
    now.getTime() + Number(process.env.UBLAST_SHARE_WINDOW_HOURS || 48) * 60 * 60 * 1000,
  );

  const reward = await UBlast.create({
    title: source.title,
    content: source.content,
    mediaUrl: source.mediaUrl,
    mediaType: source.mediaType,
    status: 'released',
    releasedAt: now,
    expiresAt,
    topExpiresAt,
    createdBy: req.user?.id,
    targetUserId: userId,
    rewardType: 'reward',
    rewardLabel: 'Reward UBlast from Admin',
  });

  const io = req.app?.get('io');
  notifyUblastUsers(io, reward, 'released', [userId]).catch((err) => {
    console.error('Reward UBlast broadcast failed:', err?.message || err);
  });

  return res.status(201).json({ ublast: reward });
}

async function createOffer(req, res) {
  const { ublastId } = req.params;
  const { userId, priceCents, priceDollars, currency } = req.body;
  if (!requireObjectId(ublastId) || !requireObjectId(userId)) {
    return res.status(400).json({ error: 'Invalid ublastId or userId.' });
  }
  const amountSource =
    priceDollars !== undefined && priceDollars !== null
      ? Number(priceDollars) * 100
      : Number(priceCents);
  const amount = Math.round(amountSource);
  if (!Number.isFinite(amount) || amount < 50) {
    return res.status(400).json({ error: 'priceDollars must be at least 0.50.' });
  }

  const source = await UBlast.findById(ublastId).lean();
  if (!source) {
    return res.status(404).json({ error: 'UBlast not found.' });
  }

  const now = new Date();
  const topExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const expiresAt = new Date(
    now.getTime() + Number(process.env.UBLAST_SHARE_WINDOW_HOURS || 48) * 60 * 60 * 1000,
  );

  const offerUblast = await UBlast.create({
    title: source.title,
    content: source.content,
    mediaUrl: source.mediaUrl,
    mediaType: source.mediaType,
    status: 'released',
    releasedAt: now,
    expiresAt,
    topExpiresAt,
    createdBy: req.user?.id,
    targetUserId: userId,
    rewardType: 'offer',
    rewardLabel: 'Offer UBlast',
  });

  const offer = await UblastOffer.create({
    userId,
    ublastId: offerUblast._id,
    priceCents: amount,
    currency: currency || 'usd',
    createdBy: req.user?.id,
    expiresAt,
  });

  const io = req.app?.get('io');
  notifyUblastUsers(io, offerUblast, 'released', [userId]).catch((err) => {
    console.error('Offer UBlast broadcast failed:', err?.message || err);
  });

  return res.status(201).json({ offer, ublast: offerUblast });
}

async function getOfferSummary(req, res) {
  const [totalPaid, statusCounts, perUblast] = await Promise.all([
    UblastOffer.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$priceCents' } } },
    ]),
    UblastOffer.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    UblastOffer.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: '$ublastId', total: { $sum: '$priceCents' }, count: { $sum: 1 } } },
      {
        $lookup: {
          from: 'ublasts',
          localField: '_id',
          foreignField: '_id',
          as: 'ublast',
        },
      },
      { $unwind: { path: '$ublast', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          ublastId: '$_id',
          title: '$ublast.title',
          totalCents: '$total',
          count: 1,
        },
      },
      { $sort: { totalCents: -1 } },
    ]),
  ]);

  const statusMap = {};
  statusCounts.forEach((entry) => {
    statusMap[entry._id] = entry.count;
  });

  return res.status(200).json({
    totalEarningsCents: totalPaid[0]?.total || 0,
    statusCounts: {
      pending: statusMap.pending || 0,
      paid: statusMap.paid || 0,
      cancelled: statusMap.cancelled || 0,
      expired: statusMap.expired || 0,
    },
    perUblast: perUblast.map((entry) => ({
      ublastId: entry.ublastId,
      title: entry.title || 'UBlast',
      totalCents: entry.totalCents || 0,
      count: entry.count || 0,
    })),
  });
}

function parsePaging(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  if (max && parsed > max) return max;
  return parsed;
}

async function listOffers(req, res) {
  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 20, 100);
  const skip = (page - 1) * limit;
  const status = req.query.status ? String(req.query.status).toLowerCase() : null;
  const match = status ? { status } : {};

  const [totalCount, offers] = await Promise.all([
    UblastOffer.countDocuments(match),
    UblastOffer.find(match)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'name email')
      .populate('ublastId', 'title')
      .lean(),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  return res.status(200).json({
    offers: offers.map((offer) => ({
      id: offer._id,
      status: offer.status,
      priceCents: offer.priceCents,
      currency: offer.currency || 'usd',
      createdAt: offer.createdAt,
      expiresAt: offer.expiresAt || null,
      user: {
        id: offer.userId?._id,
        name: offer.userId?.name,
        email: offer.userId?.email,
      },
      ublast: {
        id: offer.ublastId?._id,
        title: offer.ublastId?.title || 'UBlast',
      },
    })),
    page,
    totalPages,
    totalCount,
  });
}

async function listRewardedUblasts(req, res) {
  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 20, 100);
  const skip = (page - 1) * limit;

  const match = { rewardType: 'reward' };
  const [totalCount, ublasts] = await Promise.all([
    UBlast.countDocuments(match),
    UBlast.find(match)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('targetUserId', 'name email')
      .lean(),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  return res.status(200).json({
    rewarded: ublasts.map((ublast) => ({
      id: ublast._id,
      title: ublast.title,
      status: ublast.status,
      createdAt: ublast.createdAt,
      expiresAt: ublast.expiresAt || null,
      user: {
        id: ublast.targetUserId?._id,
        name: ublast.targetUserId?.name,
        email: ublast.targetUserId?.email,
      },
      rewardLabel: ublast.rewardLabel || 'Rewarded UBlast',
    })),
    page,
    totalPages,
    totalCount,
  });
}

module.exports = {
  createRewardUblast,
  createOffer,
  getOfferSummary,
  listOffers,
  listRewardedUblasts,
};




