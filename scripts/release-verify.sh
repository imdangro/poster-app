#!/bin/sh
# Sprawdzenie podpisu wydania Postera, zanim nowa wersja zostanie zainstalowana (scripts/update.sh
# i scripts/upgrade-to-pro.sh przez scripts/release.sh). Działa w katalogu projektu, w kontenerze z gitem (alpine/git:
# git, ssh-keygen i zwykłe sh) – tak samo uruchamiają go testy (panel/test/release.test.js) i publikacja wersji.
#
#   sh scripts/release-verify.sh <od> <do> [plik-kluczy]
#     <od>          zainstalowany commit (HEAD) albo „-”: liczy się tylko commit <do> (zmiana repozytorium na PRO)
#     <do>          commit do zainstalowania (@{upstream}, origin/main)
#     plik-kluczy   domyślnie scripts/release-signers z katalogu roboczego, czyli klucze znane PRZED aktualizacją
#
# Wynik: linie klucz=wartość na standardowym wyjściu; kod wyjścia 0, o ile dało się ustalić commit <do>.
#   result=verified   commit <do> jest podpisany kluczem wydań
#   result=partial    <do> nie ma podpisu, ale po drodze jest nowsze podpisane wydanie – do instalacji jest ono
#   result=current    nic nowego (<do> to zainstalowana wersja albo jej przodek)
#   result=off        podpis nie jest wymagany: plik bez kluczy albo repozytorium spoza wydań Postera
#   result=unsigned | untrusted | bad
#                     brak podpisu / podpis kluczem spoza pliku / podpis nie pasuje do treści – nie instalować
#   commit=<sha commitu do zainstalowania (przy odmowie: commitu „do”)>   key=<odcisk klucza podpisu>
#
# Zmiana klucza: wydanie podpisane znanym kluczem może zmienić scripts/release-signers. Dlatego przy aktualizacji
# przechodzimy po kolei commity między <od> a <do> (tylko potomków zainstalowanej wersji – stara historia nie przywróci
# wycofanego klucza): każdy commit z dobrym podpisem przekazuje swoją listę kluczy następnym, a commity bez podpisu
# niczego nie zmieniają. Do instalacji jest ostatni commit z dobrym podpisem: zwykle <do>, a gdy ktoś dopisał za nim
# commity bez podpisu (np. scalony PR przed kolejną publikacją) – wydanie przed nimi. Kto ominął wydanie ze zmianą
# klucza, aktualizuje się jak zwykle.
set -eu

[ "$#" -ge 2 ] || { echo "użycie: sh scripts/release-verify.sh <od|-> <do> [plik-kluczy]" >&2; exit 2; }
FROM=$1
TO=$2
SIGNERS=${3:-scripts/release-signers}
SIGNERS_PATH=scripts/release-signers # ta sama ścieżka w każdym commicie wydania

# git w kontenerze działa jako root, a katalog projektu może należeć do innego użytkownika NAS-a (patrz update.sh)
g() { git -c "safe.directory=$PWD" "$@"; }
has_keys() { [ -f "$1" ] && grep -Eq '^[[:space:]]*[^#[:space:]]' "$1"; }

TIP=$(g rev-parse --verify -q "$TO^{commit}") || { echo result=error; exit 2; }

# Podpisu wymagamy od repozytoriów wydań Postera (LITE i PRO). Własna kopia programu albo repozytorium źródłowe
# aktualizuje się bez podpisu; POSTER_REQUIRE_SIGNED=1 wymaga go zawsze (testy, kopia z własnym kluczem).
official() {
  branch=$(g symbolic-ref -q --short HEAD 2>/dev/null || true)
  remote=$(g config "branch.$branch.remote" 2>/dev/null || true)
  url=$(g remote get-url "${remote:-origin}" 2>/dev/null || true)
  slug=$(printf '%s' "$url" | tr 'A-Z' 'a-z' |
    sed -E 's#^(https?://([^@/]+@)?github\.com/|git@github\.com:|ssh://git@github\.com(:22)?/)##; s#\.git/?$##; s#/+$##')
  case "$slug" in
    imdangro/poster-app | imdangro/poster-pro) return 0 ;;
  esac
  return 1
}
finish() { # $1 – wynik, $2 – commit
  echo "result=$1"
  echo "commit=$2"
  exit 0
}
if ! has_keys "$SIGNERS"; then finish off "$TIP"; fi
if [ "${POSTER_REQUIRE_SIGNED:-}" != 1 ] && ! official; then finish off "$TIP"; fi

BASE=
if [ "$FROM" != - ]; then
  BASE=$(g rev-parse --verify -q "$FROM^{commit}") || { echo result=error; exit 2; }
  if [ "$BASE" = "$TIP" ] || g merge-base --is-ancestor "$TIP" "$BASE" 2>/dev/null; then finish current "$TIP"; fi
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp "$SIGNERS" "$TMP/signers"
# podpis SSH (git commit -S z gpg.format=ssh) kluczem z pliku, w przestrzeni nazw „git”
good() { g -c "gpg.ssh.allowedSignersFile=$TMP/signers" verify-commit "$1" >/dev/null 2>&1; }

if [ -n "$BASE" ] && g merge-base --is-ancestor "$BASE" "$TIP" 2>/dev/null; then
  LIST=$(g rev-list --reverse --topo-order --ancestry-path "$BASE..$TIP")
else
  LIST=$TIP # inna historia (wersja PRO po LITE, przepisana gałąź): liczy się tylko nowy commit i klucze z dysku
fi

LAST=
for c in $LIST; do
  if good "$c"; then
    LAST=$c
    if [ "$c" != "$TIP" ] && g cat-file -e "$c:$SIGNERS_PATH" 2>/dev/null; then
      g show "$c:$SIGNERS_PATH" >"$TMP/next"
      if has_keys "$TMP/next"; then cp "$TMP/next" "$TMP/signers"; fi
    fi
  fi
done

show() { g -c "gpg.ssh.allowedSignersFile=$TMP/signers" log -1 --format="$1" "$2" 2>/dev/null || true; }
if [ -n "$LAST" ]; then
  echo "key=$(show '%GF' "$LAST")"
  if [ "$LAST" = "$TIP" ]; then finish verified "$TIP"; fi
  finish partial "$LAST"
fi
echo "key=$(show '%GF' "$TIP")"
case "$(show '%G?' "$TIP")" in
  N) finish unsigned "$TIP" ;;
  U | G) finish untrusted "$TIP" ;;
  *) finish bad "$TIP" ;;
esac
