const mongoose = require('mongoose');

const otpTokenSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, index: true },
    otp: { type: String, required: true },
    type: {
      type: String,
      enum: ['register', 'register_phone', 'reset'],
      default: 'register',
      index: true,
    },
    payload: {
      name: String,
      email: String,
      phoneNumber: String,
      passwordHash: String,
    },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

otpTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OtpToken', otpTokenSchema);
