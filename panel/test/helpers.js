'use strict';
// Wspólne pomocniki testów (node:test, bez zależności npm).
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const tmpDirs = [];

// Katalog tymczasowy usuwany po zakończeniu testów
function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-test-'));
  tmpDirs.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// Wolny port TCP na 127.0.0.1
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Czeka, aż warunek będzie spełniony (np. komunikat w logach serwera)
async function waitFor(check, timeoutMs = 10000, what = 'warunek') {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Nie doczekano się: ${what}`);
}

module.exports = { tmpDir, freePort, waitFor };
