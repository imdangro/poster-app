'use strict';
// ffmpeg w kontenerze panelu (instaluje go panel/Dockerfile): konwersja zdjęć WebP do JPG/PNG.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

function ffmpeg(args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(process.env.FFMPEG_PATH || 'ffmpeg', args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = String(stderr || '').slice(-600);
        reject(err);
      } else resolve();
    });
  });
}

// Zdjęcie WebP (częste na blogach) → JPG, a z przezroczystością → PNG. X, Facebook i Telegram bezpiecznie
// przyjmują tylko JPG i PNG. Animowany WebP się nie skonwertuje (błąd ffmpeg) – wtedy zdjęcie jest pomijane.
async function convertWebp(buffer) {
  // VP8X z flagą przezroczystości albo bezstratny VP8L (zwykle grafika z przezroczystością)
  const chunk = buffer.toString('ascii', 12, 16);
  const alpha = chunk === 'VP8L' || (chunk === 'VP8X' && (buffer[20] & 0x10) !== 0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-img-'));
  const src = path.join(dir, 'in.webp');
  const out = path.join(dir, alpha ? 'out.png' : 'out.jpg');
  try {
    fs.writeFileSync(src, buffer);
    await ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', src, '-frames:v', '1', ...(alpha ? [] : ['-q:v', '3']), out], 30000);
    return { buffer: fs.readFileSync(out), mimeType: alpha ? 'image/png' : 'image/jpeg' };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { ffmpeg, convertWebp };
