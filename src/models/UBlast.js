const mongoose = require('mongoose');

const ublastSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    content: { type: String },
    mediaUrl: { type: String },
    mediaType: { type: String, enum: ['image', 'video', 'audio'] },
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'released', 'expired'],
      default: 'draft',
      index: true,
    },
    scheduledFor: { type: Date, index: true },
    releasedAt: { type: Date, index: true },
    expiresAt: { type: Date, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

ublastSchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.model('UBlast', ublastSchema);
