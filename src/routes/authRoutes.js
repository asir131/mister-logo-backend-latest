const express = require('express');
const { body } = require('express-validator');
const authenticate = require('../middleware/auth');
const passport = require('passport');
const {
  register,
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

module.exports = router;


