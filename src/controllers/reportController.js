const mongoose = require('mongoose');

const ContentReport = require('../models/ContentReport');
const Post = require('../models/Post');
const Ucut = require('../models/Ucut');
const UBlast = require('../models/UBlast');

function getTargetModel(targetType) {
  if (targetType === 'post') return Post;
  if (targetType === 'ucut') return Ucut;
  if (targetType === 'ublast') return UBlast;
  return null;
}

async function submitReport({ userId, targetType, targetId, reason }) {
  if (!mongoose.isValidObjectId(targetId)) {
    const err = new Error('Invalid target id.');
    err.status = 400;
    throw err;
  }

  const Model = getTargetModel(targetType);
  if (!Model) {
    const err = new Error('Invalid target type.');
    err.status = 400;
    throw err;
  }

  const existingTarget = await Model.findById(targetId).select('_id').lean();
  if (!existingTarget) {
    const err = new Error('Content not found.');
    err.status = 404;
    throw err;
  }

  const normalizedReason = String(reason || '').trim();
  if (!normalizedReason) {
    const err = new Error('Report reason is required.');
    err.status = 400;
    throw err;
  }

  const existingOpen = await ContentReport.findOne({
    reporterUserId: userId,
    targetType,
    targetId,
    status: 'open',
  }).lean();

  if (existingOpen) {
    const err = new Error('You already reported this content.');
    err.status = 409;
    throw err;
  }

  const report = await ContentReport.create({
    reporterUserId: userId,
    targetType,
    targetId,
    reason: normalizedReason,
  });

  return report;
}

async function reportPost(req, res) {
  try {
    const report = await submitReport({
      userId: req.user.id,
      targetType: 'post',
      targetId: req.params.postId,
      reason: req.body?.reason,
    });
    return res.status(201).json({
      message: 'Report submitted successfully.',
      reportId: report._id,
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'Could not submit report.' });
  }
}

async function reportUcut(req, res) {
  try {
    const report = await submitReport({
      userId: req.user.id,
      targetType: 'ucut',
      targetId: req.params.ucutId,
      reason: req.body?.reason,
    });
    return res.status(201).json({
      message: 'Report submitted successfully.',
      reportId: report._id,
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'Could not submit report.' });
  }
}

async function reportUblast(req, res) {
  try {
    const report = await submitReport({
      userId: req.user.id,
      targetType: 'ublast',
      targetId: req.params.ublastId,
      reason: req.body?.reason,
    });
    return res.status(201).json({
      message: 'Report submitted successfully.',
      reportId: report._id,
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'Could not submit report.' });
  }
}

module.exports = {
  reportPost,
  reportUcut,
  reportUblast,
};
