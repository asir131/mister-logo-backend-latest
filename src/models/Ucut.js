const mongoose = require('mongoose');

const ucutSegmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    thumbnailUrl: { type: String },
    previewUrl: { type: String },
    order: { type: Number, required: true },
  },
  { _id: false },
);

const ucutSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['text', 'video', 'audio', 'image'], required: true },
    text: { type: String },
    mediaType: { type: String, enum: ['video', 'audio', 'image'] },
    segments: { type: [ucutSegmentSchema], default: [] },
    segmentCount: { type: Number, default: 0 },
    originalDurationSeconds: { type: Number },
    segmentDurationSeconds: { type: Number },
    expiresAt: { type: Date, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Ucut', ucutSchema);
