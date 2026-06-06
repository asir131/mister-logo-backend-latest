const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

let bundledFfmpeg = null;
try {
  bundledFfmpeg = require('ffmpeg-static');
} catch {
  bundledFfmpeg = null;
}

let bundledFfprobe = null;
try {
  bundledFfprobe = require('ffprobe-static')?.path || null;
} catch {
  bundledFfprobe = null;
}

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

function getBinaryCandidates(envKey, fallback) {
  return [process.env[envKey], bundledFfmpeg, fallback].filter(Boolean);
}

function getProbeBinaryCandidates() {
  return [process.env.FFPROBE_PATH, bundledFfprobe, 'ffprobe'].filter(Boolean);
}

async function getVideoDurationSeconds(sourceUrl) {
  if (!sourceUrl) return null;
  const args = [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    sourceUrl,
  ];
  let lastError = null;
  for (const ffprobe of getProbeBinaryCandidates()) {
    try {
      const { stdout } = await runCommand(ffprobe, args);
      const duration = Number.parseFloat(String(stdout || '').trim());
      if (Number.isFinite(duration) && duration > 0) return duration;
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) {
    throw lastError;
  }
  return null;
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
  const ffmpegCandidates = getBinaryCandidates('FFMPEG_PATH', 'ffmpeg');

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
    let lastError = null;
    for (const ffmpeg of ffmpegCandidates) {
      try {
        await runCommand(ffmpeg, args);
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (lastError) throw lastError;
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
  getVideoDurationSeconds,
};
