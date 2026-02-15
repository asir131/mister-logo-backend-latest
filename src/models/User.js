const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phoneNumber: { type: String, unique: true, sparse: true },
    passwordHash: { type: String },
    facebookId: { type: String, unique: true, sparse: true },
    googleId: { type: String, unique: true, sparse: true },
    authProvider: {
      type: String,
      enum: ['local', 'facebook', 'google'],
      default: 'local',
    },
    isBlocked: { type: Boolean, default: false },
    isBanned: { type: Boolean, default: false },
    ublastManualBlocked: { type: Boolean, default: false },
    ublastBlockedUntil: { type: Date },
    connectedPlatforms: {
      type: [String],
      default: [],
    },
    connectedAccounts: [
      {
        platform: { type: String },
        accountId: { type: String },
        username: { type: String },
        displayName: { type: String },
        profileId: { type: String },
      },
    ],
    pushTokens: [
      {
        token: { type: String, required: true },
        platform: {
          type: String,
          enum: ['android', 'ios', 'web', 'unknown'],
          default: 'unknown',
        },
        deviceId: { type: String },
        appVersion: { type: String },
        updatedAt: { type: Date, default: Date.now },
      },
    ],
    lateAccountId: { type: String, index: true },
    legacyPlatformTokens: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true },
);

module.exports = mongoose.model('User', userSchema);
