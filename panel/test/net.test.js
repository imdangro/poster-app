'use strict';
// Pobieranie adresów z treści obcych serwerów (panel/lib/net.js): bez sieci lokalnej (SSRF) – adresy prywatne, nazwy
// usług Dockera, inne porty, przekierowania i nazwy, które w chwili połączenia wskazują adres lokalny.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const zlib = require('zlib');
const dns = require('dns');
const { fetchUntrusted, isPublicAddress, guardedLookup } = require('../lib/net');
const { readLimited } = require('../lib/util');

test('adresy IP: publiczny internet albo sieć lokalna (także IPv4 zapisany w IPv6)', () => {
  const cases = {
    '8.8.8.8': true,
    '93.184.216.34': true,
    '172.32.0.1': true,
    '100.128.0.1': true,
    '2606:4700:4700::1111': true,
    '2a00:1450:4001:82a::200e': true,
    '::ffff:8.8.8.8': true,
    '64:ff9b::808:808': true,
    '2002:808:808::1': true,
    '127.0.0.1': false,
    '0.0.0.0': false,
    '10.1.2.3': false,
    '172.17.0.2': false,
    '172.31.255.255': false,
    '192.168.1.1': false,
    '169.254.169.254': false,
    '100.64.0.1': false,
    '224.0.0.1': false,
    '255.255.255.255': false,
    '::1': false,
    '::': false,
    'fe80::1%eth0': false,
    'fd12:3456::1': false,
    'ff02::1': false,
    '::ffff:127.0.0.1': false,
    '::ffff:c0a8:101': false,
    '64:ff9b::10.0.0.1': false,
    '2002:c0a8:101::': false,
    '2001:db8::1': false,
    '[::1]': false,
    'kamera.local': false,
    '': false,
  };
  for (const [ip, want] of Object.entries(cases)) assert.equal(isPublicAddress(ip), want, ip);
});

test('odrzucone przed połączeniem: sieć lokalna, nazwy usług Dockera, inne porty i protokoły', async () => {
  const urls = [
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://0x7f.1/', // zapis szesnastkowy 127.0.0.1
    'http://2130706433/', // 127.0.0.1 jako liczba
    'http://169.254.169.254/latest/meta-data/',
    'http://192.168.1.1/snapshot.jpg',
    'http://[::ffff:192.168.1.1]/',
    'http://n8n:5678/rest/login',
    'http://rsshub/',
    'http://panel:7081/internal/error',
    'http://localhost./',
    'http://kamera.local/snapshot.jpg',
    'http://router.lan/',
    'https://example.com:8443/obraz.jpg',
    'ftp://example.com/plik',
    'file:///etc/passwd',
    'nie adres',
  ];
  for (const u of urls) await assert.rejects(fetchUntrusted(u), (e) => e.blocked === true, u);
  await assert.rejects(fetchUntrusted('http://192.168.1.1/a.jpg'), /192\.168\.1\.1 prowadzi do sieci lokalnej/);
  await assert.rejects(fetchUntrusted('http://example.com:8080/a.jpg'), /port 8080/);
});

// atrapa „bloga na NAS-ie” (zaufany host) i drugi serwer w sieci lokalnej, do którego nic nie może dotrzeć
let blog;
let other;
let otherHits = 0;
const base = () => `http://127.0.0.1:${blog.address().port}`;
before(async () => {
  other = http.createServer((req, res) => {
    otherHits++;
    res.end('sekret');
  });
  blog = http.createServer((req, res) => {
    const to = (location) => {
      res.writeHead(302, { location });
      res.end();
    };
    if (req.url === '/feed.xml') return res.end('<rss><channel><item><title>A</title></item></channel></rss>');
    if (req.url === '/do-sieci') return to(`http://127.0.0.1:${other.address().port}/sekret`);
    if (req.url === '/do-localhost') return to(`http://localhost:${blog.address().port}/feed.xml`);
    if (req.url === '/na-miejscu') return to('/feed.xml');
    if (req.url === '/w-kolko') return to('/w-kolko');
    if (req.url === '/gzip') {
      res.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/html' });
      return res.end(zlib.gzipSync(Buffer.from('<html>spakowana strona</html>')));
    }
    if (req.url === '/wolno') return; // brak odpowiedzi
    res.writeHead(404);
    res.end();
  });
  await Promise.all([blog, other].map((s) => new Promise((r) => s.listen(0, '127.0.0.1', r))));
});
after(() => {
  blog.closeAllConnections();
  blog.close();
  other.close();
});

const text = async (res) => (await readLimited(res, 1e6)).toString('utf8');

test('zaufany host (kanał bota) także w sieci lokalnej; przekierowanie tylko do niego albo do internetu', async () => {
  await assert.rejects(fetchUntrusted(`${base()}/feed.xml`), (e) => e.blocked, 'bez zaufania – sieć lokalna');
  const trust = [`${base()}/feed.xml`];

  const ok = await fetchUntrusted(`${base()}/feed.xml`, { trust });
  assert.equal(ok.status, 200);
  assert.match(await text(ok), /<title>A<\/title>/);

  const moved = await fetchUntrusted(`${base()}/na-miejscu`, { trust });
  assert.equal(moved.url, `${base()}/feed.xml`);
  assert.match(await text(moved), /<rss>/);

  await assert.rejects(fetchUntrusted(`${base()}/do-sieci`, { trust }), (e) => e.blocked && /port/.test(e.message));
  await assert.rejects(fetchUntrusted(`${base()}/do-localhost`, { trust }), (e) => e.blocked);
  assert.equal(otherHits, 0, 'przekierowanie nie dotarło do innego serwera w sieci lokalnej');
  await assert.rejects(fetchUntrusted(`${base()}/w-kolko`, { trust }), /za dużo przekierowań/);

  const packed = await fetchUntrusted(`${base()}/gzip`, { trust });
  assert.equal(packed.headers.get('content-encoding'), null);
  assert.equal(await text(packed), '<html>spakowana strona</html>');

  await assert.rejects(fetchUntrusted(`${base()}/wolno`, { trust, timeout: 300 }), (e) => e.name === 'TimeoutError');
});

test('nazwa, która w chwili połączenia wskazuje sieć lokalną (DNS rebinding), nie przechodzi', async () => {
  const lookup = dns.lookup;
  const answers = {
    'obcy.example': ['127.0.0.1'],
    'mieszany.example': ['93.184.216.34', '10.0.0.5'],
    'publiczny.example': ['93.184.216.34'],
  };
  dns.lookup = (host, opts, cb) => {
    const list = (answers[host] || []).map((address) => ({ address, family: 4 }));
    process.nextTick(() => (list.length ? cb(null, list) : cb(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }))));
  };
  try {
    await assert.rejects(fetchUntrusted('http://obcy.example/zdjecie.jpg'), /obcy\.example prowadzi do sieci lokalnej \(127\.0\.0\.1\)/);
    await assert.rejects(fetchUntrusted('https://mieszany.example/'), /10\.0\.0\.5/);
    // adres publiczny – lookup oddaje go w obu formach wywołania (net.connect z autoSelectFamily prosi o listę)
    const all = await new Promise((r, j) => guardedLookup('publiczny.example', { all: true }, (e, list) => (e ? j(e) : r(list))));
    assert.deepEqual(all, [{ address: '93.184.216.34', family: 4 }]);
    const one = await new Promise((r, j) => guardedLookup('publiczny.example', {}, (e, a, f) => (e ? j(e) : r([a, f]))));
    assert.deepEqual(one, ['93.184.216.34', 4]);
  } finally {
    dns.lookup = lookup;
  }
});
