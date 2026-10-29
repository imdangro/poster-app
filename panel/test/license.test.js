'use strict';
// Licencja PRO (lib/license.js, license-cli.js) na atrapie API portalu klienta Polara – bez sieci i bez kont.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { tmpDir } = require('./helpers');
const license = require('../lib/license');

const ORG = 'org-test';
const DAY = 86400000;
const CHECKOUT = 'https://buy.polar.sh/polar_cl_vNtQIQOE3mI5Ezkicv6CYnBd7hZ5v5aJ3AJ5x1ngNPZ'; // kasa przedłużenia
const SSH = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEtestkeyonlyfortests0000000000000000000 poster-pro';
const SSH2 = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEsecondkeyfortests000000000000000000000 poster-pro';

// Atrapa Polara: klucze licencyjne z aktywacjami, odpowiedzi jak w API portalu klienta
const keys = new Map();
const calls = [];
let srv;
let cfg;
function addKey(key, { status = 'granted', days = 365, limit = 2 } = {}) {
  const k = { id: `lk-${key}`, key, status, expires_at: days === null ? null : new Date(Date.now() + days * DAY).toISOString() };
  Object.assign(k, { limit_activations: limit, activations: new Map() });
  keys.set(key, k);
  return k;
}
const keyView = (k) => ({
  id: k.id,
  organization_id: ORG,
  key: k.key,
  display_key: `****-${k.key.slice(-4)}`,
  status: k.status,
  limit_activations: k.limit_activations,
  expires_at: k.expires_at,
});
before(async () => {
  srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const send = (status, obj) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(obj === undefined ? '' : JSON.stringify(obj));
      };
      const b = JSON.parse(body || '{}');
      const op = req.url.replace('/v1/customer-portal/license-keys/', '');
      calls.push({ op, body: b });
      const k = b.organization_id === ORG && keys.get(b.key);
      if (!k) return send(404, { error: 'ResourceNotFound', detail: 'License key not found.' });
      if (op === 'deactivate') {
        k.activations.delete(b.activation_id);
        return send(204);
      }
      if (k.status !== 'granted') return send(404, { error: 'ResourceNotFound', detail: 'License key is no longer active.' });
      if (k.expires_at && Date.parse(k.expires_at) <= Date.now())
        return send(404, { error: 'ResourceNotFound', detail: 'License key has expired.' });
      if (op === 'activate') {
        if (k.activations.size >= k.limit_activations)
          return send(403, { error: 'NotPermitted', detail: 'License key activation limit already reached' });
        const a = { id: `act-${calls.length}`, license_key_id: k.id, label: b.label, meta: b.meta || {} };
        k.activations.set(a.id, a);
        return send(200, { ...a, license_key: keyView(k) });
      }
      if (op === 'validate') {
        const a = b.activation_id ? k.activations.get(b.activation_id) : null;
        if (b.activation_id && !a) return send(404, { error: 'ResourceNotFound', detail: 'License key activation not found.' });
        return send(200, { ...keyView(k), activation: a || null });
      }
      send(405, { detail: 'Method Not Allowed' });
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  cfg = { api: `http://127.0.0.1:${srv.address().port}`, organizationId: ORG };
});
after(() => srv.close());

// Katalog projektu z .git/ i data/panel/ (jak na NAS-ie)
function project() {
  const projectDir = tmpDir();
  fs.mkdirSync(path.join(projectDir, '.git'));
  return { projectDir, dataDir: path.join(projectDir, 'data', 'panel') };
}
const summary = (dataDir) => JSON.parse(fs.readFileSync(path.join(dataDir, license.SUMMARY_FILE), 'utf8'));

