const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const ADMIN_JWT_EXPIRES_IN = process.env.ADMIN_JWT_EXPIRES_IN || '12h';

async function login(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const { email, password } = req.body || {};

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin credentials are not configured.' });
  }

  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin credentials.' });
  }

  const token = jwt.sign(
    {
      sub: 'admin',
      role: 'admin',
      email: ADMIN_EMAIL,
    },
    JWT_SECRET,
    { expiresIn: ADMIN_JWT_EXPIRES_IN },
  );

  return res.status(200).json({
    token,
    email: ADMIN_EMAIL,
  });
}

module.exports = {
  login,
};
