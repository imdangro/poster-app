'use strict';
// Test kanału RSS/Atom (przycisk „Sprawdź” przy źródle bota) na lokalnej atrapie – bez internetu.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { testFeed } = require('../lib/feeds');

// atrapa: ścieżka → [status, treść]; adres wpisany w teście kanału jest zaufany, więc 127.0.0.1 jest dozwolony
async function withServer(pages, fn) {
  const srv = http.createServer((req, res) => {
    const [status, body] = pages[req.url] || [404, 'brak'];
    res.writeHead(status, { 'content-type': 'text/xml; charset=utf-8' });
    res.end(body);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    return await fn(`http://127.0.0.1:${srv.address().port}`);
  } finally {
    srv.close();
  }
}

const RSS = `<?xml version="1.0"?><rss><channel><title>Blog</title>
  <item><title><![CDATA[Pierwszy &amp; <b>ważny</b>]]></title><link>https://a.example/1</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate></item>
  <item><title>Drugi</title><description>Opis <title>w opisie</title></description><pubDate>Tue, 03 Nov 2026 12:30:00 GMT</pubDate></item>
  </channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title>
  <entry><title type="html">Wpis A</title><updated>2026-11-01T08:00:00Z</updated></entry>
  <ENTRY><title>Wpis B</title><published>2026-11-04T09:00:00Z</published></ENTRY>
  <entry><title>Wpis C</title><updated>2026-10-30T09:00:00Z</updated></entry></feed>`;

test('kanał RSS i Atom: liczba wpisów, pierwsze tytuły i data najnowszego wpisu', async () => {
  await withServer({ '/rss': [200, RSS], '/atom': [200, ATOM] }, async (base) => {
    let r = await testFeed(`${base}/rss`);
    assert.deepEqual(
      { ok: r.ok, count: r.count, titles: r.titles, newest: r.newest },
      { ok: true, count: 2, titles: ['Pierwszy & ważny', 'Drugi'], newest: '2026-11-03T12:30:00.000Z' },
    );
    assert.equal(r.message, 'OK – 2 wpisy');
    r = await testFeed(`${base}/atom`);
    assert.deepEqual(r.titles, ['Wpis A', 'Wpis B', 'Wpis C']);
    assert.equal(r.count, 3);
    assert.equal(r.newest, '2026-11-04T09:00:00.000Z');
  });
});

test('strona WWW zamiast kanału: kanał wskazany przez <link rel="alternate">, błąd HTTP z początkiem treści', async () => {
  const page = `<!doctype html><html><head><link rel="stylesheet" href="/s.css">
    <link rel="alternate" type="application/rss+xml" href="/comments/feed/"><LINK rel="alternate" type="application/rss+xml" href="/rss"></head></html>`;
  await withServer(
    { '/': [200, page], '/rss': [200, RSS], '/blad': [503, `<html><body><h1>Serwis   niedostępny</h1>${'<p>'.repeat(5000)}`] },
    async (base) => {
      const r = await testFeed(`${base}/`);
      assert.equal(r.ok, true);
      assert.equal(r.discovered, `${base}/rss`);
      assert.equal(r.count, 2);
      assert.equal((await testFeed(`${base}/blad`)).message, 'HTTP 503: Serwis niedostępny');
      assert.match((await testFeed(`${base}/brak`)).message, /^HTTP 404: brak$/);
    },
  );
});

test('wrogi kanał (megabajty otwartych znaczników) nie zatrzymuje panelu', async () => {
  // przed zmianą wyrażenia regularne liczyły się na takiej treści kwadratowo – przy 10 MB godzinami
  const big = 3 * 1024 * 1024;
  const fill = (chunk) => chunk.repeat(Math.floor(big / chunk.length));
  const pages = {
    '/items': [200, fill('<item>')],
    '/mixed': [200, fill('<item><entry>')],
    '/titles': [200, `<rss><item>${fill('<title>')}</item><item>${fill('<pubDate>')}</item></rss>`],
    '/cdata': [200, `<rss><item><title>${fill('<![CDATA[')}</title></item></rss>`],
    '/links': [200, `<!doctype html><html>${fill('<link ')}`],
    '/error': [500, fill('<')],
    '/many': [200, `<rss>${'<item><title>x</title><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate></item>'.repeat(100000)}</rss>`],
  };
  await withServer(pages, async (base) => {
    for (const path of Object.keys(pages)) {
      const t = Date.now();
      const r = await testFeed(`${base}${path}`);
      const ms = Date.now() - t;
      assert.ok(ms < 4000, `${path}: ${ms} ms`);
      assert.equal(typeof r.message, 'string');
    }
    assert.equal((await testFeed(`${base}/many`)).count, 100000, 'bardzo dużo wpisów – bez przepełnienia stosu');
  });
});
