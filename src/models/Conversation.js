const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    pairKey: { type: String, required: true, unique: true, index: true },
    participants: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ],
    deletedFor: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        deletedAt: { type: Date, required: true },
      },
    ],
    lastMessage: {
      senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      text: { type: String },
      mediaUrl: { type: String },
      mediaType: { type: String },
      share: {
        type: { type: String, enum: ['post', 'profile'] },
        itemId: { type: String },
        title: { type: String },
        url: { type: String },
      },
      createdAt: { type: Date },
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Conversation', conversationSchema);
