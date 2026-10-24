'use strict';
// Język komunikatów serwera panelu (błędy API, Telegram, logi). Teksty piszemy po polsku w tr('…', ...args)
// z miejscami {0}, {1}…; wersja angielska jest w i18n-en.js (klucz = tekst polski). Język wybiera użytkownik
// w panelu (config.json → global.ui.language), domyślnie polski. Prompty AI zostają po polsku.
const { AsyncLocalStorage } = require('async_hooks');
const EN = require('./i18n-en');

const LANGUAGES = ['pl', 'en'];
let source = () => 'pl';
// język zapytania z przeglądarki (nagłówek x-poster-lang) – ma pierwszeństwo, np. przed wyborem języka w panelu
const requestLanguage = new AsyncLocalStorage();

// server.js podaje funkcję czytającą język z konfiguracji (zmiana w panelu działa od razu)
function setLanguageSource(fn) {
  source = typeof fn === 'function' ? fn : () => 'pl';
}

function lang() {
  let l = requestLanguage.getStore();
  if (!l) {
    try {
      l = source();
    } catch (e) {}
  }
  return LANGUAGES.includes(l) ? l : 'pl';
}

// fn() i wszystko, co uruchomi (także asynchronicznie), pisze w języku `language` (nieznany = ustawienia panelu)
function withLanguage(language, fn) {
  return LANGUAGES.includes(language) ? requestLanguage.run(language, fn) : fn();
}

const format = (s, args) => (args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[i] === undefined ? m : String(args[i]))) : s);

function trIn(language, text, ...args) {
  return format((language === 'en' && EN[text]) || text, args);
}

function tr(text, ...args) {
  return trIn(lang(), text, ...args);
}

// Komunikat w obu językach (dwie linie) – dla logów, zanim wiadomo, jaki język wybrał użytkownik
// (np. kod do ustawienia pierwszego hasła).
function trBoth(text, ...args) {
  const pl = trIn('pl', text, ...args);
  const en = trIn('en', text, ...args);
  return pl === en ? pl : `${pl}\n${en}`;
}

module.exports = { LANGUAGES, setLanguageSource, withLanguage, lang, tr, trIn, trBoth };
