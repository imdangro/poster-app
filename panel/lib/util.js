'use strict';
// Drobne narzędzia wspólne dla serwera panelu (bez zależności npm).
const fs = require('fs');
const crypto = require('crypto');
const { tr } = require('./i18n');

// Publiczna strona projektu – w nagłówkach zapytań (User-Agent, OpenRouter), żeby właściciel serwisu wiedział, kto pyta.
const PROJECT_URL = 'https://github.com/imdangro/poster-app';
// Strona produktu: opis wersji LITE i PRO, zakup PRO (link przy funkcjach PRO w wersji LITE)
const PRODUCT_URL = 'https://posterapp.pl/';
// Wersja programu: LITE (publiczna, AGPL) albo PRO (płatna) – obie powstają z jednego źródła (tools/export.js)
const EDITION = 'lite';

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error(tr('Nie można odczytać {0}: {1}', file, e.message));
  }
}

// Zapis atomowy: plik tymczasowy + rename – przerwany zapis nie uszkodzi konfiguracji.
function writeJsonAtomic(file, data, mode = 0o600) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode });
  fs.renameSync(tmp, file);
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
function randomId(len = 6) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, tr('Zbyt duże zapytanie')));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req, limit) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch (e) {
    throw new HttpError(400, tr('Niepoprawny JSON w zapytaniu'));
  }
}

// fetch z limitem czasu; zwraca { status, ok, data (JSON lub null), text }
async function fetchJson(url, { method = 'GET', headers = {}, body, timeout = 20000 } = {}) {
  let res;
  try {
    res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
  } catch (e) {
    const reason = e.name === 'TimeoutError' ? tr('przekroczono czas ({0} s)', Math.round(timeout / 1000)) : e.cause?.code || e.message;
    throw new HttpError(502, tr('Brak połączenia z {0}: {1}', hostOf(url), reason));
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {}
  return { status: res.status, ok: res.ok, data, text };
}

// Treść odpowiedzi z obcego serwera z limitem rozmiaru: brak nagłówka content-length nie może zapchać pamięci
// NAS-a (np. ogromny plik podany w kanale RSS). null = odpowiedź większa niż `max` bajtów.
async function readLimited(res, max) {
  if (Number(res.headers.get('content-length') || 0) > max) {
    if (res.body) res.body.cancel().catch(() => {});
    return null;
  }
  const chunks = [];
  let size = 0;
  if (res.body) {
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > max) return null; // wyjście z pętli przerywa pobieranie
      chunks.push(chunk);
    }
  }
  return Buffer.concat(chunks);
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch (e) {
    return String(url).slice(0, 60);
  }
}

// Serializacja operacji na tym samym kluczu (np. odświeżanie tokenu jednego konta).
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  // ogon kolejki nigdy nie odrzuca (brak „unhandled rejection”); błąd dostaje tylko wywołujący
  const tail = next
    .catch(() => {})
    .finally(() => {
      if (locks.get(key) === tail) locks.delete(key);
    });
  locks.set(key, tail);
  return next;
}

const form = (obj) =>
  Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

// Maskowanie sekretów w odpowiedziach API: tylko końcówka, np. "••••a1b2".
const mask = (s) => (s ? `••••${String(s).slice(-4)}` : '');

module.exports = {
  PROJECT_URL,
  PRODUCT_URL,
  EDITION,
  HttpError,
  readJson,
  writeJsonAtomic,
  randomId,
  sleep,
  safeEqual,
  sendJson,
  readBody,
  readJsonBody,
  fetchJson,
  readLimited,
  hostOf,
  withLock,
  form,
  mask,
};
