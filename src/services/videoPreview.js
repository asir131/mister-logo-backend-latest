const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const err = new Error(stderr || error.message);
        err.code = error.code;
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      return resolve({ stdout, stderr });
    });
  });
}

function getBinaryPath(envKey, fallback) {
  return process.env[envKey] || fallback;
}

async function createPreviewFromUrl({
  sourceUrl,
  width = 720,
  seekSec = 1.0,
}) {
  if (!sourceUrl) {
    throw new Error('sourceUrl is required for preview generation.');
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-'));
  const outputPath = path.join(tempDir, 'preview.jpg');
  const ffmpeg = getBinaryPath('FFMPEG_PATH', 'ffmpeg');

  const args = [
    '-y',
    '-ss',
    String(seekSec),
    '-i',
    sourceUrl,
    '-vf',
    `scale=min(iw\\,${width}):-2:flags=lanczos,unsharp=5:5:0.6:3:3:0.0`,
    '-frames:v',
    '1',
    '-q:v',
    '2',
    outputPath,
  ];

  try {
    await runCommand(ffmpeg, args);
    const buffer = await fs.readFile(outputPath);
    await fs.rm(tempDir, { recursive: true, force: true });
    return buffer;
  } catch (err) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw err;
  }
}

module.exports = {
  createPreviewFromUrl,
};
