# shellcheck shell=bash
# Język komunikatów skryptów (polski / angielski). Wczytywany w katalogu projektu: . scripts/lang.sh
# Kolejność: zmienna POSTER_LANG (pl/en) → język panelu (data/panel/config.json → ui.language) →
# konfiguracja sprzed wersji angielskiej: polski → język systemu (LANG), domyślnie angielski.
poster_lang() {
  case "${POSTER_LANG:-}" in pl | en) printf '%s' "$POSTER_LANG" && return ;; esac
  local cfg=data/panel/config.json ui
  if [ -f "$cfg" ]; then
    ui="$(grep -A3 '"ui": *{' "$cfg" 2>/dev/null | grep -o '"language": *"[a-z]*"' | head -n1 | sed 's/.*"\([a-z]*\)"$/\1/' || true)"
    case "$ui" in pl | en) printf '%s' "$ui" && return ;; esac
    grep -q '"ui": *{' "$cfg" 2>/dev/null || { printf 'pl' && return; }
  fi
  case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in pl* | PL*) printf 'pl' ;; *) printf 'en' ;; esac
}
UI_LANG="$(poster_lang)"

# m "tekst po polsku" "English text" – wypisuje tekst w języku skryptów
m() {
  if [ "$UI_LANG" = en ]; then printf '%s' "$2"; else printf '%s' "$1"; fi
}
