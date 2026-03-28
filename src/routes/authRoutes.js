const express = require('express');
const { body } = require('express-validator');
const authenticate = require('../middleware/auth');
const passport = require('passport');
const {
  register,
  verifyPhoneOtp,
  verifyOtp,
  login,
  refresh,
  firebaseLogin,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  deleteMyAccount,
  facebookAuthSuccess,
  googleAuthSuccess,
  buildAuthResponse,
} = require('../controllers/authController');
const { isFacebookConfigured, isGoogleConfigured } = require('../config/passport');
const User = require('../models/User');

const router = express.Router();

function ensureFacebookConfigured(req, res, next) {
  if (!isFacebookConfigured) {
    return res.status(500).json({ error: 'Facebook auth is not configured.' });
  }
  return next();
}

function ensureGoogleConfigured(req, res, next) {
  if (!isGoogleConfigured) {
    return res.status(500).json({ error: 'Google auth is not configured.' });
  }
  return next();
}

const APP_WEB_BASE_URL = process.env.APP_WEB_BASE_URL || 'http://localhost:3000';

const INSTAGRAM_CLIENT_ID = process.env.INSTAGRAM_CLIENT_ID || '';
const INSTAGRAM_CLIENT_SECRET = process.env.INSTAGRAM_CLIENT_SECRET || '';
const INSTAGRAM_CALLBACK_URL = process.env.INSTAGRAM_CALLBACK_URL || '';
const INSTAGRAM_AUTHORIZE_URL = process.env.INSTAGRAM_AUTHORIZE_URL || 'https://www.instagram.com/oauth/authorize';
const INSTAGRAM_OAUTH_SCOPES = process.env.INSTAGRAM_OAUTH_SCOPES || 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments';

function ensureInstagramConfigured(req, res, next) {
  if (!INSTAGRAM_CLIENT_ID || !INSTAGRAM_CLIENT_SECRET || !INSTAGRAM_CALLBACK_URL) {
    return res.status(500).json({ error: 'Instagram auth is not configured.' });
  }
  return next();
}

function toTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function mapInstagramProfileToDefaults(profile) {
  const username = toTrimmedString(profile?.username) || 'instagram_user';
  const syntheticEmail = `ig_${String(profile?.id || username).toLowerCase()}@no-email.instagram`;
  return {
    username,
    syntheticEmail,
  };
}

async function upsertInstagramUser(profile) {
  const instagramId = toTrimmedString(profile?.id);
  if (!instagramId) {
    throw new Error('Instagram profile id missing.');
  }

  const { username, syntheticEmail } = mapInstagramProfileToDefaults(profile);

  let user = await User.findOne({
    $or: [{ instagramId }, { email: syntheticEmail }],
  });

  if (!user) {
    user = await User.create({
      name: username,
      email: syntheticEmail,
      instagramId,
      authProvider: 'instagram',
    });
    return user;
  }

  const updates = {};
  if (!user.instagramId) updates.instagramId = instagramId;
  if (user.authProvider !== 'instagram') updates.authProvider = 'instagram';
  if (username && user.name !== username) updates.name = username;

  if (Object.keys(updates).length > 0) {
    user = await User.findByIdAndUpdate(user._id, { $set: updates }, { new: true });
  }

  return user;
}

function buildInstagramAuthorizeUrl(state) {
  const url = new URL(INSTAGRAM_AUTHORIZE_URL);
  url.searchParams.set('client_id', INSTAGRAM_CLIENT_ID);
  url.searchParams.set('redirect_uri', INSTAGRAM_CALLBACK_URL);
  url.searchParams.set('scope', INSTAGRAM_OAUTH_SCOPES);
  url.searchParams.set('response_type', 'code');
  // Facebook dialog-based Instagram business login may require platform marker.
  if (/facebook\.com$/i.test(url.hostname) || /facebook\.com$/i.test(url.host)) {
    url.searchParams.set('platform', 'instagram');
  }
  if (state) url.searchParams.set('state', state);
  return url.toString();
}

