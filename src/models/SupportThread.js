const mongoose = require('mongoose');

const supportThreadSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    status: {
      type: String,
      enum: ['pending', 'solved'],
      default: 'pending',
    },
    lastMessageAt: { type: Date, default: Date.now },
    lastSubject: { type: String },
  },
  { timestamps: true },
);

supportThreadSchema.index({ lastMessageAt: -1 });

module.exports = mongoose.model('SupportThread', supportThreadSchema);
