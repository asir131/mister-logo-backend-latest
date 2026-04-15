const mongoose = require('mongoose');

const ContentReportSchema = new mongoose.Schema(
  {
    reporterUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: ['post', 'ucut', 'ublast'],
      required: true,
      index: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    status: {
      type: String,
      enum: ['open', 'resolved', 'content_deleted', 'dismissed'],
      default: 'open',
      index: true,
    },
    resolvedBy: {
      type: String,
      default: '',
    },
    resolvedAt: {
      type: Date,
    },
  },
  { timestamps: true },
);

ContentReportSchema.index(
  { reporterUserId: 1, targetType: 1, targetId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } },
);

module.exports = mongoose.model('ContentReport', ContentReportSchema);
