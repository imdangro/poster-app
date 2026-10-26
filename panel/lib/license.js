'use strict';
// Licencja PRO na NAS-ie: klucz licencyjny z Polara (sprzedawca – merchant of record) i data końca aktualizacji.
// Po zakupie klient dostaje e-mailem klucz licencyjny: aktualizacje przez 12 miesięcy, aktywacja na 2 urządzeniach.
//   - scripts/upgrade-to-pro.sh aktywuje klucz na tym NAS-ie i dołącza do aktywacji publiczny klucz SSH NAS-a,
//     a sprzedawca dodaje go do prywatnego repozytorium PRO jako klucz tylko do odczytu (deploy key);
//   - scripts/update.sh odświeża datę końca aktualizacji, a po wygaśnięciu kończy bez pobierania – zainstalowana
//     wersja działa dalej;
//   - panel PRO pokazuje datę w Ustawieniach i przypomnienie na Pulpicie.
// Klucz licencyjny i ID aktywacji leżą w .git/poster-pro-license.json (tylko root, obok klucza SSH NAS-a), a panel
// widzi tylko podsumowanie bez klucza: data/panel/license.json. Klucz wklejony w panelu czeka na skrypt w
// data/panel/license-key.json (niżej: „klucz z panelu”). Zapytania idą do publicznego API portalu klienta Polara – działa
// samym kluczem licencyjnym, bez tokenu. Ścieżki i pola API Polara są tylko w tym pliku.
const fs = require('fs');
const path = require('path');
const { PROJECT_URL, PRODUCT_URL, HttpError, fetchJson, writeJsonAtomic, mask } = require('./util');
const { tr, lang } = require('./i18n');

// Polar: produkcja; piaskownica (próba zakupu): POLAR_API_URL=https://sandbox-api.polar.sh
const POLAR_API = 'https://api.polar.sh';
// ID organizacji „Poster App” w Polarze (publiczne, wymagane przez API portalu klienta); puste = sprzedaż PRO
// jeszcze nie ruszyła
const POLAR_ORGANIZATION_ID = '939057b9-df4e-4656-8136-ace9ae0bdf8b';
const STATE_FILE = path.join('.git', 'poster-pro-license.json'); // względem katalogu projektu
const SUMMARY_FILE = 'license.json'; // w katalogu danych panelu (data/panel)
const PANEL_UID = 1000; // użytkownik kontenera panelu (scripts/init-nas.sh)
// Przedłużenie licencji: kasa Polara z produktem „Poster PRO – przedłużenie” i polem license_key przy zakupie – link
// wpisuje w nie końcówkę klucza tego NAS-a, a panel sprzedaży po niej przedłuża ten sam klucz
// (tools/sales/renewals.js). Pusty adres kasy = cennik na stronie produktu w języku panelu.
const RENEW_CHECKOUT_URL = 'https://buy.polar.sh/polar_cl_vNtQIQOE3mI5Ezkicv6CYnBd7hZ5v5aJ3AJ5x1ngNPZ';
const RENEW_FIELD = 'license_key';
const KEY_END = 6; // tyle końcowych znaków klucza pokazuje Polar (****-XXXXXX)
const RENEW_ANCHOR = { pl: '?lang=pl#pricing-pl', en: '?lang=en#pricing' };

// Wynik sprawdzenia licencji – na jego podstawie skrypty wypisują komunikat:
//   ok – licencja ważna; expired – aktualizacje wygasły; inactive – licencja cofnięta (np. po zwrocie) albo wyłączona;
//   invalid – nieznany klucz albo aktywacja (np. zwolnione urządzenie); limit – licencja zajęta na wszystkich
//   urządzeniach; config – brak ID organizacji (sprzedaż nie ruszyła); network – brak połączenia z Polarem albo
//   chwilowa awaria; error – inna odpowiedź Polara (szczegóły w `detail`); none – ten NAS nie ma licencji PRO
const RESULTS = ['ok', 'expired', 'inactive', 'invalid', 'limit', 'config', 'network', 'error', 'none'];