async function resolveInstagramProfile(accessToken, tokenData = {}) {
  const token = toTrimmedString(accessToken);
  if (!token) {
    throw new Error('Instagram access token missing.');
  }

  const directUserId = toTrimmedString(tokenData?.user_id || tokenData?.id);
  if (directUserId) {
    return {
      id: directUserId,
      username: toTrimmedString(tokenData?.username) || 'instagram_user',
    };
  }

  const profileCandidates = [
    'https://graph.instagram.com/me?fields=id,username',
    'https://graph.instagram.com/me?fields=user_id,username',
    'https://graph.instagram.com/v23.0/me?fields=id,username',
    'https://graph.facebook.com/v23.0/me?fields=id,name',
  ];

  let lastProfileError = 'Instagram profile fetch failed.';
  for (const candidate of profileCandidates) {
    const requests = [
      fetch(candidate, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
      fetch(
        `${candidate}${candidate.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(
          token,
        )}`,
      ),
    ];

    for (const reqPromise of requests) {
      const profileRes = await reqPromise;

      let profileData = {};
      try {
        profileData = await profileRes.json();
      } catch {
        profileData = {};
      }

      if (profileRes.ok) {
        const id = toTrimmedString(profileData?.id) || toTrimmedString(profileData?.user_id);
        if (id) {
          return {
            ...profileData,
            id,
            username:
              toTrimmedString(profileData?.username) ||
              toTrimmedString(profileData?.name) ||
              'instagram_user',
          };
        }
      }

      lastProfileError =
        profileData?.error?.message ||
        profileData?.error_message ||
        profileData?.error_description ||
        `Instagram profile fetch failed (${candidate}).`;
    }
  }

  throw new Error(lastProfileError);
}

async function exchangeInstagramCode(code) {
  const errors = [];

  try {
    const form = new URLSearchParams();
    form.set('client_id', INSTAGRAM_CLIENT_ID);
    form.set('client_secret', INSTAGRAM_CLIENT_SECRET);
    form.set('grant_type', 'authorization_code');
    form.set('redirect_uri', INSTAGRAM_CALLBACK_URL);
    form.set('code', code);

    const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });

    const tokenData = await tokenRes.json();
    const accessToken = toTrimmedString(tokenData?.access_token);

    if (!tokenRes.ok || !accessToken) {
      throw new Error(
        tokenData?.error_message ||
          tokenData?.error_description ||
          tokenData?.error?.message ||
          `Instagram token exchange failed. Raw: ${JSON.stringify(tokenData)}`,
      );
    }

    return await resolveInstagramProfile(accessToken, tokenData);
  } catch (error) {
    errors.push(`api.instagram.com flow failed: ${error?.message || error}`);
  }

  try {
    const fbTokenUrl = new URL('https://graph.facebook.com/v23.0/oauth/access_token');
    fbTokenUrl.searchParams.set('client_id', INSTAGRAM_CLIENT_ID);
    fbTokenUrl.searchParams.set('client_secret', INSTAGRAM_CLIENT_SECRET);
    fbTokenUrl.searchParams.set('redirect_uri', INSTAGRAM_CALLBACK_URL);
    fbTokenUrl.searchParams.set('code', code);

    const fbTokenRes = await fetch(fbTokenUrl.toString());
    const fbTokenData = await fbTokenRes.json();
    const fbAccessToken = toTrimmedString(fbTokenData?.access_token);

    if (!fbTokenRes.ok || !fbAccessToken) {
      throw new Error(
        fbTokenData?.error?.message ||
          fbTokenData?.error_message ||
          fbTokenData?.error_description ||
          `Facebook token exchange failed. Raw: ${JSON.stringify(fbTokenData)}`,
      );
    }

    return await resolveInstagramProfile(fbAccessToken, fbTokenData);
  } catch (error) {
    errors.push(`graph.facebook.com flow failed: ${error?.message || error}`);
  }

  throw new Error(errors.join(' | '));
}
function normalizeClientRedirect(value) {
  if (typeof value !== 'string' || !value) return null;
  if (!/^(unap|exp|exps):\/\//i.test(value)) return null;
  try {
    const parsed = new URL(value);
    return parsed.toString();
  } catch {
    return null;
  }
}

function encodeMobileState(clientRedirect) {
  const payload = JSON.stringify({ mode: 'mobile', clientRedirect });
  const base64 = Buffer.from(payload, 'utf8').toString('base64');
  const base64Url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `mobile:${base64Url}`;
}

function decodeBase64Url(value) {
  if (typeof value !== 'string' || !value) return null;
  const base64 = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Buffer.from(base64, 'base64').toString('utf8');
}

function decodeState(stateValue) {
  if (typeof stateValue !== 'string' || !stateValue) return { mode: 'default' };
  if (stateValue === 'web') return { mode: 'web' };
  if (!stateValue.startsWith('mobile:')) return { mode: 'default' };

  try {
    const encoded = stateValue.slice('mobile:'.length);
    const decoded = decodeBase64Url(encoded);
    if (!decoded) return { mode: 'default' };
    const payload = JSON.parse(decoded);
    const clientRedirect = normalizeClientRedirect(payload?.clientRedirect);
    if (!clientRedirect) return { mode: 'default' };
    return { mode: 'mobile', clientRedirect };
  } catch {
    return { mode: 'default' };
  }
}

function withQuery(urlString, query) {
  try {
    const url = new URL(urlString);
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') return;
      url.searchParams.set(key, String(value));
    });
    return url.toString();
  } catch {
    const params = new URLSearchParams();
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') return;
      params.set(key, String(value));
    });
    const qs = params.toString();
    return qs ? `${urlString}${urlString.includes('?') ? '&' : '?'}${qs}` : urlString;
  }
}

