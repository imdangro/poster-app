'use strict';
// ffmpeg w kontenerze panelu (instaluje go panel/Dockerfile): konwersja zdjęć WebP do JPG/PNG, zmniejszanie
// i przycinanie zdjęć (własne zdjęcie w drafcie, /post).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// Najwyżej FFMPEG_MAX procesów ffmpeg naraz (domyślnie 2): kilka animacji i konwersji jednocześnie nie zajmie całej
// pamięci i procesora NAS-a – kolejne czekają w kolejce
const MAX = Math.max(1, parseInt(process.env.FFMPEG_MAX, 10) || 2);
let running = 0;
const waiting = [];
const slot = () => (running < MAX ? (running++, Promise.resolve()) : new Promise((resolve) => waiting.push(resolve)));
const release = () => {
  const next = waiting.shift();
  if (next) next();
  else running--;
};

// Największy obraz, jaki ffmpeg zdekoduje: FFMPEG_MAX_PIXELS, domyślnie 120 Mpx (zdjęcia z aparatów 108 Mpx się
// mieszczą). Plik z cudzego kanału może mieć kilka MB, a w nagłówku np. 30000 × 30000 px – jego dekodowanie zajęłoby
// kilka GB pamięci kontenera panelu. Większy obraz ffmpeg odrzuca błędem, zanim przydzieli pamięć.
const maxPixels = () => Math.max(1, parseInt(process.env.FFMPEG_MAX_PIXELS, 10) || 120 * 1000 * 1000);
// opcja dekodera musi stać przed plikiem wejściowym (pierwsze „-i”)
function withPixelLimit(args) {
  const i = args.indexOf('-i');
  return i < 0 ? args : [...args.slice(0, i), '-max_pixels', String(maxPixels()), ...args.slice(i)];
}

async function ffmpeg(args, timeout) {
  await slot();
  try {
    return await run(withPixelLimit(args), timeout);
  } finally {
    release();
  }
}

function run(args, timeout) {
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

// JPG do `maxSide` px (domyślnie 2048 – mieści się w limicie zdjęć X 5 MB), opcjonalnie środek kadru w proporcjach
// `ratio` (szerokość / wysokość, np. 0,8 = 4:5 pod Instagram). Najpierw zmniejszenie, potem przycięcie. Wymiary
// parzyste (JPG z podpróbkowaniem kolorów); przycinany bok liczony z ostatecznego drugiego boku i zaokrąglony w dół –
// proporcje zostają w zakresie Instagrama (np. ≥ 4:5). flatten – przezroczystość (PNG) na białym tle zamiast czarnego.
async function fitJpeg({ buffer, width, height }, { ratio = null, maxSide = 2048, flatten = false } = {}) {
  const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
  const r = ratio || width / height;
  const tall = width / height < r; // za wąskie – przycinamy wysokość, za szerokie – szerokość
  const scale = Math.min(1, maxSide / (tall ? Math.max(width, width / r) : Math.max(height * r, height)));
  const sw = scale < 1 ? even(width * scale) : width;
  const sh = scale < 1 ? even(height * scale) : height;
  const w = tall ? even(sw) : even(even(sh) * r);
  const h = tall ? even(even(sw) / r) : even(sh);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-fit-'));
  const src = path.join(dir, 'in');
  const out = path.join(dir, 'out.jpg');
  try {
    fs.writeFileSync(src, buffer);
    const fit = [...(scale < 1 ? [`scale=${sw}:${sh}`] : []), `crop=${w}:${h}:${Math.floor((sw - w) / 2)}:${Math.floor((sh - h) / 2)}`];
    const filter = flatten
      ? ['-filter_complex', `[0:v]${fit.join(',')},format=rgba[f];color=c=white:s=${w}x${h}[bg];[bg][f]overlay=shortest=1`]
      : ['-vf', fit.join(',')];
    await ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', src, ...filter, '-frames:v', '1', '-q:v', '3', out], 30000);
    const jpg = fs.readFileSync(out);
    return { buffer: jpg, width: w, height: h };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { ffmpeg, convertWebp, fitJpeg };
