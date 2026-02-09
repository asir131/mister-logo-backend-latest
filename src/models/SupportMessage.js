const mongoose = require('mongoose');

const supportMessageSchema = new mongoose.Schema(
  {
    threadId: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportThread', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    subject: { type: String },
    content: { type: String, required: true },
  },
  { timestamps: true },
);

supportMessageSchema.index({ threadId: 1, createdAt: 1 });

module.exports = mongoose.model('SupportMessage', supportMessageSchema);
