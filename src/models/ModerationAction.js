const mongoose = require('mongoose');

const ModerationActionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['restrict', 'unrestrict', 'delete', 'delete_post', 'remove_post', 'restore_post'],
      required: true,
    },
    targetType: {
      type: String,
      enum: ['user', 'post', 'ucut', 'ublast'],
      required: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    targetEmail: {
      type: String,
      default: '',
    },
    performedBy: {
      type: String,
      default: '',
    },
    performedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false },
);

module.exports = mongoose.model('ModerationAction', ModerationActionSchema);
