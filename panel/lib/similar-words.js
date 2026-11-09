'use strict';
// Słowa do porównywania tekstów (sprawdzanie powtórek, lib/similar.js) – dane, nie teksty dla użytkownika (bez tr()).

// Słowa pospolite (po usunięciu polskich znaków, małymi literami) – pomijane przed porównaniem
const STOP = new Set(
  // polskie
  (
    'aby ach albo ale ani bardzo bez beda bedzie bo byc byl byla byli bylo byly chce cie coraz czy czyli dla dobrze dzis ' +
    'dzisiaj gdy gdyz gdzie ich jak jaka jaki jakie jako jednak jego jej jest jestem jeszcze jesli jutro juz kazdy kiedy ' +
    'kto ktora ktore ktorego ktorej ktory ktorych ktorym ktorzy lub maja mamy mie moga moze mozna musi nad nam nami nas ' +
    'nawet nia nic nie niech niej nim niz nowa nowe nowego nowej nowy nowych nowym nowymi okolo oraz pan pod podczas ' +
    'ponad poza przed przez przy raz razie roku rowniez sie sobie swoj swoje tak takze tam tego tej temu ten teraz tez ' +
    'toby trzeba tutaj tych tylko tym tys warto wczoraj wedlug wiec wlasnie wszystkie wszystko wsrod zeby zostal zostala ' +
    'zostalo zostaly ' +
    // posty w social mediach
    'artykul artykule czytaj dajcie daj dolacz dowiedz info informacja informacje kliknij komentarz komentarzach ' +
    'komentarzu link myslicie napiszcie news newsy obserwuj oficjalnie pilne polub post sadzicie sprawdz szczegoly ' +
    'udostepnij wiecej wpis zobacz znac zrodlo zrodla ' +
    // angielskie
    'about after again all also and any are been before being but can could did does doing during for from had has have ' +
    'having her here hers him his how into its just know let lets like made make many may might more most much must new ' +
    'nor not now off once one only other our out over own said says she should some such than that the their them then ' +
    'there these they this those through too under until very was were what when where which while who whom why will with ' +
    'would yet you your breaking check comment comments follow read share source thoughts today update via'
  ).split(/\s+/),
);
// końcówki odmiany (bez polskich znaków) – od najdłuższej; rdzeń zostaje co najmniej 4-literowy
const SUFFIXES = (
  'owego owych owymi iami owie owej owym ach ami ego emu ich iej ies imi ing owi ych ymi ed ej em es ia ie ii im iu ' +
  'om ow ym a e i o s u y'
)
  .split(' ')
  .sort((x, y) => y.length - x.length);

module.exports = { STOP, SUFFIXES };
