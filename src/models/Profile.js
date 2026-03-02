const mongoose = require('mongoose');

const profileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    username: { type: String, required: true, unique: true },
    displayName: { type: String },
    role: { type: String, required: true },
    dateOfBirth: { type: Date },
    bio: { type: String },
    profileImageUrl: { type: String },
    instagramUrl: { type: String },
    tiktokUrl: { type: String },
    youtubeUrl: { type: String },
    facebookUrl: { type: String },
    spotifyArtistUrl: { type: String },
    businessLink: { type: String },
    autoTranslateEnabled: { type: Boolean, default: true },
    preferredLanguage: { type: String },
    postsCount: { type: Number, default: 0 },
    followersCount: { type: Number, default: 0 },
    followingCount: { type: Number, default: 0 },
    imageCount: { type: Number, default: 0 },
    videoCount: { type: Number, default: 0 },
    audioCount: { type: Number, default: 0 },
    followers: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        followedAt: { type: Date, default: Date.now },
      },
    ],
    following: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        followedAt: { type: Date, default: Date.now },
      },
    ],
    imagePosts: [
      {
        postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
        mediaUrl: { type: String },
        description: { type: String },
        createdAt: { type: Date },
      },
    ],
    videoPosts: [
      {
        postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
        mediaUrl: { type: String },
        description: { type: String },
        createdAt: { type: Date },
      },
    ],
    audioPosts: [
      {
        postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
        mediaUrl: { type: String },
        description: { type: String },
        createdAt: { type: Date },
      },
    ],
  },
  { timestamps: true },
);

module.exports = mongoose.model('Profile', profileSchema);
