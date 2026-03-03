const { validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const { sendOtpEmail } = require('../services/emailService');
const { getFirebaseAuth } = require('../services/firebaseAdmin');
const generateOtp = require('../utils/generateOtp');
const User = require('../models/User');
const Profile = require('../models/Profile');
const OtpToken = require('../models/OtpToken');
const RefreshToken = require('../models/RefreshToken');
const { hardDeleteUsers } = require('../services/userDeletion');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);
const RESET_TOKEN_EXPIRES_IN = process.env.RESET_TOKEN_EXPIRES_IN || '15m';

function normalizeId(user) {
  if (!user) return user;
  if (user.id) return { ...user, id: user.id.toString() };
  if (user._id) return { ...user, id: user._id.toString(), _id: undefined };
  return user;
}

function sanitizeUser(user) {
  const normalized = normalizeId(user);
  if (!normalized) return normalized;
  const { passwordHash, ...rest } = normalized;
  return rest;
}

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  return null;
}

function issueToken(user) {
  const normalized = normalizeId(user);
  const userId = normalized?.id || normalized?._id;
  return jwt.sign(
    {
      sub: userId,
      email: normalized.email,
      phoneNumber: normalized.phoneNumber,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issueRefreshToken(userId) {
  const raw = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await RefreshToken.create({
    userId,
    tokenHash,
    expiresAt,
  });

  return raw;
}

function issueResetToken(user) {
  const normalized = normalizeId(user);
  const userId = normalized?.id || normalized?._id;
  return jwt.sign(
    {
      sub: userId,
      email: normalized.email,
      purpose: 'password-reset',
    },
    JWT_SECRET,
    { expiresIn: RESET_TOKEN_EXPIRES_IN },
  );
}

async function register(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { name, email, phoneNumber, password } = req.body;
  try {
    const existingUser = await User.findOne({
      $or: [{ email }, { phoneNumber }],
    }).lean();

    if (existingUser) {
      return res.status(400).json({ error: 'Email or phone already registered.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const otp = generateOtp();

    await OtpToken.deleteMany({
      $or: [{ email }, { 'payload.phoneNumber': phoneNumber }],
      type: 'register',
    });
    await OtpToken.create({
      email,
      otp,
      type: 'register',
      payload: {
        name,
        email,
        phoneNumber,
        passwordHash,
      },
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    await sendOtpEmail(email, otp);

    return res.status(200).json({
      message: 'OTP sent to email. Please verify to complete registration.',
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res
      .status(500)
      .json({ error: 'Could not start registration. Please try again.' });
  }
}

async function verifyOtp(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { email, otp } = req.body;

  try {
    const existing = await User.findOne({ email }).lean();
    if (existing) {
      return res.status(400).json({ error: 'Email already verified.' });
    }

    const tokenDoc = await OtpToken.findOne({ email, otp, type: 'register' });
    if (!tokenDoc) {
      return res.status(400).json({ error: 'OTP not found. Please register again.' });
    }

    if (Date.now() > tokenDoc.expiresAt.getTime()) {
      await tokenDoc.deleteOne();
      return res.status(400).json({ error: 'OTP expired. Please register again.' });
    }

    let user;
    try {
      const created = await User.create({
        ...tokenDoc.payload,
      });
      user = created.toObject();
    } catch (err) {
      if (err.code === 11000) {
        return res
          .status(400)
          .json({ error: 'Email or phone already registered.' });
      }
      throw err;
    }

    await tokenDoc.deleteOne();

    const token = issueToken(user);
    const refreshToken = await issueRefreshToken(user._id || user.id);

    return res.status(201).json({
      message: 'Registration completed successfully.',
      user: sanitizeUser(user),
      token,
      refreshToken,
    });
  } catch (err) {
    console.error('OTP verification error:', err);
    return res.status(500).json({ error: 'Could not verify OTP.' });
  }
}

async function login(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { email, phoneNumber, password } = req.body;

  if (!email && !phoneNumber) {
    return res
      .status(400)
      .json({ error: 'Provide either email or phone number to login.' });
  }

  try {
    const user = await User.findOne(
      email ? { email } : { phoneNumber },
    ).lean();

    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials.' });
    }

    if (!user.passwordHash) {
      return res.status(400).json({ error: 'Invalid credentials.' });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return res.status(400).json({ error: 'Invalid credentials.' });
    }

    const token = issueToken(user);
    const refreshToken = await issueRefreshToken(user._id || user.id);

    return res.status(200).json({
      message: 'Login successful.',
      user: sanitizeUser(user),
      token,
      refreshToken,
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Could not login.' });
  }
}

async function refresh(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { refreshToken } = req.body;
  const tokenHash = hashToken(refreshToken);

  try {
    const existing = await RefreshToken.findOne({
      tokenHash,
      revoked: false,
      expiresAt: { $gt: new Date() },
    });

    if (!existing) {
      return res.status(401).json({ error: 'Invalid refresh token.' });
    }

    const user = await User.findById(existing.userId).lean();
    if (!user) {
      await existing.deleteOne();
      return res.status(401).json({ error: 'Invalid refresh token.' });
    }

    // rotate refresh token
    await existing.deleteOne();
    const newRefreshToken = await issueRefreshToken(user._id || user.id);
    const accessToken = issueToken(user);

    return res.status(200).json({
      message: 'Token refreshed.',
      user: sanitizeUser(user),
      token: accessToken,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    console.error('Refresh token error:', err);
    return res.status(500).json({ error: 'Could not refresh token.' });
  }
}

async function forgotPassword(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { email } = req.body;
  try {
    const user = await User.findOne({ email }).lean();

    // Always respond success to avoid leaking which emails exist
    if (!user) {
      return res.status(200).json({
        message: 'If an account exists for this email, an OTP has been sent.',
      });
    }

    const otp = generateOtp();

    await OtpToken.deleteMany({ email, type: 'reset' });
    await OtpToken.create({
      email,
      otp,
      type: 'reset',
      payload: {},
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    await sendOtpEmail(email, otp);

    return res.status(200).json({
      message: 'If an account exists for this email, an OTP has been sent.',
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ error: 'Could not send reset OTP.' });
  }
}

async function verifyResetOtp(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { email, otp } = req.body;

  try {
    const tokenDoc = await OtpToken.findOne({ email, otp, type: 'reset' });
    if (!tokenDoc) {
      return res.status(400).json({ error: 'OTP not found. Please request again.' });
    }

    if (Date.now() > tokenDoc.expiresAt.getTime()) {
      await tokenDoc.deleteOne();
      return res.status(400).json({ error: 'OTP expired. Please request again.' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      await tokenDoc.deleteOne();
      return res.status(400).json({ error: 'Invalid account.' });
    }

    const resetToken = issueResetToken(user);

    await tokenDoc.deleteOne();

    return res.status(200).json({
      message: 'OTP verified. You may now reset your password.',
      resetToken,
    });
  } catch (err) {
    console.error('Verify reset OTP error:', err);
    return res.status(500).json({ error: 'Could not verify reset OTP.' });
  }
}

async function resetPassword(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { newPassword } = req.body;
  const resetToken = req.headers['x-reset-token'];

  try {
    let decoded;
    try {
      decoded = jwt.verify(resetToken, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired reset token.' });
    }

    if (decoded.purpose !== 'password-reset') {
      return res.status(401).json({ error: 'Invalid reset token.' });
    }

    const user = await User.findById(decoded.sub);
    if (!user) {
      return res.status(400).json({ error: 'Invalid account.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    user.passwordHash = passwordHash;
    await user.save();

    await RefreshToken.deleteMany({ userId: user._id });
    await OtpToken.deleteMany({ email: user.email, type: 'reset' });

    const accessToken = issueToken(user);
    const newRefreshToken = await issueRefreshToken(user._id || user.id);
    const cleanUser = sanitizeUser(user.toObject());

    return res.status(200).json({
      message: 'Password reset successful.',
      user: cleanUser,
      token: accessToken,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ error: 'Could not reset password.' });
  }
}

async function deleteMyAccount(req, res) {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const user = await User.findById(userId).select('_id').lean();
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await hardDeleteUsers([String(user._id)]);

    return res.status(200).json({ message: 'Account deleted successfully.' });
  } catch (err) {
    console.error('Delete account error:', err);
    return res.status(500).json({ error: 'Could not delete account.' });
  }
}
async function buildAuthResponse(userObj) {
  const token = issueToken(userObj);
  const refreshToken = await issueRefreshToken(userObj._id || userObj.id);
  const existingProfile = await Profile.findOne({
    userId: userObj._id || userObj.id,
  })
    .select('_id')
    .lean();

  return {
    user: sanitizeUser(userObj),
    token,
    refreshToken,
    isFirstLogin: false,
    needsProfileCompletion: !existingProfile,
  };
}

async function facebookAuthSuccess(req, res) {
  try {
    const userDoc = req.user;
    const userObj = userDoc?.toObject ? userDoc.toObject() : userDoc;
    const payload = await buildAuthResponse(userObj);
    return res.status(200).json({
      message: 'Facebook login successful.',
      ...payload,
    });
  } catch (err) {
    console.error('Facebook login error:', err);
    return res.status(500).json({ error: 'Could not login with Facebook.' });
  }
}

async function googleAuthSuccess(req, res) {
  try {
    const userDoc = req.user;
    const userObj = userDoc?.toObject ? userDoc.toObject() : userDoc;
    const payload = await buildAuthResponse(userObj);
    return res.status(200).json({
      message: 'Google login successful.',
      ...payload,
    });
  } catch (err) {
    console.error('Google login error:', err);
    return res.status(500).json({ error: 'Could not login with Google.' });
  }
}

function mapFirebaseProvider(signInProvider) {
  if (signInProvider === 'google.com') return 'google';
  if (signInProvider === 'facebook.com') return 'facebook';
  return 'local';
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findUserForFirebaseLogin({ email, googleIdentity, facebookIdentity }) {
  const orQuery = [];
  if (email) {
    orQuery.push({ email });
    orQuery.push({ email: new RegExp(`^${escapeRegex(email)}$`, 'i') });
  }
  if (googleIdentity) orQuery.push({ googleId: String(googleIdentity) });
  if (facebookIdentity) orQuery.push({ facebookId: String(facebookIdentity) });
  if (!orQuery.length) return null;
  return User.findOne({ $or: orQuery });
}

async function firebaseLogin(req, res) {
  const validationError = handleValidation(req, res);
  if (validationError !== null) return;

  const { idToken } = req.body;
  let email = '';
  let googleIdentity = null;
  let facebookIdentity = null;

  try {
    const firebaseAuth = getFirebaseAuth();
    const decoded = await firebaseAuth.verifyIdToken(idToken, true);

    email = decoded?.email ? String(decoded.email).toLowerCase() : '';
    if (!email) {
      return res.status(400).json({ error: 'Firebase token has no email.' });
    }

    const signInProvider = decoded?.firebase?.sign_in_provider || '';
    const provider = mapFirebaseProvider(signInProvider);
    const identities = decoded?.firebase?.identities || {};
    googleIdentity = identities?.['google.com']?.[0] || null;
    facebookIdentity = identities?.['facebook.com']?.[0] || null;
    const displayName =
      req.body?.name || decoded?.name || email.split('@')[0] || 'User';
    const phoneNumber = req.body?.phoneNumber || decoded?.phone_number || undefined;
    const avatarUrl = req.body?.photoURL || decoded?.picture || undefined;
    let isFirstLogin = false;

    let user = await findUserForFirebaseLogin({
      email,
      googleIdentity,
      facebookIdentity,
    });

    if (!user) {
      isFirstLogin = true;
      try {
        user = await User.create({
          name: displayName,
          email,
          phoneNumber,
          avatarUrl,
          googleId: googleIdentity ? String(googleIdentity) : undefined,
          facebookId: facebookIdentity ? String(facebookIdentity) : undefined,
          authProvider: provider,
        });
      } catch (err) {
        if (err?.code !== 11000) throw err;
        user = await findUserForFirebaseLogin({
          email,
          googleIdentity,
          facebookIdentity,
        });
        if (!user) throw err;
        isFirstLogin = false;
      }
    } else {
      const updates = {};
      if (displayName && user.name !== displayName) updates.name = displayName;
      if (!user.phoneNumber && phoneNumber) {
        const phoneTaken = await User.exists({
          phoneNumber,
          _id: { $ne: user._id },
        });
        if (!phoneTaken) updates.phoneNumber = phoneNumber;
      }
      if (avatarUrl && user.avatarUrl !== avatarUrl) updates.avatarUrl = avatarUrl;
      if (provider !== 'local' && user.authProvider !== provider) {
        updates.authProvider = provider;
      }
      if (googleIdentity && !user.googleId) {
        const googleIdValue = String(googleIdentity);
        const googleTaken = await User.exists({
          googleId: googleIdValue,
          _id: { $ne: user._id },
        });
        if (!googleTaken) updates.googleId = googleIdValue;
      }
      if (facebookIdentity && !user.facebookId) {
        const facebookIdValue = String(facebookIdentity);
        const facebookTaken = await User.exists({
          facebookId: facebookIdValue,
          _id: { $ne: user._id },
        });
        if (!facebookTaken) updates.facebookId = facebookIdValue;
      }

      if (Object.keys(updates).length > 0) {
        try {
          user = await User.findByIdAndUpdate(user._id, { $set: updates }, { new: true });
        } catch (err) {
          if (err?.code !== 11000) throw err;
          user = await findUserForFirebaseLogin({
            email,
            googleIdentity,
            facebookIdentity,
          });
          if (!user) throw err;
        }
      }
    }

    const existingProfile = await Profile.findOne({ userId: user._id || user.id });
    const needsProfileCompletion = !existingProfile;

    if (existingProfile && avatarUrl && !existingProfile.profileImageUrl) {
      await Profile.updateOne(
        { _id: existingProfile._id },
        { $set: { profileImageUrl: avatarUrl } }
      );
    }

    const userObj = user?.toObject ? user.toObject() : user;
    const token = issueToken(userObj);
    const refreshToken = await issueRefreshToken(userObj._id || userObj.id);

    return res.status(200).json({
      message: 'Firebase login successful.',
      user: sanitizeUser(userObj),
      token,
      refreshToken,
      isFirstLogin,
      needsProfileCompletion,
    });
  } catch (err) {
    if (err?.code === 11000) {
      try {
        const recoveredUser = await findUserForFirebaseLogin({
          email,
          googleIdentity,
          facebookIdentity,
        });
        if (recoveredUser) {
          const existingProfile = await Profile.findOne({
            userId: recoveredUser._id || recoveredUser.id,
          });
          const userObj = recoveredUser?.toObject ? recoveredUser.toObject() : recoveredUser;
          const token = issueToken(userObj);
          const refreshToken = await issueRefreshToken(userObj._id || userObj.id);
          return res.status(200).json({
            message: 'Firebase login successful.',
            user: sanitizeUser(userObj),
            token,
            refreshToken,
            isFirstLogin: false,
            needsProfileCompletion: !existingProfile,
          });
        }
      } catch (recoverErr) {
        console.error('Firebase duplicate recovery error:', recoverErr);
      }
      return res.status(400).json({ error: 'Could not login with Firebase token.' });
    }
    if (err?.code && String(err.code).startsWith('auth/')) {
      return res.status(401).json({ error: 'Invalid Firebase token.' });
    }
    console.error('Firebase login error:', err);
    return res.status(500).json({ error: 'Could not login with Firebase token.' });
  }
}

module.exports = {
  register,
  verifyOtp,
  login,
  refresh,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  deleteMyAccount,
  firebaseLogin,
  buildAuthResponse,
  facebookAuthSuccess,
  googleAuthSuccess,
};








