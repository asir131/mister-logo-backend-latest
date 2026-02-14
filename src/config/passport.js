const passport = require('passport');
const FacebookStrategy = require('passport-facebook').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const User = require('../models/User');

const {
  FACEBOOK_APP_ID,
  FACEBOOK_APP_SECRET,
  FACEBOOK_CALLBACK_URL,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CALLBACK_URL,
} = process.env;

const isFacebookConfigured = Boolean(
  FACEBOOK_APP_ID && FACEBOOK_APP_SECRET && FACEBOOK_CALLBACK_URL,
);
const isGoogleConfigured = Boolean(
  GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_CALLBACK_URL,
);

if (!isFacebookConfigured) {
  console.warn(
    'Facebook auth is not configured. Set FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, and FACEBOOK_CALLBACK_URL.',
  );
} else {
  passport.use(
    new FacebookStrategy(
      {
        clientID: FACEBOOK_APP_ID,
        clientSecret: FACEBOOK_APP_SECRET,
        callbackURL: FACEBOOK_CALLBACK_URL,
        profileFields: ['id', 'displayName', 'emails'],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const facebookId = profile.id;
          const email = profile.emails?.[0]?.value || null;
          const displayName = profile.displayName || 'Facebook User';

          if (!email) {
            return done(null, false, { message: 'Facebook account has no email.' });
          }

          let user = await User.findOne({
            $or: [{ facebookId }, { email }],
          });

          if (user) {
            const updates = {};
            if (!user.facebookId) updates.facebookId = facebookId;
            if (user.authProvider !== 'facebook') updates.authProvider = 'facebook';
            if (displayName && user.name !== displayName) updates.name = displayName;

            if (Object.keys(updates).length > 0) {
              user = await User.findByIdAndUpdate(
                user._id,
                { $set: updates },
                { new: true },
              );
            }

            return done(null, user);
          }

          user = await User.create({
            name: displayName,
            email,
            facebookId,
            authProvider: 'facebook',
          });

          return done(null, user);
        } catch (err) {
          return done(err);
        }
      },
    ),
  );
}

if (!isGoogleConfigured) {
  console.warn(
    'Google auth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK_URL.',
  );
} else {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const googleId = profile.id;
          const email = profile.emails?.[0]?.value || null;
          const displayName = profile.displayName || 'Google User';

          if (!email) {
            return done(null, false, { message: 'Google account has no email.' });
          }

          let user = await User.findOne({
            $or: [{ googleId }, { email }],
          });

          if (user) {
            const updates = {};
            if (!user.googleId) updates.googleId = googleId;
            if (user.authProvider !== 'google') updates.authProvider = 'google';
            if (displayName && user.name !== displayName) updates.name = displayName;

            if (Object.keys(updates).length > 0) {
              user = await User.findByIdAndUpdate(
                user._id,
                { $set: updates },
                { new: true },
              );
            }

            return done(null, user);
          }

          user = await User.create({
            name: displayName,
            email,
            googleId,
            authProvider: 'google',
          });

          return done(null, user);
        } catch (err) {
          return done(err);
        }
      },
    ),
  );
}

module.exports = {
  isFacebookConfigured,
  isGoogleConfigured,
};
