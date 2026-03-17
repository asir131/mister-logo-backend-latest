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
  durationSeconds,
  width = 480,
}) {
  if (!sourceUrl) {
    throw new Error('sourceUrl is required for preview generation.');
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-'));
  const outputPath = path.join(tempDir, 'preview.mp4');
  const ffmpeg = getBinaryPath('FFMPEG_PATH', 'ffmpeg');

  const args = [
    '-y',
    '-ss',
    '0',
    '-i',
    sourceUrl,
    '-vf',
    `scale=-2:240`,
    '-r',
    '24',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '32',
    '-b:v',
    '350k',
    '-maxrate',
    '450k',
    '-bufsize',
    '900k',
    '-pix_fmt',
    'yuv420p',
    '-an',
    '-movflags',
    '+faststart',
    outputPath,
  ];

  if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
    args.splice(3, 0, '-t', String(durationSeconds));
  }

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
