'use strict';
// Prawdziwy proces panelu z atrapami n8n, Telegrama i Gemini: stan dla monitoringu (/healthz bez logowania) i łagodne
// zamykanie – SIGTERM kończy trwające zapytanie n8n (tu tekst AI), zamyka porty dla nowych połączeń i zapisuje stan.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { tmpDir, freePort, waitFor } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const TOKEN = 'test-internal-token-1234567890';
let proc;
let logs = '';
let exit = null;
let mock;
let ui;
let internal;
let dataDir;
let n8nHealthy = true;
let aiRequests = 0;

before(async () => {
  mock = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const send = (status, obj) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.url === '/healthz') return send(n8nHealthy ? 200 : 503, { status: n8nHealthy ? 'ok' : 'error' });
      if (/:generateContent$/.test(req.url)) {
        aiRequests++;
        // wolny model – odpowiedź po 1,5 s
        return setTimeout(() => send(200, { candidates: [{ content: { parts: [{ text: '{"post_x":"Kawa dnia"}' }] } }] }), 1500);
      }
      const m = req.url.match(/^\/bot[^/]+\/(\w+)$/);
      if (m && m[1] === 'getMe') return send(200, { ok: true, result: { id: 42, username: 'poster_test_bot', is_bot: true } });
      if (m && m[1] === 'getUpdates') return setTimeout(() => send(200, { ok: true, result: [] }), 100);
      if (m) return send(200, { ok: true, result: true });
      send(404, {});
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${mock.address().port}`;
  dataDir = tmpDir();
  const config = {
    version: 1,
    global: { ui: { language: 'pl' }, telegram: { chatId: '123456789', adminIds: [] } },
    bots: [{ id: 'bot001', name: 'Kawiarnia Pod Lipą', paused: true, content: { textProvider: 'gemini', textModel: 'gemini-test' } }],
  };
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify(config));
  fs.writeFileSync(
    path.join(dataDir, 'secrets.json'),
    JSON.stringify({ global: { telegramBotToken: '123:abc', geminiApiKey: 'k' }, bots: {} }),
  );
  ui = await freePort();
  internal = await freePort();
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      TZ: 'Europe/Warsaw',
      POSTER_DATA_DIR: dataDir,
      POSTER_FILES_DIR: tmpDir(),
      PANEL_INTERNAL_TOKEN: TOKEN,
      PANEL_PORT_INTERNAL: String(ui),
      PANEL_INTERNAL_PORT: String(internal),
      UPSTREAM_TELEGRAM: base,
      UPSTREAM_GEMINI: base,
      N8N_INTERNAL_URL: base,
      POSTER_HEALTH_CACHE_MS: '50',
      PANEL_SHUTDOWN_MS: '8000',
    },
  });
  proc.stdout.on('data', (d) => (logs += d));
  proc.stderr.on('data', (d) => (logs += d));
  proc.on('exit', (code, signal) => (exit = { code, signal }));
  await waitFor(() => /API dla n8n/.test(logs), 15000, 'start panelu');
});

after(() => {
  if (proc && !exit) proc.kill('SIGKILL');
  mock.closeAllConnections();
  mock.close();
});

// czeka na warunek sprawdzany asynchronicznie (zapytanie do panelu)
async function until(check, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Nie doczekano się: ${what}`);
}
const healthz = async () => {
  const r = await fetch(`http://127.0.0.1:${ui}/healthz`);
  return { status: r.status, body: await r.json() };
};

test('/healthz bez logowania: n8n, Telegram i harmonogram – 200, a gdy n8n nie działa – 503 (bez nazw i treści błędów)', async () => {
  // Telegram: odbiór wiadomości ruszył
  await until(async () => (await healthz()).body.telegram === 'ok', 10000, 'odbiór wiadomości z Telegrama');
  let h = await healthz();
  assert.equal(h.status, 200);
  assert.deepEqual(h.body, { ok: true, n8n: 'ok', disk: 'ok', telegram: 'ok', scheduler: 'ok' });
  n8nHealthy = false;
  await new Promise((r) => setTimeout(r, 80));
  h = await healthz();
  assert.equal(h.status, 503);
  assert.deepEqual(h.body, { ok: false, n8n: 'error', disk: 'ok', telegram: 'ok', scheduler: 'ok' });
  assert.doesNotMatch(JSON.stringify(h.body), /Kawiarnia|poster_test_bot|123:abc/);
  n8nHealthy = true;
});

test('SIGTERM: trwające zapytanie n8n kończy się, nowe połączenia są odrzucane, stan zapisany, kod wyjścia 0', async () => {
  const pending = fetch(`http://127.0.0.1:${internal}/internal/bots/bot001/llm`, {
    method: 'POST',
    headers: { 'x-poster-token': TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ system: 's', user: 'u', schema: { type: 'OBJECT', properties: { post_x: { type: 'STRING' } } } }),
  });
  await waitFor(() => aiRequests > 0, 5000, 'zapytanie do AI');
  const statePath = path.join(dataDir, 'state.json');
  fs.rmSync(statePath, { force: true });
  proc.kill('SIGTERM');
  await waitFor(() => /Zamykam panel \(SIGTERM\)/.test(logs), 5000, 'komunikat o zamykaniu');
  await assert.rejects(fetch(`http://127.0.0.1:${ui}/healthz`), 'port panelu nie przyjmuje nowych połączeń');
  const r = await pending;
  assert.equal(r.status, 200);
  assert.equal((await r.json()).text, '{"post_x":"Kawa dnia"}');
  await waitFor(() => exit !== null, 10000, 'koniec procesu');
  assert.deepEqual(exit, { code: 0, signal: null });
  assert.ok(fs.existsSync(statePath), 'stan zapisany przy zamykaniu');
  assert.doesNotMatch(logs, /Nie wszystkie zadania skończyły się/);
});
