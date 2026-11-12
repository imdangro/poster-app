'use strict';
// Tekst w HTML (wiadomości Telegrama z parse_mode HTML, strony panelu): &, <, > i cudzysłów – adres może trafić do
// atrybutu href="…".
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Znaczniki i elementy z treści obcych serwerów (strona artykułu, kanał RSS) w czasie liniowym. Wyrażenia w rodzaju
// /<meta\b[^>]*>/g albo /<item>[\s\S]*?<\/item>/g na treści z tysiącami otwarć bez zamknięcia liczą się kwadratowo –
// strona 600 kB zatrzymywała cały panel na ponad minutę (limit czasu pobierania nie przerywa wyrażenia regularnego).
// Tu każdy znak jest czytany najwyżej kilka razy: po znaczniku szukanie rusza dalej za jego końcem.
const MAX_TAG = 16 * 1024;
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Znaczniki otwierające <name …> (bez względu na wielkość liter): znacznik kończy się na najbliższym „>”.
// Dłuższe niż `max` znaków są pomijane.
function* tagsOf(html, name, max = MAX_TAG) {
  const text = String(html ?? '');
  const open = new RegExp(`<${reEsc(name)}(?=[\\s/>])`, 'gi');
  for (let m = open.exec(text); m; m = open.exec(text)) {
    const end = text.indexOf('>', m.index);
    if (end < 0) return; // bez „>” do końca treści nie ma już żadnego znacznika
    if (end + 1 - m.index <= max) yield text.slice(m.index, end + 1);
    open.lastIndex = end + 1;
  }
}

// Elementy <name …>…</name> dla nazw z listy, w kolejności w dokumencie: { name, outer, inner }. Element kończy się
// na najbliższym znaczniku zamykającym tej samej nazwy, a szukanie rusza dalej za nim (elementy się nie zagnieżdżają).
// Nazwa bez znacznika zamykającego do końca treści jest dalej pomijana – bez ponownego czytania reszty dokumentu.
function* elementsOf(xml, names) {
  const text = String(xml ?? '');
  const open = new RegExp(`<(${names.map(reEsc).join('|')})(?=[\\s>])`, 'gi');
  const unclosed = new Set();
  for (let m = open.exec(text); m; m = open.exec(text)) {
    const name = m[1].toLowerCase();
    if (unclosed.has(name)) continue;
    const gt = text.indexOf('>', m.index);
    if (gt < 0) return;
    const close = new RegExp(`</${reEsc(name)}>`, 'gi');
    close.lastIndex = gt + 1;
    const c = close.exec(text);
    if (!c) {
      unclosed.add(name);
      continue;
    }
    const end = c.index + c[0].length;
    yield { name, outer: text.slice(m.index, end), inner: text.slice(gt + 1, c.index) };
    open.lastIndex = end;
  }
}

// Treść pierwszego elementu o jednej z nazw ('' – brak)
function firstElement(xml, names) {
  for (const el of elementsOf(xml, names)) return el.inner;
  return '';
}

module.exports = { esc, tagsOf, elementsOf, firstElement };
