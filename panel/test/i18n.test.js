'use strict';
// Tłumaczenia: każdy tekst z tr('…') ma wersję angielską, słowniki nie mają zbędnych wpisów, miejsca {0}, {1}…
// się zgadzają, a polskie teksty dla użytkownika nie zostały poza tr() (heurystyka: polskie znaki i typowe słowa).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { literals, unquote, isTrKey, lineOf, trKeys } = require('./i18n-scan');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const list = (dir) =>
  fs
    .readdirSync(path.join(ROOT, dir), { recursive: true })
    .filter((f) => f.endsWith('.js'))
    .map((f) => `${dir}/${f.split(path.sep).join('/')}`)
    .sort();

// W repozytorium źródłowym pliki mają znaczniki wersji (tools/editions.js) – sprawdzamy wersję PRO i LITE.
// W wydanej wersji LITE albo PRO znaczników już nie ma, więc sprawdzamy pliki takie, jakie są.
const EDITIONS_FILE = path.join(ROOT, 'tools', 'editions.js');
const editions = fs.existsSync(EDITIONS_FILE) ? require(EDITIONS_FILE) : null;
const VERSIONS = editions ? ['pro', 'lite'] : ['released'];
function sources(files, version) {
  return files
    .filter((file) => version === 'released' || editions.included(file, version))
    .map((file) => ({
      file,
      src: version === 'released' ? read(file) : editions.view(read(file), version, editions.syntaxOf(file), file),
    }));
}

// prompty AI zostają po polsku (bez tr())
const PROMPT_FILES = ['panel/lib/compose-prompt.js'];
const SERVER_FILES = [
  'panel/server.js',
  'panel/reset-password.js',
  'panel/license-cli.js',
  ...list('panel/lib').filter((f) => !/\/i18n(-en)?\.js$/.test(f) && !PROMPT_FILES.includes(f)),
];
const UI_FILES = ['panel/public/app.js'];
// prompty AI zostają po polsku
const WORKFLOW_FILES = list('workflows/src/code').filter((f) => !f.endsWith('/build_prompt.js'));

const placeholders = (s) => (s.match(/\{\d+\}/g) || []).sort().join(',');

// Każda wersja: każdy tekst ma tłumaczenie z tymi samymi {0}, {1}…; słownik nie ma wpisów spoza obu wersji.
function checkDictionary(files, dict, dictFile) {
  const used = new Set();
  for (const version of VERSIONS) {
    const keys = trKeys(sources(files, version));
    const missing = [...keys].filter(([k]) => typeof dict[k] !== 'string' || !dict[k].trim()).map(([k, at]) => `${at}  ${k}`);
    assert.deepEqual(missing, [], `brak tłumaczenia w ${dictFile} (wersja ${version})`);
    const bad = [...keys.keys()].filter((k) => placeholders(k) !== placeholders(dict[k]));
    assert.deepEqual(bad, [], `{0}, {1}… w tłumaczeniu nie zgadzają się z tekstem polskim (${dictFile})`);
    for (const k of keys.keys()) used.add(k);
  }
  assert.deepEqual(
    Object.keys(dict).filter((k) => !used.has(k)),
    [],
    `nieużywane wpisy w ${dictFile}`,
  );
}

test('serwer: każdy tekst tr() ma tłumaczenie, bez zbędnych wpisów', () => {
  checkDictionary(SERVER_FILES, require('../lib/i18n-en'), 'panel/lib/i18n-en.js');
});

test('interfejs: każdy tekst tr() ma tłumaczenie, bez zbędnych wpisów', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(read('panel/public/i18n-en.js'), sandbox);
  checkDictionary(UI_FILES, sandbox.window.POSTER_I18N.en, 'panel/public/i18n-en.js');
});

// ---------------------------------------------------------------------------------------------- polskie teksty poza tr()
const POLISH_WORDS =
  /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]|\b(nie|brak|jest|dla|oraz|albo|lub|przez|bez|tylko|gdy|jeszcze|bota|zapisz|wybierz|podaj|teraz|wpisz|kliknij|czatu|hashtagi|kopia|harmonogram|ustawienia|konto|konta|wpisy|dodaj|gotowe)\b/i;
