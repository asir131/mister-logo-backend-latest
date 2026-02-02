const mongoose = require('mongoose');

const shareStatusSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['none', 'queued', 'pending', 'sent', 'failed', 'reminder'],
      default: 'none',
    },
    error: { type: String },
    updatedAt: { type: Date },
  },
  { _id: false },
);

const postSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    description: { type: String },
    mediaType: { type: String, enum: ['image', 'video', 'audio'], required: true },
    mediaUrl: { type: String, required: true },
    mediaPublicId: { type: String },
    mimeType: { type: String },
    size: { type: Number },
    status: {
      type: String,
      enum: ['published', 'scheduled', 'removed', 'cancelled'],
      default: 'published',
      index: true,
    },
    scheduledFor: { type: Date, index: true },
    publishedAt: { type: Date, index: true },
    isApproved: { type: Boolean, default: true, index: true },
    ublastId: { type: mongoose.Schema.Types.ObjectId, ref: 'UBlast' },
    sharedFromPostId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
    shareTargets: {
      type: [String],
      default: [],
      enum: ['twitter', 'tiktok', 'snapchat', 'youtube', 'instagram', 'facebook'],
    },
    shareToFacebook: { type: Boolean, default: false },
    shareToInstagram: { type: Boolean, default: false },
    shareStatus: {
      twitter: { type: shareStatusSchema, default: () => ({ status: 'none' }) },
      tiktok: { type: shareStatusSchema, default: () => ({ status: 'none' }) },
      snapchat: { type: shareStatusSchema, default: () => ({ status: 'none' }) },
      youtube: { type: shareStatusSchema, default: () => ({ status: 'none' }) },
      instagram: { type: shareStatusSchema, default: () => ({ status: 'none' }) },
      facebook: { type: shareStatusSchema, default: () => ({ status: 'none' }) },
    },
    attempts: {
      twitter: { type: Number, default: 0 },
      tiktok: { type: Number, default: 0 },
      snapchat: { type: Number, default: 0 },
      youtube: { type: Number, default: 0 },
      instagram: { type: Number, default: 0 },
      facebook: { type: Number, default: 0 },
    },
    latePostId: { type: String, index: true },
    viewCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Post', postSchema);
