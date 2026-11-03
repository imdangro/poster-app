'use strict';
// Pobieranie adresów z treści obcych serwerów (zdjęcia z kanałów RSS, strona artykułu i jej og:image, karta linku,
// test kanału) bez dostępu do sieci lokalnej (SSRF): wpis w cudzym kanale nie może kazać panelowi pobrać obrazu
// z kamery w domu, strony routera ani usług Dockera (n8n, RSSHub) i opublikować go w poście.
// - tylko http i https, porty 80 i 443;
// - bez adresów prywatnych, pętli zwrotnej, link-local, CGNAT, ULA i multicast oraz nazw sieci lokalnej (n8n, *.local);
// - każde przekierowanie sprawdzane osobno;
// - adres sprawdzany w chwili połączenia (własny lookup), więc nazwa, która po sprawdzeniu zmieni adres (DNS
//   rebinding), też nie trafi do sieci lokalnej.
// Zaufane są hosty ustawione przez użytkownika (kanały RSS bota, adres wpisany w teście kanału) i adresy platform
// (UPSTREAM) – dla nich bez ograniczeń, np. własny blog na NAS-ie.
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const zlib = require('zlib');
const { Readable, pipeline } = require('stream');
const { tr } = require('./i18n');

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
// nazwy, które nigdy nie są publiczne (domeny zarezerwowane i typowe nazwy sieci domowych)
const LOCAL_NAMES = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|home\.arpa)$/;

// Zakresy adresów spoza publicznego internetu
const RANGES = [
  ['0.0.0.0', 8], // „ta sieć” (0.0.0.0 to w Linuksie także localhost)
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT (też Tailscale)
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local (także metadane chmury)
  ['172.16.0.0', 12], // m.in. sieci Dockera
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // zarezerwowane i rozgłoszeniowy 255.255.255.255
  ['::', 96], // nieokreślony, pętla zwrotna ::1 i dawne IPv4-compatible
  ['::ffff:0:0:0', 96], // IPv4-translated (SIIT)
  ['64:ff9b:1::', 48], // NAT64 do użytku lokalnego
  ['100::', 64],
  ['2001::', 32], // Teredo
  ['2001:db8::', 32],
  ['fc00::', 7], // ULA
  ['fe80::', 10], // link-local
  ['fec0::', 10],
  ['ff00::', 8], // multicast
].map(([ip, bits]) => {
  const { v, n } = parseIp(ip);
  const size = v === 4 ? 32 : 128;
  return { v, base: n >> BigInt(size - bits), shift: BigInt(size - bits) };
});

// Adres IP → { v: 4 | 6, n: BigInt } albo null
function parseIp(raw) {
  const ip = String(raw)
    .replace(/^\[|\]$/g, '')
    .replace(/%.*$/, '');
  const v = net.isIP(ip);
  if (v === 4) return { v, n: ip.split('.').reduce((a, x) => (a << 8n) + BigInt(Number(x)), 0n) };
  if (v !== 6) return null;
  let s = ip.toLowerCase();
  const tail = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/); // końcówka w zapisie IPv4, np. ::ffff:192.168.1.1
  if (tail) {
    const n4 = parseIp(tail[2]).n;
    s = `${tail[1]}${(n4 >> 16n).toString(16)}:${(n4 & 0xffffn).toString(16)}`;
  }
  const [head, rest] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = rest === undefined ? null : rest ? rest.split(':') : [];
  const groups = t === null ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return { v, n: groups.reduce((a, g) => (a << 16n) + BigInt(parseInt(g, 16)), 0n) };
}

// Czy adres IP leży w publicznym internecie (IPv4 zapisany w IPv6 – zmapowany, NAT64, 6to4 – liczy się jak IPv4)
function isPublicAddress(raw) {
  const ip = parseIp(raw);
  if (!ip) return false;
  if (ip.v === 6) {
    const embedded =
      ip.n >> 32n === 0xffffn || ip.n >> 32n === 0x64ff9b0000000000000000n
        ? ip.n & 0xffffffffn // ::ffff:a.b.c.d i 64:ff9b::a.b.c.d
        : ip.n >> 112n === 0x2002n
          ? (ip.n >> 80n) & 0xffffffffn // 6to4: 2002:AABB:CCDD::
          : null;
    if (embedded !== null) return isPublicAddress([24n, 16n, 8n, 0n].map((s) => (embedded >> s) & 0xffn).join('.'));
  }
  return !RANGES.some((r) => r.v === ip.v && ip.n >> r.shift === r.base);
}

