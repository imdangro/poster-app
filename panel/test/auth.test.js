'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const { Auth, newSetupCode } = require('../lib/auth');
const { writeJsonAtomic } = require('../lib/util');
const { tmpDir } = require('./helpers');

const CODE_RE = /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;
const quiet = () => {};
const req = (headers = {}) => ({ headers });
const cookieOf = (setCookie) => setCookie.split(';')[0];

test('kod pierwszego uruchomienia: format bez mylących się znaków', () => {
  for (let i = 0; i < 50; i++) assert.match(newSetupCode(), CODE_RE);
});

test('bez hasła panel tworzy jeden kod i loguje go raz', () => {
  const logs = [];
  const auth = new Auth(tmpDir(), { log: (m) => logs.push(m) });
  assert.equal(auth.needsSetup, true);
  const code = auth.setupCode();
  assert.match(code, CODE_RE);
  assert.equal(auth.setupCode(), code, 'kolejne wywołanie zwraca ten sam kod');
  assert.equal(logs.length, 1);
  assert.ok(logs[0].includes(code));
});

test('kod przyjmowany bez względu na wielkość liter i myślniki, zły kod odrzucony', () => {
  const auth = new Auth(tmpDir(), { log: quiet });
  const code = auth.setupCode();
  assert.equal(auth.checkSetupCode(code.toLowerCase().replace(/-/g, '')), true);
  assert.equal(auth.checkSetupCode(` ${code} `), true);
  assert.equal(auth.checkSetupCode('AAAA-BBBB-CCCC'), false);
  assert.equal(auth.checkSetupCode(''), false);
  assert.equal(auth.checkSetupCode(undefined), false);
});

test('po ustawieniu hasła kod przestaje działać, a logowanie sprawdza hasło', async () => {
  const auth = new Auth(tmpDir(), { log: quiet });
  const code = auth.setupCode();
  await auth.setPassword('dobrehaslo123');
  assert.equal(auth.needsSetup, false);
  assert.equal(auth.setupCode(), null);
  assert.equal(auth.checkSetupCode(code), false);
  assert.equal(await auth.verify('dobrehaslo123'), true);
  assert.equal(await auth.verify('zlehaslo123'), false);
  await assert.rejects(auth.setPassword('krotkie'), /co najmniej 8 znaków/);
});

test('sesja: podpisane ciasteczko, podróbka i wygasłe odrzucone', async () => {
  const auth = new Auth(tmpDir(), { log: quiet });
  await auth.setPassword('dobrehaslo123');
  const cookie = cookieOf(auth.createCookie(req()));
  assert.equal(auth.isAuthenticated(req({ cookie })), true);
  assert.equal(auth.isAuthenticated(req({ cookie: cookie.slice(0, -2) + 'xx' })), false);
  const expired = `poster_session=${Date.now() - 1000}.${auth.sign(String(Date.now() - 1000))}`;
  assert.equal(auth.isAuthenticated(req({ cookie: expired })), false);
  assert.equal(auth.isAuthenticated(req({})), false);
});

test('flaga Secure tylko za proxy z HTTPS', async () => {
  const auth = new Auth(tmpDir(), { log: quiet });
  await auth.setPassword('dobrehaslo123');
  assert.doesNotMatch(auth.createCookie(req()), /Secure/);
  assert.match(auth.createCookie(req({ 'x-forwarded-proto': 'https' })), /; Secure/);
  assert.match(auth.clearCookie(req({ 'x-forwarded-proto': 'https, http' })), /; Secure/);
  assert.match(auth.createCookie(req()), /HttpOnly; SameSite=Lax/);
});

test('reset hasła w innym procesie działa bez restartu panelu i wylogowuje sesje', async () => {
  const dir = tmpDir();
  const auth = new Auth(dir, { log: quiet });
  await auth.setPassword('starehaslo123');
  const cookie = cookieOf(auth.createCookie(req()));
  assert.equal(auth.isAuthenticated(req({ cookie })), true);

  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'reset-password.js')], {
    env: { ...process.env, POSTER_DATA_DIR: dir },
    encoding: 'utf8',
  });
  const code = (out.match(/kod: ([A-Z0-9-]+)/) || [])[1];
  assert.match(code, CODE_RE);

  assert.equal(auth.needsSetup, true);
  assert.equal(auth.isAuthenticated(req({ cookie })), false);
  assert.equal(await auth.verify('starehaslo123'), false);
  assert.equal(auth.checkSetupCode(code), true);
});

