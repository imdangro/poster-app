'use strict';
// Odporność panelu: zadania cykliczne bez nakładania się (harmonogram), publikacja z Telegrama w tle, zapis bota
// w trakcie łączenia konta, limit czasu tekstu AI dla przebiegu bota, najwyżej 2 procesy ffmpeg naraz
// i (PRO) wysyłka zaplanowanego posta, która trwa dłużej niż 3 min.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Store } = require('../lib/store');
const { Runner } = require('../lib/runner');
const { Telegram } = require('../lib/telegram');
const { Accounts, UPSTREAM } = require('../lib/accounts');
const { AI } = require('../lib/ai');
const { periodic } = require('../lib/util');
const { tmpDir, waitFor } = require('./helpers');

const servers = [];
after(() => servers.forEach((s) => s.close()));
// atrapa HTTP: handler(req, res, body)
async function mock(handler) {
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => handler(req, res, Buffer.concat(chunks).toString('utf8')));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  servers.push(srv);
  return `http://127.0.0.1:${srv.address().port}`;
}
const gate = () => {
  let open;
  const promise = new Promise((r) => (open = r));
  return { promise, open };
};

test('zadanie cykliczne: przebieg, który jeszcze trwa, nie nakłada się z następnym; stop() czeka na jego koniec', async () => {
  let calls = 0;
  const g = gate();
  const job = periodic(
    async () => {
      calls++;
      await g.promise;
    },
    60000,
    60000,
  );
  try {
    assert.equal(job.run(), job.run());
    assert.equal(calls, 1);
    let stopped = false;
    const stopping = job.stop().then(() => (stopped = true));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(stopped, false, 'stop() czeka na trwający przebieg');
    g.open();
    await stopping;
    assert.equal(stopped, true);
  } finally {
    g.open();
    job.stop();
  }
});

test('harmonogram: takt, który jeszcze trwa (wolne n8n), nie nakłada się z następnym', async () => {
  const runner = new Runner(new Store(tmpDir()), { n8nUrl: 'http://n8n', internalToken: 'x'.repeat(20) });
  let ticks = 0;
  const g = gate();
  runner.tick = async () => {
    ticks++;
    await g.promise;
  };
  runner.startScheduler();
  try {
    runner.scheduler.run();
    runner.scheduler.run();
    assert.equal(ticks, 1);
    const stopped = runner.stopScheduler();
    g.open();
    await stopped;
    assert.equal(ticks, 1);
  } finally {
    g.open();
    runner.stopScheduler();
  }
});

test('Telegram: publikacja w tle – kolejne kliknięcia nie czekają na n8n, drugie ✅ tego draftu nie publikuje', async () => {
  const store = new Store(tmpDir());
  store.secrets.global.telegramBotToken = '123:abc';
  store.updateGlobal({ telegram: { chatId: '-100777', adminIds: ['5'] } });
  const filesDir = tmpDir();
  for (const id of ['d1', 'd2']) fs.writeFileSync(path.join(filesDir, `${id}.json`), JSON.stringify({ draftId: id, status: 'draft' }));
  // jak runner.start: przebieg „publikacja w toku” zapisany od razu, potem czekanie na n8n
  const publishing = new Set();
  const started = [];
  const g = gate();
  const telegram = new Telegram(store, {
    filesDir,
    isPublishing: (id) => publishing.has(id),
    onPublish: async (draft, ctx) => {
      publishing.add(ctx.draftId);
      started.push(ctx.draftId);
      await g.promise;
      publishing.delete(ctx.draftId);
    },
    onReject: async () => {},
  });
  const calls = [];
  telegram.call = async (method, params) => {
    calls.push({ method, params });
    return {};
  };
  const click = (data) =>
    telegram.handle({
      update_id: 1,
      callback_query: { id: 'q', data, from: { id: 5 }, message: { message_id: 9, chat: { id: -100777 } } },
    });
  await click('pub:d1');
  await click('pub:d2'); // nie czeka na publikację d1
  assert.deepEqual(started, ['d1', 'd2']);
  await click('pub:d1');
  assert.deepEqual(started, ['d1', 'd2'], 'drugie ✅ tego samego draftu – bez drugiej publikacji');
  assert.match(calls.filter((c) => c.method === 'answerCallbackQuery').at(-1).params.text, /właśnie się publikuje/);
  let settled = false;
  const done = telegram.stop().then(() => (settled = true));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(settled, false, 'zamykanie panelu czeka na publikacje w tle');
  g.open();
  await done;
});

