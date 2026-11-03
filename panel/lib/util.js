'use strict';
// Drobne narzędzia wspólne dla serwera panelu (bez zależności npm).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { tr, trBoth } = require('./i18n');

// Publiczna strona projektu – w nagłówkach zapytań (User-Agent, OpenRouter), żeby właściciel serwisu wiedział, kto pyta.
const PROJECT_URL = 'https://github.com/imdangro/poster-app';
// Strona produktu: opis wersji LITE i PRO, zakup PRO (link przy funkcjach PRO w wersji LITE)
const PRODUCT_URL = 'https://posterapp.pl/';
// Strona produktu w języku panelu: polska pod adresem głównym, angielska (też dla innych języków) pod /en/
const productUrl = (language) => (language === 'pl' ? PRODUCT_URL : `${PRODUCT_URL}en/`);
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

// Odczyt pliku JSON, który mógł się uszkodzić (zanik prądu na NAS-ie, pełny dysk, ręczna edycja). Brak pliku = fallback.
// Uszkodzony plik zostaje odłożony jako <plik>.corrupt-<czas> (do ręcznego odzyskania), a dane pochodzą z kopii
// <plik>.bak (writeJsonAtomic z backup: true) albo z fallback – panel startuje zamiast restartować się w kółko.
// strict (konfiguracja, klucze): bez działającej kopii błąd zamiast pustych danych, a plik zostaje na miejscu.
function readJsonSafe(file, fallback, { strict = false, log = console.error } = {}) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error(tr('Nie można odczytać {0}: {1}', file, e.message));
  }
  try {
    return JSON.parse(text);
  } catch (e) {}
  let backup;
  try {
    backup = JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8'));
  } catch (e) {}
  if (backup === undefined && strict) {
    throw new Error(
      tr(
        'Plik {0} jest uszkodzony, a jego kopii (.bak) brak albo też jest uszkodzona – popraw plik albo go usuń (panel zacznie wtedy od pustych danych)',
        file,
      ),
    );
  }
  const aside = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.renameSync(file, aside);
  // odzyskane dane od razu w głównym pliku – kolejny start (np. restart przed pierwszym zapisem) nie zależy od kopii
  if (backup !== undefined) writeJsonAtomic(file, backup, 0o600);
  log(
    backup !== undefined
      ? trBoth('Plik {0} był uszkodzony – użyto poprzedniej wersji (.bak), a uszkodzony zapisano jako {1}', file, aside)
      : trBoth('Plik {0} był uszkodzony – start od pustych danych, a uszkodzony zapisano jako {1}', file, aside),
  );
  return backup !== undefined ? backup : fallback;
}

