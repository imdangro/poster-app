'use strict';
// Znaczniki i elementy z cudzej treści (lib/html.js): wynik jak dotąd, a czas liniowy także na wrogiej stronie.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { esc, tagsOf, elementsOf, firstElement } = require('../lib/html');

// czas w ms; treści mają po ok. 600 kB – tyle panel czyta ze strony artykułu
const timed = (fn) => {
  const t = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t) / 1e6;
};
// Wyrażenia regularne sprzed zmiany potrzebowały na te treści 60–70 s; liniowe przejście – kilku ms. Limit z zapasem
// na wolny serwer CI.
const BUDGET_MS = 1000;

test('esc: znaki HTML i cudzysłów', () => {
  assert.equal(esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

test('tagsOf: znaczniki bez względu na wielkość liter, bez nazw dłuższych i bez znaczników ponad limit', () => {
  const html = '<head><META name="a" content="1"><meta property="b"\n content="2"/><metadata x="1"><meta></head>';
  assert.deepEqual([...tagsOf(html, 'meta')], ['<META name="a" content="1">', '<meta property="b"\n content="2"/>', '<meta>']);
  assert.deepEqual([...tagsOf('<link rel="x"><link ', 'link')], ['<link rel="x">'], 'znacznik bez „>” nie jest znacznikiem');
  assert.deepEqual([...tagsOf(`<meta a="${'x'.repeat(50)}"><meta b="1">`, 'meta', 20)], ['<meta b="1">']);
  assert.deepEqual([...tagsOf(null, 'meta')], []);
});

test('elementsOf: elementy w kolejności dokumentu, najbliższy znacznik zamykający, nazwa bez zamknięcia pominięta', () => {
  const xml = '<rss><item><title>A</title></item><ITEM id="2"><title>B</title></Item><entry>C</entry><item>bez końca';
  assert.deepEqual(
    [...elementsOf(xml, ['item', 'entry'])].map((e) => [e.name, e.inner]),
    [
      ['item', '<title>A</title>'],
      ['item', '<title>B</title>'],
      ['entry', 'C'],
    ],
  );
  assert.equal([...elementsOf(xml, ['item'])][1].outer, '<ITEM id="2"><title>B</title></Item>');
  assert.equal(firstElement('<a><dc:date>2026-01-02</dc:date><updated>x</updated></a>', ['updated', 'dc:date']), '2026-01-02');
  assert.equal(firstElement('<title>bez końca', ['title']), '');
  assert.equal(firstElement('<items>nie ta nazwa</items>', ['item']), '');
});

test('wroga treść: tysiące otwarć bez zamknięcia nie zatrzymują panelu (czas liniowy)', () => {
  const cases = {
    '<meta bez >': () => [...tagsOf('<meta '.repeat(100000), 'meta')],
    '<meta z jednym > na końcu': () => [...tagsOf(`${'<meta '.repeat(100000)}>`, 'meta')],
    '<link bez >': () => [...tagsOf('<link '.repeat(100000), 'link')],
    '<title> bez </title>': () => firstElement('<title>'.repeat(85000), ['title']),
    '<title bez >': () => firstElement('<title '.repeat(85000), ['title']),
    '<item> bez </item>': () => [...elementsOf('<item>'.repeat(100000), ['item', 'entry'])],
    '<item> i <entry> na zmianę, bez zamknięć': () => [...elementsOf('<item><entry>'.repeat(46000), ['item', 'entry'])],
    'wiele małych elementów': () => assert.equal([...elementsOf('<item>x</item>'.repeat(40000), ['item'])].length, 40000),
  };
  for (const [name, run] of Object.entries(cases)) {
    const ms = timed(run);
    assert.ok(ms < BUDGET_MS, `${name}: ${ms.toFixed(0)} ms`);
  }
});
