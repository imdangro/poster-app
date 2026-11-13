'use strict';
// Skrypty instalacji i aktualizacji (bash, uruchamiane jako root): obraz z gitem przypięty digestem i ten sam we
// wszystkich skryptach, aktualizacja z nowymi obrazami Dockera i n8n w wersji sprawdzonej z workflow.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const GIT_SCRIPTS = ['scripts/update.sh', 'scripts/upgrade-to-pro.sh', 'scripts/setup-deploy-key.sh', 'docs/install.sh'].filter((f) =>
  fs.existsSync(path.join(ROOT, f)),
);

test('obraz z gitem przypięty digestem i ten sam we wszystkich skryptach (git działa jako root w katalogu projektu)', () => {
  const images = new Set();
  for (const file of GIT_SCRIPTS) {
    const src = read(file);
    const m = src.match(/^GIT_IMAGE=(\S+)$/m);
    assert.ok(m, `${file}: brak GIT_IMAGE`);
    assert.match(m[1], /^alpine\/git:[\w.-]+@sha256:[0-9a-f]{64}$/, `${file}: obraz bez digestu`);
    images.add(m[1]);
    // każde uruchomienie kontenera z gitem używa przypiętego obrazu (polecenia do ręcznego wpisania w komunikatach – nie)
    for (const line of src.split('\n')) {
      if (/^\s*(#|echo\b|die\b|"|.*\$\(m )/.test(line)) continue;
      assert.doesNotMatch(line, /docker run\b.*\salpine\/git\b/, `${file}: ${line.trim()}`);
    }
  }
  assert.ok(GIT_SCRIPTS.length >= 3);
  assert.equal(images.size, 1, `różne obrazy: ${[...images].join(', ')}`);
});

test('update.sh: nowe obrazy n8n i RSSHub oraz panel na aktualnym obrazie bazowym', () => {
  const src = read('scripts/update.sh');
  assert.match(src, /docker compose pull n8n rsshub/);
  assert.match(src, /docker compose build --pull/);
  assert.match(src, /--no-images\) IMAGES=0/);
  assert.doesNotMatch(src, /up -d --build/, 'bez budowania z cache przy aktualizacji');
});

test('n8n w wersji sprawdzonej z workflow: puste N8N_VERSION w .env.example, dawna wartość 2.40.7 czyszczona', () => {
  assert.match(read('.env.example'), /^N8N_VERSION=$/m);
  const tested = read('docker-compose.yml').match(/N8N_VERSION:-([0-9.]+)\}/);
  assert.ok(tested, 'docker-compose.yml podaje wersję n8n sprawdzoną z workflow');
  const init = read('scripts/init-nas.sh');
  assert.match(init, /2\.40\.7\)\n\s+sed -i 's\/\^N8N_VERSION=\.\*\/N8N_VERSION=\/' \.env/);
});

test('webhook n8n tylko z tokenem panelu: Header Auth z poświadczeniem, które tworzy import-to-n8n.sh', () => {
  const wf = JSON.parse(read('workflows/poster_workflow.json'));
  const hook = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook' && n.parameters.path === 'poster');
  assert.equal(hook.parameters.authentication, 'headerAuth');
  const id = hook.credentials.httpHeaderAuth.id;
  const imp = read('scripts/import-to-n8n.sh');
  assert.ok(imp.includes(`\\"id\\":\\"${id}\\",`), `import-to-n8n.sh tworzy poświadczenie ${id}`);
  assert.ok(imp.includes('\\"type\\":\\"httpHeaderAuth\\"'));
  assert.ok(imp.includes('\\"name\\":\\"x-poster-token\\"'), 'ten sam nagłówek, który wysyła panel (runner.callN8n)');
  assert.match(read('panel/lib/runner.js'), /'x-poster-token': this\.token/);
  // kolejność: konto właściciela n8n, poświadczenie, workflow
  const owner = imp.indexOf('n8n_owner "$N8N_PASS"');
  assert.ok(
    owner > 0 &&
      owner < imp.indexOf('n8n import:credentials') &&
      imp.indexOf('n8n import:credentials') < imp.indexOf('n8n import:workflow'),
  );
});

