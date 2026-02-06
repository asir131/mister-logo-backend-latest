const mongoose = require('mongoose');

const Follow = require('../models/Follow');
const User = require('../models/User');
const Profile = require('../models/Profile');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Block = require('../models/Block');
const { uploadMediaBuffer } = require('../services/cloudinary');
const { getOnlineUserIds } = require('../store/onlineUsers');

function parsePaging(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  if (max) return Math.min(parsed, max);
  return parsed;
}

function makePairKey(a, b) {
  const [first, second] = [a.toString(), b.toString()].sort();
  return `${first}:${second}`;
}

async function getMutualFollowIds(userId) {
  const following = await Follow.find({ followerId: userId })
    .select('followingId')
    .lean();
  const followingIds = following.map((entry) => entry.followingId.toString());
  if (!followingIds.length) return [];

  const mutual = await Follow.find({
    followerId: { $in: followingIds },
    followingId: userId,
  })
    .select('followerId')
    .lean();

  return mutual.map((entry) => entry.followerId.toString());
}

async function ensureMutualFollow(userId, otherUserId) {
  const [follows, followedBy] = await Promise.all([
    Follow.exists({ followerId: userId, followingId: otherUserId }),
    Follow.exists({ followerId: otherUserId, followingId: userId }),
  ]);
  return Boolean(follows && followedBy);
}

function pickName(user, profile) {
  return (
    profile?.displayName ||
    profile?.username ||
    user?.name ||
    'Unknown User'
  );
}

function getDeletedAtForUser(conversation, userId) {
  if (!conversation?.deletedFor?.length) return null;
  const entry = conversation.deletedFor.find(
    (item) => item.userId?.toString() === userId.toString(),
  );
  return entry?.deletedAt ? new Date(entry.deletedAt) : null;
}

async function getBlockInfo(userId, otherUserId) {
  const [blockedByMe, blockedMe] = await Promise.all([
    Block.exists({ blockerId: userId, blockedId: otherUserId }),
    Block.exists({ blockerId: otherUserId, blockedId: userId }),
  ]);
  return {
    blockedByMe: Boolean(blockedByMe),
    blockedMe: Boolean(blockedMe),
  };
}

async function getChatList(req, res) {
  const userId = req.user.id;
  const mutualIds = await getMutualFollowIds(userId);
  const onlineUserIds = getOnlineUserIds();

  const conversations = await Conversation.find({
    participants: new mongoose.Types.ObjectId(userId),
  }).lean();

  const convoByKey = new Map(conversations.map((conv) => [conv.pairKey, conv]));
  const convoIds = conversations.map((conv) => conv._id);
  const deletedAtByConvoId = new Map();
  const convoIdsWithDeleted = [];
  const convoIdsWithoutDeleted = [];
  conversations.forEach((conv) => {
    const deletedAt = getDeletedAtForUser(conv, userId);
    if (deletedAt) {
      deletedAtByConvoId.set(conv._id.toString(), deletedAt);
      convoIdsWithDeleted.push(conv._id);
    } else {
      convoIdsWithoutDeleted.push(conv._id);
    }
  });
  const convoOtherIds = conversations
    .map((conv) =>
      conv.participants.find((id) => id.toString() !== userId.toString()),
    )
    .filter(Boolean)
    .map((id) => id.toString());

  const allIds = Array.from(new Set([...mutualIds, ...convoOtherIds]));
  if (allIds.length === 0) {
    return res.status(200).json({ chats: [] });
  }

  const [users, profiles] = await Promise.all([
    User.find({ _id: { $in: allIds } })
      .select('name')
      .lean(),
    Profile.find({ userId: { $in: allIds } })
      .select('userId displayName username profileImageUrl')
      .lean(),
  ]);

  const userById = new Map(users.map((user) => [user._id.toString(), user]));
  const profileByUserId = new Map(
    profiles.map((profile) => [profile.userId.toString(), profile]),
  );

  const unreadCounts = convoIdsWithoutDeleted.length
    ? await Message.aggregate([
        {
          $match: {
            conversationId: { $in: convoIdsWithoutDeleted },
            recipientId: new mongoose.Types.ObjectId(userId),
            readAt: null,
          },
        },
        { $group: { _id: '$conversationId', count: { $sum: 1 } } },
      ])
    : [];

  const unreadByConvo = new Map(
    unreadCounts.map((item) => [item._id.toString(), item.count]),
  );
  if (convoIdsWithDeleted.length) {
    const counts = await Promise.all(
      convoIdsWithDeleted.map(async (convoId) => {
        const deletedAt = deletedAtByConvoId.get(convoId.toString());
        const count = await Message.countDocuments({
          conversationId: convoId,
          recipientId: userId,
          readAt: null,
          createdAt: { $gt: deletedAt },
        });
        return [convoId.toString(), count];
      }),
    );
    counts.forEach(([id, count]) => unreadByConvo.set(id, count));
  }

  const chats = allIds.map((otherId) => {
    const user = userById.get(otherId);
    const profile = profileByUserId.get(otherId);
    const convo = convoByKey.get(makePairKey(userId, otherId));
    const deletedAt = convo ? getDeletedAtForUser(convo, userId) : null;
    const lastMessage =
      convo?.lastMessage && deletedAt && convo.lastMessage.createdAt
        ? new Date(convo.lastMessage.createdAt) > deletedAt
          ? convo.lastMessage
          : null
        : convo?.lastMessage || null;
    const unreadCount = convo ? unreadByConvo.get(convo._id.toString()) || 0 : 0;

    return {
      userId: otherId,
      name: pickName(user, profile),
      profileImageUrl: profile?.profileImageUrl || null,
      lastMessage,
      unreadCount,
      conversationId: convo?._id || null,
      isOnline: onlineUserIds.has(otherId),
      lastActivityAt:
        lastMessage?.createdAt || deletedAt || convo?.updatedAt || null,
    };
  });

  chats.sort((a, b) => {
    const aTime = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
    const bTime = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
    if (aTime !== bTime) return bTime - aTime;
    return a.name.localeCompare(b.name);
  });

  return res.status(200).json({
    chats: chats.map(({ lastActivityAt, ...rest }) => rest),
  });
}

