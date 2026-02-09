const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const AdminUser = require('../models/AdminUser');

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

  const normalizedEmail = email.includes('@') ? email : `${email}@admin.com`;
  let admin = await AdminUser.findOne({ email: normalizedEmail }).lean();
  if (!admin) {
    const existingCount = await AdminUser.countDocuments({});
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD || existingCount > 0) {
      return res.status(401).json({ error: 'Invalid admin credentials.' });
    }
    if (normalizedEmail !== ADMIN_EMAIL) {
      return res.status(401).json({ error: 'Invalid admin credentials.' });
    }
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    admin = await AdminUser.create({
      email: ADMIN_EMAIL,
      username: ADMIN_EMAIL.split('@')[0],
      role: 'super',
      passwordHash,
    }).then((doc) => doc.toObject());
  }

  if (admin.email === ADMIN_EMAIL && admin.role !== 'super') {
    await AdminUser.updateOne({ _id: admin._id }, { $set: { role: 'super' } });
    admin.role = 'super';
  }

  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid admin credentials.' });
  }

  const token = jwt.sign(
    {
      sub: admin._id.toString(),
      role: admin.role === 'super' ? 'super_admin' : 'admin',
      email: admin.email,
      username: admin.username,
    },
    JWT_SECRET,
    { expiresIn: ADMIN_JWT_EXPIRES_IN },
  );

  return res.status(200).json({
    token,
    email: admin.email,
    role: admin.role,
  });
}

module.exports = {
  login,
};