// typowe polskie końcówki: odrzucono, opublikowano, zatwierdzenie, skonfigurowany, nowych, nowego
const POLISH_ENDINGS = /\b[a-z]{3,}(ono|ano|enie|anie|owany|owane|owych|ych|ego)\b/i;
const POLISH_ABBR = /(^|[\s(])([Nn]p|ok)\. /; // „np. …”, „ok. 0,20 USD”
const isPolish = (text) => POLISH_WORDS.test(text) || POLISH_ENDINGS.test(text) || POLISH_ABBR.test(text);
// celowo po polsku: prompt AI, nazwy języków postów (wartość trafia do promptu, na ekranie jest tr())
const ALLOWED = [
  /Odpowiedz WYŁĄCZNIE jednym poprawnym obiektem JSON/,
  /^(polski|angielski|niemiecki|hiszpański|francuski|włoski|ukraiński|czeski)$/,
];

function untranslated(files, { skip = () => false } = {}) {
  const found = new Set();
  for (const version of VERSIONS) {
    for (const { file, src } of sources(files, version)) {
      const lines = src.split('\n');
      for (const rec of literals(src)) {
        const text = rec.quote === '`' ? rec.raw : unquote(rec);
        if (!isPolish(text.replace(/\{\}/g, ' ')) || ALLOWED.some((re) => re.test(text))) continue;
        if (isTrKey(src, rec)) continue;
        const line = lineOf(src, rec.start);
        if (skip(text, lines[line - 1])) continue;
        found.add(`${file}:${line} (${version})  ${JSON.stringify(text).slice(0, 100)}`);
      }
    }
  }
  return [...found];
}

test('serwer i interfejs: polskie teksty tylko w tr()', () => {
  assert.deepEqual(untranslated([...SERVER_FILES, ...UI_FILES]), []);
});

test('workflow: polskie teksty w węzłach Code tylko w tr() (poza nazwami węzłów i logami n8n)', () => {
  const nodeNames = new Set(JSON.parse(read('workflows/poster_workflow.json')).nodes.map((n) => n.name));
  const found = untranslated(WORKFLOW_FILES, { skip: (text, line) => nodeNames.has(text) || /\bconsole\.(log|warn|error)\(/.test(line) });
  assert.deepEqual(found, []);
});

test('i18n serwera: język z ustawień, z zapytania i komunikaty w obu językach', () => {
  const i18n = require('../lib/i18n');
  let configured = '';
  i18n.setLanguageSource(() => configured);
  try {
    assert.equal(i18n.lang(), 'pl', 'niewybrany język = polski');
    assert.equal(i18n.tr('Nie ma takiego bota'), 'Nie ma takiego bota');
    configured = 'en';
    assert.equal(i18n.tr('Nie ma takiego bota'), 'No such bot');
    assert.equal(i18n.tr('Niepoprawny adres RSS: {0}', 'x'), 'Invalid RSS address: x');
    assert.equal(i18n.tr('Tekst bez tłumaczenia {0}', 1), 'Tekst bez tłumaczenia 1');
    configured = 'xx';
    assert.equal(i18n.lang(), 'pl', 'nieznany język = polski');
    // język zapytania (nagłówek panelu) ma pierwszeństwo – także w kodzie asynchronicznym
    const r = i18n.withLanguage('en', async () => {
      await new Promise((ok) => setTimeout(ok, 5));
      return i18n.tr('Nie ma takiego bota');
    });
    assert.equal(
      i18n.withLanguage('de', () => i18n.lang()),
      'pl',
    );
    assert.equal(i18n.trBoth('Błąd: {0}', 'x'), 'Błąd: x\nError: x');
    return r.then((v) => assert.equal(v, 'No such bot'));
  } finally {
    i18n.setLanguageSource(() => 'pl');
  }
});