test('zapis ustawień bota w trakcie łączenia konta nie gubi połączenia', async () => {
  let release;
  const waiting = new Promise((r) => (release = r));
  let hits = 0;
  const base = await mock(async (req, res) => {
    hits++;
    await waiting;
    res.writeHead(200, { 'content-type': 'application/json' });
    const body = /\/me\/accounts/.test(req.url)
      ? { data: [{ id: '111', name: 'Strona', access_token: 'PAGE' }] }
      : { id: '111', name: 'Strona' };
    res.end(JSON.stringify(body));
  });
  const saved = UPSTREAM.meta;
  UPSTREAM.meta = base;
  try {
    const dir = tmpDir();
    const store = new Store(dir);
    const bot = store.addBot({ name: 'Kawiarnia' });
    const connecting = new Accounts(store, { publicUrl: 'http://panel.local:7080' }).connectMeta(bot.id, { token: 'USER-TOKEN' });
    await waitFor(() => hits >= 1, 5000, 'zapytanie do Meta');
    store.updateBot(bot.id, { name: 'Kawiarnia Pod Lipą', topic: 'kawa' }); // zapis z panelu w tym czasie
    release();
    await connecting;
    for (const s of [store, new Store(dir)]) {
      assert.equal(s.bot(bot.id).name, 'Kawiarnia Pod Lipą');
      assert.equal(s.bot(bot.id).accounts.meta.pageId, '111');
    }
  } finally {
    UPSTREAM.meta = saved;
  }
});

test('AI: przebieg bota kończy się w czasie, na który czeka n8n – także z ponowieniami', async () => {
  let calls = 0;
  const base = await mock((req) => {
    calls++; // brak odpowiedzi – zawieszony dostawca
    req.socket.setTimeout(0);
  });
  const saved = UPSTREAM.gemini;
  UPSTREAM.gemini = base;
  process.env.POSTER_AI_DEADLINE_MS = '1500';
  process.env.POSTER_AI_RETRY_MS = '50';
  try {
    const store = new Store(tmpDir());
    store.secrets.global.geminiApiKey = 'klucz';
    const bot = store.addBot({ name: 'Kawiarnia' });
    store.updateBot(bot.id, { content: { textProvider: 'gemini', textModel: 'gemini-test' } });
    const t0 = Date.now();
    await assert.rejects(
      new AI(store).generateText(
        store.bot(bot.id),
        { system: 's', user: 'u', schema: { type: 'OBJECT', properties: {} } },
        { patient: true },
      ),
      /AI nie wygenerowało tekstu/,
    );
    const took = Date.now() - t0;
    assert.ok(took >= 1000 && took < 5000, `czas: ${took} ms`);
    assert.ok(calls >= 1);
  } finally {
    UPSTREAM.gemini = saved;
    delete process.env.POSTER_AI_DEADLINE_MS;
    delete process.env.POSTER_AI_RETRY_MS;
  }
});

