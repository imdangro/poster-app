'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { Readable } = require('stream');
const { readLimited, safeEqual, mask, fetchJson, readJsonBody, periodic } = require('../lib/util');

let srv;
let base;
before(async () => {
  // atrapa serwera z kanału RSS: duży plik bez content-length (chunked), mały plik i zawyżony content-length
  srv = http.createServer((req, res) => {
    if (req.url === '/chunked') {
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      let n = 0;
      const t = setInterval(() => {
        if (res.destroyed || ++n > 40) {
          clearInterval(t);
          return res.end();
        }
        res.write(Buffer.alloc(256 * 1024));
      }, 1);
      return;
    }
    if (req.url === '/declared') {
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': String(50 * 1024 * 1024) });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'image/jpeg' });
    res.end(Buffer.alloc(3000, 1));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv.close());

test('readLimited: przerywa pobieranie za dużej odpowiedzi bez content-length', async () => {
  assert.equal(await readLimited(await fetch(`${base}/chunked`), 1024 * 1024), null);
});

test('readLimited: odrzuca zawyżony content-length bez czytania treści', async () => {
  assert.equal(await readLimited(await fetch(`${base}/declared`), 1024 * 1024), null);
});

test('readLimited: zwraca mały plik w całości', async () => {
  const buf = await readLimited(await fetch(`${base}/small`), 1024 * 1024);
  assert.equal(buf.length, 3000);
});

test('safeEqual i mask', () => {
  assert.equal(safeEqual('token-123', 'token-123'), true);
  assert.equal(safeEqual('token-123', 'token-124'), false);
  assert.equal(safeEqual('', ''), false);
  assert.equal(safeEqual(undefined, 'x'), false);
  assert.equal(mask('sekretnyklucz'), '••••lucz');
  assert.equal(mask(''), '');
});

test('fetchJson: odpowiedź większa niż limit to błąd „nie wiadomo” zamiast megabajtów w pamięci panelu', async () => {
  const e = await fetchJson(`${base}/chunked`, { maxBytes: 1024 * 1024 }).catch((x) => x);
  assert.equal(e.status, 502);
  assert.match(e.message, /jest za duża \(ponad 1 MB\)/);
  assert.equal(e.noAnswer, true, 'zapytanie dotarło do serwera');
  const ok = await fetchJson(`${base}/small`, { maxBytes: 1024 * 1024 });
  assert.equal(ok.status, 200);
  assert.equal(ok.text.length, 3000);
});

test('readJsonBody: treść zapytania to obiekt – null, liczba, napis i lista dają błąd 400', async () => {
  const body = (text) => readJsonBody(Readable.from([Buffer.from(text)]));
  assert.deepEqual(await body('{"a":1}'), { a: 1 });
  assert.deepEqual(await readJsonBody(Readable.from([])), {});
  for (const bad of ['null', '5', '"abc"', '[1,2]', '{zle']) {
    await assert.rejects(body(bad), (e) => e.status === 400, bad);
  }
});

test('periodic: błąd zadania trafia do logów, a kolejne takty idą dalej', async () => {
  const errors = [];
  const original = console.error;
  console.error = (...a) => errors.push(a);
  let runs = 0;
  const job = periodic(
    async () => {
      runs++;
      throw new Error('awaria zadania');
    },
    20,
    1,
  );
  try {
    await new Promise((r) => setTimeout(r, 120));
  } finally {
    await job.stop();
    console.error = original;
  }
  assert.ok(runs >= 2, `takty: ${runs}`);
  assert.equal(errors.length, runs);
  assert.equal(errors[0][1].message, 'awaria zadania');
});
