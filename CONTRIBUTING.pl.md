# Jak pomóc w rozwoju Postera

🇬🇧 [English](CONTRIBUTING.md) · 🇵🇱 **Polski**

Dziękuję za zainteresowanie projektem!

## Zgłoszenia

- **Błąd albo pomysł** → zakładka **Issues**. Podaj wersję (panel → *Ustawienia → Informacje o systemie*), co robisz,
  czego się spodziewasz i co się dzieje. Przydają się logi: `sudo docker compose logs --tail=100 panel n8n` –
  przed wklejeniem usuń z nich klucze i tokeny.
- **Podatność bezpieczeństwa** → zgłoś prywatnie, zgodnie z [SECURITY.pl.md](SECURITY.pl.md).

## Pull requesty

Poster jest dostępny na licencji AGPL-3.0, a autor może też udzielać licencji komercyjnych. Żeby Twój kod mógł trafić
do obu wersji, przed scaleniem pull requesta trzeba zaakceptować umowę dla współtwórców – [CLA.md](CLA.md).
Wystarczy napisać w opisie pull requesta: „Akceptuję CLA (CLA.md) dla tego i przyszłych wkładów.”

Zanim wyślesz pull request:
- przy większych zmianach najpierw opisz pomysł w Issues;
- trzymaj się zasad projektu:
  - panel nie ma zależności npm – tylko moduły wbudowane w Node.js;
  - każdy tekst dla użytkownika piszesz po polsku w `tr('…')`, a wersję angielską dopisujesz do słownika
    (`panel/public/i18n-en.js`, `panel/lib/i18n-en.js` albo `workflows/src/i18n-en.json`);
  - stare ustawienia i drafty muszą działać bez migracji;
  - `workflows/poster_workflow.json` powstaje z `workflows/src/` (`python3 workflows/src/build.py`) – nie edytuj go ręcznie;
- sprawdź zmiany:
  ```bash
  node --test panel/test/*.test.js
  for f in $(find panel -name '*.js'); do node --check "$f" || break; done
  npx prettier --check "panel/**/*.{js,css,html}" "workflows/src/**/*.js"
  python3 workflows/src/build.py && git diff --exit-code workflows/poster_workflow.json
  ```
- dopisz zmianę w [CHANGELOG.pl.md](CHANGELOG.pl.md) → „Niewydane” i w [CHANGELOG.md](CHANGELOG.md) → „Unreleased”
  (po angielsku – jeśli nie piszesz po angielsku, zostaw to autorowi).
