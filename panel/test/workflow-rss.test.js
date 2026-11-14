'use strict';
// Węzeł n8n „Normalizuj RSS” (workflows/src/code/normalize_rss.js) w piaskownicy z atrapami $() i $input: wpisy
// z cudzych kanałów → wspólny format. Treść wpisu to cudze dane – znaczniki i obrazki czytamy w czasie liniowym
// (wyrażenia w rodzaju /<[^>]*>/g na tysiącach niezamkniętych „<” liczą się kwadratowo i zatrzymują przebieg bota).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CODE = fs.readFileSync(path.join(__dirname, '../../workflows/src/code/normalize_rss.js'), 'utf8');
const tr = (s, ...args) => String(s).replace(/\{(\d+)\}/g, (_, i) => String(args[i]));

function run(items, { site = false, feed = { label: 'Blog', url: 'https://blog.example/feed', kind: 'rss' } } = {}) {
  const nodes = { 'Lista źródeł': [{ json: feed }], Config: [{ json: { site: site ? {} : null } }] };
  const sandbox = {
    $: (name) => ({ all: () => nodes[name], first: () => nodes[name][0], itemMatching: () => nodes[name][0] }),
    $input: { all: () => items.map((json) => ({ json })) },
    tr,
    console,
  };
  const [out] = vm.runInNewContext(`(function () {\n${CODE}\n})`, sandbox)();
  return JSON.parse(JSON.stringify(out.json));
}
const ms = (fn) => {
  const t = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t) / 1e6;
};

test('wpis z kanału: tekst bez znaczników i skryptów, encje, adres bez parametrów śledzących, obrazki', () => {
  const { articles, feedErrors } = run([
    {
      title: 'Nowa <b>palarnia</b> &amp; kawiarnia &#8211; otwarcie',
      link: 'https://www.blog.example/kawa/?utm_source=rss&id=7#komentarze',
      content:
        '<p>Zapraszamy<script>alert("x < y")</script> w sobotę.</p><STYLE>p { color: red }</STYLE>' +
        '<img alt="zdjęcie" data-src="https://cdn.example/leniwe.jpg" src="https://cdn.example/a.jpg?x=1&amp;y=2">' +
        "<img src='https://cdn.example/b.png'><img src=\"data:image/png;base64,AAAA\"><img alt='bez adresu'>",
      enclosure: { url: 'https://cdn.example/okladka.jpg', type: 'image/jpeg' },
      isoDate: '2026-11-10T08:00:00.000Z',
      creator: 'Ola <i>K.</i>',
    },
  ]);
  assert.deepEqual(feedErrors, []);
  assert.equal(articles.length, 1);
  const a = articles[0];
  assert.equal(a.title, 'Nowa palarnia & kawiarnia – otwarcie');
  assert.equal(a.summary, 'Zapraszamy w sobotę.');
  assert.equal(a.author, 'Ola K.');
  assert.equal(a.id, 'blog.example/kawa?id=7');
  assert.equal(a.url, 'https://www.blog.example/kawa/?id=7');
  assert.deepEqual(a.images, ['https://cdn.example/okladka.jpg', 'https://cdn.example/a.jpg?x=1&y=2', 'https://cdn.example/b.png']);
  assert.equal(a.publishedAt, '2026-11-10T08:00:00.000Z');
  assert.equal(a.body, undefined, 'pełna treść tylko dla bota „własna strona”');
  assert.equal(
    run([{ title: 'T', link: 'https://b.example/x', 'content:encoded': '<p>Cały <em>tekst</em></p>' }], { site: true }).articles[0].body,
    'Cały tekst',
  );
});

test('znak „<” bez „>” zostaje w tekście, niezamknięty <script> nie zjada treści (jak dotąd)', () => {
  const [a] = run([
    { title: 'Cena < 5 zł i a<b', link: 'https://b.example/1', content: 'Start <script> bez końca, potem <b>tekst</b>' },
  ]).articles;
  assert.equal(a.title, 'Cena < 5 zł i a<b');
  assert.equal(a.summary, 'Start bez końca, potem tekst');
});

test('wroga treść wpisu (megabajt niezamkniętych znaczników) nie zatrzymuje przebiegu bota', () => {
  const hostile = [
    '<'.repeat(1 << 20),
    '<script '.repeat(150000),
    '<style><script>'.repeat(80000),
    '<img '.repeat(200000),
    '<img src="'.repeat(120000),
    '<img>'.repeat(200000) + ' src="https://x.example/a.jpg"',
    '<img src="a" ' + '<img src="" '.repeat(100000) + '>',
    '<img src="https://x.example/a.jpg" ' + '<img '.repeat(200000),
    '&'.repeat(1 << 20),
  ];
  for (const content of hostile) {
    let out;
    const t = ms(() => {
      out = run([{ title: content, link: 'https://b.example/x', content, 'content:encoded': content, description: content }], {
        site: true,
      });
    });
    assert.equal(out.articles.length, 1);
    assert.ok(t < 3000, `${content.slice(0, 24)}… (${(content.length / 1e6).toFixed(1)} MB): ${t.toFixed(0)} ms`);
  }
});

test('usuwanie znaczników i adresy obrazków dają ten sam wynik co dawne wyrażenia regularne (próba losowa)', () => {
  const a = CODE.indexOf('function stripTags');
  const b = CODE.indexOf('const decode');
  const c = CODE.indexOf('function imgSources');
  const d = CODE.indexOf('// Błąd węzła RSS');
  assert.ok(a > 0 && b > a && c > b && d > c, 'funkcje stripTags i imgSources w kodzie węzła');
  const ctx = {};
  vm.runInNewContext(`${CODE.slice(a, b)}${CODE.slice(c, d)}\nthis.stripTags = stripTags; this.imgSources = imgSources;`, ctx);
  const oldStrip = (s) => s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ');
  const oldImg = (h) => [...h.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => m[1]);
  const atoms = [
    '<',
    '>',
    '<script',
    '</script>',
    '<SCRIPT>',
    '</Script>',
    '<style',
    '</style>',
    '<img',
    ' src="',
    " src='",
    'src=',
    '"',
    "'",
  ];
  atoms.push('a', ' ', 'http://x/y.jpg', '<p>', '</p>', '<scripts', 'İ', '\n', '=', 'data-src="', '<imgx', '/');
  let seed = 20261113;
  const rnd = (n) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  for (let i = 0; i < 40000; i++) {
    let s = '';
    for (let k = 1 + rnd(i % 3 === 0 ? 60 : 14); k > 0; k--) s += atoms[rnd(atoms.length)];
    assert.equal(ctx.stripTags(s), oldStrip(s), JSON.stringify(s));
    assert.deepEqual([...ctx.imgSources(s)], oldImg(s), JSON.stringify(s));
  }
});

test('błąd kanału trafia do raportu, wpis bez adresu jest pomijany', () => {
  const out = run([
    { error: { message: 'ECONNREFUSED', description: 'połączenie odrzucone' } },
    { title: 'Bez linku' },
    { title: 'OK', link: 'https://b.example/ok' },
  ]);
  assert.deepEqual(out.feedErrors, [{ feed: 'Blog', kind: 'rss', error: 'ECONNREFUSED – połączenie odrzucone' }]);
  assert.deepEqual(
    out.articles.map((x) => x.title),
    ['OK'],
  );
});