// Końcówka klucza licencyjnego (nie sekret – Polar pokazuje ją w skrócie klucza); '' bez klucza albo przy kluczu
// krótszym niż dwie końcówki – nigdy nie odsłania większości klucza (klucze Polara mają ponad 40 znaków)
function keyEnd(key) {
  const k = typeof key === 'string' ? key.replace(/\s+/g, '') : '';
  return k.length >= 2 * KEY_END ? k.slice(-KEY_END) : '';
}

// Cennik na stronie produktu w języku panelu (zakup PRO)
const pricingUrl = (language) => PRODUCT_URL + (RENEW_ANCHOR[language] || RENEW_ANCHOR.en);

const renewUrl = (language, end = '') =>
  RENEW_CHECKOUT_URL
    ? RENEW_CHECKOUT_URL + (end ? `?custom_field_data.${RENEW_FIELD}=${encodeURIComponent(end)}` : '')
    : pricingUrl(language);

function polarConfig(env = process.env) {
  return {
    api: String(env.POLAR_API_URL || POLAR_API).replace(/\/+$/, ''),
    organizationId: String(env.POLAR_ORGANIZATION_ID || POLAR_ORGANIZATION_ID).trim(),
  };
}

// Błąd z API Polara: {"detail": "tekst"} albo walidacja {"detail": [{"msg": …}]}
function errorDetail(data) {
  const d = data && data.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d))
    return d
      .map((x) => (x && x.msg) || '')
      .filter(Boolean)
      .join('; ');
  return (data && typeof data.error === 'string' && data.error) || '';
}

// Polar odpowiada na nieważny klucz kodem 404 albo 403 – rodzaj problemu mówi treść błędu
function classify(status, detail) {
  if (status === 404 || status === 403) {
    if (/expired/i.test(detail)) return 'expired';
    if (/no longer active|not active|revoked|disabled/i.test(detail)) return 'inactive';
    if (/limit/i.test(detail)) return 'limit';
    if (status === 404) return 'invalid';
  }
  if (status === 429 || status >= 500) return 'network';
  return 'error';
}

