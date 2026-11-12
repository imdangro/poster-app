'use strict';
// Logowanie do panelu: hasło (scrypt) i sesja w podpisanym ciasteczku. Pierwsze hasło (i nowe po resecie) ustawisz
// tylko z jednorazowym kodem z logów panelu – kto pierwszy otworzy panel w sieci, nie przejmie go bez dostępu do NAS-a.
// Reset hasła: sudo docker compose exec panel node reset-password.js (wypisuje nowy kod, działa bez restartu panelu).
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { readJsonSafe, writeJsonAtomic, HttpError, withLock } = require('./util');
const { isPublicAddress } = require('./net');
const { tr, trBoth } = require('./i18n');

const COOKIE = 'poster_session';
const SESSION_DAYS = 30;
// Limit nieudanych prób (hasło, kod z logów, obecne hasło przy zmianie): na adres i dla wszystkich adresów razem
// w oknie 15 min – wspólny limit ogranicza zgadywanie także wtedy, gdy ktoś podaje fałszywe adresy (X-Forwarded-For)
const MAX_FAILS = 8;
const MAX_FAILS_ALL = 40;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const ALL = '*';
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
    // uszkodzony auth.json zostaje odłożony (readJsonSafe) – panel startuje z nowym kodem do ustawienia hasła w logach,
    // jak po resecie hasła (bez kopii .bak: nie może wrócić hasło sprzed resetu)
    this.data = stamp ? readJsonSafe(this.file, null) : null;
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

  // scrypt asynchronicznie (pula wątków Node.js) – logowanie nie wstrzymuje panelu na kilkadziesiąt ms
  hash(password, salt) {
    return new Promise((resolve, reject) =>
      crypto.scrypt(password, Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 }, (err, key) =>
        err ? reject(err) : resolve(key.toString('hex')),
      ),
    );
  }

  async setPassword(password) {
    if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, tr('Hasło musi mieć co najmniej 8 znaków'));
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await this.hash(password, salt);
    // nowy sekret sesji = wylogowanie wszystkich dotychczasowych sesji; kod pierwszego uruchomienia przestaje działać
    this.save({
      salt,
      hash,
      secret: crypto.randomBytes(32).toString('hex'),
      updatedAt: new Date().toISOString(),
    });
  }

  async verify(password) {
    if (this.needsSetup || typeof password !== 'string') return false;
    const { salt, hash } = this.data; // hasło mogło się zmienić (reset w innym procesie) w trakcie liczenia
    const h = Buffer.from(await this.hash(password, salt), 'hex');
    const ok = Buffer.from(hash, 'hex');
    return h.length === ok.length && crypto.timingSafeEqual(h, ok);
  }

  // Adres klienta do limitu prób. Za odwrotnym proxy w sieci lokalnej (połączenie z adresu prywatnego) – pierwszy adres
  // z X-Forwarded-For, żeby błędy jednej osoby nie blokowały wszystkich; fałszywy nagłówek ogranicza limit wspólny.
  clientKey(req) {
    const ip = String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
    const forwarded = String(req.headers['x-forwarded-for'] || '')
      .split(',')[0]
      .trim()
      .slice(0, 64);
    return forwarded && !isPublicAddress(ip) ? forwarded : ip;
  }

  checkRate(key) {
    const now = Date.now();
    const blocked = [this.failures.get(key), this.failures.get(ALL)].find(
      (f, i) => f && f.until > now && f.count >= (i ? MAX_FAILS_ALL : MAX_FAILS),
    );
    if (blocked) throw new HttpError(429, tr('Zbyt wiele nieudanych prób – spróbuj za {0} min', Math.ceil((blocked.until - now) / 60000)));
  }
  fail(key) {
    const now = Date.now();
    for (const k of [key, ALL]) {
      const f = this.failures.get(k);
      const fresh = !f || f.until < now;
      this.failures.set(k, { count: fresh ? 1 : f.count + 1, until: now + FAIL_WINDOW_MS });
    }
    // wygasłe wpisy znikają – mapa nie rośnie bez końca
    if (this.failures.size > 1000) for (const [k, f] of this.failures) if (f.until < now) this.failures.delete(k);
  }

  // Jedna próba hasła (logowanie, obecne hasło przy zmianie). Próba liczy się PRZED sprawdzeniem: zapytania wysłane
  // naraz nie miną limitu, zanim zapisze się pierwszy błąd (scrypt trwa kilkadziesiąt ms), a udana oddaje swój punkt.
  // Hasła sprawdzamy pojedynczo – seria zapytań nie zajmie puli wątków Node.js, z której korzysta też DNS połączeń
  // wychodzących panelu. check() zwraca true, gdy hasło jest poprawne.
  async attempt(key, check) {
    this.checkRate(key);
    this.fail(key);
    const ok = await withLock(`auth:${this.file}`, check);
    if (ok) this.forgive(key);
    return ok;
  }
  forgive(key) {
    for (const k of [key, ALL]) {
      const f = this.failures.get(k);
      if (!f) continue;
      if (f.count > 1) f.count--;
      else this.failures.delete(k);
    }
  }

  // „Wyloguj na wszystkich urządzeniach”: nowy sekret sesji – każde wydane ciasteczko (np. na zgubionym telefonie)
  // przestaje działać; hasło bez zmian
  logoutEverywhere() {
    this.reload();
    if (this.needsSetup) return;
    this.save({ ...this.data, secret: crypto.randomBytes(32).toString('hex'), sessionsResetAt: new Date().toISOString() });
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