test('ffmpeg: najwyżej 2 procesy naraz, kolejne czekają w kolejce', async () => {
  const dir = tmpDir();
  const log = path.join(dir, 'log');
  const fake = path.join(dir, 'ffmpeg');
  fs.writeFileSync(fake, `#!/bin/sh\necho start >> "${log}"\nsleep 0.3\necho end >> "${log}"\n`, { mode: 0o755 });
  const saved = process.env.FFMPEG_PATH;
  process.env.FFMPEG_PATH = fake;
  try {
    const { ffmpeg } = require('../lib/ffmpeg');
    await Promise.all([1, 2, 3, 4, 5].map(() => ffmpeg([], 10000)));
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(lines.length, 10);
    let now = 0;
    let max = 0;
    for (const l of lines) max = Math.max(max, (now += l === 'start' ? 1 : -1));
    assert.equal(max, 2);
  } finally {
    if (saved === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = saved;
  }
});

test('ffmpeg: limit pikseli dekodowanego obrazu stoi przed plikiem wejściowym (domyślnie 120 Mpx, FFMPEG_MAX_PIXELS)', async () => {
  const dir = tmpDir();
  const log = path.join(dir, 'log');
  const fake = path.join(dir, 'ffmpeg');
  fs.writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\n`, { mode: 0o755 });
  const saved = { path: process.env.FFMPEG_PATH, max: process.env.FFMPEG_MAX_PIXELS };
  process.env.FFMPEG_PATH = fake;
  delete process.env.FFMPEG_MAX_PIXELS;
  try {
    const { ffmpeg } = require('../lib/ffmpeg');
    await ffmpeg(['-y', '-i', 'in.png', '-frames:v', '1', 'out.jpg'], 10000);
    process.env.FFMPEG_MAX_PIXELS = '5000000';
    await ffmpeg(['-y', '-loglevel', 'error', '-i', 'in.png', 'out.jpg'], 10000);
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), [
      '-y -max_pixels 120000000 -i in.png -frames:v 1 out.jpg',
      '-y -loglevel error -max_pixels 5000000 -i in.png out.jpg',
    ]);
  } finally {
    for (const [k, v] of [
      ['FFMPEG_PATH', saved.path],
      ['FFMPEG_MAX_PIXELS', saved.max],
    ]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

let realFfmpeg = true;
try {
  require('child_process').execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch (e) {
  realFfmpeg = false;
}
test(
  'ffmpeg: obraz większy niż limit pikseli jest odrzucany zamiast zająć pamięć panelu',
  { skip: !realFfmpeg && 'brak ffmpeg' },
  async () => {
    const { execFileSync } = require('child_process');
    const { fitJpeg } = require('../lib/ffmpeg');
    const dir = tmpDir();
    const make = (name) => {
      const file = path.join(dir, name);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=1200x1000', '-frames:v', '1', file]);
      return { buffer: fs.readFileSync(file), width: 1200, height: 1000 };
    };
    const saved = process.env.FFMPEG_MAX_PIXELS;
    try {
      for (const name of ['a.jpg', 'a.png']) {
        const img = make(name);
        process.env.FFMPEG_MAX_PIXELS = '1000000'; // obraz ma 1,2 Mpx
        await assert.rejects(fitJpeg(img, { maxSide: 600 }), name);
        process.env.FFMPEG_MAX_PIXELS = '2000000';
        assert.equal((await fitJpeg(img, { maxSide: 600 })).width, 600, name);
      }
    } finally {
      if (saved === undefined) delete process.env.FFMPEG_MAX_PIXELS;
      else process.env.FFMPEG_MAX_PIXELS = saved;
    }
  },
);

test('harmonogram: znak życia dla /healthz także w trakcie taktu, który czeka na wolne n8n', async () => {
  const store = new Store(tmpDir());
  const bot = store.addBot({ name: 'Wolne n8n' });
  const now = new Date();
  // termin „teraz”: bot jest do uruchomienia w tym takcie
  store.updateBot(bot.id, {
    paused: false,
    schedule: { mode: 'hours', hours: [now.getHours()], minute: now.getMinutes(), jitter: 0, days: [1, 2, 3, 4, 5, 6, 7] },
  });
  const runner = new Runner(store, {});
  let started = 0;
  runner.start = async () => {
    started++;
    await new Promise((r) => setTimeout(r, 80)); // n8n odpowiada wolno
  };
  const t0 = Date.now();
  await runner.tick();
  assert.equal(started, 1);
  assert.ok(runner.lastTickAt - t0 >= 70, `znak życia po starcie bota, a nie tylko na początku taktu (${runner.lastTickAt - t0} ms)`);
});
