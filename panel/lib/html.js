'use strict';
// Tekst w HTML (wiadomości Telegrama z parse_mode HTML, strony panelu): &, <, > i cudzysłów – adres może trafić do
// atrybutu href="…".
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

module.exports = { esc };
