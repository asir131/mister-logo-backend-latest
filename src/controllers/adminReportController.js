const mongoose = require('mongoose');

const ContentReport = require('../models/ContentReport');
const Post = require('../models/Post');
const Ucut = require('../models/Ucut');
const UcutLike = require('../models/UcutLike');
const UcutComment = require('../models/UcutComment');
const UBlast = require('../models/UBlast');
const User = require('../models/User');
const Profile = require('../models/Profile');
const Like = require('../models/Like');
const Comment = require('../models/Comment');
const ModerationAction = require('../models/ModerationAction');

function parsePaging(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  if (max) return Math.min(parsed, max);
  return parsed;
}

function getAdminIdentifier(req) {
  if (req?.admin?.email) return req.admin.email;
  if (req?.admin?.username) return req.admin.username;
  return 'system';
}

async function logModerationAction(action) {
  try {
    await ModerationAction.create(action);
  } catch {
    // no-op
  }
}

async function listReports(req, res) {
  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 10, 100);
  const skip = (page - 1) * limit;

  const [totalCount, reports] = await Promise.all([
    ContentReport.countDocuments({ status: 'open' }),
    ContentReport.find({ status: 'open' })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const reporterIds = Array.from(
    new Set(reports.map((item) => String(item.reporterUserId || '')).filter(Boolean)),
  );
  const postIds = reports
    .filter((item) => item.targetType === 'post')
    .map((item) => item.targetId);
  const ucutIds = reports
    .filter((item) => item.targetType === 'ucut')
    .map((item) => item.targetId);
  const ublastIds = reports
    .filter((item) => item.targetType === 'ublast')
    .map((item) => item.targetId);

  const [reporters, posts, ucuts, ublasts] = await Promise.all([
    User.find({ _id: { $in: reporterIds } }).select('name email').lean(),
    Post.find({ _id: { $in: postIds } })
      .select('userId description mediaUrl mediaType postType createdAt')
      .lean(),
    Ucut.find({ _id: { $in: ucutIds } })
      .select('userId text mediaType segments createdAt')
      .lean(),
    UBlast.find({ _id: { $in: ublastIds } })
      .select('title content mediaUrl mediaType createdAt')
      .lean(),
  ]);

  const contentOwnerIds = Array.from(
    new Set([
      ...posts.map((item) => String(item.userId || '')),
      ...ucuts.map((item) => String(item.userId || '')),
    ].filter(Boolean)),
  );
  const [owners, profiles] = await Promise.all([
    User.find({ _id: { $in: contentOwnerIds } }).select('name email').lean(),
    Profile.find({ userId: { $in: contentOwnerIds } })
      .select('userId displayName username profileImageUrl')
      .lean(),
  ]);

  const reporterById = new Map(reporters.map((item) => [String(item._id), item]));
  const postById = new Map(posts.map((item) => [String(item._id), item]));
  const ucutById = new Map(ucuts.map((item) => [String(item._id), item]));
  const ublastById = new Map(ublasts.map((item) => [String(item._id), item]));
  const ownerById = new Map(owners.map((item) => [String(item._id), item]));
  const profileByUserId = new Map(profiles.map((item) => [String(item.userId), item]));

  const mapped = reports.map((report) => {
    const reporter = reporterById.get(String(report.reporterUserId));
    let content = null;

    if (report.targetType === 'post') {
      const post = postById.get(String(report.targetId));
      const owner = ownerById.get(String(post?.userId || ''));
      const profile = profileByUserId.get(String(post?.userId || ''));
      content = post
        ? {
            title: post.description || '',
            mediaUrl: post.mediaUrl || '',
            mediaType: post.mediaType || '',
            contentType: post.postType || 'post',
            ownerName:
              profile?.displayName || profile?.username || owner?.name || 'Unknown',
            ownerEmail: owner?.email || '',
          }
        : null;
    } else if (report.targetType === 'ucut') {
      const ucut = ucutById.get(String(report.targetId));
      const firstSegment = Array.isArray(ucut?.segments) ? ucut.segments[0] : null;
      const owner = ownerById.get(String(ucut?.userId || ''));
      const profile = profileByUserId.get(String(ucut?.userId || ''));
      content = ucut
        ? {
            title: ucut.text || '',
            mediaUrl: firstSegment?.url || '',
            mediaType: ucut.mediaType || '',
            contentType: 'ucut',
            ownerName:
              profile?.displayName || profile?.username || owner?.name || 'Unknown',
            ownerEmail: owner?.email || '',
          }
        : null;
    } else {
      const ublast = ublastById.get(String(report.targetId));
      content = ublast
        ? {
            title: ublast.title || ublast.content || '',
            mediaUrl: ublast.mediaUrl || '',
            mediaType: ublast.mediaType || '',
            contentType: 'ublast',
            ownerName: 'UNAP Official',
            ownerEmail: '',
          }
        : null;
    }

    return {
      id: String(report._id),
      targetId: String(report.targetId),
      targetType: report.targetType,
      reason: report.reason || '',
      status: report.status,
      createdAt: report.createdAt,
      reporter: {
        id: String(report.reporterUserId),
        name: reporter?.name || 'Unknown',
        email: reporter?.email || '',
      },
      content,
    };
  });

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  return res.status(200).json({
    reports: mapped,
    page,
    totalPages,
    totalCount,
  });
}

async function deleteReportedContent(req, res) {
  const { reportId } = req.params;
  if (!mongoose.isValidObjectId(reportId)) {
    return res.status(400).json({ error: 'Invalid report id.' });
  }

  const report = await ContentReport.findById(reportId).lean();
  if (!report) {
    return res.status(404).json({ error: 'Report not found.' });
  }

  let deleted = false;
  let targetEmail = '';
  let moderationTargetType = report.targetType;

  if (report.targetType === 'post') {
    const post = await Post.findById(report.targetId).lean();
    if (!post) {
      await ContentReport.updateMany(
        { targetType: 'post', targetId: report.targetId, status: 'open' },
        {
          $set: {
            status: 'content_deleted',
            resolvedAt: new Date(),
            resolvedBy: getAdminIdentifier(req),
          },
        },
      );
      return res.status(200).json({ deleted: true });
    }
    const owner = await User.findById(post.userId).select('email').lean();
    targetEmail = owner?.email || '';
    await Promise.all([
      Post.findByIdAndDelete(report.targetId),
      Like.deleteMany({ postId: report.targetId }),
      Comment.deleteMany({ postId: report.targetId }),
    ]);
    deleted = true;
  } else if (report.targetType === 'ucut') {
    const ucut = await Ucut.findById(report.targetId).lean();
    if (!ucut) {
      await ContentReport.updateMany(
        { targetType: 'ucut', targetId: report.targetId, status: 'open' },
        {
          $set: {
            status: 'content_deleted',
            resolvedAt: new Date(),
            resolvedBy: getAdminIdentifier(req),
          },
        },
      );
      return res.status(200).json({ deleted: true });
    }
    const owner = await User.findById(ucut.userId).select('email').lean();
    targetEmail = owner?.email || '';
    await Promise.all([
      Ucut.findByIdAndDelete(report.targetId),
      UcutLike.deleteMany({ ucutId: report.targetId }),
      UcutComment.deleteMany({ ucutId: report.targetId }),
    ]);
    deleted = true;
  } else if (report.targetType === 'ublast') {
    await UBlast.findByIdAndDelete(report.targetId);
    deleted = true;
  }

  await ContentReport.updateMany(
    {
      targetType: report.targetType,
      targetId: report.targetId,
      status: 'open',
    },
    {
      $set: {
        status: 'content_deleted',
        resolvedAt: new Date(),
        resolvedBy: getAdminIdentifier(req),
      },
    },
  );

  await logModerationAction({
    type: 'delete_post',
    targetType: moderationTargetType,
    targetId: report.targetId,
    targetEmail,
    performedBy: getAdminIdentifier(req),
  });

  return res.status(200).json({ deleted });
}

module.exports = {
  listReports,
  deleteReportedContent,
};