test('aktywacja: klucz SSH NAS-a w aktywacji, stan tylko dla roota, podsumowanie dla panelu bez klucza', async () => {
  const k = addKey('KEY-A');
  const p = project();
  const r = await license.activateHere(cfg, { ...p, key: 'KEY-A', label: 'DXP2800', sshKey: SSH });
  assert.equal(r.result, 'ok');
  assert.equal(r.expiresAt, k.expires_at);
  assert.equal(r.limit, 2);
  const [a] = k.activations.values();
  assert.equal(a.label, 'DXP2800');
  assert.deepEqual(a.meta, { ssh_key: SSH });

  const stFile = path.join(p.projectDir, license.STATE_FILE);
  assert.equal(fs.statSync(stFile).mode & 0o777, 0o600);
  const st = license.readState(p.projectDir);
  assert.equal(st.key, 'KEY-A');
  assert.equal(st.activationId, a.id);
  const sum = summary(p.dataDir);
  assert.deepEqual(Object.keys(sum).sort(), ['checkedAt', 'keyEnd', 'state', 'updatesUntil']);
  assert.equal(sum.keyEnd, '', 'krótki klucz – bez końcówki (nie odsłaniamy większości klucza)');
  assert.equal(sum.state, 'active');
  assert.equal(sum.updatesUntil, k.expires_at);
  assert.ok(!JSON.stringify(sum).includes('KEY-A'), 'podsumowanie dla panelu bez klucza licencyjnego');
});

test('ponowne uruchomienie nie zajmuje drugiego urządzenia; nowy klucz SSH zwalnia poprzednie', async () => {
  const k = addKey('KEY-B');
  const p = project();
  const first = await license.activateHere(cfg, { ...p, key: 'KEY-B', label: 'nas', sshKey: SSH });
  const again = await license.activateHere(cfg, { ...p, key: 'KEY-B', label: 'nas', sshKey: SSH });
  assert.equal(first.result, 'ok');
  assert.equal(again.result, 'ok');
  assert.equal(k.activations.size, 1);
  const id1 = license.readState(p.projectDir).activationId;

  await license.activateHere(cfg, { ...p, key: 'KEY-B', label: 'nas', sshKey: SSH2 });
  assert.equal(k.activations.size, 1, 'poprzednia aktywacja zwolniona');
  assert.notEqual(license.readState(p.projectDir).activationId, id1);
  assert.equal([...k.activations.values()][0].meta.ssh_key, SSH2);

  // urządzenie zwolnione u sprzedawcy → kolejne uruchomienie aktywuje NAS od nowa
  k.activations.clear();
  const re = await license.activateHere(cfg, { ...p, key: 'KEY-B', label: 'nas', sshKey: SSH2 });
  assert.equal(re.result, 'ok');
  assert.equal(k.activations.size, 1);
});

test('aktywacja: limit urządzeń, nieznany, cofnięty i wygasły klucz, brak ID organizacji, brak połączenia', async () => {
  addKey('KEY-FULL', { limit: 1 });
  await license.activateHere(cfg, { ...project(), key: 'KEY-FULL', label: 'nas1', sshKey: SSH });
  const full = await license.activateHere(cfg, { ...project(), key: 'KEY-FULL', label: 'nas2', sshKey: SSH2 });
  assert.equal(full.result, 'limit');
  assert.match(full.detail, /limit/);

  assert.equal((await license.activateHere(cfg, { ...project(), key: 'NOPE', label: 'x', sshKey: SSH })).result, 'invalid');
  addKey('KEY-REV', { status: 'revoked' });
  assert.equal((await license.activateHere(cfg, { ...project(), key: 'KEY-REV', label: 'x', sshKey: SSH })).result, 'inactive');
  addKey('KEY-OLD', { days: -1 });
  assert.equal((await license.activateHere(cfg, { ...project(), key: 'KEY-OLD', label: 'x', sshKey: SSH })).result, 'expired');

  const p = project();
  const noOrg = await license.activateHere({ ...cfg, organizationId: '' }, { ...p, key: 'KEY-A', label: 'x', sshKey: SSH });
  assert.equal(noOrg.result, 'config');
  assert.equal(license.readState(p.projectDir), null, 'bez aktywacji nic nie zapisujemy');
  const offline = await license.activateHere(
    { ...cfg, api: 'http://127.0.0.1:9' },
    { ...project(), key: 'KEY-A', label: 'x', sshKey: SSH },
  );
  assert.equal(offline.result, 'network');
});

