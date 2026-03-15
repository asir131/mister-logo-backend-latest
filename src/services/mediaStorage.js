const {
  uploadImageBuffer: uploadImageToCloudinary,
  uploadMediaBuffer: uploadMediaToCloudinary,
} = require('./cloudinary');
const {
  uploadImageBuffer: uploadImageToGcs,
  uploadMediaBuffer: uploadMediaToGcs,
  createSignedUploadUrl,
} = require('./gcsStorage');

const PROVIDER = String(process.env.MEDIA_STORAGE_PROVIDER || 'cloudinary').toLowerCase();

function isGcsProvider() {
  return PROVIDER === 'gcs';
}

async function uploadImageBuffer(buffer, options = {}) {
  if (isGcsProvider()) {
    return uploadImageToGcs(buffer, options);
  }
  return uploadImageToCloudinary(buffer, options);
}

async function uploadMediaBuffer(buffer, options = {}) {
  if (isGcsProvider()) {
    return uploadMediaToGcs(buffer, options);
  }
  return uploadMediaToCloudinary(buffer, options);
}

module.exports = {
  uploadImageBuffer,
  uploadMediaBuffer,
  createSignedUploadUrl,
  isGcsProvider,
};
