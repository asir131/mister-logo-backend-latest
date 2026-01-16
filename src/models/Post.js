const mongoose = require('mongoose');

const shareStatusSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ['none', 'queued', 'sent', 'failed'], default: 'none' },
    error: { type: String },
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
      enum: ['published', 'removed'],
      default: 'published',
      index: true,
    },
    isApproved: { type: Boolean, default: true, index: true },
    ublastId: { type: mongoose.Schema.Types.ObjectId, ref: 'UBlast' },
    shareToFacebook: { type: Boolean, default: false },
    shareToInstagram: { type: Boolean, default: false },
    shareStatus: {
      facebook: { type: shareStatusSchema, default: () => ({ status: 'none' }) },
      instagram: { type: shareStatusSchema, default: () => ({ status: 'none' }) },
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Post', postSchema);
