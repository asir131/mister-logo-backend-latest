const mongoose = require('mongoose');

const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Block = require('../models/Block');

function makePairKey(a, b) {
  const [first, second] = [a.toString(), b.toString()].sort();
  return `${first}:${second}`;
}

function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
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

function registerChatSocket(io, socket) {
  socket.on('message:send', async (payload = {}, ack) => {
    try {
      const senderId = socket.userId;
      const recipientId = payload.recipientId || payload.userId;
      const text = normalizeText(payload.text);

      if (!senderId) {
        throw new Error('Unauthorized');
      }

      if (!mongoose.isValidObjectId(recipientId)) {
        throw new Error('Invalid recipient id.');
      }

      if (!text) {
        throw new Error('Message text is required.');
      }

      if (senderId.toString() === recipientId.toString()) {
        throw new Error('Cannot chat with yourself.');
      }

      const blockInfo = await getBlockInfo(senderId, recipientId);
      if (blockInfo.blockedByMe || blockInfo.blockedMe) {
        throw new Error('Messaging is blocked for this user.');
      }

      const pairKey = makePairKey(senderId, recipientId);
      const conversation = await Conversation.findOneAndUpdate(
        { pairKey },
        {
          $setOnInsert: {
            pairKey,
            participants: [senderId, recipientId],
          },
        },
        { new: true, upsert: true },
      );

      const message = await Message.create({
        conversationId: conversation._id,
        senderId,
        recipientId,
        text,
      });

      const lastMessage = {
        senderId,
        text,
        createdAt: message.createdAt,
      };

      await Conversation.updateOne(
        { _id: conversation._id },
        { $set: { lastMessage }, $currentDate: { updatedAt: true } },
      );

      io.to(`user:${senderId}`).emit('message:new', {
        conversationId: conversation._id,
        message,
      });
      io.to(`user:${recipientId}`).emit('message:new', {
        conversationId: conversation._id,
        message,
      });

      if (typeof ack === 'function') {
        ack({ ok: true, message, conversationId: conversation._id });
      }
    } catch (err) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: err.message || 'Message failed.' });
      }
    }
  });
}

module.exports = { registerChatSocket };
