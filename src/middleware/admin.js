const jwt = require('jsonwebtoken');

const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

function requireAdmin(req, res, next) {
  if (!ADMIN_API_KEY) {
    return res.status(500).json({ error: 'ADMIN_API_KEY is not configured.' });
  }

  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded?.role === 'admin') {
        req.admin = decoded;
        return next();
      }
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired admin token.' });
    }
  }

  const key = req.headers['x-admin-key'];
  if (!key || key !== ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Admin authorization required.' });
  }
  return next();
}

module.exports = requireAdmin;