test('usunięty auth.json: panel sam tworzy nowy kod', async () => {
  const dir = tmpDir();
  const logs = [];
  const auth = new Auth(dir, { log: (m) => logs.push(m) });
  await auth.setPassword('starehaslo123');
  writeJsonAtomic(path.join(dir, 'auth.json'), {}); // np. ręczna edycja pliku
  assert.equal(auth.needsSetup, true);
  assert.match(auth.setupCode(), CODE_RE);
  assert.equal(logs.length, 1);
});

test('limit prób: po 8 nieudanych kolejna próba zablokowana', () => {
  const auth = new Auth(tmpDir(), { log: quiet });
  for (let i = 0; i < 8; i++) {
    auth.checkRate('10.0.0.1');
    auth.fail('10.0.0.1');
  }
  assert.throws(
    () => auth.checkRate('10.0.0.1'),
    (e) => e.status === 429,
  );
  assert.doesNotThrow(() => auth.checkRate('10.0.0.2'));
});

test('limit prób: zapytania wysłane naraz nie mijają limitu, a poprawne hasło go nie zużywa', async () => {
  const auth = new Auth(tmpDir(), { log: quiet });
  await auth.setPassword('dobrehaslo123');
  // 30 prób naraz: licznik rośnie przed sprawdzeniem hasła, więc tylko 8 dochodzi do scrypt
  let checked = 0;
  const tries = await Promise.allSettled(
    Array.from({ length: 30 }, (_, i) =>
      auth.attempt('10.0.0.1', () => {
        checked++;
        return auth.verify(`zlehaslo${i}`);
      }),
    ),
  );
  assert.equal(tries.filter((t) => t.status === 'fulfilled' && t.value === false).length, 8);
  assert.equal(tries.filter((t) => t.status === 'rejected' && t.reason.status === 429).length, 22);
  assert.equal(checked, 8);
  await assert.rejects(
    auth.attempt('10.0.0.1', () => auth.verify('dobrehaslo123')),
    (e) => e.status === 429,
  );
  // udane logowania (inny adres) nie liczą się do limitu – ani tego adresu, ani wspólnego
  for (let i = 0; i < 50; i++) assert.equal(await auth.attempt('10.0.0.2', () => auth.verify('dobrehaslo123')), true);
  assert.equal(auth.failures.has('10.0.0.2'), false);
  assert.equal(auth.failures.get('*').count, 8);
});

test('limit prób: wspólny dla wszystkich adresów (podrobione X-Forwarded-For), adres klienta za proxy w sieci lokalnej', () => {
  const auth = new Auth(tmpDir(), { log: quiet });
  // 40 nieudanych prób z różnych adresów – potem blokada dla wszystkich (na 15 min)
  for (let i = 0; i < 40; i++) {
    auth.checkRate(`198.51.100.${i}`);
    auth.fail(`198.51.100.${i}`);
  }
  assert.throws(
    () => auth.checkRate('203.0.113.7'),
    (e) => e.status === 429,
  );
  // odwrotne proxy w sieci lokalnej: adres klienta z X-Forwarded-For; bezpośrednie połączenie z internetu – adres połączenia
  const r = (remote, xff) => ({ socket: { remoteAddress: remote }, headers: xff ? { 'x-forwarded-for': xff } : {} });
  assert.equal(auth.clientKey(r('::ffff:192.168.1.5', '203.0.113.9, 192.168.1.5')), '203.0.113.9');
  assert.equal(auth.clientKey(r('127.0.0.1', '203.0.113.9')), '203.0.113.9');
  assert.equal(auth.clientKey(r('93.184.216.34', '203.0.113.9')), '93.184.216.34');
  assert.equal(auth.clientKey(r('::ffff:192.168.1.5')), '192.168.1.5');
});

test('wyloguj na wszystkich urządzeniach: każde wydane ciasteczko przestaje działać, hasło bez zmian', async () => {
  const auth = new Auth(tmpDir(), { log: quiet });
  await auth.setPassword('dobrehaslo1');
  const phone = req({ cookie: cookieOf(auth.createCookie()) });
  const laptop = req({ cookie: cookieOf(auth.createCookie()) });
  assert.equal(auth.isAuthenticated(phone), true);
  auth.logoutEverywhere();
  assert.equal(auth.isAuthenticated(phone), false);
  assert.equal(auth.isAuthenticated(laptop), false);
  assert.equal(await auth.verify('dobrehaslo1'), true);
  assert.equal(auth.isAuthenticated(req({ cookie: cookieOf(auth.createCookie()) })), true, 'nowe logowanie działa');
});
