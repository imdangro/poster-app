'use strict';
// Węzły n8n „Parsuj draft” i „Podsumowanie publikacji” (workflows/src/code/parse_draft.js, summary.js) w piaskownicy
// z atrapami $() – niepewna publikacja: brak odpowiedzi platformy daje wynik „nie wiadomo”, 🔁 go pomija, a decyzja
// w Telegramie wysyła post ponownie (retry) albo zapisuje go jako opublikowany (confirm).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = (file) => fs.readFileSync(path.join(__dirname, '../../workflows/src/code', file), 'utf8');
const PARSE = code('parse_draft.js');
const SUMMARY = code('summary.js');
const tr = (s, ...args) => String(s).replace(/\{(\d+)\}/g, (_, i) => String(args[i]));
const node = (json, isExecuted = true) => ({ isExecuted, first: () => ({ json }) });
// obiekty z piaskownicy mają własne prototypy – porównujemy kopie
const plain = (v) => JSON.parse(JSON.stringify(v));

// błędy węzła HTTP Request n8n (onError: continueRegularOutput) – kształt z n8n 2.40
const TIMEOUT = { error: { message: 'timeout of 60000ms exceeded', name: 'AxiosError', code: 'ECONNABORTED' } };
const GATEWAY_504 = {
  error: { message: '504 - "{\\"error\\":{\\"message\\":\\"Brak odpowiedzi od graph.facebook.com: UND_ERR_SOCKET\\"}}"', status: 504 },
};
const DUPLICATE = {
  error: { message: '403 - "{\\"detail\\":\\"You are not allowed to create a Tweet with duplicate content.\\"}"', status: 403 },
};
const REFUSED = { error: { message: 'connect ECONNREFUSED 172.18.0.3:7081', name: 'Error', code: 'ECONNREFUSED' } };

const CFG = { botName: 'Kawiarnia', runId: 'r1', botId: 'b1', enableX: true, enableFacebook: true };

async function parseDraft(draft, unknown = '', cfg = {}) {
  const nodes = { Config: node({ ...CFG, ...cfg }), 'Kontekst publikacji': node({ draftId: draft.draftId, unknown }) };
  const fn = vm.runInNewContext(`(async function () {\n${PARSE}\n})`, { $: (n) => nodes[n], tr, Buffer });
  const [item] = await fn.call({ helpers: { getBinaryDataBuffer: async () => Buffer.from(JSON.stringify(draft)) } });
  return plain(item.json);
}

// outputs: wyniki węzłów publikujących; węzły bez wpisu – niewykonane
function summary(parsed, outputs = {}, unknown = '', cfg = {}) {
  const nodes = {
    Config: node({ ...CFG, ...cfg }),
    'Kontekst publikacji': node({ draftId: parsed.draftId, chatId: 7, messageId: 9, approvedBy: '@ania', via: 'telegram', unknown }),
    'Parsuj draft': node(parsed),
  };
  for (const [name, json] of Object.entries(outputs)) nodes[name] = node(json);
  const [item] = vm.runInNewContext(`(function () {\n${SUMMARY}\n})()`, { $: (n) => nodes[n] || node(null, false), tr, Buffer });
  const saved = JSON.parse(Buffer.from(item.binary.draft.data, 'base64').toString('utf8'));
  const buttons = item.json.markupBody.reply_markup.inline_keyboard.map((row) => row.map((b) => b.callback_data));
  return plain({ ...item.json, saved, buttons, text: item.json.reportBody.text });
}

const DRAFT = {
  draftId: 'd1',
  news: { title: 'Nowa sala', url: 'https://kawiarnia.example/sala' },
  post_x: 'Post X',
  post_fb_insta: 'Post FB',
};

test('brak odpowiedzi X (przekroczony czas) – „nie wiadomo” z przyciskami decyzji; odrzucenie przez Facebook – zwykły błąd', async () => {
  const parsed = await parseDraft(DRAFT);
  assert.deepEqual([parsed.todo.x, parsed.todo.facebook], [true, true]);
  const r = summary(parsed, {
    'X: opublikuj post': TIMEOUT,
    'Facebook: opublikuj tekst/link': { error: { message: '400 - "Invalid OAuth access token"', status: 400 } },
  });
  assert.equal(r.status, 'unknown');
  assert.deepEqual(r.results.x, { ok: false, error: 'X: opublikuj post: timeout of 60000ms exceeded', at: r.results.x.at, unknown: true });
  assert.equal(r.results.facebook.unknown, undefined);
  assert.match(r.text, /^⚠️ <b>Nie wiadomo, czy opublikowano<\/b>/);
  assert.match(r.text, /🐦 X: ⚠️ brak odpowiedzi – post mógł się opublikować \(X: opublikuj post: timeout of 60000ms exceeded\)/);
  assert.match(r.text, /📘 Facebook: ❌ /);
  assert.match(r.text, /👀 Sprawdź profil/);
  assert.deepEqual(r.buttons, [
    ['puc:d1', 'pua:d1'],
    ['pub:d1', 'rej:d1'],
  ]);
  assert.equal(r.saved.status, 'unknown');
  assert.equal(r.saved.results.x.unknown, true);
});

