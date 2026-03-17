const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MB = 1024 * 1024;
const DEFAULT_TARGET_BYTES = 200 * MB;
const DEFAULT_MAX_INPUT_BYTES = 700 * MB;

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const err = new Error(stderr || `Command failed: ${command} ${args.join(' ')}`);
      err.code = code;
      reject(err);
    });
  });
}

async function getDurationSeconds(ffprobePath, inputPath) {
  const args = [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    inputPath,
  ];
  const { stdout } = await runCommand(ffprobePath, args);
  const duration = Number.parseFloat(String(stdout || '').trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Could not determine video duration with ffprobe.');
  }
  return duration;
}

async function transcodeToTarget({
  ffmpegPath,
  inputPath,
  outputPath,
  durationSeconds,
  targetBytes,
  preset = 'veryfast',
}) {
  const audioKbps = 96;
  const muxOverheadKbps = 20;
  const totalKbps = Math.floor(((targetBytes * 8) / Math.max(durationSeconds, 1)) / 1000);
  const videoKbps = Math.max(600, totalKbps - audioKbps - muxOverheadKbps);

  const args = [
    '-y',
    '-i', inputPath,
    '-c:v', 'libx264',
    '-preset', preset,
    '-b:v', `${videoKbps}k`,
    '-maxrate', `${videoKbps}k`,
    '-bufsize', `${videoKbps * 2}k`,
    '-c:a', 'aac',
    '-b:a', `${audioKbps}k`,
    '-movflags', '+faststart',
    '-f', 'mp4',
    outputPath,
  ];

  await runCommand(ffmpegPath, args);
}

async function compressVideoBufferIfNeeded({
  buffer,
  mimetype,
  inputSize,
  targetBytes = DEFAULT_TARGET_BYTES,
  maxInputBytes = DEFAULT_MAX_INPUT_BYTES,
}) {
  if (!buffer || !mimetype || !String(mimetype).startsWith('video/')) {
    return {
      buffer,
      mimetype,
      compressed: false,
      originalSize: inputSize || buffer?.length || 0,
      outputSize: inputSize || buffer?.length || 0,
    };
  }

  const originalSize = inputSize || buffer.length;
  if (originalSize <= targetBytes) {
    return {
      buffer,
      mimetype,
      compressed: false,
      originalSize,
      outputSize: originalSize,
    };
  }

  if (originalSize > maxInputBytes) {
    const err = new Error(`Video is too large (${Math.round(originalSize / MB)}MB). Maximum allowed input is ${Math.round(maxInputBytes / MB)}MB.`);
    err.status = 413;
    throw err;
  }

  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unap-video-compress-'));
  const inputPath = path.join(tempDir, 'input.bin');
  const outputPath = path.join(tempDir, 'output.mp4');

  try {
    await fs.writeFile(inputPath, buffer);
    const durationSeconds = await getDurationSeconds(ffprobePath, inputPath);

    await transcodeToTarget({
      ffmpegPath,
      inputPath,
      outputPath,
      durationSeconds,
      targetBytes,
      preset: 'veryfast',
    });

    let outputBuffer = await fs.readFile(outputPath);
    if (outputBuffer.length > targetBytes) {
      // Second pass with slower preset to improve compression.
      await transcodeToTarget({
        ffmpegPath,
        inputPath: outputPath,
        outputPath,
        durationSeconds,
        targetBytes: Math.floor(targetBytes * 0.92),
        preset: 'slow',
      });
      outputBuffer = await fs.readFile(outputPath);
    }

    return {
      buffer: outputBuffer,
      mimetype: 'video/mp4',
      compressed: true,
      originalSize,
      outputSize: outputBuffer.length,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  MB,
  compressVideoBufferIfNeeded,
  DEFAULT_TARGET_BYTES,
  DEFAULT_MAX_INPUT_BYTES,
};
