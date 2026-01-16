const mongoose = require('mongoose');

const ublastSubmissionSchema = new mongoose.Schema(
  {
    ublastId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UBlast',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    proposedDate: { type: Date },
    mediaUrl: { type: String, required: true },
    mediaType: { type: String, enum: ['image', 'video', 'audio'] },
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

ublastSubmissionSchema.index({ ublastId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('UBlastSubmission', ublastSubmissionSchema);
