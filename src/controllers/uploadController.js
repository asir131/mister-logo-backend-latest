const cloudinary = require('cloudinary').v2;
const { createSignedUploadUrl, isGcsProvider } = require('../services/mediaStorage');
const { createResumableUploadUrl } = require('../services/gcsStorage');

function buildErrorDebug(err) {
  const status =
    Number(err?.code) ||
    Number(err?.response?.status) ||
    Number(err?.statusCode) ||
    Number(err?.status) ||
    500;
  const details = err?.errors || err?.response?.data?.error?.errors;
  const reason = Array.isArray(details) ? details[0]?.reason || null : null;

  return {
    status,
    code: err?.code || err?.response?.data?.error?.code || null,
    message: err?.message || null,
    reason,
  };
}

async function signUpload(req, res) {
  if (isGcsProvider()) {
    try {
      const signed = await createSignedUploadUrl({
        folder: req.body?.folder,
        publicId: req.body?.publicId,
        filename: req.body?.fileName,
        contentType: req.body?.contentType,
      });
      return res.status(200).json({
        provider: 'gcs',
        ...signed,
      });
    } catch (err) {
      return res.status(500).json({
        error: err?.message || 'Could not create signed upload URL.',
      });
    }
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = req.body?.folder || 'mister/posts';
  const publicId = req.body?.publicId;

  const params = {
    timestamp,
    folder,
  };
  if (publicId) params.public_id = publicId;

  const signature = cloudinary.utils.api_sign_request(
    params,
    process.env.CLOUDINARY_API_SECRET,
  );

  return res.status(200).json({
    timestamp,
    signature,
    apiKey: process.env.CLOUDINARY_API_KEY,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    folder,
    resourceType: req.body?.resourceType || 'video',
    publicId: publicId || null,
    provider: 'cloudinary',
  });
}

async function createResumableUpload(req, res) {
  if (!isGcsProvider()) {
    return res.status(400).json({
      error: 'Resumable uploads are only supported when GCS is enabled.',
    });
  }

  try {
    const session = await createResumableUploadUrl({
      folder: req.body?.folder,
      filename: req.body?.fileName,
      contentType: req.body?.contentType,
    });
    return res.status(200).json({
      provider: 'gcs',
      ...session,
    });
  } catch (err) {
    const requestId = `resumable_${Date.now()}`;
    const debug = buildErrorDebug(err);
    const payload = {
      requestId,
      route: '/api/uploads/resumable',
      folder: req.body?.folder || null,
      fileName: req.body?.fileName || null,
      contentType: req.body?.contentType || null,
      gcsBucket: process.env.GCS_BUCKET || null,
      hasGcsCredentialsPath: Boolean(process.env.GCS_CREDENTIALS_PATH),
      hasGoogleAppCredentials: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),
      ...debug,
    };

    console.error('[upload][resumable] failed', payload);

    return res.status(debug.status || 500).json({
      error: err?.message || 'Could not create resumable upload session.',
      requestId,
      debug: {
        status: payload.status,
        code: payload.code,
        reason: payload.reason,
      },
    });
  }
}

module.exports = {
  signUpload,
  createResumableUpload,
};
