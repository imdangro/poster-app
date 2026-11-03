'use strict';
// Czat draftów w grupie bez listy administratorów (Ustawienia → Telegram): drafty może zatwierdzić każdy uczestnik
// grupy, więc panel ostrzega przy bocie; w PRO /post (dowolny tekst na kontach marki) działa w grupie tylko dla osób
// z listy. Atrapa API Telegrama; aktualizacje przekazujemy wprost do telegram.handle().
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Store } = require('../lib/store');
const { Runner } = require('../lib/runner');
const { Telegram } = require('../lib/telegram');
const { tmpDir } = require('./helpers');

const GROUP = '-1001234';
const calls = [];
let mock;
before(async () => {
  mock = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const method = (req.url.match(/^\/bot[^/]+\/(\w+)$/) || [])[1];
      calls.push({ method, body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {} });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: method === 'sendMessage' ? { message_id: 900 } : true }));
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  require('../lib/accounts').UPSTREAM.telegram = `http://127.0.0.1:${mock.address().port}`;
});
after(() => mock.close());

function setup({ chatId = GROUP, admins = [] } = {}) {
  calls.length = 0;
  const store = new Store(tmpDir());
  store.secrets.global.telegramBotToken = '123:abc';
  store.updateGlobal({ telegram: { chatId, adminIds: admins } });
  const bot = store.addBot({ name: 'Kawiarnia' });
  const filesDir = tmpDir();
  const published = [];
  const telegram = new Telegram(store, { filesDir, onPublish: async (draft, ctx) => published.push(ctx), onReject: async () => {} });
  return { store, bot: () => store.bot(bot.id), telegram, filesDir, published };
}
const OPEN = /czat draftów to grupa bez listy administratorów – drafty może zatwierdzić każdy jej uczestnik/;

test('panel ostrzega, gdy czat draftów to grupa bez listy administratorów', () => {
  let ctx = setup();
  assert.ok(new Runner(ctx.store, {}).warnings(ctx.bot()).some((w) => OPEN.test(w)));
  ctx = setup({ admins: ['5'] });
  assert.ok(!new Runner(ctx.store, {}).warnings(ctx.bot()).some((w) => OPEN.test(w)), 'z listą administratorów – bez ostrzeżenia');
  ctx = setup({ chatId: '123456789' });
  assert.ok(!new Runner(ctx.store, {}).warnings(ctx.bot()).some((w) => OPEN.test(w)), 'czat prywatny z botem – bez ostrzeżenia');
});

test('✅ w grupie bez listy administratorów działa dalej (zatwierdza draft przygotowany przez bota)', async () => {
  const { telegram, filesDir, published } = setup();
  fs.writeFileSync(path.join(filesDir, 'd1.json'), JSON.stringify({ draftId: 'd1', status: 'draft' }));
  await telegram.handle({
    update_id: 1,
    callback_query: {
      id: 'q1',
      data: 'pub:d1',
      from: { id: 77, first_name: 'Ola' },
      message: { message_id: 5, chat: { id: Number(GROUP), type: 'supergroup' } },
    },
  });
  assert.equal(published.length, 1);
  assert.equal(published[0].draftId, 'd1');
});
