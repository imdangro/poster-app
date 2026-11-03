'use strict';
// Pliki danych panelu po awarii: zapis atomowy z fsync i kopią .bak, plik tymczasowy, który nie idzie za podłożonym
// dowiązaniem symbolicznym, i odczyt uszkodzonego pliku (zanik prądu na NAS-ie, ręczna edycja) – panel startuje
// z kopii albo od pustego stanu zamiast restartować się w kółko; konfiguracji i kluczy nie traci po cichu.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readJsonSafe, writeJsonAtomic } = require('../lib/util');
const { Store } = require('../lib/store');
const { Auth } = require('../lib/auth');
const { tmpDir } = require('./helpers');

const quiet = () => {};
const corrupt = (dir, prefix) => fs.readdirSync(dir).filter((n) => n.startsWith(`${prefix}.corrupt-`));

test('zapis atomowy: kopia .bak poprzedniej wersji tylko na życzenie, bez plików tymczasowych', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'state.json');
  writeJsonAtomic(file, { v: 1 }, 0o600, { backup: true });
  assert.equal(fs.existsSync(`${file}.bak`), false, 'pierwszy zapis – nie ma czego kopiować');
  writeJsonAtomic(file, { v: 2 }, 0o600, { backup: true });
  writeJsonAtomic(file, { v: 3 }, 0o600, { backup: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { v: 3 });
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')), { v: 2 });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const other = path.join(dir, 'other.json');
  writeJsonAtomic(other, { a: 1 });
  writeJsonAtomic(other, { a: 2 });
  assert.equal(fs.existsSync(`${other}.bak`), false);
  assert.deepEqual(
    fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')),
    [],
  );
});

test('zapis atomowy nie idzie za podłożonym dowiązaniem symbolicznym (zapis roota w katalogu kontenera)', () => {
  const dir = tmpDir();
  const target = path.join(dir, 'cel.txt');
  fs.writeFileSync(target, 'nie ruszać');
  const file = path.join(dir, 'license.json');
  fs.symlinkSync(target, file);
  // dawna przewidywalna nazwa pliku tymczasowego – teraz losowa, więc podłożone dowiązanie nic nie daje
  fs.symlinkSync(target, `${file}.${process.pid}.tmp`);
  const me = { uid: process.getuid(), gid: process.getgid() };
  writeJsonAtomic(file, { state: 'active' }, 0o640, { owner: me });
  assert.equal(fs.readFileSync(target, 'utf8'), 'nie ruszać');
  assert.equal(fs.lstatSync(file).isSymbolicLink(), false, 'dowiązanie zastąpione zwykłym plikiem');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { state: 'active' });
  assert.equal(fs.statSync(file).uid, me.uid);
});

test('odczyt: brak pliku – wartość domyślna; uszkodzony – kopia .bak albo pusty stan, uszkodzony plik zostaje obok', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'state.json');
  const logs = [];
  const log = (m) => logs.push(m);
  assert.deepEqual(readJsonSafe(file, { x: 0 }, { log }), { x: 0 });

  writeJsonAtomic(file, { runs: [1] }, 0o600, { backup: true });
  writeJsonAtomic(file, { runs: [1, 2] }, 0o600, { backup: true });
  fs.writeFileSync(file, '{"runs": [1, 2'); // ucięty zapis
  assert.deepEqual(readJsonSafe(file, {}, { log }), { runs: [1] }, 'poprzednia wersja z .bak');
  assert.equal(corrupt(dir, 'state.json').length, 1);
  assert.match(logs[0], /użyto poprzedniej wersji \(\.bak\)/);
  assert.match(logs[0], /previous version \(\.bak\) was used/);

  // odzyskana wersja wraca do głównego pliku, a uszkodzony leży obok – nie trafi do kopii przy kolejnym zapisie
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { runs: [1] });
  writeJsonAtomic(file, { runs: [1, 3] }, 0o600, { backup: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')), { runs: [1] });

  const empty = path.join(dir, 'dedup.json');
  fs.writeFileSync(empty, ''); // pusty plik po zaniku prądu
  assert.deepEqual(readJsonSafe(empty, { keys: {} }, { log }), { keys: {} });
  assert.match(logs[1], /start od pustych danych/);
  assert.equal(corrupt(dir, 'dedup.json').length, 1);

  // strict (konfiguracja, klucze): bez działającej kopii błąd, a plik zostaje na miejscu
  const config = path.join(dir, 'config.json');
  fs.writeFileSync(config, '{"bots": [');
  assert.throws(() => readJsonSafe(config, null, { strict: true, log }), /config\.json jest uszkodzony/);
  assert.equal(fs.readFileSync(config, 'utf8'), '{"bots": [');
  assert.equal(corrupt(dir, 'config.json').length, 0);
});

