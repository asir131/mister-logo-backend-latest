const mongoose = require('mongoose');

const User = require('../models/User');
const Profile = require('../models/Profile');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Like = require('../models/Like');
const Follow = require('../models/Follow');
const SavedPost = require('../models/SavedPost');
const RefreshToken = require('../models/RefreshToken');
const OtpToken = require('../models/OtpToken');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Ucut = require('../models/Ucut');
const UcutLike = require('../models/UcutLike');
const UcutComment = require('../models/UcutComment');
const UBlastSubmission = require('../models/UBlastSubmission');
const UblastOffer = require('../models/UblastOffer');
const UBlast = require('../models/UBlast');
const Block = require('../models/Block');
const SupportThread = require('../models/SupportThread');
const SupportMessage = require('../models/SupportMessage');
const Notification = require('../models/Notification');
const TrendingPlacement = require('../models/TrendingPlacement');

function toObjectIds(userIds = []) {
  return userIds
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));
}

async function hardDeleteUsers(userIds = []) {
  const objectIds = toObjectIds(userIds);
  if (!objectIds.length) return { deleted: 0 };

  const users = await User.find({ _id: { $in: objectIds } }).select('_id email').lean();
  if (!users.length) return { deleted: 0 };

  const existingObjectIds = users.map((user) => user._id);
  const existingIdStrings = existingObjectIds.map((id) => String(id));
  const emails = users.map((user) => user.email).filter(Boolean);

  await Promise.all([
    SupportMessage.deleteMany({ userId: { $in: existingObjectIds } }),
    SupportThread.deleteMany({ userId: { $in: existingObjectIds } }),
    UcutComment.deleteMany({ userId: { $in: existingObjectIds } }),
    UcutLike.deleteMany({ userId: { $in: existingObjectIds } }),
    Ucut.deleteMany({ userId: { $in: existingObjectIds } }),
    Message.deleteMany({
      $or: [
        { senderId: { $in: existingObjectIds } },
        { recipientId: { $in: existingObjectIds } },
      ],
    }),
    Conversation.deleteMany({ participants: { $in: existingObjectIds } }),
    SavedPost.deleteMany({ userId: { $in: existingObjectIds } }),
    Like.deleteMany({ userId: { $in: existingObjectIds } }),
    Comment.deleteMany({ userId: { $in: existingObjectIds } }),
    Follow.deleteMany({
      $or: [
        { followerId: { $in: existingObjectIds } },
        { followingId: { $in: existingObjectIds } },
      ],
    }),
    UBlastSubmission.deleteMany({ userId: { $in: existingObjectIds } }),
    UblastOffer.deleteMany({ userId: { $in: existingObjectIds } }),
    UBlast.deleteMany({
      $or: [
        { createdBy: { $in: existingObjectIds } },
        { targetUserId: { $in: existingObjectIds } },
      ],
    }),
    Block.deleteMany({
      $or: [
        { blockerId: { $in: existingObjectIds } },
        { blockedId: { $in: existingObjectIds } },
      ],
    }),
    Notification.deleteMany({ userId: { $in: existingObjectIds } }),
    TrendingPlacement.deleteMany({ createdBy: { $in: existingObjectIds } }),
    Post.deleteMany({ userId: { $in: existingObjectIds } }),
    Profile.updateMany(
      {},
      {
        $pull: {
          followers: { userId: { $in: existingObjectIds } },
          following: { userId: { $in: existingObjectIds } },
        },
      },
    ),
    Profile.deleteMany({ userId: { $in: existingObjectIds } }),
    RefreshToken.deleteMany({ userId: { $in: existingObjectIds } }),
    OtpToken.deleteMany({
      $or: [
        emails.length ? { email: { $in: emails } } : null,
        { 'payload.userId': { $in: existingIdStrings } },
      ].filter(Boolean),
    }),
    User.deleteMany({ _id: { $in: existingObjectIds } }),
  ]);

  return { deleted: existingObjectIds.length, users };
}

module.exports = { hardDeleteUsers };
