const mongoose = require("mongoose");

const UBlast = require("../models/UBlast");
const TrendingPlacement = require("../models/TrendingPlacement");
const Post = require("../models/Post");

function parsePaging(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  if (max) return Math.min(parsed, max);
  return parsed;
}

async function getTrending(req, res) {
  const now = new Date();
  const section = req.query.section ? String(req.query.section).toLowerCase() : null;
  const limitTop = parsePaging(req.query.topLimit, 16, 16);
  const limitManual = parsePaging(req.query.manualLimit, 16, 16);
  const limitOrganic = parsePaging(req.query.organicLimit, 64, 100);
  const topPage = parsePaging(req.query.topPage, 1, 100);
  const manualPage = parsePaging(req.query.manualPage, 1, 100);
  const organicPage = parsePaging(req.query.organicPage, 1, 100);
  const topSkip = (topPage - 1) * limitTop;
  const manualSkip = (manualPage - 1) * limitManual;
  const organicSkip = (organicPage - 1) * limitOrganic;

  const activeUblasts = await UBlast.find({
    status: "released",
    releasedAt: { $lte: now },
    $or: [
      { topExpiresAt: { $gt: now } },
      { topExpiresAt: { $exists: false }, expiresAt: { $gt: now } },
    ],
  })
    .sort({ releasedAt: -1 })
    .lean();

  const activeUblastIds = activeUblasts.map((ublast) => ublast._id);
  const visibilityMatch = {
    $and: [
      {
        $or: [{ status: "published" }, { status: { $exists: false } }],
      },
      {
        $or: [{ isApproved: true }, { isApproved: { $exists: false } }],
      },
    ],
  };

  const topFilter = activeUblastIds.length
    ? { ublastId: { $in: activeUblastIds }, ...visibilityMatch }
    : null;
  const [topTotalCount, topPosts] = topFilter
    ? await Promise.all([
        Post.countDocuments(topFilter),
        Post.find(topFilter)
          .sort({ createdAt: -1 })
          .skip(topSkip)
          .limit(limitTop)
          .lean(),
      ])
    : [0, []];

  const manualPlacements = await TrendingPlacement.find({
    section: "manual",
    $or: [{ endAt: null }, { endAt: { $gt: now } }],
  })
    .sort({ position: 1, createdAt: -1 })
    .lean();

  const manualTotalCount = manualPlacements.length;
  const pagedManualPlacements = manualPlacements.slice(
    manualSkip,
    manualSkip + limitManual,
  );
  const manualPostIds = pagedManualPlacements.map(
    (placement) => placement.postId,
  );
  const manualPosts = manualPostIds.length
    ? await Post.find({
        _id: { $in: manualPostIds },
        ...visibilityMatch,
      }).lean()
    : [];

  const manualById = new Map(
    manualPosts.map((post) => [post._id.toString(), post]),
  );

  const manual = manualPlacements
    .slice(manualSkip, manualSkip + limitManual)
    .map((placement) => ({
      placementId: placement._id,
      position: placement.position,
      post: manualById.get(placement.postId.toString()) || null,
    }))
    .filter((entry) => entry.post);

  const excludedIds = new Set([
    ...manualPostIds.map((id) => id.toString()),
    ...topPosts.map((post) => post._id.toString()),
  ]);

  const organicMatch = {
    $and: [
      { $or: [{ status: "published" }, { status: { $exists: false } }] },
      { $or: [{ isApproved: true }, { isApproved: { $exists: false } }] },
    ],
    $or: [{ ublastId: null }, { ublastId: { $exists: false } }],
    ...(excludedIds.size
      ? {
          _id: {
            $nin: Array.from(
              excludedIds,
              (id) => new mongoose.Types.ObjectId(id),
            ),
          },
        }
      : {}),
  };

  const organicPipeline = [
    { $match: organicMatch },
    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "author",
      },
    },
    { $unwind: "$author" },
    {
      $match: {
        "author.isBlocked": { $ne: true },
        "author.isBanned": { $ne: true },
      },
    },
    {
      $lookup: {
        from: "likes",
        let: { postId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$postId", "$$postId"] } } },
          { $count: "count" },
        ],
        as: "likeCounts",
      },
    },
    {
      $lookup: {
        from: "comments",
        let: { postId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$postId", "$$postId"] } } },
          { $count: "count" },
        ],
        as: "commentCounts",
      },
    },
    {
      $lookup: {
        from: "savedposts",
        let: { postId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$postId", "$$postId"] } } },
          { $count: "count" },
        ],
        as: "savedCounts",
      },
    },
    {
      $addFields: {
        likeCount: { $ifNull: [{ $arrayElemAt: ["$likeCounts.count", 0] }, 0] },
        commentCount: {
          $ifNull: [{ $arrayElemAt: ["$commentCounts.count", 0] }, 0],
        },
        saveCount: {
          $ifNull: [{ $arrayElemAt: ["$savedCounts.count", 0] }, 0],
        },
      },
    },
    {
      $addFields: {
        ageHours: {
          $divide: [{ $subtract: [now, "$createdAt"] }, 1000 * 60 * 60],
        },
        engagementScore: {
          $divide: [
            {
              $add: [
                { $multiply: ["$likeCount", 3] },
                { $multiply: ["$commentCount", 2] },
                { $multiply: ["$saveCount", 4] },
              ],
            },
            { $pow: [{ $add: ["$ageHours", 2] }, 1.5] },
          ],
        },
      },
    },
    { $sort: { engagementScore: -1, createdAt: -1 } },
    { $skip: organicSkip },
    { $limit: limitOrganic },
    {
      $project: {
        description: 1,
        mediaType: 1,
        mediaUrl: 1,
        createdAt: 1,
        userId: 1,
        engagementScore: 1,
        likeCount: 1,
        commentCount: 1,
        saveCount: 1,
      },
    },
  ];

  const organicCountPipeline = [
    { $match: organicMatch },
    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "author",
      },
    },
    { $unwind: "$author" },
    {
      $match: {
        "author.isBlocked": { $ne: true },
        "author.isBanned": { $ne: true },
      },
    },
    { $count: "count" },
  ];

  const [organic, organicCount] = await Promise.all([
    Post.aggregate(organicPipeline),
    Post.aggregate(organicCountPipeline),
  ]);
  const organicTotalCount = organicCount[0]?.count || 0;

  const items = [
    ...topPosts.map((post) => ({ type: "ublast", post })),
    ...manual.map((entry) => ({
      type: "manual",
      post: entry.post,
      position: entry.position,
    })),
    ...organic.map((post) => ({ type: "organic", post })),
  ];

  const meta = {
    top: {
      page: topPage,
      totalPages: Math.max(1, Math.ceil(topTotalCount / limitTop)),
      totalCount: topTotalCount,
    },
    manual: {
      page: manualPage,
      totalPages: Math.max(1, Math.ceil(manualTotalCount / limitManual)),
      totalCount: manualTotalCount,
    },
    organic: {
      page: organicPage,
      totalPages: Math.max(1, Math.ceil(organicTotalCount / limitOrganic)),
      totalCount: organicTotalCount,
    },
  };

  if (section) {
    switch (section) {
      case 'top':
        return res.status(200).json({ top: topPosts, meta: { top: meta.top } });
      case 'manual':
        return res.status(200).json({ manual, meta: { manual: meta.manual } });
      case 'organic':
        return res.status(200).json({ organic, meta: { organic: meta.organic } });
      case 'items':
        return res.status(200).json({ items });
      case 'meta':
        return res.status(200).json({ meta });
      default:
        return res.status(400).json({
          error: 'section must be one of: top, manual, organic, items, meta',
        });
    }
  }

  return res.status(200).json({
    top: topPosts,
    manual,
    organic,
    items,
    meta,
  });
}

module.exports = { getTrending };