function sendMobileRedirectPage(res, redirectUrl, heading, description) {
  const escapedUrl = String(redirectUrl || '').replace(/"/g, '&quot;');
  const safeHeading = String(heading || 'Redirecting...');
  const safeDescription = String(description || 'Returning to UNAP app.');

  return res.status(200).send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeHeading}</title>
    <style>
      body { font-family: Arial, sans-serif; background:#0b1220; color:#fff; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; padding:24px; }
      .card { width:100%; max-width:420px; background:#101827; border:1px solid #1f2937; border-radius:12px; padding:20px; text-align:center; }
      .btn { display:inline-block; margin-top:14px; background:#2563eb; color:#fff; text-decoration:none; padding:10px 16px; border-radius:8px; font-weight:600; }
      .muted { color:#9ca3af; margin-top:8px; font-size:14px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>${safeHeading}</h2>
      <p class="muted">${safeDescription}</p>
      <a class="btn" href="${escapedUrl}">Back To UNAP</a>
      <p class="muted">If app does not open, tap the button.</p>
    </div>
    <script>
      (function () {
        var target = "${escapedUrl}";
        setTimeout(function () { window.location.href = target; }, 50);
      })();
    </script>
  </body>
</html>`);
}

function redirectMobileSuccess(res, clientRedirect, payload) {
  const redirectUrl = withQuery(clientRedirect, {
    status: 'success',
    token: payload?.token,
    refreshToken: payload?.refreshToken,
    id: payload?.user?.id,
    name: payload?.user?.name,
    email: payload?.user?.email,
    phoneNumber: payload?.user?.phoneNumber,
    isFirstLogin: payload?.isFirstLogin,
    needsProfileCompletion: payload?.needsProfileCompletion,
  });
  return sendMobileRedirectPage(
    res,
    redirectUrl,
    'Login successful',
    'Returning to UNAP...'
  );
}

function redirectMobileError(res, clientRedirect, errorMessage) {
  const redirectUrl = withQuery(clientRedirect, {
    status: 'error',
    error: errorMessage || 'Social login failed.',
  });
  return sendMobileRedirectPage(
    res,
    redirectUrl,
    'Login failed',
    errorMessage || 'Could not login. Returning to UNAP...'
  );
}

router.post(
  '/register',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').trim().isEmail().withMessage('Valid email is required'),
    body('phoneNumber').trim().notEmpty().withMessage('Phone number is required'),
    body('countryIso').optional({ nullable: true }).isString(),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
    body('confirmPassword')
      .custom((value, { req }) => value === req.body.password)
      .withMessage('Passwords must match'),
  ],
  register,
);

router.post(
  '/verify-phone-otp',
  [
    body('email').trim().isEmail().withMessage('Valid email is required'),
    body('phoneNumber').trim().notEmpty().withMessage('Phone number is required'),
    body('otp')
      .trim()
      .isLength({ min: 4, max: 4 })
      .withMessage('Phone OTP must be 4 digits'),
  ],
  verifyPhoneOtp,
);

router.post(
  '/verify-otp',
  [
    body('email').trim().isEmail().withMessage('Valid email is required'),
    body('otp')
      .trim()
      .isLength({ min: 5, max: 5 })
      .withMessage('OTP must be 5 digits'),
  ],
  verifyOtp,
);

router.post(
  '/login',
  [
    body('email')
      .optional({ nullable: true })
      .isEmail()
      .withMessage('Email must be valid'),
    body('phoneNumber')
      .optional({ nullable: true })
      .isString()
      .withMessage('Phone number must be a string'),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password is required'),
  ],
  login,
);

router.post(
  '/refresh',
  [body('refreshToken').trim().notEmpty().withMessage('Refresh token is required')],
  refresh,
);

router.post(
  '/firebase',
  [
    body('idToken').trim().notEmpty().withMessage('Firebase idToken is required'),
    body('name').optional({ nullable: true }).isString(),
    body('phoneNumber').optional({ nullable: true }).isString(),
    body('photoURL').optional({ nullable: true }).isString(),
  ],
  firebaseLogin,
);

router.post(
  '/forgot-password',
  [body('email').trim().isEmail().withMessage('Valid email is required')],
  forgotPassword,
);

router.post(
  '/verify-reset-otp',
  [
    body('email').trim().isEmail().withMessage('Valid email is required'),
    body('otp')
      .trim()
      .isLength({ min: 5, max: 5 })
      .withMessage('OTP must be 5 digits'),
  ],
  verifyResetOtp,
);

router.delete('/delete-account', authenticate, deleteMyAccount);
router.post(
  '/reset-password',
  [
    body('resetToken')
      .optional({ nullable: true })
      .custom((value, { req }) => {
        if (req.headers['x-reset-token']) return true;
        if (value) return true;
        throw new Error('Reset token is required in header x-reset-token');
      }),
    body('newPassword')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
    body('confirmPassword')
      .custom((value, { req }) => value === req.body.newPassword)
      .withMessage('Passwords must match'),
  ],
  resetPassword,
);

router.get(
  '/facebook',
  ensureFacebookConfigured,
  (req, res, next) => {
    const clientRedirect = normalizeClientRedirect(req.query.clientRedirect);
    const state = clientRedirect ? encodeMobileState(clientRedirect) : undefined;
    return passport.authenticate('facebook', {
      scope: ['email'],
      ...(state ? { state } : {}),
    })(req, res, next);
  },
);

router.get(
  '/facebook/web',
  ensureFacebookConfigured,
  passport.authenticate('facebook', { scope: ['email'], state: 'web' }),
);

router.get('/facebook/callback', ensureFacebookConfigured, (req, res, next) => {
  const state = decodeState(req.query.state);
  passport.authenticate('facebook', { session: false }, (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      if (state.mode === 'mobile') {
        return redirectMobileError(
          res,
          state.clientRedirect,
          info?.message || 'Facebook login failed.',
        );
      }
      return res
        .status(401)
        .json({ error: info?.message || 'Facebook login failed.' });
    }
    req.user = user;
    if (state.mode === 'web') {
      return buildAuthResponse(user)
        .then((payload) => {
          const redirectUrl = `${APP_WEB_BASE_URL}/oauth/facebook?token=${encodeURIComponent(
            payload.token,
          )}&refreshToken=${encodeURIComponent(payload.refreshToken)}`;
          return res.redirect(redirectUrl);
        })
        .catch((error) => {
          console.error('Facebook login error:', error);
          return res.status(500).json({ error: 'Could not login with Facebook.' });
        });
    }
    if (state.mode === 'mobile') {
      return buildAuthResponse(user)
        .then((payload) => redirectMobileSuccess(res, state.clientRedirect, payload))
        .catch((error) => {
          console.error('Facebook login error:', error);
          return redirectMobileError(
            res,
            state.clientRedirect,
            'Could not login with Facebook.',
          );
        });
    }
    return facebookAuthSuccess(req, res);
  })(req, res, next);
});

router.get(
  '/google',
  ensureGoogleConfigured,
  (req, res, next) => {
    const clientRedirect = normalizeClientRedirect(req.query.clientRedirect);
    const state = clientRedirect ? encodeMobileState(clientRedirect) : undefined;
    return passport.authenticate('google', {
      scope: ['profile', 'email'],
      ...(state ? { state } : {}),
    })(req, res, next);
  },
);

router.get(
  '/google/web',
  ensureGoogleConfigured,
  passport.authenticate('google', { scope: ['profile', 'email'], state: 'web' }),
);

router.get('/google/callback', ensureGoogleConfigured, (req, res, next) => {
  const state = decodeState(req.query.state);
  passport.authenticate('google', { session: false }, (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      if (state.mode === 'mobile') {
        return redirectMobileError(
          res,
          state.clientRedirect,
          info?.message || 'Google login failed.',
        );
      }
      return res.status(401).json({ error: info?.message || 'Google login failed.' });
    }
    req.user = user;
    if (state.mode === 'web') {
      return buildAuthResponse(user)
        .then((payload) => {
          const redirectUrl = `${APP_WEB_BASE_URL}/oauth/google?token=${encodeURIComponent(
            payload.token,
          )}&refreshToken=${encodeURIComponent(payload.refreshToken)}`;
          return res.redirect(redirectUrl);
        })
        .catch((error) => {
          console.error('Google login error:', error);
          return res.status(500).json({ error: 'Could not login with Google.' });
        });
    }
    if (state.mode === 'mobile') {
      return buildAuthResponse(user)
        .then((payload) => redirectMobileSuccess(res, state.clientRedirect, payload))
        .catch((error) => {
          console.error('Google login error:', error);
          return redirectMobileError(res, state.clientRedirect, 'Could not login with Google.');
        });
    }
    return googleAuthSuccess(req, res);
  })(req, res, next);
});

router.get('/instagram', ensureInstagramConfigured, (req, res) => {
  const clientRedirect = normalizeClientRedirect(req.query.clientRedirect);
  const state = clientRedirect ? encodeMobileState(clientRedirect) : undefined;
  const redirectUrl = buildInstagramAuthorizeUrl(state);
  return res.redirect(redirectUrl);
});

router.get('/instagram/callback', ensureInstagramConfigured, async (req, res) => {
  const state = decodeState(req.query.state);
  const code = toTrimmedString(req.query.code);

  if (!code) {
    if (state.mode === 'mobile') {
      return redirectMobileError(res, state.clientRedirect, 'Instagram login failed.');
    }
    return res.status(400).json({ error: 'Instagram authorization code missing.' });
  }

  try {
    const profile = await exchangeInstagramCode(code);
    const user = await upsertInstagramUser(profile);
    const payload = await buildAuthResponse(user);

    if (state.mode === 'mobile') {
      return redirectMobileSuccess(res, state.clientRedirect, payload);
    }

    const redirectUrl = `${APP_WEB_BASE_URL}/oauth/instagram?token=${encodeURIComponent(
      payload.token,
    )}&refreshToken=${encodeURIComponent(payload.refreshToken)}`;
    return res.redirect(redirectUrl);
  } catch (error) {
    console.error('Instagram login error:', error);
    if (state.mode === 'mobile') {
      return redirectMobileError(
        res,
        state.clientRedirect,
        error?.message || 'Could not login with Instagram.',
      );
    }
    return res.status(500).json({ error: 'Could not login with Instagram.' });
  }
});
module.exports = router;












