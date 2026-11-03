'use strict';
// Jedna publikacja na draft: drugie kliknięcie ✅ (podwójne tapnięcie, dwóch administratorów), zanim skończy się pierwsza
// publikacja, nie uruchamia drugiej – X, Facebook, Instagram i TikTok publikuje n8n bez własnej blokady, więc dwa
// zlecenia oznaczałyby dwa posty. Prawdziwy serwer panelu z odbiorem wiadomości (getUpdates) i atrapami API Telegrama
// oraz webhooka n8n; do tego sama reguła „publikacja w toku” (runner.publishing).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Store } = require('../lib/store');
const { Runner } = require('../lib/runner');
const { tmpDir, freePort, waitFor } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const TOKEN = 'test-internal-token-1234567890';
const CHAT = -100555;
const BOT = 'bot001';
const DRAFT = 'd20261102-1200-abcd';
let proc;
let logs = '';
let mock;
let internal;
let updates = []; // następna paczka aktualizacji dla getUpdates
const telegramCalls = [];
const n8nJobs = [];

before(async () => {
  mock = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const send = (obj) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.url === '/webhook/poster') {
        n8nJobs.push(JSON.parse(body));
        return send({ ok: true, executionId: n8nJobs.length });
      }
      const m = req.url.match(/^\/bot[^/]+\/(\w+)$/);
      if (!m) {
        res.writeHead(404);
        return res.end('{}');
      }
      telegramCalls.push({ method: m[1], params: body ? JSON.parse(body) : {} });
      if (m[1] === 'getMe') return send({ ok: true, result: { id: 42, username: 'poster_test_bot', is_bot: true } });
      if (m[1] === 'getUpdates') {
        const batch = updates;
        updates = [];
        if (batch.length) return send({ ok: true, result: batch });
        return setTimeout(() => send({ ok: true, result: [] }), 100);
      }
      return send({ ok: true, result: true });
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const dataDir = tmpDir();
  const filesDir = tmpDir();
  // bot z czatem draftów i tokenem Telegrama (bez logowania do panelu – kliknięcia przychodzą z Telegrama)
  const config = {
    version: 1,
    global: { ui: { language: 'pl' }, telegram: { chatId: String(CHAT), adminIds: [] } },
    bots: [{ id: BOT, name: 'Testowy', paused: true }],
  };
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(dataDir, 'secrets.json'), JSON.stringify({ global: { telegramBotToken: '123:abc' }, bots: {} }));
  fs.writeFileSync(path.join(filesDir, `${DRAFT}.json`), JSON.stringify({ draftId: DRAFT, botId: BOT, status: 'draft', post_x: 'x' }));
  internal = await freePort();
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      TZ: 'Europe/Warsaw',
      POSTER_DATA_DIR: dataDir,
      POSTER_FILES_DIR: filesDir,
      PANEL_INTERNAL_TOKEN: TOKEN,
      PANEL_PORT_INTERNAL: String(await freePort()),
      PANEL_INTERNAL_PORT: String(internal),
      UPSTREAM_TELEGRAM: `http://127.0.0.1:${mock.address().port}`,
      N8N_INTERNAL_URL: `http://127.0.0.1:${mock.address().port}`,
    },
  });
  proc.stdout.on('data', (d) => (logs += d));
  proc.stderr.on('data', (d) => (logs += d));
  await waitFor(() => telegramCalls.some((c) => c.method === 'getUpdates'), 15000, 'odbiór wiadomości z Telegrama');
});

after(() => {
  if (proc) proc.kill();
  if (mock) {
    mock.closeAllConnections();
    mock.close();
  }
});

const click = (id, user) => ({
  update_id: id,
  callback_query: {
    id: `cq${id}`,
    from: { id: user, username: `admin${user}` },
    data: `pub:${DRAFT}`,
    message: { message_id: 9, chat: { id: CHAT } },
  },
});
const answers = () => telegramCalls.filter((c) => c.method === 'answerCallbackQuery').map((c) => c.params.text);
const publishJobs = () => n8nJobs.filter((j) => j.kind === 'publish');

test('dwa kliknięcia ✅ jednego draftu: jedno zlecenie publikacji, drugie kliknięcie – „już się publikuje”', async () => {
  updates = [click(1, 7), click(2, 8)];
  await waitFor(() => answers().length >= 2, 10000, `odpowiedzi na oba kliknięcia\n${logs}`);
  assert.equal(publishJobs().length, 1);
  assert.equal(publishJobs()[0].draftId, DRAFT);
  assert.equal(answers()[0], '⏳ Publikuję…');
  assert.match(answers()[1], /^⏳ Ten draft właśnie się publikuje/);

  // raport z n8n kończy publikację – ponowienie (🔁 przy nieudanej platformie) znowu uruchamia publikację
  const r = await fetch(`http://127.0.0.1:${internal}/internal/events`, {
    method: 'POST',
    headers: { 'x-poster-token': TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'publish',
      runId: publishJobs()[0].runId,
      draftId: DRAFT,
      status: 'partial',
      results: { x: { ok: false, error: 'HTTP 503' } },
    }),
  });
  assert.equal(r.status, 200);
  updates = [click(3, 7)];
  await waitFor(() => publishJobs().length === 2, 10000, 'ponowienie po raporcie');
  assert.equal(answers().at(-1), '⏳ Publikuję…');
});

test('publikacja w toku: przebieg „publish” do raportu, „Publikuj teraz” i tryb automatyczny, limit czasu przebiegu', () => {
  const store = new Store(tmpDir());
  const runner = new Runner(store, {
    n8nUrl: 'http://n8n',
    n8nPublicUrl: 'http://n8n',
    internalToken: TOKEN,
    panelInternalUrl: 'http://panel',
  });
  const now = Date.now();
  const run = (id, kind, status, draftId, minutesAgo = 1) =>
    store.addRun({ id, kind, status, draftId, startedAt: new Date(now - minutesAgo * 60000).toISOString() });
  assert.equal(runner.publishing('d1'), null);
  assert.equal(runner.publishing(''), null);
  run('r1', 'publish', 'running', 'd1');
  assert.equal(runner.publishing('d1').id, 'r1');
  store.updateRun('r1', { status: 'published' });
  assert.equal(runner.publishing('d1'), null, 'raport z n8n kończy publikację');
  run('r2', 'compose', 'publishing', 'd2'); // „Publikuj teraz” po zapisaniu draftu
  run('r3', 'generate', 'publishing', 'd3'); // tryb automatyczny
  run('r4', 'generate', 'draft', 'd4'); // czeka na akceptację – to nie publikacja
  assert.equal(runner.publishing('d2').id, 'r2');
  assert.equal(runner.publishing('d3').id, 'r3');
  assert.equal(runner.publishing('d4'), null);
  run('r5', 'publish', 'running', 'd5', 61); // n8n nic nie zgłosił przez ponad godzinę – można spróbować ponownie
  assert.equal(runner.publishing('d5'), null);
});
