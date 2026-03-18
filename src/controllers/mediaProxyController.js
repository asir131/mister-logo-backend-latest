const { URL } = require('url');
const {
  getStorageClient,
  createSignedReadUrlFromObjectName,
} = require('../services/gcsStorage');

const BUCKET_NAME = process.env.GCS_BUCKET;
const MAX_PROXY_BYTES = Number.parseInt(process.env.MEDIA_PROXY_MAX_BYTES || '25000000', 10);
const SIGNED_URL_TTL_MINUTES = Number.parseInt(
  process.env.GCS_SIGNED_URL_TTL_MINUTES || '15',
  10
);

function extractObjectName(input) {
  if (!input) return null;
  const value = String(input).trim();
  if (!value) return null;
  if (value.startsWith('http://') || value.startsWith('https://')) {
    const parsed = new URL(value);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const [bucket, ...rest] = parts;
    if (BUCKET_NAME && bucket !== BUCKET_NAME) return null;
    return rest.join('/');
  }
  return value.replace(/^\/+/, '');
}

async function streamMedia(req, res) {
  if (!BUCKET_NAME) {
    return res.status(500).json({ error: 'GCS_BUCKET is not set.' });
  }

  const objectName =
    extractObjectName(req.query?.url) || extractObjectName(req.params?.objectPath);

  if (!objectName) {
    return res.status(400).json({ error: 'Missing object path.' });
  }

  try {
    const storage = getStorageClient();
    const bucket = storage.bucket(BUCKET_NAME);
    const file = bucket.file(objectName);

    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ error: 'Media not found.' });
    }

    const [metadata] = await file.getMetadata();
    const contentType = metadata?.contentType || 'application/octet-stream';
    const cacheControl = metadata?.cacheControl || 'public, max-age=31536000';
    const contentLength = metadata?.size ? Number(metadata.size) : undefined;

    const rangeHeader = req.headers.range;
    // Avoid proxying very large files without range support (Cloud Run response size limit).
    if (!rangeHeader && contentLength && contentLength > MAX_PROXY_BYTES) {
      try {
        const { readUrl } = await createSignedReadUrlFromObjectName(
          objectName,
          Number.isFinite(SIGNED_URL_TTL_MINUTES) ? SIGNED_URL_TTL_MINUTES : 15
        );
        return res.redirect(302, readUrl);
      } catch (err) {
        console.error('Media signed URL error:', err?.message || err);
        return res.status(500).json({ error: 'Could not generate media link.' });
      }
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('Accept-Ranges', 'bytes');

    let readStream;
    if (rangeHeader && contentLength) {
      const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
      const start = match && match[1] ? Number(match[1]) : 0;
      const end = match && match[2] ? Number(match[2]) : contentLength - 1;
      const safeStart = Number.isFinite(start) ? start : 0;
      const safeEnd = Number.isFinite(end) && end >= safeStart ? end : contentLength - 1;
      const chunkSize = safeEnd - safeStart + 1;

      res.status(206);
      res.setHeader('Content-Range', `bytes ${safeStart}-${safeEnd}/${contentLength}`);
      res.setHeader('Content-Length', String(chunkSize));
      readStream = file.createReadStream({ start: safeStart, end: safeEnd });
    } else {
      if (contentLength) res.setHeader('Content-Length', String(contentLength));
      readStream = file.createReadStream();
    }
    readStream.on('error', (err) => {
      console.error('Media stream error:', err?.message || err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Could not stream media.' });
      } else {
        res.end();
      }
    });
    return readStream.pipe(res);
  } catch (err) {
    console.error('Media proxy error:', err?.message || err);
    return res.status(500).json({ error: 'Could not fetch media.' });
  }
}

module.exports = {
  streamMedia,
};
