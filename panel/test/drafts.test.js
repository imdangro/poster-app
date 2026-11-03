'use strict';
// Drafty w data/files: lista bez czytania katalogu przy każdym zapytaniu, pamięć podręczna z limitem, usuwanie starych
// draftów (ustawienie „Pliki draftów”, domyślnie wyłączone) i wolne miejsce na dysku.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Drafts } = require('../lib/drafts');
const { Store } = require('../lib/store');
const { tmpDir } = require('./helpers');

const DAY = 86400 * 1000;
const store = () => new Store(tmpDir());
function draft(dir, id, { days = 0, image = true, video = false } = {}) {
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ draftId: id, status: 'draft', news: { title: id } }));
  if (image) fs.writeFileSync(path.join(dir, `${id}.jpg`), 'jpg');
  if (video) fs.writeFileSync(path.join(dir, `${id}.mp4`), 'mp4');
  const t = new Date(Date.now() - days * DAY);
  for (const ext of ['json', 'jpg', 'mp4']) {
    const f = path.join(dir, `${id}.${ext}`);
    if (fs.existsSync(f)) fs.utimesSync(f, t, t);
  }
}

test('lista draftów od najnowszego; nowy plik widać od razu (zmiana katalogu), pamięć podręczna z limitem', () => {
  const dir = tmpDir();
  const drafts = new Drafts(dir, store());
  draft(dir, 'd20261101-1200-aaaa');
  draft(dir, 'd20261102-1200-bbbb');
  assert.deepEqual(
    drafts.list().map((d) => d.draftId),
    ['d20261102-1200-bbbb', 'd20261101-1200-aaaa'],
  );
  draft(dir, 'd20261103-1200-cccc');
  assert.equal(drafts.list()[0].draftId, 'd20261103-1200-cccc');
  for (let i = 0; i < 1005; i++) fs.writeFileSync(path.join(dir, `d20261001-0000-${String(i).padStart(4, '0')}.json`), '{}');
  drafts.list({ limit: 2000, botId: 'brak' }); // przegląda do 800 plików
  for (let i = 0; i < 1005; i++) drafts.summary(`d20261001-0000-${String(i).padStart(4, '0')}.json`);
  assert.ok(drafts.cache.size <= 1000, `pamięć podręczna: ${drafts.cache.size}`);
});

test('usuwanie starych draftów: wszystkie pliki draftu razem, świeżo zmieniony i publikowany draft zostaje, 0 = nic', () => {
  const dir = tmpDir();
  const drafts = new Drafts(dir, store());
  draft(dir, 'd20260801-1200-old1', { days: 40, video: true });
  draft(dir, 'd20260802-1200-old2', { days: 40 });
  draft(dir, 'd20260803-1200-busy', { days: 40 });
  draft(dir, 'd20261101-1200-new1', { days: 1 });
  // stare zdjęcie, ale draft opublikowany wczoraj (JSON zmieniony) – zostaje cały
  draft(dir, 'd20260804-1200-late', { days: 40 });
  const t = new Date(Date.now() - DAY);
  fs.utimesSync(path.join(dir, 'd20260804-1200-late.json'), t, t);
  fs.writeFileSync(path.join(dir, 'notatka.txt'), 'nie draft');
  assert.equal(drafts.prune(0), 0, 'wyłączone');
  assert.equal(drafts.prune(30, { skip: (id) => id === 'd20260803-1200-busy' }), 2);
  assert.deepEqual(fs.readdirSync(dir).sort(), [
    'd20260803-1200-busy.jpg',
    'd20260803-1200-busy.json',
    'd20260804-1200-late.jpg',
    'd20260804-1200-late.json',
    'd20261101-1200-new1.jpg',
    'd20261101-1200-new1.json',
    'notatka.txt',
  ]);
  assert.deepEqual(
    drafts
      .list()
      .map((d) => d.draftId)
      .sort(),
    ['d20260803-1200-busy', 'd20260804-1200-late', 'd20261101-1200-new1'],
  );
});

test('wolne miejsce na dysku i próg ostrzeżenia; ustawienie usuwania: 0 albo 7–3650 dni', () => {
  const drafts = new Drafts(tmpDir(), store());
  const d = drafts.disk();
  assert.ok(d.free > 0);
  assert.equal(d.low, false);
  process.env.POSTER_LOW_DISK_BYTES = String(Number.MAX_SAFE_INTEGER);
  try {
    assert.equal(drafts.disk().low, true);
  } finally {
    delete process.env.POSTER_LOW_DISK_BYTES;
  }
  const s = store();
  assert.equal(s.global.files.retentionDays, 0, 'domyślnie nie usuwa');
  s.updateGlobal({ files: { retentionDays: 30 } });
  assert.equal(s.global.files.retentionDays, 30);
  for (const bad of [3, -1, 4000, 'x', 7.5]) assert.throws(() => s.updateGlobal({ files: { retentionDays: bad } }), /od 7 do 3650 dni/);
  s.updateGlobal({ files: { retentionDays: 0 } });
  assert.equal(s.global.files.retentionDays, 0);
});
