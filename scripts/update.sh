#!/usr/bin/env bash
# Aktualizacja Poster na NAS-ie jednym poleceniem (SSH, katalog projektu):
#   sudo bash scripts/update.sh
# Kroki: 1) pobranie nowej wersji z GitHuba (git pull w kontenerze alpine/git; bez hasła po
#           jednorazowym sudo bash scripts/setup-deploy-key.sh),
#        2) uzupełnienie .env o nowe klucze + uprawnienia katalogów (init-nas.sh),
#        3) przebudowa i restart kontenerów (docker compose up -d --build),
#        4) import i publikacja workflow w n8n (import-to-n8n.sh).
# Wersja PRO z licencją (scripts/upgrade-to-pro.sh): przed pobraniem skrypt odświeża datę końca aktualizacji, a gdy
# aktualizacje wygasły, kończy bez pobierania – zainstalowana wersja działa dalej.
# Opcje: --no-pull (pomiń pobieranie), --no-workflow (bez importu workflow).
set -euo pipefail

cd "$(dirname "$0")/.."
. scripts/lang.sh

PULL=1
WORKFLOW=1
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    --no-workflow) WORKFLOW=0 ;;
    *) echo "$(m "Nieznana opcja: $arg" "Unknown option: $arg")" >&2; exit 2 ;;
  esac
done

info() { printf '\033[1;34m[update]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[%s]\033[0m %s\n' "$(m błąd error)" "$*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "$(m "Uruchom przez sudo: sudo bash scripts/update.sh" "Run it with sudo: sudo bash scripts/update.sh")"

# Wersja PRO z licencją: stan licencji (scripts/upgrade-to-pro.sh) i repozytorium PRO jako origin
LICENSED=0
if [ "$PULL" -eq 1 ] && [ -f .git/poster-pro-license.json ] && [ -f scripts/license.sh ]; then
  . scripts/license.sh
  grep -qF "url = $PRO_REPO" .git/config && LICENSED=1
fi

# Pobranie się nie udało, a licencja PRO jest sprawdzona: wygasła – komunikat i koniec bez błędu, inaczej – przyczyna
pro_pull_failed() {
  local version
  version="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' panel/package.json | head -n1)"
  case "$LIC_RESULT" in
    expired)
      info "$(m "Aktualizacje PRO wygasły $(license_date)." "PRO updates expired on $(license_date).")"
      info "$(m "Twoja wersja (PRO $version) działa dalej – boty publikują jak dotąd." \
        "Your version (PRO $version) keeps working – the bots publish as before.")"
      info "$(m "Przedłużenie licencji: $LIC_RENEW – po zakupie aktualizacje wrócą same." \
        "License renewal: $LIC_RENEW – after the purchase updates come back by themselves.")"
      exit 0
      ;;
    inactive) die "$(m "Licencja PRO jest nieaktywna (np. po zwrocie płatności) – aktualizacje PRO nie są dostępne. Pytania: $LIC_PRODUCT" \
      "The PRO license is inactive (e.g. after a refund) – PRO updates are not available. Questions: $LIC_PRODUCT")" ;;
    invalid) die "$(m "Ten NAS nie jest już aktywowany na licencji PRO (np. zwolnione urządzenie). Aktywujesz go ponownie: sudo bash scripts/upgrade-to-pro.sh" \
      "This NAS is no longer activated on the PRO license (e.g. the device was released). To activate it again: sudo bash scripts/upgrade-to-pro.sh")" ;;
    ok) die "$(m "Licencja PRO jest ważna, ale repozytorium PRO nie odpowiada. Tuż po przedłużeniu licencji dostęp wraca w ciągu kilku minut – spróbuj ponownie. Zapora sieci musi przepuszczać ruch na github.com:22 (SSH)." \
      "The PRO license is valid, but the PRO repository does not respond. If you have just renewed the license, access comes back within a few minutes – try again. The firewall must allow traffic to github.com:22 (SSH).")" ;;
  esac
}

if [ "$PULL" -eq 1 ]; then
  if [ "$LICENSED" -eq 1 ]; then
    license_image
    license_read "$(license_cli refresh </dev/null || true)"
    UNTIL="$(license_until)"
    if [ "$LIC_RESULT" = ok ] && [ -n "$LIC_DAYS" ] && [ "$LIC_DAYS" -le 30 ]; then
      info "$(m "Licencja PRO: $UNTIL (zostało dni: $LIC_DAYS). Przedłużenie: $LIC_RENEW" \
        "PRO license: $UNTIL ($LIC_DAYS days left). Renewal: $LIC_RENEW")"
    elif [ "$LIC_RESULT" = ok ] && [ -n "$UNTIL" ]; then
      info "$(m "Licencja PRO: $UNTIL." "PRO license: $UNTIL.")"
    fi
  fi
  info "$(m "Pobieram nową wersję z GitHuba..." "Downloading the new version from GitHub...")"
  TTY=""
  [ -t 0 ] && TTY="-it"
  # Zawsze git z kontenera alpine/git: w nim działa klucz z scripts/setup-deploy-key.sh (ścieżki /git/...).
  # safe.directory: w kontenerze git działa jako root, a katalog projektu może należeć do innego
  # użytkownika NAS-a – bez tego git przerywa z błędem „detected dubious ownership”
  pull() {
    # shellcheck disable=SC2086
    docker run --rm $1 -v "$PWD":/git alpine/git -c safe.directory=/git pull --ff-only
  }
  # licencja wygasła albo jest nieaktywna: repozytorium PRO zwykle już odmawia dostępu – zamiast surowego błędu gita
  # („Permission denied (publickey)”) tylko nasz komunikat; gdy dostęp jeszcze jest, pobieramy jak zwykle
  QUIET=0
  if [ "$LICENSED" -eq 1 ]; then
    case "$LIC_RESULT" in expired | inactive | invalid) QUIET=1 ;; esac
  fi
  if [ "$QUIET" -eq 1 ]; then
    if OUT="$(pull "" 2>&1)"; then
      printf '%s\n' "$OUT"
    else
      pro_pull_failed
    fi
  elif ! pull "$TTY"; then
    [ "$LICENSED" -eq 1 ] && pro_pull_failed
    die "$(m "Nie udało się pobrać nowej wersji (komunikat gita powyżej)." "Could not download the new version (git message above).")"
  fi
  # skrypt mógł się zmienić – uruchamiamy już nową wersję
  exec bash scripts/update.sh --no-pull "$@"
fi

info "$(m "Uzupełniam .env i uprawnienia..." "Updating .env and permissions...")"
bash scripts/init-nas.sh >/dev/null

info "$(m "Buduję panel i uruchamiam kontenery..." "Building the panel and starting the containers...")"
docker compose up -d --build --remove-orphans

if [ "$WORKFLOW" -eq 1 ]; then
  bash scripts/import-to-n8n.sh
fi

info "$(m "Gotowe. Stan kontenerów:" "Done. Container status:")"
docker compose ps