test('odświeżanie: przedłużenie, wygaśnięcie i cofnięcie licencji; bez połączenia zostaje ostatni stan', async () => {
  const k = addKey('KEY-R', { days: 10 });
  const p = project();
  await license.activateHere(cfg, { ...p, key: 'KEY-R', label: 'nas', sshKey: SSH });

  // przedłużenie u sprzedawcy: nowa data końca aktualizacji
  k.expires_at = new Date(Date.now() + 375 * DAY).toISOString();
  let r = await license.refresh(cfg, p);
  assert.equal(r.result, 'ok');
  assert.equal(summary(p.dataDir).updatesUntil, k.expires_at);

  // wygaśnięcie: po dacie końca Polar zwraca już tylko błąd – data końca zostaje z ostatniego sprawdzenia
  const until = k.expires_at;
  k.expires_at = new Date(Date.now() - DAY).toISOString(); // atrapa liczy czas rzeczywisty
  r = await license.refresh(cfg, { ...p, now: Date.parse(until) + DAY });
  assert.equal(r.result, 'expired');
  assert.equal(r.expiresAt, until);
  assert.equal(summary(p.dataDir).state, 'expired');

  // bez połączenia z Polarem: ostatnia znana data, a po jej minięciu – „expired”
  const offline = { ...cfg, api: 'http://127.0.0.1:9' };
  k.expires_at = until;
  assert.equal((await license.refresh(cfg, p)).result, 'ok');
  assert.equal((await license.refresh(offline, p)).result, 'network');
  assert.equal(summary(p.dataDir).state, 'active');
  assert.equal((await license.refresh(offline, { ...p, now: Date.parse(until) + DAY })).result, 'expired');

  // licencja skrócona u sprzedawcy: Polar mówi „wygasła” przed zapisaną datą – koniec aktualizacji = teraz
  k.expires_at = new Date(Date.now() - 1000).toISOString();
  const early = await license.refresh(cfg, p);
  assert.equal(early.result, 'expired');
  assert.ok(Date.parse(early.expiresAt) <= Date.now() && Date.parse(early.expiresAt) > Date.now() - 60000);
  k.expires_at = until;
  assert.equal((await license.refresh(cfg, p)).result, 'ok');

  // cofnięcie (np. zwrot): stan „inactive” zostaje także bez połączenia
  k.status = 'revoked';
  assert.equal((await license.refresh(cfg, p)).result, 'inactive');
  assert.equal(summary(p.dataDir).state, 'inactive');
  assert.equal((await license.refresh(offline, p)).result, 'network');
  assert.equal(summary(p.dataDir).state, 'inactive');

  // instalacja bez licencji PRO
  assert.equal((await license.refresh(cfg, project())).result, 'none');
});

