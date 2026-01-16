const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phoneNumber: { type: String, unique: true, sparse: true },
    passwordHash: { type: String },
    facebookId: { type: String, unique: true, sparse: true },
    authProvider: {
      type: String,
      enum: ['local', 'facebook'],
      default: 'local',
    },
    isBlocked: { type: Boolean, default: false },
    isBanned: { type: Boolean, default: false },
    ublastBlockedUntil: { type: Date },
  },
  { timestamps: true },
);

module.exports = mongoose.model('User', userSchema);
