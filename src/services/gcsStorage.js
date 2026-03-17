const { Storage } = require('@google-cloud/storage');
const crypto = require('crypto');
const path = require('path');

const BUCKET_NAME = process.env.GCS_BUCKET;
const CREDENTIALS_PATH =
  process.env.GCS_CREDENTIALS_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
const DEFAULT_FOLDER = process.env.GCS_DEFAULT_FOLDER || 'mister';
const MAKE_PUBLIC = String(process.env.GCS_MAKE_PUBLIC || '').toLowerCase() === 'true';
const SIGNED_URL_TTL_MINUTES = Number.parseInt(
  process.env.GCS_SIGNED_URL_TTL_MINUTES || '15',
  10,
);

function getStorageClient() {
  if (!BUCKET_NAME) {
    throw new Error('GCS_BUCKET is not set.');
  }
  if (CREDENTIALS_PATH) {
    return new Storage({ keyFilename: CREDENTIALS_PATH });
  }
  return new Storage();
}

function normalizeFolder(folder) {
  if (!folder) return DEFAULT_FOLDER;
  return String(folder).replace(/^\/+|\/+$/g, '');
}

function guessExtensionFromMime(mimeType) {
  if (!mimeType) return '';
  if (mimeType.startsWith('image/')) return mimeType.split('/')[1] || '';
  if (mimeType.startsWith('video/')) return mimeType.split('/')[1] || '';
  if (mimeType.startsWith('audio/')) return mimeType.split('/')[1] || '';
  return '';
}

function buildObjectName({ folder, publicId, public_id, filename, fileName, contentType }) {
  const safeFolder = normalizeFolder(folder);
  const resolvedId = publicId || public_id;
  let baseName = resolvedId ? String(resolvedId) : crypto.randomUUID();
  const existingExt = path.extname(baseName);
  if (!existingExt) {
    const resolvedFilename = filename || fileName;
    const filenameExt = resolvedFilename ? path.extname(resolvedFilename) : '';
    const mimeExt = guessExtensionFromMime(contentType);
    if (filenameExt) {
      baseName += filenameExt;
    } else if (mimeExt) {
      baseName += `.${mimeExt}`;
    }
  }
  return safeFolder ? `${safeFolder}/${baseName}` : baseName;
}

function buildPublicUrl(objectName) {
  return `https://storage.googleapis.com/${BUCKET_NAME}/${encodeURI(objectName)}`;
}

function extractObjectNameFromUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(String(url));
    const pathname = parsed.pathname || '';
    // Expect /bucket/objectName
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const bucket = parts.shift();
    if (bucket !== BUCKET_NAME) return null;
    return parts.join('/');
  } catch {
    return null;
  }
}

async function uploadBuffer(buffer, options = {}) {
  const storage = getStorageClient();
  const bucket = storage.bucket(BUCKET_NAME);
  const objectName = buildObjectName(options);
  const file = bucket.file(objectName);
  const contentType = options.contentType || options.mimetype || options.content_type || undefined;
  const cacheControl = options.cacheControl || 'public, max-age=31536000';

  try {
    await file.save(buffer, {
      resumable: false,
      contentType,
      metadata: { cacheControl },
    });
  } catch (err) {
    console.error('GCS upload error:', err?.message || err);
    throw err;
  }

  if (MAKE_PUBLIC) {
    await file.makePublic();
  }

  const publicUrl = buildPublicUrl(objectName);
  return {
    url: publicUrl,
    secure_url: publicUrl,
    public_id: objectName,
    bucket: BUCKET_NAME,
    objectName,
    contentType,
  };
}

async function createSignedUploadUrl(options = {}) {
  const storage = getStorageClient();
  const bucket = storage.bucket(BUCKET_NAME);
  const objectName = buildObjectName(options);
  const file = bucket.file(objectName);
  const contentType =
    options.contentType || options.mimetype || options.content_type || 'application/octet-stream';
  const ttlMinutes = Number.isFinite(SIGNED_URL_TTL_MINUTES) && SIGNED_URL_TTL_MINUTES > 0
    ? SIGNED_URL_TTL_MINUTES
    : 15;
  const expiresAt = Date.now() + ttlMinutes * 60 * 1000;

  const [uploadUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: expiresAt,
    contentType,
  });

  return {
    uploadUrl,
    objectName,
    bucket: BUCKET_NAME,
    contentType,
    publicUrl: buildPublicUrl(objectName),
    expiresAt,
  };
}

async function createResumableUploadUrl(options = {}) {
  const storage = getStorageClient();
  const bucket = storage.bucket(BUCKET_NAME);
  const objectName = buildObjectName(options);
  const file = bucket.file(objectName);
  const contentType =
    options.contentType || options.mimetype || options.content_type || 'application/octet-stream';
  const cacheControl = options.cacheControl || 'public, max-age=31536000';

  const [uploadUrl] = await file.createResumableUpload({
    metadata: {
      contentType,
      cacheControl,
    },
  });

  return {
    uploadUrl,
    objectName,
    bucket: BUCKET_NAME,
    contentType,
    publicUrl: buildPublicUrl(objectName),
  };
}

async function createSignedReadUrlFromUrl(url, ttlMinutes = 15) {
  const objectName = extractObjectNameFromUrl(url);
  if (!objectName) {
    throw new Error('Unable to derive object name from URL.');
  }
  const storage = getStorageClient();
  const bucket = storage.bucket(BUCKET_NAME);
  const file = bucket.file(objectName);
  const expiresAt = Date.now() + ttlMinutes * 60 * 1000;

  const [readUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: expiresAt,
  });

  return { readUrl, objectName, bucket: BUCKET_NAME, expiresAt };
}

async function createSignedReadUrlFromObjectName(objectName, ttlMinutes = 15) {
  if (!objectName) {
    throw new Error('objectName is required.');
  }
  const storage = getStorageClient();
  const bucket = storage.bucket(BUCKET_NAME);
  const file = bucket.file(objectName);
  const expiresAt = Date.now() + ttlMinutes * 60 * 1000;

  const [readUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: expiresAt,
  });

  return { readUrl, objectName, bucket: BUCKET_NAME, expiresAt };
}

module.exports = {
  uploadImageBuffer: uploadBuffer,
  uploadMediaBuffer: uploadBuffer,
  createSignedUploadUrl,
  createSignedReadUrlFromUrl,
  createSignedReadUrlFromObjectName,
  createResumableUploadUrl,
  getStorageClient,
};
