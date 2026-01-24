const mongoose = require('mongoose');

const ublastSubmissionSchema = new mongoose.Schema(
  {
    ublastId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UBlast',
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    proposedDate: { type: Date },
    title: { type: String },
    content: { type: String },
    mediaUrl: { type: String, required: true },
    mediaType: { type: String, enum: ['image', 'video', 'audio'] },
    approvedUblastId: { type: mongoose.Schema.Types.ObjectId, ref: 'UBlast' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    reviewNotes: { type: String },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
  },
  { timestamps: true },
);

ublastSubmissionSchema.index(
  { ublastId: 1, userId: 1 },
  {
    unique: true,
    partialFilterExpression: { ublastId: { $exists: true, $ne: null } },
  },
);

module.exports = mongoose.model('UBlastSubmission', ublastSubmissionSchema);