test('Store: uszkodzony state.json nie zatrzymuje panelu, a config.json wraca z kopii .bak', () => {
  const dir = tmpDir();
  const error = console.error;
  console.error = quiet;
  try {
    const store = new Store(dir);
    const bot = store.addBot({ name: 'Bot z kopii' });
    store.updateBot(bot.id, { topic: 'kawa' }); // drugi zapis – poprzednia wersja w config.json.bak
    store.addRun({ id: 'r1', botId: bot.id, kind: 'generate', status: 'draft', startedAt: new Date().toISOString() });
    store.saveState(true);
    store.updateRun('r1', { status: 'published' });
    store.saveState(true);

    fs.writeFileSync(path.join(dir, 'state.json'), '{"runs": [{"id": "r1"');
    fs.writeFileSync(path.join(dir, 'config.json'), '');
    const again = new Store(dir);
    assert.equal(again.bot(bot.id).name, 'Bot z kopii');
    assert.equal(again.run('r1').status, 'draft', 'stan z poprzedniego zapisu');
    assert.equal(corrupt(dir, 'state.json').length, 1);
    assert.equal(corrupt(dir, 'config.json').length, 1);
    // odzyskane dane od razu w głównym pliku: restart przed pierwszym zapisem nie zaczyna od pustej konfiguracji
    const restarted = new Store(dir);
    assert.equal(restarted.firstStart, false);
    assert.equal(restarted.bot(bot.id).name, 'Bot z kopii');
    assert.equal(restarted.run('r1').status, 'draft');

    // bez kopii: stan od nowa, a konfiguracja – błąd startu zamiast panelu bez botów
    for (const f of ['state.json.bak', 'config.json.bak']) fs.rmSync(path.join(dir, f));
    fs.writeFileSync(path.join(dir, 'state.json'), '{');
    assert.deepEqual(new Store(dir).state.runs, []);
    fs.writeFileSync(path.join(dir, 'config.json'), '{');
    assert.throws(() => new Store(dir), /config\.json jest uszkodzony/);
  } finally {
    console.error = error;
  }
});

test('Store: uszkodzona pamięć duplikatów bota liczy się od nowa zamiast psuć każdy przebieg', () => {
  const dir = tmpDir();
  const error = console.error;
  console.error = quiet;
  try {
    const store = new Store(dir);
    const bot = store.addBot({ name: 'Newsy' });
    assert.equal(store.dedupFilter(bot.id, [{ id: 'a' }]).length, 1);
    // plik psuje się poza pracą panelu (np. zanik prądu) – panel czyta go raz, przy pierwszym użyciu po starcie
    fs.writeFileSync(store.dedupFile(bot.id), '{"keys": {"a": 1');
    const restarted = new Store(dir);
    assert.deepEqual(
      restarted.dedupFilter(bot.id, [{ id: 'a' }, { id: 'b' }]).map((x) => x.id),
      ['a', 'b'],
    );
    fs.writeFileSync(store.dedupFile(bot.id), '[]'); // poprawny JSON, ale nie ten kształt
    assert.equal(new Store(dir).dedupCount(bot.id), 0);
  } finally {
    console.error = error;
  }
});

test('Auth: uszkodzony auth.json – nowy kod do ustawienia hasła w logach (jak po resecie), bez pętli restartów', async () => {
  const dir = tmpDir();
  const error = console.error;
  console.error = quiet;
  try {
    const first = new Auth(dir, { log: quiet });
    first.setupCode();
    await first.setPassword('dobre-haslo-1');
    fs.writeFileSync(path.join(dir, 'auth.json'), '{"salt": "ab');
    const logs = [];
    const auth = new Auth(dir, { log: (m) => logs.push(m) });
    assert.equal(auth.needsSetup, true);
    auth.announceSetup();
    assert.match(logs.join('\n'), /Kod do ustawienia hasła panelu: [A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/);
    assert.equal(corrupt(dir, 'auth.json').length, 1);
  } finally {
    console.error = error;
  }
});