// Błąd „adres poza zasięgiem” – bez kodu systemowego, więc komunikat trafia wprost do użytkownika (test kanału)
function blocked(message) {
  const e = new Error(message);
  e.blocked = true;
  return e;
}

// dns.lookup, który odrzuca nazwę wskazującą choć jeden adres spoza publicznego internetu – sprawdzane przy każdym
// połączeniu, czyli z adresem, z którym panel naprawdę się łączy
function guardedLookup(hostname, options, callback) {
  if (typeof options === 'function') [callback, options] = [options, {}];
  if (typeof options === 'number') options = { family: options };
  dns.lookup(hostname, { ...options, all: true }, (err, list) => {
    if (err) return callback(err);
    const bad = (list || []).find((a) => !isPublicAddress(a.address));
    if (bad || !list || !list.length)
      return callback(blocked(tr('{0} prowadzi do sieci lokalnej ({1})', hostname, bad ? bad.address : '?')));
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

// Hosty (z portem) zaufanych adresów: podanych przez wywołującego i platform (UPSTREAM – w testach atrapy lokalne)
function trustedHosts(list) {
  const { UPSTREAM } = require('./accounts');
  const out = new Set();
  for (const raw of [...Object.values(UPSTREAM), ...(list || [])]) {
    try {
      out.add(new URL(String(raw)).host.toLowerCase());
    } catch (e) {}
  }
  return out;
}

function checkUrl(raw, trusted) {
  let u;
  try {
    u = new URL(String(raw));
  } catch (e) {
    throw blocked(tr('niepoprawny adres: {0}', String(raw).slice(0, 100)));
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw blocked(tr('{0} – tylko adresy http i https', u.protocol));
  if (trusted.has(u.host.toLowerCase())) return { u, trusted: true };
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (u.port && u.port !== '80' && u.port !== '443')
    throw blocked(tr('{0} – port {1} (Poster pobiera tylko z portów 80 i 443)', host, u.port));
  if (net.isIP(host) ? !isPublicAddress(host) : !host.includes('.') || LOCAL_NAMES.test(host))
    throw blocked(tr('{0} prowadzi do sieci lokalnej', host));
  return { u, trusted: false };
}

function get(u, headers, signal, trusted) {
  return new Promise((resolve, reject) => {
    const req = (u.protocol === 'https:' ? https : http).request(
      u,
      {
        method: 'GET',
        headers: { 'accept-encoding': 'gzip, br', ...headers },
        signal,
        agent: false, // bez wspólnych połączeń – każde przechodzi przez sprawdzenie adresu
        ...(trusted ? {} : { lookup: guardedLookup }),
      },
      resolve,
    );
    req.on('error', (e) => reject(signal.aborted ? signal.reason : e));
    req.end();
  });
}

// Odpowiedź w kształcie fetch() (ok, status, url, headers, body jako ReadableStream) – rozpakowana z gzip / br
function response(res, url) {
  const encoding = String(res.headers['content-encoding'] || '')
    .trim()
    .toLowerCase();
  const decode = { gzip: zlib.createGunzip, 'x-gzip': zlib.createGunzip, br: zlib.createBrotliDecompress }[encoding];
  const headers = new Headers();
  for (const [k, v] of Object.entries(res.headers)) {
    if (decode && (k === 'content-encoding' || k === 'content-length')) continue;
    try {
      headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
    } catch (e) {}
  }
  const stream = decode ? pipeline(res, decode(), () => {}) : res;
  return { ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, url, headers, body: Readable.toWeb(stream) };
}

// GET adresu z treści obcego serwera. trust – adresy (URL), których hosty wolno pobierać bez ograniczeń.
// Odrzuca (błąd z blocked = true) adres w sieci lokalnej, na innym porcie niż 80/443 i inny niż http(s).
async function fetchUntrusted(url, { headers = {}, timeout = 15000, trust = [], redirects = 5 } = {}) {
  const trusted = trustedHosts(trust);
  const signal = AbortSignal.timeout(timeout);
  let current = url;
  for (let hop = 0; ; hop++) {
    const target = checkUrl(current, trusted);
    const res = await get(target.u, headers, signal, target.trusted);
    const location = res.headers.location;
    if (!REDIRECTS.has(res.statusCode) || !location) return response(res, target.u.href);
    res.resume();
    if (hop >= redirects) throw new Error(tr('za dużo przekierowań ({0})', target.u.host));
    try {
      current = new URL(location, target.u).href;
    } catch (e) {
      throw blocked(tr('niepoprawne przekierowanie: {0}', String(location).slice(0, 100)));
    }
  }
}

module.exports = { fetchUntrusted, isPublicAddress, guardedLookup };
