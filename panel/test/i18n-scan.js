'use strict';
// Skaner tekstów do tłumaczenia: literały napisów z kodu JS (bez parsera npm) i teksty z tr('…').
// Używają go test tłumaczeń i eksport wersji programu.

// ---------------------------------------------------------------------------------------------- mini-tokenizer JS
// Zwraca literały napisów ('…', "…", `…`) z pozycją w pliku; pomija komentarze i wyrażenia regularne.
const REGEX_AFTER = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_AFTER_WORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw']);

function literals(src) {
  const out = [];
  const templates = []; // otwarte szablony `…${ – rekord i głębokość nawiasów { w wyrażeniu
  const n = src.length;
  let i = 0;
  let prev = '';
  // czyta szablon od bieżącej pozycji do ` (koniec) albo ${ (wyrażenie)
  const readTemplate = (rec) => {
    while (i < n) {
      const ch = src[i];
      if (ch === '\\') {
        rec.raw += src.slice(i, i + 2);
        i += 2;
      } else if (ch === '`') {
        i++;
        return 'end';
      } else if (ch === '$' && src[i + 1] === '{') {
        rec.raw += '{}';
        i += 2;
        return 'expr';
      } else {
        rec.raw += ch;
        i++;
      }
    }
    return 'end';
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const e = src.indexOf('\n', i);
      i = e < 0 ? n : e;
    } else if (c === '/' && d === '*') {
      i = src.indexOf('*/', i + 2) + 2;
    } else if (c === "'" || c === '"') {
      const rec = { start: i, quote: c, raw: '' };
      i++;
      while (i < n && src[i] !== c) {
        const step = src[i] === '\\' ? 2 : 1;
        rec.raw += src.slice(i, i + step);
        i += step;
      }
      i++;
      out.push(rec);
      prev = 'str';
    } else if (c === '`') {
      const rec = { start: i, quote: c, raw: '' };
      out.push(rec);
      i++;
      if (readTemplate(rec) === 'expr') templates.push({ rec, depth: 0 });
      prev = 'str';
    } else if (c === '}' && templates.length && templates[templates.length - 1].depth === 0) {
      const t = templates.pop();
      i++;
      if (readTemplate(t.rec) === 'expr') templates.push(t);
      prev = 'str';
    } else if (c === '/' && (REGEX_AFTER.has(prev) || REGEX_AFTER_WORDS.has(prev))) {
      i++;
      let inClass = false;
      while (i < n && src[i] !== '\n') {
        const ch = src[i];
        if (ch === '\\') i++;
        else if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) break;
        i++;
      }
      i++;
      while (/[a-z]/i.test(src[i] || '')) i++;
      prev = 'regex';
    } else if (/\s/.test(c)) {
      i++;
    } else if (/[\w$]/.test(c)) {
      let w = '';
      while (i < n && /[\w$]/.test(src[i])) w += src[i++];
      prev = w;
    } else {
      if (templates.length && c === '{') templates[templates.length - 1].depth++;
      if (templates.length && c === '}') templates[templates.length - 1].depth--;
      prev = c;
      i++;
    }
  }
  return out;
}

// Wartość literału '…' / "…" (sekwencje \n, \', \u… itd.)
const unquote = (rec) => JSON.parse(`"${rec.quote === "'" ? rec.raw.replace(/\\'/g, "'").replace(/"/g, '\\"') : rec.raw}"`);
// literał jest pierwszym argumentem tr() / trBoth()
const TR_BEFORE = /(?<![\w$.])(tr|trBoth)\(\s*$/;
const isTrKey = (src, rec) => TR_BEFORE.test(src.slice(Math.max(0, rec.start - 40), rec.start));
const lineOf = (src, pos) => src.slice(0, pos).split('\n').length;

// Teksty tr('…') z plików [{ file, src }] → Map(tekst → „plik:linia”). Błąd (Error), gdy pierwszym argumentem tr()
// nie jest zwykły literał – tylko wtedy da się sprawdzić słownik.
function trKeys(files) {
  const keys = new Map();
  for (const { file, src } of files) {
    for (const m of src.matchAll(/(?<![\w$.]|function )(?:tr|trBoth)\(\s*(?=[^\s'")])/g)) {
      const line = lineOf(src, m.index);
      if (!/^\s*(\/\/|\*)/.test(src.split('\n')[line - 1])) throw new Error(`${file}:${line}: tr() potrzebuje literału '…'`);
    }
    for (const rec of literals(src)) {
      if (!isTrKey(src, rec)) continue;
      if (rec.quote === '`') throw new Error(`${file}:${lineOf(src, rec.start)}: tr() potrzebuje literału '…', nie szablonu`);
      const key = unquote(rec);
      if (!keys.has(key)) keys.set(key, `${file}:${lineOf(src, rec.start)}`);
    }
  }
  return keys;
}

module.exports = { literals, unquote, isTrKey, lineOf, trKeys };
