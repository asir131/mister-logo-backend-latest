const cloudinary = require('cloudinary').v2;

function signUpload(req, res) {
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
  });
}

module.exports = {
  signUpload,
};
