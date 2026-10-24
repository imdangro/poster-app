'use strict';
// Logowanie do panelu: hasło (scrypt) i sesja w podpisanym ciasteczku. Pierwsze hasło (i nowe po resecie) ustawisz
// tylko z jednorazowym kodem z logów panelu – kto pierwszy otworzy panel w sieci, nie przejmie go bez dostępu do NAS-a.
// Reset hasła: sudo docker compose exec panel node reset-password.js (wypisuje nowy kod, działa bez restartu panelu).
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { readJson, writeJsonAtomic, HttpError } = require('./util');
const { tr, trBoth } = require('./i18n');

const COOKIE = 'poster_session';
const SESSION_DAYS = 30;
// Bez znaków, które mylą się przy przepisywaniu z logów (0/O, 1/I/L)
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// Jednorazowy kod w formacie XXXX-XXXX-XXXX
function newSetupCode() {
  let s = '';
  for (let i = 0; i < 12; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s.match(/.{4}/g).join('-');
}
const normalizeCode = (s) =>
  String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

class Auth {
  // cookie: nazwa ciasteczka sesji – inna dla innej usługi pod tym samym adresem (ciasteczka nie rozróżniają portów)
  constructor(dir, { log = console.log, cookie = COOKIE } = {}) {
    this.file = path.join(dir, 'auth.json');
    this.log = log;
    this.cookie = cookie;
    this.stamp = undefined;
    this.data = null;
    this.failures = new Map(); // ip → { count, until }
    this.reload();
  }

  // auth.json zmienia też reset-password.js (osobny proces) – panel czyta plik ponownie, gdy się zmienił
  reload() {
    let stamp = null;
    try {
      const st = fs.statSync(this.file);
      stamp = `${st.ino}:${st.mtimeMs}:${st.size}`;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    this.data = stamp ? readJson(this.file, null) : null;
  }

  save(data) {
    writeJsonAtomic(this.file, data, 0o600);
    this.data = data;
    this.stamp = undefined; // następny reload() odczyta znacznik zapisanego pliku
  }

  get needsSetup() {
    this.reload();
    return !this.data || !this.data.hash;
  }

  // Kod do ustawienia hasła (tworzony, gdy go brak – np. przy pierwszym starcie albo po ręcznym usunięciu auth.json)
  setupCode() {
    if (!this.needsSetup) return null;
    if (!this.data || !this.data.setupCode) {
      this.save({ setupCode: newSetupCode(), createdAt: new Date().toISOString() });
      this.logCode();
    }
    return this.data.setupCode;
  }

  logCode() {
    // w obu językach: przy pierwszym starcie panel nie zna jeszcze języka użytkownika
    this.log(trBoth('Kod do ustawienia hasła panelu: {0} – wpisz go w przeglądarce razem z nowym hasłem.', this.data.setupCode));
  }

  // Przy starcie panelu: pokaż kod w logach także wtedy, gdy powstał wcześniej (np. przez reset-password.js)
  announceSetup() {
    if (!this.needsSetup) return;
    if (this.data && this.data.setupCode) this.logCode();
    else this.setupCode();
  }

  checkSetupCode(code) {
    const want = Buffer.from(normalizeCode(this.setupCode()));
    const got = Buffer.from(normalizeCode(code));
    return want.length > 0 && want.length === got.length && crypto.timingSafeEqual(want, got);
  }

  hash(password, salt) {
    return crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  }

  setPassword(password) {
    if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, tr('Hasło musi mieć co najmniej 8 znaków'));
    const salt = crypto.randomBytes(16).toString('hex');
    // nowy sekret sesji = wylogowanie wszystkich dotychczasowych sesji; kod pierwszego uruchomienia przestaje działać
    this.save({
      salt,
      hash: this.hash(password, salt),
      secret: crypto.randomBytes(32).toString('hex'),
      updatedAt: new Date().toISOString(),
    });
  }

  verify(password) {
    if (this.needsSetup || typeof password !== 'string') return false;
    const h = Buffer.from(this.hash(password, this.data.salt), 'hex');
    const ok = Buffer.from(this.data.hash, 'hex');
    return h.length === ok.length && crypto.timingSafeEqual(h, ok);
  }

  checkRate(ip) {
    const f = this.failures.get(ip);
    if (f && f.count >= 8 && f.until > Date.now()) {
      throw new HttpError(429, tr('Zbyt wiele nieudanych prób – spróbuj za {0} min', Math.ceil((f.until - Date.now()) / 60000)));
    }
  }
  fail(ip) {
    const f = this.failures.get(ip);
    const fresh = !f || f.until < Date.now();
    this.failures.set(ip, { count: fresh ? 1 : f.count + 1, until: Date.now() + 15 * 60 * 1000 });
  }

  sign(value) {
    return crypto.createHmac('sha256', this.data.secret).update(value).digest('base64url');
  }

  // Za odwrotnym proxy z HTTPS (X-Forwarded-Proto: https) ciasteczko dostaje flagę Secure
  cookieFlags(req) {
    const https =
      req &&
      String(req.headers['x-forwarded-proto'] || '')
        .split(',')[0]
        .trim() === 'https';
    return `HttpOnly; SameSite=Lax; Path=/${https ? '; Secure' : ''}`;
  }

  createCookie(req) {
    const exp = Date.now() + SESSION_DAYS * 86400 * 1000;
    const value = `${exp}.${this.sign(String(exp))}`;
    return `${this.cookie}=${value}; ${this.cookieFlags(req)}; Max-Age=${SESSION_DAYS * 86400}`;
  }

  clearCookie(req) {
    return `${this.cookie}=; ${this.cookieFlags(req)}; Max-Age=0`;
  }

  isAuthenticated(req) {
    if (this.needsSetup) return false;
    const raw = String(req.headers.cookie || '')
      .split(/;\s*/)
      .find((c) => c.startsWith(this.cookie + '='));
    if (!raw) return false;
    const [exp, sig] = raw.slice(this.cookie.length + 1).split('.');
    if (!exp || !sig || Number(exp) < Date.now()) return false;
    const expected = Buffer.from(this.sign(exp));
    const got = Buffer.from(sig);
    return expected.length === got.length && crypto.timingSafeEqual(expected, got);
  }
}

module.exports = { Auth, newSetupCode };