test('podsumowanie dla panelu: stan z daty, brak pliku albo uszkodzony plik = brak licencji', () => {
  const dir = tmpDir();
  assert.equal(license.readSummary(dir), null);
  fs.writeFileSync(path.join(dir, license.SUMMARY_FILE), '{"state":');
  assert.equal(license.readSummary(dir), null);
  const until = new Date(Date.now() + 5 * DAY).toISOString();
  fs.writeFileSync(path.join(dir, license.SUMMARY_FILE), JSON.stringify({ state: 'active', updatesUntil: until }));
  assert.deepEqual(license.readSummary(dir), { state: 'active', updatesUntil: until, checkedAt: null, keyEnd: '' });
  assert.equal(license.readSummary(dir, Date.now() + 6 * DAY).state, 'expired', 'po dacie końca – wygasły');
  assert.equal(license.licenseInfo(dir).renewUrl, CHECKOUT, 'podsumowanie sprzed zmiany – kasa bez końcówki');
  fs.writeFileSync(path.join(dir, license.SUMMARY_FILE), JSON.stringify({ state: 'active', updatesUntil: until, keyEnd: '00A1B2' }));
  assert.equal(license.readSummary(dir).keyEnd, '00A1B2');
  assert.equal(license.licenseInfo(dir).renewUrl, `${CHECKOUT}?custom_field_data.license_key=00A1B2`);
  fs.writeFileSync(path.join(dir, license.SUMMARY_FILE), JSON.stringify({ state: 'active', keyEnd: '<b>"x' }));
  assert.equal(license.readSummary(dir).keyEnd, '', 'dziwna końcówka – pominięta');

  // przedłużenie: kasa Polara z końcówką klucza w polu license_key; cennik – strona produktu
  assert.equal(license.renewUrl('pl'), CHECKOUT);
  assert.equal(license.renewUrl('en', 'A1B2C3'), `${CHECKOUT}?custom_field_data.license_key=A1B2C3`);
  assert.equal(license.keyEnd(' POSTER-1B2C3D4E-0000-4000-8000-00000000A1B2 '), '00A1B2');
  assert.equal(license.keyEnd(undefined), '');
  assert.equal(license.keyEnd('KEY-SHORT1'), '', 'krótki klucz – bez końcówki');
  assert.equal(license.pricingUrl('pl'), 'https://posterapp.pl/#pricing-pl');
  assert.equal(license.pricingUrl('en'), 'https://posterapp.pl/en/#pricing');
});

test('license-cli.js: aktywacja i odświeżanie z wynikiem w liniach klucz=wartość', async () => {
  const KEY = 'POSTER-5E6F7A8B-0000-4000-8000-000000ABC123';
  const k = addKey(KEY, { days: 30 });
  const { projectDir } = project();
  fs.writeFileSync(path.join(projectDir, '.git', 'poster-pro-key.pub'), SSH + '\n');
  const cli = path.join(__dirname, '..', 'license-cli.js');
  const env = { ...process.env, POLAR_API_URL: cfg.api, POLAR_ORGANIZATION_ID: ORG, POSTER_LANG: 'en' };
  // asynchronicznie – atrapa Polara działa w tym samym procesie
  const run = (args, input = '') =>
    new Promise((resolve, reject) => {
      const child = execFile(process.execPath, [cli, ...args], { cwd: projectDir, env, encoding: 'utf8' }, (err, out) => {
        if (err) return reject(err);
        resolve(
          Object.fromEntries(
            out
              .trim()
              .split('\n')
              .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
          ),
        );
      });
      child.stdin.end(input);
    });
  const a = await run(['activate', 'my-nas', '.git/poster-pro-key.pub'], ` ${KEY} \n`);
  assert.equal(a.result, 'ok');
  assert.equal(a.status, 'granted');
  assert.equal(a.updates_until, k.expires_at.slice(0, 10));
  assert.equal(a.limit, '2');
  assert.equal(a.renew_url, `${CHECKOUT}?custom_field_data.license_key=ABC123`, 'kasa z końcówką klucza');
  const sum = summary(path.join(projectDir, 'data', 'panel'));
  assert.equal(sum.keyEnd, 'ABC123', 'końcówka klucza w podsumowaniu dla panelu');
  assert.ok(!JSON.stringify(sum).includes(KEY), 'bez klucza');
  assert.equal([...k.activations.values()][0].label, 'my-nas');
  const fresh = await run(['refresh']);
  assert.equal(fresh.result, 'ok');
  assert.equal(fresh.renew_url, a.renew_url, 'klucz z zapisanego stanu');
  assert.equal((await run(['activate', 'my-nas', '.git/poster-pro-key.pub'], '\n')).result, 'invalid');
  fs.writeFileSync(path.join(projectDir, 'bad.pub'), 'not a key');
  const bad = await run(['activate', 'my-nas', 'bad.pub'], KEY);
  assert.equal(bad.result, 'error');
  assert.match(bad.detail, /invalid SSH key/);
});