// POST do portalu klienta Polara: /v1/customer-portal/license-keys/<activate|validate|deactivate>
async function polar(cfg, endpoint, body) {
  if (!cfg.organizationId) return { result: 'config' };
  let r;
  try {
    r = await fetchJson(`${cfg.api}/v1/customer-portal/license-keys/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': `Poster (+${PROJECT_URL})` },
      body: JSON.stringify({ ...body, organization_id: cfg.organizationId }),
    });
  } catch (e) {
    return { result: 'network', detail: e.message };
  }
  if (r.ok) return { result: 'ok', data: r.data || {} };
  const detail = errorDetail(r.data) || `HTTP ${r.status}`;
  return { result: classify(r.status, detail), detail };
}

const isoOrNull = (v) => {
  const t = Date.parse(v);
  return v && Number.isFinite(t) ? new Date(t).toISOString() : null;
};

// Klucz licencyjny w odpowiedzi Polara: status (granted | revoked | disabled), expires_at (null = bez końca),
// limit_activations (null = bez limitu urządzeń)
function keyInfo(data, now = Date.now()) {
  const k = (data && data.license_key) || data || {};
  const info = {
    status: String(k.status || ''),
    expiresAt: isoOrNull(k.expires_at),
    limit: Number.isInteger(k.limit_activations) ? k.limit_activations : null,
  };
  let result = 'ok';
  if (info.status !== 'granted') result = 'inactive';
  else if (info.expiresAt && Date.parse(info.expiresAt) <= now) result = 'expired';
  return { result, ...info };
}

async function validateActivation(cfg, key, activationId, now) {
  const r = await polar(cfg, 'validate', { key, activation_id: activationId });
  return r.result === 'ok' ? keyInfo(r.data, now) : r;
}

// ------------------------------------------------------------------ stan licencji tego NAS-a
const statePath = (projectDir) => path.join(projectDir, STATE_FILE);

function readState(projectDir) {
  try {
    const s = JSON.parse(fs.readFileSync(statePath(projectDir), 'utf8'));
    return s && typeof s.key === 'string' && s.key ? s : null;
  } catch (e) {
    return null;
  }
}

// Podsumowanie bez klucza: state – active | expired | inactive, updatesUntil – koniec aktualizacji (null = bez końca
// albo jeszcze nieznany), keyEnd – końcówka klucza (karta licencji i link do przedłużenia)
function summaryOf(st, result) {
  let state = 'active';
  if (result === 'expired') state = 'expired';
  else if (result === 'inactive' || result === 'invalid') state = 'inactive';
  return { state, updatesUntil: st.expiresAt || null, checkedAt: st.checkedAt, keyEnd: keyEnd(st.key) };
}

// Zapisuje stan (tylko root) i podsumowanie dla panelu (użytkownik kontenera panelu musi je przeczytać)
function save(projectDir, dataDir, st, result) {
  writeJsonAtomic(statePath(projectDir), st, 0o600);
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, SUMMARY_FILE);
  writeJsonAtomic(file, summaryOf(st, result), 0o640);
  if (process.getuid && process.getuid() === 0) fs.chownSync(file, PANEL_UID, PANEL_UID);
}

// Wyniki bez rozstrzygającej odpowiedzi Polara
const UNVERIFIED = ['network', 'error', 'config'];

// Uzupełnia stan o odpowiedź Polara i zapisuje. Bez rozstrzygającej odpowiedzi zostaje ostatni potwierdzony wynik
// i ostatnia znana data końca aktualizacji, a po jej minięciu wynik to „expired” (Polar dla wygasłego klucza
// zwraca już tylko błąd, bez daty).
function remember(projectDir, dataDir, st, v, now) {
  let result = v.result;
  if ('status' in v) Object.assign(st, { status: v.status, expiresAt: v.expiresAt, limit: v.limit });
  st.checkedAt = new Date(now).toISOString();
  // „wygasła” przed zapisaną datą (np. sprzedawca skrócił licencję) – koniec aktualizacji najpóźniej teraz
  if (result === 'expired' && !(st.expiresAt && Date.parse(st.expiresAt) <= now)) st.expiresAt = st.checkedAt;
  if (!UNVERIFIED.includes(result)) {
    st.result = result;
    st.verifiedAt = st.checkedAt;
  } else if (st.expiresAt && Date.parse(st.expiresAt) <= now) result = 'expired';
  save(projectDir, dataDir, st, UNVERIFIED.includes(result) ? st.result || 'ok' : result);
  return { ...v, result, expiresAt: st.expiresAt || null, limit: st.limit ?? null };
}

// Aktywuje klucz na tym NAS-ie (zajmuje jedno z urządzeń licencji) i zapisuje stan. Ponowne uruchomienie z tym samym
// kluczem i kluczem SSH NAS-a używa zapisanej aktywacji – nie zajmuje drugiego urządzenia. label – nazwa urządzenia
// widoczna dla sprzedawcy (nazwa hosta), sshKey – publiczny klucz SSH NAS-a.
async function activateHere(cfg, { projectDir, dataDir, key, label, sshKey, now = Date.now() }) {
  const prev = readState(projectDir);
  if (prev && prev.key === key && prev.sshKey === sshKey && prev.activationId) {
    const v = await validateActivation(cfg, key, prev.activationId, now);
    if (v.result !== 'invalid') return remember(projectDir, dataDir, prev, v, now);
  } else if (prev && prev.activationId) {
    // inny klucz licencyjny albo nowy klucz SSH NAS-a – zwalniamy poprzednie urządzenie (błąd nie przeszkadza)
    await polar(cfg, 'deactivate', { key: prev.key, activation_id: prev.activationId });
  }
  const a = await polar(cfg, 'activate', { key, label: String(label || 'NAS').slice(0, 60), meta: { ssh_key: sshKey } });
  if (a.result !== 'ok') return a;
  const activationId = String(a.data.id || '');
  if (!activationId) return { result: 'error', detail: tr('brak ID aktywacji w odpowiedzi Polara') };
  const st = { key, activationId, label, sshKey, activatedAt: new Date(now).toISOString() };
  // status i data końca – z walidacji aktywacji, a gdy się nie uda – z odpowiedzi aktywacji (klucz jest ważny,
  // skoro aktywacja przeszła; bez danych klucza data zostaje nieznana do najbliższego scripts/update.sh)
  let v = await validateActivation(cfg, key, activationId, now);
  if (!('status' in v)) v = a.data.license_key ? keyInfo(a.data, now) : { result: 'ok' };
  return remember(projectDir, dataDir, st, v, now);
}

// Odświeża stan zapisanej aktywacji (scripts/update.sh)
async function refresh(cfg, { projectDir, dataDir, now = Date.now() }) {
  const st = readState(projectDir);
  if (!st || !st.activationId) return { result: 'none' };
  return remember(projectDir, dataDir, st, await validateActivation(cfg, st.key, st.activationId, now), now);
}

// ------------------------------------------------------------------ klucz z panelu (przejście na PRO)
// Klucz wklejony w panelu (Ustawienia → Wersja PRO): panel sprawdza go w Polarze bez aktywacji (validate bez
// activation_id – nie zajmuje urządzenia) i zapisuje tymczasowo w data/panel/license-key.json (0600: użytkownik panelu
// i root). Aktywacja zostaje w scripts/upgrade-to-pro.sh – tylko on ma klucz SSH NAS-a i .git/: bierze klucz z pliku
// (license-cli.js activate --pending), aktywuje licencję i usuwa plik. Katalog projektu na hoście zapisuje
// scripts/init-nas.sh w data/panel/install.json – z nim panel pokazuje gotowe polecenie.
const PENDING_FILE = 'license-key.json';
const INSTALL_FILE = 'install.json';
const KEY_RE = /^[\x21-\x7e]{8,200}$/; // klucz ze strony zamówienia: drukowalne znaki ASCII bez spacji
const CHECK_LIMIT = 10; // sprawdzeń klucza w panelu na CHECK_WINDOW
const CHECK_WINDOW = 10 * 60000;

async function checkKey(cfg, key, now = Date.now()) {
  const r = await polar(cfg, 'validate', { key });
  return r.result === 'ok' ? keyInfo(r.data, now) : r;
}

function readPending(dataDir) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(dataDir, PENDING_FILE), 'utf8'));
    return p && typeof p.key === 'string' && KEY_RE.test(p.key) ? p : null;
  } catch (e) {
    return null;
  }
}

function savePending(dataDir, key, v, now) {
  fs.mkdirSync(dataDir, { recursive: true });
  const p = { key, checkedAt: new Date(now).toISOString(), status: v.status, expiresAt: v.expiresAt, limit: v.limit };
  writeJsonAtomic(path.join(dataDir, PENDING_FILE), p, 0o600);
}

const clearPending = (dataDir) => fs.rmSync(path.join(dataDir, PENDING_FILE), { force: true });

// Katalog projektu na hoście (null = nieznany, np. przed pierwszym scripts/update.sh po tej zmianie)
function projectDirOf(dataDir) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(dataDir, INSTALL_FILE), 'utf8')).projectDir;
    return typeof d === 'string' && /^\/[^\0\r\n]*$/.test(d) ? d.replace(/\/+$/, '') || '/' : null;
  } catch (e) {
    return null;
  }
}

// Polecenie przejścia na PRO do skopiowania; ścieżka w apostrofach, gdy ma znaki specjalne powłoki
function upgradeCommand(projectDir) {
  if (!projectDir) return 'sudo bash scripts/upgrade-to-pro.sh';
  const file = `${projectDir.replace(/\/$/, '')}/scripts/upgrade-to-pro.sh`;
  return `sudo bash ${/^[\w./-]+$/.test(file) ? file : `'${file.replace(/'/g, `'\\''`)}'`}`;
}

function checkMessage(v) {
  if (v.result === 'invalid')
    return tr('Nieznany klucz licencyjny – skopiuj go w całości ze strony zamówienia (przycisk „Access purchase” w e-mailu od Polara).');
  if (v.result === 'inactive') return tr('Ta licencja jest nieaktywna (np. po zwrocie płatności).');
  if (v.result === 'expired') return tr('Ta licencja nie obejmuje już aktualizacji – przedłuż ją, a potem sprawdź klucz ponownie.');
  if (v.result === 'config') return tr('Sprzedaż wersji PRO jeszcze nie ruszyła.');
  if (v.result === 'network') return tr('Brak połączenia z serwerem licencji (Polar) – sprawdź internet na NAS-ie i spróbuj ponownie.');
  return tr('Serwer licencji odpowiedział błędem: {0}', v.detail || v.result);
}

// Klucz z panelu dla API (oba wydania): widok bez klucza, sprawdzenie w Polarze z limitem prób, usunięcie
function createLicenseKey(dataDir, { cfg = polarConfig(), now = () => Date.now() } = {}) {
  const checks = [];
  const view = () => {
    const p = readPending(dataDir);
    const projectDir = projectDirOf(dataDir);
    return {
      pending: p && { hint: mask(p.key), checkedAt: p.checkedAt || null, expiresAt: p.expiresAt || null, limit: p.limit ?? null },
      command: upgradeCommand(projectDir),
      projectDir,
      pricingUrl: pricingUrl(lang()),
    };
  };
  return {
    view,
    async check(input) {
      const key = String(input || '').replace(/\s+/g, '');
      if (!KEY_RE.test(key)) throw new HttpError(400, tr('Wklej cały klucz licencyjny ze strony zamówienia w Polarze'));
      const t = now();
      while (checks.length && checks[0] <= t - CHECK_WINDOW) checks.shift();
      if (checks.length >= CHECK_LIMIT) throw new HttpError(429, tr('Za dużo prób – spróbuj za kilka minut'));
      checks.push(t);
      const v = await checkKey(cfg, key, t);
      if (v.result === 'ok') savePending(dataDir, key, v, t);
      const renew = v.result === 'expired' ? { renewUrl: renewUrl(lang(), keyEnd(key)) } : {};
      return { result: v.result, message: v.result === 'ok' ? '' : checkMessage(v), ...renew, ...view() };
    },
    clear() {
      clearPending(dataDir);
      return view();
    },
  };
}

// ------------------------------------------------------------------ panel PRO
// Podsumowanie licencji dla panelu (null = instalacja bez licencji PRO, np. wdrożenie). Stan liczony też z daty:
// po minięciu końca aktualizacji panel pokazuje „wygasły” bez czekania na scripts/update.sh.
function readSummary(dataDir, now = Date.now()) {
  let s;
  try {
    s = JSON.parse(fs.readFileSync(path.join(dataDir, SUMMARY_FILE), 'utf8'));
  } catch (e) {
    return null;
  }
  if (!s || typeof s !== 'object') return null;
  const updatesUntil = isoOrNull(s.updatesUntil);
  let state = ['active', 'expired', 'inactive'].includes(s.state) ? s.state : 'active';
  if (state === 'active' && updatesUntil && Date.parse(updatesUntil) <= now) state = 'expired';
  // podsumowanie sprzed tej zmiany nie ma końcówki – pojawi się po najbliższym scripts/update.sh
  const end = typeof s.keyEnd === 'string' && /^[A-Za-z0-9-]{1,12}$/.test(s.keyEnd) ? s.keyEnd : '';
  return { state, updatesUntil, checkedAt: isoOrNull(s.checkedAt), keyEnd: end };
}

// Licencja w odpowiedziach API panelu PRO: podsumowanie i link do przedłużenia (z końcówką klucza)
function licenseInfo(dataDir, now) {
  const s = readSummary(dataDir, now);
  return s && { ...s, renewUrl: renewUrl(lang(), s.keyEnd) };
}

module.exports = {
  POLAR_API,
  STATE_FILE,
  SUMMARY_FILE,
  PENDING_FILE,
  INSTALL_FILE,
  RESULTS,
  polarConfig,
  pricingUrl,
  renewUrl,
  keyEnd,
  activateHere,
  refresh,
  checkKey,
  polar, // surowe zapytanie i odczyt klucza – dla próby sprzedaży (tools/polar-test.js)
  keyInfo,
  readPending,
  clearPending,
  upgradeCommand,
  createLicenseKey,
  readState,
  readSummary,
  licenseInfo,
};