// Zapis atomowy: plik tymczasowy + fsync + rename – przerwany zapis ani zanik prądu nie zostawią pustego albo uciętego
// pliku. Plik tymczasowy ma losową nazwę i powstaje z O_EXCL (flaga „wx”), więc zapis nie pójdzie za podłożonym
// dowiązaniem symbolicznym – także gdy pisze root w katalogu należącym do kontenera (scripts/license.sh).
//   backup – poprzednia wersja zostaje jako <plik>.bak (readJsonSafe sięga po nią, gdy plik jest uszkodzony),
//   owner  – { uid, gid }: właściciel ustawiony na deskryptorze pliku tymczasowego, a nie chown po ścieżce.
function writeJsonAtomic(file, data, mode = 0o600, { backup = false, owner = null } = {}) {
  const tmp = `${file}.${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'wx', mode);
  try {
    try {
      if (owner) fs.fchownSync(fd, owner.uid, owner.gid);
      fs.writeFileSync(fd, JSON.stringify(data, null, 2) + '\n');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (backup) keepBackup(file);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  syncDir(path.dirname(file));
}

// Kopia poprzedniej wersji zwykłego pliku jako <plik>.bak: twarde dowiązanie (bez kopiowania danych), a gdy system plików
// go nie obsługuje – kopia. Bez poprzedniej wersji (np. uszkodzony plik odłożony przez readJsonSafe) stara kopia zostaje.
function keepBackup(file) {
  try {
    if (!fs.lstatSync(file).isFile()) return;
  } catch (e) {
    return;
  }
  const bak = `${file}.bak`;
  fs.rmSync(bak, { force: true });
  try {
    fs.linkSync(file, bak);
  } catch (e) {
    try {
      fs.copyFileSync(file, bak);
    } catch (e2) {}
  }
}

// fsync katalogu: zmiana nazwy (rename) przetrwa zanik prądu; system, który tego nie obsługuje, pomija krok
function syncDir(dir) {
  let fd;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch (e) {
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
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

// Ochrona przed CSRF dla zapytań zmieniających dane. Typ treści musi być dokładnie application/json – formularz ani
// „prosty” fetch z obcej strony go nie ustawią (np. „text/plain; x=application/json” przeglądarka wysyła bez pytania
// CORS, więc samo „zawiera application/json” nie wystarcza).
const isJsonType = (req) =>
  String(req.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase() === 'application/json';

// Zapytanie z tej samej strony (origin), a nie tylko z tej samej witryny: inna aplikacja pod adresem NAS-a (inny port),
// localhost przy tunelu SSH albo sąsiednia subdomena za reverse proxy to dla przeglądarki ta sama witryna, więc
// SameSite ciasteczka sesji ich nie zatrzymuje. Sec-Fetch-Site ustawia przeglądarka (strona nie może go podrobić);
// starsza przeglądarka bez niego – Origin porównany z adresem panelu (Host albo X-Forwarded-Host za reverse proxy).
// Bez obu nagłówków to klient spoza przeglądarki (curl, testy) – takiego zapytania obca strona nie wyśle.
function sameOrigin(req) {
  const site = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (site) return site === 'same-origin';
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  let host;
  try {
    host = new URL(String(origin)).host.toLowerCase();
  } catch (e) {
    return false; // „null” (ramka z sandboxem, plik z dysku) albo nieczytelny nagłówek
  }
  const first = (h) =>
    String(h || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
  return host === first(req.headers.host) || host === first(req.headers['x-forwarded-host']);
}

// Błąd fetch, po którym nie wiadomo, czy serwer przyjął zapytanie: przekroczony czas albo połączenie zerwane po
// wysłaniu – np. post mógł się opublikować mimo braku odpowiedzi. Nieudane połączenie (DNS, odmowa, TLS) – false.
const NO_ANSWER_CODES = new Set(['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT']);
function noAnswer(e) {
  if (!e) return false;
  return e.name === 'TimeoutError' || NO_ANSWER_CODES.has(e.cause?.code || e.code);
}

// fetch z limitem czasu; zwraca { status, ok, data (JSON lub null), text }. Błąd bez odpowiedzi serwera ma
// noAnswer = true (zapytanie mogło dotrzeć – przy publikacji wynik „nie wiadomo”, a nie zwykły błąd).
async function fetchJson(url, { method = 'GET', headers = {}, body, timeout = 20000 } = {}) {
  const failed = (e) => {
    const reason = e.name === 'TimeoutError' ? tr('przekroczono czas ({0} s)', Math.round(timeout / 1000)) : e.cause?.code || e.message;
    if (!noAnswer(e)) return new HttpError(502, tr('Brak połączenia z {0}: {1}', hostOf(url), reason));
    const err = new HttpError(502, tr('Brak odpowiedzi od {0}: {1}', hostOf(url), reason));
    err.noAnswer = true;
    return err;
  };
  let res;
  let text;
  try {
    res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
    text = await res.text();
  } catch (e) {
    throw failed(e);
  }
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

// Zadanie co `ms` milisekund (pierwszy raz po `first`) bez nakładania się przebiegów: gdy poprzedni jeszcze trwa
// (np. n8n odpowiada wolno), kolejny jest pomijany. fn obsługuje własne błędy. stop() zatrzymuje zegary i zwraca
// obietnicę końca trwającego przebiegu (zamykanie panelu); run() – przebieg od razu (ten sam bezpiecznik).
function periodic(fn, ms, first = ms, { unref = false } = {}) {
  let current = null;
  const run = () => {
    if (current) return current;
    current = (async () => {
      try {
        await fn();
      } catch (e) {
      } finally {
        current = null;
      }
    })();
    return current;
  };
  const kick = setTimeout(run, first);
  const timer = setInterval(run, ms);
  if (unref) {
    kick.unref();
    timer.unref();
  }
  return {
    run,
    stop() {
      clearTimeout(kick);
      clearInterval(timer);
      return current || Promise.resolve();
    },
  };
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
  productUrl,
  EDITION,
  HttpError,
  readJson,
  readJsonSafe,
  writeJsonAtomic,
  randomId,
  sleep,
  safeEqual,
  sendJson,
  readBody,
  readJsonBody,
  isJsonType,
  sameOrigin,
  noAnswer,
  fetchJson,
  readLimited,
  hostOf,
  withLock,
  periodic,
  form,
  mask,
};
