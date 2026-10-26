'use strict';
// Licencja PRO z wiersza poleceń – dla scripts/upgrade-to-pro.sh i scripts/update.sh. Skrypty uruchamiają ją obrazem
// panelu (Node.js z kontenera – na NAS-ie nie trzeba go instalować), z katalogiem projektu jako bieżącym:
//   node panel/license-cli.js activate <nazwa urządzenia> <klucz SSH .pub>   (klucz licencyjny – standardowe wejście)
//   node panel/license-cli.js activate <nazwa urządzenia> <klucz SSH .pub> --pending   (klucz wklejony w panelu)
//   node panel/license-cli.js activate <nazwa urządzenia> <klucz SSH .pub> --saved     (klucz z poprzedniej aktywacji)
//   node panel/license-cli.js refresh
// Wynik: linie klucz=wartość (result, status, updates_until, days_left, limit, renew_url, product_url, detail),
// komunikaty wypisują skrypty (scripts/license.sh). Kod wyjścia 0, gdy polecenie się wykonało – także gdy licencja
// jest nieważna.
const fs = require('fs');
const path = require('path');
const { polarConfig, renewUrl, keyEnd, activateHere, refresh, readState, readPending, clearPending } = require('./lib/license');
const { PRODUCT_URL } = require('./lib/util');
const { setLanguageSource, lang, tr } = require('./lib/i18n');

setLanguageSource(() => process.env.POSTER_LANG); // język skryptów (scripts/lang.sh)

const projectDir = process.cwd();
const dataDir = path.join(projectDir, 'data', 'panel');
const SSH_KEY = /^ssh-ed25519 [A-Za-z0-9+/]+={0,2}( [^\r\n]*)?$/;

// key – klucz licencyjny (do linku przedłużenia z jego końcówką), gdy jest znany
function print(out, key) {
  const until = out.expiresAt ? Date.parse(out.expiresAt) : NaN;
  const lines = {
    result: out.result,
    status: out.status,
    updates_until: out.expiresAt ? out.expiresAt.slice(0, 10) : '',
    days_left: Number.isFinite(until) ? Math.ceil((until - Date.now()) / 86400000) : '',
    limit: out.limit ?? '',
    renew_url: renewUrl(lang(), keyEnd(key)),
    product_url: `${PRODUCT_URL}?lang=${lang()}`,
    detail: out.detail,
  };
  // jedna linia na wartość – skrypt czyta je przez `read`
  for (const [k, v] of Object.entries(lines)) {
    const value = String(v ?? '').replace(/[\r\n\t]+/g, ' ');
    if (value) console.log(`${k}=${value.slice(0, 300)}`);
  }
}

// Klucz z panelu znika po udanej aktywacji i gdy jest bezużyteczny (nieznany, cofnięty); przy wygaśnięciu, zajętych
// urządzeniach i błędach połączenia zostaje – ponowienie po przedłużeniu albo zwolnieniu urządzenia nie wymaga wklejania
const CLEAR_PENDING = ['ok', 'invalid', 'inactive'];

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const pending = rest.includes('--pending');
  const saved = rest.includes('--saved');
  const args = rest.filter((a) => a !== '--pending' && a !== '--saved');
  const cfg = polarConfig();
  if (cmd === 'activate' && args.length === 2) {
    const [label, pubFile] = args;
    const fromPanel = pending ? readPending(dataDir) : null;
    if (pending && !fromPanel) return print({ result: 'none', detail: tr('w panelu nie ma klucza licencyjnego') });
    // ponowne uruchomienie (np. gdy dostęp do repozytorium PRO nie był jeszcze gotowy) – ten sam klucz i aktywacja
    const fromState = saved ? readState(projectDir) : null;
    if (saved && !fromState) return print({ result: 'none', detail: tr('brak zapisanego klucza licencyjnego') });
    const key = fromPanel ? fromPanel.key : fromState ? fromState.key : fs.readFileSync(0, 'utf8').trim();
    const sshKey = fs.readFileSync(pubFile, 'utf8').trim();
    if (!key) return print({ result: 'invalid', detail: tr('nie podano klucza licencyjnego') });
    if (!SSH_KEY.test(sshKey)) return print({ result: 'error', detail: tr('nieprawidłowy klucz SSH NAS-a: {0}', pubFile) });
    const out = await activateHere(cfg, { projectDir, dataDir, key, label, sshKey });
    if (fromPanel && CLEAR_PENDING.includes(out.result)) clearPending(dataDir);
    return print(out, key);
  }
  if (cmd === 'refresh') {
    const st = readState(projectDir);
    return print(await refresh(cfg, { projectDir, dataDir }), st && st.key);
  }
  console.error('usage: node panel/license-cli.js activate <label> <key.pub> [--pending | --saved] | refresh');
  process.exitCode = 2;
}

main().catch((e) => {
  print({ result: 'error', detail: e.message });
  process.exitCode = 1;
});
