const mongoose = require('mongoose');

const trendingPlacementSchema = new mongoose.Schema(
  {
    section: {
      type: String,
      enum: ['manual'],
      default: 'manual',
      index: true,
    },
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
    position: { type: Number, default: 0 },
    startAt: { type: Date, default: Date.now, index: true },
    endAt: { type: Date, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

trendingPlacementSchema.index({ section: 1, position: 1 });

module.exports = mongoose.model('TrendingPlacement', trendingPlacementSchema);