test('504 z bramki – „nie wiadomo”; brak połączenia z panelem i odrzucony duplikat – zwykły błąd; częściowa publikacja', async () => {
  const parsed = await parseDraft(DRAFT);
  const r = summary(parsed, { 'X: opublikuj post': { data: { id: '42' } }, 'Facebook: opublikuj tekst/link': GATEWAY_504 });
  assert.equal(r.status, 'partial');
  assert.equal(r.results.x.ok, true);
  assert.equal(r.results.facebook.unknown, true);
  // treść błędu z JSON-u odpowiedzi, bez cudzysłowów i ukośników
  assert.equal(r.results.facebook.error, 'Facebook: opublikuj tekst/link: 504 – Brak odpowiedzi od graph.facebook.com: UND_ERR_SOCKET');
  // nic nie zawiodło na pewno – bez „Ponów nieudane”
  assert.deepEqual(r.buttons, [['puc:d1', 'pua:d1'], ['rej:d1']]);

  for (const out of [REFUSED, DUPLICATE]) {
    const f = summary(parsed, { 'X: opublikuj post': out, 'Facebook: opublikuj tekst/link': { id: '1_2' } });
    assert.equal(f.status, 'partial');
    assert.equal(f.results.x.unknown, undefined, JSON.stringify(f.results.x));
    assert.deepEqual(f.buttons, [['pub:d1', 'rej:d1']]);
  }
  const dup = summary(parsed, { 'X: opublikuj post': DUPLICATE, 'Facebook: opublikuj tekst/link': { id: '1_2' } });
  assert.equal(dup.results.x.error, 'X: opublikuj post: 403 – You are not allowed to create a Tweet with duplicate content.');
});

test('🔁 pomija niepewne platformy; „📤 Nie ma – wyślij” wysyła je ponownie; „✅ Jest na profilu” zapisuje bez publikacji', async () => {
  const draft = {
    ...DRAFT,
    status: 'unknown',
    results: {
      x: { ok: false, unknown: true, error: 'X: opublikuj post: timeout of 60000ms exceeded' },
      facebook: { ok: false, error: 'Facebook: 400' },
    },
  };
  const plain = await parseDraft(draft);
  assert.deepEqual([plain.todo.x, plain.todo.facebook], [false, true]);
  const retry = await parseDraft(draft, 'retry');
  assert.deepEqual([retry.todo.x, retry.todo.facebook], [true, true]);
  const confirm = await parseDraft(draft, 'confirm');
  assert.deepEqual([confirm.todo.x, confirm.todo.facebook], [false, false]);

  // potwierdzenie: X opublikowany (bez linku), Facebook nadal do ponowienia
  const c = summary(confirm, {}, 'confirm');
  assert.deepEqual(c.results.x, { ok: true, confirmed: true, note: 'potwierdzone ręcznie', at: c.results.x.at });
  assert.equal(c.status, 'partial');
  assert.match(c.text, /🐦 X: ✅ potwierdzone ręcznie/);
  assert.deepEqual(c.buttons, [['pub:d1', 'rej:d1']]);

  // po ponownym wysłaniu obu platform – opublikowano
  const done = summary(retry, { 'X: opublikuj post': { data: { id: '43' } }, 'Facebook: opublikuj tekst/link': { id: '1_3' } }, 'retry');
  assert.equal(done.status, 'published');
  assert.deepEqual(done.buttons, [['noop']]);
  assert.equal(done.results.x.url, 'https://x.com/i/status/43');
});

test('platforma włączona po powstaniu draftu (draft nie ma jej tekstu) – pominięta z powodem, status według pozostałych', async () => {
  const parsed = await parseDraft({ ...DRAFT, post_x: '', post_x_link: '' });
  assert.deepEqual([parsed.todo.x, parsed.noText.x, parsed.todo.facebook, parsed.noText.facebook], [false, true, true, false]);
  const r = summary(parsed, { 'Facebook: opublikuj tekst/link': { id: '1_2' } });
  assert.equal(r.status, 'published');
  assert.match(r.text, /🐦 X: ⏭️ pominięto – draft nie ma tekstu dla tej platformy \(powstał, gdy była wyłączona\)/);
  assert.match(r.text, /📘 Facebook: ✅ /);
  assert.deepEqual(r.buttons, [['noop']]);
  assert.equal(r.saved.noText, undefined, 'informacja tylko dla tej publikacji – nie w pliku draftu');
});