test('klucz z panelu: sprawdzenie bez aktywacji, plik 0600 bez klucza w widoku, błędy, limit prób', async () => {
  const k = addKey('KEY-PANEL-1', { days: 200 });
  const dir = tmpDir();
  const desk = license.createLicenseKey(dir, { cfg });
  assert.equal(desk.view().pending, null);
  assert.equal(desk.view().command, 'sudo bash scripts/upgrade-to-pro.sh', 'katalog projektu nieznany');

  const from = calls.length;
  const r = await desk.check('  KEY-PANEL-1 \n');
  assert.equal(r.result, 'ok');
  assert.equal(r.message, '');
  assert.equal(k.activations.size, 0, 'sprawdzenie nie zajmuje urządzenia');
  assert.deepEqual(
    calls.slice(from).map((c) => [c.op, 'activation_id' in c.body]),
    [['validate', false]],
  );
  const file = path.join(dir, license.PENDING_FILE);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(license.readPending(dir).key, 'KEY-PANEL-1');
  assert.deepEqual(r.pending, { hint: '••••EL-1', checkedAt: r.pending.checkedAt, expiresAt: k.expires_at, limit: 2 });
  assert.ok(!JSON.stringify(desk.view()).includes('KEY-PANEL-1'), 'przeglądarka nie widzi klucza');

  // nieudane sprawdzenie nie rusza zapisanego klucza
  const bad = await desk.check('NOPE-NOPE-1');
  assert.equal(bad.result, 'invalid');
  assert.match(bad.message, /Nieznany klucz/);
  assert.equal(license.readPending(dir).key, 'KEY-PANEL-1');
  addKey('KEY-PANEL-REV', { status: 'revoked' });
  assert.equal((await desk.check('KEY-PANEL-REV')).result, 'inactive');
  addKey('KEY-PANEL-OLD', { days: -1 });
  const old = await desk.check('KEY-PANEL-OLD');
  assert.equal(old.result, 'expired');
  assert.equal(old.pricingUrl, license.pricingUrl('pl'));
  assert.equal(old.termsUrl, 'https://posterapp.pl/license.html?lang=pl', 'warunki licencji – zwrot przed aktywacją');
  assert.equal(license.termsUrl('en'), 'https://posterapp.pl/license.html?lang=en');
  assert.equal(old.renewUrl, `${CHECKOUT}?custom_field_data.license_key=EL-OLD`, 'przedłużenie tego klucza');
  assert.equal(r.renewUrl, undefined, 'ważny klucz – bez linku przedłużenia');
  const offline = license.createLicenseKey(dir, { cfg: { ...cfg, api: 'http://127.0.0.1:9' } });
  const net = await offline.check('KEY-PANEL-1');
  assert.equal(net.result, 'network');
  assert.match(net.message, /Brak połączenia z serwerem licencji/);
  await assert.rejects(desk.check('abc'), (e) => e.status === 400);
  await assert.rejects(desk.check(''), (e) => e.status === 400);

  // limit prób: 10 sprawdzeń na 10 minut
  let t = Date.now();
  const limited = license.createLicenseKey(tmpDir(), { cfg, now: () => t });
  for (let i = 0; i < 10; i++) await limited.check('NOPE-NOPE-2');
  await assert.rejects(limited.check('NOPE-NOPE-2'), (e) => e.status === 429);
  t += 10 * 60000 + 1;
  assert.equal((await limited.check('NOPE-NOPE-2')).result, 'invalid', 'po 10 minutach znowu można');

  assert.equal(desk.clear().pending, null);
  assert.ok(!fs.existsSync(file));
});

