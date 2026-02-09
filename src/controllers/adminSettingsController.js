const fs = require('fs/promises');
const path = require('path');
const { validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const AdminUser = require('../models/AdminUser');

function updateEnvValue(contents, key, value) {
  const lines = contents.split(/\r?\n/);
  let found = false;
  const next = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) {
    next.push(`${key}=${value}`);
  }
  return next.join('\n');
}

async function changeAdminPassword(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const newPassword = String(req.body?.newPassword || '').trim();
  const confirmPassword = String(req.body?.confirmPassword || '').trim();
  if (!newPassword || !confirmPassword) {
    return res.status(400).json({ error: 'New password and confirm password are required.' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }

  const adminId = req.admin?.sub;
  if (!adminId) {
    return res.status(401).json({ error: 'Admin authorization required.' });
  }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const updated = await AdminUser.findByIdAndUpdate(
    adminId,
    { $set: { passwordHash } },
    { new: true },
  );
  if (!updated) {
    return res.status(404).json({ error: 'Admin not found.' });
  }

  return res.status(200).json({ message: 'Admin password updated.' });
}

async function getAdminSettings(req, res) {
  const adminId = req.admin?.sub;
  let email = process.env.ADMIN_EMAIL || '';
  let role = 'admin';
  if (adminId) {
    const existing = await AdminUser.findById(adminId).lean();
    if (existing?.email) email = existing.email;
    if (existing?.role) role = existing.role;
  }
  return res.status(200).json({
    email,
    role,
    shareWindowHours: Number(process.env.UBLAST_SHARE_WINDOW_HOURS || 48),
    topTrendingHours: Number(process.env.UBLAST_TRENDING_HOURS || 24),
    restrictionDays: Number(process.env.UBLAST_BLOCK_DAYS || 90),
    warningGraceHours: Number(process.env.UBLAST_WARNING_GRACE_HOURS || 4),
  });
}

async function updateAdminSettings(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const shareWindowHours = String(req.body?.shareWindowHours ?? '').trim();
  const topTrendingHours = String(req.body?.topTrendingHours ?? '').trim();
  const restrictionDays = String(req.body?.restrictionDays ?? '').trim();
  const warningGraceHours = String(req.body?.warningGraceHours ?? '').trim();

  const values = {
    UBLAST_SHARE_WINDOW_HOURS: shareWindowHours,
    UBLAST_TRENDING_HOURS: topTrendingHours,
    UBLAST_BLOCK_DAYS: restrictionDays,
    UBLAST_WARNING_GRACE_HOURS: warningGraceHours,
  };

  Object.entries(values).forEach(([key, value]) => {
    process.env[key] = value;
  });

  try {
    const envPath = path.join(process.cwd(), '.env');
    const existing = await fs.readFile(envPath, 'utf8');
    let updated = existing;
    Object.entries(values).forEach(([key, value]) => {
      updated = updateEnvValue(updated, key, value);
    });
    await fs.writeFile(envPath, updated, 'utf8');
  } catch (err) {
    return res.status(500).json({ error: 'Failed to persist settings.' });
  }

  return res.status(200).json({ message: 'Settings updated.' });
}

async function createAdmin(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  if (req.admin?.role !== 'super_admin' && req.admin?.email !== process.env.ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Only super admin can create admins.' });
  }
  const adminId = String(req.body?.adminId || '').trim().toLowerCase();
  const password = String(req.body?.password || '').trim();
  if (!adminId || !password) {
    return res.status(400).json({ error: 'Admin ID and password are required.' });
  }
  const email = `${adminId}@admin.com`;
  const passwordHash = await bcrypt.hash(password, 10);
  const created = await AdminUser.create({
    email,
    username: adminId,
    role: 'admin',
    passwordHash,
  });
  return res.status(201).json({
    admin: {
      id: created._id,
      email: created.email,
      username: created.username,
      role: created.role,
    },
  });
}

async function listAdmins(req, res) {
  const page = Number.parseInt(req.query.page, 10) || 1;
  const limit = Number.parseInt(req.query.limit, 10) || 5;
  const skip = (page - 1) * limit;
  const role = String(req.query.role || 'admin').toLowerCase();
  const match = role === 'all' ? {} : { role: role === 'super' ? 'super' : 'admin' };

  const [totalCount, admins] = await Promise.all([
    AdminUser.countDocuments(match),
    AdminUser.find(match)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('email username role createdAt')
      .lean(),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  return res.status(200).json({
    admins,
    page,
    totalPages,
    totalCount,
  });
}

async function deleteAdmin(req, res) {
  if (req.admin?.role !== 'super_admin' && req.admin?.email !== process.env.ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Only super admin can delete admins.' });
  }
  const { adminId } = req.params;
  if (!adminId) {
    return res.status(400).json({ error: 'Admin id is required.' });
  }
  const existing = await AdminUser.findById(adminId).lean();
  if (!existing) {
    return res.status(404).json({ error: 'Admin not found.' });
  }
  if (existing.role === 'super') {
    return res.status(400).json({ error: 'Cannot delete super admin.' });
  }
  await AdminUser.deleteOne({ _id: adminId });
  return res.status(200).json({ deleted: true });
}

async function resetAdminPassword(req, res) {
  if (req.admin?.role !== 'super_admin' && req.admin?.email !== process.env.ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Only super admin can reset passwords.' });
  }
  const { adminId } = req.params;
  const newPassword = String(req.body?.newPassword || '').trim();
  if (!adminId || !newPassword) {
    return res.status(400).json({ error: 'Admin id and new password are required.' });
  }
  const existing = await AdminUser.findById(adminId).lean();
  if (!existing) {
    return res.status(404).json({ error: 'Admin not found.' });
  }
  if (existing.role === 'super') {
    return res.status(400).json({ error: 'Cannot reset super admin password here.' });
  }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await AdminUser.updateOne({ _id: adminId }, { $set: { passwordHash } });
  return res.status(200).json({ updated: true });
}

module.exports = {
  changeAdminPassword,
  getAdminSettings,
  updateAdminSettings,
  createAdmin,
  listAdmins,
  deleteAdmin,
  resetAdminPassword,
};
