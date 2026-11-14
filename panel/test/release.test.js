'use strict';
// Podpisane wydania: scripts/release-verify.sh (ten sam plik działa na NAS-ie w kontenerze z gitem) na prawdziwych
// repozytoriach gita z commitami podpisanymi kluczem SSH, oraz komunikaty scripts/release.sh. Wymaga gita 2.34+
// i ssh-keygen – bez nich testy są pomijane (w CI to błąd).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const VERIFY = path.join(ROOT, 'scripts', 'release-verify.sh');
const SIGNERS = 'scripts/release-signers';
const OFFICIAL = 'https://github.com/imdangro/poster-app.git';

let dir;
let skip = false;
let seq = 0;
const env = () => ({ PATH: process.env.PATH, HOME: path.join(dir, 'home'), GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C', TZ: 'UTC' });
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    env: env(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const key = (name) => path.join(dir, name);
const pub = (name) =>
  fs
    .readFileSync(`${key(name)}.pub`, 'utf8')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(' ');
const signers = (...names) => '# klucze wydań (test)\n' + names.map((n) => `poster-release namespaces="git" ${pub(n)}\n`).join('');

// commit w repozytorium: files – pliki do zapisania, by – klucz podpisu (bez niego commit niepodpisany)
function commit(repo, message, { by, files = {} } = {}) {
  files[`plik-${++seq}.txt`] = message;
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), content);
  }
  git(repo, 'add', '-A');
  const sign = by ? ['-c', 'gpg.format=ssh', '-c', `user.signingkey=${key(by)}`] : [];
  git(repo, ...sign, 'commit', '-q', by ? '-S' : '--no-gpg-sign', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

// „repozytorium wydań” z pierwszym commitem (klucze pinned) i jego klon – „NAS”
function setup(pinned = ['k1'], { by = 'k1' } = {}) {
  const base = fs.mkdtempSync(path.join(dir, 'case-'));
  const up = path.join(base, 'up');
  const nas = path.join(base, 'nas');
  fs.mkdirSync(up);
  git(up, 'init', '-q', '-b', 'main');
  commit(up, 'wydanie 1', { by, files: { [SIGNERS]: pinned ? signers(...pinned) : '# bez kluczy\n' } });
  git(base, 'clone', '-q', up, nas);
  return { up, nas };
}

// wynik scripts/release-verify.sh w katalogu NAS-a po pobraniu nowości (git fetch); official – adres repozytorium wydań
function verify(nas, { from = 'HEAD', to = '@{upstream}', file, official = true, fetch = true, extraEnv = {} } = {}) {
  if (fetch) git(nas, 'fetch', '-q');
  const url = official ? git(nas, 'remote', 'get-url', 'origin') : '';
  if (official) git(nas, 'remote', 'set-url', 'origin', typeof official === 'string' ? official : OFFICIAL);
  const args = [VERIFY, from, to];
  if (file) args.push(file);
  const r = spawnSync('sh', args, { cwd: nas, env: { ...env(), ...extraEnv }, encoding: 'utf8' });
  if (official) git(nas, 'remote', 'set-url', 'origin', url);
  const out = Object.fromEntries(
    r.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
  return { ...out, status: r.status, stderr: r.stderr };
}

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-release-'));
  fs.mkdirSync(path.join(dir, 'home'));
  try {
    for (const name of ['k1', 'k2', 'obcy']) {
      execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', name, '-f', key(name)], { stdio: 'ignore' });
    }
    const probe = path.join(dir, 'probe');
    fs.mkdirSync(probe);
    git(probe, 'init', '-q', '-b', 'main');
    commit(probe, 'próba', { by: 'k1' });
  } catch (e) {
    if (process.env.CI) throw new Error(`testy podpisu wydań wymagają gita 2.34+ i ssh-keygen: ${e.message}`);
    skip = 'brak ssh-keygen albo gita z podpisami SSH';
  }
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const t = (name, fn) => test(name, (ctx) => (skip ? ctx.skip(skip) : fn(ctx)));

t('nowe wydanie podpisane kluczem z zainstalowanej wersji: verified, z commitem i odciskiem klucza', () => {
  const { up, nas } = setup();
  const tip = commit(up, 'wydanie 2', { by: 'k1' });
  const r = verify(nas);
  assert.equal(r.result, 'verified', r.stderr);
  assert.equal(r.commit, tip);
  assert.match(r.key, /^SHA256:[A-Za-z0-9+/]{43}$/);
  assert.equal(r.status, 0);
});

t('wydanie bez podpisu, podpisane obcym kluczem i ze zmienioną treścią – nie do instalacji', () => {
  const a = setup();
  commit(a.up, 'cudzy commit bez podpisu');
  assert.equal(verify(a.nas).result, 'unsigned');

  const b = setup();
  commit(b.up, 'cudzy commit z własnym podpisem', { by: 'obcy' });
  const r = verify(b.nas);
  assert.equal(r.result, 'untrusted');
  assert.match(r.key, /^SHA256:/, 'odcisk obcego klucza trafia do komunikatu');

  // podpis prawdziwego wydania doklejony do zmienionej treści commitu
  const c = setup();
  commit(c.up, 'wydanie 2', { by: 'k1' });
  const raw = execFileSync('git', ['cat-file', 'commit', 'HEAD'], { cwd: c.up, env: env() }).toString('utf8');
  const forged = execFileSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], {
    cwd: c.up,
    env: env(),
    input: raw.replace(/wydanie 2\n$/, 'wydanie 2 – podmienione\n'),
    encoding: 'utf8',
  }).trim();
  git(c.up, 'update-ref', 'refs/heads/main', forged);
  assert.equal(verify(c.nas).result, 'bad');
});

t('klucz w pobieranej wersji nie wystarcza: liczą się klucze znane przed aktualizacją', () => {
  // atakujący dopisuje swój klucz do pliku i podpisuje nim ten sam commit
  const a = setup();
  commit(a.up, 'podmiana kluczy', { by: 'obcy', files: { [SIGNERS]: signers('obcy') } });
  assert.equal(verify(a.nas).result, 'untrusted');
  // ...albo dopisuje go commitem bez podpisu, a podpisuje następny
  const b = setup();
  commit(b.up, 'klucz bez podpisu', { files: { [SIGNERS]: signers('k1', 'obcy') } });
  commit(b.up, 'podpisane dopisanym kluczem', { by: 'obcy' });
  assert.equal(verify(b.nas).result, 'untrusted');
  // ...albo commitem podpisanym swoim kluczem
  const c = setup();
  commit(c.up, 'klucz podpisany sobą', { by: 'obcy', files: { [SIGNERS]: signers('k1', 'obcy') } });
  commit(c.up, 'wydanie obcym kluczem', { by: 'obcy' });
  assert.equal(verify(c.nas).result, 'untrusted');
});

t('commity bez podpisu nie blokują wydań: przed wydaniem są pomijane, a dopisane za nim – nie są instalowane', () => {
  const { up, nas } = setup();
  commit(up, 'poprawka README w przeglądarce (bez podpisu)');
  commit(up, 'commit obcym kluczem', { by: 'obcy' });
  const tip = commit(up, 'wydanie 2', { by: 'k1' });
  let r = verify(nas);
  assert.deepEqual([r.result, r.commit], ['verified', tip]);
  // scalony PR albo cudzy commit za wydaniem: do instalacji jest ostatnie podpisane wydanie
  commit(up, 'commit bez podpisu za wydaniem');
  commit(up, 'i jeszcze jeden, obcym kluczem', { by: 'obcy' });
  r = verify(nas);
  assert.deepEqual([r.result, r.commit], ['partial', tip]);
  assert.match(r.key, /^SHA256:/);
  // po jego instalacji nie ma już nic podpisanego do pobrania – odmowa
  git(nas, 'merge', '-q', '--ff-only', tip);
  assert.equal(verify(nas).result, 'untrusted');
});

t('zmiana klucza: wydanie podpisane starym kluczem wprowadza nowy, a NAS, który je ominął, aktualizuje się dalej', () => {
  const { up, nas } = setup();
  commit(up, 'wydanie 2: nowy klucz', { by: 'k1', files: { [SIGNERS]: signers('k2') } });
  commit(up, 'wydanie 3', { by: 'k2' });
  const tip = commit(up, 'wydanie 4', { by: 'k2' });
  const r = verify(nas);
  assert.deepEqual([r.result, r.commit], ['verified', tip]);
  // stary klucz po wymianie już nie wystarcza: NAS po aktualizacji do wydania 4 odmawia, a NAS sprzed wymiany
  // dochodzi tylko do wydania 4
  commit(up, 'wydanie starym kluczem', { by: 'k1' });
  const behind = verify(nas);
  assert.deepEqual([behind.result, behind.commit], ['partial', tip]);
  git(nas, 'merge', '-q', '--ff-only', tip);
  assert.equal(verify(nas).result, 'untrusted');
});

t('stara historia nie przywraca wycofanego klucza (tylko potomkowie zainstalowanej wersji zmieniają klucze)', () => {
  // NAS zna już tylko k2; atakujący ma wycofany k1 i prawdziwy dawny commit podpisany k2 z listą {k1, k2}
  const { up, nas } = setup(['k2'], { by: 'k2' });
  const head = git(up, 'rev-parse', 'HEAD');
  git(up, 'checkout', '-q', '--orphan', 'dawne');
  git(up, 'rm', '-rfq', '.');
  const old = commit(up, 'dawne wydanie z listą dwóch kluczy', { by: 'k2', files: { [SIGNERS]: signers('k1', 'k2') } });
  // a) gałąź przepisana na dawną historię z commitem k1 na końcu
  const rewritten = commit(up, 'złośliwe wydanie wycofanym kluczem', { by: 'k1' });
  git(up, 'checkout', '-q', '-f', 'main');
  git(up, 'reset', '-q', '--hard', rewritten);
  assert.equal(verify(nas).result, 'untrusted', 'inna historia: liczy się tylko nowy commit i klucze z dysku');
  // b) dawna historia wpleciona scaleniem: nowy commit jest potomkiem zainstalowanej wersji, ale dawne wydanie – nie
  git(up, 'reset', '-q', '--hard', old);
  git(up, 'merge', '-q', '--no-gpg-sign', '-s', 'ours', '--allow-unrelated-histories', '-m', 'scalenie', head);
  commit(up, 'złośliwe wydanie wycofanym kluczem', { by: 'k1' });
  git(nas, 'fetch', '-q');
  git(nas, 'merge-base', '--is-ancestor', 'HEAD', '@{upstream}'); // rzuca, gdyby nie był potomkiem
  assert.equal(verify(nas).result, 'untrusted');
});

t('nic nowego albo lokalna wersja nowsza: current; zmiana repozytorium („-”): tylko nowy commit', () => {
  const { up, nas } = setup();
  assert.equal(verify(nas).result, 'current');
  commit(up, 'wydanie 2', { by: 'k1' });
  git(nas, 'pull', '-q', '--ff-only');
  git(up, 'reset', '-q', '--hard', 'HEAD~1');
  git(nas, 'fetch', '-q', '--force');
  assert.equal(verify(nas, { fetch: false }).result, 'current');

  // przejście LITE → PRO: inna historia, sprawdzany jest sam nowy commit kluczami z zainstalowanej wersji
  const pro = setup(['k1']);
  commit(pro.up, 'PRO bez podpisu');
  const proTip = commit(pro.up, 'PRO 2', { by: 'k1' });
  const lite = setup(['k1']);
  git(lite.nas, 'remote', 'set-url', 'origin', pro.up);
  git(lite.nas, 'fetch', '-q', 'origin');
  const ok = verify(lite.nas, { from: '-', to: 'origin/main', fetch: false });
  assert.deepEqual([ok.result, ok.commit], ['verified', proTip]);
  commit(pro.up, 'PRO podpisane obcym kluczem', { by: 'obcy' });
  git(lite.nas, 'fetch', '-q', 'origin');
  assert.equal(verify(lite.nas, { from: '-', to: 'origin/main', fetch: false }).result, 'untrusted');
});

t('podpis wymagany tylko od repozytoriów wydań Postera i tylko z wpisanym kluczem', () => {
  const { up, nas } = setup();
  commit(up, 'commit bez podpisu');
  // własna kopia programu albo repozytorium źródłowe: bez wymagania
  assert.equal(verify(nas, { official: false }).result, 'off');
  for (const url of [
    'https://github.com/ktos/poster-app.git',
    'https://github.com.example.org/imdangro/poster-app.git',
    'https://example.org/github.com/imdangro/poster-app',
    'git@gitlab.com:imdangro/poster-pro.git',
  ]) {
    assert.equal(verify(nas, { official: url }).result, 'off', url);
  }
  // ...chyba że wymuszone (testy na lokalnych repozytoriach)
  assert.equal(verify(nas, { official: false, extraEnv: { POSTER_REQUIRE_SIGNED: '1' } }).result, 'unsigned');
  // adresy repozytoriów wydań w różnych zapisach
  for (const url of [
    'https://github.com/imdangro/poster-app.git',
    'https://github.com/imdangro/poster-app',
    'https://github.com/Imdangro/Poster-App/',
    'https://token@github.com/imdangro/poster-pro.git',
    'git@github.com:imdangro/poster-pro.git',
    'ssh://git@github.com/imdangro/poster-pro.git',
  ]) {
    assert.equal(verify(nas, { official: url }).result, 'unsigned', url);
  }
  // wersja bez wpisanego klucza (przed pierwszym podpisanym wydaniem): nic nie jest sprawdzane
  const none = setup(null, { by: null });
  commit(none.up, 'commit bez podpisu');
  assert.equal(verify(none.nas, { extraEnv: { POSTER_REQUIRE_SIGNED: '1' } }).result, 'off');
});

t('publikacja: podpis nowego commitu względem kluczy z poprzedniego wydania (plik podany wprost)', () => {
  const { up } = setup();
  const prev = path.join(dir, `prev-${++seq}`);
  fs.writeFileSync(prev, signers('k1'));
  commit(up, 'wydanie 2', { by: 'k1', files: { [SIGNERS]: signers('k2') } });
  const required = { POSTER_REQUIRE_SIGNED: '1' };
  assert.equal(
    verify(up, { from: 'HEAD~1', to: 'HEAD', file: prev, official: false, fetch: false, extraEnv: required }).result,
    'verified',
  );
  // klucz z sekretu inny niż wpisany w poprzednim wydaniu – klienci nie przyjęliby takiego wydania
  fs.writeFileSync(prev, signers('k2'));
  assert.equal(
    verify(up, { from: 'HEAD~1', to: 'HEAD', file: prev, official: false, fetch: false, extraEnv: required }).result,
    'untrusted',
  );
});

// scripts/release.sh: komunikaty i kody wyjścia – „docker” zastąpiony skryptem, który uruchamia release-verify.sh wprost
function check(nas, { allow = false } = {}) {
  const bin = path.join(dir, `bin-${++seq}`);
  fs.mkdirSync(bin);
  // docker run … --entrypoint sh <obraz> scripts/release-verify.sh <od> <do> → sh release-verify.sh <od> <do>
  fs.writeFileSync(
    path.join(bin, 'docker'),
    `#!/bin/sh\nwhile [ "$1" != --entrypoint ]; do shift; done\nshift 4\nexec sh ${JSON.stringify(VERIFY)} "$@"\n`,
    { mode: 0o755 },
  );
  const script = [
    `. ${JSON.stringify(path.join(ROOT, 'scripts/lang.sh'))}`,
    'info() { echo "info: $*"; }',
    'warn() { echo "warn: $*"; }',
    `. ${JSON.stringify(path.join(ROOT, 'scripts/release.sh'))}`,
    'GIT_IMAGE=test',
    'rc=0; release_check HEAD "@{upstream}" || rc=$?',
    'echo "rc=$rc result=$REL_RESULT commit=$REL_COMMIT"',
  ].join('\n');
  const extra = { POSTER_LANG: 'pl', POSTER_REQUIRE_SIGNED: '1', ...(allow ? { POSTER_ALLOW_UNSIGNED: '1' } : {}) };
  const r = spawnSync('bash', ['-c', script], {
    cwd: nas,
    env: { ...env(), PATH: `${bin}:${process.env.PATH}`, ...extra },
    encoding: 'utf8',
  });
  return r.stdout + r.stderr;
}

t('release.sh: zgoda przy dobrym podpisie, odmowa (kod 3) z komunikatem przy złym, bez kluczy – bez sprawdzania', () => {
  const { up, nas } = setup();
  const tip = commit(up, 'wydanie 2', { by: 'k1' });
  git(nas, 'fetch', '-q');
  let out = check(nas);
  assert.match(out, new RegExp(`rc=0 result=verified commit=${tip}`));
  assert.match(out, /info: Podpis wydania sprawdzony \(klucz SHA256:/);

  // commit bez podpisu za wydaniem: instalowane jest wydanie, z ostrzeżeniem
  commit(up, 'cudzy commit');
  git(nas, 'fetch', '-q');
  out = check(nas);
  assert.match(out, new RegExp(`rc=0 result=partial commit=${tip}`));
  assert.match(out, /warn: W repozytorium są nowsze zmiany bez podpisu wydań Postera – pomijam je/);
  // a gdy wydanie jest już zainstalowane – odmowa
  git(nas, 'merge', '-q', '--ff-only', tip);
  out = check(nas);
  assert.match(out, /rc=3 result=unsigned/);
  assert.match(out, /nie ma podpisu wydań Postera/);
  assert.match(out, /Nie instaluję jej – zainstalowana wersja działa dalej/);
  // świadome pominięcie: instalacja mimo braku podpisu, z ostrzeżeniem
  out = check(nas, { allow: true });
  assert.match(out, /rc=0 result=unsigned/);
  assert.match(out, /POSTER_ALLOW_UNSIGNED=1 – instaluję mimo to/);

  // wersja bez wpisanego klucza: kontener z gitem nie jest nawet uruchamiany
  const none = setup(null, { by: null });
  commit(none.up, 'commit bez podpisu');
  git(none.nas, 'fetch', '-q');
  assert.match(check(none.nas), /rc=0 result=off commit=\n/);
});

test('plik kluczy wydań: tylko komentarze albo wpisy „nazwa namespaces="git" klucz”; skrypty sprawdzają podpis przed instalacją', () => {
  const lines = fs
    .readFileSync(path.join(ROOT, SIGNERS), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'));
  for (const l of lines)
    assert.match(l, /^\S+ namespaces="git" (ssh-ed25519|sk-ssh-ed25519@openssh\.com|ssh-rsa|ecdsa-sha2-\S+) [A-Za-z0-9+/=]+$/, l);
  // update.sh: pobranie (fetch), podpis, dopiero potem zmiana plików – i tylko do sprawdzonego commitu
  const update = fs.readFileSync(path.join(ROOT, 'scripts/update.sh'), 'utf8');
  assert.match(update, /^\. scripts\/release\.sh$/m);
  const fetch = update.indexOf('fetch || return 1');
  const checkAt = update.indexOf("release_check HEAD '@{upstream}' || return 3");
  const merge = update.indexOf('merge --ff-only "$target"');
  assert.ok(fetch > 0 && fetch < checkAt && checkAt < merge, 'kolejność: fetch → podpis → merge');
  assert.doesNotMatch(update.replace(/^\s*#.*$/gm, ''), /\bpull --ff-only\b/, 'bez git pull – pobranie i instalacja są rozdzielone');
  // upgrade-to-pro.sh: podpis wersji PRO przed przełączeniem katalogu projektu
  const upgrade = fs.readFileSync(path.join(ROOT, 'scripts/upgrade-to-pro.sh'), 'utf8');
  assert.match(upgrade, /^\. scripts\/release\.sh$/m);
  const proCheck = upgrade.indexOf('release_check - origin/main');
  assert.ok(
    proCheck > upgrade.indexOf('dgit fetch --quiet origin') && proCheck < upgrade.indexOf('dgit checkout -q -B main --track origin/main'),
  );
});