test('klucz z panelu: gotowe polecenie z katalogiem projektu z scripts/init-nas.sh', () => {
  const dir = tmpDir();
  const write = (projectDir) => fs.writeFileSync(path.join(dir, license.INSTALL_FILE), JSON.stringify({ projectDir }));
  const desk = license.createLicenseKey(dir, { cfg });
  write('/volume2/docker/poster');
  assert.equal(desk.view().command, 'sudo bash /volume2/docker/poster/scripts/upgrade-to-pro.sh');
  assert.equal(desk.view().projectDir, '/volume2/docker/poster');
  write("/volume1/docker/my poster's");
  assert.equal(desk.view().command, `sudo bash '/volume1/docker/my poster'\\''s/scripts/upgrade-to-pro.sh'`);
  write('relative/path');
  assert.equal(desk.view().command, 'sudo bash scripts/upgrade-to-pro.sh', 'tylko ścieżka bezwzględna');
  fs.writeFileSync(path.join(dir, license.INSTALL_FILE), '{"projectDir":');
  assert.equal(desk.view().projectDir, null);
});

test('license-cli.js --pending: klucz z panelu bez pytania, kopia znika po aktywacji, przy błędzie sieci zostaje', async () => {
  const k = addKey('KEY-PEND', { days: 90 });
  const { projectDir, dataDir } = project();
  fs.writeFileSync(path.join(projectDir, '.git', 'poster-pro-key.pub'), SSH + '\n');
  const cli = path.join(__dirname, '..', 'license-cli.js');
  const run = (args, env = {}) =>
    new Promise((resolve, reject) => {
      const e = { ...process.env, POLAR_API_URL: cfg.api, POLAR_ORGANIZATION_ID: ORG, POSTER_LANG: 'pl', ...env };
      const child = execFile(process.execPath, [cli, ...args], { cwd: projectDir, env: e, encoding: 'utf8' }, (err, out) =>
        err
          ? reject(err)
          : resolve(
              Object.fromEntries(
                out
                  .trim()
                  .split('\n')
                  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
              ),
            ),
      );
      child.stdin.end('KLUCZ-ZE-STDIN-NIEUZYWANY');
    });
  const args = ['activate', 'nas', '.git/poster-pro-key.pub', '--pending'];
  assert.equal((await run(args)).result, 'none', 'bez klucza w panelu');

  const desk = license.createLicenseKey(dataDir, { cfg });
  assert.equal((await desk.check('KEY-PEND')).result, 'ok');
  // bez połączenia z Polarem: kopia zostaje na ponowienie
  assert.equal((await run(args, { POLAR_API_URL: 'http://127.0.0.1:9' })).result, 'network');
  assert.ok(license.readPending(dataDir));
  const ok = await run(args);
  assert.equal(ok.result, 'ok');
  assert.equal(ok.updates_until, k.expires_at.slice(0, 10));
  assert.equal(k.activations.size, 1);
  assert.equal(license.readPending(dataDir), null, 'kopia klucza usunięta po aktywacji');
  assert.equal(license.readState(projectDir).key, 'KEY-PEND');
  // ponowne uruchomienie skryptu (np. dostęp do repozytorium PRO jeszcze niegotowy): klucz z poprzedniej aktywacji,
  // ta sama aktywacja – bez drugiego urządzenia
  const savedArgs = ['activate', 'nas', '.git/poster-pro-key.pub', '--saved'];
  assert.equal((await run(savedArgs)).result, 'ok');
  assert.equal(k.activations.size, 1);
  const other = project();
  fs.writeFileSync(path.join(other.projectDir, '.git', 'poster-pro-key.pub'), SSH + '\n');
  const none = await new Promise((resolve, reject) =>
    execFile(
      process.execPath,
      [cli, ...savedArgs],
      { cwd: other.projectDir, env: { ...process.env, POLAR_API_URL: cfg.api, POLAR_ORGANIZATION_ID: ORG, POSTER_LANG: 'pl' } },
      (err, out) => (err ? reject(err) : resolve(out)),
    ),
  );
  assert.match(none, /^result=none$/m, 'bez zapisanej aktywacji nic do użycia');

  // nieznany klucz z panelu jest bezużyteczny – znika
  fs.writeFileSync(path.join(dataDir, license.PENDING_FILE), JSON.stringify({ key: 'NOPE-NOPE-3' }));
  assert.equal((await run(args)).result, 'invalid');
  assert.equal(license.readPending(dataDir), null);
});
