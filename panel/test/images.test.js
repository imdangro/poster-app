'use strict';
// Grafika do posta wg trybu bota. Zdjęcia ze źródła tylko z lokalnej atrapy (kanał bota) – bez internetu.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { Images, pageMeta } = require('../lib/images');
const { defaultBot } = require('../lib/store');
const { tmpDir } = require('./helpers');

// Nagłówek PNG o podanych wymiarach – wystarcza do rozpoznania typu i wymiarów
function png(width, height, size = 4000) {
  const b = Buffer.alloc(size);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

test('zdjęcie ze źródła z sieci lokalnej tylko z hostu kanału bota; inne – pominięte z ostrzeżeniem', async () => {
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url === '/zdjecie.png') return res.end(png(1200, 630));
    if (req.url === '/artykul')
      return res.end(`<html><head><meta property="og:image" content="http://192.168.1.20/snapshot.jpg"></head></html>`);
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const images = new Images({ state: {}, saveState() {} }, { record() {} }, { dataDir: tmpDir() });
    const bot = defaultBot('abc123', 'Blog');
    const news = { url: 'http://kamera.local/artykul', images: [`${base}/zdjecie.png`] };
    let r = await images.resolve(bot, { news });
    assert.notEqual(r.source, 'source');
    assert.ok(
      r.warnings.some((w) => /^pominięto adres z kanału: 127\.0\.0\.1 – port/.test(w)),
      r.warnings.join(' | '),
    );
    assert.ok(r.warnings.some((w) => /^pominięto adres z kanału: kamera\.local prowadzi do sieci lokalnej/.test(w)));
    assert.equal(hits.length, 0, 'panel nie połączył się z siecią lokalną');

    // kanał RSS bota na tym samym hoście (np. blog na NAS-ie) – jego zdjęcia i strony są zaufane
    bot.sources.rss = [{ label: 'Blog', url: `${base}/feed.xml` }];
    r = await images.resolve(bot, { news: { url: `${base}/artykul`, images: [`${base}/zdjecie.png`] } });
    assert.equal(r.source, 'source');
    assert.equal(r.width, 1200);
    // og:image strony zaufanego hostu wskazuje inny adres w sieci lokalnej – pominięty
    r = await images.resolve(defaultBot('def456', 'Blog'), { news: { url: `${base}/artykul` } });
    assert.notEqual(r.source, 'source');
    bot.id = 'ghi789';
    r = await images.resolve(bot, { news: { url: `${base}/artykul` } });
    assert.ok(r.warnings.includes('pominięto adres z kanału: 192.168.1.20 prowadzi do sieci lokalnej'), r.warnings.join(' | '));
  } finally {
    srv.close();
  }
});

test('grafika: bez zdjęcia w źródle – post bez grafiki', async () => {
  const images = new Images({ state: {}, saveState() {} });
  const bot = defaultBot('abc123', 'Kawiarnia');
  const r = await images.resolve(bot, { news: {} });
  assert.equal(r.source, 'none');
  assert.deepEqual(r.warnings, ['brak odpowiedniego zdjęcia w źródle']);
  bot.content.imageMode = 'none';
  assert.deepEqual((await images.resolve(bot, { news: {} })).warnings, []);
});

// strona artykułu z lokalnej atrapy (adres zaufany tylko po to, żeby test mógł ją pobrać z 127.0.0.1)
async function withPage(html, fn) {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/artykul`;
  try {
    return await fn(url);
  } finally {
    srv.close();
  }
}

test('znaczniki strony artykułu: tytuł, opis i zdjęcia (og:, twitter:, link rel=image_src, <title>)', async () => {
  const html = `<!doctype html><html><head>
    <TITLE>Tytuł strony &amp; reszta</TITLE>
    <meta name="description" content="Opis z meta">
    <meta property="og:image" content="/img/og.jpg?a=1&amp;b=2">
    <meta name='twitter:image' content='https://cdn.example.com/tw.jpg'>
    <meta property="og:image" content="/img/drugi.jpg">
    <link rel="stylesheet" href="/s.css"><link rel="image_src" href="/img/src.jpg">
    </head><body></body></html>`;
  await withPage(html, async (url) => {
    const base = url.replace('/artykul', '');
    const m = await pageMeta(url, { trust: [url] });
    assert.equal(m.title, 'Tytuł strony & reszta');
    assert.equal(m.description, 'Opis z meta');
    assert.deepEqual(m.images, [`${base}/img/og.jpg?a=1&b=2`, 'https://cdn.example.com/tw.jpg', `${base}/img/src.jpg`]);
  });
  // og:title ma pierwszeństwo przed <title>; <title> z innymi znacznikami w środku (np. rysunek SVG) nie jest tytułem
  await withPage('<head><svg><title><b>ikona</b></title></svg><title>Prawdziwy</title></head>', async (url) => {
    assert.equal((await pageMeta(url, { trust: [url] })).title, 'Prawdziwy');
  });
  await withPage('<head><title>Strona</title><meta property="og:title" content="Z og"></head>', async (url) => {
    assert.equal((await pageMeta(url, { trust: [url] })).title, 'Z og');
  });
});

test('wroga strona artykułu (600 kB otwartych znaczników) nie zatrzymuje panelu', async () => {
  // przed zmianą jedna taka strona blokowała pętlę zdarzeń panelu na ponad minutę – harmonogram, Telegram i /healthz
  for (const chunk of ['<meta ', '<link ', '<title ', '<title>']) {
    await withPage(`<html><head>${chunk.repeat(Math.floor(600000 / chunk.length))}`, async (url) => {
      const t = Date.now();
      const m = await pageMeta(url, { trust: [url] });
      const ms = Date.now() - t;
      assert.deepEqual(m, { title: '', description: '', images: [] });
      assert.ok(ms < 2000, `${chunk}: ${ms} ms`);
    });
  }
});