test('klucz hosta GitHuba znany z góry (jeden plik), ssh bez „zaufaj przy pierwszym połączeniu”', () => {
  const [host, type, key, ...rest] = read('scripts/github-known-hosts').trim().split(/\s+/);
  assert.deepEqual([host, type, rest.length], ['github.com', 'ssh-ed25519', 0]);
  // odcisk opublikowany przez GitHuba (docs.github.com → „GitHub's SSH key fingerprints”)
  const fp = crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest('base64').replace(/=+$/, '');
  assert.equal(`SHA256:${fp}`, 'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU');
  const files = [
    'scripts/setup-deploy-key.sh',
    'scripts/upgrade-to-pro.sh',
    'scripts/update.sh',
    'docs/install.sh',
    'tools/polar-test.sh',
    '.github/workflows/publish.yml',
  ].filter(exists);
  let ssh = 0;
  for (const file of files) {
    const src = read(file);
    for (const line of src.split('\n').filter((l) => /\bssh -i /.test(l))) {
      assert.match(line, /-o StrictHostKeyChecking=yes -o UserKnownHostsFile=/, `${file}: ${line.trim()}`);
      ssh++;
    }
    const code = src
      .replace(/^\s*#.*$/gm, '')
      .replace("sed -i 's/StrictHostKeyChecking=accept-new/StrictHostKeyChecking=yes/g' .git/config", '');
    assert.doesNotMatch(code, /accept-new/, file);
    if (/known.hosts/.test(code)) assert.doesNotMatch(code, /ssh-ed25519 AAAA/, `${file}: klucz tylko w scripts/github-known-hosts`);
  }
  assert.ok(ssh >= 2, 'połączenia SSH z kluczem w skryptach');
  // dawne instalacje: update.sh przestawia core.sshCommand na sprawdzanie klucza i odświeża plik z kluczem
  assert.match(
    read('scripts/update.sh'),
    /cp scripts\/github-known-hosts \.git\/poster-known-hosts\n\s+sed -i 's\/StrictHostKeyChecking=accept-new\//,
  );
});

test('akcje GitHub przypięte pełnym SHA, testy CI na Node.js z obrazu panelu', () => {
  const node = read('panel/Dockerfile').match(/NODE_IMAGE=node:(\d+)-/)[1];
  const dir = '.github/workflows';
  const files = exists(dir) ? fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.yml')) : [];
  for (const f of files) {
    const src = read(`${dir}/${f}`);
    for (const m of src.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)) assert.match(m[1], /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${f}: ${m[1]}`);
    for (const m of src.matchAll(/node-version:\s*(\S+)/g)) assert.equal(m[1], node, `${f}: Node.js ${m[1]}, a obraz panelu – ${node}`);
  }
});

test('kontenery bez podnoszenia uprawnień i z limitami; panel tylko do odczytu, RSSHub z healthcheckiem', () => {
  const compose = read('docker-compose.yml');
  const service = (name) => {
    const m = compose.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][\\w-]*:\\n|\\n\\S|$)`));
    assert.ok(m, `brak usługi ${name}`);
    return m[1];
  };
  for (const name of ['n8n', 'panel', 'rsshub']) {
    const s = service(name);
    assert.match(s, /<<: \*hardening/, `${name}: no-new-privileges`);
    assert.match(s, /mem_limit: \$\{[A-Z0-9]+_MEMORY:-\d+g\}/, `${name}: limit pamięci z .env`);
  }
  assert.match(compose, /x-hardening: &hardening\n {2}security_opt:\n {4}- no-new-privileges:true/);
  // bez uprawnień jądra i z limitem procesów – także RSSHub (cudzy obraz pobierany przy każdej aktualizacji)
  for (const name of ['n8n', 'panel', 'rsshub']) {
    assert.match(service(name), /cap_drop: \[ALL\]/, name);
    assert.match(service(name), /pids_limit: \d+/, name);
  }
  const panel = service('panel');
  assert.match(panel, /read_only: true/);
  assert.match(panel, /tmpfs:\n\s+- \/tmp:size=\d+m/);
  assert.match(panel, /stop_grace_period: \d+s/);
  assert.match(service('rsshub'), /healthcheck:\n\s+test: .*127\.0\.0\.1:1200\/healthz/);
  // obraz panelu: kod tylko do odczytu dla procesu, ffmpeg wymagany (bez cichego pominięcia)
  const dockerfile = read('panel/Dockerfile');
  assert.doesNotMatch(dockerfile, /--chown=node/);
  assert.match(dockerfile, /COPY \. \.\nRUN chmod -R u=rwX,go=rX \/app\nUSER node/);
  assert.match(dockerfile, /apk add --no-cache ffmpeg && exit 0; sleep 5; done;[^\n]*\\\n[^\n]*exit 1/);
  assert.doesNotMatch(dockerfile, /\|\| echo|\|\| true/);
});

test('init-nas.sh: data/panel (klucze, tokeny, hasło) i data/n8n (baza n8n) tylko dla właściciela, także po aktualizacji', () => {
  const init = read('scripts/init-nas.sh');
  const all = init.indexOf('chmod -R u+rwX,g+rwX,o-rwx data\n');
  const panel = init.indexOf('chmod -R u+rwX,go-rwx data/panel\n');
  const n8n = init.indexOf('chmod -R u+rwX,go-rwx data/n8n\n');
  assert.ok(all > 0 && panel > all, 'najpierw uprawnienia całego data/, potem zaostrzenie data/panel');
  assert.ok(n8n > all, 'baza n8n (dane wykonań z nagłówkami zleceń panelu) też tylko dla właściciela');
});

test('obraz panelu bez menedżerów pakietów (panel nie ma zależności npm)', () => {
  const dockerfile = read('panel/Dockerfile');
  assert.match(dockerfile, /RUN rm -rf \/usr\/local\/lib\/node_modules\/npm /);
  for (const bin of ['npm', 'npx', 'corepack', 'yarn']) assert.match(dockerfile, new RegExp(`/usr/local/bin/${bin}\\b`));
});