async function getConversation(req, res) {
  const userId = req.user.id;
  const { userId: otherUserId } = req.params;

  if (!mongoose.isValidObjectId(otherUserId)) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  if (userId === otherUserId) {
    return res.status(400).json({ error: 'Cannot chat with yourself.' });
  }

  const [otherUser, mutual] = await Promise.all([
    User.findById(otherUserId).select('name').lean(),
    ensureMutualFollow(userId, otherUserId),
  ]);

  if (!otherUser) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const profile = await Profile.findOne({ userId: otherUserId })
    .select('userId displayName username profileImageUrl')
    .lean();
  const onlineUserIds = getOnlineUserIds();
  const blockInfo = await getBlockInfo(userId, otherUserId);

  const pairKey = makePairKey(userId, otherUserId);
  const conversation = await Conversation.findOne({ pairKey }).lean();

  if (!conversation) {
    if (!mutual) {
      return res.status(403).json({ error: 'Chat available only for mutual follows.' });
    }
    return res.status(200).json({
      conversationId: null,
      participant: {
        userId: otherUserId,
        name: pickName(otherUser, profile),
        profileImageUrl: profile?.profileImageUrl || null,
        isOnline: onlineUserIds.has(otherUserId.toString()),
        blockedByMe: blockInfo.blockedByMe,
        blockedMe: blockInfo.blockedMe,
      },
      messages: [],
      page: 1,
      totalPages: 1,
      totalCount: 0,
    });
  }

  const page = parsePaging(req.query.page, 1);
  const limit = parsePaging(req.query.limit, 20, 50);
  const skip = (page - 1) * limit;
  const deletedAt = getDeletedAtForUser(conversation, userId);
  const messageFilter = {
    conversationId: conversation._id,
    ...(deletedAt ? { createdAt: { $gt: deletedAt } } : {}),
  };

  const [totalCount, rawMessages] = await Promise.all([
    Message.countDocuments(messageFilter),
    Message.find(messageFilter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  await Message.updateMany(
    {
      conversationId: conversation._id,
      recipientId: userId,
      readAt: null,
      ...(deletedAt ? { createdAt: { $gt: deletedAt } } : {}),
    },
    { $set: { readAt: new Date() } },
  );

  const messages = rawMessages.reverse();
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  return res.status(200).json({
    conversationId: conversation._id,
    participant: {
      userId: otherUserId,
      name: pickName(otherUser, profile),
      profileImageUrl: profile?.profileImageUrl || null,
      isOnline: onlineUserIds.has(otherUserId.toString()),
      blockedByMe: blockInfo.blockedByMe,
      blockedMe: blockInfo.blockedMe,
    },
    messages,
    page,
    totalPages,
    totalCount,
  });
}

function resolveMediaType(mime) {
  if (!mime) return null;
  const prefix = mime.split('/')[0];
  if (['image', 'video', 'audio'].includes(prefix)) return prefix;
  return 'file';
}

async function sendMessage(req, res) {
  const userId = req.user.id;
  const { userId: otherUserId } = req.params;
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const file = req.file;

  if (!mongoose.isValidObjectId(otherUserId)) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  if (userId === otherUserId) {
    return res.status(400).json({ error: 'Cannot chat with yourself.' });
  }

  if (!text && !file) {
    return res.status(400).json({ error: 'Message text or file is required.' });
  }

  const [otherUser] = await Promise.all([
    User.findById(otherUserId).select('name').lean(),
  ]);

  if (!otherUser) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const blockInfo = await getBlockInfo(userId, otherUserId);
  if (blockInfo.blockedByMe || blockInfo.blockedMe) {
    return res.status(403).json({ error: 'Messaging is blocked for this user.' });
  }

  const pairKey = makePairKey(userId, otherUserId);
  const conversation = await Conversation.findOneAndUpdate(
    { pairKey },
    {
      $setOnInsert: {
        pairKey,
        participants: [userId, otherUserId],
      },
    },
    { new: true, upsert: true },
  );

  let mediaUrl = null;
  let mediaType = null;
  let mediaMime = null;
  let fileName = null;
  let fileSize = null;

  if (file) {
    const uploadResult = await uploadMediaBuffer(file.buffer, {
      folder: 'mister-logo/chat',
      resource_type: 'auto',
    });
    mediaUrl = uploadResult.secure_url || uploadResult.url;
    mediaMime = file.mimetype;
    mediaType = resolveMediaType(file.mimetype);
    fileName = file.originalname;
    fileSize = file.size;
  }

  const message = await Message.create({
    conversationId: conversation._id,
    senderId: userId,
    recipientId: otherUserId,
    text,
    mediaUrl,
    mediaType,
    mediaMime,
    fileName,
    fileSize,
  });

  const lastMessage = {
    senderId: userId,
    text,
    mediaUrl,
    mediaType,
    createdAt: message.createdAt,
  };

  await Conversation.updateOne(
    { _id: conversation._id },
    { $set: { lastMessage }, $currentDate: { updatedAt: true } },
  );

  const io = req.app.get('io');
  if (io) {
    io.to(`user:${userId}`).emit('message:new', {
      conversationId: conversation._id,
      message,
    });
    io.to(`user:${otherUserId}`).emit('message:new', {
      conversationId: conversation._id,
      message,
    });
  }

  return res.status(201).json({ message, conversationId: conversation._id });
}

async function markConversationRead(req, res) {
  const userId = req.user.id;
  const { userId: otherUserId } = req.params;

  if (!mongoose.isValidObjectId(otherUserId)) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  const pairKey = makePairKey(userId, otherUserId);
  const conversation = await Conversation.findOne({ pairKey }).lean();
  if (!conversation) {
    const mutual = await ensureMutualFollow(userId, otherUserId);
    if (!mutual) {
      return res.status(403).json({ error: 'Chat available only for mutual follows.' });
    }
    return res.status(200).json({ updated: 0 });
  }

  const deletedAt = getDeletedAtForUser(conversation, userId);
  const result = await Message.updateMany(
    {
      conversationId: conversation._id,
      recipientId: userId,
      readAt: null,
      ...(deletedAt ? { createdAt: { $gt: deletedAt } } : {}),
    },
    { $set: { readAt: new Date() } },
  );

  return res.status(200).json({ updated: result.modifiedCount || 0 });
}

async function clearConversation(req, res) {
  const userId = req.user.id;
  const { userId: otherUserId } = req.params;

  if (!mongoose.isValidObjectId(otherUserId)) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  if (userId === otherUserId) {
    return res.status(400).json({ error: 'Cannot chat with yourself.' });
  }

  const pairKey = makePairKey(userId, otherUserId);
  const conversation = await Conversation.findOne({ pairKey });
  if (!conversation) {
    return res.status(200).json({ cleared: false });
  }

  const now = new Date();
  const existingIndex = conversation.deletedFor?.findIndex(
    (entry) => entry.userId?.toString() === userId.toString(),
  );
  if (existingIndex >= 0) {
    conversation.deletedFor[existingIndex].deletedAt = now;
  } else {
    conversation.deletedFor = conversation.deletedFor || [];
    conversation.deletedFor.push({ userId, deletedAt: now });
  }

  await conversation.save();
  return res.status(200).json({ cleared: true, deletedAt: now });
}

async function blockUser(req, res) {
  const userId = req.user.id;
  const { userId: otherUserId } = req.params;

  if (!mongoose.isValidObjectId(otherUserId)) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  if (userId === otherUserId) {
    return res.status(400).json({ error: 'Cannot block yourself.' });
  }

  const otherUser = await User.findById(otherUserId).select('_id').lean();
  if (!otherUser) {
    return res.status(404).json({ error: 'User not found.' });
  }

  await Block.updateOne(
    { blockerId: userId, blockedId: otherUserId },
    { $setOnInsert: { blockerId: userId, blockedId: otherUserId } },
    { upsert: true },
  );

  return res.status(200).json({ blocked: true });
}

async function unblockUser(req, res) {
  const userId = req.user.id;
  const { userId: otherUserId } = req.params;

  if (!mongoose.isValidObjectId(otherUserId)) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  if (userId === otherUserId) {
    return res.status(400).json({ error: 'Cannot unblock yourself.' });
  }

  await Block.deleteOne({ blockerId: userId, blockedId: otherUserId });
  return res.status(200).json({ blocked: false });
}

module.exports = {
  getChatList,
  getConversation,
  sendMessage,
  markConversationRead,
  clearConversation,
  blockUser,
  unblockUser,
};
