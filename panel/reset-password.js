'use strict';
// Reset hasła panelu: sudo docker compose exec panel node reset-password.js
// Usuwa hasło (wylogowuje wszystkie sesje) i wypisuje jednorazowy kod – w przeglądarce ustawiasz z nim nowe hasło.
// Działa od razu: panel sam zauważy zmianę pliku auth.json, restart nie jest potrzebny.
// Komunikaty w obu językach (PL i EN) – skrypt nie czyta ustawień panelu.
const path = require('path');
const { newSetupCode } = require('./lib/auth');
const { writeJsonAtomic } = require('./lib/util');
const { trBoth } = require('./lib/i18n');

const file = path.join(process.env.POSTER_DATA_DIR || '/data', 'auth.json');
try {
  const setupCode = newSetupCode();
  writeJsonAtomic(file, { setupCode, createdAt: new Date().toISOString() }, 0o600);
  console.log(trBoth('Hasło panelu zostało usunięte, a wszystkie sesje wylogowane.'));
  console.log(trBoth('Otwórz panel w przeglądarce i ustaw nowe hasło, podając kod: {0}', setupCode));
} catch (e) {
  console.error(trBoth('Błąd: {0}', e.message));
  process.exitCode = 1;
}
