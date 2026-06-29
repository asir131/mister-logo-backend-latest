const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String },
    mediaUrl: { type: String },
    mediaType: { type: String },
    mediaMime: { type: String },
    fileName: { type: String },
    fileSize: { type: Number },
    share: {
      type: { type: String, enum: ['post', 'profile'] },
      itemId: { type: String },
      title: { type: String },
      description: { type: String },
      url: { type: String },
      image: { type: String },
      username: { type: String },
      displayName: { type: String },
      verified: { type: Boolean, default: false },
      bio: { type: String },
    },
    readAt: { type: Date, default: null, index: true },
  },
  { timestamps: true },
);

messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ recipientId: 1, readAt: 1 });

module.exports = mongoose.model('Message', messageSchema);
