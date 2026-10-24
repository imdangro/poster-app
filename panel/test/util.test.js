'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { readLimited, safeEqual, mask } = require('../lib/util');

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
