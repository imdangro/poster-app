# shellcheck shell=bash disable=SC2034 # zmienne dla skryptów, które wczytują ten plik
# Podpisane wydania – wspólna funkcja scripts/update.sh i scripts/upgrade-to-pro.sh (wczytywana po scripts/lang.sh;
# skrypt wołający ma GIT_IMAGE oraz info i warn):
#   . scripts/release.sh
# Każde wydanie Postera (LITE i PRO) to commit podpisany kluczem wydań. Publiczne części kluczy są w
# scripts/release-signers zainstalowanej wersji, więc nową wersję sprawdzamy kluczem, który NAS zna sprzed aktualizacji:
# kto zdobędzie prawo zapisu do repozytorium wydań (wykradziony klucz wdrożeniowy, token), bez klucza podpisu nie
# podsunie własnego kodu. Sprawdzenie robi scripts/release-verify.sh w kontenerze z gitem – tam jest opis zasad,
# także zmiany klucza. Pierwsza instalacja (docs/install.sh) ufa GitHubowi: nie ma jeszcze wersji, która zna klucz.
#
# POSTER_ALLOW_UNSIGNED=1 – jednorazowe pominięcie sprawdzenia (np. gdy autor ogłosi wymianę utraconego klucza):
#   sudo POSTER_ALLOW_UNSIGNED=1 bash scripts/update.sh
# POSTER_REQUIRE_SIGNED=1 – wymagaj podpisu także z repozytorium spoza wydań Postera (testy).

RELEASE_SIGNERS=scripts/release-signers

# Czy zainstalowana wersja ma wpisany klucz wydań (linia inna niż komentarz)
release_pinned() { grep -Eq '^[[:space:]]*[^#[:space:]]' "$RELEASE_SIGNERS" 2>/dev/null; }

# release_check <od> <do> – podpis commitu <do> (np. '@{upstream}') względem zainstalowanej wersji <od> (HEAD albo
# „-” przy zmianie repozytorium). Zwraca 0, gdy wolno instalować (REL_COMMIT – commit do zainstalowania: sprawdzony
# <do> albo ostatnie podpisane wydanie przed commitami bez podpisu; pusty, gdy bez kluczy nie było czego sprawdzać),
# a 3, gdy nie wolno – komunikat jest już wypisany.
release_check() {
  local out k v
  REL_RESULT=off REL_COMMIT='' REL_KEY=''
  release_pinned || return 0
  REL_RESULT=error
  out="$(docker run --rm -v "$PWD":/git -w /git -e POSTER_REQUIRE_SIGNED --entrypoint sh "$GIT_IMAGE" \
    scripts/release-verify.sh "$1" "$2" </dev/null)" || true
  while IFS='=' read -r k v; do
    case "$k" in
      result) REL_RESULT="$v" ;;
      commit) REL_COMMIT="$v" ;;
      key) REL_KEY="$v" ;;
    esac
  done <<<"$out"
  [[ "$REL_COMMIT" =~ ^[0-9a-f]{40,64}$ ]] || REL_RESULT=error
  case "$REL_RESULT" in
    verified)
      info "$(m "Podpis wydania sprawdzony${REL_KEY:+ (klucz $REL_KEY)}." "Release signature verified${REL_KEY:+ (key $REL_KEY)}.")"
      return 0
      ;;
    partial)
      warn "$(m "W repozytorium są nowsze zmiany bez podpisu wydań Postera – pomijam je i instaluję ostatnie podpisane wydanie${REL_KEY:+ (klucz $REL_KEY)}." \
        "The repository has newer changes without a Poster release signature – skipping them and installing the last signed release${REL_KEY:+ (key $REL_KEY)}.")" >&2
      return 0
      ;;
    current | off) return 0 ;;
    unsigned) warn "$(m "Nowa wersja w repozytorium nie ma podpisu wydań Postera." \
      "The new version in the repository has no Poster release signature.")" >&2 ;;
    untrusted) warn "$(m "Nowa wersja jest podpisana kluczem spoza kluczy wydań Postera${REL_KEY:+ ($REL_KEY)}." \
      "The new version is signed with a key that is not a Poster release key${REL_KEY:+ ($REL_KEY)}.")" >&2 ;;
    bad) warn "$(m "Podpis nowej wersji nie pasuje do jej treści." "The signature of the new version does not match its content.")" >&2 ;;
    *) warn "$(m "Nie udało się sprawdzić podpisu nowej wersji." "Could not check the signature of the new version.")" >&2 ;;
  esac
  if [ "${POSTER_ALLOW_UNSIGNED:-}" = 1 ] && [ -n "$REL_COMMIT" ]; then
    warn "$(m "POSTER_ALLOW_UNSIGNED=1 – instaluję mimo to, bez sprawdzonego podpisu." \
      "POSTER_ALLOW_UNSIGNED=1 – installing anyway, without a verified signature.")" >&2
    return 0
  fi
  warn "$(m "Nie instaluję jej – zainstalowana wersja działa dalej. Spróbuj ponownie później; jeśli to się powtarza, napisz na kontakt@posterapp.pl (README → „Aktualizacja”)." \
    "Not installing it – the installed version keeps working. Try again later; if this keeps happening, write to kontakt@posterapp.pl (README → “Updating”).")" >&2
  return 3
}
